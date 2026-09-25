import { z } from "zod";

import type { AllocationType } from "./allocation";

export const allocationTypeSchema = z.enum(["NONE", "WEEKLY", "MONTHLY"] as const);
export type { AllocationType };

/**
 * Money validation (spec §27): integer, > 0, safe, bounded to a reasonable
 * IDR limit that fits comfortably in BIGINT and in a JS safe integer.
 */
export const MAX_AMOUNT = 1_000_000_000_000; // Rp1 trillion

export const amountSchema = z
  .number({
    required_error: "Invalid amount.",
    invalid_type_error: "Invalid amount.",
  })
  .int("Invalid amount.")
  .gt(0, "Invalid amount.")
  .lte(MAX_AMOUNT, "Invalid amount.");

/** ISO 8601 datetime that must carry an explicit UTC offset or Z. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const createExpenseSchema = z.object({
  amount: amountSchema,
  allocationType: allocationTypeSchema.optional(),
  occurredAt: isoDateTimeSchema.optional(),
});

export const updateExpenseSchema = z.object({
  amount: amountSchema.optional(),
  allocationType: allocationTypeSchema.optional(),
});

export const periodSchema = z.enum(["day", "week", "month"]);
