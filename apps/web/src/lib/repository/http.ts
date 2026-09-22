import type {
  CreateExpensePayload,
  ExpenseListResponse,
  UpdateExpensePayload,
} from "@expense-app/shared";

import { expensesApi } from "../api";
import type { ExpenseRepository } from "./types";

/**
 * HTTP-backed adapter for the web app. Thin by design: the existing
 * `expensesApi` keeps owning auth headers, offline semantics and error
 * classes, so web behavior (and every existing test that mocks `../lib/api`)
 * is unchanged. Tauri migration plan §11 — the native build never uses this.
 */
export const httpExpenseRepository: ExpenseRepository = {
  list(from: string, to: string): Promise<ExpenseListResponse> {
    // The API marks the request with the client instant (server-clock anchor
    // for the offline layer); harmless for the repository contract.
    return expensesApi.list(from, to, new Date().toISOString());
  },
  create(payload: CreateExpensePayload) {
    return expensesApi.create(payload);
  },
  update(id: string, payload: UpdateExpensePayload) {
    return expensesApi.update(id, payload);
  },
  delete(id: string) {
    return expensesApi.remove(id);
  },
  async total(from: string, to: string): Promise<number> {
    // No dedicated endpoint — the server includes the total in list responses.
    const response = await expensesApi.list(from, to, new Date().toISOString());
    return response.total;
  },
};
