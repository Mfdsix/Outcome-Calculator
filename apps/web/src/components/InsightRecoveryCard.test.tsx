import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { recoveryPlan } from "@expense-app/shared";

import { InsightRecoveryCard } from "./InsightRecoveryCard";

function plan(overrides: Partial<Parameters<typeof recoveryPlan>[0]> = {}) {
  return recoveryPlan({
    type: "daily",
    amount: 70_000,
    startDate: "2026-11-01",
    endDate: "2026-11-25",
    todayKey: "2026-11-15",
    // 15 elapsed days × 70.000 = 1.050.000 allowance → 30.000 deficit.
    spentToDate: 1_080_000,
    ...overrides,
  });
}

function slideTo(days: number): void {
  fireEvent.change(screen.getByTestId("insight-recovery-slider"), {
    target: { value: String(days) },
  });
}

describe("InsightRecoveryCard", () => {
  it("shows the cumulative deficit and the horizon slider", () => {
    render(<InsightRecoveryCard plan={plan()} />);

    expect(screen.getByTestId("insight-recovery")).toBeInTheDocument();
    expect(screen.getByTestId("insight-recovery-deficit")).toHaveTextContent("lewat Rp30.000");
    expect(screen.getByTestId("insight-recovery-deficit")).toHaveTextContent("Rp1.050.000");
    expect(screen.getByTestId("insight-recovery-progress")).toHaveTextContent("Rp1.080.000");
    expect(screen.getByTestId("insight-recovery-progress")).toHaveTextContent("15 hari berjalan");

    const slider = screen.getByTestId("insight-recovery-slider");
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "10"); // today → end date
    expect(screen.getByTestId("insight-recovery-max")).toHaveTextContent("25 Nov");
  });

  it("defaults to the whole remaining period", () => {
    render(<InsightRecoveryCard plan={plan()} />);

    expect(screen.getByTestId("insight-recovery-slider")).toHaveValue("10");
    expect(screen.getByTestId("insight-recovery-days")).toHaveTextContent("10 hari");
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp3.000/hari");
    expect(screen.getByTestId("insight-recovery-target")).toHaveTextContent("Rp67.000/hari");
    expect(screen.getByTestId("insight-recovery-end")).toHaveTextContent("25 Nov");
  });

  it("recomputes the numbers as the slider moves", () => {
    render(<InsightRecoveryCard plan={plan()} />);

    slideTo(5);
    expect(screen.getByTestId("insight-recovery-days")).toHaveTextContent("5 hari");
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp6.000/hari");
    expect(screen.getByTestId("insight-recovery-target")).toHaveTextContent("Rp64.000/hari");
    expect(screen.getByTestId("insight-recovery-end")).toHaveTextContent("20 Nov");

    slideTo(7);
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp5.000/hari");
    expect(screen.getByTestId("insight-recovery-target")).toHaveTextContent("Rp65.000/hari");
    expect(screen.getByTestId("insight-recovery-end")).toHaveTextContent("22 Nov");

    slideTo(1);
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp30.000/hari");
    expect(screen.getByTestId("insight-recovery-target")).toHaveTextContent("Rp40.000/hari");
  });

  it("exposes the horizon and the saving to assistive tech", () => {
    render(<InsightRecoveryCard plan={plan()} />);

    slideTo(5);
    expect(screen.getByTestId("insight-recovery-slider")).toHaveAttribute(
      "aria-valuetext",
      "5 hari, hemat Rp6.000 per hari",
    );
  });

  it("renders nothing when the running total is still within the cap", () => {
    render(<InsightRecoveryCard plan={plan({ spentToDate: 900_000 })} />);
    expect(screen.queryByTestId("insight-recovery")).not.toBeInTheDocument();
  });

  it("renders nothing for full budgets", () => {
    render(<InsightRecoveryCard plan={plan({ type: "full", amount: 3_000_000, spentToDate: 4_000_000 })} />);
    expect(screen.queryByTestId("insight-recovery")).not.toBeInTheDocument();
  });

  it("explains an unreachable horizon", () => {
    render(<InsightRecoveryCard plan={plan({ amount: 10_000, spentToDate: 240_000 })} />);

    slideTo(5); // needs Rp18.000/day against a Rp10.000 cap
    expect(screen.queryByTestId("insight-recovery-savings")).not.toBeInTheDocument();
    expect(screen.getByTestId("insight-recovery-unreachable")).toHaveTextContent("9 hari");
    expect(screen.getByTestId("insight-recovery-unreachable")).toHaveTextContent("tanpa pengeluaran");

    slideTo(10); // Rp9.000/day fits
    expect(screen.getByTestId("insight-recovery-savings")).toHaveTextContent("Rp9.000/hari");
  });

  it("offers no slider on the last day of the period", () => {
    render(<InsightRecoveryCard plan={plan({ endDate: "2026-11-15" })} />);

    expect(screen.getByTestId("insight-recovery-lastday")).toHaveTextContent("Hari terakhir");
    expect(screen.queryByTestId("insight-recovery-slider")).not.toBeInTheDocument();
    expect(screen.queryByTestId("insight-recovery-savings")).not.toBeInTheDocument();
  });
});
