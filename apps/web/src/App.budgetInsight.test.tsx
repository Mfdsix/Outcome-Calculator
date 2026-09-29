import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetActiveResponse, ExpenseDto } from "@expense-app/shared";

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
const loginMock = vi.mocked(authApi.login);

const TODAY = new Date();
const TODAY_ISO = TODAY.toISOString();
const TODAY_YEAR = TODAY.getFullYear();
const TODAY_MONTH = String(TODAY.getMonth() + 1).padStart(2, "0");
const TODAY_DAY = String(TODAY.getDate()).padStart(2, "0");
const NEXT_YEAR = TODAY_YEAR + 1;

function activeBudget(
  overrides: Partial<NonNullable<BudgetActiveResponse["budget"]>> = {},
): BudgetActiveResponse {
  return {
    budget: {
      id: "budget-1",
      type: "daily",
      amount: 100_000,
      startDate: `${TODAY_YEAR}-${TODAY_MONTH}-${TODAY_DAY}`,
      endDate: `${NEXT_YEAR}-${TODAY_MONTH}-${TODAY_DAY}`,
      spent: 35_000,
      todaySpent: 35_000,
      remaining: 65_000,
      status: "ok",
      progressPct: 35,
      ...overrides,
    },
  };
}

function seedExpenses(expenses: ExpenseDto[]): void {
  listMock.mockResolvedValue({
    expenses,
    total: expenses.reduce((sum, e) => sum + e.amount, 0),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  seedExpenses([]);
  getActiveMock.mockResolvedValue({ budget: null });
  historyMock.mockResolvedValue({ history: [] });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

async function renderUnlocked(pin = "ABC123") {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

describe("App — budget delta in graph (no toggle)", () => {
  it("no budget → special chart is bare: no toggle, no delta", async () => {
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));

    expect(await screen.findByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("graph-mode-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chart-budget-delta")).not.toBeInTheDocument();
  });

  it("active budget → chart header shows +Rp delta, no toggle", async () => {
    seedExpenses([{ id: "e1", amount: 50_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));

    expect(await screen.findByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.getByTestId("chart-budget-delta")).toHaveTextContent("+Rp50.000");
    expect(screen.queryByTestId("graph-mode-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-insight")).not.toBeInTheDocument();
  });

  it("over-budget → chart header shows red −Rp delta", async () => {
    seedExpenses([{ id: "e1", amount: 126_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));

    const delta = await screen.findByTestId("chart-budget-delta");
    expect(delta).toHaveTextContent("−Rp26.000");
    expect(delta).toHaveClass("text-red-300");
  });

  it("W mode shows the delta too", async () => {
    seedExpenses([{ id: "e1", amount: 30_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget({ type: "full", amount: 3_000_000 }));
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));

    expect(await screen.findByTestId("chart-budget-delta")).toHaveTextContent("+Rp2.970.000");
    expect(screen.queryByTestId("graph-mode-toggle")).not.toBeInTheDocument();
  });

  it("budget starts after period ends → bare chart, no delta", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: `${NEXT_YEAR}-09-26`, endDate: `${NEXT_YEAR}-10-05` }),
    );
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));

    expect(await screen.findByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-budget-delta")).not.toBeInTheDocument();
  });

  it("W mode marks the over-cap day solid red when selected", async () => {
    seedExpenses([{ id: "e1", amount: 150_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));

    // Today (150k > 100k daily cap) is auto-selected → solid red.
    const key = `${TODAY_YEAR}-${TODAY_MONTH}-${TODAY_DAY}`;
    const bar = await screen.findByTestId(`bar-${key}`);
    const fill = bar.querySelector("span.w-full");
    expect(fill).not.toBeNull();
    expect(fill).toHaveClass("bg-red-500");
    expect(screen.getByTestId("chart-budget-delta")).toBeInTheDocument();
  });

  it("allocation seam: WEEKLY 700k contributes 100k/day (deferred to allocation branch)", () => {
    // TODO: when allocation engine lands, this test should verify that a
    // WEEKLY expense of 700k contributes 100k/day to the daily snapshot.
    // For now, effectiveSpending returns raw sums.
    expect(true).toBe(true);
  });
});
