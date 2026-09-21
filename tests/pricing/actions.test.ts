import { describe, expect, it } from "vitest";
import {
  actionFingerprint,
} from "../../src/action_ontology/semantics.js";
import {
  serializeAction,
} from "../../src/action_ontology/serialization.js";
import {
  eligibilityInformationRequirements,
} from "../../src/action_ontology/eligibility.js";
import {
  validateAction,
} from "../../src/action_ontology/validation.js";
import {
  runCollectionPromotion15FourDays,
  reduceProductPrice10 as legacyStep1PriceAction,
} from "../../src/action_ontology/fixtures.js";
import {
  increaseProductX5Percent,
  increaseSkuA50Cad,
  invalidMissingCurrencyPriceAction,
  invalidNegativePriceAction,
  reduceCategoryX10Percent,
  reduceCollectionX15Percent,
  reduceSkuA10Percent,
  reduceSkuA10WithGrossMargin35Floor,
  reduceSkuB10WithContributionMargin20Floor,
  setSkuA849Cad,
  setSkuA949EffectiveOctober1,
  temporaryCollectionX10PercentSevenDays,
  temporarySkuA799SevenDays,
} from "../../src/pricing/fixtures.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Step 4 canonical pricing Actions", () => {
  it("supports distinct SET, DELTA and MULTIPLY price semantics", () => {
    expect(setSkuA849Cad.parameters.kind).toBe("price_adjustment");
    expect(increaseSkuA50Cad.parameters.kind).toBe("price_adjustment");
    expect(reduceSkuA10Percent.parameters.kind).toBe("price_adjustment");

    if (setSkuA849Cad.parameters.kind === "price_adjustment") {
      expect(setSkuA849Cad.parameters.operation).toEqual({
        kind: "SET",
        value: { kind: "money", amountMinor: 84_900, currency: "CAD" },
      });
    }
    if (increaseSkuA50Cad.parameters.kind === "price_adjustment") {
      expect(increaseSkuA50Cad.parameters.operation).toMatchObject({
        kind: "DELTA",
        direction: "increase",
        amount: { kind: "money", amountMinor: 5_000, currency: "CAD" },
      });
    }
    if (reduceSkuA10Percent.parameters.kind === "price_adjustment") {
      expect(reduceSkuA10Percent.parameters.operation).toMatchObject({
        kind: "MULTIPLY",
        factor: 0.9,
      });
    }
  });

  it("keeps SET, DELTA and MULTIPLY semantically distinct", () => {
    const fingerprints = new Set([
      actionFingerprint(setSkuA849Cad),
      actionFingerprint(increaseSkuA50Cad),
      actionFingerprint(reduceSkuA10Percent),
    ]);
    expect(fingerprints.size).toBe(3);
    expect(serializeAction(setSkuA849Cad)).not.toBe(
      serializeAction(increaseSkuA50Cad),
    );
  });

  it("keeps SKU and product-level price Actions distinct", () => {
    expect(setSkuA849Cad.target.kind).toBe("sku");
    expect(increaseProductX5Percent.target.kind).toBe("product");
    expect(actionFingerprint(setSkuA849Cad)).not.toBe(
      actionFingerprint(increaseProductX5Percent),
    );
  });

  it("requires explicit membership semantics for 1.2 product/category/collection pricing", () => {
    for (const action of [
      increaseProductX5Percent,
      reduceCategoryX10Percent,
      reduceCollectionX15Percent,
    ]) {
      expect(validateAction(action).ok).toBe(true);
      if (action.parameters.kind === "price_adjustment") {
        expect(action.parameters.membership).toBeDefined();
        expect(action.parameters.membership?.bindingRef).toBeTruthy();
      }
    }

    const invalid = clone(increaseProductX5Percent);
    delete invalid.parameters.membership;
    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) =>
            issue.code === "MISSING_PRICING_MEMBERSHIP_SEMANTICS",
        ),
      ).toBe(true);
    }
  });

  it("preserves future effective dates independently of decision time", () => {
    expect(setSkuA949EffectiveOctober1.timing.decisionTime).toBe(
      "2026-09-20T13:00:00Z",
    );
    expect(setSkuA949EffectiveOctober1.timing.requestedStart).toEqual({
      kind: "known",
      at: "2026-10-01T04:00:00Z",
    });
    expect(setSkuA949EffectiveOctober1.timing.effectiveStart).toEqual({
      kind: "known",
      at: "2026-10-01T04:00:00Z",
    });
  });

  it("distinguishes persistent and temporary pricing in semantic identity", () => {
    expect(reduceCollectionX15Percent.duration.kind).toBe("persistent");
    expect(temporaryCollectionX10PercentSevenDays.duration).toEqual({
      kind: "temporary",
      durationSeconds: 7 * 24 * 60 * 60,
    });
    expect(actionFingerprint(reduceCollectionX15Percent)).not.toBe(
      actionFingerprint(temporaryCollectionX10PercentSevenDays),
    );
  });

  it("requires temporary pricing to carry safe conflict-protected rollback metadata", () => {
    expect(
      temporarySkuA799SevenDays.reversibility.pricingRollback,
    ).toMatchObject({
      available: true,
      strategy: { kind: "RESTORE_PRE_ACTION_VALUE" },
      conflictGuard: {
        kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      },
    });

    const invalid = clone(temporarySkuA799SevenDays);
    delete invalid.reversibility.pricingRollback;
    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "TEMPORARY_PRICE_REQUIRES_SAFE_ROLLBACK",
        ),
      ).toBe(true);
    }
  });

  it("keeps regular pricing distinct from promotion semantics", () => {
    expect(reduceCollectionX15Percent.actionType).toBe("pricing.adjust_price");
    expect(runCollectionPromotion15FourDays.actionType).toBe(
      "promotion.apply_discount",
    );
    expect(actionFingerprint(reduceCollectionX15Percent)).not.toBe(
      actionFingerprint(runCollectionPromotion15FourDays),
    );
  });

  it("uses precise gross-margin and contribution-margin metric identities", () => {
    expect(reduceSkuA10WithGrossMargin35Floor.constraints[0]).toMatchObject({
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.gross_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 3500 },
      },
    });
    expect(
      reduceSkuB10WithContributionMargin20Floor.constraints[0],
    ).toMatchObject({
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.contribution_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 2000 },
      },
    });
  });

  it("exposes missing economic inputs as eligibility information requirements", () => {
    const requirements = eligibilityInformationRequirements(
      reduceSkuB10WithContributionMargin20Floor,
    );
    expect(
      requirements.some(
        (requirement) =>
          requirement.kind === "business_property" &&
          requirement.reference === "finance.contribution_margin_rate",
      ),
    ).toBe(true);
    expect(
      requirements.some(
        (requirement) =>
          requirement.kind === "evidence" &&
          requirement.reference ===
            "product_economics:contribution_inputs:sku:B",
      ),
    ).toBe(true);
  });

  it("rejects negative and currency-less absolute prices", () => {
    const negative = validateAction(invalidNegativePriceAction);
    expect(negative.ok).toBe(false);
    if (!negative.ok) {
      expect(
        negative.errors.some(
          (issue) => issue.code === "INVALID_MONEY_MINOR",
        ),
      ).toBe(true);
    }

    const missingCurrency = validateAction(invalidMissingCurrencyPriceAction);
    expect(missingCurrency.ok).toBe(false);
    if (!missingCurrency.ok) {
      expect(
        missingCurrency.errors.some(
          (issue) => issue.code === "INVALID_CURRENCY",
        ),
      ).toBe(true);
    }
  });

  it("rejects price DELTA currency mismatch and negative resulting explicit prices", () => {
    const mismatch = clone(increaseSkuA50Cad);
    mismatch.parameters.operation.amount.currency = "USD";
    const first = validateAction(mismatch);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some(
          (issue) => issue.code === "PRICE_CURRENCY_MISMATCH",
        ),
      ).toBe(true);
    }

    const belowZero = clone(increaseSkuA50Cad);
    belowZero.parameters.operation.direction = "decrease";
    belowZero.parameters.operation.amount.amountMinor = 100_000;
    const second = validateAction(belowZero);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some(
          (issue) => issue.code === "PRICE_WOULD_BECOME_NEGATIVE",
        ),
      ).toBe(true);
    }
  });

  it("preserves schema compatibility without allowing 1.2 features to masquerade as older schemas", () => {
    expect(legacyStep1PriceAction.schemaVersion).toBe("1.0.0");
    expect(validateAction(legacyStep1PriceAction).ok).toBe(true);
    expect(setSkuA849Cad.schemaVersion).toBe("1.2.0");

    const mislabeled = clone(reduceCollectionX15Percent);
    mislabeled.schemaVersion = "1.1.0";
    const result = validateAction(mislabeled);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "SCHEMA_FEATURE_REQUIRES_1_2",
        ),
      ).toBe(true);
    }
  });

  it("rejects embedded pricing outcome/evaluation leakage", () => {
    for (const key of [
      "expectedDemand",
      "expectedUnitsSold",
      "expectedRevenue",
      "expectedProfit",
      "expectedContribution",
      "predictedElasticity",
      "predictedLift",
      "futureDemand",
      "futureMargin",
      "counterfactualRevenue",
      "recommendationScore",
      "confidenceScore",
    ]) {
      const invalid = clone(reduceSkuA10Percent);
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
