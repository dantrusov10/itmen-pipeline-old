#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import re
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
url = re.search(
    r'url:\s*"([^"]+)"',
    (ROOT / "js" / "gas-config.js").read_text(encoding="utf-8"),
).group(1)


def fetch(q):
    with urllib.request.urlopen(url + q, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


def post(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


print("Fetching audit...")
audit = fetch("?action=auditAll")
rows = audit.get("rows") or []
print("Total audit rows:", len(rows))

# Group by timestamp (second precision)
by_second = defaultdict(list)
for row in rows:
    ts = str(row[0] or "")
    by_second[ts[:19]].append(row)

# Find bursts
bursts = sorted(((k, len(v)) for k, v in by_second.items()), key=lambda x: -x[1])[:15]
print("\nTop audit bursts by second:")
for ts, n in bursts:
    print(f"  {ts}  ->  {n} rows")

# Target time - user said 13:38:47 - could be MSK on 2026-06-24 or today
targets = [k for k in by_second if "13:38:47" in k or "10:38:47" in k]
print("\nMatching 13:38:47 or 10:38:47 UTC windows:")
for t in sorted(targets):
    batch = by_second[t]
    actors = Counter(str(r[1]) for r in batch)
    labels = Counter(str(r[6]) for r in batch)
    deals = set(str(r[2]) for r in batch)
    print(f"\n=== {t} ({len(batch)} rows) ===")
    print("  actors:", dict(actors))
    print("  unique deals:", len(deals))
    print("  top labels:", labels.most_common(8))
    for row in batch[:5]:
        print("   sample:", row[0], row[1], row[2], row[3][:30] if row[3] else "", row[6], "->", str(row[8])[:40])

# State now
lite = fetch("?action=getLite")
deals = lite.get("state", {}).get("deals", [])
print(f"\nCurrent server: {len(deals)} deals, savedAt={lite.get('state',{}).get('_savedAt')}")

health = fetch("?action=health")
print("Health:", health)
