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
 * GET /api/budgets/:id/series integration tests. Requires PostgreSQL:
 *   docker compose up -d postgres && npm run db:push -w @expense-app/api
 */

const TZ_OFFSET = "+07:00";
const PIN = "SER111";
const PIN_B = "SER222";

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

async function createBudget(payload: Record<string, unknown>): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/budgets",
    headers: authed,
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

function getSeries(id: string, headers: { authorization: string } = authed) {
  return app.inject({ method: "GET", url: `/api/budgets/${id}/series`, headers });
}

describe("GET /api/budgets/:id/series", () => {
  it("returns sparse days for the caller's active budget", async () => {
    const id = await createBudget({
      type: "daily",
      amount: 100_000,
      startDate: "2026-09-25",
      endDate: "2026-09-28",
    });
    await seedRows(userId, [
      { amount: 30_000, occurredAt: new Date(`2026-09-25T10:00:00${TZ_OFFSET}`) },
      { amount: 20_000, occurredAt: new Date(`2026-09-25T20:00:00${TZ_OFFSET}`) },
      { amount: 190_019, occurredAt: new Date(`2026-09-27T10:00:00${TZ_OFFSET}`) },
      { amount: 900_000, occurredAt: new Date(`2026-09-20T10:00:00${TZ_OFFSET}`) },
    ]);

    const response = await getSeries(id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      days: [
        { date: "2026-09-25", total: 50_000 },
        { date: "2026-09-27", total: 190_019 },
      ],
    });
  });

  it("returns sparse days for an inactive (history) budget", async () => {
    // Creating the second budget deactivates the first one.
    await createBudget({ type: "full", amount: 1_000_000, startDate: "2026-08-01", endDate: "2026-08-31" });
    await seedRows(userId, [{ amount: 250_000, occurredAt: new Date(`2026-08-10T10:00:00${TZ_OFFSET}`) }]);
    await createBudget({ type: "daily", amount: 100_000, startDate: "2026-09-01", endDate: "2026-09-30" });

    const history = await app.inject({ method: "GET", url: "/api/budgets/history", headers: authed });
    const [past] = history.json().history as Array<{ id: string }>;
    expect(past).toBeTruthy();

    const response = await getSeries(past!.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ days: [{ date: "2026-08-10", total: 250_000 }] });
  });

  it("answers 404 for another user's budget id (no existence leak)", async () => {
    const id = await createBudget({ type: "full", amount: 500_000, startDate: "2026-09-01", endDate: "2026-09-30" });

    const response = await getSeries(id, authedB);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found." });
  });

  it("answers 404 for an unknown uuid", async () => {
    const response = await getSeries("00000000-0000-4000-8000-000000000000");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Not found." });
  });

  it("answers 404 for a malformed id instead of crashing", async () => {
    const response = await getSeries("not-a-uuid");
    expect(response.statusCode).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/budgets/00000000-0000-4000-8000-000000000000/series",
    });
    expect(response.statusCode).toBe(401);
  });
});
