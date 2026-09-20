import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./app/App";
import { authApi, expensesApi } from "./lib/api";

vi.mock("./lib/api", () => {
  const list = vi.fn();
  const create = vi.fn();
  const login = vi.fn();
  const refresh = vi.fn();
  const deactivate = vi.fn();
  return {
    expensesApi: { list, create, update: vi.fn(), remove: vi.fn() },
    budgetsApi: { getActive: vi.fn(), history: vi.fn(), create: vi.fn(), remove: vi.fn() },
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
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    loadToken: vi.fn((): string | null => null),
    setAuthToken: vi.fn(),
    isOnline: vi.fn(() => true),
  };
});

const listMock = vi.mocked(expensesApi.list);
const loginMock = vi.mocked(authApi.login);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  loginMock.mockResolvedValue({
    status: "ok",
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
});

async function renderUnlocked(pin = "ABC123"): Promise<void> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
}

describe("App — clicky keypad feedback", () => {
  it("physical digit key press pulses the matching on-screen key", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.keyboard("7");

    const key = await screen.findByTestId("key-7");
    expect(key).toHaveClass("key-clicky");
    expect(screen.getByTestId("amount-display")).toHaveTextContent("7");
  });

  it("backspace press pulses the backspace key", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.keyboard("7{Backspace}");

    const key = await screen.findByTestId("key-backspace");
    expect(key).toHaveClass("key-clicky");
    expect(screen.getByTestId("amount-display")).toHaveTextContent(/^0$/);
  });

  it("clicking an on-screen key also pulses it", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("key-4"));

    expect(screen.getByTestId("key-4")).toHaveClass("key-clicky");
  });

  it("disabled keys do not pulse (nav disabled edge)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "d0", amount: 1000, occurredAt: new Date().toISOString() }],
      total: 1000,
    });
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");

    // In special mode digits are inert — typing a digit must not pulse key-5.
    await user.keyboard("5");
    expect(screen.getByTestId("key-5")).not.toHaveClass("key-clicky");
  });
});
