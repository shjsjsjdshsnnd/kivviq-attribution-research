import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";
import {
  evaluateChannelContributionEconomics,
  evaluateEconomicCounterfactual,
} from "../../src/ecommerce_economics/counterfactual.js";
import { isPaidMarketingChannel } from "../../src/advertising_economics/types.js";

function fixture() {
  const world = generateMerchantWorldRecord({
    seed: 104001,
    archetype: "beauty_cosmetics",
    scale: "growth",
    complexity: "complex",
    purchaseFrequency: "repeat",
  });
  const population = generateCustomerPopulation({
    merchantWorld: world,
    populationSeed: 114001,
    populationConfig: { maxExplicitAgents: 100 },
  });
  return {
    merchantWorld: world,
    latentPopulation: population,
    simulationSeed: 124001,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-05-01T00:00:00.000Z",
    simulationConfig: { maxEvents: 180_000 },
  } as const;
}

describe("Step 7 decomposition and counterfactual economics", () => {
  it(
    "decomposes realized economics by product/category/customer type without causal channel claims",
    () => {
      const request = fixture();
      const report = evaluateEcommerceEconomics(request);

      expect(report.byProduct.length).toBeGreaterThan(0);
      expect(report.byCategory.length).toBeGreaterThan(0);
      expect(report.byCustomerType.length).toBeGreaterThan(0);

      const productRevenue = report.byProduct.reduce(
        (sum, row) => sum + row.netRevenueMinor,
        0,
      );
      const categoryRevenue = report.byCategory.reduce(
        (sum, row) => sum + row.netRevenueMinor,
        0,
      );

      expect(productRevenue).toBeCloseTo(
        report.waterfall.netRevenueMinor,
        -1,
      );
      expect(categoryRevenue).toBeCloseTo(
        report.waterfall.netRevenueMinor,
        -1,
      );

      expect(
        report.byCustomerType.every(
          (row) => row.key === "new" || row.key === "repeat",
        ),
      ).toBe(true);
    },
    60_000,
  );

  it(
    "economic counterfactual exposes explicit deltas for revenue profit customer contribution and future value",
    () => {
      const request = fixture();
      const result = evaluateEconomicCounterfactual(
        request,
        [
          {
            variable: "promotion.discount_active",
            operation: "set",
            value: {
              kind: "boolean",
              value: true,
            },
          },
        ],
      );

      expect(Number.isFinite(result.delta.grossRevenueMinor)).toBe(true);
      expect(Number.isFinite(result.delta.netRevenueMinor)).toBe(true);
      expect(Number.isFinite(result.delta.grossProfitMinor)).toBe(true);
      expect(Number.isFinite(result.delta.contributionProfitMinor)).toBe(true);
      expect(Number.isFinite(result.delta.newCustomerContributionMinor)).toBe(true);
      expect(Number.isFinite(result.delta.repeatContributionMinor)).toBe(true);
      expect(Number.isFinite(result.delta.expectedFutureValueMinor)).toBe(true);
    },
    60_000,
  );

  it(
    "channel contribution economics come from shared-randomness interventions rather than attribution",
    () => {
      const request = fixture();
      const channel = request.merchantWorld.summary.activeChannels.find(
        isPaidMarketingChannel,
      )!;
      const result = evaluateChannelContributionEconomics(
        request,
        channel,
        { marginalBlockMinor: 25_000 },
      );

      expect(result.channel).toBe(channel);
      expect(
        Number.isFinite(result.incrementalGrossRevenueMinor),
      ).toBe(true);
      expect(
        Number.isFinite(result.incrementalNetRevenueMinor),
      ).toBe(true);
      expect(
        Number.isFinite(result.incrementalGrossProfitMinor),
      ).toBe(true);
      expect(
        Number.isFinite(result.incrementalContributionProfitMinor),
      ).toBe(true);
    },
    90_000,
  );

  it("keeps realized and expected future value separate for new customers", () => {
    const report = evaluateEcommerceEconomics(fixture());

    expect(
      report.newCustomer.expectedTotalEconomicValueMinor,
    ).toBe(
      report.newCustomer
        .firstOrderContributionProfitBeforeAdvertisingMinor -
        report.newCustomer.acquisitionCostMinor +
        report.newCustomer.expectedFutureContributionMinor,
    );

    expect(
      report.waterfall.contributionProfitMinor,
    ).not.toBe(
      report.waterfall.contributionProfitMinor +
        report.newCustomer.expectedFutureContributionMinor,
    );
  });
});
