import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getApp,
  getAccessToken,
  resetBudgets,
  resetExpenses,
  seedRows,
  userIdFromToken,
} from "./helpers.js";

/**
 * Budget API integration tests (plan §5). Requires PostgreSQL running:
 *   docker compose up -d postgres && npm run db:push -w @expense-app/api
 */

const TZ_OFFSET = "+07:00";
const PIN = "BUD111";
const PIN_B = "BU2222";

let app: FastifyInstance;
let token: string;
let userId: string;
let authed: { authorization: string };
let tokenB: string;
let userIdB: string;
let authedB: { authorization: string };

beforeAll(async () => {
  app = await getApp();
  token = await getAccessToken(app, PIN);
  userId = userIdFromToken(app, token);
  authed = { authorization: `Bearer ${token}` };
  tokenB = await getAccessToken(app, PIN_B);
  userIdB = userIdFromToken(app, tokenB);
  authedB = { authorization: `Bearer ${tokenB}` };
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetBudgets(userId);
  await resetExpenses(userId);
  await resetBudgets(userIdB);
  await resetExpenses(userIdB);
});

function todayJakarta(): string {
  // Server/tests run with APP_TIMEZONE=Asia/Jakarta; derive the civil date
  // through the API's own contract (en-CA gives YYYY-MM-DD).
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

async function createBudget(
  payload: Record<string, unknown>,
  headers: { authorization: string } = authed,
): Promise<{ statusCode: number; body: { id?: string; error?: string } }> {
  const response = await app.inject({
    method: "POST",
    url: "/api/budgets",
    headers,
    payload,
  });
  return { statusCode: response.statusCode, body: response.json() };
}

describe("POST /api/budgets", () => {
  it("creates a budget and returns 201 with its id", async () => {
    const { statusCode, body } = await createBudget({
      type: "daily",
      amount: 100_000,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(statusCode).toBe(201);
    expect(body.id).toBeTruthy();
  });

  it("replaces the previous active budget (only ONE active — plan §1)", async () => {
    await createBudget({ type: "full", amount: 10_000_000, startDate: "2026-08-01", endDate: "2026-08-31" });
    await createBudget({ type: "daily", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" });

    const active = await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed });
    const budget = active.json().budget;
    expect(budget.type).toBe("daily");
    expect(budget.amount).toBe(100_000);

    // The August budget moved to history (deactivated, not deleted).
    const history = await app.inject({ method: "GET", url: "/api/budgets/history", headers: authed });
    expect(history.json().history).toHaveLength(1);
    expect(history.json().history[0].type).toBe("full");
  });

  it("rejects invalid payloads with 400", async () => {
    const cases = [
      { type: "weekly", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" }, // bad type
      { type: "daily", amount: 0, startDate: "2026-09-01", endDate: "2026-09-30" }, // bad amount
      { type: "daily", amount: 100_000, startDate: "01/09/2026", endDate: "2026-09-30" }, // bad date
      { type: "daily", amount: 100_000, startDate: "2026-09-30", endDate: "2026-09-01" }, // start > end
      { type: "daily", amount: 100_000, startDate: "2026-01-01", endDate: "2027-01-02" }, // > 366 days
    ];
    for (const payload of cases) {
      const { statusCode } = await createBudget(payload);
      expect(statusCode).toBe(400);
    }
  });

  it("requires authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/budgets",
      payload: { type: "daily", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /api/budgets/active", () => {
  it("returns budget: null when there is no active budget", async () => {
    const response = await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ budget: null });
  });

  it("computes full-budget spent/remaining/status live from expenses in range", async () => {
    await createBudget({ type: "full", amount: 1_000_000, startDate: "2026-09-01", endDate: "2026-09-30" });
    await seedRows(userId, [
      { amount: 350_000, occurredAt: new Date(`2026-09-05T10:00:00${TZ_OFFSET}`) },
      { amount: 250_000, occurredAt: new Date(`2026-09-06T10:00:00${TZ_OFFSET}`) },
      { amount: 900_000, occurredAt: new Date(`2026-08-20T10:00:00${TZ_OFFSET}`) }, // outside range
    ]);

    const response = await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed });
    const budget = response.json().budget;
    expect(budget.spent).toBe(600_000);
    expect(budget.remaining).toBe(400_000);
    expect(budget.status).toBe("ok"); // 60% < 80%
    expect(budget.progressPct).toBe(60);
  });

  it("marks warning exactly at 80% and over beyond 100% (plan §5)", async () => {
    await createBudget({ type: "full", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" });
    await seedRows(userId, [{ amount: 80_000, occurredAt: new Date(`2026-09-05T10:00:00${TZ_OFFSET}`) }]);
    let budget = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(budget.status).toBe("warning");

    await seedRows(userId, [{ amount: 20_001, occurredAt: new Date(`2026-09-06T10:00:00${TZ_OFFSET}`) }]);
    budget = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(budget.status).toBe("over");
    expect(budget.remaining).toBe(0);
    expect(budget.progressPct).toBe(100);
  });

  it("daily budget: spent/remaining/status aggregate TODAY (Jakarta) only — plan §2", async () => {
    const today = todayJakarta();
    await createBudget({ type: "daily", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" });
    await seedRows(userId, [
      { amount: 60_000, occurredAt: new Date(`${today}T10:00:00${TZ_OFFSET}`) }, // today
      { amount: 400_000, occurredAt: new Date("2026-09-10T10:00:00+07:00") }, // in range, other day
    ]);

    const budget = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(budget.spent).toBe(60_000); // today only, NOT the 460k range sum
    expect(budget.todaySpent).toBe(60_000);
    expect(budget.remaining).toBe(40_000);
    expect(budget.status).toBe("ok");
    expect(budget.progressPct).toBe(60);

    // Over on today's cap → over, even though the range sum is far larger.
    await seedRows(userId, [{ amount: 50_000, occurredAt: new Date(`${today}T20:00:00${TZ_OFFSET}`) }]);
    const over = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(over.spent).toBe(110_000);
    expect(over.status).toBe("over");
  });

  it("aggregates daily-type today spend by Jakarta civil day", async () => {
    const today = todayJakarta();
    await createBudget({ type: "daily", amount: 100_000, startDate: today, endDate: addDays(today, 6) });
    await seedRows(userId, [
      { amount: 30_000, occurredAt: new Date(`${today}T00:30:00${TZ_OFFSET}`) }, // today 00:30 WIB
      { amount: 20_000, occurredAt: new Date(`${today}T23:59:00${TZ_OFFSET}`) }, // today late evening
    ]);

    const budget = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(budget.todaySpent).toBe(50_000);
    expect(budget.spent).toBe(50_000);
    expect(budget.status).toBe("ok"); // 50% of today's cap
  });

  it("scopes by user: B never sees A's budget (plan §5)", async () => {
    await createBudget({ type: "full", amount: 1_000_000, startDate: "2026-09-01", endDate: "2026-09-30" }, authed);

    const forB = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authedB })).json();
    expect(forB.budget).toBeNull();

    const historyB = (await app.inject({ method: "GET", url: "/api/budgets/history", headers: authedB })).json();
    expect(historyB.history).toEqual([]);
  });

  it("reflects expense edits deterministically (spent is recomputed, not stored)", async () => {
    const today = todayJakarta();
    await createBudget({ type: "full", amount: 500_000, startDate: today, endDate: addDays(today, 2) });
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 100_000 },
    });
    const { id } = created.json();

    let budget = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(budget.spent).toBe(100_000);

    await app.inject({ method: "PATCH", url: `/api/expenses/${id}`, headers: authed, payload: { amount: 250_000 } });
    budget = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget;
    expect(budget.spent).toBe(250_000);
  });
});

describe("GET /api/budgets/history", () => {
  it("lists past budgets desc by createdAt with per-item spent (plan §5)", async () => {
    // Oldest first → newest last, so desc order puts September first.
    await createBudget({ type: "full", amount: 1_000_000, startDate: "2026-07-01", endDate: "2026-07-31" });
    await new Promise((resolve) => setTimeout(resolve, 20)); // ensure distinct createdAt
    await createBudget({ type: "daily", amount: 100_000, startDate: "2026-08-01", endDate: "2026-08-31" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await createBudget({ type: "full", amount: 10_000_000, startDate: "2026-09-01", endDate: "2026-09-30" }, authed);
    // Spent belongs to the JULY budget's range so per-item aggregation is
    // proven (September's active budget stays at 8.2jt? no — July only).
    await seedRows(userId, [{ amount: 8_200_000, occurredAt: new Date(`2026-07-10T10:00:00${TZ_OFFSET}`) }]);

    const response = await app.inject({ method: "GET", url: "/api/budgets/history", headers: authed });
    expect(response.statusCode).toBe(200);
    const { history } = response.json();
    expect(history).toHaveLength(2);

    const [top, second] = history;
    expect(top.type).toBe("daily"); // newest deactivated = August daily
    expect(top.status).toBe("ok");
    expect(top.spent).toBe(0); // no expenses in August
    expect(second.type).toBe("full");
    expect(second.spent).toBe(8_200_000); // July budget sees the July expense
    expect(second.status).toBe("over"); // 8.2jt spent vs 1jt cap
  });

  it("exposes deactivated budgets after DELETE (nothing is ever removed)", async () => {
    await createBudget({ type: "daily", amount: 50_000, startDate: "2026-09-01", endDate: "2026-09-30" });
    const deleted = await app.inject({ method: "DELETE", url: "/api/budgets/active", headers: authed });
    expect(deleted.statusCode).toBe(204);

    const active = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json();
    expect(active.budget).toBeNull();

    const { history } = (await app.inject({ method: "GET", url: "/api/budgets/history", headers: authed })).json();
    expect(history).toHaveLength(1);
    expect(history[0].amount).toBe(50_000);
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createBudget({ type: "daily", amount: 10_000 + i, startDate: "2026-09-01", endDate: "2026-09-02" });
    }
    const { history } = (await app.inject({ method: "GET", url: "/api/budgets/history?limit=1", headers: authed })).json();
    expect(history).toHaveLength(1);
  });
});

describe("DELETE /api/budgets/active", () => {
  it("returns 404 when there is no active budget", async () => {
    const response = await app.inject({ method: "DELETE", url: "/api/budgets/active", headers: authed });
    expect(response.statusCode).toBe(404);
  });

  it("deactivates only the caller's budget", async () => {
    await createBudget({ type: "full", amount: 1_000_000, startDate: "2026-09-01", endDate: "2026-09-30" }, authed);
    await createBudget({ type: "daily", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" }, authedB);

    const response = await app.inject({ method: "DELETE", url: "/api/budgets/active", headers: authed });
    expect(response.statusCode).toBe(204);

    expect((await app.inject({ method: "GET", url: "/api/budgets/active", headers: authed })).json().budget).toBeNull();
    // B's budget untouched.
    const budgetB = (await app.inject({ method: "GET", url: "/api/budgets/active", headers: authedB })).json().budget;
    expect(budgetB.amount).toBe(100_000);
  });
});
