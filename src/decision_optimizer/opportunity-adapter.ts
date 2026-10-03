import { opportunitySetSchema } from "../opportunity_engine/contract.js";
import { bindCanonicalActionToOpportunity } from "../opportunity_engine/binding.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { ActionSpaceCanonicalAction } from "../canonical_action/schema.js";
import { resolveActionTiming } from "../action_timing/resolution.js";
import type { ActionTimingResolutionContext } from "../action_timing/types.js";
import { validateActionSpaceActionEligibility, validateActionSpacePortfolio } from "../action_validation/index.js";
import type { ActionOption, Candidate, Decision, OptimizationInput, PredictionBatch, PredictionRequest } from "./types.js";
import { optimizeDecision } from "./optimizer.js";
import { copyData, deepFreeze } from "./validation.js";

export interface OpportunityExecutionBinding {
  opportunityId: string;
  snapshotId: string;
  actionFingerprint: string;
  owner: string;
  resources: ActionOption["resources"];
  dependencies: ActionOption["dependencies"];
  stopRules: ActionOption["stopRules"];
  timingContext: ActionTimingResolutionContext;
  eligibilityContext: unknown;
  resourceRequirements: unknown[];
}
export interface CanonicalTwinGateway {
  predict(request: Readonly<PredictionRequest & {
    canonicalCandidates: { candidateId: string; actions: ActionSpaceCanonicalAction[] }[];
  }>): Promise<PredictionBatch> | PredictionBatch;
}
export interface OpportunityOptimizationResult {
  decision: Decision;
  skippedOpportunities: { opportunityId: string; reason: string }[];
}
/**
 * Finite, day-aligned atomic Actions only in v0.1. Unresolved timing, instantaneous/
 * recurring/persistent Actions and missing bindings are explicit errors, never rounded.
 * Source Opportunity estimates are deliberately NOT summed or used as Twin predictions.
 */
export async function optimizeOpportunities(
  rawSet: unknown,
  rawInput: Omit<OptimizationInput, "options">,
  rawBindings: readonly OpportunityExecutionBinding[],
  compatibilityFor: (candidate: Readonly<Candidate>, actions: readonly ActionSpaceCanonicalAction[]) => NonNullable<Parameters<typeof validateActionSpacePortfolio>[1]>,
  twin: CanonicalTwinGateway,
): Promise<OpportunityOptimizationResult> {
  const set = opportunitySetSchema.parse(copyData(rawSet));
  if (!set.evidenceComplete) throw new Error("INCOMPLETE_OPPORTUNITY_EVIDENCE");
  const input = copyData(rawInput); const bindings = copyData(rawBindings);
  if (set.merchantId !== input.context.merchantId || Date.parse(set.asOf) !== Date.parse(input.context.asOf)) throw new Error("Opportunity set merchant/as-of mismatch");
  const byOpportunity = new Map<string, OpportunityExecutionBinding>();
  for (const binding of bindings) {
    if (byOpportunity.has(binding.opportunityId) || !set.opportunities.some(item => item.opportunityId === binding.opportunityId)) throw new Error("Duplicate/unknown opportunity binding");
    byOpportunity.set(binding.opportunityId, binding);
  }
  const options: ActionOption[] = []; const actions = new Map<string, ActionSpaceCanonicalAction>();
  const bindingByOption = new Map<string, OpportunityExecutionBinding>();
  const skippedOpportunities: OpportunityOptimizationResult["skippedOpportunities"] = [];
  for (const opportunity of set.opportunities) {
    if (opportunity.status !== "ACTIONABLE") {
      skippedOpportunities.push({ opportunityId: opportunity.opportunityId, reason: opportunity.status === "NO_ACTION" ? "Status quo is the shared baseline candidate" : opportunity.status }); continue;
    }
    const binding = byOpportunity.get(opportunity.opportunityId);
    if (!binding || !opportunity.canonicalAction) throw new Error(`CANONICAL_BINDING_REQUIRED:${opportunity.opportunityId}`);
    const bound = bindCanonicalActionToOpportunity(opportunity, opportunity.canonicalAction);
    if (!bound.ok) throw new Error(`${bound.code}:${opportunity.opportunityId}`);
    const action = bound.opportunity.canonicalAction!;
    const fingerprint = fingerprintCanonicalAction(action);
    if (binding.snapshotId !== input.context.snapshotId || binding.actionFingerprint !== fingerprint) throw new Error(`STALE_OR_SUBSTITUTED_BINDING:${opportunity.opportunityId}`);
    if (opportunity.constraints.some(check => check.status !== "SATISFIED")) throw new Error(`UNRESOLVED_OR_VIOLATED_OPPORTUNITY_CONSTRAINT:${opportunity.opportunityId}`);
    for (const resource of opportunity.intervention.requiredResources) if (!binding.resources.some(use => use.resourceId === resource)) throw new Error(`UNBOUND_REQUIRED_RESOURCE:${resource}`);
    for (const dependency of opportunity.prioritization.dependencies) if (!binding.dependencies.some(item => item.opportunityId === dependency)) throw new Error(`UNBOUND_DEPENDENCY:${dependency}`);
    if (binding.timingContext.actionId !== action.actionId || Date.parse(binding.timingContext.approvedClock) !== Date.parse(input.context.asOf)) throw new Error("Timing context identity/clock mismatch");
    const timing = resolveActionTiming(action.timing, binding.timingContext);
    if (timing.status !== "VALID" || !timing.resolvedEffectiveStart || !timing.resolvedEnd || timing.occurrences.length > 1) throw new Error(`UNSUPPORTED_OR_UNRESOLVED_TIMING:${action.actionId}`);
    const startDay = input.context.dayBoundaries.findIndex(value => Date.parse(value) === Date.parse(timing.resolvedEffectiveStart!));
    const endDay = input.context.dayBoundaries.findIndex(value => Date.parse(value) === Date.parse(timing.resolvedEnd!));
    if (startDay < 0 || endDay <= startDay) throw new Error(`FINITE_DAY_ALIGNED_TIMING_REQUIRED:${action.actionId}`);
    if (opportunity.intervention.target.state !== "RESOLVED" || opportunity.intervention.parameters.state === "NEEDS_INPUT") throw new Error("Unresolved intervention identity");
    const optionId = action.actionId;
    const evidence = [...new Set([...opportunity.evidence.businessStateEvidenceRefs, ...opportunity.evidence.estimationEvidenceRefs, ...action.provenance])];
    const option: ActionOption = {
      optionId, opportunityId: opportunity.opportunityId, merchantId: set.merchantId, snapshotId: input.context.snapshotId,
      actionId: action.actionId, actionFingerprint: fingerprint, label: opportunity.title, actionType: action.what.actionType,
      targetRef: opportunity.intervention.target.ref,
      parameters: opportunity.intervention.parameters.state === "READY" ? opportunity.intervention.parameters.values : {},
      startDay, endDay, resources: binding.resources, exclusiveGroups: opportunity.mutuallyExclusiveGroup ? [opportunity.mutuallyExclusiveGroup] : [],
      conflictKeys: opportunity.conflicts, dependencies: binding.dependencies, reversibility: opportunity.prioritization.reversibility,
      owner: binding.owner, evidenceRefs: evidence,
      assumptions: opportunity.evidence.assumptions.map(assumption => assumption.statement), stopRules: binding.stopRules,
    };
    options.push(option); actions.set(optionId, deepFreeze(copyData(action)) as ActionSpaceCanonicalAction); bindingByOption.set(optionId, binding);
  }
  const canonicalFor = (candidate: Readonly<Candidate>): ActionSpaceCanonicalAction[] => candidate.optionIds.map(optionId => {
    const action = actions.get(optionId); if (!action) throw new Error("Unknown canonical option"); return action;
  });
  const decision = await optimizeDecision({ ...input, options }, {
    predict(request) {
      return twin.predict(deepFreeze({ ...request, canonicalCandidates: request.candidates.map(candidate => ({ candidateId: candidate.candidateId, actions: canonicalFor(candidate) })) }));
    },
  }, {
    assess(candidate) {
      for (const optionId of candidate.optionIds) {
        const binding = bindingByOption.get(optionId)!;
        const checked = validateActionSpaceActionEligibility(actions.get(optionId), { evaluationContext: binding.eligibilityContext, resourceRequirements: binding.resourceRequirements });
        if (!checked.ok) return { status: checked.eligibility?.status === "INELIGIBLE" ? "INVALID" : "UNKNOWN", reasons: checked.issues.map(issue => `${issue.code}:${issue.message}`) };
      }
      const canonical = canonicalFor(candidate);
      const context = compatibilityFor(candidate, canonical);
      if (!context) return { status: "UNKNOWN", reasons: ["PORTFOLIO_COMPATIBILITY_CONTEXT_REQUIRED"] };
      const checked = validateActionSpacePortfolio(canonical, context);
      return checked.ok ? { status: "VALID", reasons: [] }
        : { status: checked.issues.some(issue => issue.code === "PORTFOLIO_CONFLICT") ? "INVALID" : "UNKNOWN", reasons: checked.issues.map(issue => `${issue.code}:${issue.message}`) };
    },
  });
  return { decision, skippedOpportunities };
}
