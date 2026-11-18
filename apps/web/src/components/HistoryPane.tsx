import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { getZonedParts, formatTimeShort } from "@expense-app/shared";
import type { ExpenseDto } from "@expense-app/shared";

import type { BrowseRow } from "./BrowseList";
import { BrowseList } from "./BrowseList";
import { GraphSection } from "./GraphSection";
import { SummaryList } from "./SummaryList";
import { useBudgetSnapshot } from "../lib/budgetSnapshot";
import {
  dailyBuckets,
  groupExpensesByDay,
  hourlyBuckets,
  hourlyBucketsForDay,
  twoDayBuckets,
} from "../lib/chart";
import { formatIDRAbbreviated, groupDigits } from "../lib/currency";
import { relativeDayLabel } from "../lib/dayLabels";
import { civilDayKey } from "../lib/offlineDb";
import { dateLabelFromKey, pairMidLabel } from "../lib/periodLabels";
import { APP_TIMEZONE, PERIOD_LABEL, currentPeriodRange } from "../lib/periods";
import { useHistoryRange } from "../hooks/useHistoryRange";
import type { Period } from "../types/ui";

export interface HistoryPaneHandle {
  /** Keyboard navigation (wide layout): up/down move the selection, left/right
   * switch D←→W←→M (left also exits a drill). */
  navigate: (direction: "up" | "down" | "left" | "right") => void;
  /** Enter-equivalent on the current selection: W/M day row → drill into the
   * day; transaction row → edit on the calculator column (onEditExpense). */
  activate: () => void;
  /** Back to the overview: exit a drill and reseed the selection to the
   * newest row (the wide navbar's active-period tap). */
  reset: () => void;
}

export interface HistoryPaneProps {
  /** Pane scope (D/W/M) — owned by the parent so the wide navbar's period
   * strip can drive it (same contract as the mobile special mode). */
  period: Period;
  onPeriodChange: (next: Period) => void;
  /** Today's live expense list shared with the calculator column (D mode).
   * Zero extra fetches — entering an expense on the left updates this pane. */
  todayExpenses: ExpenseDto[];
  todayLoading: boolean;
  pendingIds: Set<string>;
  /** CRUD signature — refetches W/M range data when expenses change. */
  refreshKey: string;
  /** Active budget (snapshot + daily cap overlays on the pane chart). */
  activeBudget: Parameters<typeof useBudgetSnapshot>[2];
  /** Edit a transaction on the calculator column (keeps the pane visible). */
  onEditExpense?: (expense: ExpenseDto) => void;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Wide-screen right column: the D/W/M history that used to be a fullscreen
 * "special" mode, embedded next to the calculator. Owns its period, selection
 * and drill state; D mode reads the shared today list, W/M fetch through
 * useHistoryRange. The mobile special mode stays the authority for narrow
 * screens — this pane never touches useExpenses' period/viewMode state.
 */
export const HistoryPane = forwardRef<HistoryPaneHandle, HistoryPaneProps>(function HistoryPane(
  { period, onPeriodChange, todayExpenses, todayLoading, pendingIds, refreshKey, activeBudget, onEditExpense },
  ref,
) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** W/M drill-down (day key). Null = overview. D mode is always transactions. */
  const [drillDayKey, setDrillDayKey] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const { expenses: wmExpenses, total: wmTotal, loading: wmLoading, offline: wmOffline } =
    useHistoryRange(period, refreshKey);

  // Scope changes (navbar strip or keyboard left/right) always leave any drill.
  useEffect(() => {
    setDrillDayKey(null);
  }, [period]);

  const isDrill = drillDayKey !== null && period !== "day";
  const activeExpenses = period === "day" ? todayExpenses : wmExpenses;
  const loading = period === "day" ? todayLoading : wmLoading;

  /** Reset scope helper — drill reset happens in the period effect. */
  const switchPeriod = useCallback(
    (next: Period) => onPeriodChange(next),
    [onPeriodChange],
  );

  // --- Chart ------------------------------------------------------------------

  const chartBuckets = useMemo(() => {
    if (isDrill && drillDayKey) {
      return hourlyBucketsForDay(activeExpenses, drillDayKey, now);
    }
    if (period === "day") {
      return hourlyBuckets(todayExpenses, now);
    }
    if (period === "week") {
      return dailyBuckets("week", currentPeriodRange("week"), activeExpenses, now);
    }
    return twoDayBuckets(currentPeriodRange("month"), activeExpenses, now);
  }, [isDrill, drillDayKey, period, activeExpenses, todayExpenses, now]);

  // --- Rows -------------------------------------------------------------------

  const summaryRows = useMemo<BrowseRow[]>(() => {
    if (isDrill) return [];
    if (period === "day") {
      return todayExpenses.map((item) => ({
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
    return groupExpensesByDay(activeExpenses, currentPeriodRange(period)).map((day) => ({
      key: day.key,
      left: relativeDayLabel(day.key, now),
      mid: dateLabelFromKey(day.key),
      right: groupDigits(String(day.total)),
    }));
  }, [isDrill, period, todayExpenses, activeExpenses, pendingIds, now]);

  const drillPairEndKey = useMemo(
    () =>
      period === "month" && isDrill
        ? (chartBuckets.find((bucket) => bucket.key === drillDayKey)?.endKey ?? null)
        : null,
    [period, isDrill, drillDayKey, chartBuckets],
  );

  const drillRows = useMemo<BrowseRow[]>(() => {
    if (!isDrill) return [];
    // Month drills cover the whole 2-day pair (drillDayKey = pair start).
    return activeExpenses
      .filter((item) => {
        const key = civilDayKey(item.occurredAt);
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
  }, [isDrill, drillDayKey, drillPairEndKey, activeExpenses, pendingIds]);

  const drillDayTotal = useMemo(
    () =>
      isDrill
        ? activeExpenses
            .filter((item) => {
              const key = civilDayKey(item.occurredAt);
              return key === drillDayKey || key === drillPairEndKey;
            })
            .reduce((sum, item) => sum + item.amount, 0)
        : 0,
    [isDrill, drillDayKey, drillPairEndKey, activeExpenses],
  );

  /**
   * Chart highlight follows the list selection (mirrors the mobile special
   * mode): transaction selections resolve to their hour bucket, month day
   * selections to the containing pair, W/M day selections are bucket keys.
   */
  const chartSelectedKey = useMemo(() => {
    if (selectedKey === null) return selectedKey;
    if (isDrill || period === "day") {
      const tx = activeExpenses.find((item) => item.id === selectedKey);
      if (!tx) return selectedKey;
      const parts = getZonedParts(new Date(tx.occurredAt), APP_TIMEZONE);
      const dayKey = civilDayKey(tx.occurredAt);
      return `${dayKey}T${String(parts.hour).padStart(2, "0")}`;
    }
    if (period === "month") {
      const pair = chartBuckets.find(
        (bucket) => bucket.key === selectedKey || bucket.endKey === selectedKey,
      );
      return pair?.key ?? selectedKey;
    }
    // W: selectedKey is already a bucket (day) key.
    return selectedKey;
  }, [isDrill, period, selectedKey, activeExpenses, chartBuckets]);

  const chartTitle = useMemo(() => {
    if (isDrill && drillDayKey) {
      const datePart =
        period === "month"
          ? pairMidLabel(drillDayKey, drillPairEndKey ?? undefined)
          : dateLabelFromKey(drillDayKey);
      return `${relativeDayLabel(drillDayKey, now)} · ${datePart} · ${groupDigits(String(drillDayTotal))}`;
    }
    return "";
  }, [isDrill, drillDayKey, period, drillPairEndKey, now, drillDayTotal]);

  // --- Selection + interactions -------------------------------------------------

  /** Auto-seed: whenever the selection is not among the visible rows (entry,
   * period switch, drill transitions, refreshes), select the newest row. */
  const visibleRows = isDrill ? drillRows : summaryRows;
  useEffect(() => {
    if (visibleRows.length === 0) return;
    if (selectedKey !== null && visibleRows.some((row) => row.key === selectedKey)) return;
    setSelectedKey(visibleRows[0]?.key ?? null);
  }, [visibleRows, selectedKey]);

  const handleRowSelect = useCallback((key: string) => setSelectedKey(key), []);

  /** Double-click (or Enter via imperative handle): transaction → edit on the
   * calculator column; W/M day row → drill into that day's transactions. */
  const handleActivateKey = useCallback(
    (key: string) => {
      if (key === null) return;
      if (isDrill || period === "day") {
        const tx = activeExpenses.find((item) => item.id === key);
        if (tx) onEditExpense?.(tx);
        return;
      }
      if (DAY_KEY_RE.test(key)) {
        setDrillDayKey(key.slice(0, 10));
      }
    },
    [isDrill, period, activeExpenses, onEditExpense],
  );

  /** Clicking a chart bar resolves the bucket back to a row selection (same
   * policy as the mobile special mode). */
  const handleBarSelect = useCallback(
    (key: string) => {
      if (isDrill || period === "day") {
        const hourKey = key.slice(11, 13);
        const tx = activeExpenses.find((item) => {
          if (isDrill) {
            const dayKey = civilDayKey(item.occurredAt);
            if (dayKey !== drillDayKey && dayKey !== drillPairEndKey) return false;
          }
          const parts = getZonedParts(new Date(item.occurredAt), APP_TIMEZONE);
          return String(parts.hour).padStart(2, "0") === hourKey;
        });
        if (tx) {
          setSelectedKey(tx.id);
          return;
        }
      }
      if (period === "month" && !isDrill) {
        const pair = chartBuckets.find((bucket) => bucket.key === key);
        if (pair) {
          const hasTx = (dayKey: string): boolean =>
            activeExpenses.some((item) => civilDayKey(item.occurredAt) === dayKey);
          // Prefer the pair start so drill anchors stably.
          setSelectedKey(hasTx(pair.key) ? pair.key : (pair.endKey ?? pair.key));
          return;
        }
      }
      setSelectedKey(key);
    },
    [isDrill, period, drillDayKey, drillPairEndKey, activeExpenses, chartBuckets],
  );

  // --- Imperative keyboard handle ----------------------------------------------

  useImperativeHandle(
    ref,
    () => ({
      navigate: (direction) => {
        if (direction === "up" || direction === "down") {
          if (visibleRows.length === 0) return;
          const index = visibleRows.findIndex((row) => row.key === selectedKey);
          const valid = index < 0 ? 0 : index;
          const next =
            direction === "up"
              ? Math.max(0, valid - 1)
              : Math.min(visibleRows.length - 1, valid + 1);
          setSelectedKey(visibleRows[next]?.key ?? null);
          return;
        }
        if (direction === "left") {
          if (isDrill) {
            setDrillDayKey(null);
            return;
          }
          if (period === "month") switchPeriod("week");
          else if (period === "week") switchPeriod("day");
          return;
        }
        // right
        if (isDrill) return;
        if (period === "day") switchPeriod("week");
        else if (period === "week") switchPeriod("month");
      },
      activate: () => {
        if (selectedKey === null) return;
        handleActivateKey(selectedKey);
      },
      reset: () => {
        setDrillDayKey(null);
        setSelectedKey(summaryRows[0]?.key ?? null);
      },
    }),
    [visibleRows, selectedKey, isDrill, period, switchPeriod, handleActivateKey, summaryRows],
  );

  // --- Header + budget overlay ---------------------------------------------------

  const paneTotal = useMemo(() => {
    if (period === "day") {
      return todayExpenses.reduce((sum, item) => sum + item.amount, 0);
    }
    return wmTotal;
  }, [period, todayExpenses, wmTotal]);

  const paneBudgetSnapshot = useBudgetSnapshot(period, activeExpenses, activeBudget);
  const dailyCap = activeBudget?.type === "daily" ? activeBudget.amount : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-4" data-testid="history-pane">
      {/* Period context row — always visible so the right column keeps the
          same [label][total] header height in every D/W/M scope. */}
      <div className="flex h-11 items-center justify-between px-1 mb-2">
        <span className="text-sm font-medium text-neutral-400" data-testid="pane-period-label">
          {PERIOD_LABEL[period]}
        </span>
        <span className="text-sm font-semibold tabular-nums text-neutral-100" data-testid="pane-total">
          {formatIDRAbbreviated(paneTotal)}
        </span>
      </div>

      {wmOffline && !isDrill && (
        <p
          data-testid="pane-offline-hint"
          className="mb-2 shrink-0 rounded-lg border border-amber-900/70 bg-amber-950/40 px-3 py-2 text-sm text-amber-300"
        >
          Butuh internet untuk Week/Month.
        </p>
      )}

      {isDrill ? (
        <BrowseList
          rows={drillRows}
          selectedKey={selectedKey}
          onSelect={handleRowSelect}
          onActivate={handleActivateKey}
          loading={loading && drillRows.length === 0}
        />
      ) : (
        <SummaryList
          rows={summaryRows}
          selectedKey={selectedKey}
          onSelect={handleRowSelect}
          onActivate={handleActivateKey}
          loading={loading && summaryRows.length === 0}
        />
      )}

      <div className="shrink-0">
        <GraphSection
          buckets={chartBuckets}
          selectedKey={chartSelectedKey}
          onSelect={handleBarSelect}
          title={chartTitle}
          snapshot={paneBudgetSnapshot}
          dailyCap={dailyCap}
          loading={loading && chartBuckets.length === 0}
        />
      </div>
    </div>
  );
});
