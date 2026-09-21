import { describe, expect, it } from "vitest";
import {
  createInventoryAdvertisingScaleTrapFixture,
} from "../../src/inventory_dynamics/adversarial.js";
import {
  estimateTrueStockoutProbability,
  evaluateInventoryDynamics,
  evaluateLostSalesCounterfactual,
} from "../../src/inventory_dynamics/evaluator.js";

describe("Step 9 evaluator diagnostics", () => {
  it(
    "keeps named cover bases, valuation and lost-sales counterfactuals separate",
    () => {
      const fixture =
        createInventoryAdvertisingScaleTrapFixture();
      const report =
        evaluateInventoryDynamics(
          fixture.evaluation,
        );

      expect(report.godModeOnly).toBe(true);
      expect(report.rows.length).toBeGreaterThan(0);
      expect(
        report.reconciliation.every(
          (row) => row.reconcilesExactly,
        ),
      ).toBe(true);
      expect(
        report.rows.every(
          (row) =>
            row.daysOfCover.map(
              (cover) => cover.demandBasis,
            ).join("|") ===
            "baseline_unconstrained_latent|observed_fulfilled|forecast_blend",
        ),
      ).toBe(true);

      const counterfactual =
        evaluateLostSalesCounterfactual(
          fixture.evaluation,
        );
      expect(counterfactual.latentLostUnits).toBeGreaterThanOrEqual(0);
      expect(
        counterfactual.substitutedUnits,
      ).toBeGreaterThanOrEqual(0);
    },
    120_000,
  );

  it(
    "computes true simulated stockout probability only in evaluator god mode",
    () => {
      const fixture =
        createInventoryAdvertisingScaleTrapFixture();
      const probability =
        estimateTrueStockoutProbability(
          fixture.evaluation,
          fixture.productId,
          [199002, 199003, 199004],
        );

      expect(probability.simulationCount).toBe(3);
      expect(
        probability.trueSimulatedStockoutProbability,
      ).toBeGreaterThanOrEqual(0);
      expect(
        probability.trueSimulatedStockoutProbability,
      ).toBeLessThanOrEqual(1);
    },
    120_000,
  );
});
