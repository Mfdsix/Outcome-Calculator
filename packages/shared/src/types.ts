import type { AllocationType } from "./allocation";

export interface ExpenseDto {
  id: string;
  /** Integer IDR amount, never a formatted string. */
  amount: number;
  /** Allocation type (spec §Adv-1); defaults to "NONE" if absent. */
  allocationType?: AllocationType;
  occurredAt: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseListResponse {
  expenses: ExpenseDto[];
  /** Server-computed total for the requested range. */
  total: number;
}

export interface CreateExpensePayload {
  amount: number;
  /** Allocation type; defaults to "NONE" on the backend. */
  allocationType?: AllocationType;
  /** Optional; backend uses current server time when omitted. */
  occurredAt?: string;
}

export interface UpdateExpensePayload {
  amount?: number;
  allocationType?: AllocationType;
}

/** One day in a budget series response — sparse (server returns only days with spend). */
export interface BudgetDayPoint {
  /** Civil date YYYY-MM-DD (Asia/Jakarta). */
  date: string;
  /** Sum of expense amounts (IDR) on that civil day within the budget range. */
  total: number;
}

/** GET /api/budgets/active/series response — { days: [...] } (empty when no active budget). */
export interface BudgetSeriesResponse {
  days: BudgetDayPoint[];
}

export interface LoginResponse {
  token: string;
  expiresInMs: number;
}

export interface ApiErrorBody {
  error: string;
}
