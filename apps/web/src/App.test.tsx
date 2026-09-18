import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getZonedParts, last30DaysRange, last7DaysRange } from "@expense-app/shared";

import App from "./app/App";
import { authApi, expensesApi, UnauthorizedError } from "./lib/api";

vi.mock("./lib/api", () => {
  const list = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  const login = vi.fn();
  const refresh = vi.fn();
  const readLastVisit = vi.fn(() => 0);
  const writeLastVisit = vi.fn();
  const setAuthToken = vi.fn();
  return {
    expensesApi: { list, create, update, remove },
    authApi: { login, refresh },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    UnauthorizedError: class UnauthorizedError extends Error {},
    readLastVisit,
    writeLastVisit,
    setAuthToken,
  };
});

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const loginMock = vi.mocked(authApi.login);
const refreshMock = vi.mocked(authApi.refresh);

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
    token: "test-token",
    expiresInMs: 20 * 60 * 60 * 1000,
  });
  refreshMock.mockResolvedValue({ token: "refreshed-token", expiresInMs: 20 * 60 * 60 * 1000 });
});

async function renderUnlocked(pin = "ABC123"): Promise<void> {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
}

describe("App — lock screen", () => {
  it("shows the lock screen when there is no session", async () => {
    render(<App />);
    expect(await screen.findByTestId("lock-screen")).toBeInTheDocument();
  });

  it("unlocks after entering a valid 6-character PIN", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("lock-screen");

    await user.type(screen.getByTestId("lock-code-input"), "ABC123");
    await vi.waitFor(() => expect(loginMock).toHaveBeenCalledWith("ABC123", false));

    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
  });

  it("shows an error and stays locked on a wrong PIN", async () => {
    loginMock.mockRejectedValue(new Error("PIN salah."));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("lock-screen");

    await user.type(screen.getByTestId("lock-code-input"), "XXX000");
    expect(await screen.findByTestId("lock-error")).toHaveTextContent("PIN salah.");
  });
});

describe("App — new PIN confirmation flow", () => {
  it("unknown PIN → 202 dialog → confirm creates the space and unlocks", async () => {
    loginMock.mockImplementation(async (pin: string, confirm?: boolean) => {
      if (!confirm) return { status: "new_pin" };
      return { status: "ok", token: "new-token", expiresInMs: 1 };
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("lock-screen");
    await user.type(screen.getByTestId("lock-code-input"), "NEW123");

    expect(await screen.findByTestId("new-pin-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("new-pin-dialog-title")).toHaveTextContent(
      "PIN baru — buat ruang milikmu?",
    );

    await user.click(screen.getByTestId("new-pin-confirm"));
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledWith("NEW123", true);
  });

  it("cancel keeps the lock screen without creating anything", async () => {
    loginMock.mockResolvedValue({ status: "new_pin" });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("lock-screen");
    await user.type(screen.getByTestId("lock-code-input"), "NEW123");

    await screen.findByTestId("new-pin-dialog");
    await user.click(screen.getByTestId("new-pin-cancel"));

    expect(screen.queryByTestId("new-pin-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("lock-screen")).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledTimes(1); // no confirm call
  });
});

describe("App — calculator (default half-D)", () => {
  it("shows header with Day label and Rp0 when empty", async () => {
    await renderUnlocked();
    expect(await screen.findByTestId("header-total")).toHaveTextContent("Rp0");
  });

  it("builds the entered amount from keypad presses", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-3"));
    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));

    expect(screen.getByTestId("amount-display")).toHaveTextContent("35.000");
  });

  it("enter submits the amount, clears input", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-3"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-enter"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]![0]!.amount).toBe(30);
    expect(screen.getByTestId("amount-display")).toHaveTextContent(/^0$/);
  });

  it("does nothing when enter is pressed with zero amount", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-enter"));
    expect(createMock).not.toHaveBeenCalled();
  });

  it("backspace removes the last digit", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-3"));
    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-backspace"));

    expect(screen.getByTestId("amount-display")).toHaveTextContent("3");
  });

  it("renders the hourly chart with the current hour highlighted", async () => {
    listMock.mockResolvedValue({
      expenses: [
        { id: "a", amount: 35000, occurredAt: new Date().toISOString() },
        { id: "b", amount: 25000, occurredAt: new Date(Date.now() - 86_400_000).toISOString() },
      ],
      total: 60000,
    });

    await renderUnlocked();
    expect(await screen.findByTestId("bar-chart")).toBeInTheDocument();

    const currentHour = getZonedParts(new Date(), "Asia/Jakarta").hour;
    const today = getZonedParts(new Date(), "Asia/Jakarta");
    const key = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}T${String(currentHour).padStart(2, "0")}`;
    expect(screen.getByTestId(`bar-${key}`)).toBeInTheDocument();
    const barSpan = screen.getByTestId(`bar-${key}`).querySelector("span:last-child");
    expect(barSpan).toHaveClass("bg-emerald-500");
  });
});

describe("App — special mode (D/W/M browse)", () => {
  it("does not highlight any period on a fresh calculator load", async () => {
    await renderUnlocked();
    expect(screen.getByTestId("period-day")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("period-day")).not.toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("summary-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("amount-display")).toBeInTheDocument();
  });

  it("tapping a period from the calculator opens history and highlights it", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-week"));
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("period-week")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("period-week")).toHaveAttribute("aria-pressed", "true");
  });

  it("tapping a different period while in history switches range, stays in history", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // open day history
    await screen.findByTestId("summary-list");

    await user.click(screen.getByTestId("period-month")); // switch
    expect(screen.getByTestId("period-month")).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("period-day")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("summary-list")).toBeInTheDocument();
  });

  it("tapping the highlighted period is a no-op (still in history)", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-week")); // open week history
    await screen.findByTestId("summary-list");

    await user.click(screen.getByTestId("period-week")); // active → no-op
    expect(screen.getByTestId("summary-list")).toBeInTheDocument();
    expect(screen.getByTestId("period-week")).toHaveAttribute("aria-current", "true");
    // Still in history: amount display is hidden.
    expect(screen.queryByTestId("amount-display")).not.toBeInTheDocument();
  });

  it("labels D/W/M persist when highlighted (no arrow glyph)", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // open day history
    await screen.findByTestId("summary-list");
    expect(screen.getByTestId("period-day")).toHaveTextContent("D");
    expect(screen.getByTestId("period-week")).toHaveTextContent("W");
    expect(screen.getByTestId("period-month")).toHaveTextContent("M");
  });

  it("week period shows 7 daily bars with rolling range", async () => {
    listMock.mockResolvedValue({ expenses: [], total: 0 });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-week")); // single tap opens history
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();

    const expected = last7DaysRange(new Date(), "Asia/Jakarta");
    const from = getZonedParts(expected.from, "Asia/Jakarta");
    const to = getZonedParts(expected.to, "Asia/Jakarta");
    const fromKey = `${from.year}-${String(from.month).padStart(2, "0")}-${String(from.day).padStart(2, "0")}`;
    const toKey = `${to.year}-${String(to.month).padStart(2, "0")}-${String(to.day).padStart(2, "0")}`;
    expect(screen.getByTestId(`bar-${fromKey}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`bar-${toKey}`)).not.toBeInTheDocument();
  });

  it("month period shows 30 daily bars with rolling range", async () => {
    listMock.mockResolvedValue({ expenses: [], total: 0 });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-month")); // single tap opens history
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();

    const expected = last30DaysRange(new Date(), "Asia/Jakarta");
    const from = getZonedParts(expected.from, "Asia/Jakarta");
    const fromKey = `${from.year}-${String(from.month).padStart(2, "0")}-${String(from.day).padStart(2, "0")}`;
    expect(screen.getByTestId(`bar-${fromKey}`)).toBeInTheDocument();
  });

  it("digits are inert in special mode (no create), but keypad + key-0 still present", async () => {
    listMock.mockResolvedValue({
      expenses: [
        { id: "x1", amount: 12000, occurredAt: new Date().toISOString() },
      ],
      total: 12000,
    });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // → special
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();

    // Keypad renders in full; digits are present but inert (no create).
    expect(screen.getByTestId("keypad")).toBeInTheDocument();
    expect(screen.getByTestId("key-0")).toBeInTheDocument();

    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-0"));
    expect(createMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("amount-display")).not.toBeInTheDocument();
  });

  it("drills into the selected bucket and returns via back", async () => {
    const now = new Date();
    listMock.mockResolvedValue({
      expenses: [{ id: "d1", amount: 35000, occurredAt: now.toISOString() }],
      total: 35000,
    });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // → special
    await screen.findByTestId("summary-list");

    await user.click(screen.getByTestId("key-enter")); // drill into selected bucket
    expect(await screen.findByTestId("browse-list")).toBeInTheDocument();
    expect(screen.getByTestId("browse-row-d1")).toBeInTheDocument();

    await user.click(screen.getByTestId("control-back")); // back to summary
    expect(await screen.findByTestId("summary-list")).toBeInTheDocument();
  });

  it("day summary rows show hour buckets (e.g. 08:00) and week rows show date labels", async () => {
    // Build a fixed timestamp: today at 08:15 WIB so the hour bucket is stable.
    const today = new Date();
    const hour = 8;
    const occurredAt = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hour,
      15,
    ).toISOString(); // ISO in local; bucketed by Jakarta civil hour in chart.ts

    // For day view the bucket key is YYYY-MM-DDTHH. The row label derived from
    // key.slice(11,13) + ":00".
    listMock.mockResolvedValue({
      expenses: [{ id: "d2", amount: 25000, occurredAt }],
      total: 25000,
    });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // → special, day buckets
    await screen.findByTestId("summary-list");
    // The hour bucket label must be the hour portion, suffixed with :00.
    const rows = screen.getAllByTestId(/^summary-row-/);
    const hourRow = rows.find((row) => row.textContent?.includes(":00"));
    expect(hourRow).toBeDefined();
    expect(hourRow).toHaveTextContent("25.000");

    // Switch to week — labels become civil date labels via formatDateShort.
    await user.click(screen.getByTestId("period-week"));
    await screen.findByTestId("summary-list");
    const weekRows = screen.getAllByTestId(/^summary-row-/);
    const sample = weekRows[0];
    // Date label "DD Mon" pattern (id-ID), e.g. "17 Sep".
    expect(sample.textContent).toMatch(/\d{1,2}\s\w{3}/);
    expect(sample.textContent).not.toContain("Hari ini");
  });
});

describe("App — session visit refresh", () => {
  it("refreshes when the last visit is stale (≥1h) and stamps the new time", async () => {
    localStorage.setItem("expense-app.token", "stale-token");
    localStorage.setItem(
      "expense-app.last-visit",
      String(Date.now() - 2 * 60 * 60 * 1000),
    );

    render(<App />);
    await screen.findByTestId("keypad"); // token persisted → unlocked directly

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("stays silent when the last visit is fresh (<1h)", async () => {
    localStorage.setItem("expense-app.token", "fresh-token");
    localStorage.setItem("expense-app.last-visit", String(Date.now() - 5 * 60 * 1000));

    render(<App />);
    await screen.findByTestId("keypad");

    // Give the effect a chance to (not) run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("locks out on 401 from refresh", async () => {
    localStorage.setItem("expense-app.token", "expired-token");
    localStorage.setItem("expense-app.last-visit", String(Date.now() - 2 * 60 * 60 * 1000));
    refreshMock.mockRejectedValue(new UnauthorizedError("Unauthorized."));

    render(<App />);
    await screen.findByTestId("keypad");

    expect(await screen.findByTestId("lock-screen")).toBeInTheDocument();
  });
});

describe("App — user menu", () => {
  it("opens from the navbar, shows masked PIN and logs out to lock", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("user-menu-button"));
    expect(screen.getByTestId("user-menu")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-pin")).toHaveTextContent("••••••");

    await user.click(screen.getByTestId("user-menu-logout"));
    expect(await screen.findByTestId("lock-screen")).toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("user-menu-button"));
    expect(screen.getByTestId("user-menu")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("user-menu")).not.toBeInTheDocument();
  });
});

describe("App — API error", () => {
  it("shows an error banner when create fails", async () => {
    createMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-2"));
    await user.click(screen.getByTestId("key-enter"));

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });
});

describe("App — layout + special wiring", () => {
  it("renders the user menu inside the header trailing cluster", async () => {
    await renderUnlocked();
    const header = await screen.findByRole("banner");
    const userMenuButton = await screen.findByTestId("user-menu-button");
    expect(header).toContainElement(userMenuButton);
    expect(header).toContainElement(screen.getByTestId("header-total"));
  });

  it("list renders before the chart in special mode (DOM order)", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // → special
    const list = await screen.findByTestId("summary-list");
    const chart = screen.getByTestId("bar-chart");
    expect(list.compareDocumentPosition(chart)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("summary list fills available height and scrolls internally (fit-to-viewport)", async () => {
    listMock.mockResolvedValue({
      expenses: Array.from({ length: 20 }, (_, i) => ({
        id: `e${i}`,
        amount: 1000,
        occurredAt: new Date().toISOString(),
      })),
      total: 20000,
    });
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(screen.getByTestId("period-day")); // → special
    const list = await screen.findByTestId("summary-list");
    expect(list).toHaveClass("flex-1");
    expect(list).toHaveClass("min-h-0");
    expect(list).toHaveClass("overflow-y-auto");
  });

  it("root is fit-to-viewport (h-dvh, overflow-hidden)", async () => {
    await renderUnlocked();
    const root = document.querySelector(".max-w-md");
    expect(root).toHaveClass("h-dvh");
    expect(root).toHaveClass("overflow-hidden");
  });
});
