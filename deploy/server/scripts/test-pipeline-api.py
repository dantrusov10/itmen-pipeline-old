#!/usr/bin/env python3
import json
import urllib.request

for url in [
    "http://127.0.0.1:3010/api/pipeline?lite=1",
    "https://itmen-pipeline.nwlvl.ru/api/pipeline?lite=1",
]:
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.loads(r.read().decode())
        s = d.get("state", {})
        print(url, "-> deals", len(s.get("deals", [])), "epoch", s.get("_dataEpoch"))
    except Exception as e:
        print(url, "-> FAIL", e)
