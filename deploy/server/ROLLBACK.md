# План отката ITMen Pipeline

## Когда откатывать

- Массовая порча данных после деплоя API/фронта
- Неработающий вход / сохранение для всех менеджеров
- Критический баг в Express или схеме PB

## 1. Откат фронта (быстро, ~1 мин)

```bash
# если есть предыдущая копия в git на сервере
cd /opt/itmen-pipeline/frontend
ls -la
# redeploy предыдущего коммита:
ITMEN_BRANCH=<prev-sha> /opt/itmen-pipeline/scripts/deploy-frontend.sh
```

Или вручную восстановить `frontend/current` из бэкапа tar.

## 2. Откат API

```bash
# восстановить src из git/бэкапа
systemctl restart itmen-pipeline-api
systemctl status itmen-pipeline-api
curl -s http://127.0.0.1:3010/api/health
```

## 3. Откат PocketBase (данные)

**Остановить запись:**

```bash
systemctl stop itmen-pipeline-api
```

**Восстановить из бэкапа:**

```bash
systemctl stop pb-itmen-pipeline
cd /opt/itmen-pipeline
mv pb_data pb_data.broken.$(date +%Y%m%d_%H%M%S)
tar -xzf backups/pb_data_YYYYMMDD_HHMMSS.tar.gz
systemctl start pb-itmen-pipeline
sleep 3
systemctl start itmen-pipeline-api
python3 scripts/verify-pb-import.py
```

## 4. Временный возврат на GAS (крайний случай)

1. `python3 tools/set_gas_maintenance.py --off`
2. В `infra/frontend/gas-config.js` установить `usePocketBase: false`
3. `deploy-frontend.sh`
4. Менеджеры работают через Google Таблицу снова

⚠️ После отката на GAS нужна **повторная синхронизация** изменений из PB, сделанных за период инцидента.

## 5. Проверка после отката

```bash
python3 scripts/verify-pb-import.py
python3 tools/verify_prod_vs_pb.py
curl -s http://127.0.0.1:3010/api/health
```

В браузере: Ctrl+F5 → вход → открыть паспорт → сохранить тестовое поле → проверить `audit_log`.

## Контакты и файлы

- Бэкапы: `/opt/itmen-pipeline/backups/`
- Логи API: `journalctl -u itmen-pipeline-api`
- Логи PB: `journalctl -u pb-itmen-pipeline`
- Пароли пользователей: `/opt/itmen-pipeline/.pipeline-users.env`
