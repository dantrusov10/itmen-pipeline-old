#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Импорт воронки AmoCRM → js/initial-data.js + опционально Google Sheets API."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent
XLSX_DEFAULT = Path(r"c:\Users\Данила\Downloads\amocrm_export_leads_2026-06-19 (2).xlsx")
INITIAL_JS = ROOT / "js" / "initial-data.js"
GAS_CONFIG = ROOT / "js" / "gas-config.js"

STAGES = [
    "Взят в работу", "Встреча состоялась", "Интерес  Выявлен", "Подготовка Пилота",
    "Пилот", "Пилот Окончен", "Предложение выслано", "Согласование бюджета",
    "Финальный компред", "Условия согласованы", "Документы подписаны",
    "Отгружен", "Успешно реализовано", "На паузе",
]

OWNERS = ["Аркадий Мерлейн", "Арслан Ахметшин", "Александр Сироткин", "Алексей Кулагин"]

STAGE_NEXT = {
    "Взят в работу": "intro",
    "Встреча состоялась": "discovery",
    "Интерес  Выявлен": "discovery",
    "Подготовка Пилота": "pilot_prep",
    "Пилот": "pilot",
    "Пилот Окончен": "proposal",
    "Предложение выслано": "proposal",
    "Согласование бюджета": "budget",
    "Финальный компред": "terms",
    "Условия согласованы": "contract",
    "Документы подписаны": "contract",
    "Отгружен": "contract",
    "Успешно реализовано": "contract",
    "На паузе": "pause",
}

PRODUCT_SEG_MAP = [
    (r"discovery|инвент|обнаруж", "discovery"),
    (r"cmdb|модель данных|golden", "cmdb"),
    (r"itsm", "itsm"),
    (r"service desk|service_desk", "service_desk"),
    (r"\bsam\b|лиценз", "sam"),
    (r"itam|актив", "itam"),
    (r"монитор|observ", "monitoring"),
    (r"обогащ", "discovery"),
    (r"базов", "discovery"),
]

LATE = {"Предложение выслано", "Согласование бюджета", "Финальный компред", "Условия согласованы", "Документы подписаны", "Отгружен", "Успешно реализовано"}
PILOT = {"Подготовка Пилота", "Пилот", "Пилот Окончен"}
FINAL = {"Документы подписаны", "Отгружен", "Успешно реализовано"}
EARLY = {"Взят в работу", "Встреча состоялась", "Интерес  Выявлен"}


def clean(v):
    if v is None:
        return ""
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v).strip()


def parse_num(v):
    if v is None or v == "":
        return 0
    try:
        return float(v)
    except (TypeError, ValueError):
        s = re.sub(r"[^\d.,\-]", "", str(v)).replace(",", ".")
        try:
            return float(s) if s else 0
        except ValueError:
            return 0


def parse_date(v):
    if not v:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    s = clean(v)
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    if re.match(r"\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return ""


def parse_prob(v):
    n = parse_num(v)
    if n > 1:
        return round(min(1, n / 100), 2)
    return round(n, 2) if n else 0


def map_owner(name):
    name = clean(name)
    if name in OWNERS:
        return name
    for o in OWNERS:
        if name.split()[0] in o:
            return o
    return name or OWNERS[0]


def map_stage(stage):
    stage = clean(stage)
    if stage in STAGES:
        return stage
    for s in STAGES:
        if stage.lower() == s.lower():
            return s
    return stage or STAGES[0]


def map_partner(p, dist):
    p, dist = clean(p), clean(dist)
    val = p or dist or "Нет партнёра"
    if val.lower() in ("нет", "—", "-", "нет партнёра"):
        return "Нет партнёра"
    return val


def map_industry(v):
    v = clean(v)
    return v or "Не определена"


def budget_period_from_tags(tags):
    tags = clean(tags).upper()
    if "Q3" in tags:
        return "Q3 2026"
    if "Q4" in tags:
        return "Q4 2026"
    if "Q1" in tags:
        return "Q1 2027"
    if "Q2" in tags:
        return "Q2 2027"
    return "Не определён"


def infer_budget_status(stage, amount, expected):
    if stage in FINAL:
        return "Подтверждён"
    if stage in LATE or stage in PILOT:
        if amount or expected:
            return "В процессе согласования"
        return "Планируется согласование"
    if amount or expected:
        return "Неизвестно"
    return "Неизвестно"


def segments_from_product(text):
    text = clean(text).lower()
    if not text:
        return []
    found = []
    for pat, seg in PRODUCT_SEG_MAP:
        if re.search(pat, text, re.I) and seg not in found:
            found.append(seg)
    if not found and text:
        found.append("discovery")
    return found


def parse_competitors(text, seg):
    text = clean(text)
    if not text:
        return {}
    parts = re.split(r"[,;\n]+", text)
    entries = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        vendor = p.split("—")[0].split("-")[0].strip()
        entries.append({
            "vendor": vendor,
            "product": "",
            "catalogKey": "",
            "status": "evaluating",
            "rejectReason": "",
            "continueReason": "",
            "comment": "",
        })
    if not entries:
        return {}
    key = seg or "discovery"
    return {key: entries}


def build_tech_research(row, segs):
    seg = segs[0] if segs else "discovery"
    as_is = {}
    current = clean(row.get("Какие решение есть сейчас"))
    os_now = clean(row.get("Какая стоит сейчас ОС"))
    if current or os_now:
        as_is[seg] = {
            "vendor": current or os_now,
            "product": os_now if current and os_now else "",
            "custom": True,
        }

    pains = {}
    pain_text = clean(row.get("Боли клиента"))
    if pain_text:
        pains[seg] = pain_text

    tasks = []
    for field in ("Бизнес задачи", "Продукт ИТМен", "Продукт Сфера"):
        t = clean(row.get(field))
        if t:
            tasks.extend([x.strip() for x in re.split(r"[\n;]+", t) if x.strip()])

    pct = parse_num(row.get("Соответствие функицоналу"))
    product_pct = pct if pct else None
    pilot_pct = None

    return {
        "seekingSegments": segs,
        "asIsStack": as_is,
        "changePains": pains,
        "competitorEntries": parse_competitors(row.get("Конкуренты"), seg),
        "projectTasks": tasks[:20],
        "productRequirementsPct": product_pct,
        "pilotRequirementsPct": pilot_pct,
    }


def build_notes(row):
    parts = []
    contact = clean(row.get("Основной контакт"))
    if contact:
        parts.append(f"Контакт: {contact}")
    for f in ("Должность (контакт)", "Рабочий email (контакт)", "Рабочий телефон (контакт)", "Мобильный телефон (контакт)"):
        v = clean(row.get(f))
        if v:
            parts.append(f"{f.split(' (')[0]}: {v}")
    for f in ("Формат закупки", "Presale", "Канал продаж", "Канал привлечения", "Конечные точки", "Общий размер инфраструктуры"):
        v = clean(row.get(f))
        if v:
            parts.append(f"{f}: {v}")
    for i in range(1, 6):
        n = clean(row.get(f"Примечание {i}"))
        if n:
            parts.append(n)
    return "\n".join(parts)


def build_pains(row):
    parts = []
    for f in ("Боли клиента", "Бизнес задачи"):
        v = clean(row.get(f))
        if v:
            parts.append(v)
    return "\n\n".join(parts)


def suggest_scores(deal):
    scores = {k: 0 for k in ("loyalty", "commit", "budget", "fit", "timing", "competitive", "access", "technical", "commercial")}
    reasons = {"loyalty": "Оценивается только вручную — модель не подставляет"}
    stage = deal["stage"]
    scores["commit"] = 0
    reasons["commit"] = "Статус коммита: Нет подтверждения"

    if stage in FINAL:
        scores.update(timing=5, commercial=5)
        reasons["timing"] = "Сделка на финальном этапе воронки"
        reasons["commercial"] = "Документы / отгрузка / закрытие"
    elif stage in LATE:
        scores.update(timing=4, commercial=4)
        reasons["timing"] = "Стадия согласования условий или бюджета"
        reasons["commercial"] = "КП или компред в работе"
    elif stage in PILOT:
        scores.update(timing=3, commercial=2, fit=3)
        reasons["timing"] = "Пилот — решение ближе, но ещё не финал"
        reasons["fit"] = "Проверяем соответствие на пилоте"
    elif stage == "На паузе":
        scores["timing"] = 1
        reasons["timing"] = "Сделка на паузе"
    elif stage in EARLY:
        scores["timing"] = 2
        reasons["timing"] = "Ранняя стадия — сроки пока не определены"

    bs = deal["budgetStatus"]
    budget_map = {
        "Подтверждён": (5, "Бюджет подтверждён клиентом"),
        "В процессе согласования": (4, "Бюджет в процессе согласования"),
        "Планируется согласование": (3, "Согласование бюджета запланировано"),
        "Нет бюджета": (0, "Бюджет отсутствует"),
        "Неизвестно": (1, "Статус бюджета неизвестен"),
    }
    scores["budget"], reasons["budget"] = budget_map.get(bs, (1, "Статус бюджета неизвестен"))

    if deal.get("pains"):
        scores["fit"] = max(scores["fit"], 3)
        reasons["fit"] = "Боли клиента описаны"

    tr = deal.get("techResearch") or {}
    segs = tr.get("seekingSegments") or []
    if len(segs) >= 2:
        scores["fit"] = max(scores["fit"], 4)
        reasons["fit"] = (reasons.get("fit", "") + f" {len(segs)} сегментов в поиске").strip()

    comp = sum((tr.get("competitorEntries") or {}).values(), [])
    if comp:
        scores["competitive"] = 2
        reasons["competitive"] = "Конкуренты указаны — позиция под вопросом"
    elif stage in LATE or stage in FINAL:
        scores["competitive"] = 4
        reasons["competitive"] = "Продвинутый этап без явного конкурента"

    reasons["access"] = "Оценивается вручную — уточните доступ к ЛПР"
    reasons["technical"] = "Оценка по умолчанию — уточните при необходимости"
    return scores, reasons


def row_to_deal(row, idx):
    customer = clean(row.get("Компания")) or clean(row.get("Название сделки"))
    if not customer:
        return None

    stage = map_stage(row.get("Этап сделки"))
    budget = parse_num(row.get("Бюджет"))
    turnover = parse_num(row.get("Оборот сделки"))
    amount = budget or 0
    expected = turnover or 0

    segs = segments_from_product(row.get("Продукт ИТМен") or row.get("Продукт Сфера"))
    tr = build_tech_research(row, segs)
    pains = build_pains(row)
    notes = build_notes(row)
    owner = map_owner(row.get("Ответственный"))
    budget_status = infer_budget_status(stage, amount, expected)
    reg_date = parse_date(row.get("Регистрация до даты"))

    deal = {
        "id": f"D-{idx:03d}",
        "customer": customer,
        "industry": map_industry(row.get("Отрасль")),
        "owner": owner,
        "stage": stage,
        "dealType": "Текущий пайплайн",
        "amount": int(amount) if amount == int(amount) else amount,
        "expectedBudget": int(expected) if expected == int(expected) else expected,
        "partner": map_partner(row.get("Партнер"), row.get("Дистрибьютор")),
        "partnerDiscount": int(parse_num(row.get("Маржа партнера в %"))) if row.get("Маржа партнера в %") not in (None, "") else 0,
        "clientDiscount": int(parse_num(row.get("Процент скидки клиенту в %"))) if row.get("Процент скидки клиенту в %") not in (None, "") else 0,
        "manualProb": parse_prob(row.get("Шанс закрытия в %")),
        "taskDue": parse_date(row.get("Ближайшая задача")) or parse_date(row.get("Дата создания")) or datetime.now().strftime("%Y-%m-%d"),
        "budgetPeriod": budget_period_from_tags(row.get("Теги сделки")),
        "budgetStatus": budget_status,
        "budgetPlannedMonth": None,
        "budgetPlannedYear": None,
        "pains": pains,
        "capabilities": clean(row.get("Presale")),
        "dml": "Не определён",
        "nextStepType": STAGE_NEXT.get(stage, "discovery"),
        "nextStepComment": notes,
        "riskType": "none",
        "riskComment": "",
        "commitStatus": "none",
        "lastUpdate": parse_date(row.get("Дата изменения")) or parse_date(row.get("Дата создания")) or datetime.now().strftime("%Y-%m-%d"),
        "amoId": int(parse_num(row.get("ID"))) if row.get("ID") else None,
        "techResearch": tr,
    }

    if reg_date and budget_status == "Планируется согласование":
        try:
            d = datetime.strptime(reg_date, "%Y-%m-%d")
            deal["budgetPlannedMonth"] = d.month
            deal["budgetPlannedYear"] = d.year
        except ValueError:
            pass

    scores, reasons = suggest_scores(deal)
    deal["scores"] = scores
    deal["scoreReasons"] = reasons
    deal["scoreHistory"] = [{"date": deal["lastUpdate"], "source": "amocrm_import", "scores": dict(scores)}]
    deal["scoresOverridden"] = {}
    return deal


def load_existing_meta():
    text = INITIAL_JS.read_text(encoding="utf-8")
    m = re.search(r"window\.ITMEN_INITIAL\s*=\s*(\{[\s\S]*\});?\s*$", text)
    if not m:
        raise RuntimeError("Cannot parse initial-data.js")
    return json.loads(m.group(1))


def read_amocrm(path: Path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = [clean(h) for h in rows[0]]
    nh = len(headers)
    deals = []
    for i, r in enumerate(rows[1:], start=1):
        vals = list(r) + [None] * (nh - len(r))
        row = {headers[j]: vals[j] for j in range(nh) if headers[j]}
        deal = row_to_deal(row, i)
        if deal:
            deals.append(deal)
    wb.close()
    return deals


def merge_lists(meta, deals):
    lists = meta.get("lists", {})
    industries = set(lists.get("industries", []))
    partners = set(lists.get("partners", []))
    owners = set(lists.get("owners", []))
    stages = set(STAGES)

    for d in deals:
        industries.add(d["industry"])
        partners.add(d["partner"])
        if d["owner"]:
            owners.add(d["owner"])
        if d["stage"]:
            stages.add(d["stage"])

    lists["industries"] = sorted(industries, key=lambda x: (x == "Не определена", x))
    lists["partners"] = sorted(partners, key=lambda x: (x == "Нет партнёра", x))
    lists["owners"] = sorted(owners, key=lambda x: x)
    lists["stages"] = [s for s in STAGES if s in stages] + [s for s in sorted(stages) if s not in STAGES]
    meta["lists"] = lists
    return meta


def write_initial_data(meta, deals):
    meta["deals"] = deals
    meta["nextId"] = len(deals) + 1
    meta["pipelineFocus"] = {
        "title": "Воронка AmoCRM — импорт 19.06.2026",
        "goal": f"{len(deals)} сделок из экспорта AmoCRM, предзаполнены доступные поля",
        "risk": "Уточнить тех. исследование, коммиты и лояльность вручную",
        "nextStep": "Менеджеры дополняют карточки и сохраняют в Google Таблицу",
    }
    meta = merge_lists(meta, deals)
    body = json.dumps(meta, ensure_ascii=False, indent=2)
    INITIAL_JS.write_text(f"// Pipeline — imported from AmoCRM\nwindow.ITMEN_INITIAL = {body};\n", encoding="utf-8")


def push_to_gas(state):
    text = GAS_CONFIG.read_text(encoding="utf-8")
    m = re.search(r'url:\s*"([^"]+)"', text)
    if not m or "PASTE_YOUR" in m.group(1):
        print("GAS URL not configured — skip push")
        return
    url = m.group(1)
    try:
        import urllib.request
        payload = json.dumps({"action": "save", "state": state}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            print("GAS save:", resp.read().decode("utf-8")[:200])
    except Exception as e:
        print("GAS push failed:", e)


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else XLSX_DEFAULT
    if not xlsx.exists():
        print("File not found:", xlsx)
        sys.exit(1)

    deals = read_amocrm(xlsx)
    meta = load_existing_meta()
    write_initial_data(meta, deals)
    print(f"Written {len(deals)} deals -> {INITIAL_JS}")

    state = json.loads(re.search(r"window\.ITMEN_INITIAL\s*=\s*(\{[\s\S]*\});?\s*$", INITIAL_JS.read_text(encoding="utf-8")).group(1))
    push_to_gas(state)


if __name__ == "__main__":
    main()
