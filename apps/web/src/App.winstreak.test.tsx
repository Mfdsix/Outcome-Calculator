import { render, screen, waitFor } from "@testing-library/react";
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

const TODAY = new Date();
const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = isoDay(TODAY);
const yesterday = isoDay(new Date(TODAY.getTime() - 86_400_000));
const twoDaysAgo = isoDay(new Date(TODAY.getTime() - 2 * 86_400_000));
const end = isoDay(new Date(TODAY.getTime() + 30 * 86_400_000));

function activeBudget(
  overrides: Partial<NonNullable<BudgetActiveResponse["budget"]>> = {},
): BudgetActiveResponse {
  return {
    budget: {
      id: "budget-1",
      type: "daily",
      amount: 50_000,
      startDate: twoDaysAgo,
      endDate: end,
      spent: 90_000,
      todaySpent: 10_000,
      remaining: 40_000,
      status: "ok",
      progressPct: 60,
      ...overrides,
    },
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

afterEach(() => {
  vi.useRealTimers();
});

async function renderUnlocked(pin = "ABC123") {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  await waitFor(() => expect(getActiveMock).toHaveBeenCalled());
  return user;
}

describe("App — win streak chip on home screen (plan §5)", () => {
  it("shows win streak chip with 🔥 x3 when daily budget has 3-day win streak ending today", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: twoDaysAgo, endDate: end, todaySpent: 10_000 }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: twoDaysAgo, total: 20_000 },
        { date: yesterday, total: 30_000 },
        { date: today, total: 40_000 },
      ],
    });

    await renderUnlocked();

    const chip = await screen.findByTestId("winstreak-chip");
    expect(chip).toHaveTextContent("🔥");
    await waitFor(() => {
      expect(screen.getByTestId("winstreak-count")).toHaveTextContent("3");
    });
  });

  it("hides chip when no active budget", async () => {
    await renderUnlocked();
    await screen.findByTestId("insight-ticker");
    expect(screen.queryByTestId("winstreak-chip")).not.toBeInTheDocument();
  });

  it("no chip for full budget on home screen", async () => {
    getActiveMock.mockResolvedValue(activeBudget({ type: "full", amount: 1_000_000 }));
    seriesMock.mockResolvedValue({ days: [] });

    await renderUnlocked();
    await screen.findByTestId("insight-ticker");
    expect(screen.queryByTestId("winstreak-chip")).not.toBeInTheDocument();
  });

  it("opens win streak dialog from home chip and shows rekor + saving", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: twoDaysAgo, endDate: end, todaySpent: 10_000 }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: twoDaysAgo, total: 20_000 },
        { date: yesterday, total: 30_000 },
        { date: today, total: 40_000 },
      ],
    });

    const user = await renderUnlocked();
    await waitFor(() => {
      expect(screen.getByTestId("winstreak-count")).toHaveTextContent("3");
    });

    await user.click(screen.getByTestId("winstreak-chip"));

    const dialog = await screen.findByTestId("winstreak-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Winstreak")).toBeInTheDocument();

    expect(screen.getByTestId("winstreak-live-badge")).toBeInTheDocument();
    expect(screen.getAllByText("Rekor terlama")[0]).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByTestId("winstreak-dialog")).not.toBeInTheDocument();
    });
  });

  it("today over → current null, longest shows in chip count", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: twoDaysAgo, endDate: end, todaySpent: 60_000, status: "over" }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: twoDaysAgo, total: 20_000 },
        { date: yesterday, total: 30_000 },
        { date: today, total: 60_000 },
      ],
    });

    await renderUnlocked();

    const chip = await screen.findByTestId("winstreak-chip");
    expect(chip).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("winstreak-count")).toHaveTextContent("2");
    });
  });
});
