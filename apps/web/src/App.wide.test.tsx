import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./app/App";
import { authApi, expensesApi } from "./lib/api";

vi.mock("./lib/api", () => {
  const list = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const login = vi.fn();
  const refresh = vi.fn();
  return {
    expensesApi: { list, create, update, remove },
    budgetsApi: {
      getActive: vi.fn().mockResolvedValue({ budget: null }),
      history: vi.fn().mockResolvedValue({ history: [] }),
      create: vi.fn().mockResolvedValue({ id: "budget-1" }),
      remove: vi.fn().mockResolvedValue(undefined),
      activeSeries: vi.fn().mockResolvedValue({ days: [] }),
    },
    authApi: { login, refresh },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    UnauthorizedError: class UnauthorizedError extends Error {},
    OfflineError: class OfflineError extends Error {
      status = 0;
      constructor() {
        super("offline");
        this.name = "OfflineError";
      }
    },
    isOnline: vi.fn(() => true),
    loadToken: vi.fn((): string | null => null),
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    setAuthToken: vi.fn(),
  };
});

vi.mock("../hooks/useOnline", () => ({ useOnline: () => true }));
vi.mock("../hooks/useSync", () => ({ useSync: () => ({ pending: 0, syncing: false }) }));
vi.mock("../lib/sync", () => ({ queueOfflineCreate: vi.fn(), queueOfflineDelete: vi.fn(), queueOfflineUpdate: vi.fn() }));

const listMock = vi.mocked(expensesApi.list);
const loginMock = vi.mocked(authApi.login);

// --- Controllable matchMedia (narrow ↔ wide flips for the resize test) -------

let wide = false;
const mediaListeners: Array<(event: MediaQueryListEvent) => void> = [];

function setWide(next: boolean): void {
  wide = next;
  for (const listener of [...mediaListeners]) {
    listener({ matches: next } as unknown as MediaQueryListEvent);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  wide = false;
  mediaListeners.length = 0;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      mediaListeners.push(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      const index = mediaListeners.indexOf(listener);
      if (index >= 0) mediaListeners.splice(index, 1);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;

  listMock.mockResolvedValue({ expenses: [], total: 0 });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.clearAllMocks();
  localStorage.clear();
});

async function renderUnlocked(pin = "ABC123"): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

describe("App — wide-screen split layout (§wide)", () => {
  it("renders the calculator and the HistoryPane side by side (50/50)", async () => {
    setWide(true);
    await renderUnlocked();

    expect(screen.getByTestId("wide-layout")).toBeInTheDocument();
    expect(screen.getByTestId("history-pane")).toBeInTheDocument();
    // Left column keeps the calculator + the navbar header block.
    expect(screen.getByTestId("keypad")).toBeInTheDocument();
    expect(screen.getByTestId("amount-display")).toBeInTheDocument();
    // Navbar (left column): Today label + total + D/W/M strip.
    expect(screen.getByTestId("header-period-label")).toHaveTextContent("Today");
    expect(screen.getByTestId("header-total")).toBeInTheDocument();
    expect(screen.getByTestId("period-day")).toBeInTheDocument();
    expect(screen.getByTestId("period-week")).toBeInTheDocument();
    // Pane keeps its own [Today][total] header row in every scope.
    expect(screen.getByTestId("pane-period-label")).toHaveTextContent("Today");
    expect(screen.getByTestId("pane-total")).toBeInTheDocument();
    // The left hourly chart is hidden in wide — the only chart is the pane's.
    expect(screen.getAllByTestId("bar-chart")).toHaveLength(1);
    // The mobile-only period strip is replaced by the navbar strip.
    expect(screen.getAllByTestId("period-selector")).toHaveLength(1);
  });

  it("pane period tabs switch data without leaving the calculator", async () => {
    setWide(true);
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("period-week"));
    expect(await screen.findByTestId("pane-period-label")).toHaveTextContent("This Week");
    // Calculator column untouched: keypad + amount input still there.
    expect(screen.getByTestId("keypad")).toBeInTheDocument();
    expect(screen.getByTestId("amount-display")).toBeInTheDocument();

    await user.click(screen.getByTestId("period-month"));
    expect(await screen.findByTestId("pane-period-label")).toHaveTextContent("This Month");

    await user.click(screen.getByTestId("period-day"));
    await waitFor(() => {
      // Back to D: pane header row returns to the Today context.
      expect(screen.getByTestId("pane-period-label")).toHaveTextContent("Today");
    });
    expect(screen.getByTestId("keypad")).toBeInTheDocument();
  });

  it("W pane shows the offline hint when the range fetch fails", async () => {
    setWide(true);
    listMock.mockRejectedValue(new OfflineErrorNamed());
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("period-week"));
    expect(await screen.findByTestId("pane-offline-hint")).toBeInTheDocument();
  });

  it("digits still enter the calculator while the pane is open", async () => {
    setWide(true);
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("key-5"));
    expect(screen.getByTestId("amount-display")).toHaveTextContent("5");
  });

  it("double-clicking a pane transaction opens the calculator edit mode", async () => {
    setWide(true);
    listMock.mockResolvedValue({
      expenses: [
        { id: "e1", amount: 12_500, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      ],
      total: 12_500,
    });
    const user = await renderUnlocked();

    const row = await screen.findByTestId("summary-row-e1");
    await user.dblClick(row);

    // Right column swaps to the edit panel: details + Back/Delete actions.
    expect(await screen.findByTestId("edit-panel")).toBeInTheDocument();
    expect(screen.getByTestId("edit-panel-title")).toHaveTextContent("Edit transaksi");
    expect(screen.getByTestId("edit-panel-amount")).toHaveTextContent("12.500");
    expect(screen.getByText("Jumlah awal")).toBeInTheDocument();
    expect(within(screen.getByTestId("edit-panel")).getByText("Rp12.500")).toBeInTheDocument();
    expect(screen.getByTestId("edit-back")).toBeInTheDocument();
    expect(screen.getByTestId("edit-delete")).toBeInTheDocument();

    // Left column: calculator edit mode (amount display shows the edit).
    expect(screen.getByTestId("amount-display")).toHaveTextContent("12.500");

    // Back returns to the pane (edit panel unmounts, input clears).
    await user.click(screen.getByTestId("edit-back"));
    await waitFor(() => {
      expect(screen.queryByTestId("edit-panel")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("amount-display")).toHaveTextContent("0");
  });

  it("arrows move the pane selection and Enter with an empty input activates it", async () => {
    setWide(true);
    listMock.mockResolvedValue({
      expenses: [
        { id: "e1", amount: 1_000, occurredAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), allocationType: "NONE" as const },
        { id: "e2", amount: 2_000, occurredAt: new Date(Date.now() - 1 * 3_600_000).toISOString(), allocationType: "NONE" as const },
      ],
      total: 3_000,
    });
    const user = await renderUnlocked();

    // Newest row auto-seeds (e2).
    await waitFor(() => {
      expect(screen.getByTestId("summary-row-e2")).toHaveAttribute("aria-pressed", "true");
    });

    // ArrowDown moves the selection to the older row (newest-first list).
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(screen.getByTestId("summary-row-e1")).toHaveAttribute("aria-pressed", "true");
    });

    // Enter with an empty calculator activates the selection → edit mode.
    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("edit-actions")).toBeInTheDocument();
  });

  it("widening the window exits the fullscreen special history into the pane", async () => {
    listMock.mockResolvedValue({
      expenses: [
        { id: "e1", amount: 1_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      ],
      total: 1_000,
    });
    const user = await renderUnlocked();

    // Narrow: open D history fullscreen (mobile special mode).
    await user.click(screen.getByTestId("period-day"));
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
    expect(screen.queryByTestId("history-pane")).not.toBeInTheDocument();

    // Resize to wide → special mode closes, the pane takes over.
    setWide(true);
    expect(await screen.findByTestId("wide-layout")).toBeInTheDocument();
    expect(screen.getByTestId("history-pane")).toBeInTheDocument();
    // Navbar is back to the Today context; pane header row matches it.
    expect(screen.getByTestId("header-period-label")).toHaveTextContent("Today");
    expect(screen.getByTestId("pane-period-label")).toHaveTextContent("Today");
  });
});

/** Local alias so the mock's OfflineError class is referenceable. */
class OfflineErrorNamed extends Error {
  status = 0;
  name = "OfflineError";
}
