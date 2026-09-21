import { describe, expect, it } from "vitest";
import {
  createMarginDestructionTrapFixture,
  createRevenueProfitTrapFixture,
} from "../../src/pricing_promotions/adversarial.js";
import {
  evaluateClearanceCounterfactual,
  evaluateEventPromotionDecomposition,
  evaluatePriceResponseCurve,
  evaluatePricingPromotionEconomics,
  hydratePricingPromotionScenario,
} from "../../src/pricing_promotions/evaluator.js";

describe("Step 10 evaluator invariants", () => {
  it(
    "product rows reconcile exactly to merchant net revenue, gross profit, and contribution profit",
    () => {
      const fixture =
        createMarginDestructionTrapFixture();
      const report =
        evaluatePricingPromotionEconomics(
          fixture.evaluation,
        );

      const sum = (
        selector: (
          row: (typeof report.factualProductEconomics)[number],
        ) => number,
      ) =>
        report.factualProductEconomics.reduce(
          (total, row) => total + selector(row),
          0,
        );

      expect(
        sum((row) => row.allocatedNetRevenueMinor),
      ).toBe(report.factual.waterfall.netRevenueMinor);
      expect(
        sum((row) => row.allocatedGrossProfitMinor),
      ).toBe(report.factual.waterfall.grossProfitMinor);
      expect(
        sum(
          (row) =>
            row.allocatedContributionProfitMinor,
        ),
      ).toBe(
        report.factual.waterfall.contributionProfitMinor,
      );
    },
    120_000,
  );

  it(
    "separates exogenous event demand from the merchant promotion effect under shared randomness",
    () => {
      const fixture =
        createRevenueProfitTrapFixture();
      const hydrated =
        hydratePricingPromotionScenario(
          fixture.evaluation,
        );
      const scenario = {
        ...hydrated,
        majorEvents: [
          {
            eventId: "synthetic-major-event",
            start: fixture.evaluation.periodStart,
            end: "2026-02-15T00:00:00.000Z",
            baselineDemandMultiplier: 1.55,
            marketingCompetitionMultiplier: 1.15,
          },
        ],
        promotions: [
          {
            promotionId: "synthetic-major-event-sale",
            mechanic: "percentage_discount" as const,
            scope: { kind: "sitewide" as const },
            start: fixture.evaluation.periodStart,
            end: "2026-02-15T00:00:00.000Z",
            percentageOff: 0.1,
            awarenessProbability: 0,
          },
        ],
      };

      const result =
        evaluateEventPromotionDecomposition({
          ...fixture.evaluation,
          scenario,
        });

      expect(
        result.eventDemandEffectRevenueMinor,
      ).toBe(
        result.eventDemandWithoutMerchantPromotion
          .waterfall.netRevenueMinor -
          result.baselineWithoutEventOrPromotion
            .waterfall.netRevenueMinor,
      );
      expect(
        result.merchantPromotionEffectRevenueMinor,
      ).toBe(
        result.eventDemandAndPromotion.waterfall
          .netRevenueMinor -
          result.eventDemandWithoutMerchantPromotion
            .waterfall.netRevenueMinor,
      );
      expect(
        result.eventDemandEffectRevenueMinor,
      ).not.toBe(0);
    },
    180_000,
  );

  it(
    "price curves evaluate decreases, baseline, and increases without exposing a recommendation",
    () => {
      const fixture =
        createMarginDestructionTrapFixture();
      const points = evaluatePriceResponseCurve(
        fixture.evaluation,
        fixture.productAId,
        [-0.1, 0, 0.1],
      );

      expect(
        points.map(
          (point) => point.relativePriceChange,
        ),
      ).toEqual([-0.1, 0, 0.1]);
      expect(
        points.every(
          (point) =>
            Number.isFinite(
              point.contributionProfitMinor,
            ) && point.priceMinor > 0,
        ),
      ).toBe(true);
    },
    180_000,
  );

  it(
    "does not misclassify an authoritative price-state markdown as promotion redemption",
    () => {
      const fixture =
        createMarginDestructionTrapFixture();
      const hydrated =
        hydratePricingPromotionScenario(
          fixture.evaluation,
        );
      const scenario = {
        ...hydrated,
        promotions: [],
        priceStates: hydrated.priceStates.map((state) => {
          if (
            state.productId !== fixture.productAId
          ) {
            return state;
          }
          const effectivePriceMinor = Math.max(
            1,
            Math.round(
              state.currentSellingPriceMinor * 0.9,
            ),
          );
          const discountAmountMinor =
            state.currentSellingPriceMinor -
            effectivePriceMinor;
          return {
            ...state,
            effectivePriceMinor,
            discountAmountMinor,
            discountPercentage:
              discountAmountMinor /
              state.currentSellingPriceMinor,
          };
        }),
      };

      const report =
        evaluatePricingPromotionEconomics({
          ...fixture.evaluation,
          scenario,
        });

      expect(
        report.factual.waterfall.discountsMinor,
      ).toBeGreaterThan(0);
      expect(
        report.attribution
          .promotionRedemptionPurchases,
      ).toBe(0);
      expect(
        report.attribution
          .discountCostOnIncrementalPurchasesMinor +
          report.attribution
            .discountCostOnAcceleratedPurchasesMinor +
          report.attribution
            .discountCostOnWouldHavePurchasedAnywayMinor +
          report.attribution
            .discountCostOnSwitchedPurchasesMinor,
      ).toBe(0);
    },
    180_000,
  );

  it(
    "price increases can improve contribution for a weakly elastic SKU and hurt it for a highly elastic SKU",
    () => {
      const fixture =
        createMarginDestructionTrapFixture();
      const highElasticity =
        evaluatePriceResponseCurve(
          fixture.evaluation,
          fixture.productAId,
          [0, 0.1],
        );
      const lowElasticity =
        evaluatePriceResponseCurve(
          fixture.evaluation,
          fixture.productBId,
          [0, 0.1],
        );

      expect(
        highElasticity[1]!
          .targetProductRepresentedUnits,
      ).toBeLessThan(
        highElasticity[0]!
          .targetProductRepresentedUnits,
      );
      expect(
        lowElasticity[1]!
          .targetProductRepresentedUnits,
      ).toBeLessThan(
        lowElasticity[0]!
          .targetProductRepresentedUnits,
      );
      expect(
        highElasticity[1]!.contributionProfitMinor,
      ).toBeLessThan(
        highElasticity[0]!.contributionProfitMinor,
      );
      expect(
        lowElasticity[1]!.contributionProfitMinor,
      ).toBeGreaterThan(
        lowElasticity[0]!.contributionProfitMinor,
      );
    },
    240_000,
  );

  it("rejects overlapping authoritative price states for the same SKU/variant", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const hydrated =
      hydratePricingPromotionScenario(
        fixture.evaluation,
      );
    const base = hydrated.priceStates.find(
      (state) =>
        state.productId === fixture.productAId,
    )!;

    expect(() =>
      hydratePricingPromotionScenario({
        ...fixture.evaluation,
        scenario: {
          ...hydrated,
          priceStates: [
            {
              ...base,
              effectiveStart:
                fixture.evaluation.periodStart,
              effectiveEnd:
                "2026-03-01T00:00:00.000Z",
            },
            {
              ...base,
              effectiveStart:
                "2026-02-01T00:00:00.000Z",
              effectiveEnd:
                fixture.evaluation.periodEnd,
            },
          ],
        },
      }),
    ).toThrow(/overlapping authoritative price states/);
  });

  it(
    "clearance counterfactual includes carrying cost and obsolescence rather than immediate margin only",
    () => {
      const fixture =
        createMarginDestructionTrapFixture();
      const result =
        evaluateClearanceCounterfactual(
          fixture.evaluation,
          fixture.productBId,
          0.25,
        );

      expect(
        Number.isFinite(
          result.horizonEconomicValueDeltaMinor,
        ),
      ).toBe(true);
      expect(
        result.horizonEconomicValueDeltaMinor,
      ).toBe(
        result.clearance
          .contributionProfitAfterInventoryCarryingMinor -
          result.clearance
            .obsolescenceEconomicLossMinor -
          (result.waitForFullPrice
            .contributionProfitAfterInventoryCarryingMinor -
            result.waitForFullPrice
              .obsolescenceEconomicLossMinor),
      );
    },
    180_000,
  );
});
