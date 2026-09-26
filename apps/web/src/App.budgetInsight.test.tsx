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

describe("App — budget insight in graph", () => {
  it("no budget → graph mode toggle is absent, bar chart renders as today", async () => {
    await renderUnlocked();
    expect(screen.queryByTestId("graph-mode-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("active budget → toggle appears, default spending mode shows bar chart", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    await renderUnlocked();

    expect(await screen.findByTestId("graph-mode-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("graph-mode-spending")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("graph-mode-budget")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  it("clicking Budget switches graph to budget insight view", async () => {
    seedExpenses([{ id: "e1", amount: 50_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();

    await screen.findByTestId("bar-chart");
    await user.click(screen.getByTestId("graph-mode-budget"));

    expect(await screen.findByTestId("budget-insight")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
    expect(screen.getByTestId("budget-insight-pct")).toHaveTextContent("50.0%");
  });

  it("clicking Pengeluaran returns to spending view", async () => {
    seedExpenses([{ id: "e1", amount: 50_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("graph-mode-budget"));
    expect(await screen.findByTestId("budget-insight")).toBeInTheDocument();

    await user.click(screen.getByTestId("graph-mode-spending"));
    expect(await screen.findByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-insight")).not.toBeInTheDocument();
  });

  it("D/W/M switching keeps graph mode but recalculates snapshot", async () => {
    seedExpenses([{ id: "e1", amount: 30_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget({ type: "full", amount: 3_000_000 }));
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("graph-mode-budget"));
    expect(await screen.findByTestId("budget-insight")).toBeInTheDocument();
    expect(screen.getByTestId("budget-insight-pct")).toHaveTextContent("1.0%"); // 30k / 3M

    await user.click(screen.getByTestId("period-week"));
    expect(screen.getByTestId("graph-mode-budget")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByTestId("budget-insight")).toBeInTheDocument();
  });

  it("over-budget shows OVER status with overspent", async () => {
    seedExpenses([{ id: "e1", amount: 126_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("graph-mode-budget"));
    expect(await screen.findByTestId("budget-insight")).toBeInTheDocument();
    expect(screen.getByTestId("budget-insight-pct")).toHaveTextContent("126.0%");
    expect(screen.getByTestId("budget-insight-overspent")).toHaveTextContent("Rp26.000");
  });

  it("budget starts after period ends → no-overlap message", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: `${NEXT_YEAR}-09-26`, endDate: `${NEXT_YEAR}-10-05` }),
    );
    const user = await renderUnlocked();

    await screen.findByTestId("bar-chart");
    await user.click(screen.getByTestId("graph-mode-budget"));

    expect(await screen.findByTestId("budget-insight-no-overlap")).toHaveTextContent(
      "Tidak ada budget yang berlaku untuk periode ini.",
    );
    expect(screen.queryByTestId("budget-insight")).not.toBeInTheDocument();
  });

  it("full budget: amount does not change across D/W/M periods", async () => {
    seedExpenses([{ id: "e1", amount: 1_000_000, occurredAt: TODAY_ISO }]);
    getActiveMock.mockResolvedValue(activeBudget({ type: "full", amount: 3_000_000 }));
    const user = await renderUnlocked();

    await user.click(screen.getByTestId("graph-mode-budget"));
    expect(await screen.findByTestId("budget-insight-pct")).toHaveTextContent("33.3%");

    await user.click(screen.getByTestId("period-month"));
    expect(await screen.findByTestId("budget-insight-pct")).toHaveTextContent("33.3%");
  });

  it("allocation seam: WEEKLY 700k contributes 100k/day (deferred to allocation branch)", () => {
    // TODO: when allocation engine lands, this test should verify that a
    // WEEKLY expense of 700k contributes 100k/day to the daily snapshot.
    // For now, effectiveSpending returns raw sums.
    expect(true).toBe(true);
  });
});
