import { describe, expect, it } from "vitest";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import type { Action, ActionConstraint, ActionPrecondition } from "../../src/action_ontology/types.js";
import { constraintId } from "../../src/action_ontology/identity.js";
import { currencyCode } from "../../src/core/units.js";
import {
  actionEligibilitySchema,
  canonicalEligibilityTargetRef,
  evaluateActionEligibility as evaluateActionEligibilityRaw,
  legacyEntityTargetRef,
  type DomainEligibilityFact,
} from "../../src/action_eligibility/index.js";

const evaluatedAt = "2026-09-21T13:10:00Z";
type MutableLegacy = Omit<Action, "constraints" | "preconditions" | "target"> & {
  constraints: ActionConstraint[];
  preconditions: ActionPrecondition[];
  target: Action["target"];
};

function action(overrides: Partial<Action> = {}) {
  const original = structuredClone(increaseGoogleShoppingBudget20) as Action;
  Object.assign(original, overrides);
  return adaptLegacyAction(original);
}

function legacyOnly(candidate: ReturnType<typeof action>) {
  return canonicalActionSchema.parse({ ...candidate, constraints: [] });
}

function bound(actionValue: ReturnType<typeof action>) {
  return {
    actionId: actionValue.actionId,
    actionFingerprint: fingerprintCanonicalAction(actionValue),
    targetRef: canonicalEligibilityTargetRef(actionValue),
    evaluationBoundary: "DECISION_TIME" as const,
    observedAt: "2026-09-21T13:05:00Z",
    sourceRef: "merchant_state",
    provenance: ["snapshot:1"],
  };
}

function domainFacts(actionValue: ReturnType<typeof action>): DomainEligibilityFact[] {
  const common = bound(actionValue);
  return ["ACTION_FAMILY_CAPABILITY", "CHANNEL_MERCHANT_ENABLED"].map((factId) => ({
    ...common,
    kind: "DOMAIN_FACT" as const,
    factId: factId as DomainEligibilityFact["factId"],
    value: true,
    evidenceRef: `domain:${factId.toLowerCase()}`,
  }));
}

function evaluateActionEligibility(input: unknown, context: unknown) {
  if (input && typeof input === "object" && "action" in input && context && typeof context === "object") {
    try {
      const candidate = (input as { action: ReturnType<typeof action> }).action;
      return evaluateActionEligibilityRaw(input, { evaluationBoundary: "DECISION_TIME", ...context, domainFacts: domainFacts(candidate) });
    } catch {
      return evaluateActionEligibilityRaw(input, context);
    }
  }
  return evaluateActionEligibilityRaw(input, context);
}

describe("evaluateActionEligibility", () => {
  it("evaluates every precondition and hard legacy constraint in definition order", () => {
    const candidate = legacyOnly(action());
    const result = evaluateActionEligibility(
      { action: candidate },
      {
        evaluatedAt,
        maximumAgeSeconds: 3600,
        observations: [
          {
            ...bound(candidate),
            kind: "ENTITY",
            evidenceRef: "entity:campaign",
            entityRef: legacyEntityTargetRef((candidate.what as { target: Action["target"] }).target),
            exists: false,
          },
          {
            ...bound(candidate),
            kind: "PROPERTY",
            evidenceRef: "property:budget",
            propertyId: "budget.available_minor",
            value: { kind: "money", amountMinor: 0, currency: "CAD" },
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.status).toBe("INELIGIBLE");
    expect(result.result.checks.filter((check) => check.kind !== "DOMAIN_RULE").map(({ checkId, status }) => [checkId, status])).toEqual([
      ["campaign_exists", "VIOLATED"],
      ["budget_available", "VIOLATED"],
    ]);
    expect(result.result.checks.filter((check) => check.kind !== "DOMAIN_RULE").flatMap((check) => check.reasonCodes)).toEqual([
      "ENTITY_DOES_NOT_EXIST",
      "COMPARISON_FALSE",
    ]);
    expect(actionEligibilitySchema.parse(result.result)).toEqual(result.result);
  });

  it("turns unknown evidence into a violation only when the precondition says ineligible", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.constraints = [];
    legacy.preconditions = [
      {
        preconditionId: "required_capability",
        expression: { kind: "capability_available", capabilityId: "ads.google" },
        whenUnknown: "ineligible",
      },
      {
        preconditionId: "optional_evidence",
        expression: { kind: "evidence_available", evidenceRef: "margin:current" },
        whenUnknown: "unknown_eligibility",
      },
    ];
    const candidate = legacyOnly(action(legacy));
    const result = evaluateActionEligibility(
      { action: candidate },
      { evaluatedAt, observations: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.status).toBe("INELIGIBLE");
    expect(result.result.checks.filter((check) => check.kind !== "DOMAIN_RULE")).toMatchObject([
      { checkId: "required_capability", status: "VIOLATED", reasonCodes: ["MISSING_INFORMATION_FAIL_CLOSED"] },
      { checkId: "optional_evidence", status: "UNKNOWN", reasonCodes: ["MISSING_BOUND_EVIDENCE"] },
    ]);
  });

  it("honors an evidence expression's stricter maximum age", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.constraints = [];
    legacy.preconditions = [{
      preconditionId: "recent_approval",
      expression: { kind: "evidence_available", evidenceRef: "approval", maximumAgeSeconds: 60 },
      whenUnknown: "unknown_eligibility",
    }];
    const candidate = legacyOnly(action(legacy));
    const result = evaluateActionEligibility(
      { action: candidate },
      { evaluatedAt, observations: [{ ...bound(candidate), observedAt: "2026-09-21T13:08:00Z", kind: "EVIDENCE", evidenceRef: "receipt:approval", reference: "approval", available: true }] },
    );
    expect(result.ok && result.result.checks[0]).toMatchObject({ status: "UNKNOWN", reasonCodes: ["STALE_EVIDENCE"] });
  });

  it("compares scalar values without coercion and rejects incompatible dimensions", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.preconditions = [];
    legacy.constraints = [
      {
        constraintId: constraintId("lt"),
        constraintClass: "hard",
        expression: { kind: "property_comparison", propertyId: "budget.available_minor", operator: "LT", value: { kind: "money", amountMinor: 300, currency: currencyCode("CAD") } },
      },
      {
        constraintId: constraintId("neq"),
        constraintClass: "hard",
        expression: { kind: "property_comparison", propertyId: "budget.available_minor", operator: "NEQ", value: { kind: "money", amountMinor: 300, currency: currencyCode("CAD") } },
      },
      {
        constraintId: constraintId("currency"),
        constraintClass: "hard",
        expression: { kind: "property_comparison", propertyId: "budget.available_minor", operator: "GTE", value: { kind: "money", amountMinor: 10, currency: currencyCode("CAD") } },
      },
    ];
    const candidate = legacyOnly(action(legacy));
    const common = bound(candidate);
    const result = evaluateActionEligibility(
      { action: candidate },
      {
        evaluatedAt,
        observations: [
          { ...common, kind: "PROPERTY", evidenceRef: "e1", propertyId: "budget.available_minor", value: { kind: "money", amountMinor: 200, currency: "CAD" } },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.checks.filter((check) => check.kind !== "DOMAIN_RULE").map(({ status, reasonCodes }) => [status, reasonCodes[0]])).toEqual([
      ["SATISFIED", "COMPARISON_TRUE"],
      ["SATISFIED", "COMPARISON_TRUE"],
      ["SATISFIED", "COMPARISON_TRUE"],
    ]);

    const incompatible = evaluateActionEligibility(
      { action: candidate },
      {
        evaluatedAt,
        observations: [{
          ...common,
          kind: "PROPERTY",
          evidenceRef: "usd",
          propertyId: "budget.available_minor",
          value: { kind: "money", amountMinor: 200, currency: "USD" },
        }],
      },
    );
    expect(incompatible.ok && incompatible.result.checks.filter((check) => check.kind !== "DOMAIN_RULE").every(
      (check) => check.status === "VIOLATED" && check.reasonCodes[0] === "INCOMPATIBLE_VALUE",
    )).toBe(true);
  });

  it.each([
    ["missing", [], "MISSING_BOUND_EVIDENCE"],
    ["stale", [{ observedAt: "2026-09-21T11:00:00Z" }], "STALE_EVIDENCE"],
    ["future", [{ observedAt: "2026-09-21T14:00:00Z" }], "FUTURE_EVIDENCE"],
  ])("fails closed for %s evidence", (_label, modifications, reason) => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.preconditions = [];
    legacy.constraints = [legacy.constraints[0]!];
    const candidate = legacyOnly(action(legacy));
    const base = {
      ...bound(candidate), kind: "PROPERTY" as const, evidenceRef: "budget:1",
      propertyId: "budget.available_minor", value: { kind: "money" as const, amountMinor: 100, currency: "CAD" },
    };
    const observations = modifications.length === 0 ? [] : modifications.map((entry) => ({ ...base, ...entry }));
    const result = evaluateActionEligibility({ action: candidate }, { evaluatedAt, maximumAgeSeconds: 3600, observations });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.status).toBe("UNKNOWN");
    expect(result.result.checks[0]?.reasonCodes).toEqual([reason]);
  });

  it("treats duplicate bound observations as ambiguous independent of order", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.preconditions = [];
    legacy.constraints = [legacy.constraints[0]!];
    const candidate = legacyOnly(action(legacy));
    const first = { ...bound(candidate), kind: "PROPERTY" as const, evidenceRef: "a", propertyId: "budget.available_minor", value: { kind: "money" as const, amountMinor: 100, currency: "CAD" } };
    const second = { ...first, evidenceRef: "b" };
    const left = evaluateActionEligibility({ action: candidate }, { evaluatedAt, observations: [first, second] });
    const right = evaluateActionEligibility({ action: candidate }, { evaluatedAt, observations: [second, first] });
    expect(left.ok && left.result.checks[0]).toEqual(right.ok && right.result.checks[0]);
    expect(left.ok && left.result.checks[0]?.reasonCodes).toEqual(["AMBIGUOUS_BOUND_EVIDENCE"]);
  });

  it("returns INVALID_CONTEXT instead of throwing for duplicate evidence references", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.preconditions = [];
    legacy.constraints = [legacy.constraints[0]!];
    const candidate = action(legacy);
    const observation = {
      ...bound(candidate),
      kind: "PROPERTY" as const,
      evidenceRef: "same-receipt",
      propertyId: "budget.available_minor",
      value: { kind: "money" as const, amountMinor: 100, currency: "CAD" },
    };
    expect(() =>
      evaluateActionEligibility(
        { action: candidate },
        { evaluatedAt, observations: [observation, structuredClone(observation)] },
      ),
    ).not.toThrow();
    expect(
      evaluateActionEligibility(
        { action: candidate },
        { evaluatedAt, observations: [observation, structuredClone(observation)] },
      ),
    ).toMatchObject({ ok: false, failure: { code: "INVALID_CONTEXT" } });
  });

  it("requires exact action, fingerprint, target and observation binding", () => {
    const candidate = action();
    const unrelated = {
      ...bound(candidate), kind: "ENTITY" as const, evidenceRef: "wrong",
      actionFingerprint: "fnv1a64:0000000000000000",
      targetRef: "eligibility-target:fnv1a64:0000000000000000",
      entityRef: legacyEntityTargetRef({ kind: "campaign", channelId: "google_ads", campaignId: "other" }), exists: true,
    };
    const result = evaluateActionEligibility({ action: candidate }, { evaluatedAt, observations: [unrelated] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.checks[0]).toMatchObject({ status: "UNKNOWN", reasonCodes: ["MISSING_BOUND_EVIDENCE"] });
  });

  it("does not use a property observation bound to another action target", () => {
    const candidate = action();
    const observation = {
      ...bound(candidate),
      targetRef: "eligibility-target:fnv1a64:1111111111111111",
      kind: "PROPERTY" as const,
      evidenceRef: "property:other-campaign",
      propertyId: "budget.available_minor",
      value: { kind: "money" as const, amountMinor: 100, currency: "CAD" },
    };
    const result = evaluateActionEligibility(
      { action: candidate },
      { evaluatedAt, observations: [observation] },
    );
    expect(result.ok && result.result.checks[1]).toMatchObject({
      status: "UNKNOWN",
      reasonCodes: ["MISSING_BOUND_EVIDENCE"],
    });
  });

  it("requires target binding for entity, capability and evidence observations", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.constraints = [];
    legacy.preconditions = [
      { preconditionId: "entity", expression: { kind: "entity_exists", target: legacy.target }, whenUnknown: "unknown_eligibility" },
      { preconditionId: "capability", expression: { kind: "capability_available", capabilityId: "ads.google" }, whenUnknown: "unknown_eligibility" },
      { preconditionId: "evidence", expression: { kind: "evidence_available", evidenceRef: "approval" }, whenUnknown: "unknown_eligibility" },
    ];
    const candidate = action(legacy);
    const otherTarget = "eligibility-target:fnv1a64:2222222222222222";
    const common = { ...bound(candidate), targetRef: otherTarget };
    const result = evaluateActionEligibility(
      { action: candidate },
      {
        evaluatedAt,
        observations: [
          { ...common, kind: "ENTITY", evidenceRef: "entity", entityRef: legacyEntityTargetRef(legacy.target), exists: true },
          { ...common, kind: "CAPABILITY", evidenceRef: "capability", capabilityId: "ads.google", available: true },
          { ...common, kind: "EVIDENCE", evidenceRef: "evidence", reference: "approval", available: true },
        ],
      },
    );
    expect(result.ok && result.result.checks.filter((check) => check.kind !== "DOMAIN_RULE").map((check) => [check.status, check.reasonCodes[0]])).toEqual([
      ["UNKNOWN", "MISSING_BOUND_EVIDENCE"],
      ["UNKNOWN", "MISSING_BOUND_EVIDENCE"],
      ["UNKNOWN", "MISSING_BOUND_EVIDENCE"],
    ]);
  });

  it("derives stable, target-sensitive eligibility references", () => {
    const first = action();
    const same = action();
    const changedLegacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    changedLegacy.target = { kind: "campaign", channelId: "google_ads", campaignId: "another" };
    const changed = action(changedLegacy);
    expect(canonicalEligibilityTargetRef(first)).toBe(canonicalEligibilityTargetRef(same));
    expect(canonicalEligibilityTargetRef(first)).toMatch(/^eligibility-target:fnv1a64:[0-9a-f]{16}$/);
    expect(canonicalEligibilityTargetRef(first)).not.toBe(canonicalEligibilityTargetRef(changed));
  });

  it("maps fingerprint-bound native hard constraint assessments", () => {
    const baseCandidate = action({ constraints: [], preconditions: [] });
    const margin = { constraintId: "margin", kind: "MINIMUM_MARGIN" as const, evaluationBoundary: "DECISION_TIME" as const, whenUnknown: "INELIGIBLE" as const, target: { kind: "GLOBAL" as const }, valueBasis: "CURRENT_STATE" as const, comparator: "GTE" as const, threshold: { valueType: "PERCENTAGE" as const, basisPoints: 3000 }, observedValue: { kind: "METRIC" as const, ref: "margin" } };
    const candidate = canonicalActionSchema.parse({ ...baseCandidate, constraints: [margin] });
    const fingerprint = fingerprintCanonicalAction(candidate);
    const result = evaluateActionEligibility(
      {
        action: candidate,
        nativeConstraints: {
          constraints: [margin],
          resourceRequirements: [],
        },
      },
      {
        evaluatedAt,
        observations: [],
        constraintReceipts: [{ evidenceRef: "margin:1", actionId: candidate.actionId, actionFingerprint: fingerprint, constraintId: "margin", target: { kind: "GLOBAL" }, evaluationBoundary: "DECISION_TIME", observedAt: "2026-09-21T13:05:00Z", sourceRef: "ledger", provenance: ["ledger:1"], fact: { kind: "VALUE", valueRef: { kind: "METRIC", ref: "margin" }, valueBasis: "CURRENT_STATE", value: { valueType: "PERCENTAGE", basisPoints: 2500 } } }],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toMatchObject({ status: "INELIGIBLE" });
    expect(result.result.checks.filter((check) => check.kind !== "DOMAIN_RULE")).toMatchObject([{ kind: "HARD_CONSTRAINT", checkId: "margin", status: "VIOLATED", reasonCodes: ["CONSTRAINT_VIOLATED"] }]);
  });

  it("cannot bypass a canonical price floor by omitting or replacing compatibility constraints", () => {
    const candidate = action({ constraints: [], preconditions: [] });
    const floor = { constraintId: "canonical.floor", kind: "PRICE_FLOOR" as const, target: { kind: "SKU" as const, ref: "sku:A" }, evaluationBoundary: "DECISION_TIME" as const, whenUnknown: "UNKNOWN" as const, valueBasis: "PROJECTED_AFTER_ACTION" as const, comparator: "GTE" as const, threshold: { valueType: "MONEY" as const, amountMinor: 8_000, currency: "CAD" }, observedValue: { kind: "FACT" as const, ref: "resulting.price" } };
    const constrained = canonicalActionSchema.parse({ ...candidate, constraints: [floor] });
    const receipt = { evidenceRef: "price.floor", actionId: constrained.actionId, actionFingerprint: fingerprintCanonicalAction(constrained), constraintId: floor.constraintId, target: floor.target, evaluationBoundary: floor.evaluationBoundary, observedAt: "2026-09-21T13:05:00Z", sourceRef: "merchant_state", provenance: ["snapshot:1"], fact: { kind: "VALUE" as const, valueRef: floor.observedValue, valueBasis: floor.valueBasis, value: { valueType: "MONEY" as const, amountMinor: 7_999, currency: "CAD" } } };
    const omitted = evaluateActionEligibility({ action: constrained }, { evaluatedAt, observations: [], constraintReceipts: [receipt] });
    expect(omitted.ok && omitted.result).toMatchObject({ status: "INELIGIBLE", checks: expect.arrayContaining([expect.objectContaining({ checkId: floor.constraintId, status: "VIOLATED" })]) });
    const replaced = evaluateActionEligibility({ action: constrained, nativeConstraints: { constraints: [{ ...floor, threshold: { ...floor.threshold, amountMinor: 7_000 } }], resourceRequirements: [] } }, { evaluatedAt, observations: [], constraintReceipts: [receipt] });
    expect(replaced).toMatchObject({ ok: false, failure: { code: "INVALID_NATIVE_CONSTRAINTS" } });
  });

  it("returns separate failures for invalid actions, unsupported families and invalid context", () => {
    expect(evaluateActionEligibility({ action: {} }, { evaluatedAt, observations: [] })).toMatchObject({ ok: false, failure: { code: "INVALID_ACTION" } });
    const unsupported = structuredClone(action());
    (unsupported.what as { actionCategory: string }).actionCategory = "future_family";
    expect(evaluateActionEligibility({ action: unsupported }, { evaluatedAt, observations: [] })).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_ACTION_FAMILY" } });
    const valid = action();
    expect(evaluateActionEligibility({ action: valid }, { evaluatedAt: "2026-09-21T13:10:00+00:00", observations: [] })).toMatchObject({ ok: false, failure: { code: "INVALID_CONTEXT" } });
    expect(evaluateActionEligibility({ action: valid, nativeConstraints: { constraints: "bad", resourceRequirements: [] } }, { evaluatedAt, observations: [] })).toMatchObject({ ok: false, failure: { code: "INVALID_NATIVE_CONSTRAINTS" } });
  });

  it("does not mutate inputs", () => {
    const candidate = action({ constraints: [], preconditions: [] });
    const input = { action: candidate };
    const context = { evaluatedAt, observations: [] };
    const before = JSON.stringify({ input, context });
    expect(evaluateActionEligibility(input, context)).toMatchObject({ ok: true, result: { status: "ELIGIBLE" } });
    expect(JSON.stringify({ input, context })).toBe(before);
  });

  it("rejects extra result fields", () => {
    const candidate = action({ constraints: [], preconditions: [] });
    const result = evaluateActionEligibility({ action: candidate }, { evaluatedAt, observations: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(actionEligibilitySchema.safeParse({ ...result.result, extra: true }).success).toBe(false);
  });

  it("evaluates only constraints and receipts at the selected boundary", () => {
    const candidate = action({ constraints: [], preconditions: [] });
    const target = { kind: "SKU" as const, ref: "sku:A" };
    const constraint = (constraintId: string, evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME") => ({
      constraintId,
      kind: "PRICE_FLOOR" as const,
      target,
      evaluationBoundary,
      whenUnknown: "UNKNOWN" as const,
      valueBasis: "PROJECTED_AFTER_ACTION" as const,
      comparator: "GTE" as const,
      threshold: { valueType: "MONEY" as const, amountMinor: 8_000, currency: "CAD" },
      observedValue: { kind: "FACT" as const, ref: "resulting.price" },
    });
    const receipt = (constraintId: string, evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME", amountMinor: number) => ({
      evidenceRef: `evidence.${constraintId}`,
      actionId: candidate.actionId,
      actionFingerprint: fingerprintCanonicalAction(candidate),
      observedAt: "2026-09-21T13:05:00Z",
      sourceRef: "merchant_state",
      provenance: ["snapshot:1"],
      constraintId,
      target,
      evaluationBoundary,
      fact: { kind: "VALUE" as const, valueRef: { kind: "FACT" as const, ref: "resulting.price" }, valueBasis: "PROJECTED_AFTER_ACTION" as const, value: { valueType: "MONEY" as const, amountMinor, currency: "CAD" } },
    });
    const constraints = [constraint("decision.floor", "DECISION_TIME"), constraint("translation.floor", "TRANSLATION_TIME")];
    const constrained = canonicalActionSchema.parse({ ...candidate, constraints });
    const boundReceipt = (constraintId: string, evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME", amountMinor: number) => ({ ...receipt(constraintId, evaluationBoundary, amountMinor), actionFingerprint: fingerprintCanonicalAction(constrained) });
    const input = { action: constrained, nativeConstraints: { constraints, resourceRequirements: [] } };
    const context = { evaluatedAt, observations: [], constraintReceipts: [boundReceipt("decision.floor", "DECISION_TIME", 8_000), boundReceipt("translation.floor", "TRANSLATION_TIME", 7_000)] };
    const decision = evaluateActionEligibilityRaw(input, { ...context, evaluationBoundary: "DECISION_TIME", domainFacts: domainFacts(constrained) });
    expect(decision.ok && decision.result).toMatchObject({ evaluationBoundary: "DECISION_TIME", status: "ELIGIBLE" });
    expect(decision.ok && decision.result.checks.some((check) => check.checkId === "translation.floor")).toBe(false);
    const translation = evaluateActionEligibilityRaw(input, { ...context, evaluationBoundary: "TRANSLATION_TIME", domainFacts: domainFacts(constrained).map((fact) => ({ ...fact, evaluationBoundary: "TRANSLATION_TIME" as const })) });
    expect(translation.ok && translation.result).toMatchObject({ evaluationBoundary: "TRANSLATION_TIME", status: "INELIGIBLE" });
    expect(translation.ok && translation.result.checks.some((check) => check.checkId === "decision.floor")).toBe(false);
  });

  it("uses a mapped minimum-margin constraint only at its canonical boundary and exactly once", () => {
    const legacy = structuredClone(increaseGoogleShoppingBudget20) as MutableLegacy;
    legacy.preconditions = [];
    legacy.constraints = [{
      constraintId: constraintId("minimum_margin"),
      constraintClass: "hard",
      expression: { kind: "property_comparison", propertyId: "finance.gross_margin_rate", operator: "GTE", value: { kind: "percentage", basisPoints: 3000 } },
    }];
    const candidate = action(legacy);
    expect(candidate.constraints[0]).toMatchObject({ kind: "MINIMUM_MARGIN", evaluationBoundary: "DECISION_TIME" });
    const translationFacts = domainFacts(candidate).map((fact) => ({ ...fact, evaluationBoundary: "TRANSLATION_TIME" as const }));
    const translation = evaluateActionEligibilityRaw(
      { action: candidate },
      { evaluationBoundary: "TRANSLATION_TIME", evaluatedAt, observations: [], domainFacts: translationFacts },
    );
    expect(translation.ok && translation.result.checks.some((check) => check.checkId === "minimum_margin")).toBe(false);

    const constraint = candidate.constraints[0]!;
    const fingerprint = fingerprintCanonicalAction(candidate);
    const decision = evaluateActionEligibilityRaw(
      { action: candidate },
      {
        evaluationBoundary: "DECISION_TIME", evaluatedAt, observations: [], domainFacts: domainFacts(candidate),
        constraintReceipts: [{
          evidenceRef: "margin:typed", actionId: candidate.actionId, actionFingerprint: fingerprint,
          constraintId: constraint.constraintId, target: constraint.target, evaluationBoundary: "DECISION_TIME",
          observedAt: "2026-09-21T13:05:00Z", sourceRef: "ledger", provenance: ["ledger:margin"],
          fact: { kind: "VALUE", valueRef: { kind: "FACT", ref: "finance.gross_margin_rate" }, valueBasis: "PROJECTED_AFTER_ACTION", value: { valueType: "PERCENTAGE", basisPoints: 3200 } },
        }],
      },
    );
    expect(decision.ok && decision.result.status).toBe("ELIGIBLE");
    expect(decision.ok && decision.result.checks.filter((check) => check.checkId === "minimum_margin")).toHaveLength(1);
    expect(decision.ok && decision.result.checks.find((check) => check.checkId === "minimum_margin")).toMatchObject({ status: "SATISFIED", evidenceRefs: ["margin:typed"] });
  });
});
