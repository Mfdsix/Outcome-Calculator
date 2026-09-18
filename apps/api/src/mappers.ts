import type { ExpenseDto } from "@expense-app/shared";
import { toIsoWithOffset } from "@expense-app/shared";
import type { Expense } from "@prisma/client";

/**
 * Map a Prisma row to the API DTO (spec §14). BigInt amounts become JS
 * numbers (bounded by validation, spec §27) and timestamps are formatted
 * with an explicit UTC offset in the configured app timezone.
 */
export function toExpenseDto(row: Expense, appTimezone: string): ExpenseDto {
  return {
    id: row.id,
    amount: Number(row.amount),
    occurredAt: toIsoWithOffset(row.occurredAt, appTimezone),
    createdAt: toIsoWithOffset(row.createdAt, appTimezone),
    updatedAt: toIsoWithOffset(row.updatedAt, appTimezone),
  };
}
