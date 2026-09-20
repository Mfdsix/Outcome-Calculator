import type { ExpenseRepository, RepositoryKind } from "./types";

import { httpExpenseRepository } from "./http";
import { localExpenseRepository } from "./local";
import { IS_TAURI } from "../tauri";

export type { ExpenseRepository, RepositoryKind } from "./types";

/**
 * Backend selection (Tauri migration plan §5): the browser build keeps the
 * API-backed repository; the Tauri build talks to bundled SQLite. Swapping
 * backends later (e.g. adding a SyncRepository, plan §19) means changing
 * only this file.
 */
export function getExpenseRepository(): ExpenseRepository & { kind: RepositoryKind } {
  return IS_TAURI
    ? { ...localExpenseRepository, kind: "local" }
    : { ...httpExpenseRepository, kind: "http" };
}

/** Stable instances so hook identity/caching is predictable. */
export const expensesRepository = getExpenseRepository();

export { localExpenseRepository, httpExpenseRepository };
