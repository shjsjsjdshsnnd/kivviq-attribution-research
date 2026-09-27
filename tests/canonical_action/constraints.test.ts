import { describe, expect, it } from "vitest";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction, readCanonicalAction, serializeCanonicalAction } from "../../src/canonical_action/serialization.js";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { mapLegacyHardConstraints } from "../../src/action_constraints/legacy.js";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import { reduceSkuA10WithGrossMargin35Floor } from "../../src/pricing/fixtures.js";
import { protectSkuAAt20 } from "../../src/inventory/fixtures.js";
import type { Action, ActionConstraint } from "../../src/action_ontology/types.js";

const floor = {
  constraintId: "canonical.price.floor",
  kind: "PRICE_FLOOR" as const,
  target: { kind: "SKU" as const, ref: "sku:A" },
  evaluationBoundary: "DECISION_TIME" as const,
  whenUnknown: "UNKNOWN" as const,
  valueBasis: "PROJECTED_AFTER_ACTION" as const,
  comparator: "GTE" as const,
  threshold: { valueType: "MONEY" as const, amountMinor: 8_000, currency: "CAD" },
  observedValue: { kind: "FACT" as const, ref: "resulting.price" },
};

describe("canonical hard-constraint integration", () => {
  it("reads older v2 payloads without constraints as an empty definition list", () => {
    const action = createCanonicalFixtures()[0]!.action!;
    const oldPayload = structuredClone(action) as Record<string, unknown>;
    delete oldPayload["constraints"];
    const parsed = canonicalActionSchema.parse(oldPayload);
    expect(parsed.constraints).toEqual([]);
    expect(readCanonicalAction(JSON.stringify(oldPayload))).toMatchObject({ constraints: [] });
    expect(JSON.parse(serializeCanonicalAction(parsed)).constraints).toEqual([]);
  });

  it("includes immutable constraint definitions in semantic fingerprints", () => {
    const action = createCanonicalFixtures()[0]!.action!;
    const unconstrained = canonicalActionSchema.parse({ ...action, constraints: [] });
    const constrained = canonicalActionSchema.parse({ ...action, constraints: [floor] });
    expect(fingerprintCanonicalAction(constrained)).not.toBe(fingerprintCanonicalAction(unconstrained));
    expect(fingerprintCanonicalAction({ ...constrained, provenance: ["different_source"] })).toBe(fingerprintCanonicalAction(constrained));
  });

  it("treats constraint definition order as semantically irrelevant", () => {
    const action = createCanonicalFixtures()[0]!.action!;
    const discount = {
      constraintId: "canonical.discount.maximum",
      kind: "MAXIMUM_DISCOUNT" as const,
      target: { kind: "GLOBAL" as const },
      evaluationBoundary: "DECISION_TIME" as const,
      whenUnknown: "UNKNOWN" as const,
      valueBasis: "PROJECTED_AFTER_ACTION" as const,
      comparator: "LTE" as const,
      threshold: { valueType: "PERCENTAGE" as const, basisPoints: 2_000 },
      observedValue: { kind: "FACT" as const, ref: "resulting.discount" },
    };
    const forward = canonicalActionSchema.parse({ ...action, constraints: [floor, discount] });
    const reversed = canonicalActionSchema.parse({ ...action, constraints: [discount, floor] });
    expect(fingerprintCanonicalAction(forward)).toBe(fingerprintCanonicalAction(reversed));
    const changed = canonicalActionSchema.parse({ ...action, constraints: [floor, { ...discount, threshold: { ...discount.threshold, basisPoints: 2_001 } }] });
    expect(fingerprintCanonicalAction(changed)).not.toBe(fingerprintCanonicalAction(forward));
  });

  it("maps recognized legacy margin comparisons exactly during adaptation", () => {
    const mapped = mapLegacyHardConstraints(reduceSkuA10WithGrossMargin35Floor);
    expect(mapped).toEqual([
      expect.objectContaining({
        kind: "MINIMUM_MARGIN",
        target: { kind: "SKU", ref: "sku:A" },
        valueBasis: "PROJECTED_AFTER_ACTION",
        comparator: "GTE",
        threshold: { valueType: "PERCENTAGE", basisPoints: 3_500 },
        observedValue: { kind: "FACT", ref: "finance.gross_margin_rate" },
      }),
    ]);
    expect(adaptLegacyAction(reduceSkuA10WithGrossMargin35Floor).constraints).toEqual(mapped);
  });

  it("uses a registered CUSTOM definition when a legacy expression has no exact native form", () => {
    const mapped = mapLegacyHardConstraints(increaseGoogleShoppingBudget20);
    expect(mapped.some((constraint) => constraint.kind === "CUSTOM" && constraint.registryRef === "legacy.constraint-expression.v1")).toBe(true);
  });

  it("rejects mismatched legacy dimensions and contradictory bounds", () => {
    const wrongCurrency = structuredClone(increaseGoogleShoppingBudget20) as Action;
    const budget = wrongCurrency.constraints.find((constraint) => constraint.expression.kind === "property_comparison")!;
    if (budget.expression.kind !== "property_comparison") throw new Error("expected comparison");
    (budget.expression as { value: unknown }).value = { kind: "money", amountMinor: 1, currency: "USD" };
    (wrongCurrency.constraints as Action["constraints"] & ActionConstraint[]).push({
      constraintId: "budget.currency.cad" as never,
      constraintClass: "hard",
      expression: { kind: "property_comparison", propertyId: "budget.available_minor", operator: "GTE", value: { kind: "money", amountMinor: 1, currency: "CAD" as never } },
    });
    expect(() => mapLegacyHardConstraints(wrongCurrency)).toThrow(/currency|target/i);

    const wrongUnit = structuredClone(protectSkuAAt20) as Action;
    (wrongUnit.constraints as Action["constraints"] & ActionConstraint[]).push({
      constraintId: "inventory.hours.mismatch" as never,
      constraintClass: "hard",
      expression: { kind: "property_comparison", propertyId: "inventory.available_to_sell_units", operator: "GTE", value: { kind: "quantity", value: 1, unit: "hours" } },
    });
    expect(() => mapLegacyHardConstraints(wrongUnit)).toThrow(/unit|incompatible/i);

    const contradictory = structuredClone(reduceSkuA10WithGrossMargin35Floor) as Action;
    const first = contradictory.constraints[0]!;
    if (first.expression.kind !== "property_comparison") throw new Error("expected comparison");
    (contradictory.constraints as Action["constraints"] & ActionConstraint[]).push({
      constraintId: "contradictory.margin.upper" as never,
      constraintClass: "hard",
      expression: { ...first.expression, operator: "LTE", value: { kind: "percentage", basisPoints: 3_000 } },
    });
    expect(() => mapLegacyHardConstraints(contradictory)).toThrow(/contradictory|minimum exceeds maximum/i);
  });

  it("rejects malformed native targets and duplicate constraint identities", () => {
    const action = createCanonicalFixtures()[0]!.action!;
    expect(canonicalActionSchema.safeParse({ ...action, constraints: [{ ...floor, target: { kind: "SKU", ref: "" } }] }).success).toBe(false);
    expect(canonicalActionSchema.safeParse({ ...action, constraints: [floor, floor] }).success).toBe(false);
  });

  it.each([
    [["EQ", 5], ["GTE", 6]],
    [["EQ", 5], ["EQ", 6]],
    [["GTE", 6], ["LTE", 5]],
  ] as const)("rejects contradictory legacy equality and range bounds %#", (left, right) => {
    const candidate = structuredClone(reduceSkuA10WithGrossMargin35Floor) as Action;
    (candidate.constraints as Action["constraints"] & ActionConstraint[]).splice(0, candidate.constraints.length,
      {
        constraintId: "bound.left" as never,
        constraintClass: "hard",
        expression: { kind: "property_comparison", propertyId: "finance.gross_margin_rate", operator: left[0], value: { kind: "percentage", basisPoints: left[1] } },
      },
      {
        constraintId: "bound.right" as never,
        constraintClass: "hard",
        expression: { kind: "property_comparison", propertyId: "finance.gross_margin_rate", operator: right[0], value: { kind: "percentage", basisPoints: right[1] } },
      },
    );
    expect(() => mapLegacyHardConstraints(candidate)).toThrow(/contradict|minimum exceeds maximum|equality/i);
  });

  it("rejects EQ and NEQ of the same typed value while allowing a different exclusion", () => {
    const candidate = (excluded: number) => {
      const value = structuredClone(reduceSkuA10WithGrossMargin35Floor) as Action;
      (value.constraints as Action["constraints"] & ActionConstraint[]).splice(0, value.constraints.length,
        { constraintId: "equal.margin" as never, constraintClass: "hard", expression: { kind: "property_comparison", propertyId: "finance.gross_margin_rate", operator: "EQ", value: { kind: "percentage", basisPoints: 500 } } },
        { constraintId: "not.equal.margin" as never, constraintClass: "hard", expression: { kind: "property_comparison", propertyId: "finance.gross_margin_rate", operator: "NEQ", value: { kind: "percentage", basisPoints: excluded } } },
      );
      return value;
    };
    expect(() => mapLegacyHardConstraints(candidate(500))).toThrow(/contradict|equality/i);
    expect(() => mapLegacyHardConstraints(candidate(600))).not.toThrow();
  });
});
