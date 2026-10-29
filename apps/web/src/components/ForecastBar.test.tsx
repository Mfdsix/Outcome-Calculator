import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetForecast } from "@expense-app/shared";

import { ForecastBar } from "./ForecastBar";

function forecast(overrides: Partial<BudgetForecast> = {}): BudgetForecast {
  return {
    available: true,
    avgPerDay: 90_000,
    elapsedDays: 10,
    remainingDays: 20,
    projectedTotal: 2_700_000,
    projectedDelta: 300_000,
    allowedPerDay: 105_000,
    overDays: null,
    totalDays: 30,
    ...overrides,
  };
}

describe("ForecastBar — full", () => {
  it("shows the projected total, the delta and the per-day allowance", () => {
    render(<ForecastBar type="full" amount={3_000_000} forecast={forecast()} />);

    expect(screen.getByTestId("budget-forecast-total")).toHaveTextContent("Rp2.700.000");
    expect(screen.getByTestId("budget-forecast-delta")).toHaveTextContent("under Rp300.000");
    expect(screen.getByTestId("budget-forecast-allowed")).toHaveTextContent(
      "sisa 20 hari · boleh Rp105.000/hari",
    );
  });

  it("flags an over projection in red", () => {
    render(
      <ForecastBar
        type="full"
        amount={1_000_000}
        forecast={forecast({ projectedTotal: 3_600_000, projectedDelta: -2_600_000 })}
      />,
    );

    expect(screen.getByTestId("budget-forecast-delta")).toHaveTextContent("over Rp2.600.000");
    expect(screen.getByTestId("budget-forecast-total").className).toContain("text-red-300");
  });

  it("hides the allowance row on the last day (remainingDays = 0)", () => {
    render(
      <ForecastBar
        type="full"
        amount={100_000}
        forecast={forecast({ remainingDays: 0, allowedPerDay: null, projectedTotal: 50_000, projectedDelta: 50_000 })}
      />,
    );

    expect(screen.getByTestId("budget-forecast-total")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-forecast-allowed")).not.toBeInTheDocument();
  });

  it("renders nothing when unavailable", () => {
    render(
      <ForecastBar
        type="full"
        amount={1_000_000}
        forecast={forecast({ available: false, projectedTotal: null, projectedDelta: null, allowedPerDay: null })}
      />,
    );

    expect(screen.queryByTestId("budget-forecast")).not.toBeInTheDocument();
  });
});

describe("ForecastBar — daily", () => {
  it("shows the average pace and the over-day count", () => {
    render(
      <ForecastBar
        type="daily"
        amount={150_000}
        forecast={forecast({
          projectedTotal: null,
          projectedDelta: null,
          allowedPerDay: 100_000,
          overDays: 3,
          elapsedDays: 21,
          totalDays: 30,
        })}
      />,
    );

    expect(screen.getByTestId("budget-forecast-avg")).toHaveTextContent("Rata-rata Rp90.000/hari");
    expect(screen.getByTestId("budget-forecast-days-over")).toHaveTextContent("3 dari 21 hari over");
  });
});
