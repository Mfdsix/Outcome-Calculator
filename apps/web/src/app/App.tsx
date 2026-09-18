import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TOKEN_REFRESH_MIN_INTERVAL_MS, getZonedParts, formatDateShort, formatTimeShort } from "@expense-app/shared";

import { AmountDisplay } from "../components/AmountDisplay";
import { BarChart } from "../components/BarChart";
import { BrowseList, type BrowseRow } from "../components/BrowseList";
import { DeleteDialog } from "../components/DeleteDialog";
import { Header } from "../components/Header";
import { Keypad } from "../components/Keypad";
import { NewPinDialog } from "../components/NewPinDialog";
import { PeriodSelector } from "../components/PeriodSelector";
import { LockScreen } from "../components/LockScreen";
import { SummaryList } from "../components/SummaryList";
import { UserMenu } from "../components/UserMenu";
import { useCalculator } from "../hooks/useCalculator";
import { useExpenses } from "../hooks/useExpenses";
import {
  ApiError,
  UnauthorizedError,
  authApi,
  expensesApi,
  setAuthToken,
} from "../lib/api";
import { dailyBuckets, hourlyBuckets } from "../lib/chart";
import { formatIDR, groupDigits } from "../lib/currency";
import { APP_TIMEZONE, currentPeriodRange } from "../lib/periods";
import type { Period } from "../types/ui";

const LAST_VISIT_KEY = "expense-app.last-visit";

/** Civil day key (YYYY-MM-DD) from zoned parts, in APP_TIMEZONE semantics. */
function dayKeyOf(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
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
 */
export default function App() {
  const lock = useLockFlow();

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

interface LockFlow {
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
  // (401 → re-lock) rather than an upfront ping.
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
  // refresh; 401 → locked out; network error → silent (retry next visit).
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
    setSelectedKey,
    enterDrill,
    exitDrill,
    applyOptimisticCreate,
    revertOptimisticCreate,
    applyOptimisticUpdate,
    applyOptimisticDelete,
  } = useExpenses();

  const calc = useCalculator();
  const [flash, setFlash] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [drillDayKey, setDrillDayKey] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSpecial = viewMode === "special";
  const inDrill = specialPanel === "drill";

  const showError = useCallback((message: string) => {
    setBanner(message);
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBanner(null), 4000);
  }, []);

  const doFlash = useCallback(() => {
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 350);
  }, []);

  useEffect(() => {
    return () => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // In drill mode the selection addresses transactions (expense ids):
  // default to the newest row; drop a selection that no longer exists.
  // In summary mode the selection addresses chart buckets — no auto-select.
  useEffect(() => {
    if (!inDrill || expenses.length === 0) return;
    if (selectedKey === null || !expenses.some((item) => item.id === selectedKey)) {
      setSelectedKey(expenses[0]?.id ?? null);
    }
  }, [expenses, inDrill, selectedKey, setSelectedKey]);

  /** In drill mode the transaction-facing selection lives in a second slot
   * so the bucket selection (chart) is preserved for when we go back up. */
  const transactionKeyRef = useRef<string | null>(null);
  if (inDrill && selectedKey !== null && expenses.some((item) => item.id === selectedKey)) {
    transactionKeyRef.current = selectedKey;
  }
  const transactionKey = transactionKeyRef.current;

  const handleEnter = useCallback(async () => {
    const amount = calc.amount;
    if (amount <= 0) return;

    if (calc.isEditing && calc.editingId) {
      const id = calc.editingId;
      const previous = expenses.find((item) => item.id === id);
      calc.clear();
      if (previous) {
        applyOptimisticUpdate({ ...previous, amount });
      }
      try {
        const saved = await expensesApi.update(id, { amount });
        applyOptimisticUpdate(saved);
        doFlash();
      } catch (cause) {
        if (previous) applyOptimisticUpdate(previous);
        if (cause instanceof UnauthorizedError) {
          logout();
          return;
        }
        showError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
      }
      return;
    }

    const optimistic = {
      id: `optimistic-${Date.now()}`,
      amount,
      occurredAt: new Date().toISOString(),
    };
    calc.clear();
    applyOptimisticCreate(optimistic);
    doFlash();
    try {
      const saved = await expensesApi.create({ amount });
      revertOptimisticCreate(optimistic);
      applyOptimisticCreate(saved);
    } catch (cause) {
      revertOptimisticCreate(optimistic);
      if (cause instanceof UnauthorizedError) {
        logout();
        return;
      }
      showError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
    }
  }, [calc, expenses, applyOptimisticCreate, revertOptimisticCreate, applyOptimisticUpdate, doFlash, logout, showError]);

  // --- Special-mode data -------------------------------------------------------

  const chartBuckets = useMemo(
    () =>
      period === "day"
        ? hourlyBuckets(expenses, new Date())
        : dailyBuckets(period, currentPeriodRange(period), expenses, new Date()),
    [period, expenses],
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
        // left/right = page jump of ±5 in transaction lists too.
        next = Math.min(expenses.length - 1, Math.max(0, valid + (direction === "right" ? 5 : -5)));
      }
      setSelectedKey(expenses[next]?.id ?? null);
    },
    [expenses, selectedKey, setSelectedKey],
  );

  const handleNavigate = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (inDrill) {
        moveTransactionSelection(direction);
        return;
      }

      const keys = chartBuckets.map((bucket) => bucket.key);
      if (keys.length === 0) return;
      const index = keys.indexOf(selectedKey ?? "");
      const valid = index < 0 ? 0 : index;
      let next: number;
      if (direction === "up" || direction === "down") {
        next = direction === "up" ? Math.max(0, valid - 1) : Math.min(keys.length - 1, valid + 1);
      } else {
        // left/right = page jump of ±5 through buckets.
        next = Math.min(keys.length - 1, Math.max(0, valid + (direction === "right" ? 5 : -5)));
      }
      setSelectedKey(keys[next] ?? null);
    },
    [inDrill, chartBuckets, selectedKey, setSelectedKey, moveTransactionSelection],
  );

  const handleSpecialEnter = useCallback(() => {
    if (inDrill) return;
    // Enter drills into the highlighted bucket — the selected one, or the
    // default current hour/day when nothing has been picked yet. Day view
    // buckets are hourly keys "YYYY-MM-DDTHH"; week/month buckets are civil
    // day keys "YYYY-MM-DD". Drill always operates on the day part.
    const fallback = chartBuckets.find((bucket) => bucket.isCurrent)?.key ?? chartBuckets[0]?.key ?? null;
    const target = selectedKey ?? fallback;
    if (target && chartBuckets.some((bucket) => bucket.key === target)) {
      setDrillDayKey(target.slice(0, 10));
      enterDrill();
    }
  }, [chartBuckets, enterDrill, inDrill, selectedKey]);

  const handleEdit = useCallback(() => {
    const id = inDrill ? transactionKey : selectedKey;
    const expense = expenses.find((item) => item.id === id);
    if (!expense) return;
    calc.startEdit(expense.id, expense.amount);
    closeHistory();
  }, [calc, expenses, inDrill, selectedKey, closeHistory, transactionKey]);

  const confirmDelete = useCallback(async () => {
    const id = deleteTarget;
    if (!id) return;
    const expense = expenses.find((item) => item.id === id);
    setDeleteTarget(null);
    applyOptimisticDelete(id);
    try {
      await expensesApi.remove(id);
    } catch (cause) {
      if (expense) applyOptimisticCreate(expense);
      if (cause instanceof UnauthorizedError) {
        logout();
        return;
      }
      showError(cause instanceof Error ? cause.message : "Could not save expense.\nTry again.");
    }
  }, [applyOptimisticCreate, applyOptimisticDelete, deleteTarget, expenses, logout, showError]);

  // --- Keyboard (spec §25) -----------------------------------------------------

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (event.key === "Escape") {
        if (deleteTarget) {
          setDeleteTarget(null);
          return;
        }
        if (calc.isEditing) {
          calc.clear();
          return;
        }
        if (isSpecial && inDrill) exitDrill();
        else if (isSpecial) closeHistory();
        return;
      }

      if (deleteTarget) return; // modal decision pending — ignore other keys

      if (isSpecial) {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          handleNavigate("up");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          handleNavigate("down");
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          handleNavigate("left");
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          handleNavigate("right");
        } else if (event.key === "Enter") {
          event.preventDefault();
          handleSpecialEnter();
        }
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        calc.pressDigit(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        calc.pressBackspace();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void handleEnter();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    deleteTarget,
    calc,
    isSpecial,
    inDrill,
    handleNavigate,
    handleSpecialEnter,
    handleEnter,
    exitDrill,
    closeHistory,
  ]);

  // --- Derived rows --------------------------------------------------------------

  const drillRows = useMemo<BrowseRow[]>(() => {
    if (!inDrill || !drillDayKey) return [];
    return expenses
      .filter(
        (item) => dayKeyOf(getZonedParts(new Date(item.occurredAt), APP_TIMEZONE)) === drillDayKey,
      )
      .map((item) => ({
        key: item.id,
        left: formatTimeShort(new Date(item.occurredAt), APP_TIMEZONE),
        right: groupDigits(String(item.amount)),
        id: item.id,
      }));
  }, [drillDayKey, expenses, inDrill]);

  /** Build a civil date label (e.g. "15 Sep") from a YYYY-MM-DD bucket key. */
  const dateLabelFromKey = (key: string): string => {
    const parts = key.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return key;
    const [year, month, day] = parts;
    const isoAtMidnight = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`;
    return formatDateShort(new Date(isoAtMidnight), APP_TIMEZONE);
  };

  const summaryRows = useMemo<BrowseRow[]>(() => {
    if (inDrill) return [];
    return chartBuckets.map((bucket) => ({
      key: bucket.key,
      left: bucket.kind === "hour" ? `${bucket.key.slice(11, 13)}:00` : dateLabelFromKey(bucket.key),
      right: groupDigits(String(bucket.total)),
    }));
  }, [chartBuckets, inDrill]);

  const deleteLabel = (() => {
    const expense = expenses.find((item) => item.id === deleteTarget);
    return expense ? formatIDR(expense.amount) : "";
  })();

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-4">
      <Header
        periodLabel={periodLabel}
        totalLabel={totalLabel}
        trailing={<UserMenu onLogout={logout} />}
      />

      {banner && (
        <div
          role="alert"
          data-testid="error-banner"
          className="mb-2 shrink-0 rounded-lg border border-red-900/70 bg-red-950/40 px-3 py-2 text-sm text-red-300"
        >
          {banner}
        </div>
      )}

      <PeriodSelector
        highlight={isSpecial ? period : null}
        onOpen={openHistory}
        onActiveTap={inDrill ? exitDrill : closeHistory}
      />

      {!isSpecial && (
        <AmountDisplay
          display={calc.display}
          editing={calc.isEditing}
          flash={flash}
        />
      )}

      {isSpecial ? (
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
              selectedKey={selectedKey}
              onSelect={(key) => setSelectedKey(key)}
            />
          </div>

          {/* TODO: history edit/hapus affordance — handleEdit/confirmDelete kept but
              not surfaced yet (plan: history without ControlBar). */}
          <Keypad
            layout="special"
            onDigit={() => {}}
            onBackspace={() => {}}
            onEnter={handleSpecialEnter}
            enterDisabled={inDrill}
            onNavigate={handleNavigate}
          />
        </>
      ) : (
        <>
          <BarChart buckets={chartBuckets} />
          <Keypad
            onDigit={calc.pressDigit}
            onBackspace={calc.pressBackspace}
            onEnter={() => void handleEnter()}
            enterDisabled={calc.amount <= 0}
          />
        </>
      )}

      {deleteTarget && (
        <DeleteDialog
          amountLabel={deleteLabel}
          busy={false}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}
