import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import {
  evaluateEconomicCounterfactual,
  evaluatePolicyCounterfactual,
} from "../../src/ecommerce_economics/counterfactual.js";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";
import {
  createDiscountTrapFixture,
} from "../../src/ecommerce_economics/adversarial.js";

function representedUnits(
  report: ReturnType<typeof evaluateEcommerceEconomics>,
): number {
  const weights = new Map(
    report.simulation.godMode.customerFinalStates.map(
      (state) => [state.customerId, 1] as const,
    ),
  );
  void weights;
  return report.orders.reduce(
    (sum, order) =>
      sum +
      order.lines.reduce(
        (lineSum, line) => lineSum + line.quantity,
        0,
      ),
    0,
  );
}

function revenueAfter(
  report: ReturnType<typeof evaluateEcommerceEconomics>,
  timestamp: string,
): number {
  const cutoff = Date.parse(timestamp);
  return report.orders
    .filter(
      (order) => Date.parse(order.occurredAt) >= cutoff,
    )
    .reduce(
      (sum, order) => sum + order.netRevenueMinor,
      0,
    );
}

describe("Step 7 behavioral ecommerce economics", () => {
  it(
    "free-shipping threshold changes behavior through checkout/basket mechanics",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 103001,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "normal",
      });
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 113001,
        populationConfig: { maxExplicitAgents: 100 },
      });

      let foundDifference = false;

      for (let seed = 1; seed <= 8; seed += 1) {
        const replay = evaluatePolicyCounterfactual(
          {
            merchantWorld: world,
            latentPopulation: population,
            simulationSeed: seed,
            periodStart: "2026-01-01T00:00:00.000Z",
            periodEnd: "2026-04-01T00:00:00.000Z",
            policy: {
              freeShippingThresholdMinor: 10_000,
              customerShippingChargeMinor: 1_500,
            },
            simulationConfig: { maxEvents: 160_000 },
          },
          {
            freeShippingThresholdMinor: 20_000,
            customerShippingChargeMinor: 1_500,
          },
        );

        if (
          replay.factual.orders.length !==
            replay.counterfactual.orders.length ||
          representedUnits(replay.factual) !==
            representedUnits(replay.counterfactual)
        ) {
          foundDifference = true;
          break;
        }
      }

      expect(foundDifference).toBe(true);
    },
    90_000,
  );

  it(
    "multi-item or multi-quantity baskets emerge from customer/product behavior",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 103002,
        archetype: "beauty_cosmetics",
        scale: "growth",
        complexity: "complex",
        purchaseFrequency: "repeat",
      });
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 113002,
        populationConfig: { maxExplicitAgents: 120 },
      });

      let found = false;
      for (let seed = 1; seed <= 5; seed += 1) {
        const report = evaluateEcommerceEconomics({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          periodStart: "2026-01-01T00:00:00.000Z",
          periodEnd: "2026-06-01T00:00:00.000Z",
          simulationConfig: { maxEvents: 220_000 },
        });
        if (
          report.orders.some(
            (order) =>
              order.lines.length > 1 ||
              order.lines.some((line) => line.quantity > 1),
          )
        ) {
          found = true;
          break;
        }
      }

      expect(found).toBe(true);
    },
    90_000,
  );

  it(
    "discount trap can raise orders/revenue while reducing contribution profit",
    () => {
      const fixture = createDiscountTrapFixture();

      const replay = evaluateEconomicCounterfactual(
        fixture.evaluation,
        [
          {
            variable: "promotion.discount_active",
            operation: "set",
            value: {
              kind: "boolean",
              value: false,
            },
          },
        ],
      );

      expect(replay.factual.simulation.totals.representedOrders).toBeGreaterThan(
        replay.counterfactual.simulation.totals.representedOrders,
      );
      expect(replay.factual.waterfall.netRevenueMinor).toBeGreaterThan(
        replay.counterfactual.waterfall.netRevenueMinor,
      );
      expect(
        replay.factual.waterfall.contributionProfitMinor,
      ).toBeLessThan(
        replay.counterfactual.waterfall.contributionProfitMinor,
      );

      console.info(
        "STEP7_DISCOUNT_TRAP",
        JSON.stringify({
          promotionOrders:
            replay.factual.simulation.totals.representedOrders,
          noPromotionOrders:
            replay.counterfactual.simulation.totals.representedOrders,
          promotionRevenueMinor:
            replay.factual.waterfall.netRevenueMinor,
          noPromotionRevenueMinor:
            replay.counterfactual.waterfall.netRevenueMinor,
          promotionContributionMinor:
            replay.factual.waterfall.contributionProfitMinor,
          noPromotionContributionMinor:
            replay.counterfactual.waterfall.contributionProfitMinor,
        }),
      );
    },
    90_000,
  );

  it(
    "promotion pull-forward can create a later demand dip under shared randomness",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 103003,
        archetype: "replenishment_heavy",
        scale: "growth",
        complexity: "complex",
        purchaseFrequency: "replenishment",
        promotionProfile: "promotion_sensitive",
      });
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 113003,
        populationConfig: { maxExplicitAgents: 140 },
      });
      const promotionStart =
        "2026-01-01T00:00:00.000Z";
      const promotionEnd =
        "2026-01-22T00:00:00.000Z";

      let demonstrated = false;

      for (let seed = 1; seed <= 8; seed += 1) {
        const promoted = evaluateEcommerceEconomics({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          periodStart: promotionStart,
          periodEnd: "2026-04-01T00:00:00.000Z",
          interventions: [
            {
              variable: "promotion.discount_active",
              operation: "set",
              value: { kind: "boolean", value: true },
              effectiveAt: promotionStart,
              durationSeconds: 21 * 86_400,
            },
          ],
          simulationConfig: { maxEvents: 220_000 },
        });

        const control = evaluateEcommerceEconomics({
          merchantWorld: world,
          latentPopulation: population,
          simulationSeed: seed,
          periodStart: promotionStart,
          periodEnd: "2026-04-01T00:00:00.000Z",
          interventions: [
            {
              variable: "promotion.discount_active",
              operation: "set",
              value: { kind: "boolean", value: false },
              effectiveAt: promotionStart,
              durationSeconds: 21 * 86_400,
            },
          ],
          simulationConfig: { maxEvents: 220_000 },
        });

        const promoWindowRevenue = promoted.orders
          .filter(
            (order) =>
              Date.parse(order.occurredAt) <
              Date.parse(promotionEnd),
          )
          .reduce((sum, order) => sum + order.netRevenueMinor, 0);
        const controlWindowRevenue = control.orders
          .filter(
            (order) =>
              Date.parse(order.occurredAt) <
              Date.parse(promotionEnd),
          )
          .reduce((sum, order) => sum + order.netRevenueMinor, 0);

        const promotedAfter = revenueAfter(
          promoted,
          promotionEnd,
        );
        const controlAfter = revenueAfter(
          control,
          promotionEnd,
        );

        if (
          promoWindowRevenue > controlWindowRevenue &&
          promotedAfter < controlAfter
        ) {
          demonstrated = true;
          break;
        }
      }

      expect(demonstrated).toBe(true);
    },
    120_000,
  );
});
