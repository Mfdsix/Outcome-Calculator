import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { APP_TIMEZONE } from "../lib/periods";
import { allocationEndCaption, formatIDR } from "@expense-app/shared";
import type { FairBreakdown } from "@expense-app/shared";

export interface FairInfoButtonProps {
  /** Label shown in the dialog title (e.g. "Rincian fair — 24 Sep"). */
  label: string;
  breakdown: FairBreakdown;
  /** When true, the [?] button is rendered (i.e. fair mode + clickable scope). */
  show?: boolean;
  /** Civil day key (YYYY-MM-DD) the user is viewing, in APP_TIMEZONE. Used to
   * compute remaining-days for each allocation row. When null/invalid the
   * sub-caption shows only "s.d. <end>" without a remaining text. */
  dayKey?: string | null;
}

/**
 * Small `[?]` info button placed inline next to a fair total value.
 * Opens the FairBreakdownDialog on click.
 */
export function FairInfoButton({ label, breakdown, show, dayKey }: FairInfoButtonProps) {
  if (!show) return null;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        data-testid="fair-info"
        aria-label="Lihat rincian fair"
        title="Lihat rincian fair"
        onClick={() => setOpen(true)}
        className="ml-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full border border-neutral-600 px-1 text-[10px] font-bold leading-none text-neutral-400 hover:border-neutral-400 hover:text-neutral-200"
      >
        ?
      </button>
      {open && createPortal(
        <FairBreakdownDialog label={label} breakdown={breakdown} dayKey={dayKey} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  );
}

export interface FairBreakdownDialogProps {
  label: string;
  breakdown: FairBreakdown;
  onClose: () => void;
  /** Civil day key (YYYY-MM-DD) the user is viewing; drives remaining-days text. */
  dayKey?: string | null;
}

/** Reused modal pattern (Backdrop/Click-stop/Escape/close button). */
export function FairBreakdownDialog({ label, breakdown, dayKey, onClose }: FairBreakdownDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const handleBackdrop = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };
  const rows = breakdown.rows;
  const hasRows = rows.length > 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Rincian fair"
      data-testid="fair-breakdown"
      onClick={handleBackdrop}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-100">{label}</h2>

        <p className="mb-3 text-sm text-neutral-100" data-testid="fair-breakdown-total">
          Total fair: <span className="font-semibold">{formatIDR(breakdown.fairTotal)}</span>
        </p>

         {hasRows ? (
          <ul className="divide-y divide-neutral-800/80 border border-neutral-800 rounded-lg overflow-hidden">
            {rows.map((row) => {
              const caption = dayKey
                ? allocationEndCaption(row.occurredAt, row.allocationType, APP_TIMEZONE, dayKey)
                : null;
              return (
                <li
                  key={row.id}
                  data-testid={`fair-breakdown-row-${row.id}`}
                  className="grid grid-cols-[1fr_auto] items-start gap-2 px-3 py-2"
                >
                  <span className="text-xs text-neutral-300 truncate">
                    {new Date(row.occurredAt).toLocaleDateString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    <span
                      className={
                        row.allocationType === "WEEKLY"
                          ? "rounded border border-emerald-800 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
                          : "rounded border border-amber-800 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                      }
                    >
                      {row.allocationType === "WEEKLY" ? "Weekly" : "Monthly"}
                    </span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-neutral-100">
                    {formatIDR(row.perDayAmount)}
                  </span>
                  {caption && (
                    <p
                      data-testid={`fair-breakdown-until-${row.id}`}
                      className="col-span-2 mt-1 text-[11px] text-neutral-500"
                    >
                      s.d. {caption.endLabel}
                      {caption.remainingText ? ` · ${caption.remainingText}` : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-4 text-center text-sm text-neutral-500">
            Tidak ada alokasi yang kena hari ini.
          </p>
        )}

        <button
          type="button"
          ref={closeRef}
          data-testid="fair-breakdown-close"
          onClick={onClose}
          className="mt-4 w-full rounded-lg border border-neutral-700 py-2 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
