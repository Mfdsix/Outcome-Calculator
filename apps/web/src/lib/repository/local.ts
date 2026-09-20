import type {
  CreateExpensePayload,
  ExpenseDto,
  ExpenseListResponse,
  UpdateExpensePayload,
} from "@expense-app/shared";
import { amountSchema } from "@expense-app/shared";

import { ApiError } from "../api";
import type { ExpenseRepository } from "./types";

/**
 * SQLite-backed ExpenseRepository for the Tauri build (plan §3/§5/§6).
 *
 * All SQL goes through the official `tauri-plugin-sql` JS API; the schema is
 * created by the plugin's Rust-side migrations (src-tauri/src/lib.rs):
 *
 *   expenses(id TEXT PK, amount INTEGER>0, occurred_at, created_at, updated_at)
 *   idx_expenses_occurred_at(occurred_at)
 *
 * Datetime handling: every timestamp is normalized to UTC ISO-8601 (`…Z`)
 * before it is stored or compared. SQLite would otherwise compare the raw
 * strings lexicographically, which breaks when offsets mix (+07:00 vs Z).
 * Asia/Jakarta has no DST, so UTC storage loses nothing; all period math
 * stays in the existing shared `periodRange` helpers.
 */

const DB_KEY = "sqlite:expense.db";

/** Singleton connection — `Database.load` resolves once per session. */
let dbPromise: Promise<SqlPluginDatabase> | null = null;

/** Minimal structural type for the plugin's Database (keeps the mock easy). */
export interface SqlPluginDatabase {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
}

/** plugin-sql exports Database as the module's default export. */
interface SqlPluginModule {
  default: {
    load(key: string): Promise<SqlPluginDatabase>;
  };
}

async function db(): Promise<SqlPluginDatabase> {
  if (!dbPromise) {
    dbPromise = import("@tauri-apps/plugin-sql").then(
      (plugin) => (plugin as unknown as SqlPluginModule).default.load(DB_KEY),
    );
  }
  return dbPromise;
}

/** Reset the cached connection (tests only). */
export function resetLocalDbForTests(): void {
  dbPromise = null;
}

// ---------------------------------------------------------------------------
// Row mapping — snake_case columns ↔ camelCase DTO (plan §3 schema)
// ---------------------------------------------------------------------------

interface ExpenseRow {
  id: string;
  amount: number;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

function toDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    amount: Number(row.amount),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Normalize any ISO-8601 instant to UTC `…Z` for storage/comparison. */
function toUtcIso(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `Format tanggal tidak valid (${field}).`);
  }
  return parsed.toISOString();
}

/** Money guard shared by every mutation (plan §3: integer IDR, > 0). */
function assertAmount(amount: number): number {
  const parsed = amountSchema.safeParse(amount);
  if (!parsed.success) {
    throw new ApiError(400, "Invalid amount.");
  }
  return parsed.data;
}

/** New expense id (TEXT PK; SQLite cannot generate one for us). */
function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the fallback below
  }
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Wrap any plugin failure in a user-facing error (plan §15). */
function wrapDbError(cause: unknown, friendly: string): ApiError {
  if (cause instanceof ApiError) return cause;
  // Technical details stay in the console for debugging; the UI gets a
  // single friendly line — never a Rust/SQLite trace.
  console.error("[localExpenseRepository]", cause);
  return new ApiError(500, friendly);
}

// ---------------------------------------------------------------------------
// Repository implementation
// ---------------------------------------------------------------------------

async function list(from: string, to: string): Promise<ExpenseListResponse> {
  const database = await db();
  try {
    const fromUtc = toUtcIso(from, "from");
    const toUtc = toUtcIso(to, "to");
    const rows = await database.select<ExpenseRow>(
      `SELECT id, amount, occurred_at, created_at, updated_at
         FROM expenses
        WHERE occurred_at >= ? AND occurred_at < ?
        ORDER BY occurred_at DESC`,
      [fromUtc, toUtc],
    );
    const totals = await database.select<{ total: number | null }>(
      `SELECT SUM(amount) AS total
         FROM expenses
        WHERE occurred_at >= ? AND occurred_at < ?`,
      [fromUtc, toUtc],
    );
    return { expenses: rows.map(toDto), total: Number(totals[0]?.total ?? 0) };
  } catch (cause) {
    throw wrapDbError(cause, "Gagal memuat pengeluaran.");
  }
}

async function total(from: string, to: string): Promise<number> {
  const database = await db();
  try {
    const totals = await database.select<{ total: number | null }>(
      `SELECT SUM(amount) AS total
         FROM expenses
        WHERE occurred_at >= ? AND occurred_at < ?`,
      [toUtcIso(from, "from"), toUtcIso(to, "to")],
    );
    return Number(totals[0]?.total ?? 0);
  } catch (cause) {
    throw wrapDbError(cause, "Gagal menghitung total.");
  }
}

async function create(payload: CreateExpensePayload): Promise<ExpenseDto> {
  const amount = assertAmount(payload.amount);
  const database = await db();
  try {
    const now = new Date().toISOString();
    const expense: ExpenseDto = {
      id: newId(),
      amount,
      occurredAt: payload.occurredAt ? toUtcIso(payload.occurredAt, "occurredAt") : now,
      createdAt: now,
      updatedAt: now,
    };
    await database.execute(
      `INSERT INTO expenses (id, amount, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [expense.id, expense.amount, expense.occurredAt, expense.createdAt, expense.updatedAt],
    );
    return expense;
  } catch (cause) {
    throw wrapDbError(cause, "Gagal menyimpan pengeluaran.");
  }
}

async function update(id: string, payload: UpdateExpensePayload): Promise<ExpenseDto> {
  const amount = assertAmount(payload.amount);
  const database = await db();
  try {
    const updatedAt = new Date().toISOString();
    const result = await database.execute(
      `UPDATE expenses
          SET amount = ?, updated_at = ?
        WHERE id = ?`,
      [amount, updatedAt, id],
    );
    if (result.rowsAffected === 0) {
      throw new ApiError(404, "Pengeluaran tidak ditemukan.");
    }
    const rows = await database.select<ExpenseRow>(
      `SELECT id, amount, occurred_at, created_at, updated_at
         FROM expenses
        WHERE id = ?`,
      [id],
    );
    return toDto(rows[0]!);
  } catch (cause) {
    throw wrapDbError(cause, "Gagal memperbarui pengeluaran.");
  }
}

async function deleteExpense(id: string): Promise<void> {
  const database = await db();
  try {
    const result = await database.execute(`DELETE FROM expenses WHERE id = ?`, [id]);
    if (result.rowsAffected === 0) {
      throw new ApiError(404, "Pengeluaran tidak ditemukan.");
    }
  } catch (cause) {
    throw wrapDbError(cause, "Gagal menghapus pengeluaran.");
  }
}

export const localExpenseRepository: ExpenseRepository = {
  list,
  total,
  create,
  update,
  delete: deleteExpense,
};
