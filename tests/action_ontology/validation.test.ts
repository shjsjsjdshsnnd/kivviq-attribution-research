import { describe, expect, it } from "vitest";
import {
  doNothingAction,
  increaseGoogleShoppingBudget20,
  increaseGoogleShoppingBudgetBy1000,
  investigateTrackingAnomaly,
  pauseUnderperformingMetaCampaign,
  reorderInventoryWith45DayDelay,
  runCollectionPromotion15FourDays,
  runExperimentAction,
  waitObserveAction,
} from "../../src/action_ontology/fixtures.js";
import { validateAction } from "../../src/action_ontology/validation.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Step 1 canonical Action validation", () => {
  it("accepts representative action families", () => {
    for (const action of [
      increaseGoogleShoppingBudget20,
      increaseGoogleShoppingBudgetBy1000,
      pauseUnderperformingMetaCampaign,
      runCollectionPromotion15FourDays,
      reorderInventoryWith45DayDelay,
      doNothingAction,
      waitObserveAction,
      investigateTrackingAnomaly,
      runExperimentAction,
    ]) {
      expect(validateAction(action).ok).toBe(true);
    }
  });

  it("keeps lifecycle status outside Action", () => {
    const invalid = clone(increaseGoogleShoppingBudget20);
    invalid.state = "accepted";

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) =>
            issue.code === "FORBIDDEN_ACTION_INFORMATION" &&
            issue.path === "state",
        ),
      ).toBe(true);
    }
  });

  it("rejects God-mode, prediction and ranking fields at runtime", () => {
    for (const forbidden of [
      ["trueIncrementalROAS", 8.4],
      ["expectedProfit", 1000],
      ["recommendationScore", 0.99],
      ["bestAction", true],
    ] as const) {
      const invalid = clone(increaseGoogleShoppingBudget20);
      invalid[forbidden[0]] = forbidden[1];

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

  it("rejects malformed or unknown targets", () => {
    const missing = clone(increaseGoogleShoppingBudget20);
    delete missing.target.campaignId;
    const first = validateAction(missing);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(
        first.errors.some((issue) => issue.code === "MISSING_TARGET_ID"),
      ).toBe(true);
    }

    const unknown = clone(increaseGoogleShoppingBudget20);
    unknown.target = { kind: "mystery", id: "x" };
    const second = validateAction(unknown);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(
        second.errors.some((issue) => issue.code === "UNKNOWN_TARGET_KIND"),
      ).toBe(true);
    }
  });

  it("requires relative operations to carry a typed baseline reference", () => {
    const invalid = clone(increaseGoogleShoppingBudget20);
    delete invalid.parameters.operation.reference;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "INVALID_REFERENCE_VALUE",
        ),
      ).toBe(true);
    }
  });

  it("enforces unit safety for operation values and explicit baselines", () => {
    const invalid = clone(increaseGoogleShoppingBudgetBy1000);
    invalid.parameters.operation.amount = {
      kind: "percentage",
      basisPoints: 1000,
    };

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "OPERATION_UNIT_KIND_MISMATCH",
        ),
      ).toBe(true);
    }
  });

  it("rejects NaN-equivalent and infinite multiplier semantics", () => {
    const invalid = clone(increaseGoogleShoppingBudget20);
    invalid.parameters.operation.factor = Infinity;

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some((issue) => issue.code === "INVALID_MULTIPLIER"),
      ).toBe(true);
    }
  });

  it("enforces decision, requested, effective and implementation-delay chronology", () => {
    const invalid = clone(reorderInventoryWith45DayDelay);
    invalid.timing.effectiveStart = {
      kind: "known",
      at: "2026-09-22T13:00:00Z",
    };

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) =>
            issue.code === "EFFECTIVE_START_BEFORE_IMPLEMENTATION_DELAY",
        ),
      ).toBe(true);
    }
  });

  it("keeps target and scope separate and validates scoped dimensions", () => {
    expect(runCollectionPromotion15FourDays.target.kind).toBe("collection");
    expect(
      runCollectionPromotion15FourDays.scope.dimensions.map(
        (dimension) => dimension.kind,
      ),
    ).toEqual(["geography", "device", "customer_population"]);

    const invalid = clone(runCollectionPromotion15FourDays);
    invalid.scope.dimensions.push({
      kind: "device",
      devices: ["desktop"],
    });

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "DUPLICATE_SCOPE_DIMENSION",
        ),
      ).toBe(true);
    }
  });

  it("distinguishes hard constraints from soft preferences", () => {
    const classes = increaseGoogleShoppingBudget20.constraints.map(
      (constraint) => constraint.constraintClass,
    );
    expect(classes).toContain("hard");
    expect(classes).toContain("soft");
  });

  it("rejects contradictory minimum and maximum constraint definitions", () => {
    const invalid = clone(increaseGoogleShoppingBudget20);
    invalid.constraints = [
      {
        constraintId: "margin_min",
        constraintClass: "hard",
        expression: {
          kind: "property_comparison",
          propertyId: "finance.gross_margin_rate",
          operator: "GTE",
          value: { kind: "percentage", basisPoints: 5000 },
        },
      },
      {
        constraintId: "margin_max",
        constraintClass: "hard",
        expression: {
          kind: "property_comparison",
          propertyId: "finance.gross_margin_rate",
          operator: "LTE",
          value: { kind: "percentage", basisPoints: 3000 },
        },
      },
    ];

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "CONSTRAINT_MIN_EXCEEDS_MAX",
        ),
      ).toBe(true);
    }
  });

  it("rejects unsupported schema versions and unknown top-level fields", () => {
    const invalid = clone(doNothingAction);
    invalid.schemaVersion = "2.0.0";
    invalid.surpriseField = "silently reinterpret me";

    const result = validateAction(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.errors.some(
          (issue) => issue.code === "UNSUPPORTED_SCHEMA_VERSION",
        ),
      ).toBe(true);
      expect(
        result.errors.some((issue) => issue.code === "UNKNOWN_ACTION_FIELD"),
      ).toBe(true);
    }
  });

  it("freezes validated actions to preserve immutable semantics", () => {
    expect(Object.isFrozen(increaseGoogleShoppingBudget20)).toBe(true);
    expect(Object.isFrozen(increaseGoogleShoppingBudget20.parameters)).toBe(true);
    expect(Object.isFrozen(increaseGoogleShoppingBudget20.timing)).toBe(true);
  });
});
