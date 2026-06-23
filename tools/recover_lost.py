#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Восстановление полей, которые были заполнены (есть в аудите), затем стёрты сохранением.
Анализ + опционально запись на сервер (forceFull save).
"""
import json
import re
import sys
import urllib.request
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = re.search(
    r'url:\s*"([^"]+)"',
    (ROOT / "js" / "gas-config.js").read_text(encoding="utf-8"),
).group(1)

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


def fetch(path_or_url):
    u = path_or_url if path_or_url.startswith("http") else URL + path_or_url
    with urllib.request.urlopen(u, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def post(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        URL, data=data, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def is_empty_audit(label, raw):
    if raw is None:
        return True
    s = str(raw).strip()
    if not s:
        return True
    if label == "Статус бюджета" and s == "Неизвестно":
        return True
    if label == "Статус коммита" and s in ("none", "Нет подтверждения"):
        return True
    if label == "Срок бюджета" and s == "Не определён":
        return True
    if label == "Ключевые боли" and len(s) < 5:
        return True
    if label == "Скоринг":
        try:
            sc = json.loads(s)
            return sum(sc.values()) <= 2
        except (json.JSONDecodeError, TypeError):
            return True
    if label in ("Риски", "Что ищут") and len(s) < 2:
        return True
    if label in ("Что есть сейчас", "Почему меняют", "Конкуренты", "Почему меняют"):
        return s in ("{}", "")
    return False


def fmt_current(deal, label):
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


def parse_value(label, raw):
    key = LABEL_TO_KEY.get(label)
    if key is None or raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if key == "scores":
        return json.loads(s)
    if key in ("asIsStack", "changePains", "competitorEntries"):
        return json.loads(s)
    if key in ("riskTypes", "seekingSegments"):
        return [x.strip() for x in s.split(",") if x.strip()]
    if key == "projectTasks":
        return [x.strip() for x in s.split(";") if x.strip()]
    if key in ("amount", "expectedBudget", "manualProb", "partnerDiscount", "clientDiscount",
               "budgetPlannedMonth", "budgetPlannedYear", "productRequirementsPct", "pilotRequirementsPct"):
        n = float(s) if "." in s else int(s)
        return n
    if key == "taskDue":
        if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
            return s
        m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
        if m:
            return m.group(1)
        return s[:10] if len(s) >= 10 else s
    return s


def apply_field(deal, label, raw):
    key = LABEL_TO_KEY.get(label)
    if not key:
        return False
    val = parse_value(label, raw)
    if val is None and key not in ("pains", "riskComment", "taskDue"):
        return False
    if key in TECH_KEYS:
        deal.setdefault("techResearch", {})
        deal["techResearch"][key] = val
    elif key == "riskTypes":
        deal["riskTypes"] = val or []
        deal["riskType"] = deal["riskTypes"][0] if deal["riskTypes"] else "none"
    else:
        deal[key] = val
    deal["updatedAt"] = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return True


def get_audit_rows():
    # Сначала пробуем серверный recover preview (весь аудит на сервере)
    try:
        res = post({"action": "recoverFromAudit", "apply": False, "mode": "lost"})
        if res.get("ok") and "plan" in res:
            return None, res
    except Exception:
        pass
    # Fallback: последние строки через GET
    data = fetch("?action=audit&limit=100")
    return data.get("rows") or [], None


def build_plan_from_rows(rows, state):
    deals = {d["id"]: deepcopy(d) for d in state.get("deals", []) if d.get("id")}
    timeline = {}
    for row in rows:
        deal_id, label, new_val = str(row[2]), str(row[6]), row[8]
        if not deal_id or not label or label == "—":
            continue
        timeline.setdefault((deal_id, label), []).append(new_val)

    plan = []
    for (deal_id, label), vals in timeline.items():
        last_good = None
        for v in vals:
            if not is_empty_audit(label, v):
                last_good = v
        if last_good is None:
            continue
        final_audit = vals[-1]
        wiped = is_empty_audit(label, final_audit) and not is_empty_audit(label, last_good)
        deal = deals.get(deal_id)
        if not deal:
            continue
        cur = fmt_current(deal, label)
        cur_empty = is_empty_audit(label, cur)
        if cur == str(last_good).strip() or fmt_norm(cur) == fmt_norm(str(last_good)):
            continue
        if wiped or (cur_empty and not is_empty_audit(label, last_good)):
            plan.append({
                "dealId": deal_id,
                "customer": deal.get("customer", ""),
                "label": label,
                "reason": "wiped_in_audit" if wiped else "empty_on_server",
                "was": cur[:80],
                "restore": str(last_good)[:120],
            })
    return plan, deals


def fmt_norm(s):
    s = str(s).strip()
    try:
        if s.startswith("{") or s.startswith("["):
            return json.dumps(json.loads(s), ensure_ascii=False, sort_keys=True)
    except json.JSONDecodeError:
        pass
    return s


def main():
    apply = "--apply" in sys.argv
    state = fetch("?action=get")["state"]
    rows, server_preview = get_audit_rows()

    if server_preview and server_preview.get("plan"):
        plan = server_preview["plan"]
        print(f"Server-side lost-field plan: {len(plan)} fields")
    else:
        print(f"Audit rows for analysis: {len(rows)}")
        plan, deals = build_plan_from_rows(rows, state)
        deals_map = deals
    if not server_preview:
        deals_map = {d["id"]: deepcopy(d) for d in state.get("deals", []) if d.get("id")}

    if server_preview and server_preview.get("plan"):
        for item in server_preview["plan"][:40]:
            print(f"  {item.get('dealId')} {item.get('customer','')[:25]} | {item.get('label')} | {item.get('reason')}")
        if apply:
            res = post({"action": "recoverFromAudit", "apply": True, "mode": "lost"})
            print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    print(f"\nLost fields to restore: {len(plan)}")
    for p in plan:
        print(f"  {p['dealId']} {p['customer'][:28]} | {p['label']} | {p['reason']}")
        print(f"    -> {p['restore'][:100]}")

    if not plan:
        print("Nothing to restore.")
        return

    if not apply:
        print("\nPreview only. Run with --apply to write to production.")
        return

    recovered = deepcopy(state)
    deal_index = {d["id"]: i for i, d in enumerate(recovered["deals"]) if d.get("id")}
    for p in plan:
        idx = deal_index.get(p["dealId"])
        if idx is None:
            continue
        apply_field(recovered["deals"][idx], p["label"], p["restore"])

    res = post({"action": "save", "state": recovered, "forceFull": True})
    if res.get("error"):
        print("ERROR:", res["error"])
        sys.exit(1)
    print(f"Applied {len(plan)} field restorations. auditRows={res.get('auditRows')}")
    print("Refresh pipeline page (Ctrl+F5).")


if __name__ == "__main__":
    main()
