import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getZonedParts, last7DaysRange } from "@expense-app/shared";

import App from "./app/App";
import { authApi, expensesApi } from "./lib/api";

/**
 * Phase B (desktop validation) — unit-test counterpart of the manual
 * `npm run tauri:dev` checklist, mirroring the PWA suite (App.test.tsx):
 * the native shell must run the exact same online-first flows, because the
 * codebase no longer branches on IS_TAURI at runtime.
 */

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
      getActive: vi.fn(),
      history: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
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
    loadToken: vi.fn((): string | null => null),
    setAuthToken: vi.fn(),
    isOnline: vi.fn(() => true),
  };
});

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const loginMock = vi.mocked(authApi.login);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  createMock.mockImplementation((payload) =>
    Promise.resolve({
      id: `created-${payload.amount}`,
      amount: payload.amount,
      occurredAt: payload.occurredAt ?? new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
  loginMock.mockResolvedValue({
    status: "ok",
    token: "tauri-token",
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

describe("Phase B — desktop online-first parity", () => {
  it("login PIN goes to the server auth flow (no local PIN gate)", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("lock-screen");

    await user.type(screen.getByTestId("lock-code-input"), "ABC123");
    await vi.waitFor(() => expect(loginMock).toHaveBeenCalledWith("ABC123", false));

    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
  });

  it("unknown PIN still asks for confirmation before creating a space", async () => {
    loginMock.mockImplementation(async (pin: string, confirm?: boolean) => {
      if (!confirm) return { status: "new_pin" };
      return { status: "ok", token: "new-token", expiresInMs: 1 };
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("lock-screen");
    await user.type(screen.getByTestId("lock-code-input"), "NEW123");

    expect(await screen.findByTestId("new-pin-dialog")).toBeInTheDocument();
    await user.click(screen.getByTestId("new-pin-confirm"));
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledWith("NEW123", true);
  });

  it("CRUD online: Enter creates the expense via the API", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-3"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-enter"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0]!.amount).toBe(30);
    expect(screen.getByTestId("amount-display")).toHaveTextContent(/^0$/);
  });

  it("connection indicator is present (offline/pending state is visible)", async () => {
    await renderUnlocked();
    expect(await screen.findByTestId("conn-indicator")).toBeInTheDocument();
  });

  it("full user menu: budget, insight, delete account, logout", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("user-menu-button"));
    expect(screen.getByTestId("user-menu-budget")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-insight")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-delete-account")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-logout")).toBeInTheDocument();
  });

  it("logout from the menu clears the session and re-locks", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("user-menu-button"));
    await user.click(screen.getByTestId("user-menu-logout"));

    expect(await screen.findByTestId("lock-screen")).toBeInTheDocument();
  });

  it("data comes from the server: day history lists server rows", async () => {
    const tgl = getZonedParts(new Date(), "Asia/Jakarta");
    const iso = `${tgl.year}-${String(tgl.month).padStart(2, "0")}-${String(tgl.day).padStart(2, "0")}T09:30:00+07:00`;
    listMock.mockResolvedValue({
      expenses: [{ id: "srv-1", amount: 12000, occurredAt: iso }],
      total: 12000,
    });

    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day"));
    const row = await screen.findByTestId("summary-row-srv-1");
    expect(row).toHaveTextContent("09:30");
    expect(row).toHaveTextContent("12.000");
  });

  it("week history keeps the rolling 7-day window (server semantics)", async () => {
    listMock.mockResolvedValue({ expenses: [], total: 0 });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-empty");

    const expected = last7DaysRange(new Date(), "Asia/Jakarta");
    const from = getZonedParts(expected.from, "Asia/Jakarta");
    const fromKey = `${from.year}-${String(from.month).padStart(2, "0")}-${String(from.day).padStart(2, "0")}`;
    expect(screen.getByTestId(`bar-${fromKey}`)).toBeInTheDocument();
  });

  it("no update banner / service worker UI in the native shell", async () => {
    await renderUnlocked();
    await screen.findByTestId("keypad");
    expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
  });
});
