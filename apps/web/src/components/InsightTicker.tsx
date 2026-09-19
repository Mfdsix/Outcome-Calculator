import { useEffect, useRef, useState } from "react";

import type { Insight } from "@expense-app/shared";

const TONE_BG: Record<Insight["tone"], string> = {
  ok: "bg-neutral-900/60",
  info: "bg-neutral-900/60",
  warn: "bg-amber-950/30",
  over: "bg-red-950/30",
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
  const textRef = useRef<HTMLSpanElement>(null);

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

  // Width-aware marquee: duration scales with text length; zero dead gap on loop.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const distance = el.scrollWidth;
    const pxPerSec = 50;
    const duration = Math.max(5, distance / pxPerSec);
    el.style.animationDuration = `${duration}s`;
  }, [safeIndex, insight.short]);

  return (
    <button
      type="button"
      data-testid="insight-ticker"
      role="status"
      aria-label={`Insight: ${insight.short} — ketuk untuk lihat semua`}
      onClick={onOpen}
       className={`relative mb-1 flex w-full items-center overflow-hidden rounded-lg px-1 py-0.5 text-left text-[11px] text-neutral-400 transition-colors hover:bg-neutral-900/60 ${TONE_BG[insight.tone]}`}
    >
      <span
        key={insight.id}
        ref={textRef}
        className="insight-marquee whitespace-nowrap"
      >
        {insight.short}
      </span>
    </button>
  );
}
