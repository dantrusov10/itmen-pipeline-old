#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Импорт staging GAS → PocketBase (схема v3).

  python3 import-gas-to-pb.py              # dry-run
  python3 import-gas-to-pb.py --apply    # запись
  python3 import-gas-to-pb.py --apply --clear   # очистить коллекции и импорт
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# ── Критерии скоринга (из js/config.js) ─────────────────────────────────────
SCORE_CRITERIA = [
    {"key": "loyalty", "name": "Лояльность клиента к нам", "weight": 0.10,
     "question": "Насколько клиент нам лоялен, доверяет нам и готов продвигать нас внутри?", "manual_only": True},
    {"key": "commit", "name": "Подтверждение коммита клиента", "weight": 0.10,
     "question": "Насколько клиент подтвердил намерение участвовать в закупке?", "manual_only": False},
    {"key": "budget", "name": "Определённость бюджета", "weight": 0.18,
     "question": "Насколько понятен и подтверждён бюджет на проект?", "manual_only": False},
    {"key": "fit", "name": "Соответствие проблеме", "weight": 0.18,
     "question": "Насколько ITMen закрывает заявленные боли и выбранные сегменты?", "manual_only": False},
    {"key": "timing", "name": "Срочность сроков", "weight": 0.14,
     "question": "Когда клиент готов принять решение?", "manual_only": False},
    {"key": "competitive", "name": "Конкурентная позиция", "weight": 0.10,
     "question": "Насколько мы конкурентны в этой сделке?", "manual_only": False},
    {"key": "access", "name": "Доступ / влияние", "weight": 0.08,
     "question": "Есть ли доступ к ЛПР и понятна ли карта влияния?", "manual_only": False},
    {"key": "technical", "name": "Техн. соответствие", "weight": 0.06,
     "question": "Насколько продукт закрывает % требований проекта и пилота?", "manual_only": False},
    {"key": "commercial", "name": "Коммерч. готовность клиента", "weight": 0.06,
     "question": "Насколько клиент готов к закупке: процесс, сроки, участники?", "manual_only": False},
]

RUBRICS = {
    "loyalty": {"s5": "Есть чемпион, высокое доверие, активно продвигают нас внутри",
                "s4": "Сильный контакт, позитивные отношения, готовы идти с нами",
                "s3": "Нейтральные отношения, сравнивают на равных с конкурентами",
                "s2": "Слабый контакт, мало доверия, нужен «прогрев»",
                "s1": "Холодно / предпочитают других, нет адвоката",
                "s0": "Нет контакта или негатив к нам"},
    "commit": {"s5": "Контракт / заказ подписан — обязательство зафиксировано",
               "s4": "LOI или гарантийное письмо — формальное намерение",
               "s3": "Протокол встречи с зафиксированными next steps",
               "s2": "Email или устное подтверждение интереса",
               "s1": "Слабые сигналы, без письменной фиксации",
               "s0": "Нет подтверждения от клиента"},
    "budget": {"s5": "Бюджет подтверждён, сумма и срок известны",
               "s4": "Бюджет в согласовании, сумма оценена",
               "s3": "Согласование запланировано, порядок величины понятен",
               "s2": "Бюджет предполагается, без дат",
               "s1": "Бюджет под большим вопросом",
               "s0": "Бюджета нет / неизвестно"},
    "fit": {"s5": "Все ключевые сегменты и боли — прямое попадание ITMen",
            "s4": "Основные боли закрываем, мелкие пробелы",
            "s3": "Закрываем часть сегментов, есть gaps",
            "s2": "Косвенное соответствие, много доработок",
            "s1": "Слабое соответствие",
            "s0": "Не наш профиль / нет боли"},
    "timing": {"s5": "Решение в текущем квартале, есть триггер",
               "s4": "Решение в ближайшие 2 квартала",
               "s3": "Решение в следующем бюджетном цикле",
               "s2": "Длинный цикл, слабый триггер",
               "s1": "Сроки размыты",
               "s0": "Нет сроков / на паузе"},
    "competitive": {"s5": "Мы предпочтительны / в шорт-листе №1",
                    "s4": "В шорт-листе, сильная дифференциация",
                    "s3": "Сравнивают нас с 2–3 вендорами на равных",
                    "s2": "Коммодити-сравнение, цена решает",
                    "s1": "Конкурент сильнее",
                    "s0": "Выбран другой вендор"},
    "access": {"s5": "Доступ к ЛПР и бюджетодержателю, карта влияния ясна",
               "s4": "Есть выход на ЛПР через чемпиона",
               "s3": "Работаем с уровнем ниже ЛПР",
               "s2": "Карта влияния не ясна",
               "s1": "Только формальные контакты",
               "s0": "Нет доступа"},
    "technical": {"s5": "≥90% требований проекта и пилота закрыты",
                  "s4": "75–89% — небольшие доработки",
                  "s3": "60–74% — умеренный scope доработок",
                  "s2": "40–59% — существенный gap",
                  "s1": "20–39% — слабое соответствие",
                  "s0": "<20% — не проходим по требованиям"},
    "commercial": {"s5": "Процесс закупки ясен, участники определены, сроки согласованы",
                   "s4": "Процесс понятен, мелкие пробелы",
                   "s3": "Процесс в целом ясен",
                   "s2": "Процесс не ясен",
                   "s1": "Закупка не формализована",
                   "s0": "Нет процесса закупки"},
}

KEY_HINTS = {
    "loyalty": "Лояльность", "commit": "Коммит", "budget": "Определённость",
    "fit": "Соответствие", "timing": "Срочность", "competitive": "Конкурент",
    "access": "Доступ", "technical": "Техн", "commercial": "Коммерч",
}

MANAGERS_DEFAULT = [
    {"manager_id": "merlein", "name": "Аркадий Мерлейн", "sheet": "Мерлейн"},
    {"manager_id": "akhmetshin", "name": "Арслан Ахметшин", "sheet": "Ахметшин"},
    {"manager_id": "sirotkin", "name": "Александр Сироткин", "sheet": "Сироткин"},
    {"manager_id": "kulagin", "name": "Алексей Кулагин", "sheet": "Кулагин"},
]

CLEAR_ORDER = [
    "import_log", "snapshots_deals", "snapshots_daily", "audit_log",
    "deal_score_history_items", "deal_score_history", "deal_scores", "deal_risks",
    "deal_competitors", "deal_change_pains", "deal_as_is", "deal_project_tasks",
    "deal_seeking_segments", "deal_tech", "deals", "list_items", "scoring_criteria",
    "managers", "pipeline_meta",
]


def load_config():
    gas = os.environ.get("STAGING_GAS_URL", "")
    pb = os.environ.get("PB_URL", "http://127.0.0.1:8095")
    email = os.environ.get("PB_ADMIN_EMAIL", "")
    password = os.environ.get("PB_ADMIN_PASSWORD", "")
    env_path = "/opt/itmen-pipeline/.env"
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k == "STAGING_GAS_URL" and not gas:
                gas = v
            elif k == "PB_ADMIN_EMAIL" and not email:
                email = v
            elif k == "PB_ADMIN_PASSWORD" and not password:
                password = v
            elif k == "PUBLIC_URL" and not pb:
                pb = v
    if not gas:
        gas = "https://script.google.com/macros/s/AKfycbznkPIdUDj0mG8XdZ5lprz13u6r5DqqlpFj4EwOlc2vcgidwyGh2clHQv_dC2ro8WJ42w/exec"
    if not email or not password:
        raise SystemExit("PB admin credentials missing in /opt/itmen-pipeline/.env")
    return gas.rstrip("/"), pb.rstrip("/"), email, password


def http_json(url, data=None, token=None, method=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=300) as res:
        raw = res.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def gas_get(gas_url, path):
    with urllib.request.urlopen(gas_url + path, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def match_gas_scoring(gas_scoring):
    """Сопоставить массив scoring из GAS с criterion_key."""
    by_name = {}
    for item in gas_scoring or []:
        name = item.get("name") or ""
        for key, hint in KEY_HINTS.items():
            if hint in name:
                by_name[key] = item
                break
    return by_name


def iso_date(val):
    if not val:
        return None
    if "T" in str(val):
        return str(val)
    return f"{val}T12:00:00.000Z"


def norm_as_is(val):
    if isinstance(val, dict):
        return val
    if isinstance(val, str) and val.strip():
        return {"vendor": val.strip(), "product": "", "catalogKey": "", "comment": "", "custom": True}
    return {}


class Importer:
    def __init__(self, gas_url, pb_url, token, apply=False):
        self.gas_url = gas_url
        self.pb_url = pb_url
        self.token = token
        self.apply = apply
        self.stats = {}
        self.deal_pb_ids = {}

    def inc(self, name, n=1):
        self.stats[name] = self.stats.get(name, 0) + n

    def create(self, collection, body):
        if not self.apply:
            self.inc(collection)
            return {"id": f"dry_{collection}_{self.stats[collection]}"}
        return http_json(
            f"{self.pb_url}/api/collections/{collection}/records",
            body, token=self.token, method="POST",
        )

    def clear_collection(self, name):
        if not self.apply:
            print(f"  [dry] clear {name}")
            return
        total = 0
        while True:
            data = http_json(
                f"{self.pb_url}/api/collections/{name}/records?page=1&perPage=200",
                token=self.token,
            )
            items = data.get("items", [])
            if not items:
                break
            for item in items:
                http_json(
                    f"{self.pb_url}/api/collections/{name}/records/{item['id']}",
                    token=self.token, method="DELETE",
                )
                total += 1
        if total:
            print(f"  cleared {name}: {total} rows")

    def clear_all(self):
        print("Очистка коллекций…")
        for name in CLEAR_ORDER:
            self.clear_collection(name)

    def import_list_items(self, lists):
        for list_key, values in (lists or {}).items():
            if not isinstance(values, list):
                continue
            for i, value in enumerate(values):
                if value is None:
                    continue
                self.create("list_items", {
                    "list_key": list_key,
                    "value": str(value),
                    "sort_order": i,
                    "active": True,
                })

    def import_scoring_criteria(self, gas_scoring):
        gas_map = match_gas_scoring(gas_scoring)
        for i, crit in enumerate(SCORE_CRITERIA):
            key = crit["key"]
            gas_item = gas_map.get(key, {})
            rub = RUBRICS.get(key, {})
            self.create("scoring_criteria", {
                "criterion_key": key,
                "name": crit["name"],
                "weight": gas_item.get("weight", crit["weight"]),
                "col": gas_item.get("col", "—"),
                "owner": gas_item.get("owner", "—"),
                "question": crit["question"],
                "manual_only": crit["manual_only"],
                "rubric_s5": gas_item.get("s5") or rub.get("s5", ""),
                "rubric_s4": gas_item.get("s4") or rub.get("s4", ""),
                "rubric_s3": gas_item.get("s3") or rub.get("s3", ""),
                "rubric_s2": gas_item.get("s2") or rub.get("s2", ""),
                "rubric_s1": gas_item.get("s1") or rub.get("s1", ""),
                "rubric_s0": gas_item.get("s0") or rub.get("s0", ""),
                "sort_order": i,
            })

    def import_managers(self, managers):
        rows = managers or MANAGERS_DEFAULT
        for m in rows:
            self.create("managers", {
                "manager_id": m.get("id") or m.get("manager_id"),
                "name": m.get("name", ""),
                "sheet": m.get("sheet", ""),
                "active": True,
            })

    def import_pipeline_meta(self, state):
        pf = state.get("pipelineFocus") or {}
        self.create("pipeline_meta", {
            "slug": "main",
            "next_id": state.get("nextId") or 1,
            "data_epoch": 1,
            "saved_at": iso_date(state.get("_savedAt")),
            "saved_by": state.get("_savedBy") or "",
            "focus_title": pf.get("title", ""),
            "focus_goal": pf.get("goal", ""),
            "focus_risk": pf.get("risk", ""),
            "focus_next_step": pf.get("nextStep", ""),
        })

    def map_deal_row(self, d):
        pains = d.get("pains") or ""
        return {
            "deal_id": d["id"],
            "customer": d.get("customer") or "",
            "industry": d.get("industry") or "",
            "owner": d.get("owner") or "",
            "stage": d.get("stage") or "",
            "deal_type": d.get("dealType") or "",
            "amount": d.get("amount") or 0,
            "expected_budget": d.get("expectedBudget") or 0,
            "partner": d.get("partner") or "",
            "partner_discount": d.get("partnerDiscount") or 0,
            "client_discount": d.get("clientDiscount") or 0,
            "manual_prob": d.get("manualProb") or 0,
            "task_due": d.get("taskDue") or "",
            "budget_period": d.get("budgetPeriod") or "",
            "budget_status": d.get("budgetStatus") or "",
            "budget_planned_month": d.get("budgetPlannedMonth"),
            "budget_planned_year": d.get("budgetPlannedYear"),
            "pains": pains,
            "capabilities": d.get("capabilities") or "",
            "dml": d.get("dml") or "",
            "next_step_type": d.get("nextStepType") or "",
            "next_step_comment": d.get("nextStepComment") or "",
            "risk_type": d.get("riskType") or "",
            "risk_comment": d.get("riskComment") or "",
            "commit_status": d.get("commitStatus") or "",
            "last_update": d.get("lastUpdate") or "",
            "amo_id": d.get("amoId") or 0,
            "has_pains": bool(d.get("hasPains")) or bool(str(pains).strip()),
            "competitors": d.get("competitors") or "",
            "deal_updated_at": iso_date(d.get("updatedAt") or d.get("lastUpdate")),
        }

    def import_deal_children(self, pb_deal_id, d):
        deal_rel = pb_deal_id

        for rt in d.get("riskTypes") or []:
            if rt and rt != "none":
                self.create("deal_risks", {"deal": deal_rel, "risk_type": str(rt)})
        rt = d.get("riskType")
        if rt and rt != "none" and rt not in (d.get("riskTypes") or []):
            self.create("deal_risks", {"deal": deal_rel, "risk_type": str(rt)})

        scores = d.get("scores") or {}
        reasons = d.get("scoreReasons") or {}
        overridden = d.get("scoresOverridden") or {}
        for key, val in scores.items():
            self.create("deal_scores", {
                "deal": deal_rel,
                "criterion_key": key,
                "value": val if val is not None else 0,
                "reason": reasons.get(key, ""),
                "overridden": bool(overridden.get(key)),
            })

        for entry in d.get("scoreHistory") or []:
            hist = self.create("deal_score_history", {
                "deal": deal_rel,
                "recorded_at": entry.get("date") or "",
                "source": entry.get("source") or "",
            })
            hist_id = hist.get("id")
            if not hist_id:
                continue
            for key, val in (entry.get("scores") or {}).items():
                self.create("deal_score_history_items", {
                    "history": hist_id,
                    "criterion_key": key,
                    "value": val if val is not None else 0,
                })

        tr = d.get("techResearch") or {}
        self.create("deal_tech", {
            "deal": deal_rel,
            "seeking_other_label": tr.get("seekingOtherLabel") or "",
            "product_requirements_pct": tr.get("productRequirementsPct"),
            "pilot_requirements_pct": tr.get("pilotRequirementsPct"),
        })

        for i, seg in enumerate(tr.get("seekingSegments") or []):
            if seg:
                self.create("deal_seeking_segments", {
                    "deal": deal_rel, "segment_id": str(seg), "sort_order": i,
                })

        for i, task in enumerate(tr.get("projectTasks") or []):
            if task:
                self.create("deal_project_tasks", {
                    "deal": deal_rel, "task": str(task), "sort_order": i,
                })

        for seg_id, raw in (tr.get("asIsStack") or {}).items():
            a = norm_as_is(raw)
            if not a and not seg_id:
                continue
            self.create("deal_as_is", {
                "deal": deal_rel,
                "segment_id": str(seg_id),
                "vendor": a.get("vendor") or "",
                "product": a.get("product") or "",
                "catalog_key": a.get("catalogKey") or "",
                "comment": a.get("comment") or "",
                "custom": bool(a.get("custom")),
            })

        for seg_id, pain in (tr.get("changePains") or {}).items():
            if pain or seg_id:
                self.create("deal_change_pains", {
                    "deal": deal_rel,
                    "segment_id": str(seg_id),
                    "pain_text": str(pain or ""),
                })

        for seg_id, entries in (tr.get("competitorEntries") or {}).items():
            for i, e in enumerate(entries or []):
                if not e:
                    continue
                self.create("deal_competitors", {
                    "deal": deal_rel,
                    "segment_id": str(seg_id),
                    "vendor": e.get("vendor") or "",
                    "product": e.get("product") or "",
                    "catalog_key": e.get("catalogKey") or "",
                    "status": e.get("status") or "evaluating",
                    "reject_reason": e.get("rejectReason") or "",
                    "continue_reason": e.get("continueReason") or "",
                    "comment": e.get("comment") or "",
                    "sort_order": i,
                })

    def import_deals(self, deals):
        n = len(deals)
        for i, d in enumerate(deals):
            if not d.get("id"):
                continue
            rec = self.create("deals", self.map_deal_row(d))
            pb_id = rec.get("id")
            if pb_id:
                self.deal_pb_ids[d["id"]] = pb_id
                self.import_deal_children(pb_id, d)
            if self.apply and (i + 1) % 25 == 0:
                print(f"  deals {i + 1}/{n}…")

    def import_audit(self, rows):
        n = len(rows)
        for i, row in enumerate(rows):
            label = str(row[6] or "")
            new_val = row[8]
            is_new = label == "—" and str(new_val) == "Новая сделка"
            self.create("audit_log", {
                "at": str(row[0] or ""),
                "saved_by": str(row[1] or ""),
                "deal_id": str(row[2] or ""),
                "customer": str(row[3] or ""),
                "owner": str(row[4] or ""),
                "change_count": row[5] or 0,
                "label": label,
                "old_value": "" if row[7] is None else str(row[7]),
                "new_value": "" if new_val is None else str(new_val),
                "is_new_deal": is_new,
            })
            if self.apply and (i + 1) % 500 == 0:
                print(f"  audit {i + 1}/{n}…")

    def run(self, clear=False):
        t0 = time.time()
        print("Загрузка GAS…")
        state = gas_get(self.gas_url, "?action=get").get("state") or {}
        deals = state.get("deals") or []
        print(f"  deals: {len(deals)}, savedAt: {state.get('_savedAt')}")

        print("Загрузка аудита…")
        audit_rows = gas_get(self.gas_url, "?action=auditAll").get("rows") or []
        print(f"  audit rows: {len(audit_rows)}")

        try:
            managers = gas_get(self.gas_url, "?action=managers")
            if isinstance(managers, dict) and "error" in managers:
                managers = MANAGERS_DEFAULT
        except Exception:
            managers = MANAGERS_DEFAULT

        if clear:
            self.clear_all()

        log_id = None
        if self.apply:
            log = self.create("import_log", {
                "source": "staging-gas",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "status": "running",
            })
            log_id = log.get("id")

        print("Импорт справочников и мета…")
        self.import_list_items(state.get("lists"))
        self.import_scoring_criteria(state.get("scoring"))
        self.import_managers(managers)
        self.import_pipeline_meta(state)

        print("Импорт сделок…")
        self.import_deals(deals)

        print("Импорт аудита…")
        self.import_audit(audit_rows)

        if self.apply and log_id:
            http_json(
                f"{self.pb_url}/api/collections/import_log/records/{log_id}",
                {
                    "status": "completed",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "deals_count": len(deals),
                    "audit_count": len(audit_rows),
                    "meta_count": 1,
                    "notes": f"Imported in {time.time() - t0:.1f}s",
                },
                token=self.token,
                method="PATCH",
            )

        print(f"\nГотово за {time.time() - t0:.1f}s")
        for k in sorted(self.stats):
            print(f"  {k}: {self.stats[k]}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--clear", action="store_true", help="Очистить коллекции перед импортом")
    args = parser.parse_args()

    gas_url, pb_url, email, password = load_config()
    print(f"GAS: {gas_url[:60]}…")
    print(f"PB:  {pb_url}")

    if not args.apply:
        print("\n[dry-run] Добавьте --apply для записи. С --clear очистит коллекции.\n")

    auth = http_json(f"{pb_url}/api/admins/auth-with-password",
                     {"identity": email, "password": password})
    token = auth.get("token")
    if not token:
        raise SystemExit("PocketBase auth failed")

    Importer(gas_url, pb_url, token, apply=args.apply).run(clear=args.clear)


if __name__ == "__main__":
    main()
