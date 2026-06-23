import json, re, urllib.request
from pathlib import Path

url = re.search(r'url:\s*"([^"]+)"', (Path(__file__).resolve().parent.parent/"js"/"gas-config.js").read_text(encoding="utf-8")).group(1)
state = json.loads(urllib.request.urlopen(url+"?action=get", timeout=120).read())["state"]
for deal_id in ["D-196", "D-206", "D-185", "D-164", "D-019"]:
    d = next((x for x in state["deals"] if x["id"]==deal_id), {})
    print(deal_id, d.get("customer","")[:25], "pains", len(d.get("pains") or ""), "budget", d.get("budgetStatus"), "taskDue", d.get("taskDue"))
print("savedAt", state.get("_savedAt"))
