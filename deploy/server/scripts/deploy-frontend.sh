#!/usr/bin/env bash
# Деплой фронта на https://itmen-pipeline.nwlvl.ru/
set -euo pipefail

ROOT="/opt/itmen-pipeline"
REPO="${ITMEN_REPO:-https://github.com/dantrusov10/itmen-pipeline.git}"
BRANCH="${ITMEN_BRANCH:-master}"
TMP="$(mktemp -d)"

echo "==> Clone ${REPO} (${BRANCH})"
git clone --depth 1 --branch "${BRANCH}" "${REPO}" "${TMP}/src"

echo "==> Server gas-config"
cp "${ROOT}/infra/frontend/gas-config.js" "${TMP}/src/js/gas-config.js"

echo "==> Install to ${ROOT}/frontend/current"
rm -rf "${ROOT}/frontend/current"
mkdir -p "${ROOT}/frontend"
chmod 755 "${ROOT}/frontend"
mv "${TMP}/src" "${ROOT}/frontend/current"
chmod -R a+rX "${ROOT}/frontend/current"
rm -rf "${TMP}"

if [[ -f "${ROOT}/frontend/current/ITMen_Pipeline_Шаблон_менеджеров.xlsx" ]]; then
  echo "Excel template OK"
fi

nginx -t
systemctl reload nginx
echo "==> Frontend deployed: https://itmen-pipeline.nwlvl.ru/"
