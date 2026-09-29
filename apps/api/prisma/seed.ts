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

/**
 * Development-only seed (spec §29): three months of realistic daily expenses
 * ending today, owned by the PIN identity from SEED_PIN (dev-only). Never run
 * against production. When SEED_PIN is unset the seed is skipped with a hint
 * so CI and prod never accidentally create a well-known identity.
 *
 * On each run the seed WIPES the SEED_PIN user's budgets + expenses then
 * reseeds everything: expenses generator is deterministic (stable per run date),
 * budgets are created fresh — two history rows (inactive) + one active daily
 * budget whose amount is tunable via SEED_BUDGET_DAILY (default 85_000).
 */

const TZ = process.env.APP_TIMEZONE ?? "Asia/Jakarta";
const DAYS = 90; // 3 months

/** Deterministic PRNG so repeated seeds (after wipe) stay stable per run date. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Template {
  /** Base probability an expense exists on a given day. */
  probability: number;
  /** Typical amounts around which jitter is applied. */
  amounts: number[];
}

const TEMPLATES: Template[] = [
  { probability: 0.9, amounts: [15_000, 22_000, 27_500, 35_000] }, // meals/coffee
  { probability: 0.55, amounts: [20_000, 42_000, 50_000] }, // transport/top-ups
  { probability: 0.3, amounts: [65_000, 85_000, 95_000, 120_000] }, // groceries
  { probability: 0.12, amounts: [150_000, 250_000, 380_000] }, // occasional bigger spend
];

/** Amounts for the spec's canonical "today" example, always present. */
const TODAY_PINNED = [35_000, 25_000, 42_000, 25_500];

function jitter(amount: number, random: () => number): number {
  const steps = [-5000, -2000, 0, 0, 2000, 5000];
  const value = amount + steps[Math.floor(random() * steps.length)]!;
  return Math.max(2000, Math.round(value / 500) * 500);
}

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

/** Civil date → UTC midnight Date, matching the route's `new Date(Date.UTC(y, m-1, d))` pattern. */
function civilDateToUtcMidnight(civil: { year: number; month: number; day: number }): Date {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
}

async function main(): Promise<void> {
  const pin = normalizePin(process.env.SEED_PIN ?? "");
  if (!pin) {
    console.log("Seed skipped: set SEED_PIN (6 alphanumeric chars) to seed a dev user.");
    return;
  }
  if (!/^[A-Z0-9]{6}$/.test(pin)) {
    console.error("SEED_PIN must be 6 alphanumeric characters.");
    process.exit(1);
  }

  const user = await findOrCreateUser(pin);

  // --- Wipe scoped to the SEED_PIN user's own rows (never unbounded) ---
  await prisma.budget.deleteMany({ where: { userId: user.id } });
  await prisma.expense.deleteMany({ where: { userId: user.id } });

  const now = new Date();
  const today = getZonedParts(now, TZ);
  const rows: Array<{ amount: bigint; occurredAt: Date; userId: string }> = [];

  // 89 previous days + today.
  for (let dayOffset = DAYS - 1; dayOffset >= 1; dayOffset -= 1) {
    const civil = addCivilDays(today, -dayOffset);
    const dayRandom = makeRandom(
      civil.year * 10_000 + civil.month * 100 + civil.day,
    );

    TEMPLATES.forEach((template, index) => {
      if (dayRandom() > template.probability) return;
      const count = 1 + Math.floor(dayRandom() * 2); // 1-2 expenses per template
      for (let i = 0; i < count; i += 1) {
        const hour = 7 + Math.floor(dayRandom() * 14); // 07:00–20:59 local
        const occurredAt = zonedWallTimeToUtc(TZ, {
          year: civil.year,
          month: civil.month,
          day: civil.day,
          hour,
          minute: Math.floor(dayRandom() * 60),
        });
        rows.push({
          amount: BigInt(jitter(template.amounts[Math.floor(dayRandom() * template.amounts.length)]!, dayRandom)),
          occurredAt,
          userId: user.id,
        });
      }
    });
  }

  // Today: exactly the spec's example set, at plausible times.
  TODAY_PINNED.forEach((amount, index) => {
    const occurredAt = zonedWallTimeToUtc(TZ, {
      year: today.year,
      month: today.month,
      day: today.day,
      hour: 8 + index * 3,
      minute: 17 * index,
    });
    rows.push({ amount: BigInt(amount), occurredAt: new Date(occurredAt), userId: user.id });
  });

  await prisma.expense.createMany({ data: rows });
  console.log(`Seeded ${rows.length} expenses over ${DAYS} days for SEED_PIN user ${user.id}.`);

  // --- Budgets ---
  // Spent is NOT stored — computed live from expenses inside each range.
  // Three rows, all owned by the same SEED_PIN user:
  //   H1: history (old)  — daily 75k, range [60 → 31] days ago, inactive
  //   H2: history (new)  — daily 80k, range [30 → 18] days ago, inactive
  //   A:  active          — daily 85k (or SEED_BUDGET_DAILY), [8 days ago → +30 days], active
  // createdAt is set explicitly so H1 < H2 < A for deterministic history ordering.
  const dailyBudget = Number(process.env.SEED_BUDGET_DAILY ?? "85000");

  const h1Start = addCivilDays(today, -60);
  const h1End = addCivilDays(today, -31);
  const h2Start = addCivilDays(today, -30);
  const h2End = addCivilDays(today, -18);
  const aStart = addCivilDays(today, -8);
  const aEnd = addCivilDays(today, 30);

  const budgets = [
    {
      type: "daily" as const,
      amount: BigInt(75_000),
      startDate: civilDateToUtcMidnight(h1Start),
      endDate: civilDateToUtcMidnight(h1End),
      isActive: false,
      createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, 0)), // earliest
    },
    {
      type: "daily" as const,
      amount: BigInt(80_000),
      startDate: civilDateToUtcMidnight(h2Start),
      endDate: civilDateToUtcMidnight(h2End),
      isActive: false,
      createdAt: new Date(Date.UTC(2025, 1, 1, 0, 0, 0)), // middle
    },
    {
      type: "daily" as const,
      amount: BigInt(dailyBudget),
      startDate: civilDateToUtcMidnight(aStart),
      endDate: civilDateToUtcMidnight(aEnd),
      isActive: true,
      createdAt: new Date(Date.UTC(2025, 2, 1, 0, 0, 0)), // latest → active on top
    },
  ];

  for (const b of budgets) {
    await prisma.budget.create({ data: { ...b, userId: user.id } });
  }
  console.log(`Seeded ${budgets.length} budgets (${budgets.filter((b) => b.isActive).length} active) for SEED_PIN user ${user.id}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());