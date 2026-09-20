/**
 * Tauri runtime detection.
 *
 * Tauri v2 injects `window.__TAURI_INTERNALS__` before any app code runs, so
 * a synchronous property check is reliable in every entry point. Everything
 * that must behave differently between the browser build (API-backed web
 * app) and the native build (local SQLite) branches on this flag.
 */
export function isTauriRuntime(): boolean {
  try {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  } catch {
    return false;
  }
}

/** Module-level snapshot — the runtime never changes mid-session. */
export const IS_TAURI = isTauriRuntime();
