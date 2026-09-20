import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import type { RealizedPurchase } from "../../src/simulation/types.js";
import {
  buildProductEconomicProfiles,
  productEconomicProfileMap,
} from "../../src/ecommerce_economics/products.js";
import {
  aggregatePeriodWaterfall,
  buildOrderEconomics,
} from "../../src/ecommerce_economics/waterfall.js";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";

function world() {
  return generateMerchantWorldRecord({
    seed: 101001,
    archetype: "fashion_apparel",
    scale: "growth",
    complexity: "complex",
  });
}

describe("Step 7 canonical ecommerce waterfall", () => {
  it("reconciles every period exactly under the declared waterfall", () => {
    const merchant = world();
    const product =
      merchant.manifest.productDemandMechanisms[0]!;
    const purchase: RealizedPurchase = {
      orderId: "order-test-1",
      customerId: "customer_000000001",
      sessionId: "session-test",
      occurredAt: "2026-02-01T12:00:00.000Z",
      source: "direct",
      lines: [
        {
          productId: product.productId,
          quantity: 2,
          unitPriceMinor: 10_000,
          discountMinor: 2_000,
          revenueMinor: 18_000,
          estimatedCogsMinor: 9_000,
          fulfillmentMinor: 1_000,
        },
      ],
      grossRevenueMinor: 20_000,
      discountMinor: 2_000,
      netRevenueMinor: 18_000,
      paymentFeeMinor: 500,
      shippingSubsidyMinor: 600,
      fulfillmentMinor: 1_000,
      estimatedCogsMinor: 9_000,
      allocatedMarketingSpendMinor: 2_000,
      contributionProfitMinor: 4_900,
      repeatPurchase: false,
    };

    const order = buildOrderEconomics(
      merchant,
      purchase,
      {
        freeShippingThresholdMinor: 15_000,
        customerShippingChargeMinor: 995,
        paymentFeeRate: 0.03,
        paymentFeeFixedMinor: 30,
        variableOperatingCostPerOrderMinor: 150,
        variableOperatingCostRate: 0.01,
      },
    );

    const advertising = 5_000;
    const waterfall = aggregatePeriodWaterfall(
      merchant,
      [order],
      advertising,
    );

    expect(waterfall.revenueAfterDiscountsMinor).toBe(
      waterfall.grossMerchandiseRevenueMinor -
        waterfall.discountsMinor,
    );
    expect(waterfall.netRevenueMinor).toBe(
      waterfall.revenueAfterDiscountsMinor -
        waterfall.returnsRefundsMinor,
    );
    expect(waterfall.grossProfitMinor).toBe(
      waterfall.netRevenueMinor - waterfall.cogsMinor,
    );

    expect(waterfall.contributionProfitMinor).toBe(
      waterfall.netRevenueMinor -
        waterfall.cogsMinor -
        waterfall.paymentFeesMinor -
        waterfall.shippingSubsidyMinor -
        waterfall.fulfillmentCostMinor -
        waterfall.variableOperatingCostsMinor -
        waterfall.promotionalCostsMinor -
        waterfall.advertisingCostMinor,
    );

    expect(order.attributableAdvertisingCostMinor).toBeNull();
    expect(waterfall.advertisingCostMinor).toBe(advertising);
  });

  it("supports negative shipping subsidy when customer shipping revenue exceeds merchant cost", () => {
    const merchant = world();
    const product =
      merchant.manifest.productDemandMechanisms[0]!;
    const purchase: RealizedPurchase = {
      orderId: "order-test-2",
      customerId: "customer_000000001",
      sessionId: "session-test",
      occurredAt: "2026-02-01T12:00:00.000Z",
      source: "direct",
      lines: [
        {
          productId: product.productId,
          quantity: 1,
          unitPriceMinor: 2_000,
          discountMinor: 0,
          revenueMinor: 2_000,
          estimatedCogsMinor: 1_000,
          fulfillmentMinor: 100,
        },
      ],
      grossRevenueMinor: 2_000,
      discountMinor: 0,
      netRevenueMinor: 2_000,
      paymentFeeMinor: 50,
      shippingSubsidyMinor: 0,
      fulfillmentMinor: 100,
      estimatedCogsMinor: 1_000,
      allocatedMarketingSpendMinor: 0,
      contributionProfitMinor: 850,
      repeatPurchase: false,
    };

    const order = buildOrderEconomics(
      merchant,
      purchase,
      {
        freeShippingThresholdMinor: 50_000,
        customerShippingChargeMinor: 20_000,
      },
    );

    expect(order.shippingSubsidyMinor).toBeLessThan(0);
    expect(order.customerShippingRevenueMinor).toBe(20_000);
  });

  it("generates substantial product margin heterogeneity with COGS derived from margin", () => {
    const merchant = generateMerchantWorldRecord({
      seed: 101002,
      archetype: "specialty_retail",
      scale: "growth",
      complexity: "complex",
      catalogProfile: "large",
    });

    const profiles = buildProductEconomicProfiles(merchant);
    expect(profiles.length).toBeGreaterThan(20);

    const margins = profiles.map((profile) => profile.grossMarginRate);
    expect(Math.max(...margins) - Math.min(...margins)).toBeGreaterThan(0.2);

    for (const profile of profiles.slice(0, 50)) {
      const impliedCogs = Math.round(
        profile.listPriceMinor * (1 - profile.grossMarginRate),
      );
      expect(profile.cogsPerUnitMinor).toBe(impliedCogs);
    }
  });

  it(
    "merchant report reconciles represented-population economics and keeps future value separate",
    () => {
      const merchant = generateMerchantWorldRecord({
        seed: 101003,
        archetype: "beauty_cosmetics",
        scale: "growth",
        complexity: "normal",
      });
      const population = generateCustomerPopulation({
        merchantWorld: merchant,
        populationSeed: 111003,
        populationConfig: { maxExplicitAgents: 100 },
      });

      const report = evaluateEcommerceEconomics({
        merchantWorld: merchant,
        latentPopulation: population,
        simulationSeed: 121003,
        periodStart: "2026-01-01T00:00:00.000Z",
        periodEnd: "2026-05-01T00:00:00.000Z",
        simulationConfig: { maxEvents: 150_000 },
      });

      expect(report.waterfall.contributionProfitMinor).toBe(
        report.waterfall.netRevenueMinor -
          report.waterfall.cogsMinor -
          report.waterfall.paymentFeesMinor -
          report.waterfall.shippingSubsidyMinor -
          report.waterfall.fulfillmentCostMinor -
          report.waterfall.variableOperatingCostsMinor -
          report.waterfall.promotionalCostsMinor -
          report.waterfall.advertisingCostMinor,
      );

      expect(report.orders.length).toBe(report.simulation.purchases.length);
      expect(
        report.customerEconomics.every(
          (customer) =>
            customer.expectedTotalEconomicValueMinor ===
            customer.realizedContributionProfitBeforeAdvertisingMinor +
              customer.expectedFutureContributionMinor,
        ),
      ).toBe(true);

      expect(productEconomicProfileMap(merchant).size).toBe(
        merchant.summary.skuCount,
      );
    },
    60_000,
  );
});
