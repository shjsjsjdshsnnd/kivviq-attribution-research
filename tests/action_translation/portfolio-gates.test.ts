import { describe, expect, it } from "vitest";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";
import { evaluateActionEligibility } from "../../src/action_eligibility/evaluate.js";

const NOW = "2026-09-27T00:00:00Z";
const prerequisite = canonicalActionSchema.parse({ schemaVersion: "2.0.0", actionId: "action_prerequisite", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing: immediatePersistentBudgetTiming, provenance: ["evidence.prerequisite"] });
const dependent = canonicalActionSchema.parse({
  schemaVersion: "2.0.0", actionId: "action_dependent", what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } }, timing: immediatePersistentBudgetTiming, provenance: ["evidence.dependent"],
  dependencies: [{ dependencyId: "dependency.prerequisite", kind: "ENTITY_LIFECYCLE", evaluationBoundary: "TRANSLATION_TIME", prerequisite: { entityKind: "ACTION", actionId: prerequisite.actionId, actionFingerprint: fingerprintCanonicalAction(prerequisite) }, requiredState: "COMPLETED", whenUnknown: "BLOCKED" }],
});

function eligible(action: typeof dependent) {
  const raw = { evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME" as const, observations: [], constraintReceipts: [], domainFacts: [] };
  const result = evaluateActionEligibility({ action, nativeConstraints: { constraints: action.constraints, resourceRequirements: [] } }, raw);
  if (!result.ok) throw new Error("fixture eligibility failed");
  return { raw, result: result.result };
}

describe("translation portfolio gates", () => {
  it("replays dependency evidence and emits nothing when a prerequisite is unresolved", () => {
    const eligibility = eligible(dependent);
    const translated = translateCanonicalAction(dependent, {
      timing: { approvedClock: NOW }, eligibility: eligibility.result, eligibilityEvaluationContext: eligibility.raw,
      eligibilityResourceRequirements: [], eligibilityMaximumAgeSeconds: 300,
      dependencyContext: {
        evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", maximumAgeSeconds: 300,
        registry: [{ entityKind: "ACTION", action: prerequisite }], dependencyReceipts: [], investigationResults: [], constraintReceipts: [],
        eligibilityContexts: {}, eligibilityResourceRequirements: {}, experimentReadinessContexts: {},
      },
    });
    expect(translated).toMatchObject({ status: "INELIGIBLE_ACTION", code: "ACTION_DEPENDENCY_BLOCKED" });
    expect("interventions" in translated).toBe(false);
  });

  it("ignores a caller supplied satisfied result when raw receipts do not support it", () => {
    const eligibility = eligible(dependent);
    const translated = translateCanonicalAction(dependent, {
      timing: { approvedClock: NOW }, eligibility: eligibility.result, eligibilityEvaluationContext: eligibility.raw,
      eligibilityResourceRequirements: [], eligibilityMaximumAgeSeconds: 300,
      dependencyAssessment: { status: "SATISFIED" },
      dependencyContext: {
        evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", maximumAgeSeconds: 300,
        registry: [{ entityKind: "ACTION", action: prerequisite }], dependencyReceipts: [], investigationResults: [], constraintReceipts: [],
        eligibilityContexts: {}, eligibilityResourceRequirements: {}, experimentReadinessContexts: {},
      },
    } as unknown);
    expect(translated).toMatchObject({ status: "MISSING_CONTEXT", code: "INVALID_CANONICAL_CONTEXT" });
  });

  it("rejects compatibility evidence evaluated at the wrong boundary", () => {
    const eligibility = eligible(prerequisite as typeof dependent);
    const ref = { entityKind: "ACTION", actionId: prerequisite.actionId, actionFingerprint: fingerprintCanonicalAction(prerequisite) };
    expect(translateCanonicalAction(prerequisite, {
      timing: { approvedClock: NOW }, eligibility: eligibility.result, eligibilityEvaluationContext: eligibility.raw,
      eligibilityResourceRequirements: [], eligibilityMaximumAgeSeconds: 300,
      portfolioReferences: [ref],
      portfolioCompatibilityContext: { evaluatedAt: NOW, evaluationBoundary: "DECISION_TIME", registry: [{ entityKind: "ACTION", action: prerequisite }], timingContexts: {}, scopeIntersectionReceipts: [], priceBaselineReceipts: [], partitionReceipts: [] },
    })).toMatchObject({ status: "MISSING_CONTEXT", code: "PORTFOLIO_COMPATIBILITY_MISMATCH" });
  });
});
