import { describe, expect, it } from "vitest";
import {
  increaseEmailCampaignFrequency,
  increaseGoogleShoppingBudget20,
  pauseUnderperformingMetaCampaign,
  reallocateMetaToGoogle1000PerWeek,
  runCollectionPromotion15FourDays,
} from "../../src/action_ontology/fixtures.js";
import { validateAction } from "../../src/action_ontology/validation.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Step 2.1 Action validation", () => {
  it("accepts valid atomic and compound actions", () => {
    expect(validateAction(increaseGoogleShoppingBudget20).ok).toBe(true);
    expect(validateAction(reallocateMetaToGoogle1000PerWeek).ok).toBe(true);
  });

  it("rejects an action without a typed target identifier", () => {
    const invalid = clone(increaseGoogleShoppingBudget20) as any;
    delete invalid.target.campaignId;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === "MISSING_TARGET_ID")).toBe(true);
    }
  });

  it("rejects missing required parameters", () => {
    const invalid = clone(increaseGoogleShoppingBudget20) as any;
    invalid.parameters = [];

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((error) => error.code === "MISSING_REQUIRED_PARAMETER"),
      ).toBe(true);
    }
  });

  it("rejects negative duration and an end time before start", () => {
    const invalid = clone(runCollectionPromotion15FourDays) as any;
    invalid.duration.durationSeconds = {
      status: "known",
      value: -1,
      provenance: "operator_input",
    };
    invalid.duration.endTime = {
      status: "known",
      value: "2026-09-20T10:00:00Z",
      provenance: "operator_input",
    };

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (error) => error.code === "INVALID_NON_NEGATIVE_NUMBER",
        ),
      ).toBe(true);
      expect(result.errors.some((error) => error.code === "END_BEFORE_START")).toBe(
        true,
      );
    }
  });

  it("requires explicit currency on monetary values", () => {
    const invalid = clone(increaseGoogleShoppingBudget20) as any;
    delete invalid.cost.incrementalSpend.value.currency;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === "INVALID_CURRENCY")).toBe(
        true,
      );
    }
  });

  it("requires explicit percentage semantics", () => {
    const invalid = clone(increaseGoogleShoppingBudget20) as any;
    delete invalid.parameters[0].value.semantics;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (error) => error.code === "MISSING_PERCENTAGE_SEMANTICS",
        ),
      ).toBe(true);
    }
  });

  it("allows unknown values instead of inventing precision", () => {
    expect(validateAction(pauseUnderperformingMetaCampaign).ok).toBe(true);
    expect(pauseUnderperformingMetaCampaign.cost.implementationCost.status).toBe(
      "unknown",
    );
    expect(pauseUnderperformingMetaCampaign.risks[0]?.probability.status).toBe(
      "unknown",
    );
  });

  it("rejects unregistered action types but accepts explicit extension contracts", () => {
    const extended = clone(increaseGoogleShoppingBudget20) as any;
    extended.actionType = "custom.raise_campaign_budget";
    extended.parameters = [
      {
        parameterId: "custom_change",
        mode: "INCREASE_BY",
        value: { kind: "money", amountMinor: 10_000, currency: "CAD" },
      },
    ];

    const unregistered = validateAction(extended);
    expect(unregistered.ok).toBe(false);
    if (!unregistered.ok) {
      expect(
        unregistered.errors.some(
          (error) => error.code === "UNREGISTERED_ACTION_TYPE",
        ),
      ).toBe(true);
    }

    expect(
      validateAction(extended, {
        additionalActionTypeContracts: [
          {
            actionType: "custom.raise_campaign_budget",
            category: "paid_media",
            atomicity: "ATOMIC",
            allowedTargetKinds: ["campaign"],
            requiredParameterIds: ["custom_change"],
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("validates constraint properties but allows explicit extensions", () => {
    const extended = clone(increaseGoogleShoppingBudget20) as any;
    extended.constraints.push({
      constraintId: "custom-cap",
      kind: "property_comparison",
      property: "merchant.custom_daily_cap_minor",
      operator: "LTE",
      value: {
        kind: "money",
        amountMinor: 500_000,
        currency: "CAD",
      },
      whenUnmet: "BLOCKED",
    });

    expect(validateAction(extended).ok).toBe(false);
    expect(
      validateAction(extended, {
        additionalConstraintProperties: ["merchant.custom_daily_cap_minor"],
      }).ok,
    ).toBe(true);
  });

  it("requires reversal metadata to agree with reversibility", () => {
    const invalid = clone(pauseUnderperformingMetaCampaign) as any;
    invalid.reversibility.classification = "irreversible";

    const first = validateAction(invalid);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some(
          (error) => error.code === "IRREVERSIBLE_HAS_REVERSAL_METADATA",
        ),
      ).toBe(true);
    }

    invalid.reversibility.reversalMechanism = {
      status: "not_applicable",
      provenance: "not_applicable",
    };
    invalid.reversibility.reversalCost = {
      status: "not_applicable",
      provenance: "not_applicable",
    };
    invalid.reversibility.reversalDelaySeconds = {
      status: "not_applicable",
      provenance: "not_applicable",
    };

    expect(validateAction(invalid).ok).toBe(true);
  });

  it("distinguishes temporary, persistent and recurring actions", () => {
    expect(runCollectionPromotion15FourDays.duration.kind).toBe("temporary");
    expect(increaseEmailCampaignFrequency.duration.kind).toBe("persistent");

    const recurring = clone(increaseEmailCampaignFrequency) as any;
    recurring.duration = {
      kind: "recurring",
      durationSeconds: {
        status: "not_applicable",
        provenance: "not_applicable",
      },
      endTime: {
        status: "not_applicable",
        provenance: "not_applicable",
      },
      recurrence: {
        frequency: "weekly",
        interval: 1,
      },
    };

    expect(validateAction(recurring).ok).toBe(true);
  });

  it("requires an explicit period for monetary rates", () => {
    const invalid = clone(reallocateMetaToGoogle1000PerWeek) as any;
    delete invalid.components[0].parameters[0].value.per;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (error) =>
            error.code === "COMPONENT_INVALID_MONEY_RATE_PERIOD" ||
            error.code === "INVALID_MONEY_RATE_PERIOD",
        ),
      ).toBe(true);
    }
  });

  it("requires compound coordination and valid component dependencies", () => {
    const missingCoordination = clone(reallocateMetaToGoogle1000PerWeek) as any;
    delete missingCoordination.coordination;

    const missingResult = validateAction(missingCoordination);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(
        missingResult.errors.some(
          (error) => error.code === "MISSING_COMPOUND_COORDINATION",
        ),
      ).toBe(true);
    }

    const badDependency = clone(reallocateMetaToGoogle1000PerWeek) as any;
    badDependency.coordination.dependencies[0].dependsOnActionIds = [
      "act:not-a-component",
    ];

    const dependencyResult = validateAction(badDependency);
    expect(dependencyResult.ok).toBe(false);
    if (!dependencyResult.ok) {
      expect(
        dependencyResult.errors.some(
          (error) => error.code === "UNKNOWN_COMPONENT_DEPENDENCY_TARGET",
        ),
      ).toBe(true);
    }
  });

  it("rejects unbalanced compound budget reallocations", () => {
    const invalid = clone(reallocateMetaToGoogle1000PerWeek) as any;
    invalid.components[1].parameters[0].value.amountMinor = 90_000;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (error) => error.code === "REALLOCATION_AMOUNT_MISMATCH",
        ),
      ).toBe(true);
    }
  });
});
