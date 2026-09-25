import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../lib/offlineDb", () => ({ mutateOutbox: vi.fn(), mutateTodayCache: vi.fn(), saveTodayCache: vi.fn() }));
vi.mock("../lib/sync", () => ({ queueOfflineCreate: vi.fn(), queueOfflineDelete: vi.fn(), queueOfflineUpdate: vi.fn() }));

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const updateMock = vi.mocked(expensesApi.update);
const loginMock = vi.mocked(authApi.login);

beforeEach(() => {
  vi.clearAllMocks();
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

async function renderUnlocked(pin = "ABC123"): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

describe("App — AdvancedControls (spec §3)", () => {
  it("BarChart shows by default on home screen (no editor)", async () => {
    await renderUnlocked();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("advanced-controls")).not.toBeInTheDocument();
  });

  it("swaps BarChart → AdvancedControls when entering edit mode", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 35000, occurredAt: new Date().toISOString() }],
      total: 35000,
    });

    await renderUnlocked();

    // Enter special mode (day history)
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");

    // Select a transaction and enter edit mode
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));

    // Back out of drill → home screen with edit mode
    expect(await screen.findByTestId("amount-display")).toBeInTheDocument();

    // On home screen + editing: BarChart is replaced by AdvancedControls
    expect(screen.getByTestId("advanced-controls")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("AdvancedControls shows No Allocation by default (NONE selected)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 35000, occurredAt: new Date().toISOString() }],
      total: 35000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    expect(screen.getByTestId("advanced-controls")).toBeInTheDocument();
    // Neither pill should be highlighted by default
    expect(screen.getByTestId("allocation-weekly")).not.toHaveClass("bg-emerald-500/15");
    expect(screen.getByTestId("allocation-monthly")).not.toHaveClass("bg-emerald-500/15");
  });

  it("tapping Weekly pill highlights it and updates allocationType on save", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    // Tap Weekly
    await user.click(screen.getByTestId("allocation-weekly"));
    expect(screen.getByTestId("allocation-weekly")).toHaveClass("bg-emerald-500/15");

    // No amount change → silent dismiss
    await user.click(screen.getByTestId("key-enter"));

    expect(updateMock).toHaveBeenCalledWith("e1", { allocationType: "WEEKLY" });
  });

  it("tapping active Weekly pill again sets to NONE", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, allocationType: "WEEKLY", occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    // Weekly should be highlighted initially (loaded from expense)
    expect(screen.getByTestId("allocation-weekly")).toHaveClass("bg-emerald-500/15");

    // Tap again → NONE
    await user.click(screen.getByTestId("allocation-weekly"));
    expect(screen.getByTestId("allocation-weekly")).not.toHaveClass("bg-emerald-500/15");

    await user.click(screen.getByTestId("key-enter"));
    expect(updateMock).toHaveBeenCalledWith("e1", { allocationType: "NONE" });
  });

  it("tapping Monthly pill highlights it", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    await user.click(screen.getByTestId("allocation-monthly"));
    expect(screen.getByTestId("allocation-monthly")).toHaveClass("bg-emerald-500/15");

    await user.click(screen.getByTestId("key-enter"));
    expect(updateMock).toHaveBeenCalledWith("e1", { allocationType: "MONTHLY" });
  });

  it("amount change + allocationType change both sent on save", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    // Tap Weekly
    await user.click(screen.getByTestId("allocation-weekly"));

    // Change amount to 700000
    for (let i = 0; i < 5; i += 1) {
      await user.click(screen.getByTestId("key-backspace"));
    }
    await user.click(screen.getByTestId("key-7"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));

    // Enter → UpdateDialog
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("update-dialog");
    await user.click(screen.getByTestId("update-confirm"));

    expect(updateMock).toHaveBeenCalledWith("e1", { amount: 700000, allocationType: "WEEKLY" });
  });

  it("Back button restores history view and hides AdvancedControls", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    expect(screen.getByTestId("advanced-controls")).toBeInTheDocument();

    // Tap Back in EditActions
    await user.click(screen.getByTestId("edit-back"));

    // Back in special mode — AdvancedControls replaced by BarChart
    expect(screen.queryByTestId("advanced-controls")).not.toBeInTheDocument();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });
});
