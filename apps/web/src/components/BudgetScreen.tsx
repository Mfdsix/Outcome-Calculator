import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  BudgetActiveResponse,
  BudgetHistoryItem,
  BudgetStatus,
  BudgetType,
  CreateBudgetPayload,
  BudgetDayPoint,
  SuggestedCopyDates,
} from "@expense-app/shared";
import {
  buildDashboardData,
  civilToday,
  digitsToAmount,
  formatIDR,
  normalizeDigits,
  suggestCopyDates,
  formatDateShort,
} from "@expense-app/shared";
import type { BudgetDashboardData } from "@expense-app/shared";

import { BudgetModal } from "./BudgetModal";
import { BudgetPeriodChart, PERIOD_CHART_LINE_MIN_DAYS } from "./BudgetPeriodChart";
import { periodLabelOf } from "./BudgetProgress";
import { ChartModeToggle } from "./ChartModeToggle";
import type { TotalMode } from "../hooks/useTotalMode";
import { useChartMode } from "../lib/chartMode";
import { APP_TIMEZONE } from "../lib/periods";
import { relativeDayLabel } from "../lib/dayLabels";

export interface BudgetScreenProps {
  active: BudgetActiveResponse["budget"];
  history: BudgetHistoryItem[];
  loading: boolean;
  onBack: () => void;
  onCreate: (payload: CreateBudgetPayload) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  /** Day-by-day spend series from GET /api/budgets/active/series (sparse). */
  series: BudgetDayPoint[] | null;
  seriesLoading: boolean;
  /** Independent fair/raw toggle for the "Today" card. */
  budgetTodayMode: TotalMode;
  onToggleBudgetTodayMode: () => void;
  /** Fair total for today (day-scoped), or null when not yet loaded / failed. */
  budgetTodaySpentFair: number | null;
  budgetTodayLoading: boolean;
  /** True when in fair mode but the fair total is unavailable — show ·raw fallback. */
  budgetTodayFairFallback: boolean;
}

interface PrefillState {
  type: BudgetType;
  amount: number;
  suggested: SuggestedCopyDates;
  /** Where the prefill came from (history id or "active") — for a11y labels. */
  source: string;
}

const STATUS_CHIP: Record<BudgetStatus, { label: string; className: string }> = {
  ok: { label: "Aman", className: "text-emerald-300 border-emerald-800 bg-emerald-950/40" },
  warning: { label: "Hampir habis", className: "text-amber-300 border-amber-800 bg-amber-950/40" },
  over: { label: "Lewat batas", className: "text-red-300 border-red-800 bg-red-950/40" },
};

function civilToISO(parts: { year: number; month: number; day: number }): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Dedicated budget screen (plan §3): active card (or empty state), history
 * with "Pakai lagi", and the create form. "Pakai lagi" PREFILLS the form —
 * type + amount identical, dates smart-shifted (suggestCopyDates) — for the
 * user to review before saving; saving is a plain create that auto-replaces
 * the active budget. Spent always starts from zero (live data).
 */
export function BudgetScreen({ active, history, loading, onBack, onCreate, onRemove, series, seriesLoading, budgetTodayMode, onToggleBudgetTodayMode, budgetTodaySpentFair, budgetTodayLoading, budgetTodayFairFallback }: BudgetScreenProps) {
  /** Today's civil date (YYYY-MM-DD) — single source of truth for pace math. */
  const todayISO = useMemo(() => civilToISO(civilToday(APP_TIMEZONE)), []);
  const nowISO = useMemo(() => new Date().toISOString(), []);

  const [prefill, setPrefill] = useState<PrefillState | null>(null);
  /** null = closed; 'form' = create/replace form; 'kelola' = manage modal. */
  const [modalMode, setModalMode] = useState<"form" | "kelola" | null>(null);
  const [type, setType] = useState<BudgetType>("daily");
  const [amountText, setAmountText] = useState("");
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  /** Apply a prefill: identical type+amount, smart-shifted editable dates. */
  useEffect(() => {
    if (!prefill) return;
    setType(prefill.type);
    setAmountText(String(prefill.amount));
    setStartDate(prefill.suggested.startDate);
    setEndDate(prefill.suggested.endDate);
  }, [prefill]);

  const useAgain = (source: string, item: { type: BudgetType; amount: number; startDate: string; endDate: string }): void => {
    setPrefill({
      type: item.type,
      amount: item.amount,
      suggested: suggestCopyDates(item, APP_TIMEZONE),
      source,
    });
    setModalMode("form");
    // Focus the amount input when the modal opens on next tick.
    requestAnimationFrame(() => amountInputRef.current?.focus());
  };

  const openNewBudget = (): void => {
    setPrefill(null);
    setType("daily");
    setAmountText("");
    setStartDate(todayISO);
    setEndDate(todayISO);
    setModalMode("form");
    requestAnimationFrame(() => amountInputRef.current?.focus());
  };

  const closeModal = (): void => {
    setModalMode(null);
    setPrefill(null);
    setAmountText("");
    setType("daily");
    setStartDate(todayISO);
    setEndDate(todayISO);
  };

  const amount = digitsToAmount(amountText);
  const datesValid = startDate.length === 10 && endDate.length === 10 && startDate <= endDate;
  const canSubmit = amount > 0 && datesValid && !busy;
  const perDayHint =
    type === "daily"
      ? `Rp${amount.toLocaleString("id-ID")} / hari`
      : `≈ Rp${Math.floor(amount / Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1)).toLocaleString("id-ID")} / hari`;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await onCreate({ type, amount, startDate, endDate });
    setBusy(false);
    if (ok) {
      closeModal();
    }
  };

  /** Finished: period fully past today → gray card + "Buat yang baru". */
  const finished = active !== null && active.endDate < todayISO;

  /** Dashboard data (zero-fill + deltas + pace) — derived from series. */
  const dashboard = useMemo<BudgetDashboardData | null>(() => {
    if (active === null || series === null) return null;
    return buildDashboardData(
      {
        type: active.type,
        amount: active.amount,
        startDate: active.startDate,
        endDate: active.endDate,
        todaySpent: active.todaySpent,
      },
      series,
      nowISO,
      APP_TIMEZONE,
    );
  }, [active, series, nowISO]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="budget-screen">
      {/* Sticky top bar: ← Budget ... [ + Tambah ] (mock §A — Tambah always visible) */}
      <div className="flex items-center justify-between pb-2">
        <button
          type="button"
          aria-label="Kembali ke kalkulator"
          data-testid="budget-back"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-300 active:bg-neutral-800"
        >
          ←
        </button>
        <span className="text-base font-semibold text-neutral-100">Budget</span>
        <button
          type="button"
          data-testid="budget-form-toggle"
          onClick={openNewBudget}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_2px_0_0_#065f46] active:shadow-none"
        >
          + Tambah
        </button>
      </div>

      <div className="shrink-0 space-y-4">
        {/* Active card / empty state */}
        {loading && active === null ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-6 text-center text-sm text-neutral-500">
            Memuat...
          </div>
        ) : active === null ? (
          <div
            data-testid="budget-empty"
            className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/40 px-4 py-6 text-center"
          >
            <p className="text-sm text-neutral-400">Belum ada budget.</p>
            <p className="mt-1 text-xs text-neutral-500">
              Pasang batas harian atau bulanan — peringatan lunak, tanpa blokir input.
            </p>
          </div>
        ) : (
          <>
            {!finished && dashboard !== null && (
              <>
                {/* Layer 1: Today overview */}
                 <BudgetToday
                   type={active.type}
                   amount={active.amount}
                   todaySpent={active.todaySpent}
                   status={active.status}
                   todayMode={budgetTodayMode}
                   onToggleTodayMode={onToggleBudgetTodayMode}
                   todaySpentFair={budgetTodaySpentFair}
                   todayLoading={budgetTodayLoading}
                   fairFallback={budgetTodayFairFallback}
                 />

                {/* Layer 2: Period card */}
                <BudgetPeriod
                  key={active.id}
                  dashboard={dashboard}
                  onEdit={() => useAgain("active", active)}
                  onHapus={() => setConfirmRemove(true)}
                  onKelola={() => setModalMode("kelola")}
                />
              </>
            )}

              {/* Finished: gray card + "Buat yang baru" + kelola (no period card here) */}
              {finished && (
                <>
                  <BudgetFinished
                    type={active.type}
                    amount={active.amount}
                    spent={active.spent}
                    remaining={active.remaining}
                    progressPct={active.progressPct}
                    periodLabel={periodLabelOf(active.startDate, active.endDate, active.type)}
                    onNewBudget={openNewBudget}
                  />
                  <button
                    type="button"
                    data-testid="budget-kelola-toggle"
                    onClick={() => setModalMode("kelola")}
                    className="mt-2 w-full rounded-lg border border-neutral-700 px-3 py-2 text-xs font-semibold text-neutral-300 hover:text-neutral-100 active:bg-neutral-800"
                  >
                    Kelola Budget
                  </button>
                </>
              )}
          </>
        )}
 
      </div>

      {/* Day history fills the remaining height and scrolls internally. */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* Day History (plan §3: 14 default + expand). While the series is
            still loading, show a quiet placeholder instead of nothing. */}
        {!finished && dashboard !== null && dashboard.days.length > 0 && (
          <BudgetDayHistory days={dashboard.days} maxInitial={14} />
        )}
        {!finished && dashboard === null && seriesLoading && active !== null && (
          <p className="text-center text-xs text-neutral-500" data-testid="budget-series-loading">
            Memuat riwayat harian...
          </p>
        )}

      </div>
      {/* Confirmation dialog — rendered in the main div (below scroll), reused for remove */}
      {confirmRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi hapus budget"
          data-testid="budget-delete-dialog"
          onClick={() => setConfirmRemove(false)}
        >
          <div
            className="w-full max-w-xs rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="mb-4 text-center text-sm font-medium text-neutral-100" data-testid="budget-delete-message">
              Hapus budget aktif? Riwayatnya tetap tersimpan dan bisa dipakai lagi.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                data-testid="budget-delete-cancel"
                className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRemove(false);
                  void onRemove();
                }}
                data-testid="budget-delete-confirm"
                className="h-11 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white active:bg-red-700"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Modal (rendered via portal so Escape handling + stack order are clean) */}
      {modalMode !== null &&
        createPortal(
          <BudgetModal mode={modalMode} onClose={closeModal}>
            {modalMode === "form" ? (
               <BudgetFormModal
                 prefill={prefill}
                 active={active}
                 type={type}
                 setType={setType}
                 amountText={amountText}
                 onAmountChange={setAmountText}
                 startDate={startDate}
                 setStartDate={setStartDate}
                 endDate={endDate}
                 setEndDate={setEndDate}
                 perDayHint={perDayHint}
                 canSubmit={canSubmit}
                 busy={busy}
                 submit={submit}
                 onCancel={closeModal}
                 amountInputRef={amountInputRef}
               />
            ) : (
              <BudgetKelolaModal
                history={history}
                onUseAgain={useAgain}
              />
            )}
          </BudgetModal>,
          document.body,
        )}
    </>
  );
}

/** Finished period (plan §3): gray inactive card + "Buat yang baru" CTA. */
function BudgetFinished({
  type: _type,
  amount,
  spent,
  remaining,
  progressPct,
  periodLabel,
  onNewBudget,
}: {
  type: BudgetType;
  amount: number;
  spent: number;
  remaining: number;
  progressPct: number;
  periodLabel: string;
  onNewBudget: () => void;
}) {
  const progressPctClamped = Math.min(100, progressPct);
  return (
    <div
      data-testid="budget-card"
      className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 opacity-60"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-widest text-neutral-500">
          Selesai
        </span>
        <span className="text-xs font-semibold text-neutral-400">Selesai</span>
      </div>
      <p className="mt-1 font-light tabular-nums text-neutral-50">
        <span className="text-2xl">{formatIDR(remaining)}</span>
        <span className="text-sm text-neutral-500"> dari {formatIDR(amount)}</span>
      </p>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPctClamped}
        aria-label="Progres budget selesai"
      >
        <div
          className="h-full rounded-full bg-neutral-600 transition-[width] duration-500"
          style={{ width: `${progressPctClamped}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-neutral-500">
        <span>{periodLabel}</span>
        <span>{progressPct}% terpakai</span>
      </div>
      <button
        type="button"
        data-testid="budget-active-ganti"
        onClick={onNewBudget}
        className="mt-3 w-full rounded-lg border border-neutral-800 bg-neutral-900/60 py-2 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
      >
        Buat yang baru
      </button>
    </div>
  );
}

/** Today headline: plain text normally, but a clickable button with a dotted
 *  underline when a fair value exists (click toggles raw↔fair). */
function BudgetTodayHeadline({
  testid,
  text,
  className,
  clickable,
  fairActive,
  loading,
  onClick,
}: {
  testid: string;
  text: string;
  className: string;
  clickable: boolean;
  fairActive: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!clickable) {
    return (
      <p data-testid={testid} className={`mt-1 ${className}`}>
        {text}
      </p>
    );
  }
  const label = fairActive ? "Kembali ke total normal" : "Tampilkan total fair";
  return (
    <button
      type="button"
      data-testid={testid}
      aria-pressed={fairActive}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`fair-dotted mt-1 cursor-pointer text-left ${className} ${
        loading ? "animate-pulse" : ""
      }`}
    >
      {text}
    </button>
  );
}

/** Layer 1 — Today overview: label + status chip, big signed delta
 *  headline (daily: + tersisa / − melewati; full: today's total), progress
 *  bar, and right-aligned percentage. The headline itself is clickable when a
 *  fair value exists (independent from the header toggle). */
function BudgetToday({
  type,
  amount,
  todaySpent,
  status,
  todayMode,
  onToggleTodayMode,
  todaySpentFair,
  todayLoading,
  fairFallback,
}: {
  type: BudgetType;
  amount: number;
  todaySpent: number;
  /** Overall budget status — chip source for full budgets (no daily cap). */
  status: BudgetStatus;
  todayMode: TotalMode;
  onToggleTodayMode: () => void;
  todaySpentFair: number | null;
  todayLoading: boolean;
  fairFallback: boolean;
}) {
  const isDaily = type === "daily";
  const cap = amount;
  // Display spend switches to fair when active; otherwise raw.
  const displaySpent = todayMode === "fair" && todaySpentFair !== null ? todaySpentFair : todaySpent;
  const todayPct = cap > 0 ? Math.round((displaySpent / cap) * 100) : 0;
  const pct = Math.min(100, todayPct);
  // Today status ladder (same 80% rule as the budget ladder).
  const todayStatus = displaySpent > cap ? "over" : displaySpent * 100 >= cap * 80 ? "warning" : "ok";
  const chipStatus = isDaily ? todayStatus : status;
  const chip = STATUS_CHIP[chipStatus];
  const barColor = chipStatus === "over" ? "bg-red-500" : chipStatus === "warning" ? "bg-amber-500" : "bg-emerald-500";
  const delta = cap - displaySpent;
  /** The headline itself is clickable (dotted underline) when a fair value exists. */
  const todayClickable =
    todayMode === "fair" || (todaySpentFair !== null && todaySpentFair !== todaySpent);

  return (
    <div
      data-testid="budget-today"
      className="relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"
    >
      <div className="pointer-events-none absolute -mr-10 -mt-10 right-0 top-0 h-24 w-24 rounded-full bg-emerald-500/5 blur-2xl" />
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">
          Hari ini
        </span>
        <span
          data-testid="budget-today-status"
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chip.className}`}>
          {chip.label}
        </span>
      </div>
      {isDaily ? (
        <BudgetTodayHeadline
          testid="budget-today-delta"
          text={fairFallback ? `${delta >= 0 ? `+${formatIDR(delta)}` : `−${formatIDR(-delta)}`} ·raw` : delta >= 0 ? `+${formatIDR(delta)}` : `−${formatIDR(-delta)}`}
          className={`text-3xl font-bold tabular-nums ${delta >= 0 ? "text-emerald-300" : "text-red-300"}`}
          clickable={todayClickable}
          fairActive={todayMode === "fair"}
          loading={todayLoading}
          onClick={onToggleTodayMode}
        />
      ) : (
        <BudgetTodayHeadline
          testid="budget-today-spent"
          text={fairFallback ? `${formatIDR(displaySpent)} ·raw` : formatIDR(displaySpent)}
          className="text-3xl font-bold tabular-nums text-neutral-100"
          clickable={todayClickable}
          fairActive={todayMode === "fair"}
          loading={todayLoading}
          onClick={onToggleTodayMode}
        />
      )}
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Progres hari ini"
      >
        <div
          className={`h-full rounded-full ${barColor} shadow-[0_0_8px_rgba(34,197,94,0.4)] transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p
        data-testid="budget-today-pct"
        className="mt-1.5 text-right text-xs tabular-nums text-neutral-500">
        {todayPct}%
      </p>
    </div>
  );
}

/** Layer 2 — Period card: Kelola | edit|hapus, big signed position
 *  headline + elapsed/total day counter + chart toggle, bar/line chart. */
function BudgetPeriod({
  dashboard,
  onEdit,
  onHapus,
  onKelola,
}: {
  dashboard: BudgetDashboardData;
  onEdit: () => void;
  onHapus: () => void;
  onKelola: () => void;
}) {
  const pos = dashboard.periodPosition;
  const behind = pos.position < 0;
  // Persisted bar ↔ line preference; first visit defaults to the auto mode
  // (line for long periods). Keyed by budgetId via the parent remount.
  const [chartMode, toggleChartMode] = useChartMode(
    "expense-app.budget-chart-mode",
    dashboard.days.length >= PERIOD_CHART_LINE_MIN_DAYS ? "line" : "bar",
  );

  return (
    <div data-testid="budget-period" className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="budget-kelola-toggle"
          onClick={onKelola}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-300 hover:text-neutral-100 active:bg-neutral-800"
        >
          Kelola Budget
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="budget-active-ganti"
            onClick={onEdit}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-200 active:bg-neutral-800"
          >
            Edit
          </button>
          <button
            type="button"
            data-testid="budget-active-hapus"
            onClick={onHapus}
            className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-semibold text-red-300 active:bg-neutral-800"
          >
            Hapus
          </button>
        </div>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p
          className={`text-2xl font-bold tabular-nums ${behind ? "text-red-300" : "text-emerald-300"}`}
          data-testid="budget-period-position">
          {behind ? `−${formatIDR(-pos.position)}` : `+${formatIDR(pos.position)}`}
        </p>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="text-xs tabular-nums text-neutral-500"
            data-testid="budget-period-days">
            {pos.elapsedDays}/{dashboard.totalRangeDays} Hari
          </span>
          <ChartModeToggle mode={chartMode} onToggle={toggleChartMode} testid="budget-chart-toggle" />
        </span>
      </div>

      {/* Diverging bar/line chart — daily: cap−total per day; full: single-direction total */}
      <BudgetPeriodChart days={dashboard.days} type={dashboard.type} forceMode={chartMode} />
      {/* Screen-reader progress (chart is role="img"; keep a real progressbar for AT). */}
      <div
        className="sr-only"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pos.progressPct)}
        aria-label="Progres periode"
      />
    </div>
  );
}

/** Layer 3 — Day History (plan §3): 14 default rows + expand button. */
const HISTORY_DEFAULT = 14;

function BudgetDayHistory({
  days,
  maxInitial = HISTORY_DEFAULT,
}: {
  days: NonNullable<BudgetDashboardData["days"]>;
  maxInitial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  // Newest first (today on top); the 14-row default keeps the latest days.
  const ordered = useMemo(() => [...days].reverse(), [days]);
  const visible = expanded ? ordered : ordered.slice(0, maxInitial);
  const hasMore = days.length > maxInitial;

  return (
    <section data-testid="budget-day-history">
      <h2 className="mb-1 px-1 text-[11px] uppercase tracking-widest text-neutral-500">
        Riwayat harian
      </h2>
      <ul className="divide-y divide-neutral-800/80 border border-neutral-800">
        {visible.map((day) => {
          const delta = "delta" in day ? day.delta : null;
          return (
            <li
              key={day.date}
              data-testid={`budget-day-row-${day.date}`}
              className="flex items-start justify-between gap-2 py-3 px-1 hover:bg-white/5">
              <div className="flex flex-col">
                <span
                  className="text-sm font-medium text-neutral-200"
                  data-testid={`budget-day-label-${day.date}`}>
                  {relativeDayLabel(day.date, new Date())}
                </span>
                <span className="text-xs text-neutral-500">
                  {formatDateShort(new Date(`${day.date}T12:00:00+07:00`), APP_TIMEZONE)}
                </span>
              </div>
              {delta !== null && (
                <span
                  className={`text-sm font-medium tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  data-testid={`budget-day-delta-${day.date}`}>
                  {delta >= 0 ? `+${formatIDR(delta)}` : `−${formatIDR(-delta)}`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && !expanded && (
        <button
          type="button"
          data-testid="budget-history-more"
          onClick={() => setExpanded(true)}
          className="mt-1 w-full text-center text-xs font-semibold text-neutral-300 active:text-neutral-100">
          Tampilkan {days.length - maxInitial} hari lainnya
        </button>
      )}
    </section>
  );
}

/** Form modal content (plan §A: mode=form) — create / replace with prefill note. */
function BudgetFormModal({
  prefill,
  active,
  type,
  setType,
  amountText,
  onAmountChange,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  perDayHint,
  canSubmit,
  busy,
  submit,
  onCancel,
  amountInputRef,
}: {
  prefill: PrefillState | null;
  active: BudgetActiveResponse["budget"];
  type: BudgetType;
  setType: (t: BudgetType) => void;
  amountText: string;
  onAmountChange: (v: string) => void;
  startDate: string;
  setStartDate: (v: string) => void;
  endDate: string;
  setEndDate: (v: string) => void;
  perDayHint: string;
  canSubmit: boolean;
  busy: boolean;
  submit: () => Promise<void>;
  onCancel: () => void;
  amountInputRef: React.Ref<HTMLInputElement>;
}) {
   return (
    <form
      data-testid="budget-form"
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-200">
        {prefill ? "Ganti budget — review & simpan" : active === null ? "Budget baru" : "Budget baru"}
      </h2>
      {prefill && (
        <p className="mt-2 rounded-lg bg-neutral-800/60 px-2.5 py-1.5 text-xs text-neutral-400" data-testid="budget-prefill-note">
          Dari {prefill.source === "active" ? "budget aktif" : "riwayat"}: tipe & nominal disalin,
          tanggal digeser otomatis — ubah bila perlu. Spent mulai dari nol.
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Tipe budget">
        <button
          type="button"
          data-testid="budget-type-daily"
          aria-pressed={type === "daily"}
          onClick={() => setType("daily")}
          className={`h-10 rounded-lg border text-sm font-semibold ${
            type === "daily"
              ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
              : "border-neutral-800 bg-neutral-900/60 text-neutral-400"
          }`}
        >
          Harian
        </button>
        <button
          type="button"
          data-testid="budget-type-full"
          aria-pressed={type === "full"}
          onClick={() => setType("full")}
          className={`h-10 rounded-lg border text-sm font-semibold ${
            type === "full"
              ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-300"
              : "border-neutral-800 bg-neutral-900/60 text-neutral-400"
          }`}
        >
          Penuh
        </button>
      </div>

      <label className="mt-4 block">
        <span className="mb-1 block text-xs text-neutral-500">
          {type === "daily" ? "Batasi per hari" : "Total untuk periode"}
        </span>
        <input
          ref={amountInputRef}
          data-testid="budget-amount"
          inputMode="numeric"
          autoComplete="off"
          placeholder="0"
          value={amountText}
          onChange={(event) => onAmountChange(normalizeDigits(event.target.value).slice(0, 12))}
          className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-right font-light tabular-nums text-neutral-50 outline-none focus:border-neutral-600"
        />
        {amountText.length > 0 && digitsToAmount(amountText) > 0 && (
          <span className="mt-1 block text-xs text-neutral-500">{perDayHint}</span>
        )}
      </label>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Mulai</span>
          <input
            type="date"
            data-testid="budget-start"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 text-sm tabular-nums text-neutral-100 outline-none focus:border-neutral-600"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">Selesai</span>
          <input
            type="date"
            data-testid="budget-end"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-2 text-sm tabular-nums text-neutral-100 outline-none focus:border-neutral-600"
          />
        </label>
      </div>

       <div className="mt-5 flex gap-2">
        <button
          type="button"
          data-testid="budget-cancel"
          onClick={onCancel}
          className="h-11 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-300 active:bg-neutral-800"
        >
          Batal
        </button>
        <button
          type="submit"
          data-testid="budget-submit"
          disabled={!canSubmit}
          className="h-11 flex-1 rounded-lg bg-emerald-600 text-sm font-semibold text-white shadow-[0_2px_0_0_#065f46] active:shadow-none disabled:bg-neutral-800 disabled:text-neutral-600 disabled:shadow-none"
        >
          {busy ? "Menyimpan..." : "Simpan budget"}
        </button>
      </div>
    </form>
  );
}

/** Kelola modal content — history / Pakai lagi. (Edit+Hapus live on the
 *  period card.) */
function BudgetKelolaModal({
  history,
  onUseAgain,
}: {
  history: BudgetHistoryItem[];
  onUseAgain: (source: string, item: { type: BudgetType; amount: number; startDate: string; endDate: string }) => void;
}) {
  return (
    <>
      <h2 className="text-sm font-semibold text-neutral-200">Kelola budget</h2>

      {history.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-neutral-500">Riwayat</h3>
          <ul className="space-y-1">
            {history.map((item) => {
              const chip = STATUS_CHIP[item.status];
              return (
                <li
                  key={item.id}
                  data-testid={`budget-history-item-${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-neutral-300">
                      {periodLabelOf(item.startDate, item.endDate, item.type)}
                      {" • "}
                      {formatIDR(item.amount)}
                    </p>
                    <p className="text-xs tabular-nums text-neutral-500">
                      {formatIDR(item.spent)} / {formatIDR(item.amount)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${chip.className}`}>
                      {chip.label}
                    </span>
                    <button
                      type="button"
                      data-testid={`budget-use-again-${item.id}`}
                      onClick={() => onUseAgain(item.id, item)}
                      className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs font-semibold text-neutral-200 active:bg-neutral-800"
                    >
                      Pakai lagi →
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
