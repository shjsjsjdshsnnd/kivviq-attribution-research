import {
  opportunitySchema,
  type Opportunity,
} from "./contract.js";
import {
  validateActionSpaceDecision,
} from "../action_validation/index.js";
import type { ActionSpaceCanonicalAction } from "../canonical_action/schema.js";

export type OpportunityBindingResult =
  | {
      readonly ok: true;
      readonly opportunity: Opportunity;
    }
  | {
      readonly ok: false;
      readonly code:
        | "OPPORTUNITY_NOT_ACTIONABLE"
        | "INVALID_CANONICAL_ACTION"
        | "ACTION_TYPE_MISMATCH"
        | "PROVENANCE_MISSING";
      readonly reason: string;
    };

export function opportunityProvenanceRef(opportunityId: string): string {
  return "opportunity:" + opportunityId;
}

export function bindCanonicalActionToOpportunity(
  rawOpportunity: Opportunity,
  rawAction: unknown,
): OpportunityBindingResult {
  const opportunity = opportunitySchema.parse(rawOpportunity);
  if (opportunity.status !== "ACTIONABLE") {
    return {
      ok: false,
      code: "OPPORTUNITY_NOT_ACTIONABLE",
      reason: "Only an actionable Opportunity can be bound to an executable canonical Action.",
    };
  }

  const validated = validateActionSpaceDecision(rawAction);
  if (!validated.ok || validated.decision.kind !== "ACTION") {
    return {
      ok: false,
      code: "INVALID_CANONICAL_ACTION",
      reason: "The proposed Action failed the Action Space validation boundary.",
    };
  }

  const action = validated.decision.action;
  if (action.what.actionType !== opportunity.intervention.actionType) {
    return {
      ok: false,
      code: "ACTION_TYPE_MISMATCH",
      reason:
        "Canonical Action type " +
        action.what.actionType +
        " does not match Opportunity intervention type " +
        opportunity.intervention.actionType +
        ".",
    };
  }

  const requiredProvenance = opportunityProvenanceRef(opportunity.opportunityId);
  if (!action.provenance.includes(requiredProvenance)) {
    return {
      ok: false,
      code: "PROVENANCE_MISSING",
      reason:
        "Canonical Action provenance must include " +
        requiredProvenance +
        " so execution remains traceable to the Opportunity.",
    };
  }

  return {
    ok: true,
    opportunity: opportunitySchema.parse({
      ...opportunity,
      canonicalAction: action satisfies ActionSpaceCanonicalAction,
    }),
  };
}
