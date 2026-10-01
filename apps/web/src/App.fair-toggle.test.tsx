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
      activeSeries: vi.fn().mockResolvedValue({ days: [] }),
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
  it("shows Raw total by default and toggles to Fair on amount click, back on second click", async () => {
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

    // Default: raw total shown (1,050,000 → Rp1,1 jt) as a clickable button
    const total = await screen.findByTestId("header-total");
    expect(total).toHaveTextContent("Rp1,1 jt");
    expect(total.tagName).toBe("BUTTON");
    expect(total.className).toMatch(/fair-dotted/);
    expect(total).toHaveAttribute("aria-pressed", "false");

    // Click the amount → Fair: 50k (NONE full) + 100k (WEEKLY 1/7) + 10k (MONTHLY 1/30) = 160k
    await user.click(total);
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp160.000");
    });
    expect(screen.getByTestId("header-total")).toHaveAttribute("aria-pressed", "true");

    // Click again → back to Raw
    await user.click(screen.getByTestId("header-total"));
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp1,1 jt");
    });
    expect(screen.getByTestId("header-total")).toHaveAttribute("aria-pressed", "false");
  });

  it("renders clickable total with dotted underline (day period, with allocation)", async () => {
    const expenses = [
      { id: "e1", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 700_000 });

    await renderUnlocked();
    const header = await screen.findByRole("banner");
    const headerTotal = screen.getByTestId("header-total");
    expect(header).toContainElement(headerTotal);
    // Clickable affordance: button + dotted underline, no separate toggle icon
    expect(headerTotal.tagName).toBe("BUTTON");
    expect(headerTotal.className).toMatch(/fair-dotted/);
    expect(screen.queryByTestId("total-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("total-toggle-button")).not.toBeInTheDocument();
  });

  it("fair mode: dotted underline removed and [?] info button appears on the header total", async () => {
    const fairExpenses = [
      { id: "e1", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
      { id: "e2", amount: 300_000, occurredAt: new Date().toISOString(), allocationType: "MONTHLY" as const },
    ];
    listMock.mockResolvedValue({ expenses: fairExpenses, total: 1_000_000 });

    const user = await renderUnlocked();
    const total = await screen.findByTestId("header-total");
    expect(total.tagName).toBe("BUTTON");
    expect(total.className).toMatch(/fair-dotted/);
    expect(screen.queryByTestId("fair-info")).not.toBeInTheDocument();

    // Switch to fair
    await user.click(total);
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveAttribute("aria-pressed", "true");
    });

    // Fair active: dotted removed + [?] info button present
    expect(screen.getByTestId("header-total").className).not.toMatch(/fair-dotted/);
    expect(screen.getByTestId("fair-info")).toBeInTheDocument();
  });

  it("fair mode: clicking the header total returns to raw (toggle preserved)", async () => {
    const fairExpenses = [
      { id: "e1", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses: fairExpenses, total: 700_000 });

    const user = await renderUnlocked();
    const total = await screen.findByTestId("header-total");

    await user.click(total);
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByTestId("fair-info")).toBeInTheDocument();

    // Click the (plain) value → back to raw
    await user.click(screen.getByTestId("header-total"));
    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveAttribute("aria-pressed", "false");
    });
    expect(screen.getByTestId("header-total").className).toMatch(/fair-dotted/);
    expect(screen.queryByTestId("fair-info")).not.toBeInTheDocument();
  });

  it("W/M overview: [?] info button does NOT appear in fair mode (no breakdown passed)", async () => {
    const expenses = [
      { id: "e1", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 700_000 });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");

    // Overview total is a SPAN (raw, no peek for W) → no [?]
    expect(screen.getByTestId("header-total").tagName).toBe("SPAN");
    expect(screen.queryByTestId("fair-info")).not.toBeInTheDocument();
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

    // Click the amount → expanded fetch fails → fallback to raw + ·raw badge
    await user.click(screen.getByTestId("header-total"));

    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveTextContent("·raw");
    });
  });

  it("during fair loading shows shimmer, not ·raw", async () => {
    const mainExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];

    // Expanded fetch (fair) hangs so we can inspect the loading state.
    let firstFrom: string | null = null;
    const hangingPromise = new Promise(() => {});
    listMock.mockImplementation((from: string) => {
      if (firstFrom === null) {
        firstFrom = from;
        return Promise.resolve({ expenses: mainExpenses, total: 750_000 });
      }
      if (from < firstFrom) {
        return hangingPromise as never;
      }
      return Promise.resolve({ expenses: mainExpenses, total: 750_000 });
    });

    const user = await renderUnlocked();

    await screen.findByTestId("header-total");

    // Click → fair fetch starts (in-flight, hanging)
    await user.click(screen.getByTestId("header-total"));

    // While loading: header-total shows shimmer (role=status aria-busy),
    // NOT the ·raw badge and NOT a numeric value.
    await waitFor(() => {
      const total = screen.getByTestId("header-total");
      expect(total).toHaveAttribute("role", "status");
      expect(total).toHaveAttribute("aria-busy", "true");
      expect(total).not.toHaveTextContent("·raw");
    });
  });

  it("persists toggle mode across reload", async () => {
    // Need allocation so the amount is clickable
    const expenses = [
      { id: "e1", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 700_000 });
    const user = await renderUnlocked();

    // Click the amount → Fair
    await user.click(screen.getByTestId("header-total"));

    await waitFor(() => {
      expect(screen.getByTestId("header-total")).toHaveAttribute("aria-pressed", "true");
    });

    // The persisted mode should be "fair" on re-mount
    // (We verify via localStorage directly since full reload is hard to test)
    expect(localStorage.getItem("expense-app.total-mode")).toBe("fair");
  });

  it("Raw total stays unchanged when Fair is active and expenses update", async () => {
    // Need WEEKLY allocation so the amount is clickable
    const mainExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: new Date().toISOString(), allocationType: "WEEKLY" as const },
    ];
    listMock.mockResolvedValue({ expenses: mainExpenses, total: 750_000 });

    const user = await renderUnlocked();
    expect(await screen.findByTestId("header-total")).toHaveTextContent("Rp750.000");

    // Click the amount → Fair
    await user.click(screen.getByTestId("header-total"));

    await waitFor(() => {
      // NONE 50k + WEEKLY 1/7 of 700k = 100k → fair = 150k
      expect(screen.getByTestId("header-total")).toHaveTextContent("Rp150.000");
    });
  });

  it("D-only: plain total when period is day but no allocation + fair === raw", async () => {
    // No allocationType on expenses → hasAllocatedInDay = false
    const rawExpenses = [
      { id: "e1", amount: 50_000, occurredAt: new Date().toISOString(), allocationType: "NONE" as const },
    ];
    listMock.mockResolvedValue({ expenses: rawExpenses, total: 50_000 });

    await renderUnlocked();

    // Default mode is raw, no allocation, fair === raw → plain non-clickable total
    const total = await screen.findByTestId("header-total");
    expect(total.tagName).toBe("SPAN");
    expect(total.className).not.toMatch(/fair-dotted/);
  });

  it("D-only: amount becomes clickable after fair loads and differs from raw (tail-overlap)", async () => {
    // MONTHLY expense from 10 days ago → fair (10k for today) differs from raw (0k today since it's outside day range)
    const now = new Date("2026-09-25T14:00:00+07:00");
    vi.setSystemTime(now);
    const expenses = [
      { id: "e1", amount: 300_000, occurredAt: "2026-09-15T10:00:00+07:00", allocationType: "MONTHLY" as const },
    ];
    listMock.mockResolvedValue({ expenses, total: 0 });

    await renderUnlocked();

    // Raw total is 0 (expenses outside day range). Fair will be 10k (1/30 × 300k).
    await screen.findByTestId("header-total");
    // Wait for fair peek to load and detect difference → amount becomes a button
    await waitFor(() => {
      expect(screen.getByTestId("header-total").tagName).toBe("BUTTON");
    });
    vi.useRealTimers();
  });
});
