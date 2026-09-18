import type {
  BudgetActiveResponse,
  BudgetHistoryItem,
  CreateBudgetPayload,
  CreateExpensePayload,
  ExpenseDto,
  ExpenseListResponse,
  UpdateExpensePayload,
} from "@expense-app/shared";

/**
 * Single API abstraction (spec §26). Components never call fetch directly;
 * swap the backend by changing only this file.
 */

const baseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

const TOKEN_KEY = "expense-app.token";
const LAST_VISIT_KEY = "expense-app.last-visit";

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable (private mode) — keep token in memory only
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function readLastVisit(): number {
  try {
    return Number(localStorage.getItem(LAST_VISIT_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

export function writeLastVisit(timestamp: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(timestamp));
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Thrown when a request fails due to auth; the app reacts by locking. */
export class UnauthorizedError extends Error {}

let authToken: string | null = loadToken();

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) saveToken(token);
  else clearToken();
}

export function hasAuthToken(): boolean {
  return authToken !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Could not save expense.\nTry again.");
  }

  if (response.status === 401) {
    throw new UnauthorizedError("Unauthorized.");
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  const data = (await response.json()) as T;

  // NaN guard (spec plan §5): normalize amounts at the boundary so
  // non-finite values never reach the UI. Drop non-finite rows from lists.
  if (Array.isArray(data)) {
    return data.filter((item) => {
      if (item && typeof item === "object" && "amount" in item) {
        const amount = Number((item as { amount: unknown }).amount);
        return Number.isFinite(amount);
      }
      return true;
    }) as T;
  }
  if (data && typeof data === "object" && "amount" in data) {
    const amount = Number((data as { amount: unknown }).amount);
    if (!Number.isFinite(amount)) {
      (data as { amount: number }).amount = 0;
    }
  }
  if (data && typeof data === "object" && "expenses" in data) {
    const list = (data as { expenses: unknown }).expenses;
    if (Array.isArray(list)) {
      (data as { expenses: unknown[] }).expenses = list.filter(
        (item) =>
          !(item && typeof item === "object" && "amount" in item && !Number.isFinite(Number((item as { amount: unknown }).amount))),
      );
    }
  }

  return data;
}

export type LoginOk = { status: "ok"; token: string; expiresInMs: number };
export type LoginNewPin = { status: "new_pin" };
export type LoginResult = LoginOk | LoginNewPin;

export const authApi = {
  /**
   * Login with a PIN identity. A known PIN verifies and returns a token;
   * a never-seen PIN answers "needsConfirm" so the UI can ask before
   * creating a new user space (anti salah-ketik-jadi-identitas).
   */
  async login(pin: string, confirm = false): Promise<LoginResult> {
    const response = await request<
      { token: string; expiresInMs: number } | { needsConfirm: true }
    >("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ pin, ...(confirm ? { confirm: true } : {}) }),
    });

    if ("needsConfirm" in response) {
      return { status: "new_pin" };
    }

    setAuthToken(response.token);
    writeLastVisit();
    return { status: "ok", token: response.token, expiresInMs: response.expiresInMs };
  },

  /**
   * Refresh the session token (20h TTL). Non-rotating: the old token stays
   * valid until its own exp. 401 → UnauthorizedError → re-lock path.
   */
  async refresh(): Promise<{ token: string; expiresInMs: number }> {
    const response = await request<{ token: string; expiresInMs: number }>(
      "/api/auth/refresh",
      { method: "POST" },
    );
    setAuthToken(response.token);
    writeLastVisit();
    return response;
  },

  /**
   * Deactivate this account (soft delete). Verifies the PIN server-side:
   * 401 → wrong PIN (ApiError, dialog stays open); on success the token
   * becomes invalid immediately — the caller clears it and re-locks.
   */
  async deactivate(pin: string): Promise<void> {
    await request<{ ok: boolean }>("/api/auth/deactivate", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
  },
};

/**
 * Budget endpoints (plan §4) — mirrors expensesApi conventions. The server
 * computes spent/remaining/status; copy = plain create (auto-replaces the
 * active budget, history keeps the old one).
 */
export const budgetsApi = {
  getActive(): Promise<BudgetActiveResponse> {
    return request<BudgetActiveResponse>("/api/budgets/active");
  },

  history(limit = 20): Promise<{ history: BudgetHistoryItem[] }> {
    const query = new URLSearchParams({ limit: String(limit) });
    return request<{ history: BudgetHistoryItem[] }>(`/api/budgets/history?${query.toString()}`);
  },

  create(payload: CreateBudgetPayload): Promise<{ id: string }> {
    return request<{ id: string }>("/api/budgets", {
      method: "POST",
      body: JSON.stringify({ ...payload }),
    });
  },

  async remove(): Promise<void> {
    await request<void>("/api/budgets/active", { method: "DELETE" });
  },
};

export const expensesApi = {
  list(from: string, to: string): Promise<ExpenseListResponse> {
    const query = new URLSearchParams({ from, to });
    return request<ExpenseListResponse>(`/api/expenses?${query.toString()}`);
  },

  create(payload: CreateExpensePayload): Promise<ExpenseDto> {
    return request<ExpenseDto>("/api/expenses", {
      method: "POST",
      body: JSON.stringify({ ...payload }),
    });
  },

  update(id: string, payload: UpdateExpensePayload): Promise<ExpenseDto> {
    return request<ExpenseDto>(`/api/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...payload }),
    });
  },

  async remove(id: string): Promise<void> {
    await request<void>(`/api/expenses/${id}`, { method: "DELETE" });
  },
};
