import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHook, waitFor } from "@testing-library/react";

import type { Period } from "../types/ui";
import { useFairTotal } from "./useFairTotal";
import { OfflineError } from "../lib/api";
import type { ExpenseDto } from "@expense-app/shared";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/repository", () => ({
  expensesRepository: { list: listMock },
}));

vi.mock("../lib/api", async (importActual) => {
  const actual = await importActual<typeof import("../lib/api")>();
  return {
    ...actual,
    OfflineError: class OfflineError extends Error {
      status = 0;
      name = "OfflineError";
    },
  };
});

const FROZEN_NOW = new Date("2026-09-17T14:00:00+07:00");

const mockExpenses = (expenses: ExpenseDto[]): void => {
  listMock.mockResolvedValue({ expenses, total: 0 });
};

describe("useFairTotal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when mode is 'raw' — returns null immediately", () => {
    const { result } = renderHook(() =>
      useFairTotal("day", "raw", [], undefined, FROZEN_NOW),
    );
    expect(result.current.fairTotal).toBeNull();
    expect(result.current.fairLoading).toBe(false);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("fetches and computes fair total when mode is 'fair'", async () => {
    mockExpenses([
      { id: "e1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" },
      { id: "e2", amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" },
      { id: "e3", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" },
    ]);
    const { result } = renderHook(() =>
      useFairTotal("day", "fair", [], undefined, FROZEN_NOW),
    );
    expect(result.current.fairLoading).toBe(true);
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    // 50k (NONE full) + 100k (WEEKLY 1/7) + 10k (MONTHLY 1/30) = 160k
    expect(result.current.fairTotal).toBe(160_000);
  });

  it("returns null (raw fallback) on OfflineError", async () => {
    listMock.mockRejectedValue(new OfflineError());
    const { result } = renderHook(() =>
      useFairTotal("day", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBeNull();
  });

  it("returns null (raw fallback) on 401 — does not re-lock here", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    listMock.mockRejectedValue(err);
    const { result } = renderHook(() =>
      useFairTotal("day", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBeNull();
  });

  it("returns null on generic API error", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useFairTotal("day", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBeNull();
  });

  it("includes optimistic rows not present in the server response (dedup by id)", async () => {
    mockExpenses([
      { id: "e1", amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" },
    ]);
    const optimistic = [
      { id: "optimistic-1", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ];
    const { result } = renderHook(() =>
      useFairTotal("day", "fair", optimistic, undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    // 100k (WEEKLY) + 10k (MONTHLY optimistic) = 110k
    expect(result.current.fairTotal).toBe(110_000);
  });

  it("does not double-count optimistic rows that exist in the server response", async () => {
    mockExpenses([
      { id: "temp-1", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" },
    ]);
    const optimistic = [
      { id: "temp-1", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ];
    const { result } = renderHook(() =>
      useFairTotal("day", "fair", optimistic, undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBe(10_000);
  });

  it("aborts previous fetch when period changes", async () => {
    let resolveCount = 0;
    listMock.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveCount++;
        setTimeout(() => resolve({ expenses: [], total: 0 }), 200);
      });
    });

    const { result, rerender } = renderHook(
      ({ period }: { period: Period }) => useFairTotal(period, "fair" as const, [], undefined, FROZEN_NOW),
      { initialProps: { period: "day" } },
    );

    // Switch period before first fetch resolves
    rerender({ period: "week" });
    await waitFor(() => expect(result.current.fairLoading).toBeFalsy());
    // At least 2 fetches were initiated (the first aborted by the period change).
    expect(resolveCount).toBeGreaterThanOrEqual(2);
  });
});
