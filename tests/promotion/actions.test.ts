import { describe, expect, it } from "vitest";
import {
  actionFingerprint,
} from "../../src/action_ontology/semantics.js";
import {
  serializeAction,
} from "../../src/action_ontology/serialization.js";
import {
  validateAction,
} from "../../src/action_ontology/validation.js";
import {
  reduceCollectionX15Percent,
} from "../../src/pricing/fixtures.js";
import {
  invalidPercentagePromotion,
  modifyCollectionX15To20,
  startAutomaticCollectionX15FourDays,
  startBundleAB15Percent,
  startBundleAB999Cad,
  startBuyAGet20OffB,
  startCollectionXFall15Coupon,
  startFirst500Redemptions,
  startFurniture15ExcludingBrandX,
  startOneRedemptionPerCustomer,
  startOrder15Above1000Cad,
  startProductA100CadOff,
  startSkuAFixedPromotionalPrice749,
  stopCollectionXAutomatic15,
} from "../../src/promotion/fixtures.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Step 5 canonical promotion Actions", () => {
  it("keeps regular pricing and promotion semantics distinct", () => {
    expect(reduceCollectionX15Percent.actionType).toBe("pricing.adjust_price");
    expect(startAutomaticCollectionX15FourDays.actionType).toBe(
      "promotion.start",
    );
    expect(actionFingerprint(reduceCollectionX15Percent)).not.toBe(
      actionFingerprint(startAutomaticCollectionX15FourDays),
    );
    expect(serializeAction(reduceCollectionX15Percent)).not.toBe(
      serializeAction(startAutomaticCollectionX15FourDays),
    );
  });

  it("distinguishes automatic and coupon-required promotions", () => {
    expect(
      startAutomaticCollectionX15FourDays.parameters.kind,
    ).toBe("promotion_start");
    expect(startCollectionXFall15Coupon.parameters.kind).toBe(
      "promotion_start",
    );
    if (
      startAutomaticCollectionX15FourDays.parameters.kind !== "promotion_start" ||
      startCollectionXFall15Coupon.parameters.kind !== "promotion_start"
    ) {
      return;
    }

    expect(
      startAutomaticCollectionX15FourDays.parameters.definition.redemption,
    ).toEqual({ kind: "AUTOMATIC" });
    expect(
      startCollectionXFall15Coupon.parameters.definition.redemption,
    ).toEqual({ kind: "COUPON", code: "FALL15" });
    expect(actionFingerprint(startAutomaticCollectionX15FourDays)).not.toBe(
      actionFingerprint(startCollectionXFall15Coupon),
    );
  });

  it("distinguishes percentage, fixed amount and fixed promotional price", () => {
    const actions = [
      startAutomaticCollectionX15FourDays,
      startProductA100CadOff,
      startSkuAFixedPromotionalPrice749,
    ];
    const fingerprints = new Set(actions.map(actionFingerprint));
    expect(fingerprints.size).toBe(3);

    if (startProductA100CadOff.parameters.kind === "promotion_start") {
      expect(
        startProductA100CadOff.parameters.definition.mechanism,
      ).toMatchObject({
        kind: "DISCOUNT",
        discount: {
          kind: "FIXED_AMOUNT",
          value: {
            kind: "money",
            amountMinor: 10_000,
            currency: "CAD",
          },
        },
      });
    }
    if (startSkuAFixedPromotionalPrice749.parameters.kind === "promotion_start") {
      expect(
        startSkuAFixedPromotionalPrice749.parameters.definition.mechanism,
      ).toMatchObject({
        kind: "DISCOUNT",
        discount: {
          kind: "FIXED_PROMOTIONAL_PRICE",
          value: {
            kind: "money",
            amountMinor: 74_900,
            currency: "CAD",
          },
        },
      });
    }
  });

  it("represents fixed-price, percentage and conditional bundle mechanics structurally", () => {
    if (startBundleAB999Cad.parameters.kind === "promotion_start") {
      expect(startBundleAB999Cad.parameters.definition.mechanism).toMatchObject({
        kind: "BUNDLE_FIXED_PRICE",
        bundlePrice: {
          kind: "money",
          amountMinor: 99_900,
          currency: "CAD",
        },
      });
    }
    if (startBundleAB15Percent.parameters.kind === "promotion_start") {
      expect(
        startBundleAB15Percent.parameters.definition.mechanism,
      ).toMatchObject({
        kind: "BUNDLE_PERCENTAGE_DISCOUNT",
        basisPoints: 1500,
      });
    }
    if (startBuyAGet20OffB.parameters.kind === "promotion_start") {
      expect(startBuyAGet20OffB.parameters.definition.mechanism).toMatchObject({
        kind: "CONDITIONAL_ITEM_DISCOUNT",
        rewardTarget: {
          kind: "product",
          productId: "product:B",
        },
        rewardQuantity: 1,
        discount: {
          kind: "PERCENTAGE",
          basisPoints: 2000,
        },
      });
    }
  });

  it("models order eligibility with explicit currency", () => {
    if (startOrder15Above1000Cad.parameters.kind !== "promotion_start") return;
    expect(
      startOrder15Above1000Cad.parameters.definition.purchaseRequirements,
    ).toEqual([
      {
        kind: "MIN_ORDER_VALUE",
        value: {
          kind: "money",
          amountMinor: 100_000,
          currency: "CAD",
        },
      },
    ]);
  });

  it("uses explicit exclusion precedence and canonical Brand exclusion", () => {
    if (
      startFurniture15ExcludingBrandX.parameters.kind !== "promotion_start"
    ) {
      return;
    }
    const scope =
      startFurniture15ExcludingBrandX.parameters.definition.applicationScope;
    expect(scope.kind).toBe("PRODUCT_SCOPE");
    if (scope.kind !== "PRODUCT_SCOPE") return;

    expect(scope.products.include).toContainEqual({
      kind: "category",
      categoryId: "category:furniture",
    });
    expect(scope.products.exclude).toContainEqual({
      kind: "brand",
      brandId: "brand:X",
    });
    expect(scope.products.exclusionPrecedence).toBe(
      "EXCLUDE_OVERRIDES_INCLUDE",
    );
    expect(scope.products.membership?.bindingRef).toBeTruthy();
  });

  it("distinguishes absent usage limits from explicit limits including zero", () => {
    if (
      startOneRedemptionPerCustomer.parameters.kind !== "promotion_start" ||
      startFirst500Redemptions.parameters.kind !== "promotion_start"
    ) {
      return;
    }
    expect(
      startOneRedemptionPerCustomer.parameters.definition.usageLimits,
    ).toEqual({ maxRedemptionsPerCustomer: 1 });
    expect(
      startFirst500Redemptions.parameters.definition.usageLimits,
    ).toEqual({ maxTotalRedemptions: 500 });

    const zero = clone(startFirst500Redemptions);
    zero.actionId = "action_promo_zero_redemptions";
    zero.target.promotionId = "promo_zero_redemptions";
    zero.parameters.promotionId = "promo_zero_redemptions";
    zero.parameters.definition.usageLimits = { maxTotalRedemptions: 0 };
    expect(validateAction(zero).ok).toBe(true);
  });

  it("keeps START, STOP and MODIFY semantically distinct", () => {
    expect(startAutomaticCollectionX15FourDays.actionType).toBe(
      "promotion.start",
    );
    expect(stopCollectionXAutomatic15.actionType).toBe("promotion.stop");
    expect(modifyCollectionX15To20.actionType).toBe("promotion.modify");

    const fingerprints = new Set([
      actionFingerprint(startAutomaticCollectionX15FourDays),
      actionFingerprint(stopCollectionXAutomatic15),
      actionFingerprint(modifyCollectionX15To20),
    ]);
    expect(fingerprints.size).toBe(3);
  });

  it("requires stable promotion identity and matching target reference", () => {
    const invalid = clone(stopCollectionXAutomatic15);
    invalid.parameters.targetPromotionId = "promo_other";
    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((issue) => issue.code === "PROMOTION_ID_MISMATCH"),
      ).toBe(true);
    }
  });

  it("requires coupon code or downstream code-family reference exactly once", () => {
    const invalid = clone(startCollectionXFall15Coupon);
    delete invalid.parameters.definition.redemption.code;
    const first = validateAction(invalid);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some((issue) => issue.code === "INVALID_COUPON_REFERENCE"),
      ).toBe(true);
    }

    const both = clone(startCollectionXFall15Coupon);
    both.parameters.definition.redemption.codeFamilyRef = "coupon-family:fall";
    const second = validateAction(both);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some((issue) => issue.code === "INVALID_COUPON_REFERENCE"),
      ).toBe(true);
    }
  });

  it("rejects invalid percentage discounts", () => {
    const result = validateAction(invalidPercentagePromotion);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "INVALID_PROMOTION_PERCENTAGE",
        ),
      ).toBe(true);
    }
  });

  it("preserves schema compatibility while gating 1.3 promotion features", () => {
    expect(startAutomaticCollectionX15FourDays.schemaVersion).toBe("1.3.0");
    const mislabeled = clone(startAutomaticCollectionX15FourDays);
    mislabeled.schemaVersion = "1.2.0";
    const result = validateAction(mislabeled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "SCHEMA_FEATURE_REQUIRES_1_3",
        ),
      ).toBe(true);
    }
  });

  it("rejects promotion outcome/prediction leakage", () => {
    for (const key of [
      "expectedDemandLift",
      "expectedRevenue",
      "expectedConversions",
      "expectedProfit",
      "expectedROAS",
      "predictedRedemptions",
      "predictedAOV",
      "futureDemand",
      "counterfactualRevenue",
      "recommendationScore",
      "confidenceScore",
    ]) {
      const invalid = clone(startAutomaticCollectionX15FourDays);
      invalid[key] = 123;
      const result = validateAction(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some(
            (issue) => issue.code === "FORBIDDEN_ACTION_INFORMATION",
          ),
        ).toBe(true);
      }
    }
  });
});
