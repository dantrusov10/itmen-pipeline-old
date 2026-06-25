#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сверка prod GAS ↔ PocketBase (itmen-pipeline.nwlvl.ru)."""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gas_env import gas_url, health, load_full_state  # noqa: E402

SAMPLE_IDS = ["D-001", "D-050", "D-122", "D-100", "D-200"]


def pb_admin_token():
    pb = os.environ.get("PB_URL", "http://127.0.0.1:8095")
    email = password = ""
    env_path = Path("/opt/itmen-pipeline/.env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                if k == "PB_ADMIN_EMAIL":
                    email = v
                elif k == "PB_ADMIN_PASSWORD":
                    password = v
    body = json.dumps({"identity": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{pb.rstrip('/')}/api/admins/auth-with-password",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())["token"], pb.rstrip("/")


def pb_counts(pb, token):
    def count(coll):
        req = urllib.request.Request(
            f"{pb}/api/collections/{coll}/records?perPage=1",
            headers={"Authorization": token},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode()).get("totalItems", 0)

    return {c: count(c) for c in [
        "deals", "audit_log", "deal_scores", "deal_tech", "pipeline_meta",
    ]}


def deal_snapshot(deal):
    if not deal:
        return None
    tr = deal.get("techResearch") or {}
    scores = deal.get("scores") or {}
    comp = tr.get("competitorEntries") or {}
    return {
        "id": deal.get("id"),
        "customer": (deal.get("customer") or "")[:40],
        "owner": deal.get("owner"),
        "commitStatus": deal.get("commitStatus"),
        "pains_len": len(str(deal.get("pains") or "")),
        "score_sum": sum(scores.get(k) or 0 for k in scores),
        "competitors": sum(len(v or []) for v in comp.values()) if isinstance(comp, dict) else 0,
    }


def main():
    prod_url = gas_url("production")
    print("=== PROD GAS health ===")
    h = health(prod_url)
    print(json.dumps(h, ensure_ascii=False, indent=2))

    print("\n=== PROD GAS state ===")
    gas_state = load_full_state(prod_url)
    gas_deals = {d["id"]: d for d in gas_state.get("deals") or [] if d.get("id")}
    print(f"deals: {len(gas_deals)}, savedAt: {gas_state.get('_savedAt')}, nextId: {gas_state.get('nextId')}")

    token, pb = pb_admin_token()
    print("\n=== PocketBase counts ===")
    counts = pb_counts(pb, token)
    for k, v in counts.items():
        print(f"  {k}: {v}")

    print("\n=== Выборочная сверка GAS vs PB ===")
    req = urllib.request.Request(
        f"{pb}/api/collections/deals/records?perPage=500",
        headers={"Authorization": token},
    )
    pb_rows = []
    page = 1
    while True:
        req = urllib.request.Request(
            f"{pb}/api/collections/deals/records?page={page}&perPage=500",
            headers={"Authorization": token},
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode())
        pb_rows.extend(data.get("items", []))
        if page >= data.get("totalPages", 1):
            break
        page += 1
    pb_by_id = {r["deal_id"]: r for r in pb_rows}

    mismatches = 0
    for deal_id in SAMPLE_IDS:
        g = gas_deals.get(deal_id)
        p = pb_by_id.get(deal_id)
        if not g and not p:
            continue
        if not g or not p:
            mismatches += 1
            print(f"  MISSING {deal_id}: gas={bool(g)} pb={bool(p)}")
            continue
        fields = ("customer", "owner", "stage", "amount", "commit_status")
        diff = {f: (g.get(f if f != "commit_status" else "commitStatus"), p.get(f)) for f in fields}
        bad = {k: v for k, v in diff.items() if str(v[0] or "") != str(v[1] or "")}
        if bad:
            mismatches += 1
            print(f"  DIFF {deal_id}: {bad}")
        else:
            print(f"  OK   {deal_id}")

    ok = len(gas_deals) == len(pb_by_id) == counts["deals"] and mismatches == 0
    print(f"\nИтог: deals GAS={len(gas_deals)} PB={counts['deals']} audit GAS≈{h.get('auditRows')} PB={counts['audit_log']}")
    print("✓ Сверка пройдена" if ok else "⚠ Есть расхождения — см. выше")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
