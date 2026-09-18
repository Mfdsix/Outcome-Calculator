import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BudgetActiveResponse,
  BudgetHistoryItem,
  BudgetStatus,
  BudgetType,
  CreateBudgetPayload,
  SuggestedCopyDates,
} from "@expense-app/shared";
import { civilToday, digitsToAmount, formatIDR, normalizeDigits, suggestCopyDates } from "@expense-app/shared";

import { BudgetProgress, periodLabelOf } from "./BudgetProgress";
import { APP_TIMEZONE } from "../lib/periods";

export interface BudgetScreenProps {
  active: BudgetActiveResponse["budget"];
  history: BudgetHistoryItem[];
  loading: boolean;
  onBack: () => void;
  onCreate: (payload: CreateBudgetPayload) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
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
export function BudgetScreen({ active, history, loading, onBack, onCreate, onRemove }: BudgetScreenProps) {
  const todayISO = useMemo(() => civilToISO(civilToday(APP_TIMEZONE)), []);

  const [prefill, setPrefill] = useState<PrefillState | null>(null);
  const [type, setType] = useState<BudgetType>("daily");
  const [amountText, setAmountText] = useState("");
  const [startDate, setStartDate] = useState(todayISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  /** Apply a prefill: identical type+amount, smart-shifted editable dates. */
  useEffect(() => {
    if (!prefill) return;
    setType(prefill.type);
    setAmountText(String(prefill.amount));
    setStartDate(prefill.suggested.startDate);
    setEndDate(prefill.suggested.endDate);
    // jsdom (tests) has no scrollIntoView — guard it.
    const formEl = formRef.current;
    if (formEl && typeof formEl.scrollIntoView === "function") {
      formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [prefill]);

  const useAgain = (source: string, item: { type: BudgetType; amount: number; startDate: string; endDate: string }): void => {
    setPrefill({
      type: item.type,
      amount: item.amount,
      suggested: suggestCopyDates(item, APP_TIMEZONE),
      source,
    });
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
      setPrefill(null);
      setAmountText("");
    }
  };

  // Gray "Selesai" card + "Buat yang baru" CTA once the period is fully past.
  const finished = active !== null && active.endDate < todayISO;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="budget-screen">
      {/* Top bar */}
      <div className="flex items-center gap-2 pb-2">
        <button
          type="button"
          aria-label="Kembali ke kalkulator"
          data-testid="budget-back"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/60 text-neutral-300 active:bg-neutral-800"
        >
          ←
        </button>
        <h1 className="text-base font-semibold text-neutral-100">Budget</h1>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
        {/* Active card / empty state */}
        {loading && active === null ? (
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-6 text-center text-sm text-neutral-500">
            Memuat…
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
            <BudgetProgress
              variant="card"
              type={active.type}
              amount={active.amount}
              spent={active.spent}
              remaining={active.remaining}
              status={active.status}
              progressPct={active.progressPct}
              periodLabel={periodLabelOf(active.startDate, active.endDate, active.type)}
              finished={finished}
            />
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="budget-active-ganti"
                onClick={() => useAgain("active", active)}
                className="h-10 flex-1 rounded-lg border border-emerald-700/70 bg-emerald-600/15 text-sm font-semibold text-emerald-300 active:bg-emerald-600/25"
              >
                {finished ? "Buat yang baru" : "Ganti"}
              </button>
              <button
                type="button"
                data-testid="budget-active-hapus"
                onClick={() => setConfirmRemove(true)}
                className="h-10 rounded-lg border border-neutral-800 px-4 text-sm font-semibold text-red-300 active:bg-neutral-800"
              >
                Hapus
              </button>
            </div>
          </>
        )}

        {/* History — hidden entirely when empty (plan §3: not a noisy empty state) */}
        {history.length > 0 && (
          <section data-testid="budget-history">
            <h2 className="mb-1 px-1 text-[11px] uppercase tracking-widest text-neutral-500">
              Riwayat
            </h2>
            <ul className="divide-y divide-neutral-800/80 rounded-xl border border-neutral-800 bg-neutral-900/50">
              {history.map((item) => {
                const chip = STATUS_CHIP[item.status];
                return (
                  <li
                    key={item.id}
                    data-testid={`budget-history-item-${item.id}`}
                    className="flex items-center justify-between gap-2 px-3 py-2.5"
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
                        onClick={() => useAgain(item.id, item)}
                        className="rounded-lg border border-neutral-700 px-2.5 py-1.5 text-xs font-semibold text-neutral-200 active:bg-neutral-800"
                      >
                        Pakai lagi →
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Create / replace form */}
        <section>
          <h2 className="mb-1 px-1 text-[11px] uppercase tracking-widest text-neutral-500">
            {prefill ? "Ganti budget — review & simpan" : "Budget baru"}
          </h2>
          <form
            ref={formRef}
            data-testid="budget-form"
            className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/50 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {prefill && (
              <p className="rounded-lg bg-neutral-800/60 px-2.5 py-1.5 text-xs text-neutral-400" data-testid="budget-prefill-note">
                Dari {prefill.source === "active" ? "budget aktif" : "riwayat"}: tipe & nominal disalin,
                tanggal digeser otomatis — ubah bila perlu. Spent mulai dari nol.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipe budget">
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

            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500">
                {type === "daily" ? "Batasi per hari" : "Total untuk periode"}
              </span>
              <input
                data-testid="budget-amount"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={amountText}
                onChange={(event) => setAmountText(normalizeDigits(event.target.value).slice(0, 12))}
                className="h-11 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-right font-light tabular-nums text-neutral-50 outline-none focus:border-neutral-600"
              />
              {amount > 0 && <span className="mt-1 block text-xs text-neutral-500">{perDayHint}</span>}
            </label>

            <div className="grid grid-cols-2 gap-2">
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

            <button
              type="submit"
              data-testid="budget-submit"
              disabled={!canSubmit}
              className="h-11 w-full rounded-lg bg-emerald-600 text-sm font-semibold text-white shadow-[0_2px_0_0_#065f46] active:shadow-none disabled:bg-neutral-800 disabled:text-neutral-600 disabled:shadow-none"
            >
              {busy ? "Menyimpan…" : "Simpan budget"}
            </button>
          </form>
        </section>
      </div>

      {/* Soft-delete confirm: history keeps the row (plan §1 — no hard delete) */}
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
  );
}
