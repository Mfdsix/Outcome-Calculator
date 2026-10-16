/**
 * Development-only win streak test seed.
 *
 * Generates a controllable daily budget + expenses to exercise the win streak
 * computation paths:
 *   - live streak (win streak including today)
 *   - broken streak (streak ends yesterday, today is over)
 *   - clean history (no win streak at all)
 *
 * Choose the scenario via WIN_STREAK_SCENARIO env var:
 *   "live"   (default) — 5 win days ending today, budget 100k/day
 *   "broken" — 3 win days then today over (delta < 0), budget 100k/day
 *   "clean"  — every day over budget, no win streak
 *
 * Requires SEED_PIN (6 alphanumeric chars) + APP_JWT_SECRET to identify the
 * dev user. WIPES the SEED_PIN user's budgets + expenses before seeding.
 */
import "dotenv/config";

import { normalizePin, zonedWallTimeToUtc, getZonedParts, addCivilDays } from "@expense-app/shared";
import { createHmac, randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import { prisma } from "../src/prisma.js";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const TZ = process.env.APP_TIMEZONE ?? "Asia/Jakarta";

async function findOrCreateUser(pin: string) {
  const secret = (process.env.APP_JWT_SECRET ?? "").trim();
  if (!secret) throw new Error("APP_JWT_SECRET is required for seeding.");

  const lookup = createHmac("sha256", secret).update(`pin-lookup\u0000${pin}`).digest("hex");
  const existing = await prisma.user.findUnique({ where: { pinLookup: lookup } });
  if (existing) return existing;

  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, 32);
  const pinHash = `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
  return prisma.user.create({ data: { pinLookup: lookup, pinHash } });
}

function civilDateToUtcMidnight(civil: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
}

/** Build an expense row for a given civil day + amount, at a fixed local time. */
function expenseRow(
  civil: { year: number; month: number; day: number },
  amount: number,
  userId: string,
): { amount: bigint; occurredAt: Date; userId: string } {
  const occurredAt = zonedWallTimeToUtc(TZ, {
    year: civil.year,
    month: civil.month,
    day: civil.day,
    hour: 8,
    minute: 30,
  });
  return { amount: BigInt(amount), occurredAt: new Date(occurredAt), userId };
}

const Scenarios: Record<string, { label: string; wins: number; todayOver: boolean }> = {
  live: { label: "live streak (5 wins incl. today)", wins: 5, todayOver: false },
  broken: { label: "broken streak (3 wins, today over)", wins: 3, todayOver: true },
  clean: { label: "no win streak (all over)", wins: 0, todayOver: true },
};

type ScenarioKey = keyof typeof Scenarios;

async function main(): Promise<void> {
  const pin = normalizePin(process.env.SEED_PIN ?? "");
  if (!pin) {
    console.log("Seed skipped: set SEED_PIN (6 alphanumeric chars) to seed a dev user.");
    return;
  }

  const scenario = (process.env.WIN_STREAK_SCENARIO ?? "live") as ScenarioKey;
  if (!(scenario in Scenarios)) {
    console.error(`Invalid WIN_STREAK_SCENARIO: ${scenario}. Use "live" | "broken" | "clean".`);
    process.exit(1);
  }

  const config = Scenarios[scenario]!;
  const user = await findOrCreateUser(pin);

  // --- Wipe scoped to the SEED_PIN user ---
  await prisma.budget.deleteMany({ where: { userId: user.id } });
  await prisma.expense.deleteMany({ where: { userId: user.id } });

  const now = new Date();
  const today = getZonedParts(now, TZ);
  const BUDGET_AMOUNT = 100_000;

  const rows: Array<{ amount: bigint; occurredAt: Date; userId: string }> = [];

  // Generate 6 days of history (dayOffset 1 = yesterday down to 6 = six-days-ago).
  // wins = how many of the *most recent* days (ending today) should be wins.
  //   - live: 5 wins → yesterday + today win, older days mixed
  //   - broken: 3 wins → 3 most-recent history days win, today over
  //   - clean: 0 wins → all days over
  for (let dayOffset = 6; dayOffset >= 1; dayOffset -= 1) {
    const civil = addCivilDays(today, -dayOffset);
    // Days within [1..wins] (counting from today backward) are wins.
    const isWinDay = dayOffset < config.wins;
    const amount = isWinDay ? 60_000 : 120_000; // under = win, over = loss
    rows.push(expenseRow(civil, amount, user.id));
  }

  // Today
  if (config.todayOver) {
    rows.push(expenseRow(today, 150_000, user.id)); // over budget → streak breaks
  } else {
    rows.push(expenseRow(today, 50_000, user.id)); // under budget = live win (streak continues)
  }

  await prisma.expense.createMany({ data: rows });
  console.log(`[${scenario}] Seeded ${rows.length} expenses for SEED_PIN user ${user.id}.`);

  // Active daily budget covering 7 days ago → +30 days
  const start = addCivilDays(today, -6);
  const end = addCivilDays(today, 30);

  await prisma.budget.create({
    data: {
      userId: user.id,
      type: "daily",
      amount: BigInt(BUDGET_AMOUNT),
      startDate: civilDateToUtcMidnight(start),
      endDate: civilDateToUtcMidnight(end),
      isActive: true,
      createdAt: new Date(),
    },
  });

  console.log(
    `[${scenario}] Seeded active daily budget (cap Rp${BUDGET_AMOUNT.toLocaleString()}): ` +
      `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")} → ` +
      `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}.`,
  );
  console.log(`Scenario: ${config.label}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
