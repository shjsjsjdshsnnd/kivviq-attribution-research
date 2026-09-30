import { z } from "zod";
import type { CanonicalAction } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { EligibilityCheck } from "./schema.js";
import {
  domainEligibilityRequirementsForWhat,
  domainFamilyOfWhat,
  DOMAIN_ELIGIBILITY_FACT_IDS,
  expectedDomainEligibilityCheckIdsForWhat,
  type DomainEligibilityRequirement,
} from "./definitions.js";

const ref = z.string().min(1);
const utcZ = z.string().datetime().regex(/Z$/);

export const domainFactIdSchema = z.enum(DOMAIN_ELIGIBILITY_FACT_IDS);

export const domainEligibilityFactSchema = z.object({
  kind: z.literal("DOMAIN_FACT"),
  factId: domainFactIdSchema,
  value: z.boolean(),
  evidenceRef: ref,
  actionId: ref,
  actionFingerprint: ref,
  targetRef: z.string().regex(/^eligibility-target:fnv1a64:[0-9a-f]{16}$/),
  evaluationBoundary: z.enum(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"]),
  observedAt: utcZ,
  sourceRef: ref,
  provenance: z.array(ref).min(1),
  ruleRef: ref.optional(),
}).strict().superRefine((fact, context) => {
  const isRuleFact = fact.factId === "LIFECYCLE_ELIGIBILITY_RULE_ALLOWS" || fact.factId === "LIFECYCLE_SUPPRESSION_RULE_CLEAR";
  if (isRuleFact && fact.ruleRef === undefined) context.addIssue({ code: "custom", path: ["ruleRef"], message: "Lifecycle rule facts require ruleRef" });
  if (!isRuleFact && fact.ruleRef !== undefined) context.addIssue({ code: "custom", path: ["ruleRef"], message: "ruleRef is only valid for lifecycle rule facts" });
});

export type DomainEligibilityFact = z.infer<typeof domainEligibilityFactSchema>;

export function domainEligibilityRequirements(action: CanonicalAction): readonly DomainEligibilityRequirement[] {
  return domainEligibilityRequirementsForWhat(action.what);
}

export function expectedDomainEligibilityCheckIds(action: CanonicalAction): readonly string[] {
  return expectedDomainEligibilityCheckIdsForWhat(action.what);
}

function unknown(checkId: string, reasonCodes: string[], evidenceRefs: string[] = []): EligibilityCheck {
  return { kind: "DOMAIN_RULE", checkId, status: "UNKNOWN", reasonCodes, evidenceRefs, missingInformation: [`domain_fact:${checkId}`] };
}

export function evaluateDomainEligibility(input: {
  action: CanonicalAction;
  targetRef: string;
  evaluatedAt: string;
  evaluationBoundary: DomainEligibilityFact["evaluationBoundary"];
  maximumAgeSeconds?: number;
  facts: readonly DomainEligibilityFact[];
}): EligibilityCheck[] {
  const family = domainFamilyOfWhat(input.action.what);
  if (!family) return [];
  const fingerprint = fingerprintCanonicalAction(input.action);
  const bound = input.facts.filter((fact) => fact.actionId === input.action.actionId && fact.actionFingerprint === fingerprint && fact.targetRef === input.targetRef && fact.evaluationBoundary === input.evaluationBoundary);
  const requirements = domainEligibilityRequirements(input.action);
  return requirements.map((requirement): EligibilityCheck => {
    const checkId = `domain.${family}.${requirement.suffix}`;
    const matches = bound.filter((fact) => fact.factId === requirement.factId && fact.ruleRef === requirement.ruleRef);
    if (matches.length === 0) return unknown(checkId, ["MISSING_BOUND_DOMAIN_FACT"]);
    if (matches.length > 1) return unknown(checkId, ["AMBIGUOUS_BOUND_DOMAIN_FACT"], [...new Set(matches.map((fact) => fact.evidenceRef))].sort());
    const fact = matches[0]!;
    const observed = Date.parse(fact.observedAt);
    const evaluated = Date.parse(input.evaluatedAt);
    if (observed > evaluated) return unknown(checkId, ["FUTURE_DOMAIN_FACT"], [fact.evidenceRef]);
    if (input.maximumAgeSeconds !== undefined && evaluated - observed > input.maximumAgeSeconds * 1000)
      return unknown(checkId, ["STALE_DOMAIN_FACT"], [fact.evidenceRef]);
    return {
      kind: "DOMAIN_RULE",
      checkId,
      status: fact.value ? "SATISFIED" : "VIOLATED",
      reasonCodes: [fact.value ? requirement.trueReason : requirement.falseReason],
      evidenceRefs: [fact.evidenceRef],
      missingInformation: [],
    };
  }).sort((left, right) => left.checkId.localeCompare(right.checkId));
}
