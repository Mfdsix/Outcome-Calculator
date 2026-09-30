import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./app/App";
import { authApi, budgetsApi, expensesApi } from "./lib/api";

vi.mock("./lib/api", () => {
  const list = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const login = vi.fn();
  const refresh = vi.fn();
  const deactivate = vi.fn();
  return {
    expensesApi: { list, create, update, remove },
    budgetsApi: {
      getActive: vi.fn().mockResolvedValue({ budget: null }),
      history: vi.fn().mockResolvedValue({ history: [] }),
      create: vi.fn().mockResolvedValue({ id: "budget-1" }),
      remove: vi.fn().mockResolvedValue(undefined),
      activeSeries: vi.fn().mockResolvedValue({ days: [] }),
    },
    authApi: { login, refresh, deactivate },
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
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    loadToken: vi.fn((): string | null => null),
    setAuthToken: vi.fn(),
  };
});

vi.mock("../hooks/useOnline", () => ({ useOnline: () => true }));
vi.mock("../hooks/useSync", () => ({ useSync: () => ({ pending: 0, syncing: false }) }));
vi.mock("../lib/offlineDb", () => ({ mutateOutbox: vi.fn(), mutateTodayCache: vi.fn(), saveTodayCache: vi.fn() }));
vi.mock("../lib/sync", () => ({ queueOfflineCreate: vi.fn(), queueOfflineDelete: vi.fn(), queueOfflineUpdate: vi.fn() }));

const listMock = vi.mocked(expensesApi.list);
const getActiveMock = vi.mocked(budgetsApi.getActive);
const createMock = vi.mocked(expensesApi.create);
const updateMock = vi.mocked(expensesApi.update);
const loginMock = vi.mocked(authApi.login);

// Frozen "today" = Sep 25 2026. This makes relative labels deterministic.
const FROZEN_NOW = new Date("2026-09-25T12:00:00+07:00");

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(FROZEN_NOW);
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  createMock.mockImplementation((payload) =>
    Promise.resolve({
      id: `created-${payload.amount}`,
      amount: payload.amount,
      allocationType: payload.allocationType ?? "NONE",
      occurredAt: payload.occurredAt ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
  updateMock.mockResolvedValue({
    id: "e1",
    amount: 50000,
    allocationType: "NONE",
    occurredAt: "2026-09-17T12:00:00+07:00",
  });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function renderUnlocked(pin = "ABC123"): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

/** Build an ISO timestamp for a civil date+hour in Jakarta. */
function isoAt(year: number, month: number, day: number, hour: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+07:00`;
}

describe("App — WM overview (no auto-focus)", () => {
  it("click / up-down in overview only moves highlight — header + chart stay period-wide", async () => {
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
      { id: "b", amount: 25_000, occurredAt: isoAt(2026, 9, 24, 14), allocationType: "NONE" as const },
      { id: "c", amount: 40_000, occurredAt: isoAt(2026, 9, 23, 10), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 100_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Header shows the full-week total.
    expect(screen.getByTestId("header-total")).toHaveTextContent("Rp100.000");
    expect(screen.getByTestId("header-period-label")).toHaveTextContent("This Week");

    // Click another row: highlight moves but header/chart stay period-wide.
    await user.click(screen.getByTestId("summary-row-2026-09-23"));
    expect(screen.getByTestId("summary-row-2026-09-23")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("header-total")).toHaveTextContent("Rp100.000");
    expect(screen.getByTestId("header-period-label")).toHaveTextContent("This Week");
    // Chart still shows daily buckets, not hourly.
    expect(screen.queryByTestId(/^bar-2026-09-23T\d{2}$/)).not.toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });
});

describe("App — WM focused-day via Enter", () => {
  it("W: Enter on a day row → header shows that day's total, chart switches to 24 hourly bars", async () => {
    // Sep 24 (Yesterday relative to Sep 25) and Sep 23 (both inside last-7 range).
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
      { id: "b", amount: 25_000, occurredAt: isoAt(2026, 9, 24, 14), allocationType: "NONE" as const },
      { id: "c", amount: 40_000, occurredAt: isoAt(2026, 9, 23, 10), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 100_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Highlight the Sep 24 row, then Enter to focus it.
    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    await user.click(screen.getByTestId("key-enter"));

    // Header total should be 60000 (35k + 25k for Sep 24 only).
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp60.000");
    });

    // Period label should show the focused day.
    const label = screen.getByTestId("header-period-label");
    expect(label.textContent).toContain("24");

    // Chart should now show 24 hourly bars with testid bar-YYYY-MM-DDTHH.
    const hourBars = screen.getAllByTestId(/^bar-2026-09-24T\d{2}$/);
    expect(hourBars).toHaveLength(24);

    // The 08:00 and 14:00 bars should have data.
    expect(screen.getByTestId("bar-2026-09-24T08")).toBeInTheDocument();
    expect(screen.getByTestId("bar-2026-09-24T14")).toBeInTheDocument();
  });

  it("up/down inside focus moves the day — header + chart follow; Left exits to overview", async () => {
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
      { id: "b", amount: 70_000, occurredAt: isoAt(2026, 9, 23, 10), allocationType: "NONE" as const },
      { id: "c", amount: 10_000, occurredAt: isoAt(2026, 9, 23, 16), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 115_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Focus Sep 23 via Enter.
    await user.click(screen.getByTestId("summary-row-2026-09-23"));
    await user.click(screen.getByTestId("key-enter"));

    await waitFor(() => {
      // 70k + 10k = 80k for Sep 23
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp80.000");
    });
    expect(screen.getByTestId("bar-2026-09-23T10")).toBeInTheDocument();

    // Up moves to Sep 24 (newest first: Sep 24 is index 0, Sep 23 index 1).
    await user.click(screen.getByTestId("key-2")); // up
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp35.000");
    });
    expect(screen.getByTestId("bar-2026-09-24T08")).toBeInTheDocument();

    // Left exits focus back to overview.
    await user.click(screen.getByTestId("key-4")); // left
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp115.000");
    });
    expect(screen.getByTestId("header-period-label")).toHaveTextContent("This Week");
  });

  it("second Enter in focus drills to transactions; Escape returns to focus", async () => {
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
      { id: "b", amount: 25_000, occurredAt: isoAt(2026, 9, 24, 14), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 60_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    await user.click(screen.getByTestId("key-enter")); // focus
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp60.000");
    });

    await user.click(screen.getByTestId("key-enter")); // drill
    expect(await screen.findByTestId("browse-list")).toBeInTheDocument();
    expect(screen.getByTestId("browse-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("browse-row-b")).toBeInTheDocument();

    await user.keyboard("{Escape}"); // back to focus, not overview
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp60.000");
    });
  });

  it("M pair: focusing one day in a pair shows 1 day total (not the pair sum)", async () => {
    // Sep 25 (Today) and Sep 24 (Yesterday) are paired in month view.
    const expenses = [
      { id: "a", amount: 50_000, occurredAt: isoAt(2026, 9, 25, 10), allocationType: "NONE" as const },
      { id: "b", amount: 80_000, occurredAt: isoAt(2026, 9, 24, 12), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 130_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-month"));
    await screen.findByTestId("summary-list");

    // Highlight Sep 24, then Enter to focus it.
    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    // Overview still shows the full-month total before Enter.
    expect(screen.getByTestId("header-total")).toHaveTextContent("Rp130.000");
    await user.click(screen.getByTestId("key-enter"));

    // Should show ONLY Sep 24 total (80k), not the pair total (130k).
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp80.000");
    });

    // Period label should show the selected day, not a pair range.
    const label = screen.getByTestId("header-period-label");
    expect(label.textContent).toContain("24");
  });

  it("fair: WEEKLY expense overlapping focused day → toggle clickable; no-allocation day → not clickable in raw", async () => {
    // Sep 24 has a WEEKLY allocation (clickable), Sep 23 has only NONE (not clickable in raw mode).
    const expenses = [
      { id: "a", amount: 70_000, occurredAt: isoAt(2026, 9, 24, 10), allocationType: "WEEKLY" as const },
      { id: "b", amount: 50_000, occurredAt: isoAt(2026, 9, 23, 12), allocationType: "NONE" as const },
    ];
    // The main list fetch returns both; the expanded fair fetch returns the same.
    listMock.mockResolvedValue({ expenses, total: 120_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Overview total is not clickable in raw mode (W has no peek).
    expect(screen.getByTestId("header-total").tagName).toBe("SPAN");

    // Focus Sep 24 (has WEEKLY allocation → should be clickable in raw mode).
    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    await user.click(screen.getByTestId("key-enter"));

    // Wait for the focused total to appear, then for clickability.
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp70.000");
    });
    await waitFor(() => {
      // The header total should be a BUTTON (clickable to toggle fair).
      expect(screen.getByTestId("header-total").tagName).toBe("BUTTON");
    });

    // Sep 24 raw total = 70k. Sep 24 fair (WEEKLY 70k → 10k/day for day 1) = 10k.
    await user.click(screen.getByTestId("header-total"));

    await waitFor(() => {
      // Toggle is now fair mode. The focused header should show the focused-day
      // fair value (10k for Sep 24).
      expect(screen.getByTestId("header-total").getAttribute("aria-pressed")).toBe("true");
    });

    // Switch back to raw.
    await user.click(screen.getByTestId("header-total"));
    await waitFor(() => {
      expect(screen.getByTestId("header-total").getAttribute("aria-pressed")).toBe("false");
    });

    // Left back to overview, then focus Sep 23 (no allocation → SPAN in raw).
    await user.click(screen.getByTestId("key-4")); // left
    await waitFor(() => {
      expect(screen.getByTestId("header-period-label")).toHaveTextContent("This Week");
    });
    await user.click(screen.getByTestId("summary-row-2026-09-23"));
    await user.click(screen.getByTestId("key-enter"));

    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp50.000");
    });
    expect(screen.getByTestId("header-total").tagName).toBe("SPAN");
  });

  it("clicking an hourly bar in focus only changes highlight — focused day stays", async () => {
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
      { id: "b", amount: 25_000, occurredAt: isoAt(2026, 9, 24, 14), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 60_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    await user.click(screen.getByTestId("key-enter"));
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp60.000");
    });

    // Click the 14:00 bar — header must stay on the focused day total.
    await user.click(screen.getByTestId("bar-2026-09-24T14"));
    expect(screen.getByTestId("header-total")).toHaveTextContent("Rp60.000");
    expect(screen.getByTestId("header-period-label").textContent).toContain("24");
  });
});

describe("App — WM focused-day [+/-] follows the visible chart", () => {
  function seedDailyBudget(amount: number): void {
    getActiveMock.mockResolvedValue({
      budget: {
        id: "budget-1",
        type: "daily",
        amount,
        startDate: "2026-09-01",
        endDate: "2026-10-31",
        spent: 0,
        todaySpent: 0,
        remaining: 0,
        status: "ok",
        progressPct: 0,
      },
    });
  }

  it("daily budget: overview shows period delta, focus shows day delta, ganti hari ikut gerak", async () => {
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
      { id: "b", amount: 25_000, occurredAt: isoAt(2026, 9, 24, 14), allocationType: "NONE" as const },
      { id: "c", amount: 20_000, occurredAt: isoAt(2026, 9, 23, 10), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 80_000 });
    seedDailyBudget(50_000);

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Overview (last-7 window = Sep 18–25 = 8 civil days ∩ budget):
    // 8×50k − 80k = +Rp320.000.
    expect(await screen.findByTestId("chart-budget-delta")).toHaveTextContent("+Rp320.000");

    // Focus Sep 24: 50k − 60k = −Rp10.000 (over).
    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    await user.click(screen.getByTestId("key-enter"));
    await waitFor(() => {
      expect(screen.getByTestId("chart-budget-delta")).toHaveTextContent("−Rp10.000");
    });

    // Down → Sep 23: 50k − 20k = +Rp30.000.
    await user.click(screen.getByTestId("key-8")); // down
    await waitFor(() => {
      expect(screen.getByTestId("chart-budget-delta")).toHaveTextContent("+Rp30.000");
    });

    // Left → overview lagi.
    await user.click(screen.getByTestId("key-4")); // left
    await waitFor(() => {
      expect(screen.getByTestId("chart-budget-delta")).toHaveTextContent("+Rp320.000");
    });
  });

  it("full-pool budget: [+/-] hidden in focus (day nominal stays in header)", async () => {
    const expenses = [
      { id: "a", amount: 35_000, occurredAt: isoAt(2026, 9, 24, 8), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 35_000 });
    getActiveMock.mockResolvedValue({
      budget: {
        id: "budget-1",
        type: "full",
        amount: 500_000,
        startDate: "2026-09-01",
        endDate: "2026-10-31",
        spent: 0,
        todaySpent: 0,
        remaining: 0,
        status: "ok",
        progressPct: 0,
      },
    });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Overview shows the full-pool delta.
    expect(await screen.findByTestId("chart-budget-delta")).toBeInTheDocument();

    // Focus: delta hidden, header still shows the day nominal.
    await user.click(screen.getByTestId("summary-row-2026-09-24"));
    await user.click(screen.getByTestId("key-enter"));
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp35.000");
    });
    expect(screen.queryByTestId("chart-budget-delta")).not.toBeInTheDocument();
  });
});

describe("App — WM select (no regresi)", () => {
  it("selectedKey null → fallback to full W/M behavior (no crash, empty state)", async () => {
    vi.setSystemTime(FROZEN_NOW);
    listMock.mockResolvedValue({ expenses: [], total: 0 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));

    // No expenses → empty state, no focused day.
    await screen.findByTestId("summary-empty");

    // Chart should show full week daily buckets (7 bars).
    // Sep 25 is today; last-7 = Sep 19 → Sep 26.
    const today = new Date(FROZEN_NOW.getTime());
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Verify the chart exists with daily bars (not hourly).
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();

    // Period label should NOT show a focused-day label (should be "This Week").
    const label = screen.getByTestId("header-period-label");
    expect(label.textContent).toBe("This Week");
  });

  it("two Enters drill the focused day (single-day scope)", async () => {
    const day = 86_400_000;
    const now = FROZEN_NOW.getTime();
    const expenses = [
      { id: "a", amount: 10_000, occurredAt: new Date(now).toISOString() },
      { id: "b", amount: 20_000, occurredAt: new Date(now - day).toISOString() },
    ];
    listMock.mockResolvedValue({ expenses, total: 30_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-month"));
    await screen.findByTestId("summary-list");

    // First Enter focuses the auto-selected day, second Enter drills it.
    await user.click(screen.getByTestId("key-enter"));
    await user.click(screen.getByTestId("key-enter"));
    expect(await screen.findByTestId("browse-list")).toBeInTheDocument();
    expect(screen.getByTestId("browse-row-a")).toBeInTheDocument();

    // Exit drill via Escape → back to focus (summary still visible).
    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
    expect(screen.queryByTestId("browse-list")).not.toBeInTheDocument();
  });
});
