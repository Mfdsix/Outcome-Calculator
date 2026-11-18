import { formatTimeShort } from "@expense-app/shared";
import type { AllocationType, ExpenseDto } from "@expense-app/shared";

import { EditActions } from "./EditActions";
import { formatIDR, groupDigits } from "../lib/currency";
import { relativeDayLabel } from "../lib/dayLabels";
import { civilDayKey } from "../lib/offlineDb";
import { dateLabelFromKey } from "../lib/periodLabels";
import { APP_TIMEZONE } from "../lib/periods";

export interface EditPanelProps {
  /** The transaction being edited (snapshot from edit start). */
  expense: ExpenseDto | null;
  /** Live calculator input — the amount being typed. */
  amount: number;
  /** Live allocation selection from AdvancedControls. */
  allocationType: AllocationType;
  onBack: () => void;
  onDelete: () => void;
}

/**
 * Wide-screen right column during an edit: the selected item's details plus
 * the Back/Delete actions (moved out of the calculator column so the edit
 * context and its escape hatches live next to the history they came from).
 * The header row mirrors the HistoryPane's [label][total] row so both columns
 * keep the same height rhythm.
 */
export function EditPanel({ expense, amount, allocationType, onBack, onDelete }: EditPanelProps) {
  if (!expense) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-4" data-testid="edit-panel">
        <EditActions variant="static" onBack={onBack} onDelete={onDelete} />
      </div>
    );
  }

  const dayKey = civilDayKey(expense.occurredAt);
  const allocationLabel =
    allocationType === "WEEKLY" ? "Weekly" : allocationType === "MONTHLY" ? "Monthly" : "—";

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-4" data-testid="edit-panel">
      <div className="flex h-11 items-center justify-between px-1 mb-2">
        <span className="text-sm font-medium text-neutral-400" data-testid="edit-panel-title">
          Edit transaksi
        </span>
        <span className="text-sm font-semibold tabular-nums text-neutral-100" data-testid="edit-panel-amount">
          {groupDigits(String(amount))}
        </span>
      </div>

      <dl className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/50 px-3 py-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">Waktu</dt>
          <dd className="text-right text-neutral-200">
            {relativeDayLabel(dayKey, new Date())} · {dateLabelFromKey(dayKey)} ·{" "}
            {formatTimeShort(new Date(expense.occurredAt), APP_TIMEZONE)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">Jumlah awal</dt>
          <dd className="text-right tabular-nums text-neutral-200">{formatIDR(expense.amount)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-neutral-500">Alokasi</dt>
          <dd className="text-right text-neutral-200" data-testid="edit-panel-allocation">
            {allocationLabel}
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        <EditActions variant="static" onBack={onBack} onDelete={onDelete} />
      </div>
    </div>
  );
}
