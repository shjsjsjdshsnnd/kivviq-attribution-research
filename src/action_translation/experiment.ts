import { z } from "zod";
import { actionEligibilitySchema } from "../action_eligibility/schema.js";
import { hasValidEligibilityAssessmentFingerprint } from "../action_eligibility/integrity.js";
import { hasCompleteEligibilityCheckManifest } from "../action_eligibility/evaluate.js";
import type { CanonicalAction } from "../canonical_action/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { ExperimentWhat } from "../experiment/index.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../compound_action/schema.js";
import {
  ACTION_TRANSLATION_VERSION,
  type TranslationFailure,
  type TranslationOrigin,
  type TranslationResult,
} from "./types.js";

interface ExperimentTranslationContext {
  readonly timing?: unknown;
  readonly eligibility?: unknown;
  readonly eligibilityMaximumAgeSeconds?: number | undefined;
  readonly experimentArmRegistry?: unknown;
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
  const evaluated = Date.parse(eligibility.evaluatedAt), approved = Date.parse(approvedClock);
  if (evaluated > approved)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_FUTURE", "Eligibility evidence cannot be from the future.");
  if (approved - evaluated > context.eligibilityMaximumAgeSeconds * 1000)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ELIGIBILITY_STALE", "Eligibility evidence is stale.");
  const registry = experimentArmRegistrySchema.safeParse(context.experimentArmRegistry);
  if (!registry.success)
    return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_REGISTRY_REQUIRED", "A valid experiment arm registry is required before translation.");
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
    const actualFingerprint = registered.entityKind === "COMPOUND"
      ? fingerprintCompoundAction(registered.action)
      : fingerprintCanonicalAction(registered.action);
    if (actualFingerprint !== arm.actionFingerprint)
      return failure(action.actionId, "MISSING_CONTEXT", "EXPERIMENT_ARM_FINGERPRINT_MISMATCH", `Experiment arm ${arm.armId} does not match its registered semantic fingerprint.`);
  }
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
