import { IS_TAURI } from "./tauri";

/**
 * Key-value config storage on top of the bundled SQLite (Tauri build only).
 *
 * Currently holds the local PIN gate (`pin_salt`, `pin_hash`) — see
 * hooks/useLocalLockFlow.ts. This is device-local convenience state, NOT a
 * cloud-syncable user record (plan §3: no accounts in MVP).
 */

/** plugin-sql exports Database as the module's default export. */
interface SqlPluginModule {
  default: {
    load(key: string): Promise<ConfigDatabase>;
  };
}

interface ConfigDatabase {
  select<T>(query: string, bindValues?: unknown[]): Promise<T[]>;
  execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }>;
}

const DB_KEY = "sqlite:expense.db";

let dbPromise: Promise<ConfigDatabase> | null = null;

async function db(): Promise<ConfigDatabase> {
  if (!dbPromise) {
    dbPromise = import("@tauri-apps/plugin-sql").then(
      (plugin) => (plugin as unknown as SqlPluginModule).default.load(DB_KEY),
    );
  }
  return dbPromise;
}

/** Read one config value, or null when unset / not in the Tauri runtime. */
export async function localConfigGet(key: string): Promise<string | null> {
  if (!IS_TAURI) return null;
  try {
    const database = await db();
    const rows = await database.select<{ value: string }>(
      `SELECT value FROM app_config WHERE key = ?`,
      [key],
    );
    return rows[0]?.value ?? null;
  } catch (cause) {
    console.error("[localConfig] get failed", key, cause);
    return null;
  }
}

/** Write one config value (upsert). Throws only in unexpected DB failures. */
export async function localConfigSet(key: string, value: string): Promise<void> {
  if (!IS_TAURI) return;
  const database = await db();
  await database.execute(
    `INSERT INTO app_config (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
