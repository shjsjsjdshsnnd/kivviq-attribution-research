import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import {
  buildAdvertisingPerformanceReport,
  evaluateSpendNeighborhood,
  evaluateSpendPair,
  referenceSpendMinor,
} from "../../src/advertising_economics/evaluator.js";
import {
  allocationSpendMinor,
  spendDeltaIntervention,
  spendMultiplierIntervention,
  validateBudgetConstraint,
} from "../../src/advertising_economics/oracle.js";
import { isPaidMarketingChannel } from "../../src/advertising_economics/types.js";

function fixture() {
  const world = generateMerchantWorldRecord({
    seed: 84001,
    archetype: "beauty_cosmetics",
    scale: "growth",
    complexity: "complex",
    marketingDependence: "paid_media_heavy",
  });
  const population = generateCustomerPopulation({
    merchantWorld: world,
    populationSeed: 4601,
    populationConfig: { maxExplicitAgents: 100 },
  });

  return {
    merchantWorld: world,
    latentPopulation: population,
    simulationSeed: 5601,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-04-01T00:00:00.000Z",
    simulationConfig: { maxEvents: 150_000 },
  } as const;
}

describe("advertising performance separation", () => {
  it("reports platform observed true and marginal metrics as distinct fields", () => {
    const request = fixture();
    const report = buildAdvertisingPerformanceReport({
      ...request,
      marginalBlockMinor: 25_000,
    });

    expect(report.rows.length).toBeGreaterThan(0);

    const row = report.rows[0]!;
    expect(row.platformRoas).not.toBeUndefined();
    expect(row.observedRoas).not.toBeUndefined();
    expect(row.trueIncrementalRoas).not.toBeUndefined();
    expect(row.marginalIncrementalRoas).not.toBeUndefined();

    const numeric = [
      row.platformRoas,
      row.observedRoas,
      row.trueIncrementalRoas,
      row.marginalIncrementalRoas,
    ].filter((value): value is number => value !== null);

    expect(new Set(numeric.map((value) => value.toFixed(6))).size).toBeGreaterThan(1);
  }, 90_000);

  it("measures true incremental ROAS from shared-randomness spend counterfactuals", () => {
    const request = fixture();
    const channel = request.merchantWorld.summary.activeChannels.find(
      isPaidMarketingChannel,
    )!;
    const reference = referenceSpendMinor(
      request.merchantWorld,
      channel,
    );

    const evaluated = evaluateSpendPair(
      request,
      channel,
      reference,
      Math.max(0, reference - 30_000),
    );

    expect(evaluated.performance.incrementalSpendMinor).toBeGreaterThan(0);
    expect(
      evaluated.performance.trueIncrementalRoas,
    ).not.toBeNull();
    expect(
      evaluated.pair.high.provenance.simulationSeed,
    ).toBe(evaluated.pair.low.provenance.simulationSeed);
    expect(
      evaluated.pair.high.provenance.sharedRandomness,
    ).toBe(true);
  }, 60_000);

  it("handles zero incremental-spend denominators explicitly", () => {
    const request = fixture();
    const channel = request.merchantWorld.summary.activeChannels.find(
      isPaidMarketingChannel,
    )!;
    const reference = referenceSpendMinor(
      request.merchantWorld,
      channel,
    );

    const evaluated = evaluateSpendPair(
      request,
      channel,
      reference,
      reference,
    );

    expect(evaluated.performance.incrementalSpendMinor).toBe(0);
    expect(evaluated.performance.trueIncrementalRoas).toBeNull();
  }, 60_000);

  it(
    "evaluates forward and backward marginal spend around the current point",
    () => {
      const request = fixture();
      const channel = request.merchantWorld.summary.activeChannels.find(
        isPaidMarketingChannel,
      )!;

      const neighborhood = evaluateSpendNeighborhood(
        request,
        channel,
        25_000,
      );

      expect(neighborhood.belowSpendMinor).toBeLessThan(
        neighborhood.referenceSpendMinor,
      );
      expect(neighborhood.aboveSpendMinor).toBeGreaterThan(
        neighborhood.referenceSpendMinor,
      );
      expect(
        neighborhood.backward.incrementalSpendMinor,
      ).toBeGreaterThan(0);
      expect(
        neighborhood.forward.incrementalSpendMinor,
      ).toBeGreaterThan(0);
    },
    90_000,
  );

  it("supports finite budgets and resolves delta/multiplier requests into set interventions", () => {
    const request = fixture();
    const channels = request.merchantWorld.summary.activeChannels.filter(
      isPaidMarketingChannel,
    );
    const channel = channels[0]!;
    const current = referenceSpendMinor(
      request.merchantWorld,
      channel,
    );

    const allocation = {
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      spendMinorByChannel: {
        [channel]: current,
      },
    };

    expect(allocationSpendMinor(allocation)).toBe(current);
    expect(() =>
      validateBudgetConstraint(allocation, current),
    ).not.toThrow();
    expect(() =>
      validateBudgetConstraint(allocation, current - 1),
    ).toThrow(/exceeds budget/);

    const plus = spendDeltaIntervention(
      request,
      channel,
      10_000,
    );
    expect(
      plus.value.kind === "number" ? plus.value.value : -1,
    ).toBe(current + 10_000);

    const double = spendMultiplierIntervention(
      request,
      channel,
      2,
    );
    expect(
      double.value.kind === "number" ? double.value.value : -1,
    ).toBe(current * 2);
    expect(plus.operation).toBe("set");
    expect(double.operation).toBe("set");
  });
});
