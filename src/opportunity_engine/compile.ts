import { opportunitySchema, type Opportunity } from "./contract.js";
import { validateActionSpaceDecision } from "../action_validation/index.js";
import { translateBusinessAction } from "../action_translation/index.js";

export type OpportunityCompilationResult =
  | { readonly status: "TRANSLATED"; readonly opportunityId: string; readonly translation: ReturnType<typeof translateBusinessAction> }
  | { readonly status: "BLOCKED"; readonly opportunityId: string; readonly code: string; readonly reason: string };

export function compileOpportunityToSimulator(
  input: Opportunity,
  translationContext: unknown,
): OpportunityCompilationResult {
  const opportunity = opportunitySchema.parse(input);
  if (opportunity.status !== "ACTIONABLE") {
    return {
      status: "BLOCKED",
      opportunityId: opportunity.opportunityId,
      code: "OPPORTUNITY_NOT_ACTIONABLE",
      reason: "Only actionable opportunities may cross the simulator translation boundary.",
    };
  }
  if (!opportunity.canonicalAction) {
    return {
      status: "BLOCKED",
      opportunityId: opportunity.opportunityId,
      code: "CANONICAL_ACTION_REQUIRED",
      reason: "A validated canonical Action is required before simulator translation.",
    };
  }
  const validated = validateActionSpaceDecision(opportunity.canonicalAction);
  if (!validated.ok || validated.decision.kind !== "ACTION") {
    return {
      status: "BLOCKED",
      opportunityId: opportunity.opportunityId,
      code: "INVALID_CANONICAL_ACTION",
      reason: "The attached canonical Action failed the Action Space validation boundary.",
    };
  }
  return {
    status: "TRANSLATED",
    opportunityId: opportunity.opportunityId,
    translation: translateBusinessAction(validated.decision.action, translationContext),
  };
}
