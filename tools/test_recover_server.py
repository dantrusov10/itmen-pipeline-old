import json, re, urllib.request
from pathlib import Path

url = re.search(r'url:\s*"([^"]+)"', (Path(__file__).resolve().parent.parent/"js"/"gas-config.js").read_text(encoding="utf-8")).group(1)
p = json.dumps({"action": "recoverFromAudit", "apply": False, "mode": "lost"}, ensure_ascii=False).encode()
req = urllib.request.Request(url, data=p, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
d = json.loads(urllib.request.urlopen(req, timeout=180).read().decode())
print("mode:", d.get("mode"), "plan:", len(d.get("plan") or []), "changes:", d.get("changes"))
for x in (d.get("plan") or [])[:20]:
    print(x)
