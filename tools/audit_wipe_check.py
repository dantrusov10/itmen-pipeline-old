#!/usr/bin/env python3
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
url = re.search(
    r'url:\s*"([^"]+)"',
    (ROOT / "js" / "gas-config.js").read_text(encoding="utf-8"),
).group(1)


def fetch(q):
    with urllib.request.urlopen(url + q, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def post(payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8"))


lite = fetch("?action=getLite")
deals = lite.get("state", {}).get("deals", [])
print("Total deals:", len(deals))
print("savedAt:", lite.get("state", {}).get("_savedAt"))

needles = ["минцифр", "башнефт", "метрополитен", "ашнеф"]
print("\nMatching customers:")
for d in deals:
    c = (d.get("customer") or "").lower()
    if any(n in c for n in needles):
        print(" ", d.get("id"), "|", d.get("customer"))

# audit tail - look for mass wipe
audit = fetch("?action=audit&limit=200")
rows = audit.get("rows") or []
print("\nRecent audit entries:", len(rows))
# group by timestamp minute
from collections import Counter
actors = Counter()
for row in rows[-50:]:
    actors[row[1]] += 1
print("Actors in last 50 audit rows:", dict(actors))

# unique deal ids in last 200 audit rows
deal_ids = set(str(r[2]) for r in rows if r[2])
print("Unique deal ids in last 200 audit rows:", len(deal_ids))

# check recover preview for missing deals from audit
try:
    prev = post({"action": "recoverFromAudit", "apply": False, "mode": "full"})
except Exception as e:
    prev = post({"action": "recoverFromAudit", "apply": False, "mode": "lost"})
print("\nRecover preview mode:", prev.get("mode"), "patches:", prev.get("patches"), "changes:", prev.get("changes"))
