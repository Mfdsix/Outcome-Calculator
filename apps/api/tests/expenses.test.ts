import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getApp, getAccessToken, resetExpenses, seedRows, userIdFromToken } from "./helpers.js";

/**
 * API integration tests. Requires PostgreSQL running:
 *   docker compose up -d postgres && npm run db:push -w @expense-app/api
 */

const TZ = "Asia/Jakarta";
const PIN = "EXP111";

let app: FastifyInstance;
let token: string;
let userId: string;
let authed: { authorization: string };

beforeAll(async () => {
  app = await getApp();
  token = await getAccessToken(app, PIN);
  userId = userIdFromToken(app, token);
  authed = { authorization: `Bearer ${token}` };
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetExpenses(userId);
});

describe("POST /api/expenses", () => {
  it("creates an expense and returns 201 with DTO", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.amount).toBe(35000);
    expect(body.occurredAt).toBe("2026-09-17T12:30:00+07:00");
    expect(body.id).toBeTruthy();
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });

  it("defaults allocationType to NONE when omitted", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 50000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().allocationType).toBe("NONE");
  });

  it("accepts allocationType WEEKLY on create", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 700000, occurredAt: "2026-09-17T12:30:00+07:00", allocationType: "WEEKLY" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().allocationType).toBe("WEEKLY");
  });

  it("accepts allocationType MONTHLY on create", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 3000000, allocationType: "MONTHLY" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().allocationType).toBe("MONTHLY");
  });

  it("rejects invalid allocationType values", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 50000, allocationType: "DAILY" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("defaults occurredAt to server time when omitted", async () => {
    const before = Date.now() - 1000;
    const response = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 5000 },
    });

    expect(response.statusCode).toBe(201);
    const occurredAt = new Date(response.json().occurredAt).getTime();
    expect(occurredAt).toBeGreaterThanOrEqual(before);
  });

  it("rejects zero and negative amounts with 400", async () => {
    for (const amount of [0, -5000, 35.5]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/expenses",
        headers: authed,
        payload: { amount },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("Invalid amount.");
    }
  });
});

describe("GET /api/expenses", () => {
   it("lists expenses in [from, to) with server-computed total", async () => {
     await seedRows(userId, [
       { amount: 35000, occurredAt: new Date("2026-09-17T02:00:00+07:00") },
       { amount: 25000, occurredAt: new Date("2026-09-17T09:00:00+07:00") },
       { amount: 42000, occurredAt: new Date("2026-09-16T10:00:00+07:00") },
     ]);

     const response = await app.inject({
       method: "GET",
       url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-18T00:00:00+07:00",
       headers: authed,
     });

     expect(response.statusCode).toBe(200);
     const body = response.json();
     // Expanded fetch window (30 days before `from`) includes the Sep 16
     // expense. The allocation-aware total still reflects only Sep 17.
     expect(body.expenses).toHaveLength(3);
     expect(body.total).toBe(60000);
     // Newest first.
     expect(body.expenses[0]!.amount).toBe(25000);
     expect(body.expenses[1]!.amount).toBe(35000);
   });

  it("respects the half-open range upper bound", async () => {
    await seedRows(userId, [
      { amount: 10000, occurredAt: new Date("2026-09-17T23:59:59+07:00") },
      { amount: 20000, occurredAt: new Date("2026-09-18T00:00:00+07:00") },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-18T00:00:00+07:00",
      headers: authed,
    });

    const body = response.json();
    expect(body.expenses).toHaveLength(1);
    expect(body.total).toBe(10000);
  });

  it("aggregates by Jakarta calendar day, not UTC day", async () => {
    await seedRows(userId, [
      { amount: 12000, occurredAt: new Date("2026-09-17T00:30:00+07:00") },
      { amount: 8000, occurredAt: new Date("2026-09-17T20:00:00+07:00") },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-18T00:00:00+07:00",
      headers: authed,
    });

    const body = response.json();
    expect(body.total).toBe(20000);
  });

  it("requires from and to", async () => {
    const response = await app.inject({ method: "GET", url: "/api/expenses", headers: authed });
    expect(response.statusCode).toBe(400);
  });

  it("returns empty list and zero total for a period with no expenses", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2030-01-01T00:00:00+07:00&to=2030-01-02T00:00:00+07:00",
      headers: authed,
    });
    const body = response.json();
    expect(body.expenses).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("allocation-aware total: WEEKLY 700k on day 1 → 100k in today's range", async () => {
    await seedRows(userId, [
      { amount: 700_000, occurredAt: new Date("2026-09-17T10:00:00+07:00"), allocationType: "WEEKLY" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-18T00:00:00+07:00",
      headers: authed,
    });

    const body = response.json();
    expect(body.total).toBe(100_000); // 700k / 7 days
  });

   it("allocation-aware total: WEEKLY expense in expanded fetch window still visible", async () => {
     // Expense created on 15 Sep, WEEKLY window = 15-21 Sep. Period = 17-19 Sep.
     // 2 days overlap (17, 18) → 200k
     await seedRows(userId, [
       { amount: 700_000, occurredAt: new Date("2026-09-15T10:00:00+07:00"), allocationType: "WEEKLY" },
     ]);

     const response = await app.inject({
       method: "GET",
       url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-19T00:00:00+07:00",
       headers: authed,
     });

     // 2 days overlap (17, 18) → 200k
     expect(response.json().total).toBe(200_000);
   });

  it("allocation-aware total: NON-allocated expense returns full amount", async () => {
    await seedRows(userId, [
      { amount: 50_000, occurredAt: new Date("2026-09-17T10:00:00+07:00"), allocationType: "NONE" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-18T00:00:00+07:00",
      headers: authed,
    });

    expect(response.json().total).toBe(50_000);
  });

  it("allocation-aware total with remainder: 1.000.001 / 7 → day 1 gets 142858", async () => {
    await seedRows(userId, [
      { amount: 1_000_001, occurredAt: new Date("2026-09-17T10:00:00+07:00"), allocationType: "WEEKLY" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2026-09-17T00:00:00+07:00&to=2026-09-18T00:00:00+07:00",
      headers: authed,
    });

    expect(response.json().total).toBe(142_858);
  });
});

describe("PATCH /api/expenses/:id", () => {
  it("updates the amount without changing occurredAt", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id, occurredAt } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: { amount: 50000 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.amount).toBe(50000);
    expect(body.occurredAt).toBe(occurredAt);
  });

  it("rejects invalid amounts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: { amount: 0 },
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for unknown id", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/expenses/00000000-0000-4000-8000-000000000000",
      headers: authed,
      payload: { amount: 50000 },
    });
    expect(response.statusCode).toBe(404);
  });

  it("updates only allocationType when amount is omitted", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: { allocationType: "WEEKLY" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().allocationType).toBe("WEEKLY");
    expect(response.json().amount).toBe(35000);
  });

  it("updates only amount when allocationType is omitted", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: { amount: 50000 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().amount).toBe(50000);
    expect(response.json().allocationType).toBe("NONE");
  });

  it("updates both amount and allocationType together", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: { amount: 700000, allocationType: "WEEKLY" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().amount).toBe(700000);
    expect(response.json().allocationType).toBe("WEEKLY");
  });

  it("rejects invalid allocationType on patch", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: { allocationType: "DAILY" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects empty body (nothing to update)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/expenses/${id}`,
      headers: authed,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("DELETE /api/expenses/:id", () => {
  it("deletes an expense and returns 204", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: authed,
      payload: { amount: 35000, occurredAt: "2026-09-17T12:30:00+07:00" },
    });
    const { id } = created.json();

    const response = await app.inject({
      method: "DELETE",
      url: `/api/expenses/${id}`,
      headers: authed,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
  });

  it("returns 404 for unknown id", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/api/expenses/00000000-0000-4000-8000-000000000000",
      headers: authed,
    });
    expect(response.statusCode).toBe(404);
  });
});
