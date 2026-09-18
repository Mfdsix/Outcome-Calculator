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
    authApi: { login, refresh },
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
const updateMock = vi.mocked(expensesApi.update);
const removeMock = vi.mocked(expensesApi.remove);
const loginMock = vi.mocked(authApi.login);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  listMock.mockResolvedValue({ expenses: [], total: 0 });
  updateMock.mockResolvedValue({
    id: "e1",
    amount: 50000,
    occurredAt: "2026-09-17T12:00:00+07:00",
  });
  removeMock.mockResolvedValue(undefined);
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

async function openSpecialWithRows(rows: Array<{ id: string; amount: number }>): Promise<void> {
  const user = userEvent.setup();
  listMock.mockResolvedValue({
    expenses: rows.map((row) => ({
      ...row,
      occurredAt: new Date().toISOString(),
    })),
    total: rows.reduce((sum, row) => sum + row.amount, 0),
  });

  await renderUnlocked();
  await user.click(screen.getByTestId("period-day")); // → special mode
  await screen.findByTestId("summary-list");
}

describe("App — edit (TODO: history affordance — control-bar removed in spec gabungan)", () => {
  // Edit/hapus tidak di-render di special mode (plan: history without ControlBar).
  // Handler handleEdit/confirmDelete + DeleteDialog tetap ada di App.tsx sebagai
  // dead code yang siap dipasangkan affordance baru. Skip sampai UI-nya kembali.
  it.skip("loads selected expense into the calculator and updates it on enter (pending history edit affordance)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue({
      expenses: [{ id: "e1", amount: 35000, occurredAt: new Date().toISOString() }],
      total: 35000,
    });

    await renderUnlocked();
    await user.click(screen.getByTestId("period-day")); // → special mode
    await screen.findByTestId("summary-list");

    await user.click(screen.getByTestId("key-enter")); // drill
    await screen.findByTestId("browse-list");
    await user.click(screen.getByTestId("browse-row-e1"));
    await user.click(screen.getByTestId("control-edit"));

    expect(screen.getByTestId("amount-display")).toHaveTextContent("35.000");

    // 35.000 → 50.000 (clear all digits, then re-enter)
    for (let i = 0; i < 5; i += 1) {
      await user.click(screen.getByTestId("key-backspace"));
    }
    await user.click(screen.getByTestId("key-5"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-0"));
    await user.click(screen.getByTestId("key-enter"));

    expect(updateMock).toHaveBeenCalledWith("e1", { amount: 50000 });
  });
});

describe("App — delete (TODO: history affordance — control-bar removed in spec gabungan)", () => {
  it.skip("requires confirmation and deletes on confirm (pending history delete affordance)", async () => {
    const user = userEvent.setup();
    await openSpecialWithRows([{ id: "e2", amount: 35000 }]);

    await user.click(screen.getByTestId("key-enter")); // drill
    await screen.findByTestId("browse-list");
    await user.click(screen.getByTestId("browse-row-e2"));
    await user.click(screen.getByTestId("control-delete"));

    expect(screen.getByTestId("delete-dialog-message")).toHaveTextContent("Delete Rp35.000?");
    await user.click(screen.getByTestId("delete-confirm"));

    expect(removeMock).toHaveBeenCalledWith("e2");
    expect(screen.queryByTestId("delete-dialog")).not.toBeInTheDocument();
  });

  it.skip("keeps the expense when cancel is pressed (pending history delete affordance)", async () => {
    const user = userEvent.setup();
    await openSpecialWithRows([{ id: "e3", amount: 35000 }]);

    await user.click(screen.getByTestId("key-enter")); // drill
    await screen.findByTestId("browse-list");
    await user.click(screen.getByTestId("browse-row-e3"));
    await user.click(screen.getByTestId("control-delete"));
    await user.click(screen.getByTestId("delete-cancel"));

    expect(removeMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delete-dialog")).not.toBeInTheDocument();
  });
});

describe("App — API error", () => {
  it("shows an error banner when create fails", async () => {
    vi.mocked(expensesApi.create).mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    await renderUnlocked();

    await user.click(await screen.findByTestId("key-2"));
    await user.click(screen.getByTestId("key-enter"));

    expect(await screen.findByTestId("error-banner")).toBeInTheDocument();
  });
});
