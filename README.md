# Daily Expense Calculator

MVP v0.1 — capture and review expenses with the speed and simplicity of a calculator.

Open app → enter amount → choose period (D/W/M) → press Enter → expense saved.

## Stack

| Layer    | Tech                                            |
| -------- | ----------------------------------------------- |
| Web      | React 19, TypeScript, Vite, Tailwind CSS v4     |
| API      | Node.js, TypeScript, Fastify, Zod               |
| Database | PostgreSQL, Prisma                              |
| Shared   | `@expense-app/shared` — types, period math (timezone-aware), currency formatting, validation |
| Tests    | Vitest (unit + API integration), Testing Library |

## Repository structure

```
expense-app/
├── apps/
│   ├── web/          # React calculator UI (localhost:5173)
│   └── api/          # Fastify REST API (localhost:3000)
├── packages/
│   └── shared/       # Types, DTOs, period enum, validation schemas
├── docker-compose.yml
├── package.json
└── .env.example
```

## Quick start

```bash
docker compose up -d        # Postgres on localhost:5433 (host port chosen to avoid clashes)
npm install

cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# add the signing secret (once):
echo "APP_JWT_SECRET=$(openssl rand -hex 32)" >> apps/api/.env

npm run db:push             # create schema
SEED_PIN=ABC123 npm run db:seed   # optional dev seed (spec §29), owned by that PIN
npm run dev                 # api + web
```

- Web → http://localhost:5173
- API → http://localhost:3000

## Troubleshooting

**Login returns 404 or "Could not save expense":**
1. Ensure API is running: `npm run dev:api` and check `http://localhost:3000/api/auth/login` responds.
2. Ensure `apps/web/.env.local` exists with `VITE_API_URL=http://localhost:3000` (copied from `apps/web/.env.example`).

## Tests

API integration tests (`apps/api/tests/`) run against a **separate database** to
avoid wiping development data. The test setup file (`tests/setup.ts`) swaps
`DATABASE_URL` to `TEST_DATABASE_URL` before any Prisma client is imported.

Set up the test database once:

```bash
psql -d postgres -U postgres -c "CREATE DATABASE expense_test;"
npm run db:push  # runs against TEST_DATABASE_URL (set in apps/api/.env)
```

A safety latch in `tests/helpers.ts` throws if `deleteMany` is called against
any database whose name does not end with `_test`, preventing accidental
dev data wipes. Auth tests provision unique PINs per suite and reset per
user, never whole tables outside `_test` databases.

## Scripts

| Command              | Description                        |
| -------------------- | ---------------------------------- |
| `npm run dev`        | Run API and web dev servers        |
| `npm run test`       | Run all workspace tests            |
| `npm run typecheck`  | TypeScript check all workspaces    |
| `npm run build`      | Build all workspaces               |
| `npm run db:push`    | Push Prisma schema to Postgres     |
| `npm run db:seed`    | Seed dev data (never in prod)      |

## Auth: PIN as identity

The PIN (6 alphanumeric characters, case-insensitive) **is** the user
identity — no email, no username.

- Login `POST /api/auth/login { pin }`:
  - Known PIN → `200 { token, expiresInMs }`.
  - Never-seen PIN → `202 { needsConfirm: true }`; the client asks for
    confirmation, then resends `{ pin, confirm: true }` which provisions a
    new user (anti salah-ketik-jadi-identitas).
- PIN storage: `pin_lookup` = HMAC(APP_JWT_SECRET, "pin-lookup"‖pin) for
  finding the user (unique, indexed); `pin_hash` = scrypt for verification.
  The raw PIN is never stored.
- Sessions: HMAC-signed tokens with `{ t, sub, iat, exp }`, TTL **20 hours**.
  `POST /api/auth/refresh` (Bearer required) mints a fresh 20h token.
  Tokens are non-rotating — old ones stay valid until their own exp.
- Rate limit: login is limited to 20 attempts / 5 min per IP → `429` with
  `Retry-After` (in-memory; resets on restart).
- Data is scoped per user: all expense queries filter by the token's user;
  cross-user ids resolve to `404`.

Honest limitations: a forgotten PIN means the data in that space is
unreachable (one-way hash, no recovery); a stolen token is usable until its
20h expiry.

## Migration runbook (per-user data)

One-time, in this order:

1. Generate and add the secret, remove the old access code:
   ```bash
   echo "APP_JWT_SECRET=$(openssl rand -hex 32)" >> apps/api/.env
   # delete any APP_ACCESS_CODE line from apps/api/.env
   ```
2. Two-push migration (keeps the 254 legacy rows unblocked):
   ```bash
   npm run db:push                          # push-1: user_id column (optional)
   ADOPT_PIN=<PIN lu> npm run db:adopt --workspace @expense-app/api
   npm run db:push                          # push-2: user_id required
   ```
   `ADOPT_PIN` is read from the env only — never commit or log it.
3. Seed going forward per user (dev only): `SEED_PIN=ABC123 npm run db:seed`.
4. Deploy → every device re-logins with its PIN once (old tokens are dead:
   `APP_ACCESS_CODE` is gone).

## Session refresh (client)

On mount and when the tab becomes visible, the client refreshes the token if
the last visit is ≥ 1 hour old (`TOKEN_REFRESH_MIN_INTERVAL_MS` in shared).
Fresh visits stay silent; a `401` from refresh locks the app; network errors
retry on the next visit. `expense-app.last-visit` in localStorage tracks it.

## Profile menu

The navbar has a trailing user icon (both calculator and browse modes):
masked PIN `••••••` + **Keluar**. Logout clears the token and returns to the
lock screen = switching identity.

Amounts are integer IDR (BIGINT in Postgres, `amount > 0` check constraint).
Day/Week/Month boundaries are computed in `Asia/Jakarta` (`APP_TIMEZONE`), never
from the browser timezone. Week starts Monday; ranges are half-open to avoid
end-of-day bugs.

## Chart

The calculator view shows a compact per-day bar chart for the selected period
(D = today, W = Mon–Sun, M = full month). Today is highlighted in emerald; the
rest are neutral gray. Pure CSS — no chart library.

## Seed data

`npm run db:seed` generates ~250 expenses across 3 months (deterministic
per-day amounts, weekdays/weekends vary), ending with today's pinned example
set (35.000 / 25.000 / 42.000 / 25.500 = Rp127.500).

## Notes

- Postgres is mapped to host port **5433** because 5432 was occupied on this
  machine; adjust `docker-compose.yml` / `apps/api/.env` if needed.
- Keyboard support on desktop: `0-9`, `Backspace`, `Enter`, `Escape`;
  in special browse mode the arrow keys move the selection and `Enter`
  drills into the highlighted day (the old chart→history inversion).
