import type {
  CreateExpensePayload,
  ExpenseDto,
  ExpenseListResponse,
  UpdateExpensePayload,
} from "@expense-app/shared";

/**
 * Expense persistence contract.
 *
 * The UI depends on this interface only — never on the HTTP client. The one
 * implementation is `httpExpenseRepository`: the API-backed repository (auth
 * + server-side scoping apply; offline goes through the IDB outbox).
 *
 * A future repository (e.g. a sync-aware adapter) can implement the same
 * interface without touching a single component or hook.
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
export type RepositoryKind = "http";
