#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Очистить расширенные поля во всех сделках и сохранить в Google Таблицу."""

import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def gas_url():
    cfg = (ROOT / "js" / "gas-config.js").read_text(encoding="utf-8")
    return re.search(r'url:\s*"([^"]+)"', cfg).group(1)


def fetch_state(url):
    with urllib.request.urlopen(f"{url}?action=get", timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data["state"]


def empty_tech():
    return {
        "seekingSegments": [],
        "asIsStack": {},
        "changePains": {},
        "competitorEntries": {},
        "projectTasks": [],
        "productRequirementsPct": None,
        "pilotRequirementsPct": None,
    }


def clear_deal(d):
    d = dict(d)
    d["budgetPeriod"] = "Не определён"
    d["budgetStatus"] = "Неизвестно"
    d["budgetPlannedMonth"] = None
    d["budgetPlannedYear"] = None
    d["budgetAmount"] = 0
    d["expectedBudget"] = 0
    d["commitStatus"] = "none"
    d["pains"] = ""
    d["nextStepType"] = "discovery"
    d["nextStepComment"] = ""
    d["riskType"] = "none"
    d["riskComment"] = ""
    d["techResearch"] = empty_tech()
    scores = dict(d.get("scores") or {})
    scores["commit"] = 0
    scores["budget"] = 1
    scores["technical"] = 0
    scores["fit"] = 0
    scores["competitive"] = 0
    d["scores"] = scores
    reasons = dict(d.get("scoreReasons") or {})
    reasons.update({
        "commit": "Статус коммита: Нет подтверждения",
        "budget": "Статус бюджета неизвестен",
        "technical": "Не заполнено",
        "fit": "Не заполнено",
        "competitive": "Не заполнено",
    })
    d["scoreReasons"] = reasons
    return d


def push_state(url, state):
    payload = json.dumps({"action": "save", "state": state}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("utf-8")


def main():
    url = gas_url()
    state = fetch_state(url)
    state["deals"] = [clear_deal(d) for d in state.get("deals", [])]
    print(push_state(url, state))
    print(f"Cleared extended fields in {len(state['deals'])} deals")


if __name__ == "__main__":
    main()
