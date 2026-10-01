import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const createMock = vi.mocked(expensesApi.create);
const loginMock = vi.mocked(authApi.login);
const getActiveMock = vi.mocked(budgetsApi.getActive);
const historyMock = vi.mocked(budgetsApi.history);
const seriesMock = vi.mocked(budgetsApi.activeSeries);
const createBudgetMock = vi.mocked(budgetsApi.create);
const removeBudgetMock = vi.mocked(budgetsApi.remove);

function activeBudget(overrides = {}) {
  return {
    budget: {
      id: "budget-1",
      type: "daily" as const,
      amount: 100_000,
      startDate: "2099-09-01",
      endDate: "2099-09-30",
      spent: 35_000,
      todaySpent: 35_000,
      remaining: 65_000,
      status: "ok" as const,
      progressPct: 35,
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
  createBudgetMock.mockResolvedValue({ id: "budget-2" });
  removeBudgetMock.mockResolvedValue(undefined);
  createMock.mockResolvedValue({
    id: "created-1",
    amount: 5,
    occurredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
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

async function openUserMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId("user-menu-button"));
  await screen.findByTestId("user-menu");
}

async function openBudget(user: ReturnType<typeof userEvent.setup>) {
  await openUserMenu(user);
  await user.click(screen.getByTestId("user-menu-budget"));
  await screen.findByTestId("budget-screen");
}

describe("App — Budget Today fair toggle (independent from header)", () => {
  it("renders clickable delta with dotted underline in the BudgetToday card", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openBudget(user);

    await screen.findByTestId("budget-today");
    // Empty expenses → fair today (0) differs from raw (35k) → headline is a button
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta").tagName).toBe("BUTTON");
    });
    const delta = screen.getByTestId("budget-today-delta");
    expect(delta.className).toMatch(/fair-dotted/);
    // No separate toggle icon anymore
    expect(screen.queryByTestId("budget-today-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("total-toggle-button")).not.toBeInTheDocument();
    expect(user).toBeDefined();
  });

  it("starts in raw mode and shows raw spent in today card", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ todaySpent: 47_000, spent: 47_000, status: "ok" }),
    );
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openBudget(user);

    await screen.findByTestId("budget-today");
    // Daily type → delta = cap - spent = 100k - 47k = 53k
    expect(screen.getByTestId("budget-today-delta")).toHaveTextContent("+Rp53.000");
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta").tagName).toBe("BUTTON");
    });
    expect(screen.getByTestId("budget-today-delta")).toHaveAttribute("aria-pressed", "false");
    expect(user).toBeDefined();
  });

  it("toggles to fair independently from header mode", async () => {
    const now = new Date("2026-09-28T12:00:00+07:00");
    vi.setSystemTime(now);

    // Expenses: raw total for today, header amount clickable (WEEKLY in day)
    const dayExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses: dayExpenses, total: 750_000 });

    getActiveMock.mockResolvedValue(
      activeBudget({ todaySpent: 47_000, spent: 467_209, status: "ok" }),
    );
    seriesMock.mockResolvedValue({ days: [] });

    const user = await renderUnlocked();

    // Header amount clickable (has WEEKLY in day)
    await waitFor(() => {
      expect(screen.getByTestId("header-total").tagName).toBe("BUTTON");
    });

    // Open budget screen
    await openBudget(user);

    await screen.findByTestId("budget-today");
    // Budget headline starts raw — wait until clickable, then still raw
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta").tagName).toBe("BUTTON");
    });
    expect(screen.getByTestId("budget-today-delta")).toHaveAttribute("aria-pressed", "false");

    // Click the headline → fair
    await user.click(screen.getByTestId("budget-today-delta"));

    // The budget today mode should now be "fair": fair today = 50k + 100k = 150k
    // → delta = 100k - 150k = −Rp50.000
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta")).toHaveAttribute("aria-pressed", "true");
    });
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta")).toHaveTextContent("−Rp50.000");
    });

    // Header amount is plain text while in budget view (D toggle hidden there)
    expect(screen.getByTestId("header-total").tagName).toBe("SPAN");

    // Persistence: budget-today-mode should be "fair"
    expect(localStorage.getItem("expense-app.budget-today-mode")).toBe("fair");
    // Header mode should still be default (not touched)
    expect(localStorage.getItem("expense-app.total-mode")).toBeNull();
  });

  it("clicking header amount does not affect budget today mode", async () => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00+07:00"));

    const fairExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses: fairExpenses, total: 750_000 });

    getActiveMock.mockResolvedValue(activeBudget({ todaySpent: 35_000, spent: 35_000, status: "ok" }));
    seriesMock.mockResolvedValue({ days: [] });

    const user = await renderUnlocked();

    // Header amount clickable (has WEEKLY in day) — click to fair
    await waitFor(() => {
      expect(screen.getByTestId("header-total").tagName).toBe("BUTTON");
    });
    await user.click(screen.getByTestId("header-total"));
    expect(localStorage.getItem("expense-app.total-mode")).toBe("fair");

    // Open budget screen
    await openBudget(user);

    await screen.findByTestId("budget-today");
    // Budget today headline should be independent — still raw (default)
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta").tagName).toBe("BUTTON");
    });
    expect(screen.getByTestId("budget-today-delta")).toHaveAttribute("aria-pressed", "false");
    // Header mode changed to fair independently
    expect(localStorage.getItem("expense-app.total-mode")).toBe("fair");
    // Budget today mode not persisted yet (still default raw, no key set)
    expect(localStorage.getItem("expense-app.budget-today-mode")).toBeNull();
  });

  it("shows ·raw fallback suffix when fair fails in budget today", async () => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00+07:00"));

    // Set budget today mode to fair BEFORE render so the hook picks it up
    localStorage.setItem("expense-app.budget-today-mode", "fair");

    // First call (main fetch) succeeds, expanded fetch fails
    let callCount = 0;
    listMock.mockImplementation((from) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ expenses: [], total: 0 });
      }
      return Promise.reject(new Error("network down"));
    });

    getActiveMock.mockResolvedValue(activeBudget({ todaySpent: 35_000, spent: 35_000, status: "ok" }));
    seriesMock.mockResolvedValue({ days: [] });

    const user = await renderUnlocked();

    await openBudget(user);

    await screen.findByTestId("budget-today");
    // Fair mode active (clickable from the start) but fetch failing → fallback to raw
    expect(screen.getByTestId("budget-today-delta")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta")).toHaveTextContent("·raw");
    });
    expect(user).toBeDefined();
  });

  it("during budget-today fair loading shows shimmer, not ·raw", async () => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00+07:00"));

    localStorage.setItem("expense-app.budget-today-mode", "fair");

    // Expanded fetch (fair) hangs so we can inspect loading state.
    let firstFrom: string | null = null;
    const hangingPromise = new Promise(() => {});
    listMock.mockImplementation((from: string) => {
      if (firstFrom === null) {
        firstFrom = from;
        return Promise.resolve({ expenses: [], total: 0 });
      }
      if (from < firstFrom) {
        return hangingPromise as never;
      }
      return Promise.resolve({ expenses: [], total: 0 });
    });

    getActiveMock.mockResolvedValue(activeBudget({ todaySpent: 35_000, spent: 35_000, status: "ok" }));
    seriesMock.mockResolvedValue({ days: [] });

    const user = await renderUnlocked();
    await openBudget(user);

    await screen.findByTestId("budget-today");

    // While fair loading: the headline should be a shimmer (role=status aria-busy),
    // NOT showing ·raw.
    await waitFor(() => {
      const delta = screen.getByTestId("budget-today-delta");
      expect(delta).toHaveAttribute("role", "status");
      expect(delta).toHaveAttribute("aria-busy", "true");
      expect(delta).not.toHaveTextContent("·raw");
    });
    expect(user).toBeDefined();
  });

  it("offline → fair null → raw displayed in today card", async () => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00+07:00"));

    // Set budget today mode to fair BEFORE render so the hook picks it up
    localStorage.setItem("expense-app.budget-today-mode", "fair");

    // All list calls fail (offline)
    listMock.mockRejectedValue(new Error("network down"));

    getActiveMock.mockResolvedValue(activeBudget({ todaySpent: 35_000, spent: 35_000, status: "ok" }));
    seriesMock.mockResolvedValue({ days: [] });

    const user = await renderUnlocked();

    await openBudget(user);

    await screen.findByTestId("budget-today");
    // With fair mode active but fetch failing → fallback to raw
    expect(screen.getByTestId("budget-today-delta")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(screen.getByTestId("budget-today-delta")).toHaveTextContent("·raw");
    });
    expect(user).toBeDefined();
  });
});
