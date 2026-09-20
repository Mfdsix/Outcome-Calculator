import type {
  CreateExpensePayload,
  ExpenseDto,
  ExpenseListResponse,
  UpdateExpensePayload,
} from "@expense-app/shared";

/**
 * Expense persistence contract (Tauri migration plan §5).
 *
 * The UI depends on this interface only — never on Tauri APIs or on the HTTP
 * client. Two implementations exist:
 * - `httpExpenseRepository` — the web app's API-backed repository (auth +
 *   server-side scoping apply; offline goes through the IDB outbox).
 * - `localExpenseRepository` — the native app's SQLite repository (Tauri
 *   plugin, bundled; the database IS the source of truth).
 *
 * A future `syncRepository` can implement the same interface (plan §19)
 * without touching a single component or hook.
 */
export interface ExpenseRepository {
  /** List expenses in the half-open [from, to) range, newest first. */
  list(from: string, to: string): Promise<ExpenseListResponse>;
  /** Sum of amounts in the half-open [from, to) range. */
  total(from: string, to: string): Promise<number>;
  create(payload: CreateExpensePayload): Promise<ExpenseDto>;
  update(id: string, payload: UpdateExpensePayload): Promise<ExpenseDto>;
  delete(id: string): Promise<void>;
}

/** Which backend the UI is wired to in this runtime. */
export type RepositoryKind = "local" | "http";
