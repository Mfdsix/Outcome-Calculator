import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetActiveResponse, BudgetHistoryItem } from "@expense-app/shared";
import { suggestCopyDates } from "@expense-app/shared";

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
    readLastVisit: vi.fn(() => 0),
    writeLastVisit: vi.fn(),
    setAuthToken: vi.fn(),
  };
});

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const loginMock = vi.mocked(authApi.login);
const getActiveMock = vi.mocked(budgetsApi.getActive);
const historyMock = vi.mocked(budgetsApi.history);
const createBudgetMock = vi.mocked(budgetsApi.create);
const removeBudgetMock = vi.mocked(budgetsApi.remove);

function activeBudget(overrides: Partial<NonNullable<BudgetActiveResponse["budget"]>> = {}): BudgetActiveResponse {
  return {
    budget: {
      id: "budget-1",
      type: "daily",
      amount: 100_000,
      // Far-future period so the card is never "finished" unless a test says so.
      startDate: "2099-09-01",
      endDate: "2099-09-30",
      spent: 35_000,
      todaySpent: 35_000,
      remaining: 65_000,
      status: "ok",
      progressPct: 35,
      ...overrides,
    },
  };
}

function historyItem(overrides: Partial<BudgetHistoryItem> = {}): BudgetHistoryItem {
  return {
    id: "hist-1",
    type: "full",
    amount: 10_000_000,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    spent: 8_200_000,
    status: "over",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  getActiveMock.mockResolvedValue({ budget: null });
  historyMock.mockResolvedValue({ history: [] });
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

async function renderUnlocked(pin = "ABC123") {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("lock-screen");
  await user.type(screen.getByTestId("lock-code-input"), pin);
  await screen.findByTestId("keypad");
  return user;
}

describe("App — budget entry + calculator hygiene", () => {
  it("opens the budget screen from the header button", async () => {
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    expect(await screen.findByTestId("budget-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("keypad")).not.toBeInTheDocument();
  });

  it("Escape returns from the budget screen to the calculator", async () => {
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));
    await screen.findByTestId("budget-screen");

    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-screen")).not.toBeInTheDocument();
  });

  it("no budget → sterile calculator UI (no micro-row) + empty state with CTA", async () => {
    await renderUnlocked();

    expect(screen.queryByTestId("budget-micro")).not.toBeInTheDocument();

    await screen.findByTestId("keypad");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("budget-open"));

    expect(await screen.findByTestId("budget-empty")).toHaveTextContent("Belum ada budget.");
    expect(screen.queryByTestId("budget-history")).not.toBeInTheDocument(); // hidden, not noisy
  });

  it("active budget → micro-row shows remaining today in the calculator header", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    await renderUnlocked();

    const micro = await screen.findByTestId("budget-micro");
    expect(micro).toHaveTextContent("Sisa hari ini:");
    expect(micro).toHaveTextContent("Rp65.000");
    // Right side is the spent/cap pair (abbreviated only ≥ 1jt → full here).
    expect(micro).toHaveTextContent("Rp35.000 / Rp100.000");
  });
});

describe("App — budget screen: active card + history", () => {
  it("renders the active card with spent/cap, progress and period label", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ type: "full", amount: 10_000_000, spent: 3_600_000, remaining: 6_400_000, progressPct: 36 }),
    );
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    const card = await screen.findByTestId("budget-card");
    expect(card).toHaveTextContent("Rp6.400.000");
    expect(card).toHaveTextContent("dari Rp10 jt");
    expect(card).toHaveTextContent("36% terpakai");
    expect(card).toHaveTextContent("1–30 Sep • Penuh");
    expect(screen.getByTestId("budget-active-ganti")).toBeInTheDocument();
    expect(screen.getByTestId("budget-active-hapus")).toBeInTheDocument();
  });

  it("lists history rows with status chips and spent values", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    historyMock.mockResolvedValue({ history: [historyItem()] });
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    const item = await screen.findByTestId("budget-history-item-hist-1");
    expect(item).toHaveTextContent("1–31 Agu • Penuh");
    expect(item).toHaveTextContent("Rp8.200.000 / Rp10.000.000");
    expect(item).toHaveTextContent("Lewat batas");
    expect(screen.getByTestId("budget-use-again-hist-1")).toBeInTheDocument();
  });
});

describe("App — Pakai lagi (prefill + smart-shift, plan §3)", () => {
  it("prefills type + amount and smart-shifts dates for review", async () => {
    const item = historyItem();
    historyMock.mockResolvedValue({ history: [item] });
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    await screen.findByTestId("budget-history-item-hist-1");
    await user.click(screen.getByTestId("budget-use-again-hist-1"));

    expect(await screen.findByTestId("budget-prefill-note")).toBeInTheDocument();

    // Type + amount identical; dates = suggestCopyDates (today-shifted N days).
    expect(screen.getByTestId("budget-type-full")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("budget-amount")).toHaveValue(String(item.amount));
    const expected = suggestCopyDates(item, "Asia/Jakarta");
    expect(screen.getByTestId("budget-start")).toHaveValue(expected.startDate);
    expect(screen.getByTestId("budget-end")).toHaveValue(expected.endDate);

    // Nothing saved until the user reviews and submits.
    expect(createBudgetMock).not.toHaveBeenCalled();
  });

  it("saving from prefill POSTs a plain create and the active budget is replaced", async () => {
    const item = historyItem();
    historyMock.mockResolvedValue({ history: [item] });
    createBudgetMock.mockImplementation(async () => {
      // Server-side: create deactivates the old and returns the new active.
      getActiveMock.mockResolvedValue(
        activeBudget({
          id: "budget-2",
          type: "full",
          amount: item.amount,
          spent: 0,
          todaySpent: 0,
          remaining: item.amount,
          progressPct: 0,
        }),
      );
      return { id: "budget-2" };
    });

    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));
    await screen.findByTestId("budget-history-item-hist-1");
    await user.click(screen.getByTestId("budget-use-again-hist-1"));

    await user.click(screen.getByTestId("budget-submit"));

    expect(createBudgetMock).toHaveBeenCalledTimes(1);
    const payload = createBudgetMock.mock.calls[0]![0]!;
    expect(payload.type).toBe("full");
    expect(payload.amount).toBe(item.amount);

    // New active card: spent starts from zero (live data, plan §3).
    expect(await screen.findByTestId("budget-card")).toHaveTextContent("0% terpakai");
  });

  it("'Ganti' on the active card prefills from the active budget itself (finished period CTA)", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    await screen.findByTestId("budget-card");
    await user.click(screen.getByTestId("budget-active-ganti"));

    expect(await screen.findByTestId("budget-prefill-note")).toBeInTheDocument();
    expect(screen.getByTestId("budget-type-daily")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("budget-amount")).toHaveValue("100000");
    const expected = suggestCopyDates(
      { startDate: "2026-09-01", endDate: "2026-09-30" },
      "Asia/Jakarta",
    );
    expect(screen.getByTestId("budget-start")).toHaveValue(expected.startDate);
  });

  it("finished period → gray 'Selesai' card + CTA 'Buat yang baru' (plan §3)", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: "2020-08-01", endDate: "2020-08-31" }),
    );
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    const card = await screen.findByTestId("budget-card");
    expect(card).toHaveTextContent("Selesai");
    expect(card).toHaveTextContent("1–31 Agu • Harian");
    expect(card).toHaveClass("opacity-60"); // gray, not status-colored
    expect(screen.getByTestId("budget-active-ganti")).toHaveTextContent("Buat yang baru");
  });
});

describe("App — post-Enter budget toast (plan §3)", () => {
  it("Enter that crosses 80% → amber toast + Enter blink, amount still saved", async () => {
    getActiveMock.mockResolvedValue(activeBudget({ status: "warning", progressPct: 85 }));
    const user = await renderUnlocked();
    await screen.findByTestId("budget-micro");

    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-enter"));

    const notice = await screen.findByTestId("budget-notice");
    expect(notice).toHaveTextContent("Mendekati batas budget.");
    expect(notice).not.toHaveAttribute("role", "alert"); // soft, not an error
    expect(screen.getByTestId("key-enter")).toHaveClass("animate-pulse");
    expect(createMock).toHaveBeenCalledTimes(1); // input tetap masuk
  });

  it("Enter that goes over → red 'Melebihi budget' toast + blink", async () => {
    getActiveMock.mockResolvedValue(activeBudget({ status: "over", progressPct: 120 }));
    const user = await renderUnlocked();
    await screen.findByTestId("budget-micro");

    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-enter"));

    expect(await screen.findByTestId("budget-notice")).toHaveTextContent(
      "Melebihi budget — pengeluaran tetap masuk.",
    );
    expect(screen.getByTestId("key-enter")).toHaveClass("bg-red-600");
  });

  it("status ok → no toast, no blink (zero noise)", async () => {
    getActiveMock.mockResolvedValue(activeBudget()); // ok
    const user = await renderUnlocked();
    await screen.findByTestId("budget-micro");

    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-enter"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("budget-notice")).not.toBeInTheDocument();
    expect(screen.getByTestId("key-enter")).not.toHaveClass("animate-pulse");
  });

  it("no budget → Enter stays silent (sterile calculator)", async () => {
    const user = await renderUnlocked();
    await screen.findByTestId("keypad");

    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-enter"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("budget-notice")).not.toBeInTheDocument();
  });
});

describe("App — create + remove budget", () => {
  it("creates from the bare form and clears the amount on success", async () => {
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    await screen.findByTestId("budget-form");
    await user.click(screen.getByTestId("budget-type-daily"));
    await user.type(screen.getByTestId("budget-amount"), "150000");
    await user.click(screen.getByTestId("budget-submit"));

    expect(createBudgetMock).toHaveBeenCalledWith({
      type: "daily",
      amount: 150_000,
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(await screen.findByTestId("budget-amount")).toHaveValue("");
  });

  it("create failure shows the banner but the calculator stays usable (soft warning)", async () => {
    createBudgetMock.mockRejectedValue(new Error("Invalid budget."));
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));

    await screen.findByTestId("budget-form");
    await user.type(screen.getByTestId("budget-amount"), "150000");
    await user.click(screen.getByTestId("budget-submit"));

    expect(await screen.findByTestId("error-banner")).toHaveTextContent("Invalid budget.");

    // Escape back → keypad unaffected.
    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
  });

  it("Hapus asks for confirmation, then deactivates (budget disappears)", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    removeBudgetMock.mockImplementation(async () => {
      getActiveMock.mockResolvedValue({ budget: null });
    });
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));
    await screen.findByTestId("budget-card");

    await user.click(screen.getByTestId("budget-active-hapus"));
    expect(screen.getByTestId("budget-delete-dialog")).toBeInTheDocument();
    expect(removeBudgetMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("budget-delete-confirm"));
    expect(removeBudgetMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("budget-empty")).toBeInTheDocument();
  });

  it("cancel keeps the active budget", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await user.click(screen.getByTestId("budget-open"));
    await screen.findByTestId("budget-card");

    await user.click(screen.getByTestId("budget-active-hapus"));
    await user.click(screen.getByTestId("budget-delete-cancel"));

    expect(removeBudgetMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("budget-card")).toBeInTheDocument();
  });
});
