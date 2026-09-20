import { useCallback, useEffect, useRef, useState } from "react";

import { OfflineError, isOnline, loadToken } from "../lib/api";
import { readOutbox, type OutboxOp } from "../lib/offlineDb";
import { drainOutbox } from "../lib/sync";

/**
 * Auto-sync lifecycle (plan §6): drains the FIFO outbox on window online,
 * tab visibility, a `trigger` change (mount day / after each mutation) and a
 * 30s poll while ops are pending. Exposes pending/syncing state for the UI.
 */
export function useSync(opts: {
  enabled: boolean;
  /** Bump to force a drain attempt (mount day / after each mutation). */
  trigger: number;
  /** Called with the first message when ops were dropped (404/4xx). */
  onDropped?: (message: string) => void;
  /** Called when the drain hit 401 — App should lock. */
  onUnauthorized?: () => void;
  /** Called when the drain stopped due to the network still being down. */
  onOffline?: () => void;
}): { pending: number; syncing: boolean } {
  const { enabled, trigger } = opts;

  // Callbacks are read through refs so `drain` keeps a stable identity and
  // effects below don't refire on every render.
  const onDroppedRef = useRef(opts.onDropped);
  const onUnauthorizedRef = useRef(opts.onUnauthorized);
  const onOfflineRef = useRef(opts.onOffline);
  useEffect(() => {
    onDroppedRef.current = opts.onDropped;
    onUnauthorizedRef.current = opts.onUnauthorized;
    onOfflineRef.current = opts.onOffline;
  });

  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // Single-flight guard: online/visibility/trigger/poll can all fire at once;
  // drainOutbox must never run concurrently (FIFO replay would double-send).
  const inFlightRef = useRef(false);

  const drain = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    if (!isOnline()) return; // offline → a fetch is doomed; wait for `online`
    const token = loadToken();
    if (!token) return;
    inFlightRef.current = true;
    setSyncing(true);
    try {
      const result = await drainOutbox(token);
      if (result.authFailed) onUnauthorizedRef.current?.();
      if (result.dropped > 0) {
        onDroppedRef.current?.(result.validationErrors[0] ?? "Beberapa perubahan offline ditolak server.");
      }
      if (result.remaining > 0) onOfflineRef.current?.();
    } catch (cause) {
      if (cause instanceof OfflineError) onOfflineRef.current?.();
    } finally {
      const ops: OutboxOp[] = await readOutbox(token);
      setPending(ops.length);
      setSyncing(false);
      inFlightRef.current = false;
    }
  }, []);

  // Recount on mount / when enabled flips on.
  useEffect(() => {
    if (!enabled) return;
    void readOutbox(loadToken() ?? "").then((ops) => setPending(ops.length));
  }, [enabled]);

  // Drain on trigger bumps (mount day / after each offline mutation).
  useEffect(() => {
    if (!enabled || trigger === 0) return;
    void drain();
  }, [enabled, trigger, drain]);

  // Window online + visibility drains.
  useEffect(() => {
    if (!enabled) return;
    const onOnline = (): void => {
      void drain();
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void drain();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, drain]);

  // 30s poll while ops are pending.
  useEffect(() => {
    if (!enabled || pending === 0) return;
    const timer = window.setInterval(() => {
      void drain();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [enabled, pending, drain]);

  return { pending, syncing };
}
