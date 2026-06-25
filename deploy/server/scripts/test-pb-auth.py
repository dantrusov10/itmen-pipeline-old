#!/usr/bin/env python3
import json
import os
import urllib.request

env_path = "/opt/itmen-pipeline/.env"
for line in open(env_path, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ.setdefault(k, v)

body = json.dumps({
    "identity": os.environ["PB_ADMIN_EMAIL"],
    "password": os.environ["PB_ADMIN_PASSWORD"],
}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:8095/api/admins/auth-with-password",
    data=body,
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req) as r:
        data = json.loads(r.read().decode())
        token = data.get("token", "")[:20]
        print("auth ok, token prefix:", token)
except urllib.error.HTTPError as e:
    print("auth fail", e.code, e.read().decode())
