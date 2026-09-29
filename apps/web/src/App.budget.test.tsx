import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

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
      activeSeries: vi.fn(),
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
vi.mock("../lib/offlineDb", () => ({ mutateOutbox: vi.fn(), mutateTodayCache: vi.fn() }));
vi.mock("../lib/sync", () => ({ queueOfflineCreate: vi.fn(), queueOfflineDelete: vi.fn(), queueOfflineUpdate: vi.fn() }));

const listMock = vi.mocked(expensesApi.list);
const createMock = vi.mocked(expensesApi.create);
const loginMock = vi.mocked(authApi.login);
const getActiveMock = vi.mocked(budgetsApi.getActive);
const historyMock = vi.mocked(budgetsApi.history);
const createBudgetMock = vi.mocked(budgetsApi.create);
const removeBudgetMock = vi.mocked(budgetsApi.remove);
const seriesMock = vi.mocked(budgetsApi.activeSeries);

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
  seriesMock.mockResolvedValue({ days: [] });
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

async function openUserMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId("user-menu-button"));
  await screen.findByTestId("user-menu");
}

describe("App — budget entry + calculator hygiene", () => {
  it("opens the budget screen from the user menu", async () => {
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    expect(await screen.findByTestId("budget-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("keypad")).not.toBeInTheDocument();
  });

  it("Escape returns from the budget screen to the calculator", async () => {
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-screen");

    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-screen")).not.toBeInTheDocument();
  });

  it("no budget → sterile numbers on the calculator + empty state with CTA", async () => {
    const user = userEvent.setup();
    await renderUnlocked();

    expect(screen.queryByTestId("budget-micro")).not.toBeInTheDocument();
    // Insight ticker nags for a budget instead of sterile silence (plan rule 8).
    expect(await screen.findByTestId("insight-ticker")).toHaveTextContent(
      "Pasang budget biar ada yang ngingetin.",
    );

    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    expect(await screen.findByTestId("budget-empty")).toHaveTextContent("Belum ada budget.");
    expect(screen.queryByTestId("budget-history")).not.toBeInTheDocument(); // hidden, not noisy
  });

  it("active budget → insight ticker replaces the micro-row in the calculator header", async () => {
    // Live list seeds todayTotal; the ticker derives remaining from it.
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 35_000, occurredAt: new Date().toISOString() }],
      total: 35_000,
    });
    // Dates must include today (2026-09-19) — otherwise the ticker says "upcoming".
    getActiveMock.mockResolvedValue(
      activeBudget({ startDate: "2026-09-01", endDate: "2026-09-30" }),
    );
    await renderUnlocked();

    const ticker = await screen.findByTestId("insight-ticker");
    expect(ticker).toHaveTextContent("Sisa Rp65rb hari ini, santai.");
    expect(ticker).not.toHaveTextContent("Rp35.000 / Rp100.000"); // spent/cap pair moved off the ticker
  });
});

describe("App — budget screen: active card + history", () => {
   it("renders the period card with position + day counter + chart + edit|hapus", async () => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00+07:00"));
    getActiveMock.mockResolvedValue(
      activeBudget({ type: "full", amount: 10_000_000, startDate: "2026-09-01", endDate: "2026-09-30", spent: 3_600_000, remaining: 6_400_000, progressPct: 36 }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: "2026-09-25", total: 1_000_000 },
        { date: "2026-09-26", total: 2_600_000 },
        { date: "2026-09-27", total: 3_000_000 },
      ],
    });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await screen.findByTestId("budget-period");
    expect(screen.getByTestId("budget-period-position")).toHaveTextContent("+Rp3.400.000");
    expect(screen.getByTestId("budget-period-days")).toHaveTextContent("28/30 Hari");
    expect(screen.getByTestId("budget-period-chart")).toBeInTheDocument();
    // Edit + Hapus live on the card itself.
    expect(screen.getByTestId("budget-active-ganti")).toHaveTextContent("Edit");
    expect(screen.getByTestId("budget-active-hapus")).toHaveTextContent("Hapus");
    // Kelola modal only carries history now.
    await user.click(screen.getByTestId("budget-kelola-toggle"));
    expect(await screen.findByTestId("budget-modal-overlay")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-kelola-ganti")).not.toBeInTheDocument();
    expect(screen.queryByTestId("budget-kelola-hapus")).not.toBeInTheDocument();
    vi.useRealTimers();
   });

   it("lists history rows with status chips and spent values", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    historyMock.mockResolvedValue({ history: [historyItem()] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    // History now lives in the Kelola modal.
    await user.click(screen.getByTestId("budget-kelola-toggle"));
    const item = await screen.findByTestId("budget-history-item-hist-1");
    expect(item).toHaveTextContent("1–31 Agu • Penuh");
    expect(item).toHaveTextContent("Rp8.200.000 / Rp10.000.000");
    expect(item).toHaveTextContent("Lewot batas".replace("Lewot", "Lewat"));
    expect(screen.getByTestId("budget-use-again-hist-1")).toBeInTheDocument();
  });
});

describe("App — Pakai lagi (prefill + smart-shift, plan §3)", () => {
   it("prefills type + amount and smart-shifts dates for review", async () => {
    const item = historyItem();
    getActiveMock.mockResolvedValue(activeBudget());
    historyMock.mockResolvedValue({ history: [item] });
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-form-toggle");

    // History lives in the Kelola modal → Pakai lagi there opens form modal.
    await user.click(screen.getByTestId("budget-kelola-toggle"));
    await user.click(await screen.findByTestId("budget-use-again-hist-1"));

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
    getActiveMock.mockResolvedValue(activeBudget());
    historyMock.mockResolvedValue({ history: [item] });
    seriesMock.mockResolvedValue({ days: [] });
    createBudgetMock.mockImplementation(async () => {
      // Server-side: create deactives the old and returns the new active.
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
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-kelola-toggle");
    // Buka modal kelola → Pakai lagi pada history row → form modal terbuka.
    await user.click(screen.getByTestId("budget-kelola-toggle"));
    await user.click(await screen.findByTestId("budget-use-again-hist-1"));

    await user.click(screen.getByTestId("budget-submit"));

    expect(createBudgetMock).toHaveBeenCalledTimes(1);
    const payload = createBudgetMock.mock.calls[0]![0]!;
    expect(payload.type).toBe("full");
    expect(payload.amount).toBe(item.amount);

    // After submit, modal closes.
    expect(screen.queryByTestId("budget-modal-overlay")).not.toBeInTheDocument();
   });

   it("'Edit' pada kartu budget prefills the form modal from the active budget", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await screen.findByTestId("budget-period");
    // Edit langsung pada kartu → form modal dengan prefill.
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
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

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
    await screen.findByTestId("insight-ticker");

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
    await screen.findByTestId("insight-ticker");

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
    await screen.findByTestId("insight-ticker");

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
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await user.click(screen.getByTestId("budget-form-toggle"));
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
    // After create, modal closes (form collapsed).
    await screen.findByTestId("budget-form-toggle");
    expect(screen.queryByTestId("budget-modal-overlay")).not.toBeInTheDocument();
  });

   it("create failure shows the banner but the calculator stays usable (soft warning)", async () => {
    createBudgetMock.mockRejectedValue(new Error("Invalid budget."));
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await user.click(screen.getByTestId("budget-form-toggle"));
    await screen.findByTestId("budget-form");
    await user.type(screen.getByTestId("budget-amount"), "150000");
    await user.click(screen.getByTestId("budget-submit"));

    expect(await screen.findByTestId("error-banner")).toHaveTextContent("Invalid budget.");

    // Modal Escape closes the modal (not the budget screen) → screen still open.
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("budget-screen")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-modal-overlay")).not.toBeInTheDocument();
    // Escape again returns from the budget screen to the calculator.
    await user.keyboard("{Escape}");
    expect(await screen.findByTestId("keypad")).toBeInTheDocument();
   });

   it("Hapus on the card asks for confirmation, then deactivates (budget disappears)", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    removeBudgetMock.mockImplementation(async () => {
      getActiveMock.mockResolvedValue({ budget: null });
    });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    // Hapus langsung pada kartu.
    await user.click(screen.getByTestId("budget-active-hapus"));
    expect(screen.getByTestId("budget-delete-dialog")).toBeInTheDocument();
    expect(removeBudgetMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("budget-delete-confirm"));
    expect(removeBudgetMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("budget-empty")).toBeInTheDocument();
   });

   it("cancel keeps the active budget", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    await user.click(screen.getByTestId("budget-active-hapus"));
    await user.click(screen.getByTestId("budget-delete-cancel"));

    expect(removeBudgetMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("budget-period")).toBeInTheDocument();
  });
});

describe("App — budget screen: form toggle + 3-layer dashboard (plan §3)", () => {
  // Freeze today so series pace/position assertions are stable.
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-09-28T12:00:00+07:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

   it("form is collapsed (Tambah toggle) when an active budget exists; opens modal", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    // Form is collapsed — only the toggle is visible.
    expect(screen.getByTestId("budget-form-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-form")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("budget-form-toggle"));
    expect(await screen.findByTestId("budget-form")).toBeInTheDocument();
    expect(screen.getByTestId("budget-modal-overlay")).toBeInTheDocument();
   });

   it("header Tambah pill opens the form modal from collapsed state", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    // Header pill is visible in the sticky top bar.
    expect(screen.getByTestId("budget-form-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-form")).not.toBeInTheDocument();

    // Click the header Tambah pill → form modal opens.
    await user.click(screen.getByTestId("budget-form-toggle"));
    expect(await screen.findByTestId("budget-form")).toBeInTheDocument();
    expect(screen.getByTestId("budget-modal-overlay")).toBeInTheDocument();
   });

  it("daily under today → today delta +Rp tersisa + period behind + day deltas", async () => {
    // Daily 85k, Sep 25–28. Series: 76.785 / 153.405 / 190.019 / 47.000.
    // Allowance 340k, spent 467.209 → position −127.209 (tertinggal).
    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "daily",
        amount: 85_000,
        startDate: "2026-09-25",
        endDate: "2026-10-25",
        todaySpent: 47_000,
        spent: 47_000,
        remaining: 38_000,
        progressPct: 55,
        status: "ok",
      }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: "2026-09-25", total: 76_785 },
        { date: "2026-09-26", total: 153_405 },
        { date: "2026-09-27", total: 190_019 },
        { date: "2026-09-28", total: 47_000 },
      ],
    });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    // Layer 1: today — chip + signed delta headline + pct.
    expect(await screen.findByTestId("budget-today")).toBeInTheDocument();
    expect(screen.getByTestId("budget-today-status")).toHaveTextContent("Aman");
    expect(screen.getByTestId("budget-today-delta")).toHaveTextContent("+Rp38.000");
    expect(screen.getByTestId("budget-today-pct")).toHaveTextContent("55%");

    // Layer 2: period position behind + day counter.
    expect(screen.getByTestId("budget-period")).toBeInTheDocument();
    expect(screen.getByTestId("budget-period-position")).toHaveTextContent("−Rp127.209");
    expect(screen.getByTestId("budget-period-days")).toHaveTextContent("4/31 Hari");
    expect(screen.getByTestId("budget-period-chart")).toBeInTheDocument();

    // Layer 3: history newest-first with signed deltas.
    expect(screen.getByTestId("budget-day-history")).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^budget-day-row-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "budget-day-row-2026-09-28",
      "budget-day-row-2026-09-27",
      "budget-day-row-2026-09-26",
      "budget-day-row-2026-09-25",
    ]);
    expect(screen.getByTestId("budget-day-delta-2026-09-28")).toHaveTextContent("+Rp38.000");
    expect(screen.getByTestId("budget-day-delta-2026-09-27")).toHaveTextContent("−Rp105.019");
    expect(screen.getByTestId("budget-day-delta-2026-09-26")).toHaveTextContent("−Rp68.405");
    expect(screen.getByTestId("budget-day-delta-2026-09-25")).toHaveTextContent("+Rp8.215");
  });

  it("daily over today → status chip over + −Rp headline", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "daily",
        amount: 85_000,
        startDate: "2026-09-25",
        endDate: "2026-10-25",
        todaySpent: 120_000,
        spent: 120_000,
        remaining: 0,
        progressPct: 141,
        status: "over",
      }),
    );
    seriesMock.mockResolvedValue({ days: [{ date: "2026-09-28", total: 120_000 }] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    expect(await screen.findByTestId("budget-today-delta")).toHaveTextContent("−Rp35.000");
    expect(screen.getByTestId("budget-today-status")).toHaveTextContent("Lewat batas");
    expect(screen.getByTestId("budget-today-pct")).toHaveTextContent("141%");
  });

  it("period card shows elapsed/total day counter", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "daily",
        amount: 85_000,
        startDate: "2026-09-25",
        endDate: "2026-10-25",
        todaySpent: 190_019,
        spent: 190_019,
        remaining: 0,
        progressPct: 224,
        status: "over",
      }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: "2026-09-25", total: 76_785 }, // under
        { date: "2026-09-26", total: 153_405 }, // over
        { date: "2026-09-27", total: 190_019 }, // over
        { date: "2026-09-28", total: 190_019 }, // over today
      ],
    });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    // Sep 25–28 elapsed 4 of 31 total days (Sep 25 – Oct 25).
    expect(await screen.findByTestId("budget-period-days")).toHaveTextContent("4/31 Hari");
  });

  it("full budget → chip from overall status, no daily deltas, no pace line", async () => {
    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "full",
        amount: 3_000_000,
        startDate: "2026-09-25",
        endDate: "2026-10-25",
        todaySpent: 47_000,
        spent: 467_209,
        remaining: 2_532_791,
        progressPct: 16,
        status: "ok",
      }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: "2026-09-25", total: 76_785 },
        { date: "2026-09-26", total: 153_405 },
        { date: "2026-09-27", total: 190_019 },
        { date: "2026-09-28", total: 47_000 },
      ],
    });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    // Today shows the total with the overall-status chip, no +/- fiction.
    expect(await screen.findByTestId("budget-today-spent")).toHaveTextContent("Rp47.000");
    expect(screen.getByTestId("budget-today-status")).toHaveTextContent("Aman");
    expect(screen.getByTestId("budget-today-pct")).toHaveTextContent("2%");
    expect(screen.queryByTestId("budget-today-delta")).not.toBeInTheDocument();
    // Period: signed position + day counter, no pace line.
    expect(screen.getByTestId("budget-period-position")).toHaveTextContent("+Rp2.532.791");
    expect(screen.getByTestId("budget-period-days")).toHaveTextContent("4/31 Hari");
    expect(screen.queryByTestId("budget-period-pace")).not.toBeInTheDocument();
    // History rows carry no delta cells.
    expect(screen.getByTestId("budget-day-row-2026-09-28")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-day-delta-2026-09-28")).not.toBeInTheDocument();
  });

  it("16-day series → 14 rows + expand button reveals the rest", async () => {
    const days = Array.from({ length: 16 }, (_, i) => {
      const day = String(13 + i).padStart(2, "0");
      return { date: `2026-09-${day}`, total: 10_000 };
    });
    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "daily",
        amount: 85_000,
        startDate: "2026-09-13",
        endDate: "2026-10-25",
        todaySpent: 10_000,
        spent: 10_000,
        remaining: 75_000,
        progressPct: 12,
        status: "ok",
      }),
    );
    seriesMock.mockResolvedValue({ days });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await screen.findByTestId("budget-day-history");
    expect(screen.getAllByTestId(/^budget-day-row-/)).toHaveLength(14);
    // Newest first: Sep 28 on top.
    expect(screen.getAllByTestId(/^budget-day-row-/)[0]?.getAttribute("data-testid")).toBe(
      "budget-day-row-2026-09-28",
    );
    await user.click(screen.getByTestId("budget-history-more"));
    expect(screen.getAllByTestId(/^budget-day-row-/)).toHaveLength(16);
    expect(screen.queryByTestId("budget-history-more")).not.toBeInTheDocument();
  });

  it("Pakai lagi from active opens form with prefill (not collapsed)", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    // Form is collapsed initially.
    expect(screen.getByTestId("budget-form-toggle")).toBeInTheDocument();

    // Edit pada kartu → prefill → form modal muncul.
    await user.click(screen.getByTestId("budget-active-ganti"));
    expect(await screen.findByTestId("budget-prefill-note")).toBeInTheDocument();
    expect(screen.getByTestId("budget-form")).toBeInTheDocument();
  });

  it("submit from modal closes the modal on success (plan §3)", async () => {
    getActiveMock.mockResolvedValue(activeBudget());
    seriesMock.mockResolvedValue({ days: [] });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));
    await screen.findByTestId("budget-period");

    await user.click(screen.getByTestId("budget-form-toggle"));
    await screen.findByTestId("budget-form");

    await user.click(screen.getByTestId("budget-type-daily"));
    await user.type(screen.getByTestId("budget-amount"), "150000");
    await user.click(screen.getByTestId("budget-submit"));

    // After successful create, modal closes.
    await screen.findByTestId("budget-form-toggle");
    expect(screen.queryByTestId("budget-modal-overlay")).not.toBeInTheDocument();
  });

  it("budget-period-chart renders one bar per day in the series", async () => {    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "daily",
        amount: 85_000,
        startDate: "2026-09-25",
        endDate: "2026-10-25",
        todaySpent: 47_000,
        spent: 467_209,
        remaining: -127_209,
        progressPct: 137,
        status: "ok",
      }),
    );
    seriesMock.mockResolvedValue({
      days: [
        { date: "2026-09-25", total: 76_785 },
        { date: "2026-09-26", total: 153_405 },
        { date: "2026-09-27", total: 190_019 },
        { date: "2026-09-28", total: 47_000 },
      ],
    });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await screen.findByTestId("budget-period-chart");
    expect(screen.getAllByTestId(/^budget-period-bar-\d{4}-\d{2}-\d{2}$/)).toHaveLength(4);
  });

  it(">= 14 days auto-transforms bars into an up-down line chart", async () => {
    const days = Array.from({ length: 16 }, (_, i) => {
      const day = String(13 + i).padStart(2, "0");
      // Alternate under/over so the line goes up and down.
      return { date: `2026-09-${day}`, total: i % 2 === 0 ? 10_000 : 190_019 };
    });
    getActiveMock.mockResolvedValue(
      activeBudget({
        type: "daily",
        amount: 85_000,
        startDate: "2026-09-13",
        endDate: "2026-10-25",
        todaySpent: 10_000,
        spent: 10_000,
        remaining: 75_000,
        progressPct: 12,
        status: "ok",
      }),
    );
    seriesMock.mockResolvedValue({ days });
    const user = await renderUnlocked();
    await openUserMenu(user);
    await user.click(screen.getByTestId("user-menu-budget"));

    await screen.findByTestId("budget-period-chart");
    expect(screen.getByTestId("budget-period-line")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^budget-period-bar-\d{4}-\d{2}-\d{2}$/)).toHaveLength(0);
    expect(screen.getAllByTestId(/^budget-period-point-\d{4}-\d{2}-\d{2}$/)).toHaveLength(16);
  });
});
