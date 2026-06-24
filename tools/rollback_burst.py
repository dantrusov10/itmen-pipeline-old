#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Анализ и откат пакета аудита 2026-06-24 13:38:47 МСК (10:38:47 UTC)."""
import json
import re
import sys
import urllib.request
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = re.search(
    r'url:\s*"([^"]+)"',
    (ROOT / "js" / "gas-config.js").read_text(encoding="utf-8"),
).group(1)

DEFAULT_BURST = "2026-06-24T10:38:47"  # 13:38:47 МСК — исходный инцидент

LABEL_TO_KEY = {
    "Клиент": "customer", "Отрасль": "industry", "Владелец": "owner", "Стадия": "stage",
    "Ожид. сумма": "amount", "Ожид. бюджет": "expectedBudget", "Партнёр": "partner",
    "Скидка партнёру, %": "partnerDiscount", "Скидка клиенту, %": "clientDiscount",
    "Вероятность": "manualProb", "Срок задачи": "taskDue", "Срок бюджета": "budgetPeriod",
    "Статус бюджета": "budgetStatus", "Месяц согласования": "budgetPlannedMonth",
    "Год согласования": "budgetPlannedYear", "Статус коммита": "commitStatus",
    "Ключевые боли": "pains", "Риски": "riskTypes", "Комментарий к риску": "riskComment",
    "Скоринг": "scores", "Что ищут": "seekingSegments", "Другое (что ищут)": "seekingOtherLabel",
    "% требований проекта": "productRequirementsPct", "% требований пилота": "pilotRequirementsPct",
    "Что есть сейчас": "asIsStack", "Почему меняют": "changePains",
    "Конкуренты": "competitorEntries", "Задачи проекта": "projectTasks",
}
TECH_KEYS = {
    "seekingSegments", "seekingOtherLabel", "productRequirementsPct", "pilotRequirementsPct",
    "asIsStack", "changePains", "competitorEntries", "projectTasks",
}


def fetch(path):
    with urllib.request.urlopen(URL + path, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def post(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        URL, data=data, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def parse_value(label, raw):
    key = LABEL_TO_KEY.get(label)
    if key is None:
        return None
    if raw is None:
        return None
    s = str(raw).strip()
    if label == "—":
        return None
    if key == "scores":
        return json.loads(s)
    if key in ("asIsStack", "changePains", "competitorEntries"):
        if not s or s == "{}":
            return {} if key != "competitorEntries" else {}
        return json.loads(s)
    if key in ("riskTypes", "seekingSegments"):
        if not s:
            return []
        return [x.strip() for x in s.split(",") if x.strip()]
    if key == "projectTasks":
        if not s:
            return []
        return [x.strip() for x in s.split(";") if x.strip()]
    if key in ("amount", "expectedBudget", "manualProb", "partnerDiscount", "clientDiscount",
               "budgetPlannedMonth", "budgetPlannedYear", "productRequirementsPct", "pilotRequirementsPct"):
        if s == "":
            return None
        return float(s) if "." in s else int(s)
    if key == "taskDue":
        if not s:
            return ""
        m = re.match(r"^\d{4}-\d{2}-\d{2}$", s)
        if m:
            return s
        m2 = re.search(r"(\d{4}-\d{2}-\d{2})", s)
        return m2.group(1) if m2 else s
    return s


def fmt_field(deal, label):
    key = LABEL_TO_KEY.get(label)
    if not key:
        return ""
    if key in TECH_KEYS:
        val = (deal.get("techResearch") or {}).get(key)
    elif key == "riskTypes":
        rt = deal.get("riskTypes") or []
        if not rt and deal.get("riskType") not in (None, "none"):
            rt = [deal["riskType"]]
        val = ", ".join(x for x in rt if x and x != "none")
    elif key == "scores":
        val = deal.get("scores") or {}
    else:
        val = deal.get(key)
    if val is None or val == "":
        return ""
    if isinstance(val, (dict, list)):
        return json.dumps(val, ensure_ascii=False, separators=(",", ":"))
    return str(val)


def apply_field(deal, label, raw):
    key = LABEL_TO_KEY.get(label)
    if not key:
        return False
    val = parse_value(label, raw)
    if val is None and key not in ("pains", "riskComment", "taskDue", "partner"):
        if str(raw or "").strip() == "":
            if key in TECH_KEYS:
                deal.setdefault("techResearch", {})
                deal["techResearch"][key] = val if key in ("asIsStack", "changePains", "competitorEntries") else (val or [])
            elif key == "riskTypes":
                deal["riskTypes"] = []
                deal["riskType"] = "none"
            else:
                deal[key] = "" if key in ("taskDue", "pains", "riskComment") else deal.get(key)
            return True
        return False
    if key in TECH_KEYS:
        deal.setdefault("techResearch", {})
        deal["techResearch"][key] = val
    elif key == "riskTypes":
        deal["riskTypes"] = val or []
        deal["riskType"] = deal["riskTypes"][0] if deal["riskTypes"] else "none"
    else:
        deal[key] = val
    deal["updatedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return True


def norm(s):
    s = str(s or "").strip()
    try:
        if s.startswith("{") or s.startswith("["):
            return json.dumps(json.loads(s), ensure_ascii=False, sort_keys=True)
    except json.JSONDecodeError:
        pass
    return s


def is_burst_row(ts, prefix):
    return str(ts or "").startswith(prefix)


def main():
    apply = "--apply" in sys.argv
    prefix = DEFAULT_BURST
    for i, arg in enumerate(sys.argv):
        if arg == "--at" and i + 1 < len(sys.argv):
            prefix = sys.argv[i + 1]
    audit = fetch("?action=auditAll")
    rows = audit.get("rows") or []
    burst = [r for r in rows if is_burst_row(r[0], prefix)]
    print(f"Burst rows: {len(burst)} (prefix {prefix})")

    deletions = [r for r in burst if str(r[6]) == "—" and str(r[7]) == "Сделка удалена"]
    new_deals = [r for r in burst if str(r[6]) == "—" and str(r[8]) == "Новая сделка"]
    field_rows = [r for r in burst if str(r[6]) not in ("—", "")]
    print(f"  field changes: {len(field_rows)}")
    print(f"  deletions logged: {len(deletions)}")
    print(f"  new deals logged: {len(new_deals)}")

    state = fetch("?action=get")["state"]
    deals_by_id = {d["id"]: deepcopy(d) for d in state.get("deals", []) if d.get("id")}
    print(f"Current deals on server: {len(deals_by_id)}")

    plan = []
    skipped = 0
    for row in field_rows:
        deal_id, label, old_val, new_val = str(row[2]), str(row[6]), row[7], row[8]
        deal = deals_by_id.get(deal_id)
        if not deal:
            skipped += 1
            continue
        cur = fmt_field(deal, label)
        if norm(cur) == norm(old_val):
            continue
        if norm(cur) != norm(new_val):
            # уже изменено после инцидента — всё равно откатываем к old из аудита
            pass
        plan.append({
            "dealId": deal_id,
            "customer": deal.get("customer", ""),
            "label": label,
            "from": str(cur)[:80],
            "to": str(old_val)[:120],
            "auditNew": str(new_val)[:80],
        })
        apply_field(deal, label, old_val)

    print(f"Rollback plan: {len(plan)} fields (skipped missing deals: {skipped})")
    for p in plan[:25]:
        print(f"  {p['dealId']} | {p['label']} | {p['auditNew'][:40]!r} -> restore {p['to'][:50]!r}")
    if len(plan) > 25:
        print(f"  ... and {len(plan)-25} more")

    out = ROOT / "tools" / "rollback_burst_plan.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Plan saved: {out}")

    recovered = deepcopy(state)
    recovered["deals"] = list(deals_by_id.values())
    preview = ROOT / "tools" / "rollback_burst_state_preview.json"
    preview.write_text(json.dumps(recovered, ensure_ascii=False)[:500000], encoding="utf-8")

    if not apply:
        print("\nPreview only. Run with --apply to write rollback to server.")
        return

    res = post({
        "action": "save",
        "state": recovered,
        "forceFull": True,
        "savedBy": "rollback-13-38-47",
        "allowMaintenance": True,
    })
    if res.get("error"):
        print("ERROR:", res["error"])
        sys.exit(1)
    print(f"Applied rollback. auditRows={res.get('auditRows')} updatedAt={res.get('updatedAt')}")
    print("Refresh pipeline (Ctrl+F5).")


if __name__ == "__main__":
    main()
