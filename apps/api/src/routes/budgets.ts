import {
  budgetProgressPct,
  budgetRangeToUtc,
  budgetStatus,
  createBudgetSchema,
  dayRange,
  parseCivilDate,
} from "@expense-app/shared";
import type {
  BudgetActiveResponse,
  BudgetHistoryItem,
  BudgetStatus,
  BudgetType,
} from "@expense-app/shared";
import type { Budget, PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

interface BudgetRoutesOptions {
  prisma: PrismaClient;
  appTimezone: string;
}

/**
 * REST API for budgets (feature plan §2), scoped to the authenticated user:
 *   POST   /api/budgets          create → transactionally deactivates the old one
 *   GET    /api/budgets/active   active budget + server-computed spent/remaining
 *   GET    /api/budgets/history  past budgets (isActive=false), desc createdAt
 *   DELETE /api/budgets/active   soft-delete (isActive=false, stays in history)
 *
 * request.userId is attached by the auth preHandler. Spent is never stored:
 * every read aggregates expenses live inside the budget range (deterministic
 * even when expenses are edited later — plan §1).
 */
export const budgetRoutes: FastifyPluginAsync<BudgetRoutesOptions> = async (
  app,
  { prisma, appTimezone },
) => {
  /** Sum of expenses for `userId` inside a half-open UTC range. */
  async function spentInRange(userId: string, from: Date, to: Date): Promise<number> {
    const aggregate = await prisma.expense.aggregate({
      where: { userId, occurredAt: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    return aggregate._sum.amount === null ? 0 : Number(aggregate._sum.amount);
  }

  app.post("/api/budgets", async (request, reply) => {
    const userId = request.userId as string;
    const parsed = createBudgetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid budget." });
    }

    const { type, amount, startDate, endDate } = parsed.data;
    const start = parseCivilDate(startDate);
    const end = parseCivilDate(endDate);

    // ONE transaction: deactivate all active rows, then create the new one.
    // Guarantees at most one active budget per user (plan §1) even under
    // double-submit races, without a partial unique index.
    const [, row] = await prisma.$transaction([
      prisma.budget.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      }),
      prisma.budget.create({
        data: {
          userId,
          type,
          amount: BigInt(amount),
          startDate: new Date(Date.UTC(start.year, start.month - 1, start.day)),
          endDate: new Date(Date.UTC(end.year, end.month - 1, end.day)),
        },
      }),
    ]);

    return reply.status(201).send({ id: row.id });
  });

  app.get("/api/budgets/active", async (request, reply) => {
    const userId = request.userId as string;
    const budget = await prisma.budget.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (!budget) {
      const body: BudgetActiveResponse = { budget: null };
      return reply.send(body);
    }

    const bounds = rangeBounds(budget, appTimezone);
    const [rangeSpent, todaySpent] = await Promise.all([
      spentInRange(userId, bounds.from, bounds.to),
      spentInRange(userId, ...todaySpentBounds(appTimezone)),
    ]);

    // Plan §2: "daily = agregat hari ini Asia/Jakarta" — for daily budgets
    // spent/remaining/status/progress are computed against TODAY's spend
    // (flat, no rollover); "full" uses the whole range. todaySpent is always
    // surfaced for the inline calculator micro-row.
    const spent = budget.type === "daily" ? todaySpent : rangeSpent;
    const amount = Number(budget.amount);
    const status: BudgetStatus = budgetStatus(spent, amount);
    const body: BudgetActiveResponse = {
      budget: {
        id: budget.id,
        type: budget.type as BudgetType,
        amount,
        startDate: civilDateString(budget.startDate),
        endDate: civilDateString(budget.endDate),
        spent,
        todaySpent,
        remaining: Math.max(0, amount - spent),
        status,
        progressPct: budgetProgressPct(spent, amount),
      },
    };
    return reply.send(body);
  });

  app.get("/api/budgets/history", async (request, reply) => {
    const userId = request.userId as string;
    const query = request.query as { limit?: string } | undefined;
    const limitRaw = Number.parseInt(query?.limit ?? "20", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

    const rows = await prisma.budget.findMany({
      where: { userId, isActive: false },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // One aggregate per history item (≤20 by default — acceptable per plan §2;
    // all sums run in parallel on the connection pool).
    const history: BudgetHistoryItem[] = await Promise.all(
      rows.map(async (row) => {
        const bounds = rangeBounds(row, appTimezone);
        const spent = await spentInRange(userId, bounds.from, bounds.to);
        const amount = Number(row.amount);
        return {
          id: row.id,
          type: row.type as BudgetType,
          amount,
          startDate: civilDateString(row.startDate),
          endDate: civilDateString(row.endDate),
          spent,
          status: budgetStatus(spent, amount),
          createdAt: row.createdAt.toISOString(),
        } satisfies BudgetHistoryItem;
      }),
    );

    return reply.send({ history });
  });

  app.delete("/api/budgets/active", async (request, reply) => {
    const userId = request.userId as string;
    // Scoped update: nothing matched → the caller has no active budget → 404.
    const updated = await prisma.budget.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    if (updated.count === 0) {
      return reply.status(404).send({ error: "No active budget." });
    }
    return reply.status(204).send();
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inclusive @db.Date columns are UTC midnights — read straight back. */
function civilDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rangeBounds(budget: Budget, appTimezone: string): { from: Date; to: Date } {
  return budgetRangeToUtc(
    civilDateString(budget.startDate),
    civilDateString(budget.endDate),
    appTimezone,
  );
}

/** Half-open [today 00:00, tomorrow 00:00) in the app timezone. */
function todaySpentBounds(appTimezone: string): [Date, Date] {
  const { from, to } = dayRange(new Date(), appTimezone);
  return [from, to];
}
