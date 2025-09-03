# Feedbacker Postman OneClick 0902 Fix1

В архиве:
- Коллекция Postman (исправленная, без GET /feedback?limit)
- Env с верхним регистром переменной FEEDBACK_API_URL
- WAV тестовый файл (1 сек тишины)

## Использование
1. Импортируй коллекцию и env в Postman.
2. Проверь переменную FEEDBACK_API_URL (https://feedbacker3.onrender.com).
3. Убедись, что файл testaudio_silence_1s.wav доступен в папке коллекции.
4. Запусти по шагам: Health → POST Feedback.

