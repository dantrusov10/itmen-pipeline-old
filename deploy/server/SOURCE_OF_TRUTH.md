# Источник истины — PocketBase

**С 25.06.2026 production-пайплайн ITMen живёт на:**

- **URL:** https://itmen-pipeline.nwlvl.ru/
- **БД:** PocketBase `/opt/itmen-pipeline/pb_data`
- **API:** Express `itmen-pipeline-api` → PocketBase

## Правила

1. **Единственный источник записи** — PocketBase через API (`PATCH /api/deals/:id`).
2. **Google Таблица prod** — архив, только чтение. Запись заблокирована (`MAINTENANCE_MODE`).
3. **GitHub Pages** (`dantrusov10.github.io/itmen-pipeline/`) — не использовать для работы менеджеров.
4. **Локальный кэш браузера** — только ускорение UI, не источник истины.

## Мета-версия

- `pipeline_meta.data_epoch` — инкремент при каждом сохранении сделки.
- `pipeline_meta.saved_at` — время последнего сохранения.

## Аудит

Все изменения полей сделок → коллекция `audit_log` в PocketBase.

## Снапшоты

- `snapshots_daily` / `snapshots_deals` — ежедневно 23:59 МСК (systemd timer).
- Используются для блока «Динамика» на дашборде.
