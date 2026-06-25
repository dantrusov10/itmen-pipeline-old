#!/usr/bin/env python3
import json
import urllib.error
import urllib.request

def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

password = None
for line in open("/opt/itmen-pipeline/.pipeline-users.env"):
    if line.startswith("admin@"):
        password = line.strip().split("=", 1)[1]
        break

login = post("http://127.0.0.1:3010/api/auth/login", {
    "email": "admin@itmen-pipeline.local",
    "password": password,
})
token = login["token"]
print("login ok", login["user"])

for hdr in [token, f"Bearer {token}"]:
    req = urllib.request.Request(
        "http://127.0.0.1:3010/api/pipeline?lite=1",
        headers={"Authorization": hdr},
    )
    try:
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read().decode())
        print("pipeline ok with hdr prefix", hdr[:12], "deals", len(data["state"]["deals"]))
        break
    except urllib.error.HTTPError as e:
        print("pipeline fail", hdr[:12], e.code, e.read().decode()[:120])
