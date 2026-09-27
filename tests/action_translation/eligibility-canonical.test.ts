import { describe, expect, it } from "vitest";
import { canonicalActionSchema } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";
import { expectedEligibilityCheckManifest } from "../../src/action_eligibility/evaluate.js";
import { fingerprintEligibilityAssessment } from "../../src/action_eligibility/integrity.js";

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

function context(eligibility?: unknown) {
  return { timing: { approvedClock: NOW }, eligibilityMaximumAgeSeconds: 3600, ...(eligibility === undefined ? {} : { eligibility }) };
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
    expect(translateCanonicalAction(constrained, context(assessment(constrained, status)))).toMatchObject({ status: resultStatus, code });
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
});
