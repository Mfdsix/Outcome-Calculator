import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BudgetActiveResponse, BudgetDayPoint, BudgetHistoryItem } from "@expense-app/shared";

import { budgetsApi } from "../lib/api";
import { useBudget } from "./useBudget";

vi.mock("../lib/api", () => ({
  budgetsApi: {
    getActive: vi.fn(),
    history: vi.fn(),
    activeSeries: vi.fn(),
    seriesById: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

const getActiveMock = vi.mocked(budgetsApi.getActive);
const historyMock = vi.mocked(budgetsApi.history);
const activeSeriesMock = vi.mocked(budgetsApi.activeSeries);
const seriesByIdMock = vi.mocked(budgetsApi.seriesById);
const createMock = vi.mocked(budgetsApi.create);

function activeBudget(): NonNullable<BudgetActiveResponse["budget"]> {
  return {
    id: "active-1",
    type: "daily",
    amount: 100_000,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    spent: 30_000,
    todaySpent: 30_000,
    remaining: 70_000,
    status: "ok",
    progressPct: 30,
  };
}

function historyItem(id: string, overrides: Partial<BudgetHistoryItem> = {}): BudgetHistoryItem {
  return {
    id,
    type: "full",
    amount: 1_000_000,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    spent: 900_000,
    status: "ok",
    createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function days(...totals: number[]): BudgetDayPoint[] {
  return totals.map((total, index) => ({ date: `2026-08-0${index + 1}`, total }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveMock.mockResolvedValue({ budget: activeBudget() });
  historyMock.mockResolvedValue({ history: [historyItem("past-1"), historyItem("past-2")] });
  activeSeriesMock.mockResolvedValue({ days: days(10_000) });
  seriesByIdMock.mockImplementation((id) =>
    Promise.resolve({ days: days(id === "past-1" ? 11_000 : 22_000) }),
  );
  createMock.mockResolvedValue({ id: "new-1" });
});

describe("useBudget — navigation + past series cache", () => {
  it("starts focused on the active budget with [active, ...history]", async () => {
    const { result } = renderHook(() => useBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.list.map((item) => item.id)).toEqual([
      "active-1",
      "past-1",
      "past-2",
    ]);
    expect(result.current.focusedIndex).toBe(0);
    expect(result.current.focusedIsPast).toBe(false);
    expect(seriesByIdMock).not.toHaveBeenCalled();
  });

  it("fetches a past series once per id and serves later visits from cache", async () => {
    const { result } = renderHook(() => useBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setFocusedIndex(1));
    await waitFor(() => expect(result.current.focusedPastSeries).toEqual(days(11_000)));
    expect(result.current.focusedIsPast).toBe(true);
    expect(seriesByIdMock).toHaveBeenCalledTimes(1);
    expect(seriesByIdMock).toHaveBeenCalledWith("past-1", expect.any(AbortSignal));

    act(() => result.current.setFocusedIndex(0));
    act(() => result.current.setFocusedIndex(1));
    await waitFor(() => expect(result.current.focusedPastSeries).toEqual(days(11_000)));
    expect(seriesByIdMock).toHaveBeenCalledTimes(1); // cache hit
  });

  it("invalidates the cache on refresh and refetches the focused past budget", async () => {
    const { result } = renderHook(() => useBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setFocusedIndex(1));
    await waitFor(() => expect(result.current.focusedPastSeries).not.toBeNull());
    expect(seriesByIdMock).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(seriesByIdMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.focusedPastSeries).not.toBeNull());
  });

  it("records a fetch error and recovers on retry", async () => {
    seriesByIdMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setFocusedIndex(1));
    await waitFor(() => expect(result.current.pastSeriesError).toBe("boom"));
    expect(result.current.focusedPastSeries).toBeNull();

    act(() => result.current.retryPastSeries());
    await waitFor(() => expect(result.current.focusedPastSeries).toEqual(days(11_000)));
    expect(result.current.pastSeriesError).toBeNull();
  });

  it("clamps the focused index when history shrinks and resets on create", async () => {
    const { result } = renderHook(() => useBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setFocusedIndex(2));
    await waitFor(() => expect(result.current.focusedIsPast).toBe(true));

    historyMock.mockResolvedValue({ history: [historyItem("past-1")] });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.focusedIndex).toBe(1));

    act(() => result.current.setFocusedIndex(1));
    await act(async () => {
      await result.current.createBudget({
        type: "daily",
        amount: 100_000,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
      });
    });
    expect(result.current.focusedIndex).toBe(0);
  });
});
