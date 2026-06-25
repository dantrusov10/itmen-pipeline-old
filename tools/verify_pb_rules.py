#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка правил PocketBase: публичное чтение, запись только admin."""
import json
import os
import urllib.request

PUBLIC_READ_OK = {"listRule", "viewRule"}
WRITE_MUST_BE_NULL = {"createRule", "updateRule", "deleteRule"}

COLLECTIONS = [
    "deals", "list_items", "scoring_criteria", "pipeline_meta", "managers",
    "deal_risks", "deal_scores", "deal_tech", "audit_log", "snapshots_daily",
]


def load_env():
    pb = os.environ.get("PB_URL", "http://127.0.0.1:8095")
    email = password = ""
    env_path = "/opt/itmen-pipeline/.env"
    if os.path.exists(env_path):
        for line in open(env_path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k == "PB_URL":
                pb = v
            elif k == "PB_ADMIN_EMAIL":
                email = v
            elif k == "PB_ADMIN_PASSWORD":
                password = v
    body = json.dumps({"identity": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{pb.rstrip('/')}/api/admins/auth-with-password",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        token = json.loads(r.read().decode())["token"]
    return pb.rstrip("/"), token


def main():
    pb, token = load_env()
    req = urllib.request.Request(
        f"{pb}/api/collections?perPage=200",
        headers={"Authorization": token},
    )
    with urllib.request.urlopen(req) as r:
        items = json.loads(r.read().decode()).get("items", [])

    issues = []
    for c in items:
        name = c.get("name")
        if name not in COLLECTIONS and not name.startswith("deal_"):
            continue
        for w in WRITE_MUST_BE_NULL:
            if c.get(w) not in (None, ""):
                issues.append(f"{name}.{w}={c.get(w)!r} (ожидалось null)")
        lr, vr = c.get("listRule"), c.get("viewRule")
        if name in ("audit_log", "snapshots_daily", "snapshots_deals", "import_log"):
            if lr is not None or vr is not None:
                issues.append(f"{name}: admin-only коллекция должна иметь listRule=null")
        elif lr != "" or vr != "":
            issues.append(f"{name}: listRule/viewRule должны быть '' (публичное чтение)")

    print("=== PB collection rules ===")
    for name in COLLECTIONS:
        c = next((x for x in items if x.get("name") == name), None)
        if not c:
            print(f"  {name}: MISSING")
            issues.append(f"{name} missing")
            continue
        print(f"  {name}: read=public write=admin-only OK")

    if issues:
        print("\n⚠ Проблемы:")
        for i in issues:
            print(f"  - {i}")
        return 1
    print("\n✓ Правила в порядке: чтение публичное, запись только через admin API")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
