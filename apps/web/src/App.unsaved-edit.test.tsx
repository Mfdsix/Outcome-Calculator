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
const updateMock = vi.mocked(expensesApi.update);
const loginMock = vi.mocked(authApi.login);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
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

describe("App — UnsavedDialog Back flow (Bug 1)", () => {
  it("edit → change digit → Back → dialog appears → Kembali discards & returns to history", async () => {
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    const user = await renderUnlocked();

    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    // Change the amount digit
    await user.click(screen.getByTestId("key-7"));

    // Click Back → unsaved dialog appears
    await user.click(screen.getByTestId("edit-back"));
    expect(await screen.findByTestId("unsaved-dialog")).toBeInTheDocument();

    // Click "Kembali" (discard) → dialog closes, back to history
    await user.click(screen.getByTestId("unsaved-cancel"));

    expect(screen.queryByTestId("unsaved-dialog")).not.toBeInTheDocument();
    // Should be back in history view (summary-list visible, amount-display gone)
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
    expect(screen.queryByTestId("amount-display")).not.toBeInTheDocument();
  });

  it("Escape on unsaved dialog dismisses (stays in edit) — no history restore", async () => {
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 50000, occurredAt: new Date().toISOString() }],
      total: 50000,
    });

    const user = await renderUnlocked();

    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-e1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("amount-display");

    // Change the amount digit
    await user.click(screen.getByTestId("key-7"));

    // Click Back → unsaved dialog appears
    await user.click(screen.getByTestId("edit-back"));
    expect(await screen.findByTestId("unsaved-dialog")).toBeInTheDocument();

    // Escape → dismiss only, stay in edit
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("unsaved-dialog")).not.toBeInTheDocument();
    // Still in edit mode
    expect(screen.getByTestId("amount-display")).toBeInTheDocument();
    expect(screen.getByTestId("edit-actions")).toBeInTheDocument();
  });
});
