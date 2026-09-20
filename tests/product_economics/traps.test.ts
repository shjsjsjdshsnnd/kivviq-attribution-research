import { describe, expect, it } from "vitest";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";
import {
  createLowInventoryProductRoasTrapFixture,
  createSelloutSubstitutionTrapFixture,
} from "../../src/product_economics/adversarial.js";
import {
  buildProductEconomicsReport,
  evaluateInventoryScaleRisk,
  evaluateSelloutSubstitution,
  productCampaignPerformance,
} from "../../src/product_economics/evaluator.js";

describe("Step 8 product-economic traps", () => {
  it(
    "low-inventory ROAS trap: excellent product ROAS can still make scaling economically impossible",
    () => {
      const fixture =
        createLowInventoryProductRoasTrapFixture();

      let accepted:
        | {
            readonly platformRoas: number;
            readonly risk: ReturnType<
              typeof evaluateInventoryScaleRisk
            >;
          }
        | undefined;

      for (let seed = 1; seed <= 8; seed += 1) {
        const report = evaluateEcommerceEconomics({
          merchantWorld: fixture.merchantWorld,
          latentPopulation: fixture.latentPopulation,
          simulationSeed: seed,
          periodStart: "2026-01-01T00:00:00.000Z",
          periodEnd: "2026-04-01T00:00:00.000Z",
          interventions: [
            {
              variable: "marketing.meta.spend",
              operation: "set",
              value: {
                kind: "number",
                value: fixture.campaignSpendMinor,
                unit: "money_minor",
              },
            },
          ],
          advertisingSpendMinor:
            fixture.campaignSpendMinor,
          simulationConfig: {
            maxEvents: 180_000,
            maxSessionsPerCustomer: 18,
          },
        });

        const intelligence = buildProductEconomicsReport({
          merchantWorld: fixture.merchantWorld,
          latentPopulation: fixture.latentPopulation,
          ecommerceReport: report,
        });
        const product = intelligence.products.find(
          (candidate) =>
            candidate.productId === fixture.productId,
        )!;

        const campaign = productCampaignPerformance(
          report,
          fixture.latentPopulation,
          fixture.productId,
          fixture.channel,
          fixture.campaignSpendMinor,
        );

        if (
          campaign.platformProductRoas !== null &&
          campaign.platformProductRoas > 3
        ) {
          const risk = evaluateInventoryScaleRisk(
            product,
            campaign,
            fixture.proposedAdditionalSpendMinor,
            17,
          );
          accepted = {
            platformRoas: campaign.platformProductRoas,
            risk,
          };
          break;
        }
      }

      expect(accepted).toBeDefined();
      expect(accepted!.platformRoas).toBeGreaterThan(3);
      expect(accepted!.risk.remainingUnits).toBe(17);
      expect(
        accepted!.risk
          .scalingEconomicallyImpossibleAtThisSpendBlock,
      ).toBe(true);
      expect(
        accepted!.risk
          .optimisticMarginalContributionUpperBoundMinor,
      ).toBeLessThan(0);

      console.info(
        "STEP8_LOW_INVENTORY_PRODUCT_TRAP",
        JSON.stringify({
          productId: fixture.productId,
          remainingUnits: 17,
          platformProductRoas: accepted!.platformRoas,
          stockCoverageDays:
            accepted!.risk.stockCoverageDays,
          optimisticRemainingInventoryContributionMinor:
            accepted!.risk
              .optimisticRemainingInventoryContributionMinor,
          proposedAdditionalSpendMinor:
            fixture.proposedAdditionalSpendMinor,
          optimisticMarginalContributionUpperBoundMinor:
            accepted!.risk
              .optimisticMarginalContributionUpperBoundMinor,
        }),
      );
    },
    120_000,
  );

  it(
    "sellout substitution trap: Product B observed demand rises without becoming intrinsically more desirable",
    () => {
      const fixture =
        createSelloutSubstitutionTrapFixture();

      const diagnostic = evaluateSelloutSubstitution(
        fixture.merchantWorld,
        fixture.latentPopulation,
        fixture.soldOutProductId,
        fixture.substituteProductId,
        {
          simulationSeed: 99002,
          opportunitiesPerCustomer: 12,
        },
      );

      expect(
        diagnostic.knownSubstitutionRelationship,
      ).toBe(true);
      expect(
        diagnostic.soldOutProduct.selectionDelta,
      ).toBeLessThan(0);
      expect(
        diagnostic.substituteProduct.selectionDelta,
      ).toBeGreaterThan(0);

      expect(
        diagnostic.substituteProduct.structuralDemandDelta,
      ).toBe(0);
      expect(
        diagnostic.substituteProduct.latentPreferenceDelta,
      ).toBe(0);
      expect(
        diagnostic
          .observedSubstituteLiftWithNoStructuralDemandChange,
      ).toBe(true);
      expect(
        diagnostic
          .observedSubstituteLiftWithNoLatentPreferenceChange,
      ).toBe(true);

      console.info(
        "STEP8_SELLOUT_SUBSTITUTION_TRAP",
        JSON.stringify({
          soldOutProductId:
            diagnostic.soldOutProductId,
          substituteProductId:
            diagnostic.substituteProductId,
          soldOutSelectionDelta:
            diagnostic.soldOutProduct.selectionDelta,
          substituteSelectionDelta:
            diagnostic.substituteProduct.selectionDelta,
          substituteStructuralDemandDelta:
            diagnostic.substituteProduct.structuralDemandDelta,
          substituteLatentPreferenceDelta:
            diagnostic.substituteProduct.latentPreferenceDelta,
        }),
      );
    },
    60_000,
  );
});
