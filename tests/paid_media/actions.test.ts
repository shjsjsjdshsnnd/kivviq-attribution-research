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
  blackFridayProspectingFourDays,
  decreaseMetaProspectingBudget500PerDay,
  googleBrandNonBrand15_85,
  increaseGoogleShoppingBudget20,
  increaseMeta20Percent,
  increaseMeta500PerDay,
  increaseProductWithContributionMarginFloor,
  increaseSkuAAdvertising20,
  metaProspectingRetargeting75_25,
  pauseLowInventorySkuB,
  pauseMetaCampaignA,
  resumeGoogleCampaignB,
  setMeta500PerDay,
  setMetaCampaignBudgetZero,
  setPinterestBudget300PerDay,
  unsupportedTikTokSpendCap,
} from "../../src/paid_media/fixtures.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Step 3 paid-media canonical Actions", () => {
  it("supports SET, DELTA and MULTIPLY budget semantics without collapse", () => {
    expect(setPinterestBudget300PerDay.parameters.kind).toBe("budget_adjustment");
    expect(decreaseMetaProspectingBudget500PerDay.parameters.kind).toBe(
      "budget_adjustment",
    );
    expect(increaseGoogleShoppingBudget20.parameters.kind).toBe(
      "budget_adjustment",
    );

    if (setPinterestBudget300PerDay.parameters.kind === "budget_adjustment") {
      expect(setPinterestBudget300PerDay.parameters.operation.kind).toBe("SET");
    }
    if (
      decreaseMetaProspectingBudget500PerDay.parameters.kind ===
      "budget_adjustment"
    ) {
      expect(
        decreaseMetaProspectingBudget500PerDay.parameters.operation.kind,
      ).toBe("DELTA");
      expect(
        decreaseMetaProspectingBudget500PerDay.parameters.operation,
      ).toMatchObject({
        direction: "decrease",
        amount: {
          kind: "money_rate",
          amountMinor: 50_000,
          currency: "CAD",
          per: "day",
        },
      });
    }
    if (increaseGoogleShoppingBudget20.parameters.kind === "budget_adjustment") {
      expect(increaseGoogleShoppingBudget20.parameters.operation).toMatchObject({
        kind: "MULTIPLY",
        factor: 1.2,
      });
    }
  });

  it("keeps material budget semantics distinct in fingerprints and serialization", () => {
    const fingerprints = new Set([
      actionFingerprint(increaseMeta500PerDay),
      actionFingerprint(setMeta500PerDay),
      actionFingerprint(increaseMeta20Percent),
    ]);
    expect(fingerprints.size).toBe(3);

    expect(serializeAction(increaseMeta500PerDay)).not.toBe(
      serializeAction(setMeta500PerDay),
    );
    expect(serializeAction(setMeta500PerDay)).not.toBe(
      serializeAction(increaseMeta20Percent),
    );
  });

  it("keeps PAUSE distinct from setting budget to zero", () => {
    expect(pauseMetaCampaignA.parameters.kind).toBe("paid_media_delivery");
    expect(setMetaCampaignBudgetZero.parameters.kind).toBe("budget_adjustment");
    expect(actionFingerprint(pauseMetaCampaignA)).not.toBe(
      actionFingerprint(setMetaCampaignBudgetZero),
    );
  });

  it("supports explicit PAUSE and RESUME operations", () => {
    expect(pauseMetaCampaignA.parameters).toEqual({
      kind: "paid_media_delivery",
      operation: "PAUSE",
    });
    expect(resumeGoogleCampaignB.parameters).toEqual({
      kind: "paid_media_delivery",
      operation: "RESUME",
    });
  });

  it("distinguishes budget from spend cap", () => {
    expect(increaseGoogleShoppingBudget20.actionType).toBe(
      "advertising.adjust_budget",
    );
    expect(unsupportedTikTokSpendCap.actionType).toBe(
      "advertising.adjust_spend_cap",
    );
    expect(unsupportedTikTokSpendCap.parameters.kind).toBe(
      "spend_cap_adjustment",
    );
    expect(actionFingerprint(increaseGoogleShoppingBudget20)).not.toBe(
      actionFingerprint(unsupportedTikTokSpendCap),
    );
  });

  it("represents prospecting and retargeting allocation with an explicit denominator", () => {
    expect(metaProspectingRetargeting75_25.parameters.kind).toBe(
      "paid_media_allocation",
    );
    if (
      metaProspectingRetargeting75_25.parameters.kind !==
      "paid_media_allocation"
    ) {
      return;
    }
    const parameters = metaProspectingRetargeting75_25.parameters;
    expect(parameters.denominator).toEqual({
      kind: "target_scope",
      control: "budget",
      target: { kind: "advertising_channel", channelId: "meta_ads" },
      scope: { dimensions: [] },
    });
    expect(
      parameters.shares.reduce(
        (total, share) => total + share.shareBasisPoints,
        0,
      ),
    ).toBe(10_000);
    expect(parameters.baselineShares?.map((share) => share.shareBasisPoints)).toEqual([
      6000,
      4000,
    ]);
    expect(parameters.shares.map((share) => share.shareBasisPoints)).toEqual([
      7500,
      2500,
    ]);
  });

  it("represents Brand / Non-Brand as business taxonomy with unknown-eligibility evidence requirement", () => {
    expect(googleBrandNonBrand15_85.parameters.kind).toBe(
      "paid_media_allocation",
    );
    const requirements = eligibilityInformationRequirements(
      googleBrandNonBrand15_85,
    );
    expect(
      requirements.some(
        (requirement) =>
          requirement.kind === "evidence" &&
          requirement.reference ===
            "paid_media.classification:google_search",
      ),
    ).toBe(true);
  });

  it("rejects allocations that do not total 100%", () => {
    const invalid = clone(metaProspectingRetargeting75_25);
    invalid.parameters.shares[0].shareBasisPoints = 7000;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) =>
            issue.code === "ALLOCATION_SHARES_MUST_SUM_100_PERCENT",
        ),
      ).toBe(true);
    }
  });

  it("rejects negative and >100% allocation shares", () => {
    const negative = clone(metaProspectingRetargeting75_25);
    negative.parameters.shares[0].shareBasisPoints = -1;
    negative.parameters.shares[1].shareBasisPoints = 10_001;
    const first = validateAction(negative);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some(
          (issue) => issue.code === "INVALID_ALLOCATION_SHARE",
        ),
      ).toBe(true);
    }

    const over = clone(metaProspectingRetargeting75_25);
    over.parameters.shares[0].shareBasisPoints = 10_001;
    over.parameters.shares[1].shareBasisPoints = 0;
    const second = validateAction(over);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some(
          (issue) => issue.code === "INVALID_ALLOCATION_SHARE",
        ),
      ).toBe(true);
    }
  });

  it("accepts backward-compatible schema 1.0 Actions while emitting Step 3 as 1.1", () => {
    expect(increaseGoogleShoppingBudget20.schemaVersion).toBe("1.1.0");

    const legacy = clone(increaseGoogleShoppingBudget20);
    legacy.schemaVersion = "1.0.0";
    expect(validateAction(legacy).ok).toBe(true);
  });

  it("rejects missing allocation denominator rather than inferring it", () => {
    const invalid = clone(googleBrandNonBrand15_85);
    delete invalid.parameters.denominator;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "AMBIGUOUS_ALLOCATION_DENOMINATOR",
        ),
      ).toBe(true);
    }
  });

  it("supports product/SKU paid-media Actions without assuming provider campaign structure", () => {
    expect(increaseSkuAAdvertising20.target).toEqual({
      kind: "sku",
      productId: "product:A",
      skuId: "sku:A",
    });
    expect(increaseSkuAAdvertising20.actionType).toBe(
      "advertising.adjust_budget",
    );
    expect("campaignId" in increaseSkuAAdvertising20.target).toBe(false);
  });

  it("uses existing hard constraints for inventory and contribution margin", () => {
    expect(pauseLowInventorySkuB.constraints[0]).toMatchObject({
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "inventory.available_units",
        operator: "LT",
      },
    });
    expect(
      increaseProductWithContributionMarginFloor.constraints[0],
    ).toMatchObject({
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "finance.contribution_margin_rate",
        operator: "GTE",
        value: { kind: "percentage", basisPoints: 3000 },
      },
    });
  });

  it("preserves explicit temporary Black Friday timing and duration", () => {
    expect(blackFridayProspectingFourDays.duration).toEqual({
      kind: "temporary",
      durationSeconds: 4 * 24 * 60 * 60,
    });
    expect(blackFridayProspectingFourDays.termination).toEqual({
      kind: "fixed_duration",
      durationSeconds: 4 * 24 * 60 * 60,
    });
    expect(blackFridayProspectingFourDays.timing.requestedStart).toEqual({
      kind: "known",
      at: "2026-11-27T05:00:00Z",
    });
    expect(
      blackFridayProspectingFourDays.scope.dimensions[0],
    ).toMatchObject({
      kind: "paid_media_segment",
      classification: "prospecting",
    });
  });

  it("keeps provider identity in targets, not provider-specific Action types", () => {
    const actions = [
      increaseGoogleShoppingBudget20,
      decreaseMetaProspectingBudget500PerDay,
      setPinterestBudget300PerDay,
      pauseMetaCampaignA,
      resumeGoogleCampaignB,
      unsupportedTikTokSpendCap,
    ];

    for (const action of actions) {
      expect(action.actionType).toMatch(/^advertising\./);
      expect(action.actionType).not.toMatch(/google|meta|pinterest|tiktok/i);
      expect(JSON.stringify(action)).not.toMatch(
        /resourceName|providerPayload|apiPayload/,
      );
    }
  });

  it("rejects outcome leakage in paid-media Actions", () => {
    for (const key of [
      "expectedROAS",
      "expectedConversions",
      "expectedProfit",
      "predictedLift",
      "trueIncrementalROAS",
      "futureDemand",
      "counterfactualRevenue",
      "recommendationScore",
      "confidenceScore",
    ]) {
      const invalid = clone(increaseGoogleShoppingBudget20);
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
