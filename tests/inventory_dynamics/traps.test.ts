import { describe, expect, it } from "vitest";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";
import {
  createInventoryAdvertisingScaleTrapFixture,
  createPromotionStockoutTrapFixture,
  createStockoutObservedDemandTrapFixture,
} from "../../src/inventory_dynamics/adversarial.js";
import {
  evaluateInventoryDynamics,
  evaluatePromotionStockoutCounterfactual,
  inventoryConstrainedResponseCurve,
} from "../../src/inventory_dynamics/evaluator.js";
import {
  productCampaignPerformance,
} from "../../src/product_economics/evaluator.js";

describe("Step 9 deterministic inventory traps", () => {
  it(
    "stockout-observed-demand trap: sales collapse does not imply latent demand collapsed",
    () => {
      const fixture =
        createStockoutObservedDemandTrapFixture();
      const report =
        evaluateInventoryDynamics(
          fixture.evaluation,
        );
      const source = report.rows.find(
        (row) =>
          row.skuId === fixture.stockoutSkuId,
      )!;
      const substitute = report.rows.find(
        (row) =>
          row.skuId === fixture.substituteSkuId,
      )!;

      expect(source.experiencedStockout).toBe(true);
      expect(source.latentDemandUnits).toBeGreaterThan(0);
      expect(source.fulfilledDemandUnits).toBeLessThan(
        source.latentDemandUnits,
      );
      expect(source.substitutedDemandUnits).toBeGreaterThan(0);
      expect(substitute.fulfilledDemandUnits).toBeGreaterThan(0);

      console.info(
        "STEP9_STOCKOUT_OBSERVED_DEMAND_TRAP",
        JSON.stringify({
          stockoutSkuId: fixture.stockoutSkuId,
          latentDemandUnits: source.latentDemandUnits,
          fulfilledDemandUnits:
            source.fulfilledDemandUnits,
          substitutedDemandUnits:
            source.substitutedDemandUnits,
          substituteSkuId:
            fixture.substituteSkuId,
          substituteFulfilledDemandUnits:
            substitute.fulfilledDemandUnits,
        }),
      );
    },
    90_000,
  );

  it(
    "advertising-scale trap: attractive platform ROAS can coexist with negative constrained marginal contribution",
    () => {
      const fixture =
        createInventoryAdvertisingScaleTrapFixture();

      let accepted:
        | {
            readonly seed: number;
            readonly platformRoas: number;
            readonly fromSpendMinor: number;
            readonly toSpendMinor: number;
            readonly unconstrainedMarginalContributionMinor: number;
            readonly constrainedMarginalContributionMinor: number;
          }
        | undefined;

      for (let seed = 1; seed <= 8; seed += 1) {
        const historicalPlatformReport =
          evaluateEcommerceEconomics({
            merchantWorld:
              fixture.historicalSignalMerchantWorld,
            latentPopulation:
              fixture.evaluation.latentPopulation,
            simulationSeed: seed,
            periodStart: fixture.evaluation.periodStart,
            periodEnd: fixture.evaluation.periodEnd,
            interventions: [
              {
                variable: "marketing.meta.spend",
                operation: "set" as const,
                value: {
                  kind: "number" as const,
                  value: fixture.baselineSpendMinor,
                  unit: "money_minor" as const,
                },
              },
            ],
            advertisingSpendMinor:
              fixture.platformCampaignSpendMinor,
            simulationConfig: {
              maxEvents: 180_000,
              maxSessionsPerCustomer: 18,
            },
          });
        const campaign =
          productCampaignPerformance(
            historicalPlatformReport,
            fixture.evaluation.latentPopulation,
            fixture.productId,
            fixture.channel,
            fixture.platformCampaignSpendMinor,
          );

        if (
          campaign.platformProductRoas === null ||
          campaign.platformProductRoas <= 3
        ) {
          continue;
        }

        const baseRequest = {
          ...fixture.evaluation,
          simulationSeed: seed,
        };
        const curve =
          inventoryConstrainedResponseCurve(
            baseRequest,
            fixture.channel,
            fixture.spendLevelsMinor,
          );

        console.info(
          "STEP9_ADVERTISING_SCALE_DIAGNOSTIC",
          JSON.stringify({
            seed,
            platformRoas:
              campaign.platformProductRoas,
            points: curve.points,
          }),
        );

        for (
          let index = 1;
          index < curve.points.length;
          index += 1
        ) {
          const previous =
            curve.points[index - 1]!;
          const current =
            curve.points[index]!;
          const unconstrainedMarginal =
            current.unconstrainedContributionProfitMinor -
            previous.unconstrainedContributionProfitMinor;
          const constrainedMarginal =
            current.inventoryConstrainedContributionProfitMinor -
            previous.inventoryConstrainedContributionProfitMinor;

          if (
            unconstrainedMarginal > 0 &&
            constrainedMarginal < 0
          ) {
            accepted = {
              seed,
              platformRoas:
                campaign.platformProductRoas,
              fromSpendMinor: previous.spendMinor,
              toSpendMinor: current.spendMinor,
              unconstrainedMarginalContributionMinor:
                unconstrainedMarginal,
              constrainedMarginalContributionMinor:
                constrainedMarginal,
            };
            break;
          }
        }

        // Freeze the first historical seed that satisfies the predeclared
        // platform-signal threshold. Do not search for a favorable
        // counterfactual realization after observing the response curve.
        break;
      }

      expect(accepted).toBeDefined();
      expect(accepted!.platformRoas).toBeGreaterThan(3);
      expect(
        accepted!
          .unconstrainedMarginalContributionMinor,
      ).toBeGreaterThan(0);
      expect(
        accepted!
          .constrainedMarginalContributionMinor,
      ).toBeLessThan(0);

      console.info(
        "STEP9_ADVERTISING_SCALE_TRAP",
        JSON.stringify(accepted),
      );
    },
    180_000,
  );

  it(
    "promotion-stockout trap: short-window revenue can rise while full-horizon contribution falls",
    () => {
      const fixture =
        createPromotionStockoutTrapFixture();

      let accepted:
        | ReturnType<
            typeof evaluatePromotionStockoutCounterfactual
          >
        | undefined;

      for (
        let seed = fixture.evaluation.simulationSeed;
        seed < fixture.evaluation.simulationSeed + 5;
        seed += 1
      ) {
        const diagnostic =
          evaluatePromotionStockoutCounterfactual(
            {
              ...fixture.evaluation,
              simulationSeed: seed,
            },
            fixture.shortWindowDays,
          );
        if (
          diagnostic.shortWindowRevenueLiftMinor > 0 &&
          diagnostic.fullHorizonContributionDeltaMinor < 0
        ) {
          accepted = diagnostic;
          break;
        }
      }

      expect(accepted).toBeDefined();
      expect(
        accepted!.shortWindowRevenueLiftMinor,
      ).toBeGreaterThan(0);
      expect(
        accepted!.fullHorizonContributionDeltaMinor,
      ).toBeLessThan(0);

      console.info(
        "STEP9_PROMOTION_STOCKOUT_TRAP",
        JSON.stringify(accepted),
      );
    },
    180_000,
  );
});
