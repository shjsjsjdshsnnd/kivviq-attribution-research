import type { CanonicalAction } from "../../src/canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../../src/canonical_action/serialization.js";
import { canonicalEligibilityTargetRef, evaluateActionEligibility, legacyEntityTargetRef } from "../../src/action_eligibility/evaluate.js";
import { domainEligibilityRequirements } from "../../src/action_eligibility/adapters.js";

export function evaluateEligibilityForTest(
  action: CanonicalAction,
  boundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME",
  evaluatedAt: string,
  requestedStatus: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN" = "ELIGIBLE",
) {
  const actionFingerprint = fingerprintCanonicalAction(action);
  const targetRef = canonicalEligibilityTargetRef(action);
  const common = { actionId: action.actionId, actionFingerprint, targetRef, evaluationBoundary: boundary, observedAt: evaluatedAt, sourceRef: "test.source", provenance: ["test:eligibility"] };
  const observations = "kind" in action.what && action.what.kind === "legacy_business"
    ? action.what.preconditions.map((precondition, index) => {
      const expression = precondition.expression;
      if (expression.kind === "entity_exists") return { ...common, kind: "ENTITY" as const, evidenceRef: `precondition.${index}`, entityRef: legacyEntityTargetRef(expression.target), exists: true };
      if (expression.kind === "capability_available") return { ...common, kind: "CAPABILITY" as const, evidenceRef: `precondition.${index}`, capabilityId: expression.capabilityId, available: true };
      if (expression.kind === "evidence_available") return { ...common, kind: "EVIDENCE" as const, evidenceRef: `precondition.${index}`, reference: expression.evidenceRef, available: true };
      return { ...common, kind: "PROPERTY" as const, evidenceRef: `precondition.${index}`, propertyId: expression.propertyId, value: expression.value };
    }) : [];
  let requirements = domainEligibilityRequirements(action);
  const hasDomainRequirements = requirements.length > 0;
  if (requestedStatus === "UNKNOWN") requirements = requirements.slice(1);
  const domainFacts = requirements.map((requirement, index) => ({
    ...common, kind: "DOMAIN_FACT" as const, factId: requirement.factId,
    value: !(requestedStatus === "INELIGIBLE" && index === 0), evidenceRef: `domain.${index}`,
    ...(requirement.ruleRef === undefined ? {} : { ruleRef: requirement.ruleRef }),
  }));
  const constraintReceipts = action.constraints.flatMap((constraint, index) => {
    if (constraint.evaluationBoundary !== boundary || constraint.kind !== "CUSTOM") return [];
    if (!hasDomainRequirements && requestedStatus === "UNKNOWN") return [];
    return [{
      evidenceRef: `constraint.${index}`, actionId: action.actionId, actionFingerprint, constraintId: constraint.constraintId,
      target: constraint.target, evaluationBoundary: boundary, observedAt: evaluatedAt, sourceRef: "test.policy", provenance: ["test:policy"],
      fact: { kind: "CUSTOM" as const, registryRef: constraint.registryRef, code: constraint.code, decision: !hasDomainRequirements && requestedStatus === "INELIGIBLE" ? "VIOLATED" as const : "SATISFIED" as const },
    }];
  });
  const evaluationContext = { evaluatedAt, evaluationBoundary: boundary, observations, constraintReceipts, domainFacts };
  const evaluated = evaluateActionEligibility({ action, nativeConstraints: { constraints: action.constraints, resourceRequirements: [] } }, evaluationContext);
  if (!evaluated.ok) throw new Error(evaluated.failure.messages.join(", "));
  return { eligibility: evaluated.result, evaluationContext, resourceRequirements: [] as const };
}

export function withTranslationEligibility(
  action: CanonicalAction,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const timing = context["timing"] as { approvedClock?: string } | undefined;
  const evaluatedAt = timing?.approvedClock ?? "2026-09-27T00:00:00Z";
  const evaluated = evaluateEligibilityForTest(action, "TRANSLATION_TIME", evaluatedAt);
  return {
    ...context,
    eligibilityMaximumAgeSeconds: 3600,
    eligibility: evaluated.eligibility,
    eligibilityEvaluationContext: evaluated.evaluationContext,
    eligibilityResourceRequirements: [],
  };
}
