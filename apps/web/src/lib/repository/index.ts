import type { ExpenseRepository, RepositoryKind } from "./types";

import { httpExpenseRepository } from "./http";

export type { ExpenseRepository, RepositoryKind } from "./types";

/**
 * Backend selection (online-first): every runtime — browser PWA, Tauri
 * desktop, Tauri mobile — talks to the same API. The server is the source of
 * truth; offline resilience lives in the IDB outbox + sync layer. Swapping
 * backends later means changing only this file.
 */
export function getExpenseRepository(): ExpenseRepository & { kind: RepositoryKind } {
  return { ...httpExpenseRepository, kind: "http" };
}

/** Stable instances so hook identity/caching is predictable. */
export const expensesRepository = getExpenseRepository();

export { httpExpenseRepository };
