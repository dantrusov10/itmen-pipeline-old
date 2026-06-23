#!/usr/bin/env python3
"""Fix taskDue values corrupted by recovery; normalize to YYYY-MM-DD."""
import json, re, urllib.request
from datetime import datetime
from pathlib import Path

URL = re.search(r'url:\s*"([^"]+)"', (Path(__file__).resolve().parent.parent/"js"/"gas-config.js").read_text(encoding="utf-8")).group(1)

def norm_date(s):
    if not s:
        return ""
    s = str(s).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    if m:
        return m.group(1)
    for fmt in ("%a %b %d %Y %H:%M:%S GMT%z (%Z)", "%a %b %d %Y"):
        try:
            return datetime.strptime(s[:30], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    if re.match(r"^[A-Za-z]{3} [A-Za-z]{3} \d{2}$", s):
        try:
            return datetime.strptime(s + " 2026", "%a %b %d %Y").strftime("%Y-%m-%d")
        except ValueError:
            pass
    return s[:10] if len(s) >= 10 and s[4] == "-" else s

with urllib.request.urlopen(URL + "?action=get", timeout=120) as r:
    state = json.loads(r.read().decode())["state"]

fixed = 0
for d in state.get("deals", []):
    td = d.get("taskDue")
    if not td:
        continue
    n = norm_date(td)
    if n != td:
        d["taskDue"] = n
        d["updatedAt"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
        fixed += 1
        print(d["id"], td[:40], "->", n)

if not fixed:
    print("No taskDue fixes needed")
else:
    payload = json.dumps({"action": "save", "state": state, "forceFull": True}, ensure_ascii=False).encode()
    req = urllib.request.Request(URL, data=payload, headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    res = json.loads(urllib.request.urlopen(req, timeout=300).read().decode())
    print("Saved. fixed=", fixed, "auditRows=", res.get("auditRows"))
