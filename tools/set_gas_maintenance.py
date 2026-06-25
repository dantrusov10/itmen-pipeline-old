#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Включить/выключить maintenance на prod GAS (блокировка save)."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gas_env import gas_url, post  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--on", action="store_true", help="Включить maintenance")
    g.add_argument("--off", action="store_true", help="Выключить maintenance")
    args = p.parse_args()

    url = gas_url("production")
    res = post(url, {"action": "setMaintenance", "on": bool(args.on)})
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
