import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetActiveResponse } from "@expense-app/shared";

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
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    setAuthToken: vi.fn(),
  };
});

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const getActiveMock = vi.mocked(budgetsApi.getActive);
const historyMock = vi.mocked(budgetsApi.history);
const loginMock = vi.mocked(authApi.login);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  getActiveMock.mockResolvedValue({ budget: null });
  historyMock.mockResolvedValue({ history: [] });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

// Safety net: if a fake-timer leak ever happens in a test, restore here.
afterEach(() => {
  vi.useRealTimers();
});

async function renderUnlocked(pin = "ABC123") {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

function activeBudget(
  overrides: Partial<NonNullable<BudgetActiveResponse["budget"]>> = {},
): BudgetActiveResponse {
  return {
    budget: {
      id: "budget-1",
      type: "daily",
      amount: 100_000,
      startDate: "2026-09-01",
      endDate: "2099-09-30",
      spent: 75_000,
      todaySpent: 75_000,
      remaining: 25_000,
      status: "ok",
      progressPct: 75,
      ...overrides,
    },
  };
}

/** Seed a Rp75.000 expense today so todayTotal drives the daily insight. */
function seedTodayExpense() {
  listMock.mockResolvedValue({
    expenses: [{ id: "e1", amount: 75_000, occurredAt: new Date().toISOString() }],
    total: 75_000,
  });
}

describe("App — insight ticker (calculator mode)", () => {
  it("shows the daily sisa insight from today's live total", async () => {
    seedTodayExpense();
    getActiveMock.mockResolvedValue(activeBudget());
    await renderUnlocked();

    const ticker = await screen.findByTestId("insight-ticker");
    expect(ticker).toHaveTextContent("Sisa Rp25rb hari ini, santai.");
    expect(ticker).toHaveAttribute("role", "status");
  });

  it("shows the no-budget insight without an active budget", async () => {
    await renderUnlocked();
    expect(await screen.findByTestId("insight-ticker")).toHaveTextContent(
      "Pasang budget biar ada yang ngingetin.",
    );
  });

  it("replaces the old budget-micro row", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    await renderUnlocked();

    await screen.findByTestId("insight-ticker");
    expect(screen.queryByTestId("budget-micro")).not.toBeInTheDocument();
  });

  it("ticker hides in special mode (no fight over the row)", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    await renderUnlocked();
    await screen.findByTestId("insight-ticker");

    await userEvent.setup().click(screen.getByTestId("period-week"));
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
    expect(screen.queryByTestId("insight-ticker")).not.toBeInTheDocument();
  });
});

describe("App — insight screen (tap & ⓘ)", () => {
  it("tapping the ticker opens the full insight list", async () => {
    seedTodayExpense();
    getActiveMock.mockResolvedValue(activeBudget());
    await renderUnlocked();

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("insight-ticker"));
    expect(await screen.findByTestId("insight-screen")).toBeInTheDocument();
    expect(screen.getByTestId("insight-item-daily-ok")).toHaveTextContent(
      "Hari ini masih ada Rp25.000 dari jatah Rp100.000 — santai.",
    );
  });

  it("the header ⓘ button opens the insight list and Escape returns", async () => {
    await renderUnlocked();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("insight-open"));
    expect(await screen.findByTestId("insight-screen")).toBeInTheDocument();
    expect(screen.getByTestId("insight-item-no-budget")).toBeInTheDocument();
    expect(screen.getByTestId("insight-cta-budget")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
    expect(screen.queryByTestId("insight-screen")).not.toBeInTheDocument();
  });

  it("insight-back returns to the calculator", async () => {
    await renderUnlocked();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("insight-open"));
    await screen.findByTestId("insight-screen");
    await user.click(screen.getByTestId("insight-back"));

    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
  });

  it("digits stay inert on the insight screen (same contract as budget)", async () => {
    await renderUnlocked();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("insight-open"));
    await screen.findByTestId("insight-screen");
    expect(screen.queryByTestId("keypad")).not.toBeInTheDocument();

    // Keyboard digits do nothing — no create, input stays untouched.
    await user.keyboard("5");
    expect(createMock).not.toHaveBeenCalled();
    expect(await screen.findByTestId("insight-screen")).toBeInTheDocument();
  });

  it("CTA 'Atur budget' jumps to the budget screen", async () => {
    await renderUnlocked();
    const user = userEvent.setup();

    await user.click(screen.getByTestId("insight-open"));
    await screen.findByTestId("insight-screen");
    await user.click(screen.getByTestId("insight-cta-budget"));

    expect(await screen.findByTestId("budget-screen")).toBeInTheDocument();
  });

  it("finished budget → finished info instead of pace (edge case plan §5)", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: "2020-08-01", endDate: "2020-08-31" }),
    );
    await renderUnlocked();

    expect(await screen.findByTestId("insight-ticker")).toHaveTextContent(
      "Budget selesai, bikin yang baru?",
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("insight-ticker"));
    expect(await screen.findByTestId("insight-item-finished")).toBeInTheDocument();
    // No CTA — the budget exists; manage it on the budget screen.
    expect(screen.queryByTestId("insight-cta-budget")).not.toBeInTheDocument();
  });
});
