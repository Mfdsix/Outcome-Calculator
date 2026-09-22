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

## Production deploy (HTTPS + PWA install)

Chrome only registers the service worker — and therefore only offers
**Install app**, standalone launch and offline mode — over **HTTPS** (or
localhost). Opening the plain `http://VPS:6600` debug port from a phone will
never be installable, no matter what the manifest says. The prod compose file
adds a Caddy edge that terminates TLS automatically:

1. Point a domain's A record at the VPS (an IP alone cannot get Let's Encrypt
   certificates).
2. Open ports **80** and **443** on the VPS firewall (80 is required for the
   ACME challenge).
3. Put the domain in the **root** `.env` (see `.env.example`):
   `CADDY_DOMAIN=expense.example.com`
4. Start the prod stack:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   Caddy fetches/renews the certificate and redirects HTTP → HTTPS; everything
   (SPA, assets, `sw.js`, `manifest.webmanifest`, `/api`) is proxied to the
   nginx `web` service.
5. On the phone: open `https://<domain>` once **online** → Chrome menu →
   **Install app** (not "Create shortcut"). After that first visit the whole
   app shell is precached: airplane mode + cold start still boots, and Today
   (D) CRUD keeps working via the IndexedDB outbox (synced when back online).

Offline scope (by design, plan §5): Today/Day is fully offline-capable;
Week/Month require internet and show a hint when opened offline.

`http://VPS:6600` stays up as an HTTP-only debugging entry — expect no
service worker there.

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
| `npm run tauri:dev`  | Native desktop app (dev)           |
| `npm run tauri:build`| Native desktop installers/bundles  |
| `npm run tauri android build --apk` | Android APK (in `apps/web`) |
| `npm run tauri ios build` | iOS archive (in `apps/web`, macOS only) |

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
- **Deactivate (soft delete)** `POST /api/auth/deactivate { pin }` (Bearer
  required): verifies the PIN, then marks the user row `is_active = false`
  and tombstones `pin_lookup` to `inactive:<userId>` in one update. The row
  stays, so old expenses remain attached to the old identity; the freed PIN
  takes the normal 202→confirm login flow into a fresh empty space. Existing
  tokens 401 immediately (all authenticated routes require an active user) →
  the client re-locks. Wrong PIN → `401 "PIN salah."`, account stays active.
  Honest notes: reactivation is not supported; a re-seeded `SEED_PIN` after
  deactivation provisions a new user (seed matches active rows only).
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

## Deactivate: schema note

`User.isActive` (`is_active`, default `true`) is a **single, non-breaking
`db push`** — no two-push/adopt dance needed. Deactivation rewrites
`pin_lookup` to `inactive:<userId>` so the `@unique` constraint (partial
indexes are not expressible in the Prisma schema) is satisfied while freeing
the PIN for reuse.

## Session refresh (client)

On mount and when the tab becomes visible, the client refreshes the token if
the last visit is ≥ 1 hour old (`TOKEN_REFRESH_MIN_INTERVAL_MS` in shared).
Fresh visits stay silent; a `401` from refresh locks the app; network errors
retry on the next visit. `expense-app.last-visit` in localStorage tracks it.

## Profile menu

The navbar has a trailing user icon (both calculator and browse modes):
masked PIN `••••••`, **Keluar**, and **Hapus akun** (red, requires retyping
the 6-char PIN to confirm). Logout clears the token and returns to the lock
screen = switching identity. Deactivation also clears the token and locks —
the same PIN can then start over with an empty history.

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

## Native apps (Tauri): desktop, Android, iOS

One React codebase, three runtimes — and it is **online-first everywhere**:
the API server stays the source of truth; offline resilience (Today CRUD via
the IndexedDB outbox + auto-sync) is identical in the browser and inside the
native shells. The Tauri shell adds no local database and no local PIN gate.

The API base URL is resolved per runtime:

- **Browser/PWA** — relative base (same-origin `/api` behind the Vite dev
  proxy or the reverse proxy). `VITE_API_URL` still overrides it (Docker).
- **Native (Tauri)** — reads `VITE_API_URL` from `apps/web/.env.tauri`,
  loaded automatically by the `--mode tauri` builds (`tauri:dev`,
  `tauri:build`, android/ios builds). Set it to the LAN address of the API:
  ```
  VITE_API_URL=http://192.168.1.x:3000
  ```

Plain-HTTP LAN APIs need one platform exception each (already applied, but
re-verify after `tauri android/ios init` regenerates these files):

- **Android** — `android:usesCleartextTraffic="true"` on `<application>` in
  `apps/web/src-tauri/gen/android/app/src/main/AndroidManifest.xml`.
- **iOS** — `NSAppTransportSecurity → NSAllowsArbitraryLoads` in
  `apps/web/src-tauri/gen/apple/app_iOS/Info.plist`.

Both are development conveniences for talking to an HTTP API over the LAN —
scope them per-domain (networkSecurityConfig / ATS per-domain exception) or
remove them entirely once the API is behind HTTPS.

### Desktop

```bash
cd apps/web
npm run tauri:dev      # dev shell against the Vite dev server
npm run tauri:build    # bundles .app/.dmg/.deb/...
```

Manual checklist (Phase B): login PIN (server auth) → CRUD online → kill the
API/turn off WiFi → create offline → pending badge on → API back → auto-sync
drains the outbox and the day list refreshes. No `expense.db` is ever created:
data shown is server data.

### Android (APK)

One-time: `rustup target add aarch64-linux-android armv7-linux-androideabi
i686-linux-android x86_64-linux-android`, Android SDK + NDK installed, then:

```bash
cd apps/web
npx tauri android init                 # already done (gen/android exists)
npx tauri android build --apk          # debug APK → sideload
npx tauri android build --apk --target aarch64 # faster: arm64 only
```

Debug APK lands under
`src-tauri/gen/android/app/build/outputs/apk/universal/debug/`. Release
signing is administrative: generate a keystore, add the signing config to
`gen/android/app/build.gradle.kts`, build the release APK/AAB.

### iOS (simulator first, no account needed)

One-time: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`, Xcode
installed, then:

```bash
cd apps/web
npx tauri ios dev      # simulator — free, no signing
npx tauri ios build    # Xcode archive → IPA (signing separate)
```

### What's shared vs per-target

- Same: every React component/hook, the API client, the offline outbox, the
  lock flow (server auth), tests.
- Different: only the shell (webview vs browser) and the API base URL
  resolution. Build-level guards live in `src/lib/api.env.test.ts` — they
  build both modes and assert the Tauri bundle inlines `VITE_API_URL` while
  the PWA bundle keeps its service worker.

## Notes

- Postgres is mapped to host port **5433** because 5432 was occupied on this
  machine; adjust `docker-compose.yml` / `apps/api/.env` if needed.
- Keyboard support on desktop: `0-9`, `Backspace`, `Enter`, `Escape`;
  in special browse mode the arrow keys move the selection and `Enter`
  drills into the highlighted day (the old chart→history inversion).
