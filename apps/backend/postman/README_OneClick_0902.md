
# Feedbacker • One‑Click • 0902

Коллекция Postman для прод‑сервиса: **https://feedbacker3.onrender.com**.

## Состав
- `Feedbacker_OneClick_0902.postman_collection.json` — коллекция.
- `Feedbacker_ENV_0902.postman_environment.json` — окружение (проверь `FEEDBACK_API_URL`).
- `testaudio_silence_1s.wav` — тестовый 1‑секундный WAV (для multipart загрузки).
- `run_newman.sh` / `run_newman.bat` — сценарии запуска Newman.

## Как запустить в Postman
1. Импортируй **коллекцию** и **окружение**.
2. В окружении выставь:
   - `FEEDBACK_API_URL` = https://feedbacker3.onrender.com
   - `SHOP_ID` = shop_demo_001 (или свой)
3. Убедись, что в запросе **03) POST /feedback (multipart)** файл указывает на `testaudio_silence_1s.wav` (лежит рядом).
4. Нажми **Run**. В ответах проверяется наличие заголовка **X-Request-ID**.

## Newman (CLI)
npx newman run Feedbacker_OneClick_0902.postman_collection.json -e Feedbacker_ENV_0902.postman_environment.json --timeout-request 15000 --timeout 180000 --delay-request 300 --reporters cli,junit --reporter-junit-export newman-results.xml

## Ожидаемые проверки
- `GET /health` и `GET /` → 200, есть **X-Request-ID**.
- `POST /feedback` → 200, приходит `feedback_id`, есть **X-Request-ID**.
- `GET /feedback/full/:id` → 200.
- `GET /feedback/get-audio/:id` → 200, JSON содержит `signedUrl`.
