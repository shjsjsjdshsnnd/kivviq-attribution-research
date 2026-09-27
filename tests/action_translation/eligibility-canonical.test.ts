import { describe, expect, it } from "vitest";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";
import { evaluateActionEligibility, expectedEligibilityCheckManifest } from "../../src/action_eligibility/evaluate.js";
import { fingerprintEligibilityAssessment } from "../../src/action_eligibility/integrity.js";
import { adaptLegacyAction } from "../../src/canonical_action/legacy.js";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import { evaluateEligibilityForTest } from "./eligibility-helper.js";

const NOW = "2026-09-27T00:00:00Z";
const base = canonicalActionSchema.parse({
  schemaVersion: "2.0.0",
  actionId: "action_atomic_eligibility",
  what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
  timing: immediatePersistentBudgetTiming,
  provenance: ["evidence.atomic"],
});

function assessment(action: typeof base, status: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN" = "ELIGIBLE") {
  const checks = expectedEligibilityCheckManifest(action, "TRANSLATION_TIME").map((check, index) => ({
    ...check,
    status: index === 0 && status !== "ELIGIBLE" ? (status === "INELIGIBLE" ? "VIOLATED" as const : "UNKNOWN" as const) : "SATISFIED" as const,
    reasonCodes: [status === "INELIGIBLE" ? "POLICY_DENIED" : status === "UNKNOWN" ? "MISSING_EVIDENCE" : "CHECK_SATISFIED"],
    evidenceRefs: status === "UNKNOWN" ? [] : ["eligibility.evidence"],
    missingInformation: status === "UNKNOWN" ? ["constraint evidence"] : [],
  }));
  const projection = { actionId: action.actionId, actionFingerprint: fingerprintCanonicalAction(action), evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME" as const, status, checks };
  return { ...projection, assessmentFingerprint: fingerprintEligibilityAssessment(projection) };
}

function context(eligibility?: unknown, eligibilityEvaluationContext: unknown = { evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", observations: [], constraintReceipts: [], domainFacts: [] }) {
  return { timing: { approvedClock: NOW }, eligibilityMaximumAgeSeconds: 3600, eligibilityEvaluationContext, eligibilityResourceRequirements: [], ...(eligibility === undefined ? {} : { eligibility }) };
}

describe("canonical atomic translation eligibility", () => {
  it("requires eligibility even for a no-op and translates a complete eligible assessment", () => {
    expect(translateCanonicalAction(base, context())).toMatchObject({ status: "MISSING_CONTEXT", code: "ACTION_ELIGIBILITY_REQUIRED" });
    expect(translateCanonicalAction(base, context(assessment(base)))).toMatchObject({ status: "TRANSLATED", decisionType: "NO_OP" });
  });

  it.each([
    ["INELIGIBLE", "INELIGIBLE_ACTION", "ACTION_INELIGIBLE"],
    ["UNKNOWN", "MISSING_CONTEXT", "ACTION_ELIGIBILITY_UNKNOWN"],
  ] as const)("gates a %s translation-time assessment", (status, resultStatus, code) => {
    const constrained = canonicalActionSchema.parse({
      ...base,
      constraints: [{ constraintId: "atomic.policy", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "atomic.policy", code: "ALLOWED" }],
    });
    const raw = {
      evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME", observations: [], domainFacts: [],
      constraintReceipts: status === "UNKNOWN" ? [] : [{
        evidenceRef: "eligibility.evidence", actionId: constrained.actionId, actionFingerprint: fingerprintCanonicalAction(constrained),
        constraintId: "atomic.policy", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", observedAt: NOW,
        sourceRef: "policy", provenance: ["policy:1"], fact: { kind: "CUSTOM", registryRef: "atomic.policy", code: "ALLOWED", decision: "VIOLATED" },
      }],
    };
    const evaluated = evaluateActionEligibility({ action: constrained, nativeConstraints: { constraints: constrained.constraints, resourceRequirements: [] } }, raw);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(evaluated.result.status).toBe(status);
    expect(translateCanonicalAction(constrained, context(evaluated.result, raw))).toMatchObject({ status: resultStatus, code });
  });

  it("rejects forged empty and mutated check manifests", () => {
    const constrained = canonicalActionSchema.parse({
      ...base,
      constraints: [{ constraintId: "atomic.policy", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "atomic.policy", code: "ALLOWED" }],
    });
    const valid = assessment(constrained);
    const { assessmentFingerprint: _validFingerprint, ...validProjection } = valid;
    const emptyProjection = { ...validProjection, checks: [] };
    const forgedEmpty = { ...emptyProjection, assessmentFingerprint: fingerprintEligibilityAssessment(emptyProjection) };
    expect(translateCanonicalAction(constrained, context(forgedEmpty))).toMatchObject({ status: "INVALID_ACTION", code: "INCOMPLETE_ACTION_ELIGIBILITY" });
    const mutated = { ...valid, checks: valid.checks.map((check) => ({ ...check, status: "VIOLATED" as const })) };
    expect(translateCanonicalAction(constrained, context(mutated))).toMatchObject({ status: "INVALID_ACTION", code: "INVALID_ACTION_ELIGIBILITY_INTEGRITY" });
  });

  it("rejects an all-satisfied forgery even when the caller recomputes its digest", () => {
    const constrained = canonicalActionSchema.parse({
      ...base,
      constraints: [{ constraintId: "atomic.policy", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "atomic.policy", code: "ALLOWED" }],
    });
    const raw = {
      evaluatedAt: NOW, evaluationBoundary: "TRANSLATION_TIME" as const, observations: [], domainFacts: [],
      constraintReceipts: [{ evidenceRef: "policy.denied", actionId: constrained.actionId, actionFingerprint: fingerprintCanonicalAction(constrained), constraintId: "atomic.policy", target: { kind: "GLOBAL" as const }, evaluationBoundary: "TRANSLATION_TIME" as const, observedAt: NOW, sourceRef: "policy", provenance: ["policy:deny"], fact: { kind: "CUSTOM" as const, registryRef: "atomic.policy", code: "ALLOWED", decision: "VIOLATED" as const } }],
    };
    const actual = evaluateActionEligibility({ action: constrained, nativeConstraints: { constraints: constrained.constraints, resourceRequirements: [] } }, raw);
    expect(actual.ok).toBe(true);
    if (!actual.ok) return;
    const { assessmentFingerprint: _actualFingerprint, ...actualProjection } = actual.result;
    const forgedProjection = { ...actualProjection, status: "ELIGIBLE" as const, checks: actual.result.checks.map((check) => ({ ...check, status: "SATISFIED" as const, reasonCodes: ["CUSTOM_SATISFIED"] })) };
    const forged = { ...forgedProjection, assessmentFingerprint: fingerprintEligibilityAssessment(forgedProjection) };
    expect(translateCanonicalAction(constrained, context(forged, raw))).toMatchObject({ status: "INVALID_ACTION", code: "ACTION_ELIGIBILITY_RECOMPUTATION_MISMATCH" });
  });

  it.each(["legacy observation", "domain fact", "constraint receipt"] as const)("applies gate freshness to a stale %s when raw max age is omitted", (kind) => {
    const actionValue = kind === "constraint receipt"
      ? canonicalActionSchema.parse({ ...base, constraints: [{ constraintId: "atomic.policy", kind: "CUSTOM", target: { kind: "GLOBAL" }, evaluationBoundary: "TRANSLATION_TIME", whenUnknown: "UNKNOWN", registryRef: "atomic.policy", code: "ALLOWED" }] })
      : adaptLegacyAction(increaseGoogleShoppingBudget20);
    const generated = evaluateEligibilityForTest(actionValue, "TRANSLATION_TIME", NOW);
    const staleAt = "2026-09-26T00:00:00Z";
    const raw = structuredClone(generated.evaluationContext);
    if (kind === "legacy observation") raw.observations[0]!.observedAt = staleAt;
    else if (kind === "domain fact") raw.domainFacts[0]!.observedAt = staleAt;
    else raw.constraintReceipts[0]!.observedAt = staleAt;
    const withoutRawAgeLimit = evaluateActionEligibility({ action: actionValue, nativeConstraints: { constraints: actionValue.constraints, resourceRequirements: [] } }, raw);
    expect(withoutRawAgeLimit.ok && withoutRawAgeLimit.result.status).toBe("ELIGIBLE");
    if (!withoutRawAgeLimit.ok) return;
    expect(translateCanonicalAction(actionValue, {
      timing: { approvedClock: NOW }, eligibility: withoutRawAgeLimit.result, eligibilityEvaluationContext: raw,
      eligibilityResourceRequirements: [], eligibilityMaximumAgeSeconds: 60,
    })).toMatchObject({ status: "INVALID_ACTION", code: "ACTION_ELIGIBILITY_RECOMPUTATION_MISMATCH" });
  });
});
