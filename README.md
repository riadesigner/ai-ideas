# Диктовка

Говорите по-русски — слова появляются сразу. Когда мысль закончена, текст уходит на свой сервер: каждая модель из `OPENAI_MODEL` собирает свою формулировку, вы оставляете одну.

Войти можно только ящиком Mail.ru из `OWNER_EMAILS`. На компьютере для проверки есть отдельная кнопка, без Mail.ru.

- [Решения](docs/Decisions.md)
- [Цель и задачи](docs/Goal.md)
- [План сборки](docs/Plan.md)

## На компьютере

Нужны Docker и файл `.env`.

```bash
cp .env.example .env
docker compose up --build
```

В `.env` впишите `POSTGRES_PASSWORD`, `JWT_SECRET`, свой адрес в `OWNER_EMAILS` и ключ модели. `DEV_AUTH_BYPASS` оставьте `1`.

Откройте `http://localhost:8095` и нажмите «Войти на этом компьютере». Микрофон на localhost работает без HTTPS. Если в `.env` остался старый `WEB_PORT`, поставьте `8095` и тот же адрес в `APP_ORIGIN`. `API_TOKEN` больше не нужен.

## На сервере

Адрес: `https://ai-ideas.riadesign.ru`. Команды и путь `/opt/ai-ideas`: [деплой](docs/DEPLOY.md).

В серверном `.env`: `APP_ORIGIN=https://ai-ideas.riadesign.ru`, `NODE_ENV=production`, `DEV_AUTH_BYPASS=0`, `MAILRU_REDIRECT_URI=https://ai-ideas.riadesign.ru/api/auth/mailru/callback`. Тот же redirect — в кабинете Mail.ru. Телефон открывает домен и входит через Mail.ru.
