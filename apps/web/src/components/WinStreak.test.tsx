import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WinStreakResult } from "@expense-app/shared";
import { computeWinStreaks } from "@expense-app/shared";

import { WinStreakChip } from "./WinStreakChip";
import { WinStreakCard } from "./WinStreakCard";

const TODAY = "2026-09-15";

const STREAK_3_RUN = [
  { date: "2026-09-13", total: 20_000, delta: 30_000 },
  { date: "2026-09-14", total: 30_000, delta: 20_000 },
  { date: "2026-09-15", total: 40_000, delta: 10_000 },
];

const STREAK_WITH_OVER_TODAY = [
  { date: "2026-09-13", total: 10_000, delta: 40_000 },
  { date: "2026-09-14", total: 20_000, delta: 30_000 },
  { date: "2026-09-15", total: 60_000, delta: -10_000 },
];

function compute(input: Array<{ total: number; delta: number; date: string }>): WinStreakResult {
  return computeWinStreaks(input, TODAY);
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("WinStreakChip", () => {
  it("renders 🔥 xN with the current streak count", () => {
    const winStreaks = compute(STREAK_3_RUN);
    render(
      <WinStreakChip
        todayKey={TODAY}
        seriesLoading={false}
        winStreaks={winStreaks}
      />,
    );

    const chip = screen.getByTestId("winstreak-chip");
    expect(chip).toHaveTextContent("🔥");
    expect(screen.getByTestId("winstreak-count")).toHaveTextContent("3");
  });

  it("shows shimmer when seriesLoading is true", () => {
    const winStreaks = compute(STREAK_3_RUN);
    render(
      <WinStreakChip
        todayKey={TODAY}
        seriesLoading={true}
        winStreaks={winStreaks}
      />,
    );

    expect(screen.getByTestId("winstreak-chip-shimmer")).toBeInTheDocument();
    expect(screen.queryByTestId("winstreak-count")).not.toBeInTheDocument();
  });

  it("renders nothing when winStreaks is null", () => {
    const { container } = render(
      <WinStreakChip
        todayKey={TODAY}
        seriesLoading={false}
        winStreaks={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("winstreak-chip")).not.toBeInTheDocument();
  });

  it("opens dialog on click and shows current + longest records", async () => {
    const user = userEvent.setup();
    const winStreaks = compute(STREAK_3_RUN);
    render(
      <WinStreakChip
        todayKey={TODAY}
        seriesLoading={false}
        winStreaks={winStreaks}
      />,
    );

    await user.click(screen.getByTestId("winstreak-chip"));

    const dialog = await screen.findByTestId("winstreak-dialog");
    expect(dialog).toBeInTheDocument();
    // Dialog shows the title.
    expect(screen.getByText("Winstreak")).toBeInTheDocument();
    // Current run = 3 days ending today (live).
    expect(screen.getByText("Hari ini berjalan")).toBeInTheDocument();
    // Longest run.
    expect(screen.getAllByText("Rekor terlama")[0]).toBeInTheDocument();
  });

  it("closes dialog via Escape", async () => {
    const user = userEvent.setup();
    const winStreaks = compute(STREAK_3_RUN);
    render(
      <WinStreakChip
        todayKey={TODAY}
        seriesLoading={false}
        winStreaks={winStreaks}
      />,
    );

    await user.click(screen.getByTestId("winstreak-chip"));
    await screen.findByTestId("winstreak-dialog");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("winstreak-dialog")).not.toBeInTheDocument();
    });
  });

  it("today over → current null, chip shows 'streak putus' without 🔥", async () => {
    const user = userEvent.setup();
    const winStreaks = compute(STREAK_WITH_OVER_TODAY);
    render(
      <WinStreakChip
        todayKey={TODAY}
        seriesLoading={false}
        winStreaks={winStreaks}
      />,
    );

    // Streak broken: chip shows "streak putus" without 🔥 icon
    expect(screen.getByTestId("winstreak-count")).toHaveTextContent("streak putus");
    const chip = screen.getByTestId("winstreak-chip");
    expect(chip.querySelector("span[aria-hidden='true']")).toBeNull();

    await user.click(screen.getByTestId("winstreak-chip"));
    await screen.findByTestId("winstreak-dialog");

    // No live badge since today is over.
    await waitFor(() => {
      expect(screen.queryByTestId("winstreak-live-badge")).not.toBeInTheDocument();
    });
  });
});

describe("WinStreakCard", () => {
  it("renders current streak + saving with live badge", () => {
    const winStreaks = compute(STREAK_3_RUN);
    render(<WinStreakCard todayKey={TODAY} winStreaks={winStreaks} />);

    expect(screen.getByTestId("winstreak-card")).toBeInTheDocument();
    expect(screen.getByTestId("winstreak-card-current")).toHaveTextContent("3 hari");
    expect(screen.getByTestId("winstreak-card-saving")).toHaveTextContent("Hemat Rp60.000");
    expect(screen.getByTestId("winstreak-card-live-badge")).toBeInTheDocument();
  });

  it("renders 'Hari ini melewati batas' when current is null", () => {
    const winStreaks = compute(STREAK_WITH_OVER_TODAY);
    render(<WinStreakCard todayKey={TODAY} winStreaks={winStreaks} />);

    expect(screen.getByTestId("winstreak-card-current")).toHaveTextContent(
      "Hari ini melewati batas",
    );
    expect(screen.getByTestId("winstreak-card-saving")).toHaveTextContent("");
    expect(screen.queryByTestId("winstreak-card-live-badge")).not.toBeInTheDocument();
  });

  it("opens dialog via 'Lihat detail' link", async () => {
    const user = userEvent.setup();
    const winStreaks = compute(STREAK_3_RUN);
    render(<WinStreakCard todayKey={TODAY} winStreaks={winStreaks} />);

    await user.click(screen.getByTestId("winstreak-card-open"));

    const dialog = await screen.findByTestId("winstreak-dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Winstreak")).toBeInTheDocument();
  });
});
