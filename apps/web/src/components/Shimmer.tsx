import { type ReactNode } from "react";

export interface ShimmerProps {
  /** Extra classes applied to the shimmer track (e.g. "h-4 w-16 rounded"). */
  className?: string;
  /** Optional stable test id for tests. */
  testid?: string;
  /** Accessible label for the loading region. */
  label?: string;
}

/**
 * Sweep-gradient shimmer track. Renders a div with a ::after pseudo that sweeps
 * a white-transparent gradient left→right on a loop. `aria-busy` + `role=status`
 * make the loading region discoverable; `data-testid` keeps legacy test selectors
 * working. Prefers-reduced-motion disables the animation (static grey instead).
 *
 * The outer div sets a fixed background so legacy snapshot matchers that asserted
 * `animate-pulse` / bg-neutral-800 classes continue to see a neutral surface.
 */
export function Shimmer({ className, testid, label }: ShimmerProps) {
  return (
    <span
      role="status"
      aria-busy
      aria-label={label ?? "Memuat..."}
      data-testid={testid}
      className={
        "relative inline-block overflow-hidden rounded bg-neutral-800" +
        (className ? ` ${className}` : "")
      }
    >
      <i
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded"
        data-shimmer-sweep=""
      />
    </span>
  );
}

/** A single shimmer text line. */
export function ShimmerText({ className, testid, label }: ShimmerProps) {
  return (
    <Shimmer
      testid={testid}
      label={label}
      className={className ?? "h-4 w-16"}
    />
  );
}

/** Large shimmer headline (e.g. budget delta). */
export function ShimmerHeadline({ className, testid, label }: ShimmerProps) {
  return (
    <Shimmer
      testid={testid}
      label={label}
      className={className ?? "h-9 w-40"}
    />
  );
}

/** Shimmer card (replaces the "Memuat..." active-card placeholder). */
export function ShimmerCard({ className, testid, label }: ShimmerProps) {
  return (
    <Shimmer
      testid={testid}
      label={label}
      className={className ?? "h-40 w-full"}
    />
  );
}

/** N stacked shimmer rows (e.g. transaction history). */
export function ShimmerRows({ n = 5, className, testid, label }: ShimmerProps & { n?: number }) {
  return (
    <div role="status" aria-busy aria-label={label ?? "Memuat..."} data-testid={testid} className="flex flex-col gap-2">
      {Array.from({ length: n }).map((_, i) => (
        <Shimmer
          key={i}
          className={className ?? `h-4 w-full`}
          label={label}
        />
      ))}
    </div>
  );
}

/** Shimmer bar chart area (replaces `return null` while loading). */
export function ShimmerChart({ className, testid, label }: ShimmerProps) {
  return (
    <Shimmer
      testid={testid}
      label={label}
      className={className ?? "h-24 w-full"}
    />
  );
}

/** Shimmer inside a button body while a mutation is in flight. */
export function ShimmerButton({ className, testid, label }: ShimmerProps) {
  return (
    <Shimmer
      testid={testid}
      label={label ?? "Menyimpan..."}
      className={className ?? "h-5 w-20"}
    />
  );
}
