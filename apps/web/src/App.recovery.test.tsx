import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetActiveResponse, BudgetDayPoint } from "@expense-app/shared";

import App from "./app/App";
import { authApi, budgetsApi, expensesApi } from "./lib/api";

vi.mock("./lib/api", () => {
  return {
    expensesApi: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    budgetsApi: {
      getActive: vi.fn(),
      history: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
      activeSeries: vi.fn(),
    },
    authApi: { login: vi.fn(), refresh: vi.fn(), deactivate: vi.fn() },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    UnauthorizedError: class UnauthorizedError extends Error {},
    OfflineError: class OfflineError extends Error { status = 0; constructor() { super("offline"); this.name = "OfflineError"; } },
    isOnline: vi.fn(() => true),
    loadToken: vi.fn((): string | null => null),
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    setAuthToken: vi.fn(),
  };
});

vi.mock("../hooks/useOnline", () => ({ useOnline: () => true }));
vi.mock("../hooks/useSync", () => ({ useSync: () => ({ pending: 0, syncing: false }) }));
vi.mock("../lib/offlineDb", () => ({ mutateOutbox: vi.fn(), mutateTodayCache: vi.fn() }));
vi.mock("../lib/sync", () => ({ queueOfflineCreate: vi.fn(), queueOfflineDelete: vi.fn(), queueOfflineUpdate: vi.fn() }));

const listMock = vi.mocked(expensesApi.list);
const getActiveMock = vi.mocked(budgetsApi.getActive);
const historyMock = vi.mocked(budgetsApi.history);
const seriesMock = vi.mocked(budgetsApi.activeSeries);
const loginMock = vi.mocked(authApi.login);

/** Civil date (Asia/Jakarta) `offset` days from today — date-independent tests. */
function isoDay(offset = 0): string {
  const date = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

function activeBudget(
  overrides: Partial<NonNullable<BudgetActiveResponse["budget"]>> = {},
): BudgetActiveResponse {
  return {
    budget: {
      id: "budget-1",
      type: "daily",
      amount: 100_000,
      // 3 elapsed days today (2 days ago → today), 5 days left after today.
      startDate: isoDay(-2),
      endDate: isoDay(5),
      spent: 100_000,
      todaySpent: 100_000,
      remaining: 0,
      status: "over",
      progressPct: 100,
      ...overrides,
    },
  };
}

/** Sparse series for the 3 elapsed days: cumulative Rp400.000 vs cap 3×100.000. */
function overSeries(): { days: BudgetDayPoint[] } {
  return {
    days: [
      { date: isoDay(-2), total: 150_000 },
      { date: isoDay(-1), total: 150_000 },
      { date: isoDay(0), total: 100_000 },
    ],
  };
}

function underSeries(): { days: BudgetDayPoint[] } {
  return {
    days: [
      { date: isoDay(-2), total: 50_000 },
      { date: isoDay(-1), total: 50_000 },
      { date: isoDay(0), total: 50_000 },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  getActiveMock.mockResolvedValue({ budget: null });
  historyMock.mockResolvedValue({ history: [] });
  seriesMock.mockResolvedValue({ days: [] });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

async function renderUnlocked() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), "ABC123");
  await screen.findByTestId("keypad");
  return user;
}

async function openInsightScreen(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId("user-menu-button"));
  await screen.findByTestId("user-menu");
  await user.click(screen.getByTestId("user-menu-insight"));
  await screen.findByTestId("insight-screen");
}

describe("App — daily recovery planner (cumulative budget (−))", () => {
  it("plans against the RUNNING total, not today's spend", async () => {
    // No expense today at all — the overrun lives in the cumulative series.
    listMock.mockResolvedValue({ expenses: [], total: 0 });
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue(overSeries());

    const user = await renderUnlocked();
    await openInsightScreen(user);

    const card = await screen.findByTestId("insight-recovery");
    expect(card).toHaveTextContent("Anjuran hemat");
    // 400.000 spent vs 3 elapsed days × 100.000 = 300.000 → deficit 100.000.
    expect(screen.getByTestId("insight-recovery-deficit")).toHaveTextContent("lewat Rp100.000");
    expect(screen.getByTestId("insight-recovery-deficit")).toHaveTextContent("Rp300.000");
    expect(screen.getByTestId("insight-recovery-progress")).toHaveTextContent("Rp400.000");
    expect(screen.getByTestId("insight-recovery-progress")).toHaveTextContent("3 hari berjalan");

    // Default horizon = the remaining period (5 days): 20.000/day, target 80.000.
    expect(screen.getByTestId("insight-recovery-days")).toHaveTextContent("5 hari");
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp20.000/hari");
    expect(screen.getByTestId("insight-recovery-target")).toHaveTextContent("Rp80.000/hari");
  });

  it("recomputes while dragging the horizon slider", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue(overSeries());

    const user = await renderUnlocked();
    await openInsightScreen(user);
    await screen.findByTestId("insight-recovery");

    fireEvent.change(screen.getByTestId("insight-recovery-slider"), { target: { value: "2" } });
    expect(screen.getByTestId("insight-recovery-days")).toHaveTextContent("2 hari");
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp50.000/hari");
    expect(screen.getByTestId("insight-recovery-target")).toHaveTextContent("Rp50.000/hari");
  });

  it("stays hidden while the running total is still within the cap", async () => {
    getActiveMock.mockResolvedValue(activeBudget({ spent: 150_000, status: "ok" }));
    seriesMock.mockResolvedValue(underSeries()); // 150.000 < 300.000 allowance

    const user = await renderUnlocked();
    await openInsightScreen(user);

    expect(screen.queryByTestId("insight-recovery")).not.toBeInTheDocument();
  });

  it("stays hidden for full budgets", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ type: "full", amount: 3_000_000, spent: 900_000, status: "ok" }),
    );
    seriesMock.mockResolvedValue(underSeries());

    const user = await renderUnlocked();
    await openInsightScreen(user);

    expect(screen.queryByTestId("insight-recovery")).not.toBeInTheDocument();
  });

  it("stays hidden until the day series has loaded", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockRejectedValue(new Error("offline"));

    const user = await renderUnlocked();
    await openInsightScreen(user);

    expect(screen.queryByTestId("insight-recovery")).not.toBeInTheDocument();
  });
});
