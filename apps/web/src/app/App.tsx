import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TOKEN_REFRESH_MIN_INTERVAL_MS,
  getZonedParts,
  formatDateShort,
  formatTimeShort,
} from "@expense-app/shared";
import type { AllocationType, ExpenseDto } from "@expense-app/shared";

import { AmountDisplay } from "../components/AmountDisplay";
import { AdvancedControls } from "../components/AdvancedControls";
import { BarChart } from "../components/BarChart";
import { BrowseList, type BrowseRow } from "../components/BrowseList";
import { BudgetScreen } from "../components/BudgetScreen";
import { ConnIndicator } from "../components/ConnIndicator";
import { DeleteDialog } from "../components/DeleteDialog";
import { EditActions } from "../components/EditActions";
import { Header } from "../components/Header";
import { InsightScreen } from "../components/InsightScreen";
import { InsightTicker } from "../components/InsightTicker";
import { Keypad } from "../components/Keypad";
import { NewPinDialog } from "../components/NewPinDialog";
import { PeriodSelector } from "../components/PeriodSelector";
import { LockScreen } from "../components/LockScreen";
import { SummaryList } from "../components/SummaryList";
import { UnsavedDialog } from "../components/UnsavedDialog";
import { UpdateDialog } from "../components/UpdateDialog";
import { UpdateBanner } from "../components/UpdateBanner";
import { UserMenu } from "../components/UserMenu";
import { useBudget } from "../hooks/useBudget";
import { useCalculator } from "../hooks/useCalculator";
import { useExpenses } from "../hooks/useExpenses";
import { useInsights } from "../hooks/useInsights";
import { useOnline } from "../hooks/useOnline";
import { useSync } from "../hooks/useSync";
import {
  ApiError,
  isOnline,
  loadToken,
  OfflineError,
  UnauthorizedError,
  authApi,
  setAuthToken,
} from "../lib/api";
import { expensesRepository } from "../lib/repository";
import { dailyBuckets, groupExpensesByDay, hourlyBuckets, twoDayBuckets } from "../lib/chart";
import { formatIDR, groupDigits } from "../lib/currency";
import { digitKeyTestId, keyEl, triggerClicky } from "../lib/clicky";
import { mutateOutbox, mutateTodayCache } from "../lib/offlineDb";
import { APP_TIMEZONE, currentPeriodRange } from "../lib/periods";
import { applyTheme } from "../lib/theme";
import { relativeDayLabel } from "../lib/dayLabels";
import { queueOfflineCreate, queueOfflineDelete, queueOfflineUpdate } from "../lib/sync";
import type { EditOrigin, Period } from "../types/ui";

const LAST_VISIT_KEY = "expense-app.last-visit";

/** Civil day key (YYYY-MM-DD) from zoned parts, in APP_TIMEZONE semantics. */
function dayKeyOf(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Base64url decode (JWT payload segments). */
function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  // UTF-8 decode
  return decodeURIComponent(
    Array.from(binary, (char) => `%${("00" + char.charCodeAt(0).toString(16)).slice(-2)}`).join(""),
  );
}

/** Outbox namespace: the JWT `sub` (userId) so re-login switches queues. */
function outboxNamespace(): string {
  const token = loadToken();
  if (!token) return "";
  const parts = token.split(".");
  if (parts.length < 2 || parts[1]!.length === 0) return token;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : token;
  } catch {
    return token;
  }
}

/** True when a mutation failed because the network was unavailable (status 0). */
function isOfflineCause(cause: unknown): boolean {
  return cause instanceof OfflineError || (cause instanceof ApiError && cause.status === 0);
}

/**
 * App shell (locked special-mode contract):
 * lock → default "half-D" calculator (Header / AmountDisplay / navbar /
 * hourly BarChart / calc Keypad) → special D/W/M browse (navbar +
 * SummaryList/BrowseList + chart selectedKey + nav Keypad + drill-down)
 * with DeleteDialog, keyboard support and 401 → re-lock.
 * The user menu lives in the Header trailing cluster; the period selector is
 * a pure D/W/M switcher — tapping any period from calculator opens history;
 * tapping the active green period from history returns home.
 * Session: 20h token with ≥1h-interval visit refresh.
 * Offline (plan §4–§7): Today CRUD queues into an IDB outbox and shows a
 * pending badge; Week/Month stay online-only; the connection indicator in the
 * Header reflects online state + sync progress.
 */
export default function App() {
  // Online-first: every runtime (browser PWA + Tauri) authenticates against
  // the API with the same PIN → server-issued token flow.
  const lock = useLockFlow();

  // Sync the persisted theme onto <html> (main.tsx pre-paints; this keeps the
  // class correct if storage changed while the tab stayed open).
  useEffect(() => {
    applyTheme();
  }, []);

  if (!lock.unlocked) {
    return (
      <>
        <LockScreen onSubmit={lock.submitPin} error={lock.error} busy={lock.busy} />
        {lock.stage === "new-pin" && (
          <NewPinDialog
            pinMask={lock.pendingMask}
            busy={lock.busy}
            onCancel={lock.cancelNewPin}
            onConfirm={() => void lock.confirmNewPin()}
          />
        )}
      </>
    );
  }
  return <AppBody logout={lock.logout} />;
}

// ---------------------------------------------------------------------------
// Lock flow + session visit refresh
// ---------------------------------------------------------------------------

export interface LockFlow {
  unlocked: boolean;
  stage: "idle" | "locked" | "new-pin";
  busy: boolean;
  error: string | null;
  pendingMask: string;
  submitPin: (pin: string) => Promise<void>;
  confirmNewPin: () => Promise<void>;
  cancelNewPin: () => void;
  logout: () => void;
}

function useLockFlow(): LockFlow {
  // A persisted token counts as a session; validity is enforced by the API
  // (401 → re-lock) rather than an upfront ping. The token also stays as the
  // offline key: locked app still opens offline (plan §5).
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem("expense-app.token") !== null;
    } catch {
      return false;
    }
  });
  const [stage, setStage] = useState<LockFlow["stage"]>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPin, setPendingPin] = useState<string | null>(null);

  const doLogin = useCallback(async (pin: string, confirm: boolean): Promise<void> => {
    const result = await authApi.login(pin, confirm);
    if (result.status === "new_pin") {
      // Unknown PIN: hold for explicit confirmation (anti typo-jadi-identitas).
      setPendingPin(pin);
      setStage("new-pin");
      return;
    }
    setPendingPin(null);
    setStage("locked");
    setError(null);
    setUnlocked(true);
  }, []);

  const submitPin = useCallback(
    async (pin: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await doLogin(pin, false);
      } catch (cause) {
        setError(
          cause instanceof ApiError && cause.status === 429
            ? "Terlalu banyak percobaan. Coba lagi nanti."
            : "PIN salah.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, doLogin],
  );

  const confirmNewPin = useCallback(async () => {
    if (!pendingPin || busy) return;
    setBusy(true);
    try {
      await doLogin(pendingPin, true);
    } catch {
      setError("Gagal membuat ruang baru. Coba lagi.");
      setStage("locked");
    } finally {
      setBusy(false);
    }
  }, [busy, doLogin, pendingPin]);

  const cancelNewPin = useCallback(() => {
    setPendingPin(null);
    setStage("locked");
    setError(null);
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUnlocked(false);
    setStage("idle");
    setError(null);
  }, []);

  // Visit effect (plan §3): on mount + when the tab becomes visible, refresh
  // the token if ≥1h since the last visit. Fresh visit → silent; stale →
  // refresh; 401 → locked out; offline → skipped silently (retry next visit);
  // network error → silent (retry next visit).
  useEffect(() => {
    if (!unlocked) return;

    let cancelled = false;

    const visit = async (): Promise<void> => {
      let last = 0;
      try {
        last = Number(localStorage.getItem(LAST_VISIT_KEY) ?? "0") || 0;
      } catch {
        last = 0;
      }
      if (Date.now() - last < TOKEN_REFRESH_MIN_INTERVAL_MS) return; // fresh → silent
      if (!isOnline()) return; // offline → keep the session, retry later

      try {
        await authApi.refresh(); // writes lastVisit on success (lib/api)
      } catch (cause) {
        if (cause instanceof UnauthorizedError) {
          if (!cancelled) logout(); // expired/invalid → locked
          return;
        }
        // Network failure → stay unlocked, retry on next visit.
        return;
      }
    };

    void visit();
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void visit();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [unlocked, logout]);

  return {
    unlocked,
    stage,
    busy,
    error,
    pendingMask: "••••••",
    submitPin,
    confirmNewPin,
    cancelNewPin,
    logout,
  };
}

// ---------------------------------------------------------------------------
// Unlocked app body
// ---------------------------------------------------------------------------

function AppBody({ logout }: { logout: () => void }) {
  const {
    period,
    viewMode,
    specialPanel,
    selectedKey,
    expenses,
    totalLabel,
    periodLabel,
    loading,
    openHistory,
    closeHistory,
    setViewMode: setViewModeExternal,
    setSelectedKey,
    enterDrill,
    exitDrill,
    applyOptimisticCreate,
    revertOptimisticCreate,
    applyOptimisticUpdate,
    applyOptimisticDelete,
    renameExpenseId,
    refresh,
    markPending,
    pendingIds,
    showingCachedDay,
    dayFetchFailed,
    wmOfflineRejected,
  } = useExpenses();

  const calc = useCalculator();
  const budget = useBudget();
  const { getStatusNow } = budget;

  /** Today's civil-day total (Jakarta) from the live list — optimistic and
   * offline-cache friendly; feeds the insight engine with zero fetches.
   * Raw sum as-is: allocation never affects totals. */
  const todayTotal = useMemo(() => {
    const { from, to } = currentPeriodRange("day");
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return expenses.reduce((sum, item) => {
      const at = new Date(item.occurredAt).getTime();
      return at >= fromMs && at < toMs ? sum + item.amount : sum;
    }, 0);
  }, [expenses]);
  const { insights } = useInsights(budget.active, todayTotal);
  const [flash, setFlash] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<{ id: string; amount: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [drillDayKey, setDrillDayKey] = useState<string | null>(null);
  const [editOrigin, setEditOrigin] = useState<EditOrigin | null>(null);
  const [showUnsaved, setShowUnsaved] = useState(false);
  const [budgetNotice, setBudgetNotice] = useState<false | "warning" | "over">(false);
  const [enterFlash, setEnterFlash] = useState<false | "warning" | "over">(false);
  const [insightTickerVisible, setInsightTickerVisible] = useState(true);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSpecial = viewMode === "special";
  const isBudget = viewMode === "budget";
  const isInsight = viewMode === "insight";
  // Plain calculator screen: budget/insight/special history own the full body
  // and must not share the row with the period strip or amount input.
  const isHomeScreen = !isSpecial && !isBudget && !isInsight;

  // --- Connectivity + auto-sync (plan §6–§7) ---------------------------------

  const online = useOnline({ failed: dayFetchFailed });
  const [syncTrigger, setSyncTrigger] = useState(0);
  const bumpSync = useCallback(() => setSyncTrigger((value) => value + 1), []);
  const drainMsgRef = useRef<string | null>(null);
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  const showError = useCallback((message: string) => {
    setBanner(message);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }, []);

  const onDropped = useCallback(
    (message: string) => {
      if (!message || drainMsgRef.current === message) return;
      drainMsgRef.current = message;
      showError(message);
      window.setTimeout(() => {
        drainMsgRef.current = null;
      }, 4500);
    },
    [showError],
  );

  const { pending, syncing } = useSync({
    enabled: true,
    trigger: syncTrigger,
    onDropped,
    onUnauthorized: () => logoutRef.current(),
  });

  // Back online → reload the authoritative list (also clears cache staleness).
  // Spec §Adv-4: also refresh W/M periods when back online.
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    if (online && !prevOnlineRef.current) {
      void refresh();
    }
    prevOnlineRef.current = online;
  }, [online, refresh]);

  // Outbox drained → reload the day so temp rows become server rows.
  const prevPendingRef = useRef(0);
  useEffect(() => {
    if (prevPendingRef.current > 0 && pending === 0 && online && period === "day") {
      void refresh();
    }
    prevPendingRef.current = pending;
  }, [pending, online, period, refresh]);

  // W/M refused while offline → hint banner.
  useEffect(() => {
    if (wmOfflineRejected) showError("Butuh internet untuk Week/Month.");
  }, [wmOfflineRejected, showError]);

  const inDrill = specialPanel === "drill";

  const doFlash = useCallback(() => {
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 350);
  }, []);

  /** Budget screen errors surface through the same banner (soft, plan §4). */
  useEffect(() => {
    if (budget.error) showError(budget.error);
  }, [budget.error, showError]);

  /** Refresh budget aggregates whenever expenses change (plan §4: refresh on
   * create/update/delete expense so spent/remaining stay live). */
  useEffect(() => {
    budget.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses]);

  useEffect(() => {
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  /** Post-Enter budget feedback (plan §3): soft toast warning/over + Enter
   * blink. Best-effort, never blocks the input; silent without a budget. */
  const announceBudgetStatus = useCallback(async () => {
    const budget = await getStatusNow();
    if (budget === null || budget.status === "ok") return;
    setBudgetNotice(budget.status);
    setEnterFlash(budget.status);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      setBudgetNotice(false);
      setEnterFlash(false);
    }, 3000);
  }, [getStatusNow]);

  /** In drill mode the transaction-facing selection lives in a second slot
   * so the bucket selection (chart) is preserved for when we go back up. */
  const transactionKeyRef = useRef<string | null>(null);
  if (inDrill && selectedKey !== null && expenses.some((item) => item.id === selectedKey)) {
    transactionKeyRef.current = selectedKey;
  }
  const transactionKey = transactionKeyRef.current;

  const clearEditOrigin = useCallback(() => setEditOrigin(null), []);

  /** Restore history state captured in editOrigin (period + panel + selection). */
  const restoreHistory = useCallback(
    (origin: EditOrigin | null) => {
      if (!origin) return;
      openHistory(origin.period);
      if (origin.panel === "drill" && origin.drillDayKey) {
        setDrillDayKey(origin.drillDayKey);
        enterDrill();
      }
      setSelectedKey(origin.selectedKey);
    },
    [openHistory, enterDrill, setSelectedKey],
  );

  const handleEditBack = useCallback(() => {
    const original =
      calc.editingId !== null ? expenses.find((item) => item.id === calc.editingId) : undefined;
    const dirty =
      calc.isEditing &&
      calc.editingId !== null &&
      original !== undefined &&
      (calc.amount !== original.amount || calc.allocationType !== (original.allocationType ?? "NONE"));
    if (dirty) {
      setShowUnsaved(true);
      return;
    }
    calc.clear();
    restoreHistory(editOrigin);
    clearEditOrigin();
  }, [calc, expenses, editOrigin, restoreHistory, clearEditOrigin]);

  // --- Offline outbox helpers (plan §4/§6) ------------------------------------

  /** Offline create+update coalesce at the queue: rewrite the temp create. */
  const applyTempAmount = useCallback(async (tempId: string, amount: number) => {
    const token = loadToken();
    if (!token) return;
    await mutateOutbox(token, (ops) => {
      const next = ops.map((op) =>
        op.type === "create" && op.tempId === tempId
          ? { ...op, payload: { ...op.payload, amount } }
          : op,
      );
      return { ops: next, result: next.length };
    });
    await mutateTodayCache((cache) => {
      const previous = cache.expenses.find((item) => item.id === tempId);
      const delta = previous ? amount - previous.amount : 0;
      return {
        ...cache,
        expenses: cache.expenses.map((item) => (item.id === tempId ? { ...item, amount } : item)),
        total: cache.total + delta,
      };
    });
  }, []);

  /** Offline create+delete coalesce at the queue: drop the whole temp chain. */
  const dropTempChain = useCallback(async (tempId: string) => {
    const token = loadToken();
    if (!token) return;
    await mutateOutbox(token, (ops) => {
      const next = ops.filter((op) => op.tempId !== tempId && op.realId !== tempId);
      return { ops: next, result: next.length };
    });
    // Also purge the temp row from the snapshot (create+edit+delete offline).
    await mutateTodayCache((cache) => {
      const previous = cache.expenses.find((item) => item.id === tempId);
      return {
        ...cache,
        expenses: cache.expenses.filter((item) => item.id !== tempId),
        total: cache.total - (previous?.amount ?? 0),
      };
    });
  }, []);

  /** Patch the snapshot for an offline update/delete of a real row.
   * Totals stay raw sums as-is. */
  const patchCacheRow = useCallback(
    async (id: string, next: { amount: number; allocationType?: AllocationType } | null) => {
      await mutateTodayCache((cache) => {
        const previous = cache.expenses.find((item) => item.id === id);
        if (next === null) {
          return {
            ...cache,
            expenses: cache.expenses.filter((item) => item.id !== id),
            total: cache.total - (previous?.amount ?? 0),
          };
        }
        const updatedExpense = {
          ...previous,
          amount: next.amount,
          allocationType: next.allocationType ?? previous?.allocationType,
        } as ExpenseDto;
        return {
          ...cache,
          expenses: cache.expenses.map((item) =>
            item.id === id
              ? updatedExpense
              : item,
          ),
          total: cache.total - (previous?.amount ?? 0) + next.amount,
        };
      });
    },
    [],
  );

  /** Replace a local optimistic row id with the outbox temp id. */
  const replaceLocalId = useCallback(
    (localId: string, tempId: string, amount: number) => {
      renameExpenseId(localId, tempId);
    },
    [renameExpenseId],
  );

  /** Queue an offline create and swap the optimistic row onto the temp id. */
  const saveOfflineCreate = useCallback(
    async (amount: number, occurredAt: string, localId: string) => {
      const token = loadToken();
      if (!token) return;
      const tempId = await queueOfflineCreate(token, { amount, occurredAt, allocationType: "NONE" });
      replaceLocalId(localId, tempId, amount);
      markPending(tempId);
      // Persist into the today snapshot so an airplane reload keeps the row.
      await mutateTodayCache((cache) => ({
        ...cache,
        expenses: [{ id: tempId, amount, occurredAt, allocationType: "NONE" }, ...cache.expenses],
        total: cache.total + amount,
      }));
      bumpSync();
    },
    [queueOfflineCreate, replaceLocalId, markPending, bumpSync],
  );

  /** Commit a pending edit: optimistic update + API call + flash/error.
   * Extracted so handleEnter and UpdateDialog confirm share one path.
   * Includes allocationType from calc (spec §3: AdvancedControls). */
  const commitUpdate = useCallback(
    async (id: string, amount: number) => {
      const previous = expenses.find((item) => item.id === id);
      const optimistic = { ...previous, amount, allocationType: calc.allocationType } as ExpenseDto;
      if (previous) {
        applyOptimisticUpdate(optimistic);
      }
      const payload: { amount?: number; allocationType?: AllocationType } = {};
      if (amount !== previous?.amount) {
        payload.amount = amount;
      }
      if (calc.allocationType !== (previous?.allocationType ?? "NONE")) {
        payload.allocationType = calc.allocationType;
      }
      if (!online && previous && !previous.id.startsWith("temp-")) {
        const token = loadToken();
        if (token) {
          await queueOfflineUpdate(token, previous.id, { amount, allocationType: calc.allocationType });
          markPending(previous.id);
          await patchCacheRow(previous.id, { amount, allocationType: calc.allocationType });
          bumpSync();
          calc.clear();
          restoreHistory(editOrigin);
          clearEditOrigin();
          return;
        }
      }
      try {
        const saved = await expensesRepository.update(id, payload);
        applyOptimisticUpdate(saved);
        doFlash();
        // Amount is in — soft post-Enter budget feedback (plan §3).
        void announceBudgetStatus();
        calc.clear();
        restoreHistory(editOrigin);
        clearEditOrigin();
      } catch (cause) {
        if (cause instanceof UnauthorizedError) {
          if (previous) applyOptimisticUpdate(previous);
          logout();
          return;
        }
        if (isOfflineCause(cause) && previous) {
          // Offline: keep the optimistic amount and queue the mutation.
          if (previous.id.startsWith("temp-")) {
            await applyTempAmount(previous.id, amount);
          } else {
            const token = loadToken();
            if (token) {
              await queueOfflineUpdate(token, previous.id, { amount, allocationType: calc.allocationType });
              await patchCacheRow(previous.id, { amount, allocationType: calc.allocationType });
            }
          }
          markPending(previous.id);
          bumpSync();
          doFlash();
          calc.clear();
          restoreHistory(editOrigin);
          clearEditOrigin();
          return;
        }
        if (previous) applyOptimisticUpdate(previous);
        showError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
      }
    },
    [
      expenses,
      online,
      applyOptimisticUpdate,
      applyTempAmount,
      markPending,
      bumpSync,
      doFlash,
      logout,
      showError,
      calc,
      editOrigin,
      clearEditOrigin,
      restoreHistory,
      announceBudgetStatus,
    ],
  );

  const handleEnter = useCallback(async () => {
    const amount = calc.amount;
    if (amount <= 0) return;

    if (calc.isEditing && calc.editingId) {
      const id = calc.editingId;
      const previous = expenses.find((item) => item.id === id);
      if (previous && previous.amount === amount && (previous.allocationType ?? "NONE") === calc.allocationType) {
        // No change — dismiss edit silently.
        calc.clear();
        clearEditOrigin();
        restoreHistory(editOrigin);
        return;
      }
      if (previous && previous.amount === amount && (previous.allocationType ?? "NONE") !== calc.allocationType) {
        // AllocationType-only change — commit directly (no UpdateDialog needed).
        void commitUpdate(id, amount);
        return;
      }
      if (previous && (previous.amount !== amount || (previous.allocationType ?? "NONE") !== calc.allocationType)) {
        // Defer to UpdateDialog; keep the input so the user can review.
        setPendingUpdate({ id, amount });
        return;
      }
      return;
    }

    const occurredAt = new Date().toISOString();
    // Create from home is always NONE (spec §Adv-2: phase 1 budget/insight gap).
    const optimistic = {
      id: `optimistic-${Date.now()}`,
      amount,
      occurredAt,
      allocationType: "NONE" as const,
    };
    calc.clear();
    applyOptimisticCreate(optimistic);
    doFlash();
    // Amount is in — soft post-Enter budget feedback (plan §3).
    void announceBudgetStatus();

    if (!online) {
      await saveOfflineCreate(amount, occurredAt, optimistic.id);
      return;
    }

    try {
      const saved = await expensesRepository.create({ amount });
      revertOptimisticCreate(optimistic);
      applyOptimisticCreate(saved);
    } catch (cause) {
      if (cause instanceof UnauthorizedError) {
        revertOptimisticCreate(optimistic);
        logout();
        return;
      }
      if (isOfflineCause(cause)) {
        // Network dropped mid-flight: keep the row, queue for later sync.
        await saveOfflineCreate(amount, occurredAt, optimistic.id);
        return;
      }
      revertOptimisticCreate(optimistic);
      showError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
    }
  }, [
    calc,
    expenses,
    online,
    applyOptimisticCreate,
    revertOptimisticCreate,
    doFlash,
    logout,
    showError,
    saveOfflineCreate,
    editOrigin,
    clearEditOrigin,
    restoreHistory,
    announceBudgetStatus,
  ]);

  // --- Budget actions (plan §3) ----------------------------------------------

const openBudget = useCallback(() => {
  setViewModeExternal("budget");
}, [setViewModeExternal]);

const closeBudget = useCallback(() => {
  setViewModeExternal("calculator");
}, [setViewModeExternal]);

const openInsight = useCallback(() => {
  setViewModeExternal("insight");
}, [setViewModeExternal]);

const closeInsight = useCallback(() => {
  setViewModeExternal("calculator");
}, [setViewModeExternal]);

const handleBudgetCreate = useCallback(
  async (payload: { type: "full" | "daily"; amount: number; startDate: string; endDate: string }) =>
    budget.createBudget(payload),
  [budget],
);

const handleBudgetRemove = useCallback(async () => budget.removeBudget(), [budget]);

// --- Special-mode data -------------------------------------------------------

  const chartBuckets = useMemo(
    () =>
      period === "day"
        ? hourlyBuckets(expenses, new Date())
        : period === "week"
          ? dailyBuckets(period, currentPeriodRange(period), expenses, new Date())
          : twoDayBuckets(currentPeriodRange(period), expenses, new Date()),
    [period, expenses],
  );

  /**
   * Selection key fed to BarChart. In bucket-facing modes (W/M summary) the
   * selectedKey IS a bucket key. In transaction-facing modes (day summary /
   * drill) it is an expense id — derive the matching hour/day bucket so the
   * chart stays in sync without mixing id domains.
   */
  const chartSelectedKey = useMemo(() => {
    if (inDrill) {
      // Highlight the day being drilled.
      return drillDayKey;
    }
    if (period === "day") {
      const tx = expenses.find((item) => item.id === selectedKey);
      if (!tx) return selectedKey; // no selection yet — let BarChart fall back to current hour
      const parts = getZonedParts(new Date(tx.occurredAt), APP_TIMEZONE);
      return `${dayKeyOf(parts)}T${String(parts.hour).padStart(2, "0")}`;
    }
    if (period === "month") {
      // The list selects days but the chart shows pairs — highlight the pair
      // containing the selected day (or the pair itself as fallback).
      const pair = selectedKey
        ? chartBuckets.find((bucket) => bucket.key === selectedKey || bucket.endKey === selectedKey)
        : undefined;
      return pair?.key ?? selectedKey;
    }
    // W: selectedKey is already a bucket (day) key.
    return selectedKey;
  }, [inDrill, period, selectedKey, expenses, drillDayKey, chartBuckets]);

  /**
   * Day keys for W/M summary navigation, in the same descending order the sparse
   * SummaryList renders (newest first). The month list stays daily even though
   * its chart pairs days. Using this (instead of chartBuckets) keeps selection
   * + up/down + disabled state aligned to the rows actually shown, so the
   * highlight never vanishes on a zero-data day.
   */
  const navDayKeys = useMemo(() => {
    return groupExpensesByDay(expenses, currentPeriodRange(period)).map((d) => d.key);
  }, [expenses, period]);

  /** Month-drill pair coverage from the chart buckets (never date math). */
  const drillPairEndKey = useMemo(
    () =>
      period === "month" && inDrill && drillDayKey
        ? (chartBuckets.find((bucket) => bucket.key === drillDayKey)?.endKey ?? null)
        : null,
    [period, inDrill, drillDayKey, chartBuckets],
  );

  const moveTransactionSelection = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (expenses.length === 0) return;
      const index = expenses.findIndex((item) => item.id === selectedKey);
      const valid = index < 0 ? 0 : index;
      let next: number;
      if (direction === "up" || direction === "down") {
        next = direction === "up" ? Math.max(0, valid - 1) : Math.min(expenses.length - 1, valid + 1);
      } else {
        next = Math.min(expenses.length - 1, Math.max(0, valid + 1));
      }
      setSelectedKey(expenses[next]?.id ?? null);
    },
    [expenses, selectedKey, setSelectedKey],
  );

  const handleNavigate = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      switch (direction) {
        case "left": {
          if (period === "day" && !inDrill) return;
          openHistory(period === "week" ? "day" : "week");
          return;
        }
        case "right": {
          if (period === "month" && !inDrill) return;
          openHistory(period === "week" ? "month" : "week");
          return;
        }
        case "up":
        case "down": {
          if (inDrill) {
            moveTransactionSelection(direction);
            return;
          }
           if (period === "day") {
             moveTransactionSelection(direction);
             return;
           }
            const keys = navDayKeys;
            if (keys.length === 0) return;
           const index = keys.indexOf(selectedKey ?? "");
           const valid = index < 0 ? 0 : index;
           const next = direction === "up" ? Math.max(0, valid - 1) : Math.min(keys.length - 1, valid + 1);
           setSelectedKey(keys[next] ?? null);
           return;
         }
       }
     },
     [openHistory, period, inDrill, moveTransactionSelection, navDayKeys, selectedKey, setSelectedKey],
   );

  const navDisabled = useMemo<Partial<Record<"up" | "down" | "left" | "right", boolean>>>(() => {
    const domainKeys =
      inDrill || period === "day"
        ? expenses.map((e) => e.id)
        : navDayKeys;

    if (domainKeys.length === 0) {
      return {
        up: true,
        down: true,
        left: period === "day" && !inDrill,
        right: period === "month" && !inDrill,
      };
    }
    const idx = domainKeys.indexOf(selectedKey ?? "");
    const valid = idx < 0 ? 0 : idx;
    const last = domainKeys.length - 1;

    return {
      up: valid === 0,
      down: valid === last,
      left: period === "day" && !inDrill,
      right: period === "month" && !inDrill,
    };
  }, [inDrill, period, expenses, chartBuckets, navDayKeys, selectedKey]);

  const handleEdit = useCallback(() => {
    const id = inDrill ? transactionKey : selectedKey;
    const expense = expenses.find((item) => item.id === id);
    if (!expense) return;
    setEditOrigin({ period, panel: specialPanel, drillDayKey, selectedKey });
    calc.startEdit(expense.id, expense.amount, expense.allocationType);
    closeHistory();
  }, [calc, expenses, inDrill, period, specialPanel, drillDayKey, selectedKey, closeHistory, transactionKey]);

  const handleSpecialEnter = useCallback(() => {
    // Drill / day-summary: Enter edits the selected transaction directly.
    if (inDrill || period === "day") {
      handleEdit();
      return;
    }
    const fallback = chartBuckets.find((bucket) => bucket.isCurrent)?.key ?? chartBuckets[0]?.key ?? null;
    const target = selectedKey ?? fallback;
    if (!target) return;
    if (period === "month") {
      // The list selects days but the chart shows pairs — drill the pair
      // containing the highlighted day (or the pair itself as fallback).
      const pair = chartBuckets.find(
        (bucket) => bucket.key === target || bucket.endKey === target,
      );
      if (pair) {
        setDrillDayKey(pair.key);
        enterDrill();
      }
      return;
    }
    // Week summary: Enter drills into the highlighted day bucket.
    if (chartBuckets.some((bucket) => bucket.key === target)) {
      setDrillDayKey(target.slice(0, 10));
      enterDrill();
    }
  }, [chartBuckets, enterDrill, handleEdit, inDrill, period, selectedKey]);

  const confirmDelete = useCallback(async () => {
    const id = deleteTarget;
    if (!id) return;
    const expense = expenses.find((item) => item.id === id);
    setDeleteTarget(null);
    // Drop an in-progress edit if we are deleting the very item being edited.
    if (calc.editingId === id) {
      calc.clear();
    }
    applyOptimisticDelete(id);

    if (!online) {
      const token = loadToken();
      if (token) {
        if (id.startsWith("temp-")) {
          await dropTempChain(id);
        } else {
          await queueOfflineDelete(token, id);
          await patchCacheRow(id, null);
        }
        bumpSync();
      }
      restoreHistory(editOrigin);
      clearEditOrigin();
      return;
    }

    try {
      await expensesRepository.delete(id);
      restoreHistory(editOrigin);
      clearEditOrigin();
    } catch (cause) {
      if (cause instanceof UnauthorizedError) {
        if (expense) applyOptimisticCreate(expense);
        logout();
        return;
      }
      if (isOfflineCause(cause)) {
        const token = loadToken();
        if (token) {
          if (id.startsWith("temp-")) {
            await dropTempChain(id);
          } else {
            await queueOfflineDelete(token, id);
            await patchCacheRow(id, null);
          }
          bumpSync();
          restoreHistory(editOrigin);
          clearEditOrigin();
          return;
        }
      }
      if (expense) applyOptimisticCreate(expense);
      showError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
    }
  }, [
    expenses,
    online,
    applyOptimisticCreate,
    applyOptimisticDelete,
    calc,
    deleteTarget,
    dropTempChain,
    patchCacheRow,
    bumpSync,
    logout,
    showError,
    editOrigin,
    clearEditOrigin,
    restoreHistory,
  ]);

  const confirmUpdate = useCallback(async () => {
    const pendingUpdateValue = pendingUpdate;
    if (!pendingUpdateValue) return;
    setPendingUpdate(null);
    await commitUpdate(pendingUpdateValue.id, pendingUpdateValue.amount);
  }, [pendingUpdate, commitUpdate]);

  // --- Keyboard (spec §25) -----------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (isBudget || isInsight) {
        // Budget / insight screen: Escape returns to the calculator; digits
        // stay inert (insight is never an edit origin).
        if (event.key === "Escape") {
          if (isBudget) closeBudget();
          else closeInsight();
        }
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (event.key === "Escape") {
        if (showUnsaved) {
          setShowUnsaved(false);
          return;
        }
        if (deleteTarget) {
          setDeleteTarget(null);
          return;
        }
        if (pendingUpdate) {
          setPendingUpdate(null);
          return;
        }
        if (isSpecial && inDrill) exitDrill();
        else if (isSpecial) closeHistory();
        return;
      }

      if (showUnsaved || deleteTarget || pendingUpdate) return; // modal decision pending — ignore other keys

      if (isSpecial) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          triggerClicky(keyEl("key-2"));
          handleNavigate("up");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          triggerClicky(keyEl("key-8"));
          handleNavigate("down");
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          triggerClicky(keyEl("key-4"));
          handleNavigate("left");
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          triggerClicky(keyEl("key-6"));
          handleNavigate("right");
        } else if (event.key === "Enter") {
          event.preventDefault();
          triggerClicky(keyEl("key-enter"));
          handleSpecialEnter();
        }
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        triggerClicky(keyEl(digitKeyTestId(event.key)));
        calc.pressDigit(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        triggerClicky(keyEl("key-backspace"));
        calc.pressBackspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        triggerClicky(keyEl("key-enter"));
        void handleEnter();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    deleteTarget,
    showUnsaved,
    pendingUpdate,
    calc,
    isSpecial,
    isBudget,
    isInsight,
    inDrill,
    handleNavigate,
    handleSpecialEnter,
    handleEnter,
    exitDrill,
    closeHistory,
    closeBudget,
    closeInsight,
  ]);

  /** Clicking a chart bar: in day mode resolve to the first transaction in
   * that hour bucket (selections stay in the transaction-id domain); in month
   * mode resolve the pair to a day with transactions (the list stays daily);
   * otherwise the bucket key is the selection directly. */
  const handleBarSelect = useCallback(
    (key: string) => {
      if (period === "day" && !inDrill) {
        const hourKey = key.slice(11, 13);
        const tx = expenses.find((item) => {
          const parts = getZonedParts(new Date(item.occurredAt), APP_TIMEZONE);
          return String(parts.hour).padStart(2, "0") === hourKey;
        });
        if (tx) {
          setSelectedKey(tx.id);
          return;
        }
      }
      if (period === "month" && !inDrill) {
        const pair = chartBuckets.find((bucket) => bucket.key === key);
        if (pair) {
          const hasTx = (dayKey: string): boolean =>
            expenses.some(
              (item) => dayKeyOf(getZonedParts(new Date(item.occurredAt), APP_TIMEZONE)) === dayKey,
            );
          // Prefer the pair start so Enter drills from a stable anchor.
          setSelectedKey(hasTx(pair.key) ? pair.key : (pair.endKey ?? pair.key));
          return;
        }
      }
      setSelectedKey(key);
    },
    [period, inDrill, expenses, chartBuckets, setSelectedKey],
  );

  // --- Derived rows --------------------------------------------------------------

  const drillRows = useMemo<BrowseRow[]>(() => {
    if (!inDrill || !drillDayKey) return [];
    // Month drills cover the whole 2-day pair (drillDayKey = pair start,
    // drillPairEndKey = pair end or null for an orphan single).
    return expenses
      .filter((item) => {
        const key = dayKeyOf(getZonedParts(new Date(item.occurredAt), APP_TIMEZONE));
        return key === drillDayKey || key === drillPairEndKey;
      })
      .map((item) => ({
        key: item.id,
        left: formatTimeShort(new Date(item.occurredAt), APP_TIMEZONE),
        right: groupDigits(String(item.amount)),
        id: item.id,
        pending: pendingIds.has(item.id),
        allocationBadge: item.allocationType && item.allocationType !== "NONE"
          ? item.allocationType === "WEEKLY" ? "Weekly" : "Monthly"
          : undefined,
      }));
  }, [drillDayKey, drillPairEndKey, expenses, inDrill, pendingIds]);

  /** Build a civil date label (e.g. "15 Sep") from a YYYY-MM-DD bucket key. */
  const dateLabelFromKey = (key: string): string => {
    const parts = key.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return key;
    const [year, month, day] = parts;
    const isoAtMidnight = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`;
    return formatDateShort(new Date(isoAtMidnight), APP_TIMEZONE);
  };

  /** Pair-range label for month drill/titles (e.g. "20–21 Sep", or "30 Sep–1 Okt").
   * Without an endKey (orphan single) it degrades to the plain day label. */
  const pairMidLabel = (startKey: string, endKey?: string): string => {
    const startLabel = dateLabelFromKey(startKey);
    if (!endKey || endKey === startKey) return startLabel;
    const endLabel = dateLabelFromKey(endKey);
    const [startDay, startMon] = startLabel.split(" ");
    const [endDay, endMon] = endLabel.split(" ");
    if (!startDay || !startMon || !endDay || !endMon) return startLabel;
    return startMon === endMon ? `${startDay}–${endDay} ${startMon}` : `${startLabel}–${endLabel}`;
  };

  /** Current time reference for relative day labels (recomputed each render). */
  const now = useMemo(() => new Date(), []);

  const summaryRows = useMemo<BrowseRow[]>(() => {
    if (inDrill) return [];
    // Day summary lists individual transactions; W/M summary lists per-day
    // aggregates (month chart pairs days, but the history list stays daily).
    if (period === "day") {
      return expenses.map((item) => ({
        key: item.id,
        left: formatTimeShort(new Date(item.occurredAt), APP_TIMEZONE),
        mid: "Today",
        right: groupDigits(String(item.amount)),
        id: item.id,
        pending: pendingIds.has(item.id),
        allocationBadge: item.allocationType && item.allocationType !== "NONE"
          ? item.allocationType === "WEEKLY" ? "Weekly" : "Monthly"
          : undefined,
      }));
    }
    // W/M summary stays per-day even though the month chart pairs days.
    return groupExpensesByDay(expenses, currentPeriodRange(period)).map((day) => ({
      key: day.key,
      left: relativeDayLabel(day.key, now),
      mid: dateLabelFromKey(day.key),
      right: groupDigits(String(day.total)),
    }));
  }, [inDrill, period, expenses, pendingIds, now]);

  /** Auto-selection policy per view mode:
   *  - transaction-facing (day summary + drill): newest row first.
   *  - bucket-facing (W/M summary): seed the most-recent day that actually has
   *    data (first row of the sparse summary list) so the highlight is always
   *    visible; fall back to today's chart day, then the first bucket.
   *  Selection is (re)seeded on entry/refresh; navigation keeps it within the
   *  bucket set so it isn't clobbered here. */
  useEffect(() => {
    if (expenses.length === 0) return;
    if (inDrill || period === "day") {
      if (selectedKey === null || !expenses.some((item) => item.id === selectedKey)) {
        setSelectedKey(expenses[0]?.id ?? null);
      }
      return;
    }
    const seed =
      summaryRows[0]?.key ??
      chartBuckets.find((bucket) => bucket.isCurrent)?.key ??
      chartBuckets[0]?.key ??
      null;
    // Drop a selection that is no longer present in the rendered (sparse) list
    // — avoids a stale key that highlights a bar but no SummaryList row.
    if (selectedKey === null || !summaryRows.some((row) => row.key === selectedKey)) {
      setSelectedKey(seed);
    }
  }, [expenses, inDrill, period, selectedKey, chartBuckets, summaryRows, setSelectedKey]);

  const drillDayTotal = useMemo(
    () =>
      inDrill && drillDayKey
        ? expenses
            .filter((item) => {
              const key = dayKeyOf(getZonedParts(new Date(item.occurredAt), APP_TIMEZONE));
              return key === drillDayKey || key === drillPairEndKey;
            })
            .reduce((sum, item) => sum + item.amount, 0)
        : 0,
    [inDrill, drillDayKey, drillPairEndKey, expenses],
  );

  const chartTitle = useMemo(() => {
    if (inDrill && drillDayKey) {
      const datePart =
        period === "month" ? pairMidLabel(drillDayKey, drillPairEndKey ?? undefined) : dateLabelFromKey(drillDayKey);
      return `${relativeDayLabel(drillDayKey, now)} · ${datePart} · ${groupDigits(String(drillDayTotal))}`;
    }
    // Day hourly chart: the header already anchors to "Per jam" — the Today/total
    // subtitle is redundant, so we leave it blank here.
    return "";
  }, [inDrill, drillDayKey, period, now, expenses, drillDayTotal]);

  const effectivePeriodLabel = useMemo(() => {
    if (inDrill && drillDayKey) {
      const datePart =
        period === "month" ? pairMidLabel(drillDayKey, drillPairEndKey ?? undefined) : dateLabelFromKey(drillDayKey);
      return `${relativeDayLabel(drillDayKey, now)} · ${datePart}`;
    }
    return periodLabel;
  }, [inDrill, drillDayKey, period, now, summaryRows, selectedKey, periodLabel]);

  const deleteLabel = (() => {
    const expense = expenses.find((item) => item.id === deleteTarget);
    return expense ? formatIDR(expense.amount) : "";
  })();

  return (
    <div className="relative mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-4">
      <Header
        periodLabel={effectivePeriodLabel}
        totalLabel={totalLabel}
        status={
          <ConnIndicator online={online} syncing={syncing} pending={pending} cached={showingCachedDay} />
        }
        trailing={
          <UserMenu
            onLogout={logout}
            onAccountDeleted={logout}
            budgetStatus={budget.active?.status ?? null}
            onOpenBudget={openBudget}
            onOpenInsight={openInsight}
          />
        }
      />

      <UpdateBanner />

      {banner && (
        <div
          role="alert"
          data-testid="error-banner"
          className="mb-2 shrink-0 rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-300"
        >
          {banner}
        </div>
      )}

      {budgetNotice !== false && !banner && (
        <div
          role="status"
          data-testid="budget-notice"
          className={`mb-2 shrink-0 rounded-lg border px-3 py-2 text-sm ${
            budgetNotice === "over"
              ? "border-red-900/70 bg-red-950/40 text-red-300"
              : "border-amber-900/70 bg-amber-950/40 text-amber-300"
          }`}
        >
          {budgetNotice === "over"
            ? "Melebihi budget — pengeluaran tetap masuk."
            : "Mendekati batas budget."}
        </div>
      )}

      {!isBudget && !isInsight && (
        <PeriodSelector
          highlight={isSpecial ? period : null}
          onOpen={openHistory}
          onActiveTap={inDrill ? exitDrill : closeHistory}
        />
      )}

      {isHomeScreen && (
        <>
          {insightTickerVisible && (
            <InsightTicker insights={insights} onOpen={openInsight} />
          )}

          <AmountDisplay
            display={calc.display}
            editing={calc.isEditing}
            flash={flash}
          />
        </>
      )}

      {isBudget ? (
        <BudgetScreen
          active={budget.active}
          history={budget.history}
          loading={budget.loading}
          onBack={closeBudget}
          onCreate={handleBudgetCreate}
          onRemove={handleBudgetRemove}
        />
      ) : isInsight ? (
        <InsightScreen
          insights={insights}
          hasBudget={budget.active !== null}
          tickerVisible={insightTickerVisible}
          onToggleTicker={() => setInsightTickerVisible((v) => !v)}
          onBack={closeInsight}
          onOpenBudget={openBudget}
        />
      ) : isSpecial ? (
        <>
          {inDrill ? (
            <BrowseList
              rows={drillRows}
              selectedKey={transactionKey}
              onSelect={(key) => setSelectedKey(key)}
            />
          ) : (
            <SummaryList
              rows={summaryRows}
              selectedKey={selectedKey}
              onSelect={(key) => setSelectedKey(key)}
            />
          )}

          <div className="shrink-0">
            <BarChart
              buckets={chartBuckets}
              selectedKey={chartSelectedKey}
              onSelect={handleBarSelect}
              title={chartTitle}
            />
          </div>

          <Keypad
            layout="special"
            onDigit={() => {}}
            onBackspace={() => {}}
            onEnter={handleSpecialEnter}
            enterDisabled={
              inDrill
                ? transactionKey === null
                : period === "day"
                ? expenses.length === 0
                : chartBuckets.length === 0
            }
            onNavigate={handleNavigate}
            navDisabled={navDisabled}
          />

          {calc.isEditing && (
            <EditActions onBack={handleEditBack} onDelete={() => setDeleteTarget(calc.editingId)} />
          )}
        </>
      ) : (
        <>
          {isHomeScreen && calc.isEditing ? (
            <AdvancedControls
              allocationType={calc.allocationType}
              onToggle={(type) => {
                const next = type === "NONE" ? "NONE" : type;
                calc.setAllocationType(next);
              }}
            />
          ) : (
            <BarChart buckets={chartBuckets} />
          )}
          <Keypad
            onDigit={calc.pressDigit}
            onBackspace={calc.pressBackspace}
            onEnter={() => void handleEnter()}
            enterFlash={enterFlash}
             enterDisabled={
               calc.amount <= 0 ||
               Boolean(
                 calc.isEditing &&
                 calc.editingId &&
                 (expenses.find((i) => i.id === calc.editingId)?.amount === calc.amount) &&
                 ((expenses.find((i) => i.id === calc.editingId)?.allocationType ?? "NONE") === calc.allocationType),
               )
             }
          />
        </>
      )}

      {calc.isEditing && !isSpecial && (
        <EditActions onBack={handleEditBack} onDelete={() => setDeleteTarget(calc.editingId)} />
      )}

      {showUnsaved && (
        <UnsavedDialog
          onSave={() => {
            setShowUnsaved(false);
            void handleEnter();
          }}
          onCancel={handleEditBack}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          amountLabel={deleteLabel}
          busy={false}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {pendingUpdate && (
        <UpdateDialog
          fromLabel={formatIDR(expenses.find((i) => i.id === pendingUpdate.id)?.amount ?? 0)}
          toLabel={formatIDR(pendingUpdate.amount)}
          busy={false}
          onCancel={() => setPendingUpdate(null)}
          onConfirm={() => void confirmUpdate()}
        />
      )}
    </div>
  );
}
