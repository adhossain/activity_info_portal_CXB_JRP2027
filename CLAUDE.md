# ActivityInfo Portal — conventions

## Structure

```
server/        Fastify API (TypeScript, port 3000)
web/           React + Vite SPA (TypeScript)
docs/          API research and notes
docker-compose.yml   server + nginx, published on WEB_PORT
```

## Commands

### Install dependencies
```sh
cd server && npm install
cd web && npm install
```

### Development
```sh
# Server (auto-reload)
cd server && npx tsx watch src/index.ts

# Web (Vite dev server, proxies /api to localhost:3000)
cd web && npm run dev
```

### Production (Docker)
```sh
docker compose up --build
# Web is served on WEB_PORT (default 8088)
```

### Usage (how many people have logged in)
```sh
docker compose exec server node dist/login-stats.js
```
Each successful login appends the time and the email (never the token) to
`/data/logins.jsonl` in the `portal-data` volume.
Counting started on 2026-10-02; earlier logins were not recorded.

### Type-check
```sh
cd server && npx tsc --noEmit
cd web && npx tsc --noEmit
```

## Env vars (.env at repo root, never committed)
- `ACTIVITYINFO_BASE_URL` — ActivityInfo API base (default: https://www.activityinfo.org)
- `SESSION_SECRET` — encryption key for session tokens (required)
- `WEB_PORT` — published HTTP port (default: 8088)

## Auth flow
1. User submits email + ActivityInfo API token
2. Server validates by calling `GET /resources/databases` with that token
3. On success, token is AES-256-GCM encrypted and stored in a server-side
   memory session; browser gets only an httpOnly cookie
4. Every API call uses the user's own token → ActivityInfo enforces permissions
5. Credentials never reach browser JS or logs

## Rules
- Never commit `.env` or secrets
- Session store is in-memory behind an interface (swap for Redis later)
- Schemas are cached per session (5 min TTL), not globally
- Trust proxy headers (deployed behind Traefik)
- ActivityInfo is the source of truth for form rules; the portal evaluates
  them itself (`web/src/lib/formula.ts`, `formLogic.ts`). The few checks the
  portal adds on top live only in `web/src/lib/portalRules.ts`.
