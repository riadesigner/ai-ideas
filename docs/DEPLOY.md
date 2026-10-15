# Деплой на сервер

Путь: `/opt/ai-ideas`. Compose: `docker compose -f docker-compose.yml -f docker-compose.prod.yml`.

Домен: `ai-ideas.riadesign.ru`. 80/443 занимает [aside-edge](https://github.com/riadesigner/aside-edge). Этот стек в сети `edge` как `ideas`.

Один раз: `docker network create edge` (если сети ещё нет).

```bash
git clone git@github.com:riadesigner/ai-ideas.git /opt/ai-ideas
cd /opt/ai-ideas
cp .env.example .env
# APP_ORIGIN=https://ai-ideas.riadesign.ru
# NODE_ENV=production
# DEV_AUTH_BYPASS=0
# MAILRU_REDIRECT_URI=https://ai-ideas.riadesign.ru/api/auth/mailru/callback
# POSTGRES_PASSWORD, JWT_SECRET, OWNER_EMAILS, OPENAI_API_KEY
# MAILRU_CLIENT_ID, MAILRU_CLIENT_SECRET
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

В кабинете Mail.ru redirect URI — тот же `MAILRU_REDIRECT_URI`.

Обновление: `git pull` и тот же `up -d --build`. Volume Postgres не удалять.

Шлюз: в `/opt/aside-edge/.env` строка `IDEAS_DOMAIN=ai-ideas.riadesign.ru`. Дальше по README aside-edge: `git pull`, `docker compose up -d`, `./scripts/update-sert.sh`.
