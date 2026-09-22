import { describe, expect, it } from "vitest";
import {
  createMarginDestructionTrapFixture,
  createPullForwardTrapFixture,
  createRevenueProfitTrapFixture,
} from "../../src/pricing_promotions/adversarial.js";
import {
  evaluatePricingPromotionEconomics,
  evaluatePromotionOracleGrid,
  evaluatePromotionResponseCurve,
} from "../../src/pricing_promotions/evaluator.js";

function row(
  rows: ReturnType<
    typeof evaluatePricingPromotionEconomics
  >["factualProductEconomics"],
  productId: string,
) {
  const found = rows.find(
    (candidate) => candidate.productId === productId,
  );
  if (!found) {
    throw new Error("missing product row " + productId);
  }
  return found;
}

function revenueBetween(
  report: ReturnType<
    typeof evaluatePricingPromotionEconomics
  >["factual"],
  start: string,
  end: string,
): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return report.orders
    .filter((order) => {
      const occurredAt = Date.parse(order.occurredAt);
      return occurredAt >= startMs && occurredAt < endMs;
    })
    .reduce(
      (sum, order) => sum + order.netRevenueMinor,
      0,
    );
}

describe("Step 10 deterministic acceptance traps", () => {
  it(
    "10% discount helps the elastic high-margin SKU but destroys contribution on the weak-response low-margin SKU",
    () => {
      const fixture =
        createMarginDestructionTrapFixture();
      const report =
        evaluatePricingPromotionEconomics(
          fixture.evaluation,
        );
      const a = row(
        report.factualProductEconomics,
        fixture.productAId,
      );
      const aControl = row(
        report.noPromotionProductEconomics,
        fixture.productAId,
      );
      const b = row(
        report.factualProductEconomics,
        fixture.productBId,
      );
      const bControl = row(
        report.noPromotionProductEconomics,
        fixture.productBId,
      );

      expect(a.representedUnits).toBeGreaterThan(
        aControl.representedUnits,
      );
      expect(
        a.allocatedContributionProfitMinor,
      ).toBeGreaterThan(
        aControl.allocatedContributionProfitMinor,
      );

      expect(b.representedUnits).toBeGreaterThanOrEqual(
        bControl.representedUnits,
      );
      expect(
        b.allocatedContributionProfitMinor,
      ).toBeLessThan(
        bControl.allocatedContributionProfitMinor,
      );

      expect(
        report.attribution.promotionExposedPurchases,
      ).toBeGreaterThanOrEqual(
        report.attribution
          .promotionRedemptionPurchases,
      );

      expect(
        report.attribution
          .discountCostOnWouldHavePurchasedAnywayMinor +
          report.attribution
            .discountCostOnAcceleratedPurchasesMinor +
          report.attribution
            .discountCostOnSwitchedPurchasesMinor,
      ).toBeGreaterThan(0);

      console.info(
        "STEP10_MARGIN_DESTRUCTION_TRAP",
        JSON.stringify({
          productA: {
            promotedUnits: a.representedUnits,
            baselineUnits: aControl.representedUnits,
            promotedContribution:
              a.allocatedContributionProfitMinor,
            baselineContribution:
              aControl.allocatedContributionProfitMinor,
          },
          productB: {
            promotedUnits: b.representedUnits,
            baselineUnits: bControl.representedUnits,
            promotedContribution:
              b.allocatedContributionProfitMinor,
            baselineContribution:
              bControl.allocatedContributionProfitMinor,
          },
          attribution: report.attribution,
        }),
      );
    },
    120_000,
  );

  it(
    "deepest promotion can win revenue while losing contribution to no promotion",
    () => {
      const fixture =
        createRevenueProfitTrapFixture();
      const points =
        evaluatePromotionResponseCurve(
          fixture.evaluation,
          [0, 0.1, 0.2],
        );
      const none = points[0]!;
      const ten = points[1]!;
      const twenty = points[2]!;

      expect(twenty.netRevenueMinor).toBeGreaterThan(
        ten.netRevenueMinor,
      );
      expect(ten.netRevenueMinor).toBeGreaterThan(
        none.netRevenueMinor,
      );
      expect(
        twenty.contributionProfitMinor,
      ).toBeLessThan(
        none.contributionProfitMinor,
      );

      const oracle = evaluatePromotionOracleGrid(
        fixture.evaluation,
        [0, 0.1, 0.2],
      );
      expect(oracle.godModeOnly).toBe(true);
      expect(
        oracle.evaluatedPoints.some(
          (point) => point.discountDepth === 0,
        ),
      ).toBe(true);

      console.info(
        "STEP10_REVENUE_WINNER_PROFIT_LOSER_TRAP",
        JSON.stringify({
          noPromotion: none,
          tenPercent: ten,
          twentyPercent: twenty,
          oracleContributionPoint:
            oracle.maximizingPoint.discountDepth,
        }),
      );
    },
    180_000,
  );

  it(
    "promotion pull-forward produces accelerated purchases and a post-promotion demand dip from customer timing",
    () => {
      const fixture =
        createPullForwardTrapFixture();
      const report =
        evaluatePricingPromotionEconomics(
          fixture.evaluation,
        );

      expect(
        report.attribution.acceleratedPurchases,
      ).toBeGreaterThan(0);
      const weekMs = 7 * 86_400_000;
      const promotionEndMs = Date.parse(
        fixture.promotionEnd,
      );
      // Pull-forward distance is customer-specific and can span much of a
      // replenishment interval. Search the declared post-sale observation
      // horizon rather than assuming the displaced purchase must occur within
      // four weeks.
      const postPromotionWeeks = Array.from(
        { length: 11 },
        (_, index) => {
          const start = new Date(
            promotionEndMs + index * weekMs,
          ).toISOString();
          const end = new Date(
            promotionEndMs + (index + 1) * weekMs,
          ).toISOString();
          return {
            week: index + 1,
            start,
            end,
            promotedRevenueMinor: revenueBetween(
              report.factual,
              start,
              end,
            ),
            baselineRevenueMinor: revenueBetween(
              report.noPromotionCounterfactual,
              start,
              end,
            ),
          };
        },
      );
      const dipWeek = postPromotionWeeks
        .filter(
          (week) =>
            week.promotedRevenueMinor <
            week.baselineRevenueMinor,
        )
        .sort(
          (left, right) =>
            left.promotedRevenueMinor -
              left.baselineRevenueMinor -
            (right.promotedRevenueMinor -
              right.baselineRevenueMinor),
        )[0];

      console.info(
        "STEP10_PULL_FORWARD_TRAP",
        JSON.stringify({
          acceleratedPurchases:
            report.attribution.acceleratedPurchases,
          postPromotionDisplacedPurchases:
            report.attribution
              .postPromotionDisplacedPurchases,
          trueIncrementalPurchases:
            report.attribution
              .trueIncrementalPromotionPurchases,
          postPromotionWeeks,
          dipWeek,
          fullHorizonIncrementalContributionMinor:
            report.incremental
              .incrementalContributionProfitMinor,
        }),
      );

      // The post-promotion dip is a realized merchant-period outcome:
      // at least one declared post-sale week must fall below the same-seed
      // no-promotion replay. The customer-order pairing metric is reported as
      // a narrower attribution diagnostic, but is not required to be nonzero
      // because incremental purchases can alter later order matching.
      expect(dipWeek).toBeDefined();
      expect(
        dipWeek!.promotedRevenueMinor,
      ).toBeLessThan(
        dipWeek!.baselineRevenueMinor,
      );
    },
    120_000,
  );
});
