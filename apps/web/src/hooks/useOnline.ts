import { useCallback, useEffect, useState } from "react";

import { isOnline } from "../lib/api";

/**
 * Live connectivity state (plan §7). Tracks navigator.onLine plus an optional
 * liveness probe result so the truth is not merely navigator.onLine: a failed
 * fetch (OfflineError) can mark the connection dead even when the browser
 * still reports online.
 */
export function useOnline(probe?: { failed?: boolean }): boolean {
  const [online, setOnline] = useState<boolean>(() => isOnline() && !(probe?.failed ?? false));

  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online && !(probe?.failed ?? false);
}
