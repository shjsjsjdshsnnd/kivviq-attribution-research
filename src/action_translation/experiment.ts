import { z } from "zod";
import { actionEligibilitySchema } from "../action_eligibility/schema.js";
import { hasValidEligibilityAssessmentFingerprint } from "../action_eligibility/integrity.js";
import { hasCompleteEligibilityCheckManifest, hasMatchingRecomputedActionEligibility } from "../action_eligibility/evaluate.js";
import type { CanonicalAction } from "../canonical_action/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { ExperimentWhat } from "../experiment/index.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../compound_action/schema.js";
import { assessPortfolioCompatibility } from "../action_conflicts/assessment.js";
import { assessActionDependencies } from "../action_dependencies/assessment.js";
import {
  ACTION_TRANSLATION_VERSION,
  type TranslationFailure,
  type TranslationOrigin,
  type TranslationResult,
} from "./types.js";

interface ExperimentTranslationContext {
  readonly timing?: unknown;
  readonly eligibility?: unknown;
  readonly eligibilityEvaluationContext?: unknown;
  readonly eligibilityResourceRequirements?: readonly unknown[] | undefined;
  readonly eligibilityMaximumAgeSeconds?: number | undefined;
  readonly experimentArmRegistry?: unknown;
  readonly portfolioReferences?: readonly unknown[] | undefined;
  readonly portfolioCompatibilityContext?: unknown | undefined;
  readonly experimentArmDependencyContexts?: Readonly<Record<string, unknown>> | undefined;
}

const experimentArmRegistrySchema = z.array(z.union([
  z.object({
    entityKind: z.literal("ACTION"),
    action: canonicalActionSchema,
  }).strict(),
  z.object({
    entityKind: z.literal("COMPOUND"),
    action: z.lazy(() => compoundActionSchema),
  }).strict(),
]));

function failure(actionId: string, status: TranslationFailure["status"], code: string, message: string): TranslationFailure {
  return { actionId, status, code, message };
}

export function translateExperimentAction(
  action: CanonicalAction,
  specification: ExperimentWhat,
  context: ExperimentTranslationContext,
  origin?: TranslationOrigin,
): TranslationResult {
  const parsed = actionEligibilitySchema.safeParse(context.eligibility);
  if (!parsed.success)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_REQUIRED", "A valid, bound eligibility result is required before experiment translation.");
  const eligibility = parsed.data;
  if (!hasValidEligibilityAssessmentFingerprint(eligibility))
    return failure(action.actionId, "INVALID_ACTION", "INVALID_EXPERIMENT_ELIGIBILITY_INTEGRITY", "Experiment eligibility checks do not match their assessment fingerprint.");
  const fingerprint = fingerprintCanonicalAction(action);
  if (eligibility.actionId !== action.actionId || eligibility.actionFingerprint !== fingerprint)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_MISMATCH", "Eligibility must bind the exact experiment action and semantic fingerprint.");
  if (eligibility.evaluationBoundary !== "TRANSLATION_TIME")
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_BOUNDARY", "Experiment translation requires TRANSLATION_TIME eligibility.");
  if (!hasCompleteEligibilityCheckManifest(action, "TRANSLATION_TIME", eligibility.checks))
    return failure(action.actionId, "INVALID_ACTION", "INCOMPLETE_EXPERIMENT_ELIGIBILITY", "Eligibility must contain the complete deterministic check manifest for this action and boundary.");
  const approvedClock = context.timing && typeof context.timing === "object" && "approvedClock" in context.timing
    ? (context.timing as { approvedClock?: unknown }).approvedClock
    : undefined;
  if (typeof approvedClock !== "string" || context.eligibilityMaximumAgeSeconds === undefined)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_FRESHNESS_REQUIRED", "An approved clock and maximum eligibility age are required.");
  if (!hasMatchingRecomputedActionEligibility(action, eligibility, context.eligibilityEvaluationContext, context.eligibilityResourceRequirements, context.eligibilityMaximumAgeSeconds))
    return failure(action.actionId, "INVALID_ACTION", "EXPERIMENT_ELIGIBILITY_RECOMPUTATION_MISMATCH", "Experiment eligibility must exactly match a recomputation from raw evidence under the gate freshness limit.");
  const evaluated = Date.parse(eligibility.evaluatedAt), approved = Date.parse(approvedClock);
  if (evaluated > approved)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_FUTURE", "Eligibility evidence cannot be from the future.");
  if (approved - evaluated > context.eligibilityMaximumAgeSeconds * 1000)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_STALE", "Eligibility evidence is stale.");
  const registry = experimentArmRegistrySchema.safeParse(context.experimentArmRegistry);
  if (!registry.success)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_REGISTRY_REQUIRED", "A valid experiment arm registry is required before translation.");
  const resolvedArmEntries: (typeof registry.data)[number][] = [];
  for (const arm of specification.arms) {
    const compoundArm = arm.entityKind === "COMPOUND";
    const entityKind = compoundArm ? "COMPOUND" : "ACTION";
    const referenceId = compoundArm ? arm.compoundActionId : arm.actionId;
    const matches = registry.data.filter((entry) =>
      entry.entityKind === entityKind &&
      (entry.entityKind === "COMPOUND"
        ? entry.action.compoundActionId === referenceId
        : entry.action.actionId === referenceId),
    );
    if (!matches.length)
      return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_REQUIRED", `Experiment arm ${arm.armId} requires exact registry entry ${entityKind}:${referenceId}.`);
    if (matches.length > 1)
      return failure(action.actionId, "MISSING_CONTEXT", "AMBIGUOUS_EXPERIMENT_ARM", `Experiment arm ${arm.armId} has ambiguous registry entries for ${entityKind}:${referenceId}.`);
    const registered = matches[0]!;
    resolvedArmEntries.push(registered);
    const actualFingerprint = registered.entityKind === "COMPOUND"
      ? fingerprintCompoundAction(registered.action)
      : fingerprintCanonicalAction(registered.action);
    if (actualFingerprint !== arm.actionFingerprint)
      return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_FINGERPRINT_MISMATCH", `Experiment arm ${arm.armId} does not match its registered semantic fingerprint.`);
  }
  if (registry.data.length !== specification.arms.length)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_REGISTRY_EXACT_SET_REQUIRED", "The arm registry must contain exactly one entry for every arm and no unrelated entries.");
  const experimentReference = { entityKind: "ACTION" as const, actionId: action.actionId, actionFingerprint: fingerprint };
  const referenceKey = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    return candidate["entityKind"] === "ACTION" ? `ACTION:${candidate["actionId"]}:${candidate["actionFingerprint"]}`
      : candidate["entityKind"] === "COMPOUND" ? `COMPOUND:${candidate["compoundActionId"]}:${candidate["compoundFingerprint"]}` : undefined;
  };
  const actualKeys = (context.portfolioReferences ?? []).map(referenceKey);
  const experimentKey = referenceKey(experimentReference)!;
  if (actualKeys.some((key) => key === undefined) || actualKeys.filter((key) => key === experimentKey).length !== 1)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_PORTFOLIO_REFERENCE_MISMATCH", "The portfolio must contain the exact experiment action once; other entries are concurrent external actions.");
  const atomicArmActions = resolvedArmEntries.flatMap((entry) => entry.entityKind === "ACTION" ? [entry.action] : entry.action.components.map((component) => component.action));
  for (const member of atomicArmActions) {
    if (member.dependencies.length === 0) continue;
    const raw = context.experimentArmDependencyContexts?.[member.actionId];
    if (raw === undefined)
      return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_DEPENDENCY_CONTEXT_REQUIRED", `Raw dependency evidence is required for arm member ${member.actionId}.`);
    const assessment = assessActionDependencies(member, raw);
    if (assessment.actionFingerprint !== fingerprintCanonicalAction(member) || assessment.evaluationBoundary !== "TRANSLATION_TIME" || Date.parse(assessment.evaluatedAt) !== approved)
      return { ...failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_DEPENDENCY_MISMATCH", `Dependency evidence for ${member.actionId} is not bound to translation time.`), dependencyAssessment: assessment };
    if (assessment.status === "BLOCKED")
      return { ...failure(action.actionId, "INELIGIBLE_ACTION", "EXPERIMENT_ARM_DEPENDENCY_BLOCKED", `An experiment arm dependency is blocked for ${member.actionId}.`), dependencyAssessment: assessment };
    if (assessment.status === "UNKNOWN")
      return { ...failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_DEPENDENCY_UNKNOWN", `An experiment arm dependency is unresolved for ${member.actionId}.`), dependencyAssessment: assessment };
  }
  if (context.portfolioCompatibilityContext === undefined)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_PORTFOLIO_COMPATIBILITY_REQUIRED", "Raw portfolio compatibility evidence is required for experiment arms.");
  const rawCompatibility = context.portfolioCompatibilityContext;
  const compatibilityMaximumAge = rawCompatibility && typeof rawCompatibility === "object" && !Array.isArray(rawCompatibility) ? (rawCompatibility as Record<string, unknown>)["maximumAgeSeconds"] : undefined;
  if (!rawCompatibility || typeof rawCompatibility !== "object" || Array.isArray(rawCompatibility) || (rawCompatibility as Record<string, unknown>)["evaluationBoundary"] !== "TRANSLATION_TIME" || Date.parse(String((rawCompatibility as Record<string, unknown>)["evaluatedAt"])) !== approved || typeof compatibilityMaximumAge !== "number" || !Number.isFinite(compatibilityMaximumAge) || compatibilityMaximumAge < 0)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_PORTFOLIO_COMPATIBILITY_MISMATCH", "Compatibility must be recomputed with freshness at the approved translation boundary and time.");
  const compatibility = assessPortfolioCompatibility(context.portfolioReferences, rawCompatibility);
  if (compatibility.status === "CONFLICTING")
    return { ...failure(action.actionId, "INELIGIBLE_ACTION", "EXPERIMENT_PORTFOLIO_CONFLICT", "Experiment arms contain an impossible portfolio."), portfolioCompatibility: compatibility };
  if (compatibility.status === "UNKNOWN" || compatibility.validity !== "VALID")
    return { ...failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_PORTFOLIO_COMPATIBILITY_UNKNOWN", "Experiment arm compatibility is unresolved."), portfolioCompatibility: compatibility };
  const derived = eligibility.checks.some((check) => check.status === "VIOLATED")
    ? "INELIGIBLE"
    : eligibility.checks.some((check) => check.status === "UNKNOWN")
      ? "UNKNOWN"
      : "ELIGIBLE";
  if (derived !== eligibility.status)
    return failure(action.actionId, "INVALID_ACTION", "INVALID_EXPERIMENT_ELIGIBILITY", "Eligibility status does not match its bound checks.");
  if (eligibility.status === "INELIGIBLE")
    return failure(action.actionId, "INELIGIBLE_ACTION", "EXPERIMENT_INELIGIBLE", "The experiment violates one or more eligibility checks.");
  if (eligibility.status === "UNKNOWN")
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_UNKNOWN", "Experiment eligibility remains unresolved.");
  if (!action.population)
    return failure(action.actionId, "INVALID_ACTION", "EXPERIMENT_POPULATION_REQUIRED", "The experiment requires an envelope population.");
  return {
    status: "TRANSLATED",
    originatingBusinessActionId: origin?.originatingBusinessActionId ?? action.actionId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    interventions: [],
    decisionType: "EXPERIMENT",
    experimentTasks: [{
      actionId: action.actionId,
      actionFingerprint: fingerprint,
      specification,
      population: action.population,
      timing: action.timing,
      eligibility: { evaluationBoundary: "TRANSLATION_TIME", evaluatedAt: eligibility.evaluatedAt },
    }],
  };
}
