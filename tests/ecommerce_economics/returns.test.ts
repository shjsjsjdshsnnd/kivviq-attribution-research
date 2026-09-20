import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import type { RealizedPurchase } from "../../src/simulation/types.js";
import {
  productEconomicProfileMap,
} from "../../src/ecommerce_economics/products.js";
import { simulateReturnEconomics } from "../../src/ecommerce_economics/returns.js";
import {
  applyReturnsToOrder,
  buildOrderEconomics,
} from "../../src/ecommerce_economics/waterfall.js";

describe("Step 7 returns/refunds", () => {
  it("supports delayed partial line returns and explicit return costs", () => {
    const world = generateMerchantWorldRecord({
      seed: 102001,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "normal",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 112001,
      populationConfig: { maxExplicitAgents: 50 },
    });

    const product = world.manifest.productDemandMechanisms[0]!;
    const baseProfiles = productEconomicProfileMap(world);
    const original = baseProfiles.get(product.productId)!;
    const customProfiles = new Map(baseProfiles);
    customProfiles.set(product.productId, {
      ...original,
      returnProbability: 0.5,
      returnShippingCostMinor: 400,
      returnHandlingCostMinor: 200,
      restockingCostMinor: 100,
      nonRecoverableValueRate: 0.1,
    });

    const purchase: RealizedPurchase = {
      orderId: "order-return-test",
      customerId: population.customers[0]!.customerId,
      sessionId: "session-return-test",
      occurredAt: "2026-01-05T12:00:00.000Z",
      source: "direct",
      lines: [
        {
          productId: product.productId,
          quantity: 3,
          unitPriceMinor: 10_000,
          discountMinor: 0,
          revenueMinor: 30_000,
          estimatedCogsMinor: 12_000,
          fulfillmentMinor: 1_500,
        },
      ],
      grossRevenueMinor: 30_000,
      discountMinor: 0,
      netRevenueMinor: 30_000,
      paymentFeeMinor: 900,
      shippingSubsidyMinor: 500,
      fulfillmentMinor: 1_500,
      estimatedCogsMinor: 12_000,
      allocatedMarketingSpendMinor: 0,
      contributionProfitMinor: 15_100,
      repeatPurchase: false,
    };

    let partial:
      | ReturnType<typeof simulateReturnEconomics>[number]
      | undefined;

    for (let seed = 1; seed <= 200; seed += 1) {
      const returns = simulateReturnEconomics(
        world,
        population,
        [purchase],
        "2026-04-01T00:00:00.000Z",
        seed,
        customProfiles,
      );
      const candidate = returns.find(
        (entry) =>
          entry.lines[0]?.quantity === 1 ||
          entry.lines[0]?.quantity === 2,
      );
      if (candidate) {
        partial = candidate;
        break;
      }
    }

    expect(partial).toBeDefined();
    expect(Date.parse(partial!.occurredAt)).toBeGreaterThan(
      Date.parse(purchase.occurredAt),
    );
    expect(partial!.lines[0]!.quantity).toBeLessThan(3);
    expect(partial!.incrementalReturnCostsMinor).toBeGreaterThan(0);
    expect(partial!.recoveredCogsMinor).toBeGreaterThan(0);
    expect(partial!.contributionProfitImpactMinor).toBeLessThan(0);

    const order = buildOrderEconomics(
      world,
      purchase,
      {},
      customProfiles,
    );
    const adjusted = applyReturnsToOrder(order, [partial!]);

    expect(adjusted.realizedRefundsMinor).toBe(
      partial!.refundedRevenueMinor,
    );
    expect(adjusted.netRevenueMinor).toBeLessThan(
      order.netRevenueMinor,
    );
    expect(adjusted.cogsMinor).toBeLessThan(order.cogsMinor);
    expect(
      adjusted.contributionProfitBeforeAdvertisingMinor,
    ).toBeLessThan(
      order.contributionProfitBeforeAdvertisingMinor,
    );
  });

  it("does not realize returns after the reporting-period cutoff", () => {
    const world = generateMerchantWorldRecord({
      seed: 102002,
      archetype: "fashion_apparel",
      scale: "small",
      complexity: "normal",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 112002,
      populationConfig: { maxExplicitAgents: 30 },
    });
    const product = world.manifest.productDemandMechanisms[0]!;
    const profiles = productEconomicProfileMap(world);
    const original = profiles.get(product.productId)!;
    const custom = new Map(profiles);
    custom.set(product.productId, {
      ...original,
      returnProbability: 1,
    });

    const purchase: RealizedPurchase = {
      orderId: "late-return",
      customerId: population.customers[0]!.customerId,
      sessionId: "late-session",
      occurredAt: "2026-01-31T23:59:00.000Z",
      source: "direct",
      lines: [{
        productId: product.productId,
        quantity: 1,
        unitPriceMinor: 5_000,
        discountMinor: 0,
        revenueMinor: 5_000,
        estimatedCogsMinor: 2_000,
        fulfillmentMinor: 200,
      }],
      grossRevenueMinor: 5_000,
      discountMinor: 0,
      netRevenueMinor: 5_000,
      paymentFeeMinor: 150,
      shippingSubsidyMinor: 100,
      fulfillmentMinor: 200,
      estimatedCogsMinor: 2_000,
      allocatedMarketingSpendMinor: 0,
      contributionProfitMinor: 2_550,
      repeatPurchase: false,
    };

    const returns = simulateReturnEconomics(
      world,
      population,
      [purchase],
      "2026-02-01T00:00:00.000Z",
      7,
      custom,
    );

    expect(returns).toHaveLength(0);
  });
});
