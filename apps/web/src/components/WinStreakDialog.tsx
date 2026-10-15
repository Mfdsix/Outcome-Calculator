import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { formatIDR, formatDateShort } from "@expense-app/shared";
import type { WinStreakResult } from "@expense-app/shared";

import { APP_TIMEZONE } from "../lib/periods";

export interface WinStreakDialogProps {
  winStreaks: WinStreakResult;
  /** Today's civil day key (YYYY-MM-DD) — used to detect "live" run. */
  todayKey: string;
  onClose: () => void;
}

function formatRange(startDate: string, endDate: string): string {
  const parts = startDate.split("-").map(Number) as [number, number, number];
  const [y, m, d] = parts;
  const start = formatDateShort(
    new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12)),
    APP_TIMEZONE,
  );
  const endParts = endDate.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = endParts;
  const end = formatDateShort(
    new Date(Date.UTC(ey, (em ?? 1) - 1, ed ?? 1, 12)),
    APP_TIMEZONE,
  );
  return start === end ? start : `${start} – ${end}`;
}

/**
 * Win streak detail dialog (plan §5). Shows the current live run (with the
 * "Hari ini berjalan" badge), the longest recorded run, and the run with the
 * biggest cumulative saving. Pattern mirrors FairBreakdownDialog: portal,
 * backdrop click / Escape / close button.
 */
export function WinStreakDialog({ winStreaks, todayKey, onClose }: WinStreakDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleBackdrop = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };

  const { current, longest, biggestSaving } = winStreaks;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Winstreak"
      data-testid="winstreak-dialog"
      onClick={handleBackdrop}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-neutral-100">Winstreak</h2>

        {/* Current run (live) */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Berjalan
          </h3>
          {current ? (
            <div className="mt-1">
              <p className="text-sm">
                <span className="font-semibold text-neutral-200">{current.count}</span>{" "}
                hari · hemat{" "}
                <span className="font-semibold text-emerald-300">{formatIDR(current.saving)}</span>
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {formatRange(current.startDate, current.endDate)}
              </p>
              {current.endDate === todayKey && (
                <span
                  data-testid="winstreak-live-badge"
                  className="mt-1 inline-block rounded border border-emerald-800 bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300"
                >
                  Hari ini berjalan
                </span>
              )}
            </div>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">Hari ini melewati batas — streak putus.</p>
          )}
        </div>

        {/* Longest run */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Rekor terlama
          </h3>
          {longest ? (
            <div className="mt-1">
              <p className="text-sm">
                <span className="font-semibold text-neutral-200">{longest.count}</span> hari · hemat{" "}
                <span className="font-semibold text-emerald-300">{formatIDR(longest.saving)}</span>
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {formatRange(longest.startDate, longest.endDate)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">Belum ada streak yang tercatat.</p>
          )}
        </div>

        {/* Biggest saving */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Hemat terbesar
          </h3>
          {biggestSaving ? (
            <div className="mt-1">
              <p className="text-sm">
                <span className="font-semibold text-neutral-200">{formatIDR(biggestSaving.saving)}</span>{" "}
                (<span className="font-semibold text-neutral-200">{biggestSaving.count}</span> hari)
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">
                {formatRange(biggestSaving.startDate, biggestSaving.endDate)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">Belum ada.</p>
          )}
        </div>

        <button
          type="button"
          ref={closeRef}
          data-testid="winstreak-close"
          onClick={onClose}
          className="w-full rounded-lg border border-neutral-700 py-2 text-sm font-semibold text-neutral-200 active:bg-neutral-800"
        >
          Tutup
        </button>
      </div>
    </div>,
    document.body,
  );
}
