#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/itmen-pipeline"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${ROOT}/backups/pb_data_${STAMP}.tar.gz"

mkdir -p "${ROOT}/backups"

# PocketBase built-in snapshot (если доступен)
if curl -sf "http://127.0.0.1:8095/api/health" >/dev/null; then
  curl -sf -X POST "http://127.0.0.1:8095/api/backups" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"auto_${STAMP}\"}" >/dev/null 2>&1 || true
fi

tar -czf "${OUT}" -C "${ROOT}" pb_data pb_migrations
echo "Backup: ${OUT}"
ls -lh "${OUT}"

# хранить последние 14 архивов
ls -1t "${ROOT}"/backups/pb_data_*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
