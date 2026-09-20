import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./app/App";
import { authApi, expensesApi } from "./lib/api";
import { setTheme } from "./lib/theme";

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
  setTheme("dark"); // reset module-level theme state between tests
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

describe("App — theme toggle", () => {
  it("switches to light mode from the user menu and persists the choice", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("user-menu-button"));
    await user.click(screen.getByTestId("user-menu-theme"));

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("expense-app.theme")).toBe("light");
  });

  it("shows the active mode as the label", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("user-menu-button"));
    // Default is dark → label names the active mode.
    expect(screen.getByTestId("user-menu-theme")).toHaveTextContent("Mode Gelap");

    await user.click(screen.getByTestId("user-menu-theme"));
    // Theme button closes the menu (setOpen(false)); reopen to read the label.
    await user.click(screen.getByTestId("user-menu-button"));
    expect(screen.getByTestId("user-menu-theme")).toHaveTextContent("Mode Terang");
  });

  it("restores light mode after a remount (persisted)", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("user-menu-button"));
    await user.click(screen.getByTestId("user-menu-theme"));
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
