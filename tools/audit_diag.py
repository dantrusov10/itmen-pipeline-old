import json, re, urllib.request
from pathlib import Path
from collections import defaultdict

URL = re.search(r'url:\s*"([^"]+)"', (Path(__file__).resolve().parent.parent/"js"/"gas-config.js").read_text(encoding="utf-8")).group(1)

def fetch(p):
    with urllib.request.urlopen(URL+p, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))

state = fetch("?action=get")["state"]
try:
    rows = fetch("?action=auditAll").get("rows", [])
    print("auditAll rows:", len(rows))
except Exception as e:
    rows = fetch("?action=audit&limit=500").get("rows", [])
    print("audit limit rows:", len(rows), e)

deals = {d["id"]: d for d in state["deals"]}
tl = defaultdict(list)
for r in rows:
    tl[(r[2], r[6])].append((str(r[0])[:19], str(r[8])[:60]))

for deal_id in ["D-196", "D-206", "D-185", "D-164", "D-019", "D-026"]:
    print(f"\n=== {deal_id} {deals.get(deal_id,{}).get('customer','?')[:30]} ===")
    print(f"  pains len={len(deals.get(deal_id,{}).get('pains') or '')} budget={deals.get(deal_id,{}).get('budgetStatus')}")
    for (d,l), evs in sorted(tl.items()):
        if d != deal_id: continue
        print(f"  {l}: {len(evs)} changes")
        for t,v in evs[-3:]:
            print(f"    {t} -> {v!r}")
