import type { CanonicalAction } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { expectedEligibilityCheckManifest } from "../../src/action_eligibility/evaluate.js";
import { fingerprintEligibilityAssessment } from "../../src/action_eligibility/integrity.js";

export function withTranslationEligibility(
  action: CanonicalAction,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const timing = context["timing"] as { approvedClock?: string } | undefined;
  const evaluatedAt = timing?.approvedClock ?? "2026-09-27T00:00:00Z";
  const checks = expectedEligibilityCheckManifest(action, "TRANSLATION_TIME").map((check) => ({
    ...check,
    status: "SATISFIED" as const,
    reasonCodes: ["CHECK_SATISFIED"],
    evidenceRefs: ["eligibility.evidence"],
    missingInformation: [],
  }));
  const projection = {
    actionId: action.actionId,
    actionFingerprint: fingerprintCanonicalAction(action),
    evaluatedAt,
    evaluationBoundary: "TRANSLATION_TIME" as const,
    status: "ELIGIBLE" as const,
    checks,
  };
  return {
    ...context,
    eligibilityMaximumAgeSeconds: 3600,
    eligibility: { ...projection, assessmentFingerprint: fingerprintEligibilityAssessment(projection) },
  };
}
