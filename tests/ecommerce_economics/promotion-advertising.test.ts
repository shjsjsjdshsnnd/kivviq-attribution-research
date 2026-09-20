import { describe, expect, it } from "vitest";
import { createDiscountTrapFixture } from "../../src/ecommerce_economics/adversarial.js";
import { evaluateChannelContributionEconomics } from "../../src/ecommerce_economics/counterfactual.js";
import {
  evaluateAverageTruePerformance,
  referenceSpendMinor,
} from "../../src/advertising_economics/evaluator.js";
import { isPaidMarketingChannel } from "../../src/advertising_economics/types.js";

describe("Step 7 promotion × advertising economics", () => {
  it(
    "promotion can improve revenue iROAS while worsening incremental contribution economics",
    () => {
      const fixture = createDiscountTrapFixture();
      const channel = "meta" as const;
      expect(
        fixture.merchantWorld.summary.activeChannels,
      ).toContain(channel);
      expect(isPaidMarketingChannel(channel)).toBe(true);
      const spend = referenceSpendMinor(
        fixture.merchantWorld,
        channel,
      );

      const baseAdvertising = {
        merchantWorld: fixture.merchantWorld,
        latentPopulation: fixture.evaluation.latentPopulation,
        simulationSeed: fixture.evaluation.simulationSeed,
        periodStart: fixture.evaluation.periodStart,
        periodEnd: fixture.evaluation.periodEnd,
        spendMinorByChannel: { [channel]: spend },
        ...(fixture.evaluation.simulationConfig === undefined
          ? {}
          : { simulationConfig: fixture.evaluation.simulationConfig }),
      };

      const promotionOnRevenue = evaluateAverageTruePerformance(
        {
          ...baseAdvertising,
          contextInterventions: [
            {
              variable: "promotion.discount_active",
              operation: "set",
              value: { kind: "boolean", value: true },
            },
          ],
        },
        channel,
      );
      const promotionOffRevenue = evaluateAverageTruePerformance(
        {
          ...baseAdvertising,
          contextInterventions: [
            {
              variable: "promotion.discount_active",
              operation: "set",
              value: { kind: "boolean", value: false },
            },
          ],
        },
        channel,
      );

      const promotionOnContribution =
        evaluateChannelContributionEconomics(
          {
            ...fixture.evaluation,
            interventions: [
              {
                variable: "promotion.discount_active",
                operation: "set",
                value: { kind: "boolean", value: true },
              },
            ],
          },
          channel,
        );
      const promotionOffContribution =
        evaluateChannelContributionEconomics(
          {
            ...fixture.evaluation,
            interventions: [
              {
                variable: "promotion.discount_active",
                operation: "set",
                value: { kind: "boolean", value: false },
              },
            ],
          },
          channel,
        );

      console.info(
        "STEP7_PROMOTION_AD_DIAGNOSTIC",
        JSON.stringify({
          channel,
          promotionRevenueIroas:
            promotionOnRevenue.trueIncrementalRoas,
          noPromotionRevenueIroas:
            promotionOffRevenue.trueIncrementalRoas,
          promotionIncrementalContributionMinor:
            promotionOnContribution
              .incrementalContributionProfitMinor,
          noPromotionIncrementalContributionMinor:
            promotionOffContribution
              .incrementalContributionProfitMinor,
        }),
      );

      expect(
        promotionOnRevenue.trueIncrementalRoas,
      ).not.toBeNull();
      expect(
        promotionOffRevenue.trueIncrementalRoas,
      ).not.toBeNull();

      expect(
        promotionOnRevenue.trueIncrementalRoas!,
      ).toBeGreaterThan(
        promotionOffRevenue.trueIncrementalRoas!,
      );

      expect(
        promotionOnContribution
          .incrementalContributionProfitMinor,
      ).toBeLessThan(
        promotionOffContribution
          .incrementalContributionProfitMinor,
      );

      console.info(
        "STEP7_PROMOTION_AD_TRAP",
        JSON.stringify({
          channel,
          promotionRevenueIroas:
            promotionOnRevenue.trueIncrementalRoas,
          noPromotionRevenueIroas:
            promotionOffRevenue.trueIncrementalRoas,
          promotionIncrementalContributionMinor:
            promotionOnContribution
              .incrementalContributionProfitMinor,
          noPromotionIncrementalContributionMinor:
            promotionOffContribution
              .incrementalContributionProfitMinor,
        }),
      );
    },
    120_000,
  );
});
