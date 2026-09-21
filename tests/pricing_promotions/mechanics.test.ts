import { describe, expect, it } from "vitest";
import {
  createMarginDestructionTrapFixture,
} from "../../src/pricing_promotions/adversarial.js";
import {
  hydratePricingPromotionScenario,
} from "../../src/pricing_promotions/evaluator.js";
import {
  bundleAttachmentOpportunity,
  promotionTimingDeferralMultiplier,
  resolveCartLinePricing,
  resolveCartShippingTerms,
  resolveProductOffer,
  type PricingCustomerContext,
} from "../../src/pricing_promotions/runtime.js";
import type {
  PricingPromotionScenario,
  PromotionDefinition,
} from "../../src/pricing_promotions/runtime-types.js";

function context(
  fixture: ReturnType<
    typeof createMarginDestructionTrapFixture
  >,
  customerIndex = 0,
  purchaseCount = 0,
): PricingCustomerContext {
  const customer =
    fixture.evaluation.latentPopulation.customers[
      customerIndex
    ]!;
  return {
    source: customer,
    purchaseCount,
    lifecycle:
      purchaseCount > 0
        ? "repeat_customer"
        : "prospect",
    need: customer.currentPurchaseNeed,
    brandAffinity: customer.brandAffinity,
  };
}

function scenarioWith(
  fixture: ReturnType<
    typeof createMarginDestructionTrapFixture
  >,
  promotions: readonly PromotionDefinition[],
): PricingPromotionScenario {
  const hydrated =
    hydratePricingPromotionScenario(
      fixture.evaluation,
    );
  return {
    ...hydrated,
    promotions,
  };
}

describe("Step 10 promotion mechanics", () => {
  it("free shipping changes shipping economics without changing product price", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const promotion: PromotionDefinition = {
      promotionId: "free-ship",
      mechanic: "free_shipping",
      scope: { kind: "sitewide" },
      start: fixture.evaluation.periodStart,
      end: fixture.evaluation.periodEnd,
      awarenessProbability: 1,
    };
    const scenario = scenarioWith(fixture, [
      promotion,
    ]);
    const customer = context(fixture);
    const state = scenario.priceStates.find(
      (candidate) =>
        candidate.productId === fixture.productAId,
    )!;
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );

    const offer = resolveProductOffer(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      fixture.productAId,
      timestamp,
      state.regularPriceMinor,
    );
    const shipping = resolveCartShippingTerms(
      scenario,
      customer,
      timestamp,
      state.regularPriceMinor,
      15_000,
    );

    expect(offer.effectivePriceMinor).toBe(
      state.currentSellingPriceMinor,
    );
    expect(offer.discountMinor).toBe(0);
    expect(shipping.freeShipping).toBe(true);
    expect(
      shipping.customerShippingChargeOverrideMinor,
    ).toBe(0);
  });

  it("fixed order credits allocate to real SKU lines rather than fictional bundle revenue", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario = scenarioWith(fixture, [
      {
        promotionId: "fixed-50",
        mechanic: "fixed_discount",
        scope: { kind: "sitewide" },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        fixedAmountMinor: 5_000,
        fixedDiscountAllocation: "order",
        awarenessProbability: 1,
      },
    ]);
    const customer = context(fixture);
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );
    const a = scenario.priceStates.find(
      (state) =>
        state.productId === fixture.productAId,
    )!;
    const b = scenario.priceStates.find(
      (state) =>
        state.productId === fixture.productBId,
    )!;

    const lines = resolveCartLinePricing(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      timestamp,
      [
        {
          productId: fixture.productAId,
          quantity: 1,
          fallbackBasePriceMinor:
            a.regularPriceMinor,
        },
        {
          productId: fixture.productBId,
          quantity: 1,
          fallbackBasePriceMinor:
            b.regularPriceMinor,
        },
      ],
    );

    expect(
      lines.reduce(
        (sum, line) => sum + line.discountMinor,
        0,
      ),
    ).toBe(5_000);
    expect(
      lines.every(
        (line) => line.effectiveUnitPriceMinor > 0,
      ),
    ).toBe(true);
  });

  it("bundle discounts require components and remain allocated to component SKUs", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario = scenarioWith(fixture, [
      {
        promotionId: "bundle-ab",
        mechanic: "bundle",
        scope: {
          kind: "sku_set",
          productIds: [
            fixture.productAId,
            fixture.productBId,
          ],
        },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        bundle: {
          requiredProductIds: [
            fixture.productAId,
            fixture.productBId,
          ],
          percentageOff: 0.15,
        },
        awarenessProbability: 1,
      },
    ]);
    const customer = context(fixture);
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );
    const stateFor = (productId: string) =>
      scenario.priceStates.find(
        (state) => state.productId === productId,
      )!;

    const oneComponent = resolveCartLinePricing(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      timestamp,
      [
        {
          productId: fixture.productAId,
          quantity: 1,
          fallbackBasePriceMinor:
            stateFor(fixture.productAId)
              .regularPriceMinor,
        },
      ],
    );
    const bundle = resolveCartLinePricing(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      timestamp,
      [
        {
          productId: fixture.productAId,
          quantity: 1,
          fallbackBasePriceMinor:
            stateFor(fixture.productAId)
              .regularPriceMinor,
        },
        {
          productId: fixture.productBId,
          quantity: 1,
          fallbackBasePriceMinor:
            stateFor(fixture.productBId)
              .regularPriceMinor,
        },
      ],
    );

    expect(oneComponent[0]!.discountMinor).toBe(0);
    expect(
      bundle.reduce(
        (sum, line) => sum + line.discountMinor,
        0,
      ),
    ).toBeGreaterThan(0);
    expect(
      new Set(bundle.map((line) => line.productId)),
    ).toEqual(
      new Set([
        fixture.productAId,
        fixture.productBId,
      ]),
    );
  });

  it("bundle offers can create a genuine missing-component purchase opportunity", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario = scenarioWith(fixture, [
      {
        promotionId: "bundle-incremental-ab",
        mechanic: "bundle",
        scope: {
          kind: "sku_set",
          productIds: [
            fixture.productAId,
            fixture.productBId,
          ],
        },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        bundle: {
          requiredProductIds: [
            fixture.productAId,
            fixture.productBId,
          ],
          percentageOff: 0.15,
        },
        awarenessProbability: 1,
      },
    ]);
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );
    const customer = context(fixture);

    const opportunity = bundleAttachmentOpportunity(
      scenario,
      customer,
      timestamp,
      [fixture.productAId],
    );
    expect(opportunity).toBeDefined();
    expect(opportunity?.productId).toBe(
      fixture.productBId,
    );
    expect(opportunity?.probability).toBeGreaterThan(0);

    expect(
      bundleAttachmentOpportunity(
        scenario,
        customer,
        timestamp,
        [
          fixture.productAId,
          fixture.productBId,
        ],
      ),
    ).toBeUndefined();
  });

  it("loyalty eligibility uses prior observable purchase state rather than future value", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario = scenarioWith(fixture, [
      {
        promotionId: "repeat-only",
        mechanic: "loyalty_percentage",
        scope: { kind: "sitewide" },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        percentageOff: 0.2,
        targeting: {
          customerState: "repeat",
          minimumPriorPurchases: 1,
        },
        awarenessProbability: 1,
      },
    ]);
    const state = scenario.priceStates.find(
      (candidate) =>
        candidate.productId === fixture.productAId,
    )!;
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );

    const prospect = resolveProductOffer(
      fixture.evaluation.merchantWorld,
      scenario,
      context(fixture, 0, 0),
      fixture.productAId,
      timestamp,
      state.regularPriceMinor,
    );
    const repeat = resolveProductOffer(
      fixture.evaluation.merchantWorld,
      scenario,
      context(fixture, 0, 2),
      fixture.productAId,
      timestamp,
      state.regularPriceMinor,
    );

    expect(prospect.discountMinor).toBe(0);
    expect(repeat.discountMinor).toBeGreaterThan(0);
  });


  it("free-shipping threshold replacement supports both upward and downward interventions", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const customer = context(fixture);
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );

    const higher = scenarioWith(fixture, [
      {
        promotionId: "threshold-up",
        mechanic: "free_shipping_threshold",
        scope: { kind: "sitewide" },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        freeShippingThresholdMinor: 12_500,
        awarenessProbability: 1,
      },
    ]);
    const lower = scenarioWith(fixture, [
      {
        promotionId: "threshold-down",
        mechanic: "free_shipping_threshold",
        scope: { kind: "sitewide" },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        freeShippingThresholdMinor: 8_000,
        awarenessProbability: 1,
      },
    ]);

    expect(
      resolveCartShippingTerms(
        higher,
        customer,
        timestamp,
        11_000,
        10_000,
      ).freeShipping,
    ).toBe(false);
    expect(
      resolveCartShippingTerms(
        lower,
        customer,
        timestamp,
        9_000,
        15_000,
      ).freeShipping,
    ).toBe(true);
  });

  it("coupon minimum spend and redemption rules gate the realized discount", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const hydrated =
      hydratePricingPromotionScenario(
        fixture.evaluation,
      );
    const state = hydrated.priceStates.find(
      (candidate) =>
        candidate.productId === fixture.productAId,
    )!;
    const minimumSpend =
      state.regularPriceMinor + 1;
    const scenario = scenarioWith(fixture, [
      {
        promotionId: "coupon-20",
        mechanic: "coupon",
        scope: {
          kind: "sku_set",
          productIds: [fixture.productAId],
        },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        percentageOff: 0.2,
        minimumSpendMinor: minimumSpend,
        awarenessProbability: 1,
        redemptionProbability: 1,
      },
    ]);
    const customer = context(fixture);
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );

    const below = resolveCartLinePricing(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      timestamp,
      [
        {
          productId: fixture.productAId,
          quantity: 1,
          fallbackBasePriceMinor:
            state.regularPriceMinor,
        },
      ],
    );
    const above = resolveCartLinePricing(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      timestamp,
      [
        {
          productId: fixture.productAId,
          quantity: 2,
          fallbackBasePriceMinor:
            state.regularPriceMinor,
        },
      ],
    );

    expect(below[0]!.discountMinor).toBe(0);
    expect(above[0]!.discountMinor).toBeGreaterThan(0);
    expect(
      above[0]!.promotionIds,
    ).toContain("coupon-20");
  });

  it("suppresses later replenishment demand for stockpiling only after extra quantity is actually purchased", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const scenario = scenarioWith(fixture, [
      {
        promotionId: "stockpile-sale",
        mechanic: "percentage_discount",
        scope: { kind: "sitewide" },
        start: fixture.evaluation.periodStart,
        end: fixture.evaluation.periodEnd,
        percentageOff: 0.25,
        awarenessProbability: 1,
        stockpilingEligible: true,
      },
    ]);
    const customer = context(fixture);
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );

    const singleUnit =
      promotionTimingDeferralMultiplier(
        fixture.evaluation.merchantWorld,
        scenario,
        customer,
        timestamp,
        [
          {
            productId: fixture.productAId,
            quantity: 1,
          },
        ],
      );
    const realizedStockpile =
      promotionTimingDeferralMultiplier(
        fixture.evaluation.merchantWorld,
        scenario,
        customer,
        timestamp,
        [
          {
            productId: fixture.productAId,
            quantity: 2,
          },
        ],
      );

    expect(singleUnit).toBeGreaterThanOrEqual(1);
    expect(realizedStockpile).toBeGreaterThan(
      singleUnit,
    );
  });

  it("explicit collection membership scopes an offer without inventing frozen collection truth", () => {
    const fixture =
      createMarginDestructionTrapFixture();
    const hydrated =
      hydratePricingPromotionScenario(
        fixture.evaluation,
      );
    const scenario: PricingPromotionScenario = {
      ...hydrated,
      collectionSource:
        "step10_explicit_synthetic_membership",
      collectionMembership: {
        clearance: [fixture.productAId],
      },
      promotions: [
        {
          promotionId: "collection-sale",
          mechanic: "percentage_discount",
          scope: {
            kind: "collection",
            collectionIds: ["clearance"],
          },
          start: fixture.evaluation.periodStart,
          end: fixture.evaluation.periodEnd,
          percentageOff: 0.1,
          awarenessProbability: 1,
        },
      ],
    };
    const timestamp = Date.parse(
      fixture.evaluation.periodStart,
    );
    const customer = context(fixture);
    const price = (productId: string) =>
      scenario.priceStates.find(
        (state) => state.productId === productId,
      )!.regularPriceMinor;

    const a = resolveProductOffer(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      fixture.productAId,
      timestamp,
      price(fixture.productAId),
    );
    const b = resolveProductOffer(
      fixture.evaluation.merchantWorld,
      scenario,
      customer,
      fixture.productBId,
      timestamp,
      price(fixture.productBId),
    );

    expect(a.discountMinor).toBeGreaterThan(0);
    expect(b.discountMinor).toBe(0);
  });
});
