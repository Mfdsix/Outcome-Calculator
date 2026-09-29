import "dotenv/config";

import { normalizePin } from "@expense-app/shared";
import { afterAll, beforeAll, beforeEach } from "vitest";

import { buildApp, type AppInstance } from "../src/app.js";
import { prisma } from "../src/prisma.js";

let appPromise: Promise<AppInstance> | null = null;

export function getApp(): Promise<AppInstance> {
  // One shared app instance; suites share the same Prisma client.
  return (appPromise ??= buildApp({ logger: false }));
}

/** Deterministic per-suite PIN so suites never collide on the shared test DB. */
export function suitePin(suiteName: string): string {
  const normalized = normalizePin(suiteName).replace(/[^A-Z0-9]/g, "").padEnd(6, "0").slice(0, 6);
  return normalized || "TST000";
}

/**
 * Provision (login + confirm) a user for `pin` and return a bearer token.
 * Idempotent: a known PIN simply logs in.
 */
export async function getAccessToken(app: AppInstance, pin: string): Promise<string> {
  const first = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { pin },
  });
  if (first.statusCode === 200) {
    return (first.json() as { token: string }).token;
  }
  const confirmed = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { pin, confirm: true },
  });
  if (confirmed.statusCode !== 200) {
    throw new Error(`Login failed in tests: ${confirmed.statusCode} ${confirmed.body}`);
  }
  return (confirmed.json() as { token: string }).token;
}

export async function resetExpenses(userId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const databaseName = databaseUrl.split("/").pop()?.split("?")[0] ?? "";
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `SAFETY LATCH: resetExpenses called against non-test database "${databaseName}". ` +
        "This would wipe development data. Use TEST_DATABASE_URL pointing to a _test DB.",
    );
  }
  await prisma.expense.deleteMany({ where: { userId } });
}

export async function resetBudgets(userId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const databaseName = databaseUrl.split("/").pop()?.split("?")[0] ?? "";
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `SAFETY LATCH: resetBudgets called against non-test database "${databaseName}". ` +
        "This would wipe development data. Use TEST_DATABASE_URL pointing to a _test DB.",
    );
  }
  await prisma.budget.deleteMany({ where: { userId } });
}

export async function resetUsers(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const databaseName = databaseUrl.split("/").pop()?.split("?")[0] ?? "";
  if (!databaseName.endsWith("_test")) {
    throw new Error(`SAFETY LATCH: resetUsers called against non-test database "${databaseName}".`);
  }
  await prisma.user.deleteMany({});
}

/** Seed rows owned by `userId`. */
export async function seedRows(
  userId: string,
  rows: Array<{ amount: number; occurredAt: Date; allocationType?: string }>,
): Promise<void> {
  await prisma.expense.createMany({
    data: rows.map((row) => ({
      amount: BigInt(row.amount),
      occurredAt: row.occurredAt,
      userId,
      allocationType: row.allocationType ?? "NONE",
    })),
  });
}

/** Extract the user id from a token issued by the API (test-side decode). */
export function userIdFromToken(app: AppInstance, token: string): string {
  void app;
  const body = token.split(".")[0] ?? "";
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub: string };
  return payload.sub;
}

export { afterAll, beforeAll, beforeEach };
