import { useEffect, useState } from "react";

import type { Insight } from "@expense-app/shared";

const TONE_DOT: Record<Insight["tone"], string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  over: "bg-red-400",
  info: "bg-neutral-400",
};

/** Rotation cadence (plan §3): 4 seconds per insight, fade between. */
const ROTATE_MS = 4000;

export interface InsightTickerProps {
  insights: Insight[];
  onOpen: () => void;
}

/**
 * One-line rotating insight row (plan "Insight Kecil" §3) — replaces the
 * budget-micro row on the calculator screen. The whole row is a button that
 * opens the full insight list; rotation pauses while the list is open because
 * the ticker itself unmounts there (plan §5).
 */
export function InsightTicker({ insights, onOpen }: InsightTickerProps) {
  // Single insight → nothing to rotate; keep the index pinned at 0.
  const [index, setIndex] = useState(0);
  const count = insights.length;

  useEffect(() => {
    if (count <= 1) return;
    const timer = setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [count]);

  // Guard against the list shrinking (e.g. budget removed mid-rotation).
  const safeIndex = count === 0 ? 0 : index % count;
  const insight = insights[safeIndex];
  if (!insight) return null;

  return (
    <button
      type="button"
      data-testid="insight-ticker"
      role="status"
      aria-label={`Insight: ${insight.short} — ketuk untuk lihat semua`}
      onClick={onOpen}
      className="mb-1 flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-[11px] text-neutral-400 transition-colors hover:bg-neutral-900/60"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[insight.tone]}`} aria-hidden="true" />
      <span key={insight.id} className="animate-insight-fade truncate">
        {insight.short}
      </span>
    </button>
  );
}
