import { describe, expect, it } from "vitest";
import {
  createLowInventoryAdvertisingTrapFixture,
  createPriceIncreaseCollapseFixture,
  createPriceIncreaseProfitFixture,
} from "../../src/ecommerce_economics/adversarial.js";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";
import { evaluateChannelContributionEconomics } from "../../src/ecommerce_economics/counterfactual.js";
import { buildAdvertisingPerformanceReport } from "../../src/advertising_economics/evaluator.js";

function priceIntervention(priceMinor: number) {
  return {
    variable: "pricing.product_price",
    operation: "set" as const,
    value: {
      kind: "number" as const,
      value: priceMinor,
      unit: "money_minor" as const,
    },
  };
}

describe("Step 7 pricing and inventory economics", () => {
  it(
    "low-elasticity price increase can reduce orders while improving contribution profit",
    () => {
      const fixture = createPriceIncreaseProfitFixture();
      const base = evaluateEcommerceEconomics(
        fixture.evaluation,
      );
      const increased = evaluateEcommerceEconomics({
        ...fixture.evaluation,
        interventions: [
          priceIntervention(
            Math.round(
              fixture.merchantWorld.summary.catalogMaxPriceMinor *
                1.15,
            ),
          ),
        ],
      });

      expect(
        increased.simulation.totals.representedOrders,
      ).toBeLessThan(
        base.simulation.totals.representedOrders,
      );
      expect(
        increased.waterfall.contributionProfitMinor,
      ).toBeGreaterThan(
        base.waterfall.contributionProfitMinor,
      );

      console.info(
        "STEP7_PRICE_INCREASE_PROFIT",
        JSON.stringify({
          baseOrders:
            base.simulation.totals.representedOrders,
          increasedOrders:
            increased.simulation.totals.representedOrders,
          baseRevenueMinor:
            base.waterfall.netRevenueMinor,
          increasedRevenueMinor:
            increased.waterfall.netRevenueMinor,
          baseContributionMinor:
            base.waterfall.contributionProfitMinor,
          increasedContributionMinor:
            increased.waterfall.contributionProfitMinor,
        }),
      );
    },
    90_000,
  );

  it(
    "high-elasticity price increase can collapse orders and contribution profit",
    () => {
      const fixture = createPriceIncreaseCollapseFixture();
      const base = evaluateEcommerceEconomics(
        fixture.evaluation,
      );
      const increased = evaluateEcommerceEconomics({
        ...fixture.evaluation,
        interventions: [
          priceIntervention(
            Math.round(
              fixture.merchantWorld.summary.catalogMaxPriceMinor *
                1.15,
            ),
          ),
        ],
      });

      expect(
        increased.simulation.totals.representedOrders,
      ).toBeLessThan(
        base.simulation.totals.representedOrders,
      );
      expect(
        increased.waterfall.contributionProfitMinor,
      ).toBeLessThan(
        base.waterfall.contributionProfitMinor,
      );
    },
    90_000,
  );

  it(
    "low-inventory advertising trap: strong dashboard ROAS can coexist with poor marginal contribution economics",
    () => {
      const fixture =
        createLowInventoryAdvertisingTrapFixture();

      const advertising = buildAdvertisingPerformanceReport({
        merchantWorld: fixture.merchantWorld,
        latentPopulation:
          fixture.evaluation.latentPopulation,
        simulationSeed:
          fixture.evaluation.simulationSeed,
        periodStart: fixture.evaluation.periodStart,
        periodEnd: fixture.evaluation.periodEnd,
        spendMinorByChannel: Object.fromEntries(
          (fixture.evaluation.interventions ?? [])
            .filter((intervention) =>
              intervention.variable.startsWith("marketing."),
            )
            .map((intervention) => [
              intervention.variable.split(".")[1]!,
              intervention.value.kind === "number"
                ? intervention.value.value
                : 0,
            ]),
        ),
        contextInterventions: [
          {
            variable: "inventory.available",
            operation: "set",
            value: {
              kind: "number",
              value: 1,
              unit: "units",
            },
          },
        ],
        ...(fixture.evaluation.simulationConfig === undefined
          ? {}
          : { simulationConfig: fixture.evaluation.simulationConfig }),
      });

      const meta = advertising.rows.find(
        (row) => row.channel === "meta",
      );
      expect(meta).toBeDefined();
      expect(meta!.platformRoas).not.toBeNull();
      expect(meta!.platformRoas!).toBeGreaterThan(1);

      const contribution =
        evaluateChannelContributionEconomics(
          fixture.evaluation,
          "meta",
          {
            marginalBlockMinor: 25_000,
          },
        );

      expect(
        contribution.marginalIncrementalContributionProfitMinor,
      ).not.toBeNull();
      expect(
        contribution.marginalIncrementalContributionProfitMinor!,
      ).toBeLessThanOrEqual(0);

      console.info(
        "STEP7_LOW_INVENTORY_AD_TRAP",
        JSON.stringify({
          platformRoas: meta!.platformRoas,
          marginalContributionProfitMinor:
            contribution.marginalIncrementalContributionProfitMinor,
        }),
      );
    },
    120_000,
  );
});
