#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Сверка количества записей в PocketBase после импорта."""
import json
import os
import urllib.request

PB = os.environ.get("PB_URL", "http://127.0.0.1:8095")
COLLECTIONS = [
    "deals", "list_items", "scoring_criteria", "pipeline_meta", "managers",
    "deal_risks", "deal_scores", "deal_score_history", "deal_score_history_items",
    "deal_tech", "deal_seeking_segments", "deal_project_tasks", "deal_as_is",
    "deal_change_pains", "deal_competitors", "audit_log",
]


def load_creds():
    email, password = "", ""
    p = "/opt/itmen-pipeline/.env"
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            if line.startswith("PB_ADMIN_EMAIL="):
                email = line.split("=", 1)[1].strip()
            elif line.startswith("PB_ADMIN_PASSWORD="):
                password = line.split("=", 1)[1].strip()
    return email, password


def main():
    email, password = load_creds()
    auth = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"{PB.rstrip('/')}/api/admins/auth-with-password",
        json.dumps({"identity": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )).read())
    token = auth["token"]
    print("=== PocketBase counts ===")
    for name in COLLECTIONS:
        data = json.loads(urllib.request.urlopen(urllib.request.Request(
            f"{PB.rstrip('/')}/api/collections/{name}/records?perPage=1",
            headers={"Authorization": token},
        )).read())
        print(f"  {name:30} {data.get('totalItems', 0)}")


if __name__ == "__main__":
    main()
