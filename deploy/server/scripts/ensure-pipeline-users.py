#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Создать коллекцию pipeline_users (auth) и учётки менеджеров + админа.

  python3 ensure-pipeline-users.py              # dry-run
  python3 ensure-pipeline-users.py --apply
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import urllib.error
import urllib.request

MANAGERS = [
    {"manager_id": "merlein", "email": "merlein@itmen-pipeline.local", "name": "Аркадий Мерлейн"},
    {"manager_id": "akhmetshin", "email": "akhmetshin@itmen-pipeline.local", "name": "Арслан Ахметшин"},
    {"manager_id": "sirotkin", "email": "sirotkin@itmen-pipeline.local", "name": "Александр Сироткин"},
    {"manager_id": "kulagin", "email": "kulagin@itmen-pipeline.local", "name": "Алексей Кулагин"},
]

ADMIN = {
    "email": "admin@itmen-pipeline.local",
    "name": "Администратор",
    "role": "admin",
    "manager_name": "",
}


def fid(name):
    return hashlib.md5(f"itmen.{name}".encode()).hexdigest()[:15]


def cid(name):
    return "itm" + hashlib.md5(f"itmen.coll.{name}".encode()).hexdigest()[:12]


def load_env():
    email = os.environ.get("PB_ADMIN_EMAIL", "")
    password = os.environ.get("PB_ADMIN_PASSWORD", "")
    pb = os.environ.get("PB_URL", "http://127.0.0.1:8095")
    path = "/opt/itmen-pipeline/.env"
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k == "PB_ADMIN_EMAIL" and not email:
                email = v
            elif k == "PB_ADMIN_PASSWORD" and not password:
                password = v
            elif k == "PB_URL" and not pb:
                pb = v
    return pb.rstrip("/"), email, password


def http_json(url, data=None, token=None, method=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = token
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def admin_token(pb, email, password):
    auth = http_json(f"{pb}/api/admins/auth-with-password",
                     {"identity": email, "password": password})
    token = auth.get("token")
    if not token:
        raise SystemExit("PocketBase admin auth failed")
    return token


def collection_exists(pb, token, name):
    data = http_json(f"{pb}/api/collections?page=1&perPage=200", token=token)
    return any(c.get("name") == name for c in data.get("items", []))


def create_auth_collection(pb, token):
    body = {
        "id": cid("pipeline_users"),
        "name": "pipeline_users",
        "type": "auth",
        "system": False,
        "schema": [
            {
                "system": False,
                "id": fid("role"),
                "name": "role",
                "type": "text",
                "required": True,
                "presentable": False,
                "unique": False,
                "options": {"min": None, "max": 20, "pattern": ""},
            },
            {
                "system": False,
                "id": fid("manager_name"),
                "name": "manager_name",
                "type": "text",
                "required": False,
                "presentable": True,
                "unique": False,
                "options": {"min": None, "max": 120, "pattern": ""},
            },
            {
                "system": False,
                "id": fid("display_name"),
                "name": "display_name",
                "type": "text",
                "required": False,
                "presentable": True,
                "unique": False,
                "options": {"min": None, "max": 120, "pattern": ""},
            },
        ],
        "indexes": [],
        "listRule": "id = @request.auth.id",
        "viewRule": "id = @request.auth.id",
        "createRule": None,
        "updateRule": "id = @request.auth.id",
        "deleteRule": None,
        "options": {
            "allowEmailAuth": True,
            "allowOAuth2Auth": False,
            "allowUsernameAuth": False,
            "exceptEmailDomains": [],
            "manageRule": None,
            "minPasswordLength": 8,
            "onlyEmailDomains": [],
            "requireEmail": True,
        },
    }
    return http_json(f"{pb}/api/collections", body, token=token, method="POST")


def list_users(pb, token):
    try:
        data = http_json(
            f"{pb}/api/collections/pipeline_users/records?perPage=200",
            token=token,
        )
        return {u.get("email"): u for u in data.get("items", [])}
    except urllib.error.HTTPError:
        return {}


def create_user(pb, token, email, password, role, manager_name, display_name):
    return http_json(
        f"{pb}/api/collections/pipeline_users/records",
        {
            "email": email,
            "emailVisibility": True,
            "password": password,
            "passwordConfirm": password,
            "role": role,
            "manager_name": manager_name,
            "display_name": display_name,
        },
        token=token,
        method="POST",
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    pb, email, password = load_env()
    token = admin_token(pb, email, password)

    if not collection_exists(pb, token, "pipeline_users"):
        print("Создать коллекцию pipeline_users…")
        if args.apply:
            create_auth_collection(pb, token)
            print("  OK")
        else:
            print("  [dry-run]")
    else:
        print("Коллекция pipeline_users уже есть")

    existing = list_users(pb, token) if args.apply or collection_exists(pb, token, "pipeline_users") else {}
    creds_path = "/opt/itmen-pipeline/.pipeline-users.env"
    cred_lines = []
    default_pass = os.environ.get("PIPELINE_DEFAULT_PASSWORD") or secrets.token_urlsafe(12)
    admin_pass = os.environ.get("PIPELINE_ADMIN_PASSWORD") or secrets.token_urlsafe(14)

    users = [{"email": ADMIN["email"], "role": "admin", "manager_name": "", "display_name": ADMIN["name"], "password": admin_pass}]
    for m in MANAGERS:
        users.append({
            "email": m["email"],
            "role": "manager",
            "manager_name": m["name"],
            "display_name": m["name"],
            "password": default_pass,
        })

    for u in users:
        if u["email"] in existing:
            print(f"  skip {u['email']} (exists)")
            continue
        print(f"  create {u['email']} ({u['role']})")
        if args.apply:
            create_user(pb, token, u["email"], u["password"], u["role"], u["manager_name"], u["display_name"])
        cred_lines.append(f"{u['email']}={u['password']}")

    if args.apply and cred_lines:
        with open(creds_path, "w", encoding="utf-8") as f:
            f.write("# Пароли pipeline_users (созданы ensure-pipeline-users.py)\n")
            f.write("\n".join(cred_lines) + "\n")
        os.chmod(creds_path, 0o600)
        print(f"Пароли записаны в {creds_path}")

    if not args.apply:
        print("\n[dry-run] Добавьте --apply для создания")


if __name__ == "__main__":
    main()
