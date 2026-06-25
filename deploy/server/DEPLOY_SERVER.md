# Деплой ITMen Pipeline на сервер

Сервер: `newlevel-prod` → `/opt/itmen-pipeline`  
Публичный URL: https://itmen-pipeline.nwlvl.ru/

## Архитектура

```
Браузер → nginx (443)
           ├── /              → frontend/current (git)
           ├── /api/pipeline  → Express :3010 → PocketBase :8095
           ├── /api/auth/*    → Express
           ├── /api/deals/*   → Express
           ├── /api/dynamics  → Express
           └── /api/*         → PocketBase (read-only collections)
```

PocketBase Admin (`/_/`) **закрыт снаружи**. Доступ:

```bash
ssh -L 8095:127.0.0.1:8095 newlevel-prod
# открыть http://127.0.0.1:8095/_/
```

## Первичная установка

```bash
cd /opt/itmen-pipeline
bash scripts/setup.sh
python3 scripts/import-collections.py   # или recreate-collections.py
python3 scripts/import-gas-to-pb.py --apply --clear
python3 scripts/ensure-pipeline-users.py --apply
cd api && npm install --omit=dev
systemctl enable --now pb-itmen-pipeline itmen-pipeline-api
systemctl enable --now itmen-pipeline-backup.timer itmen-pipeline-snapshot.timer
```

## Деплой фронта

```bash
/opt/itmen-pipeline/scripts/deploy-frontend.sh
```

По умолчанию клонирует **prod** репозиторий `itmen-pipeline` (ветка `master`).  
Переопределение:

```bash
ITMEN_REPO=https://github.com/dantrusov10/itmen-pipeline-staging.git ITMEN_BRANCH=master \
  /opt/itmen-pipeline/scripts/deploy-frontend.sh
```

`gas-config.js` берётся с сервера: `infra/frontend/gas-config.js`.

## Деплой API

```bash
# с локальной машины
scp -r deploy/server/api/src newlevel-prod:/opt/itmen-pipeline/api/
ssh newlevel-prod "systemctl restart itmen-pipeline-api"
```

## Пользователи

```bash
python3 scripts/ensure-pipeline-users.py --apply
cat /opt/itmen-pipeline/.pipeline-users.env   # пароли (chmod 600)
```

## Логи API

```bash
journalctl -u itmen-pipeline-api -f
journalctl -u itmen-pipeline-api --since today
```

Формат: `ISO timestamp METHOD url status ms user=email`

## Бэкапы

```bash
/opt/itmen-pipeline/scripts/backup.sh
systemctl list-timers | grep itmen-pipeline
```

Архивы: `/opt/itmen-pipeline/backups/pb_data_*.tar.gz` (хранятся 14 шт.)

## Снапшоты динамики

```bash
node /opt/itmen-pipeline/scripts/run-daily-snapshot.js   # вручную
systemctl list-timers | grep snapshot
```

Автозапуск: ежедневно 23:59 МСК.

## Сверка данных

```bash
python3 tools/verify_prod_vs_pb.py      # prod GAS ↔ PB
python3 scripts/verify-pb-import.py     # counts в PB
python3 tools/verify_pb_rules.py        # правила коллекций
```

## GAS prod — maintenance

```bash
python3 tools/set_gas_maintenance.py --on    # блок записи
python3 tools/set_gas_maintenance.py --off   # снять (не делать после go-live)
```

## Переменные окружения

Файл `/opt/itmen-pipeline/.env`:

- `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`
- `PB_URL=http://127.0.0.1:8095`
- `API_PORT=3010`

См. также: [SOURCE_OF_TRUTH.md](SOURCE_OF_TRUTH.md), [ROLLBACK.md](ROLLBACK.md)
