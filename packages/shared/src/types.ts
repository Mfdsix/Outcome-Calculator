export interface ExpenseDto {
  id: string;
  /** Integer IDR amount, never a formatted string. */
  amount: number;
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
  /** Optional; backend uses current server time when omitted. */
  occurredAt?: string;
}

export interface UpdateExpensePayload {
  amount: number;
}

export interface LoginResponse {
  token: string;
  expiresInMs: number;
}

export interface ApiErrorBody {
  error: string;
}
