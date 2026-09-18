import type { ExpenseListResponse, ExpenseDto, CreateExpensePayload, UpdateExpensePayload } from "@expense-app/shared";
import { createExpenseSchema, updateExpenseSchema } from "@expense-app/shared";
import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";

import { toExpenseDto } from "../mappers.js";

interface ExpenseRoutesOptions {
  prisma: PrismaClient;
  appTimezone: string;
}

/**
 * REST API for expenses (spec §14), scoped to the authenticated user:
 *   POST   /api/expenses
 *   GET    /api/expenses?from=&to=     (half-open [from, to) range, spec §15)
 *   PATCH  /api/expenses/:id
 *   DELETE /api/expenses/:id
 *
 * request.userId is attached by the auth preHandler. A valid token for
 * another user's expense id resolves to 404 (not 403) — existence across
 * users is not disclosed.
 */
export const expenseRoutes: FastifyPluginAsync<ExpenseRoutesOptions> = async (
  app,
  { prisma, appTimezone },
) => {
  app.post("/api/expenses", async (request, reply) => {
    const userId = request.userId as string;
    const parsed = createExpenseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid amount." });
    }

    const { amount, occurredAt } = parsed.data;
    const row = await prisma.expense.create({
      data: {
        amount: BigInt(amount),
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        userId,
      },
    });

    const dto = toExpenseDto(row, appTimezone);
    return reply.status(201).send(dto);
  });

  app.get("/api/expenses", async (request, reply) => {
    const userId = request.userId as string;
    const query = request.query as { from?: string; to?: string };
    // Query parsers decode '+' as a space; restore it for ISO offsets
    // like 2026-09-17T00:00:00+07:00 sent unencoded (spec §15).
    const restoreOffset = (value: string | undefined): string | undefined =>
      value?.replace(/ /g, "+");
    const fromRaw = restoreOffset(query.from);
    const toRaw = restoreOffset(query.to);
    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;

    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: "from and to are required ISO datetimes." });
    }
    if (from.getTime() >= to.getTime()) {
      return reply.status(400).send({ error: "from must be before to." });
    }

    const rangeWhere = { userId, occurredAt: { gte: from, lt: to } };
    const [rows, aggregate] = await prisma.$transaction([
      prisma.expense.findMany({
        where: rangeWhere,
        orderBy: { occurredAt: "desc" },
      }),
      prisma.expense.aggregate({
        where: rangeWhere,
        _sum: { amount: true },
      }),
    ]);

    const expenses: ExpenseDto[] = rows.map((row) => toExpenseDto(row, appTimezone));
    const response: ExpenseListResponse = {
      expenses,
      total: aggregate._sum.amount === null ? 0 : Number(aggregate._sum.amount),
    };
    return reply.send(response);
  });

  app.patch("/api/expenses/:id", async (request, reply) => {
    const userId = request.userId as string;
    const { id } = request.params as { id: string };
    const parsed = updateExpenseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid amount." });
    }

    try {
      // Scoped update (like DELETE below): a foreign id updates nothing —
      // never mutate first and check ownership afterwards.
      const updated = await prisma.expense.updateMany({
        where: { id, userId },
        data: { amount: BigInt(parsed.data.amount) },
      });
      if (updated.count === 0) {
        return reply.status(404).send({ error: "Expense not found." });
      }
      const row = await prisma.expense.findUniqueOrThrow({ where: { id } });
      return reply.send(toExpenseDto(row, appTimezone));
    } catch {
      return reply.status(404).send({ error: "Expense not found." });
    }
  });

  app.delete("/api/expenses/:id", async (request, reply) => {
    const userId = request.userId as string;
    const { id } = request.params as { id: string };
    try {
      // Scoped delete: a foreign id simply deletes nothing → 404.
      const deleted = await prisma.expense.deleteMany({ where: { id, userId } });
      if (deleted.count === 0) {
        return reply.status(404).send({ error: "Expense not found." });
      }
      return reply.status(204).send();
    } catch {
      return reply.status(404).send({ error: "Expense not found." });
    }
  });
};
