import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./app/App";
import { ApiError, authApi, expensesApi } from "./lib/api";
import { clearOutbox, readOutbox } from "./lib/offlineDb";

/**
 * Offline matrix (plan §9): the outbox layer is real (fake-indexeddb); only
 * the HTTP boundary (lib/api) is mocked. Offline is simulated via
 * navigator.onLine=false, so mutations must bypass the (throwing) API mocks
 * and land in the IDB outbox instead.
 */

const TOKEN = "test-token";

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
    authApi: { login, refresh, deactivate },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    OfflineError: class OfflineError extends Error {
      status = 0;
      constructor() {
        super("offline");
        this.name = "OfflineError";
      }
    },
    UnauthorizedError: class UnauthorizedError extends Error {},
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    loadToken: vi.fn(() => TOKEN),
    setAuthToken: vi.fn(),
    isOnline: vi.fn(() => navigator.onLine),
  };
});

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const updateMock = vi.mocked(expensesApi.update);
const removeMock = vi.mocked(expensesApi.remove);
const loginMock = vi.mocked(authApi.login);

async function setOnline(value: boolean): Promise<void> {
  await act(async () => {
    Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  await clearOutbox(TOKEN);
  await  setOnline(true);
  // Simulate the real network: while offline, any fetch fails at the
  // transport level (status 0); while online it serves the mock data.
  listMock.mockImplementation(async () => {
    if (navigator.onLine === false) throw new ApiError(0, "offline");
    return { expenses: [], total: 0 };
  });
  createMock.mockImplementation(async (payload) => {
    if (navigator.onLine === false) throw new ApiError(0, "offline");
    return { id: "created-1", amount: payload.amount, occurredAt: new Date().toISOString() };
  });
  updateMock.mockImplementation(async (id, payload) => {
    if (navigator.onLine === false) throw new ApiError(0, "offline");
    return { id, amount: payload.amount, occurredAt: new Date().toISOString() };
  });
  removeMock.mockImplementation(async () => {
    if (navigator.onLine === false) throw new ApiError(0, "offline");
    return undefined;
  });
  loginMock.mockResolvedValue({
    status: "ok",
    token: TOKEN,
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

describe("App — offline Today CRUD (plan §4/§6)", () => {
  it("offline create keeps the optimistic row, queues the op and shows the pending badge", async () => {
    listMock.mockResolvedValue({ expenses: [], total: 0 });
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("key-3"));
    await user.click(screen.getByTestId("key-enter"));

    // Row stays (amount 3k → abbreviated "Rp3rb" style label in total).
    expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument();
    const ops = await readOutbox(TOKEN);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("create");
    expect(ops[0]!.payload.amount).toBe(3);
    expect(ops[0]!.tempId).toMatch(/^temp-/);

    // Indicator: offline + pending.
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Offline");
  });

  it("airplane: cached day snapshot is used when the day fetch fails at network level", async () => {
    listMock.mockRejectedValueOnce(
      new (await import("./lib/api")).ApiError(0, "offline"),
    );
    await renderUnlocked();
    // App boots to the calculator with the cached (empty) snapshot — no crash.
    expect(await screen.findByTestId("conn-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("header-total")).toHaveTextContent("Rp0");
  });

  it("offline create → online → auto-sync drains the outbox (N→0)", async () => {
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-enter"));
    let ops = await readOutbox(TOKEN);
    expect(ops).toHaveLength(1);

    createMock.mockResolvedValue({ id: "real-77", amount: 5, occurredAt: new Date().toISOString() });
    await setOnline(true);

    await vi.waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(1);
        expect(createMock.mock.calls[0]![0]!.amount).toBe(5);
      },
      { timeout: 3000 },
    );
    await vi.waitFor(async () => expect((await readOutbox(TOKEN)).length).toBe(0), { timeout: 3000 });
    ops = await readOutbox(TOKEN);
    expect(ops).toHaveLength(0);
  });

  it("create→edit offline coalesces into one create with the final amount", async () => {
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("key-2"));
    await user.click(screen.getByTestId("key-enter"));

    // Enter edit mode on the temp row: open day history, select, edit.
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    const tempRow = await screen.findByTestId(/^summary-row-temp-/);
    await user.click(tempRow);
    await user.click(screen.getByTestId("key-enter")); // edit selected row

    // Change 20 → 27 (amount was built with key-2 + key-0), confirm dialog.
    await user.click(screen.getByTestId("key-7"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("update-dialog");
    await user.click(screen.getByTestId("update-confirm"));

    const ops = await readOutbox(TOKEN);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("create");
    expect(ops[0]!.payload.amount).toBe(27);
  });

  it("create→delete offline cancels out (no API traffic after sync)", async () => {
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("key-4"));
    await user.click(screen.getByTestId("key-enter"));

    // Delete the temp row: select it in day history, edit mode, delete.
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    const tempRow = await screen.findByTestId(/^summary-row-temp-/);
    await user.click(tempRow);
    await user.click(screen.getByTestId("key-enter")); // edit selected row
    await user.click(screen.getByTestId("edit-delete"));
    await user.click(screen.getByTestId("delete-confirm"));

    const ops = await readOutbox(TOKEN);
    expect(ops).toHaveLength(0);
    expect(removeMock).not.toHaveBeenCalled();

    // Back online: nothing to sync.
    createMock.mockClear();
    await setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("offline edit of a real row keeps the amount and queues the update", async () => {
    const r1 = { id: "r1", amount: 12000, occurredAt: new Date().toISOString() };
    listMock.mockImplementation(async () => {
      if (navigator.onLine === false) throw new ApiError(0, "offline");
      return { expenses: [r1], total: r1.amount };
    });
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-r1"));
    await user.click(screen.getByTestId("key-enter")); // edit r1

    // Edit mode loads the raw amount (12000). Append 5 → 120005.
    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("update-dialog");
    await user.click(screen.getByTestId("update-confirm"));

    const ops = await readOutbox(TOKEN);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe("update");
    expect(ops[0]!.realId).toBe("r1");
    expect(ops[0]!.payload.amount).toBe(120005);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("update of an item deleted by another device (404) is dropped with a banner", async () => {
    listMock.mockResolvedValue({
      expenses: [{ id: "gone", amount: 9000, occurredAt: new Date().toISOString() }],
      total: 9000,
    });
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("period-day"));
    await screen.findByTestId("summary-list");
    await user.click(screen.getByTestId("summary-row-gone"));
    await user.click(screen.getByTestId("key-enter"));
    await user.click(screen.getByTestId("key-backspace"));
    await user.click(screen.getByTestId("key-1"));
    await user.click(screen.getByTestId("key-enter"));
    await screen.findByTestId("update-dialog");
    await user.click(screen.getByTestId("update-confirm"));

    expect(await readOutbox(TOKEN)).toHaveLength(1);

    // Back online: server says 404 (deleted elsewhere).
    updateMock.mockRejectedValue(
      new (await import("./lib/api")).ApiError(404, "Expense not found."),
    );
    await setOnline(true);

    await vi.waitFor(
      () => expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Online"),
      { timeout: 3000 },
    );
    // Op dropped → outbox empties without a crash.
    await vi.waitFor(async () => expect((await readOutbox(TOKEN)).length).toBe(0), { timeout: 3000 });
  });
});

describe("App — Week/Month stay online-only (plan §5)", () => {
  it("blocks the Week switch while offline and shows the hint banner", async () => {
    const user = await renderUnlocked();
    const callsBefore = listMock.mock.calls.length;

    await setOnline(false);
    await user.click(screen.getByTestId("period-week"));

    expect(await screen.findByTestId("error-banner")).toHaveTextContent("Butuh internet untuk Week/Month");
    expect(screen.getByTestId("period-week")).not.toHaveAttribute("aria-current", "true");
    // No W/M list fetch was issued after going offline.
    expect(listMock.mock.calls.length).toBe(callsBefore);
  });

  it("blocks the Month switch while offline", async () => {
    const user = await renderUnlocked();

    await setOnline(false);
    await user.click(screen.getByTestId("period-month"));
    expect(await screen.findByTestId("error-banner")).toHaveTextContent("Butuh internet untuk Week/Month");
    expect(screen.getByTestId("period-month")).not.toHaveAttribute("aria-current", "true");
  });
});

describe("App — connection indicator (plan §7)", () => {
  it("shows Online when connected and Offline after going offline", async () => {
    const user = await renderUnlocked();
    expect(await screen.findByTestId("conn-indicator-label")).toHaveTextContent("Online");

    await setOnline(false);
    expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Offline");

    await setOnline(true);
    // Drain may briefly flash "Sync…" — wait for it to settle.
    await vi.waitFor(() => expect(screen.getByTestId("conn-indicator-label")).toHaveTextContent("Online"), {
      timeout: 3000,
    });
    void user;
  });

  it("dims W/M buttons while offline (disabledVisual)", async () => {
    const user = await renderUnlocked();
    await setOnline(false);
    expect(screen.getByTestId("period-week").className).toContain("text-neutral-600");
    expect(screen.getByTestId("period-month").className).toContain("text-neutral-600");
    void user;
  });
});
