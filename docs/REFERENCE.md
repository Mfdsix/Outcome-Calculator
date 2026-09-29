# Expense App — AI Reference

> One-page primer for any AI working on this repo. Read this first before touching code.

## 1. What this is

Daily Expense Calculator. Speed-first expense capture with calculator UX.

Core loop: **Open app → type amount → pick period (D/W/M) → press Enter → saved.**

- Monorepo: `apps/web` (React UI) + `apps/api` (Fastify API) + `packages/shared` (shared logic)
- Source of truth is always the **server (Postgres)**. Client is online-first with limited offline support.
- Amounts are integer IDR. Timezone authority is `Asia/Jakarta` (never browser tz).

## 2. Stack & layout

| Layer | Tech |
|---|---|
| Web | React 19, TypeScript, Vite, Tailwind v4, PWA + Tauri (same codebase) |
| API | Node 20+, Fastify, Zod, Prisma |
| DB | PostgreSQL |
| Shared | `@expense-app/shared`: types, period math, currency, validation, budget, insights |
| Offline | `idb-keyval` (IndexedDB) + localStorage |

```
apps/web/src/
  app/App.tsx            # orchestrator: auth, modes, keyboard, optimistic CRUD
  components/            # Keypad, PeriodSelector, BarChart, lists, dialogs, screens
  hooks/                 # useCalculator, useExpenses, useBudget, useSync, useOnline, useInsights
  lib/                   # api.ts, offlineDb.ts, sync.ts, repository/, periods.ts, currency.ts
  types/ui.ts            # ViewMode, SpecialPanel, EditOrigin

apps/api/src/
  server.ts, app.ts, auth.ts, prisma.ts, env.ts
  routes/expenses.ts, routes/budgets.ts
  prisma/schema.prisma

packages/shared/src/
  periods.ts, currency.ts, validation.ts, budget.ts, insights.ts, auth.ts, types.ts
```

## 3. UX in 60 seconds

### Journey
```
Lock (PIN) → Calculator home (Today) → Browse history (D/W/M) → Budget / Insight
```

- **Lock:** 6-char alphanumeric PIN, auto-submit when full. Unknown PIN → confirm dialog → provisions a new identity. Wrong PIN shakes + clears.
- **Calculator home:** Header + PeriodSelector + InsightTicker + AmountDisplay + BarChart (hourly) + Keypad (digits). Enter saves optimistically with green flash.
- **Browse (`special` mode):** Tap D/W/M from home. Shows SummaryList + BarChart + nav Keypad. Enter on W/M drills into a day; Enter on day/drill edits the selected transaction.
- **Edit:** Returns to calculator with floating Back/Delete strip. Save with no change = silent dismiss. Changed = confirm dialog. Dirty Back = unsaved-changes dialog.
- **Budget / Insight:** Full-screen modes opened from user menu / ticker. Back or Escape returns home. Keypad digits are inert there.

### ViewMode state (`types/ui.ts`, `hooks/useExpenses.ts`)
- `ViewMode = calculator | special | budget | insight`
- `period = day | week | month` — note: web week = last 7 rolling days, month = last 30 rolling days (not calendar week/month).
- `specialPanel = summary | drill`, plus `selectedKey` (bucket or expense id), `drillDayKey`, `EditOrigin` (where the edit came from, for restore).

### Input
- Calc keypad: fixed 4×3 grid `1-9 / 0 / ⌫ / Enter`. Enter disabled when amount ≤ 0 or edit has no delta. Max 13 digits.
- Browse keypad: digits inert; `2↑ 4← 6→ 8↓` navigate, `Enter` = drill/edit, `0/⌫` disabled.
- Physical keyboard mirrors the keypad. Ignored when typing in inputs or when a modal is open. Every tap/keypress plays a 150ms clicky pulse.
- Tapping the active green period returns home (exit drill first, else close history).

### Status & feedback
- `ConnIndicator` in header: `Online / Offline·N / Sync… / Pending N / Local (cached day)`.
- Error banner (red, 4s) for API/sync failures. Budget notice (amber/red, 3s, non-blocking) after Enter when near/over budget.
- All dialogs share one pattern: dim backdrop, small card, autofocus Cancel, backdrop-click + Escape = cancel. Test ids exist for e2e.

### Components cheat sheet
- `App` — all orchestration, optimistic CRUD, offline queue, EditOrigin restore.
- `Header` — period label + total + ConnIndicator + UserMenu.
- `AmountDisplay` — readout + Edit badge + flash.
- `PeriodSelector` — pure D/W/M switcher.
- `BarChart` — pure CSS bars, no chart lib. Click bar = select.
- `SummaryList` (aggregates) / `BrowseList` (transactions in a day) — ledger with auto-scroll.
- `BudgetScreen` — active card + history with "reuse" prefill + create form (daily/full) + delete.
- `InsightScreen` / `InsightTicker` — derived tips list + rotating 1-line marquee on home.
- `UserMenu` — masked PIN, Budget (status dot), Insight, Theme, Delete account (retype PIN), Logout.
- Hooks: `useCalculator` (digit machine), `useExpenses` (modes + data + cache), `useBudget` (active + history), `useInsights` (pure memo, no fetch), `useOnline` (navigator + probe), `useSync` (drain trigger).

## 4. Data storage

### 4.1 Server DB (Postgres + Prisma)
`apps/api/prisma/schema.prisma`. All ids are UUIDs.

- `users`: `id, pinLookup UNIQUE, pinHash, isActive (default true)`. Raw PIN never stored. Deactivation tombstones `pinLookup → inactive:<id>` so the PIN can be reused while old expenses stay attached to the old row.
- `expenses`: `id, amount BIGINT, occurredAt timestamptz, userId FK CASCADE`. Index `[userId, occurredAt]`. DB check `amount > 0` (enforced in `prisma.ts`).
- `budgets`: `id, userId FK CASCADE, type (full|daily), amount BIGINT, startDate/endDate DATE inclusive, isActive`. One active per user enforced in a transaction (no partial unique index). `spent` is **never stored** — always aggregated live from expenses.
- Validation: `amount` int > 0, ≤ 1e12 (`packages/shared/validation.ts`).

### 4.2 Auth — PIN is the identity
No email/username. 6 alphanumeric chars, case-insensitive.

- `pinLookup = HMAC(secret, "pin-lookup" + PIN)` → find user. `pinHash = scrypt` → verify.
- `POST /api/auth/login {pin, confirm?}`: known PIN → `200 {token}`; unknown → `202 {needsConfirm:true}` → resend with `confirm:true` to provision. Wrong → `401`. Rate-limited 20/5min per IP → `429`.
- Token: custom stateless HMAC token `{t, sub, iat, exp}`, TTL 20h, non-rotating. `POST /api/auth/refresh` (Bearer) mints a fresh one.
- `POST /api/auth/deactivate {pin}` (Bearer): verifies PIN, sets `isActive=false` + tombstones lookup. Old tokens 401 immediately. No reactivation.
- All `/api/*` require Bearer except login. All expense/budget queries filter by token user; foreign ids return `404` (not 403).
- Limits: forgotten PIN = data unreachable (one-way hash). Stolen token works until expiry.

### 4.3 API endpoints
```
POST /api/auth/login {pin, confirm?} → 200 | 202 | 401
POST /api/auth/refresh (Bearer) → 200 {token}
POST /api/auth/deactivate {pin} (Bearer) → {ok:true}

POST /api/expenses {amount, occurredAt?} → 201 ExpenseDto
GET  /api/expenses?from=&to= → {expenses desc, total}   # half-open [from, to)
PATCH /api/expenses/:id {amount} → 200 | 404
DELETE /api/expenses/:id → 204 | 404

POST /api/budgets {type, amount, startDate, endDate} → 201 {id}
GET  /api/budgets/active → {budget:null | {..., spent, todaySpent, remaining, status, progressPct}}
GET  /api/budgets/history?limit= → past budgets with live spent
DELETE /api/budgets/active → 204 | 404
```
- `occurredAt` optional on create → server now. GET uses half-open ranges; `+` in offsets must survive URL decoding. `from ≥ to` → 400.
- Budget dates are civil `YYYY-MM-DD`, `start ≤ end`, ≤ 366 days inclusive.
- DTO: `BigInt → number`, timestamps via `toIsoWithOffset(row, APP_TIMEZONE)`.

### 4.4 Client storage
- **localStorage:** `expense-app.token`, `expense-app.last-visit` (token refresh if ≥1h since visit), `expense-app.theme`.
- **IndexedDB** (`lib/offlineDb.ts`, `idb-keyval`, DB `expense-app-offline`, single store `kv`):
  - `today` → `TodayCache {expenses, total, dayKey (Jakarta YYYY-MM-DD), from/to (server range), occurredAt marker, cachedAt}`.
  - `outbox:<token>` → FIFO `OutboxOp[]` per token (PIN spaces never mix): `{opId, type: create|update|delete, realId?, tempId? (temp-<uuid>), payload:{amount, occurredAt?}}`.
  - All writers go through one serialized promise chain (race-free). IDB failures are swallowed (e.g. iOS private mode degrades gracefully).

### 4.5 Sync flow (online-first)
- UI depends only on `ExpenseRepository {list, total, create, update, delete}` (`lib/repository/`). HTTP impl is a thin wrapper over `lib/api.ts` (`expensesApi`). Same API for browser/PWA/Tauri; only base URL differs (browser same-origin `/api`, Tauri `VITE_API_URL` from `.env.tauri`).
- `request<T>`: fetch throw → `OfflineError`; 401 → `UnauthorizedError` (re-lock); else → `ApiError`.
- Offline Day CRUD: `queueOfflineCreate/Update/Delete` (`lib/sync.ts`) + patch `todayCache` optimistically. `coalesceOps` merges chains (create+update = one create, create+delete = drop, update+update = last wins).
- `drainOutbox`: coalesce → replay FIFO with `tempId → realId` remap → `replaceOps` each step (crash-safe). 404 = drop (lost race, e.g. edited then deleted); offline (status 0) = stop, keep head for order; auth fail = abort.
- `useExpenses.refresh()`: fetch period range via repository, sort desc. Day fetch fail → load cache if `dayKey` matches (merge in-memory extras, show `Local` badge). W/M fetch fail → empty list + "needs internet" hint.
- `useSync`: single-flight drain on trigger bump, `online` event, tab visible, and 30s poll while pending > 0.
- **Offline scope (by design): Today/Day is fully offline. Week/Month require internet.**

## 5. Rules AI must not break

1. **Timezone:** all ranges half-open `[from, to)`, computed in `Asia/Jakarta` via `@expense-app/shared` (`Intl`-based, no luxon). Week starts Monday. Web W/M are rolling last-7/last-30 days. Never use browser tz for queries.
2. **Currency:** integer IDR only. Use shared helpers (`normalizeDigits`, `groupDigits`, `digitsToAmount`, `formatIDR`, abbreviated `Rp1,2 jt`). Never float.
3. **Budget spent:** always aggregate live from expenses. Never persist `spent`.
4. **Offline:** only Day is offline-capable. Don't try to cache W/M. Per-token outbox keys; temp ids start with `temp-` and must be remapped after sync.
5. **Auth:** never log/store raw PIN. `pinLookup` is HMAC, `pinHash` is scrypt. Foreign-user ids → 404. Deactivation is one-way.
6. **UX:** keypad height identical in both modes; dialogs always cancellable via backdrop/Escape with autofocus on Cancel; budget warnings never block Enter.
7. **Tests:** API integration tests run against `*_test` DB only (safety latch throws otherwise). Never wipe dev data.

## 6. Quick commands

```bash
docker compose up -d        # Postgres on host :5433
npm install
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
echo "APP_JWT_SECRET=$(openssl rand -hex 32)" >> apps/api/.env
npm run db:push
SEED_PIN=ABC123 npm run db:seed   # optional dev seed
npm run dev                 # api :3000 + web :5173
npm run test / typecheck / build
```
