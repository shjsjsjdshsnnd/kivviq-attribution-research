import { describe, expect, it } from "vitest";
import { currencyCode } from "../../src/core/units.js";
import {
  evaluatePromotionEligibility,
} from "../../src/promotion/eligibility.js";
import {
  startBundleAB999Cad,
  startCollection15ContributionMargin20,
  startFurniture15ExcludingBrandX,
  startNewCustomer20,
  startOneRedemptionPerCustomer,
  startOrder15Above1000Cad,
  startVipSegmentA20,
} from "../../src/promotion/fixtures.js";

const CAD = currencyCode("CAD");

describe("Step 5 deterministic promotion eligibility", () => {
  it("distinguishes eligible and excluded products with exclusion precedence", () => {
    const eligible = evaluatePromotionEligibility(
      startFurniture15ExcludingBrandX,
      {
        product: {
          productId: "product:chair",
          categoryIds: ["category:furniture"],
          brandId: "brand:Y",
          isClearance: false,
        },
        hardConstraintResults: {},
      },
    );
    expect(eligible.status).toBe("eligible");

    const excluded = evaluatePromotionEligibility(
      startFurniture15ExcludingBrandX,
      {
        product: {
          productId: "product:chair",
          categoryIds: ["category:furniture"],
          brandId: "brand:X",
          isClearance: false,
        },
        hardConstraintResults: {},
      },
    );
    expect(excluded).toMatchObject({
      status: "ineligible",
      reasonCodes: ["PRODUCT_EXCLUDED"],
    });
  });

  it("handles eligible, ineligible and unknown customer classification", () => {
    expect(
      evaluatePromotionEligibility(startNewCustomer20, {
        customer: { lifecycle: "new" },
        hardConstraintResults: {},
      }).status,
    ).toBe("eligible");

    expect(
      evaluatePromotionEligibility(startNewCustomer20, {
        customer: { lifecycle: "returning" },
        hardConstraintResults: {},
      }).status,
    ).toBe("ineligible");

    expect(
      evaluatePromotionEligibility(startNewCustomer20, {
        hardConstraintResults: {},
      }).status,
    ).toBe("unknown");
  });

  it("evaluates explicit customer and loyalty segments without inventing future membership", () => {
    expect(
      evaluatePromotionEligibility(startVipSegmentA20, {
        customer: { loyaltySegmentIds: ["vip:A"] },
        hardConstraintResults: {},
      }).status,
    ).toBe("eligible");
    expect(
      evaluatePromotionEligibility(startVipSegmentA20, {
        customer: { loyaltySegmentIds: ["vip:B"] },
        hardConstraintResults: {},
      }).status,
    ).toBe("ineligible");
    expect(
      evaluatePromotionEligibility(startVipSegmentA20, {
        customer: {},
        hardConstraintResults: {},
      }).status,
    ).toBe("unknown");
  });

  it("evaluates qualifying and non-qualifying order value with explicit currency", () => {
    expect(
      evaluatePromotionEligibility(startOrder15Above1000Cad, {
        cart: {
          subtotal: { kind: "money", amountMinor: 120_000, currency: CAD },
          lines: [],
        },
        hardConstraintResults: {},
      }).status,
    ).toBe("eligible");

    expect(
      evaluatePromotionEligibility(startOrder15Above1000Cad, {
        cart: {
          subtotal: { kind: "money", amountMinor: 90_000, currency: CAD },
          lines: [],
        },
        hardConstraintResults: {},
      }).status,
    ).toBe("ineligible");
  });

  it("evaluates bundle qualification", () => {
    const qualified = evaluatePromotionEligibility(startBundleAB999Cad, {
      cart: {
        subtotal: { kind: "money", amountMinor: 150_000, currency: CAD },
        lines: [
          { productId: "product:A", quantity: 1 },
          { productId: "product:B", quantity: 1 },
        ],
      },
      hardConstraintResults: {},
    });
    expect(qualified.status).toBe("eligible");

    const missing = evaluatePromotionEligibility(startBundleAB999Cad, {
      cart: {
        subtotal: { kind: "money", amountMinor: 100_000, currency: CAD },
        lines: [{ productId: "product:A", quantity: 1 }],
      },
      hardConstraintResults: {},
    });
    expect(missing.status).toBe("ineligible");
  });

  it("preserves hard economic constraint eligible/ineligible/unknown states", () => {
    expect(
      evaluatePromotionEligibility(startCollection15ContributionMargin20, {
        product: {
          collectionIds: ["collection:X"],
        },
        hardConstraintResults: {
          promo_contribution_margin_20: "satisfied",
        },
      }).status,
    ).toBe("eligible");

    expect(
      evaluatePromotionEligibility(startCollection15ContributionMargin20, {
        product: {
          collectionIds: ["collection:X"],
        },
        hardConstraintResults: {
          promo_contribution_margin_20: "violated",
        },
      }).status,
    ).toBe("ineligible");

    expect(
      evaluatePromotionEligibility(startCollection15ContributionMargin20, {
        product: {
          collectionIds: ["collection:X"],
        },
        hardConstraintResults: {
          promo_contribution_margin_20: "unknown",
        },
      }).status,
    ).toBe("unknown");
  });

  it("enforces redemption limits while preserving unknown", () => {
    expect(
      evaluatePromotionEligibility(startOneRedemptionPerCustomer, {
        redemption: { customerRedemptions: 0 },
        hardConstraintResults: {},
      }).status,
    ).toBe("eligible");

    expect(
      evaluatePromotionEligibility(startOneRedemptionPerCustomer, {
        redemption: { customerRedemptions: 1 },
        hardConstraintResults: {},
      }).status,
    ).toBe("ineligible");

    expect(
      evaluatePromotionEligibility(startOneRedemptionPerCustomer, {
        hardConstraintResults: {},
      }).status,
    ).toBe("unknown");
  });

  it("enforces non-stackable restrictions using current active-promotion facts", () => {
    expect(
      evaluatePromotionEligibility(startFurniture15ExcludingBrandX, {
        product: {
          categoryIds: ["category:furniture"],
          brandId: "brand:Y",
          isClearance: false,
        },
        activePromotionTypes: ["COUPON"],
        hardConstraintResults: {},
      }).status,
    ).toBe("ineligible");
  });
});
