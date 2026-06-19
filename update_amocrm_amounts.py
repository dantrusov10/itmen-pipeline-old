#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Обновить amount и expectedBudget в GAS по выгрузке AmoCRM."""

import json
import re
import sys
import urllib.request
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent
XLSX_DEFAULT = Path(r"c:\Users\Данила\Downloads\amocrm_export_leads_2026-06-19 (2).xlsx")


def gas_url():
    cfg = (ROOT / "js" / "gas-config.js").read_text(encoding="utf-8")
    return re.search(r'url:\s*"([^"]+)"', cfg).group(1)


def parse_num(v):
    if v is None or v == "":
        return 0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def to_int_amount(n):
    return int(n) if n == int(n) else n


def load_amocrm_map(xlsx: Path):
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(h).strip() if h else "" for h in rows[0]]
    mapping = {}
    for r in rows[1:]:
        row = dict(zip(headers, list(r) + [None] * (len(headers) - len(r))))
        amo_id = parse_num(row.get("ID"))
        if not amo_id:
            continue
        mapping[int(amo_id)] = {
            "amount": to_int_amount(parse_num(row.get("Бюджет")) or 0),
            "expectedBudget": to_int_amount(parse_num(row.get("Оборот сделки")) or 0),
        }
    wb.close()
    return mapping


def fetch_state(url):
    with urllib.request.urlopen(f"{url}?action=get", timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))["state"]


def push_state(url, state):
    payload = json.dumps({"action": "save", "state": state}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read().decode("utf-8")


def main():
    xlsx = Path(sys.argv[1]) if len(sys.argv) > 1 else XLSX_DEFAULT
    if not xlsx.exists():
        print("File not found:", xlsx)
        sys.exit(1)

    amo_map = load_amocrm_map(xlsx)
    url = gas_url()
    state = fetch_state(url)
    updated = 0
    missing = 0

    for deal in state.get("deals", []):
        amo_id = deal.get("amoId")
        if not amo_id or amo_id not in amo_map:
            missing += 1
            continue
        vals = amo_map[amo_id]
        deal["amount"] = vals["amount"]
        deal["expectedBudget"] = vals["expectedBudget"]
        deal["budgetAmount"] = vals["expectedBudget"]
        updated += 1

    print(push_state(url, state))
    print(f"Updated {updated} deals, {missing} without amoId match in export")


if __name__ == "__main__":
    main()
