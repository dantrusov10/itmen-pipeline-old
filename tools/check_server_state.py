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
print("URL:", url)
print("Deals on server:", len(deals))
for d in deals:
    print(" ", d.get("id"), "|", d.get("customer", "")[:60], "|", d.get("owner", ""))

health = fetch("?action=health")
print("\nHealth:", json.dumps(health, ensure_ascii=False, indent=2))

audit = fetch("?action=audit&limit=5")
rows = audit.get("rows") or []
print("\nLast audit rows:", len(rows))
for row in rows[-5:]:
    print(" ", row)
