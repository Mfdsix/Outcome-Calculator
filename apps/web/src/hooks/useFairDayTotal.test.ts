import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHook, waitFor } from "@testing-library/react";

import { useFairDayTotal } from "./useFairDayTotal";
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

describe("useFairDayTotal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not fetch when mode is 'raw' — returns null immediately", () => {
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "raw", [], undefined, FROZEN_NOW),
    );
    expect(result.current.fairTotal).toBeNull();
    expect(result.current.fairLoading).toBe(false);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("does not fetch when dayKey is null — returns null immediately", () => {
    const { result } = renderHook(() =>
      useFairDayTotal(null, "fair", [], undefined, FROZEN_NOW),
    );
    expect(result.current.fairTotal).toBeNull();
    expect(result.current.fairLoading).toBe(false);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("fetches and computes fair total for a focused day (weekday, no allocation overlap)", async () => {
    // Focus on Sep 17 (a Thursday). WEEKLY 700k created Sep 17 → 100k/day.
    // MONTHLY 300k created Sep 17 → 10k/day. NONE 50k → full.
    // Fair for Sep 17 = 50k + 100k + 10k = 160k.
    mockExpenses([
      { id: "e1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" as const },
      { id: "e2", amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as const },
      { id: "e3", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ]);
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", [], undefined, FROZEN_NOW),
    );
    expect(result.current.fairLoading).toBe(true);
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBe(160_000);
    expect(result.current.hasAllocated).toBe(true);
  });

  it("computes fair total for a past day (Sep 15) — monthly tail-overlap", async () => {
    // MONTHLY 300k created Sep 15 → 10k/day from Sep 15 to Oct 14.
    // Focused day Sep 16 → day 2 = 10k.
    mockExpenses([
      { id: "e1", amount: 300_000, occurredAt: "2026-09-15T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ]);
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-16", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBe(10_000);
    expect(result.current.hasAllocated).toBe(true);
  });

  it("returns null (raw fallback) on OfflineError", async () => {
    listMock.mockRejectedValue(new OfflineError());
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBeNull();
  });

  it("returns null on 401 — does not re-lock here", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    listMock.mockRejectedValue(err);
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBeNull();
  });

  it("returns null on generic API error", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.fairTotal).toBeNull();
  });

  it("includes optimistic rows not present in the server response (dedup by id)", async () => {
    mockExpenses([
      { id: "e1", amount: 700_000, occurredAt: "2026-09-17T09:00:00+07:00", allocationType: "WEEKLY" as const },
    ]);
    const optimistic = [
      { id: "optimistic-1", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ];
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", optimistic, undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    // 100k (WEEKLY) + 10k (MONTHLY optimistic) = 110k
    expect(result.current.fairTotal).toBe(110_000);
  });

  it("does not double-count optimistic rows that exist in the server response", async () => {
    mockExpenses([
      { id: "temp-1", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ]);
    const optimistic = [
      { id: "temp-1", amount: 300_000, occurredAt: "2026-09-17T08:00:00+07:00", allocationType: "MONTHLY" as const },
    ];
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", optimistic, undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    // 300k MONTHLY → 10k/day. Single day fair = 10k. Optimistic deduped.
    expect(result.current.fairTotal).toBe(10_000);
  });

  it("aborts previous fetch when dayKey changes", async () => {
    let resolveCount = 0;
    listMock.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveCount++;
        setTimeout(() => resolve({ expenses: [], total: 0 }), 200);
      });
    });

    // Stable array identity (see useFairTotal abort test): an inline `[]`
    // would retrigger the fetch effect on every render.
    const stableOptimistic: [] = [];
    const { result, rerender } = renderHook(
      ({ dayKey }: { dayKey: string }) => useFairDayTotal(dayKey, "fair", stableOptimistic, undefined, FROZEN_NOW),
      { initialProps: { dayKey: "2026-09-17" } },
    );

    // Switch dayKey before first fetch resolves
    rerender({ dayKey: "2026-09-18" });
    await waitFor(() => expect(resolveCount).toBeGreaterThanOrEqual(2));
  });

  it("sets hasAllocated=false when only NONE expenses in fetched range", async () => {
    mockExpenses([
      { id: "e1", amount: 50_000, occurredAt: "2026-09-17T10:00:00+07:00", allocationType: "NONE" as const },
    ]);
    const { result } = renderHook(() =>
      useFairDayTotal("2026-09-17", "fair", [], undefined, FROZEN_NOW),
    );
    await waitFor(() => expect(result.current.fairLoading).toBe(false));
    expect(result.current.hasAllocated).toBe(false);
    expect(result.current.fairTotal).toBe(50_000);
  });
});
