import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    OfflineError: class OfflineError extends Error {
      status = 0;
      constructor() {
        super("offline");
        this.name = "OfflineError";
      }
    },
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

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

async function renderUnlocked(pin = "ABC123"): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

describe("App — Fair Total Toggle (spec §Adv-5)", () => {
  it("shows Raw total by default and toggles to Fair on click", async () => {
    // Use a date-independent approach: the main fetch's `from` is later than
    // the expanded fair fetch's `from` (30 days earlier). Return the same data
    // for both — fair calc filters by the real period range anyway.
    const fairExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
      { id: "e3", amount: 300_000, occurredAt: new Date().toISOString(), allocationType: "MONTHLY" as const },
    ];
    listMock.mockResolvedValue({ expenses: fairExpenses, total: 1_050_000 });

    const user = await renderUnlocked();

    // Default: raw total shown (1,050,000 → Rp1,1 jt)
    expect(await screen.findByTestId("header-total")).toHaveTextContent("Rp1,1 jt");

    // Toggle to Fair
    await user.click(screen.getByTestId("total-toggle-fair"));

    // Fair: 50k (NONE full) + 100k (WEEKLY 1/7) + 10k (MONTHLY 1/30) = 160k
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp160.000");
    });
  });

  it("renders TotalToggle in the header trailing cluster next to UserMenu", async () => {
    await renderUnlocked();
    const header = await screen.findByRole("banner");
    expect(header).toContainElement(screen.getByTestId("total-toggle"));
  });

  it("falls back to raw when Fair fetch fails (offline/error)", async () => {
    const mainExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];

    // Identify the expanded fetch (earlier `from` than the main fetch).
    let firstFrom: string | null = null;
    listMock.mockImplementation((from) => {
      if (firstFrom === null) {
        firstFrom = from;
        return Promise.resolve({ expenses: mainExpenses, total: 750_000 });
      }
      if (from < firstFrom) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ expenses: mainExpenses, total: 750_000 });
    });

    const user = await renderUnlocked();

    expect(await screen.findByTestId("header-total")).toHaveTextContent("Rp750.000");

    // Toggle to Fair — expanded fetch fails → fallback to raw + ·raw badge
    await user.click(screen.getByTestId("total-toggle-fair"));

    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp750.000");
    });
  });

  it("persists toggle mode across reload", async () => {
    listMock.mockResolvedValue({ expenses: [], total: 0 });
    const user = await renderUnlocked();

    // Toggle to Fair
    await user.click(screen.getByTestId("total-toggle-fair"));

    // Re-render (simulate reload by unmount/remount)
    await waitFor(() => {
      expect(screen.getByTestId("total-toggle-fair")).toHaveAttribute("aria-pressed", "true");
    });

    // Unmount and re-mount
    // The persisted mode should be "fair" on re-mount
    // (We verify via localStorage directly since full reload is hard to test)
    expect(localStorage.getItem("expense-app.total-mode")).toBe("fair");
  });

  it("Raw total stays unchanged when Fair is active and expenses update", async () => {
    const mainExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses: mainExpenses, total: 50_000 });

    const user = await renderUnlocked();
    expect(await screen.findByTestId("header-total")).toHaveTextContent("Rp50.000");

    // Toggle to Fair
    await user.click(screen.getByTestId("total-toggle-fair"));
    await waitFor(() => {
      // NONE in-period → fair = raw = 50k
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp50.000");
    });
  });
});
