import { useCallback, useEffect, useState } from "react";

import type { LockFlow } from "../app/App";

import { localConfigGet, localConfigSet } from "../lib/localConfig";
import { invokePinHash, newSaltHex } from "../lib/pinHash";
import { IS_TAURI } from "../lib/tauri";

/**
 * Local PIN gate for the Tauri build (migration plan §3/§15 — no accounts).
 *
 * This is a privacy screen, NOT authentication: the scrypt hash + salt live
 * in the device's own SQLite (`app_config`), so anyone with device access
 * and the patience to open the DB file can bypass it. It exists so a shared
 * or borrowed phone does not casually reveal the expense history.
 *
 * Flow reuses the existing LockScreen/NewPinDialog contract:
 * - no stored PIN  → first PIN goes through the "new-pin" confirm dialog,
 *   then is hashed and stored → unlocked.
 * - stored PIN     → verify against the stored hash (constant-ish compare
 *   on short digests; timing side-channels are out of scope for a screen
 *   gate) → unlock or "PIN salah.".
 *
 * In the browser runtime every method no-ops and the hook reports locked —
 * App uses the real auth flow there instead.
 */
export function useLocalLockFlow(): LockFlow {
  const [unlocked, setUnlocked] = useState(false);
  const [stage, setStage] = useState<LockFlow["stage"]>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);
  /** Null = boot check not finished yet; LockScreen stays out of the way. */
  const [hasPin, setHasPin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    void localConfigGet("pin_hash").then((hash) => {
      if (cancelled) return;
      setHasPin(hash !== null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitPin = useCallback(
    async (pin: string) => {
      if (!IS_TAURI || busy) return;
      setBusy(true);
      setError(null);
      try {
        const storedHash = await localConfigGet("pin_hash");
        if (storedHash === null) {
          // First run: hold for explicit confirmation before creating.
          setPendingPin(pin);
          setStage("new-pin");
          return;
        }
        const salt = await localConfigGet("pin_salt");
        if (!salt) {
          setError("Data PIN rusak. Hubungi pengembang.");
          return;
        }
        const hash = await invokePinHash(pin, salt);
        if (hash === storedHash) {
          setError(null);
          setStage("locked");
          setUnlocked(true);
        } else {
          setError("PIN salah.");
        }
      } catch (cause) {
        console.error("[localLock] submit failed", cause);
        setError("Gagal memverifikasi PIN.");
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const confirmNewPin = useCallback(async () => {
    if (!IS_TAURI || !pendingPin || busy) return;
    setBusy(true);
    try {
      const salt = newSaltHex();
      const hash = await invokePinHash(pendingPin, salt);
      await localConfigSet("pin_salt", salt);
      await localConfigSet("pin_hash", hash);
      setPendingPin(null);
      setStage("locked");
      setError(null);
      setHasPin(true);
      setUnlocked(true);
    } catch (cause) {
      console.error("[localLock] create pin failed", cause);
      setError("Gagal membuat PIN. Coba lagi.");
      setStage("locked");
    } finally {
      setBusy(false);
    }
  }, [busy, pendingPin]);

  const cancelNewPin = useCallback(() => {
    setPendingPin(null);
    setStage("locked");
    setError(null);
  }, []);

  const logout = useCallback(() => {
    // Screen gate: locking hides the data but keeps it on device.
    setUnlocked(false);
    setStage("idle");
    setError(null);
  }, []);

  if (!IS_TAURI) {
    return {
      unlocked: false,
      stage: "idle",
      busy: false,
      error: null,
      pendingMask: "••••••",
      submitPin,
      confirmNewPin,
      cancelNewPin,
      logout,
    };
  }

  return {
    unlocked: hasPin !== null && unlocked,
    stage,
    busy: busy || hasPin === null, // stay busy while the boot check runs
    error,
    pendingMask: "••••••",
    submitPin,
    confirmNewPin,
    cancelNewPin,
    logout,
  };
}
