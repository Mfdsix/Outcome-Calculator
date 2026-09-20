export interface ConnIndicatorProps {
  online: boolean;
  syncing: boolean;
  pending: number;
  /** Data currently shown comes from the local cache (offline day view). */
  cached?: boolean;
}

type ConnState = {
  label: string;
  color: string;
  pulse: boolean;
  title: string;
};

/**
 * Always-visible connection indicator (plan §7). Pure dot + label,
 * role="status" so tests and screen readers can find it.
 * 4 states: Online (green), Offline (red/amber, "tersimpan lokal"),
 * Sync N (yellow pulsing), Pending N (online but outbox > 0).
 */
export function ConnIndicator({ online, syncing, pending, cached }: ConnIndicatorProps) {
  let state: ConnState;
  if (!online) {
    state = {
      label: "Offline" + (pending > 0 ? ` · ${pending}` : ""),
      color: "bg-amber-400",
      pulse: false,
      title: "Offline — perubahan disimpan di perangkat lalu disinkronkan otomatis.",
    };
  } else if (syncing) {
    state = {
      label: "Sync…",
      color: "bg-yellow-400",
      pulse: true,
      title: "Menyinkronkan perubahan ke server…",
    };
  } else if (pending > 0) {
    state = {
      label: `Menunggu ${pending}`,
      color: "bg-yellow-400",
      pulse: false,
      title: `${pending} perubahan menunggu sinkron otomatis.`,
    };
  } else if (cached) {
    state = {
      label: "Lokal",
      color: "bg-neutral-500",
      pulse: false,
      title: "Menampilkan data tersimpan lokal.",
    };
  } else {
    state = {
      label: "Online",
      color: "bg-emerald-500",
      pulse: false,
      title: "Tersambung ke server.",
    };
  }

  return (
    <span
      role="status"
      data-testid="conn-indicator"
      title={state.title}
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] leading-none text-neutral-400"
    >
      <span
        aria-hidden="true"
        className={`inline-block size-1.5 rounded-full ${state.color} ${state.pulse ? "animate-pulse" : ""}`}
      />
      <span data-testid="conn-indicator-label">{state.label}</span>
    </span>
  );
}
