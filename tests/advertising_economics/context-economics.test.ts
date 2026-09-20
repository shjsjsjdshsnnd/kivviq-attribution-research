import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import { moneyMinor, positive } from "../../src/core/units.js";
import {
  buildAnalyticChannelEconomicCurve,
} from "../../src/advertising_economics/response.js";
import {
  evaluateAverageTruePerformance,
  referenceSpendMinor,
} from "../../src/advertising_economics/evaluator.js";
import { isPaidMarketingChannel } from "../../src/advertising_economics/types.js";

describe("advertising state and contribution economics", () => {
  it(
    "inventory constraints can collapse true advertising value to zero",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 87001,
        archetype: "home_furnishings_decor",
        scale: "growth",
        complexity: "complex",
        marketingDependence: "paid_media_heavy",
      });
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 97001,
        populationConfig: { maxExplicitAgents: 100 },
      });
      const channel = world.summary.activeChannels.find(
        isPaidMarketingChannel,
      )!;

      const performance = evaluateAverageTruePerformance(
        {
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: 107001,
          periodStart: "2026-01-01T00:00:00.000Z",
          periodEnd: "2026-04-01T00:00:00.000Z",
          spendMinorByChannel: {
            [channel]: referenceSpendMinor(world, channel),
          },
          contextInterventions: [
            {
              variable: "inventory.available",
              operation: "set",
              value: {
                kind: "number",
                value: 0,
                unit: "units",
              },
            },
          ],
          simulationConfig: { maxEvents: 150_000 },
        },
        channel,
      );

      expect(performance.incrementalRevenueMinor).toBe(0);
      expect(performance.incrementalGrossProfitMinor).toBe(0);
      expect(
        performance.incrementalContributionProfitMinor,
      ).toBeLessThanOrEqual(0);
    },
    60_000,
  );

  it("can show positive revenue ROAS with negative incremental contribution economics", () => {
    const raw = generateMerchantWorldRecord({
      seed: 87002,
      archetype: "commodity_value_retail",
      scale: "growth",
      complexity: "normal",
      marketingDependence: "paid_media_heavy",
      overrides: {
        forceZeroIncrementalityChannels: ["google_search"],
      },
    });

    const world = structuredClone(raw);
    const mechanism = (world.manifest.channelIncrementality as any[]).find(
      (item) => item.channelId === "google_search",
    );
    mechanism.effect.value = 25;
    const index = (world.manifest.responseCurves as any[]).findIndex(
      (curve) => curve.id === mechanism.responseCurveId,
    );
    (world.manifest.responseCurves as any[])[index] = {
      id: mechanism.responseCurveId,
      kind: "hill",
      inputUnit: "money_minor",
      outputUnit: "orders",
      maxIncrementalOutcome: positive(55),
      halfSaturationSpend: moneyMinor(220_000),
      hillCoefficient: positive(1.05),
    };
    validateGroundTruthManifest(world.manifest);

    const economics = buildAnalyticChannelEconomicCurve(
      world,
      "google_search",
      {
        maxSpendMinor: 800_000,
        stepMinor: 20_000,
        marginalBlockMinor: 20_000,
      },
    );

    const trap = economics.points.find(
      (point) =>
        point.averageIncrementalRoas !== null &&
        point.averageIncrementalRoas > 1 &&
        point.expectedIncrementalContributionProfitMinor < 0,
    );

    expect(trap).toBeDefined();
  });

  it(
    "promotion state can materially change the true channel response",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 87003,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "complex",
        marketingDependence: "paid_media_heavy",
      });
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 97003,
        populationConfig: { maxExplicitAgents: 110 },
      });
      const channel = world.summary.activeChannels.find(
        isPaidMarketingChannel,
      )!;
      const spend = referenceSpendMinor(world, channel);

      const base = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 107003,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-04-01T00:00:00.000Z",
        spendMinorByChannel: { [channel]: spend },
        simulationConfig: { maxEvents: 160_000 },
      } as const;

      const on = evaluateAverageTruePerformance(
        {
          ...base,
          contextInterventions: [
            {
              variable: "promotion.discount_active",
              operation: "set",
              value: {
                kind: "boolean",
                value: true,
              },
            },
          ],
        },
        channel,
      );

      const off = evaluateAverageTruePerformance(
        {
          ...base,
          contextInterventions: [
            {
              variable: "promotion.discount_active",
              operation: "set",
              value: {
                kind: "boolean",
                value: false,
              },
            },
          ],
        },
        channel,
      );

      expect(
        on.incrementalRevenueMinor,
      ).not.toBe(off.incrementalRevenueMinor);
    },
    90_000,
  );
});
