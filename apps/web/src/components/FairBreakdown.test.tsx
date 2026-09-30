import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { FairBreakdown } from "@expense-app/shared";

import { FairInfoButton } from "./FairBreakdown";

const SAMPLE_BREAKDOWN: FairBreakdown = {
  fairTotal: 160_000,
  rows: [
    {
      id: "e2",
      occurredAt: "2026-09-17T09:00:00+07:00",
      allocationType: "WEEKLY",
      perDayAmount: 100_000,
    },
    {
      id: "e3",
      occurredAt: "2026-09-17T08:00:00+07:00",
      allocationType: "MONTHLY",
      perDayAmount: 10_000,
    },
  ],
};

const EMPTY_BREAKDOWN: FairBreakdown = {
  fairTotal: 0,
  rows: [],
};

afterEach(() => {
  // Restore body overflow if any dialog set it.
  document.body.style.overflow = "";
});

describe("FairInfoButton + FairBreakdownDialog", () => {
  it("renders nothing when show is false", () => {
    const { container } = render(
      <FairInfoButton label="Rincian fair — Hari ini" breakdown={SAMPLE_BREAKDOWN} show={false} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("fair-info")).not.toBeInTheDocument();
  });

  it("renders the [?] info button when show is true", () => {
    render(<FairInfoButton label="Hari ini" breakdown={SAMPLE_BREAKDOWN} show={true} />);
    expect(screen.getByTestId("fair-info")).toBeInTheDocument();
  });

  it("opens the breakdown dialog on click", async () => {
    const user = userEvent.setup();
    render(<FairInfoButton label="Rincian fair — 17 Sep" breakdown={SAMPLE_BREAKDOWN} show={true} />);

    await user.click(screen.getByTestId("fair-info"));

    const dialog = await screen.findByTestId("fair-breakdown");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Rincian fair — 17 Sep")).toBeInTheDocument();
    expect(screen.getByTestId("fair-breakdown-total")).toHaveTextContent("Total fair:");
    expect(screen.getByTestId("fair-breakdown-total")).toHaveTextContent("Rp160.000");
    expect(screen.getAllByTestId(/fair-breakdown-row-/)).toHaveLength(2);
    expect(screen.getByTestId("fair-breakdown-row-e2")).toBeInTheDocument();
    expect(screen.getByTestId("fair-breakdown-row-e3")).toBeInTheDocument();
    expect(screen.getByTestId("fair-breakdown-row-e2")).toHaveTextContent("Rp100.000");
    expect(screen.getByTestId("fair-breakdown-row-e3")).toHaveTextContent("Rp10.000");
  });

  it("closes the dialog via the Tutup button", async () => {
    const user = userEvent.setup();
    render(<FairInfoButton label="Hari ini" breakdown={SAMPLE_BREAKDOWN} show={true} />);

    await user.click(screen.getByTestId("fair-info"));
    await screen.findByTestId("fair-breakdown");

    await user.click(screen.getByTestId("fair-breakdown-close"));

    await waitFor(() => {
      expect(screen.queryByTestId("fair-breakdown")).not.toBeInTheDocument();
    });
  });

  it("closes the dialog via Escape", async () => {
    const user = userEvent.setup();
    render(<FairInfoButton label="Hari ini" breakdown={SAMPLE_BREAKDOWN} show={true} />);

    await user.click(screen.getByTestId("fair-info"));
    await screen.findByTestId("fair-breakdown");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByTestId("fair-breakdown")).not.toBeInTheDocument();
    });
  });

  it("closes the dialog via backdrop click", async () => {
    const user = userEvent.setup();
    render(<FairInfoButton label="Hari ini" breakdown={SAMPLE_BREAKDOWN} show={true} />);

    await user.click(screen.getByTestId("fair-info"));
    const dialog = await screen.findByTestId("fair-breakdown");

    await user.click(dialog);

    await waitFor(() => {
      expect(screen.queryByTestId("fair-breakdown")).not.toBeInTheDocument();
    });
  });

  it("shows empty-state message when no contributors", async () => {
    const user = userEvent.setup();
    render(<FairInfoButton label="Hari ini" breakdown={EMPTY_BREAKDOWN} show={true} />);

    await user.click(screen.getByTestId("fair-info"));
    const dialog = await screen.findByTestId("fair-breakdown");

    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId("fair-breakdown-total")).toHaveTextContent("Total fair:");
    expect(screen.queryByTestId(/fair-breakdown-row-/)).not.toBeInTheDocument();
    expect(screen.getByText("Tidak ada alokasi yang kena hari ini.")).toBeInTheDocument();
  });
});
