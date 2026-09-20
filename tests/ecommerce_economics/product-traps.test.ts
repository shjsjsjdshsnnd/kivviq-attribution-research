import { describe, expect, it } from "vitest";
import {
  createBestSellerTrapFixture,
  createCacVsCustomerValueFixture,
  createHighAovTrapFixture,
  createShortVsLongValueFixture,
} from "../../src/ecommerce_economics/adversarial.js";
import {
  applyProductEconomicOverrides,
  buildProductEconomicProfiles,
} from "../../src/ecommerce_economics/products.js";
import {
  acquisitionEconomicsBySource,
  productOpportunityRows,
} from "../../src/ecommerce_economics/opportunity.js";
import { evaluateEcommerceEconomics } from "../../src/ecommerce_economics/evaluator.js";

function overriddenProfiles(
  fixture: ReturnType<typeof createBestSellerTrapFixture>,
) {
  return applyProductEconomicOverrides(
    buildProductEconomicProfiles(
      fixture.merchantWorld,
    ),
    fixture.evaluation.productEconomicsOverrides,
  );
}

describe("Step 7 product and customer value traps", () => {
  it("best-seller trap: higher revenue opportunity can have worse contribution opportunity", () => {
    const fixture = createBestSellerTrapFixture();
    const keys = Object.keys(
      fixture.evaluation.productEconomicsOverrides ?? {},
    );
    expect(keys.length).toBeGreaterThanOrEqual(2);

    const rows = productOpportunityRows(
      fixture.merchantWorld,
      {
        profiles: overriddenProfiles(fixture),
      },
    );
    const a = rows.find((row) => row.productId === keys[0])!;
    const b = rows.find((row) => row.productId === keys[1])!;

    expect(a.revenueOpportunityMinor).toBeGreaterThan(
      b.revenueOpportunityMinor,
    );
    expect(a.contributionOpportunityMinor).toBeLessThan(
      b.contributionOpportunityMinor,
    );

    console.info(
      "STEP7_BEST_SELLER_TRAP",
      JSON.stringify({
        revenueLeader: a.productId,
        revenueOpportunityMinor: a.revenueOpportunityMinor,
        contributionOpportunityMinor: a.contributionOpportunityMinor,
        betterContributionProduct: b.productId,
        lowerRevenueOpportunityMinor: b.revenueOpportunityMinor,
        higherContributionOpportunityMinor:
          b.contributionOpportunityMinor,
      }),
    );
  });

  it("high-AOV trap: the more expensive product can have much worse unit contribution", () => {
    const fixture = createHighAovTrapFixture();
    const keys = Object.keys(
      fixture.evaluation.productEconomicsOverrides ?? {},
    );
    const rows = productOpportunityRows(
      fixture.merchantWorld,
      {
        profiles: overriddenProfiles(
          fixture as ReturnType<
            typeof createBestSellerTrapFixture
          >,
        ),
      },
    );
    const high = rows.find((row) => row.productId === keys[0])!;
    const lower = rows.find((row) => row.productId === keys[1])!;

    expect(high.listPriceMinor).toBeGreaterThan(
      lower.listPriceMinor,
    );
    expect(high.expectedContributionPerUnitMinor).toBeLessThan(
      lower.expectedContributionPerUnitMinor,
    );
    expect(high.expectedReturnDragPerUnitMinor).toBeGreaterThan(
      lower.expectedReturnDragPerUnitMinor,
    );

    console.info(
      "STEP7_HIGH_AOV_TRAP",
      JSON.stringify({
        highAovProduct: high.productId,
        highAovMinor: high.listPriceMinor,
        highAovContributionPerUnitMinor:
          high.expectedContributionPerUnitMinor,
        lowerAovProduct: lower.productId,
        lowerAovMinor: lower.listPriceMinor,
        lowerAovContributionPerUnitMinor:
          lower.expectedContributionPerUnitMinor,
      }),
    );
  });

  it(
    "CAC-vs-customer-value: the lowest-CAC source need not have the highest expected total value",
    () => {
      const fixture = createCacVsCustomerValueFixture();
      const report = evaluateEcommerceEconomics(
        fixture.evaluation,
      );
      const rows = acquisitionEconomicsBySource(
        report,
        fixture.merchantWorld,
        fixture.evaluation.latentPopulation,
      ).filter(
        (row) =>
          row.cacMinor !== null &&
          row.representedNewCustomers > 0,
      );

      expect(rows.length).toBeGreaterThanOrEqual(2);
      console.info(
        "STEP7_ACQUISITION_SOURCE_ROWS",
        JSON.stringify(rows),
      );

      const lowestCac = [...rows].sort(
        (left, right) =>
          left.cacMinor! - right.cacMinor!,
      )[0]!;
      const highestValue = [...rows].sort(
        (left, right) =>
          right.expectedTotalEconomicValueMinor -
          left.expectedTotalEconomicValueMinor,
      )[0]!;

      expect(lowestCac.source).not.toBe(highestValue.source);
      expect(lowestCac.cacMinor!).toBeLessThan(
        highestValue.cacMinor!,
      );
      expect(
        lowestCac.expectedTotalEconomicValueMinor,
      ).toBeLessThan(
        highestValue.expectedTotalEconomicValueMinor,
      );

      console.info(
        "STEP7_CAC_VS_VALUE_TRAP",
        JSON.stringify({ lowestCac, highestValue }),
      );
    },
    90_000,
  );

  it(
    "short-term and expected-lifetime source rankings can disagree",
    () => {
      const fixture = createShortVsLongValueFixture();
      const report = evaluateEcommerceEconomics(
        fixture.evaluation,
      );
      const rows = acquisitionEconomicsBySource(
        report,
        fixture.merchantWorld,
        fixture.evaluation.latentPopulation,
      ).filter((row) => row.representedNewCustomers > 0);

      expect(rows.length).toBeGreaterThanOrEqual(2);
      console.info(
        "STEP7_SHORT_LONG_SOURCE_ROWS",
        JSON.stringify(rows),
      );

      const shortTerm = [...rows].sort(
        (left, right) =>
          right.firstOrderContributionMinor -
          left.firstOrderContributionMinor,
      )[0]!;
      const longTerm = [...rows].sort(
        (left, right) =>
          right.expectedTotalEconomicValueMinor -
          left.expectedTotalEconomicValueMinor,
      )[0]!;

      expect(shortTerm.source).not.toBe(longTerm.source);

      console.info(
        "STEP7_SHORT_LONG_VALUE_REVERSAL",
        JSON.stringify({ shortTerm, longTerm }),
      );
    },
    90_000,
  );
});
