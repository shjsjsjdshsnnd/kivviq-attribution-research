import { z } from "zod";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { resolveActionTiming } from "../action_timing/resolution.js";
import type { ActionTimingResolutionContext } from "../action_timing/types.js";
import {
  populationDefinitionSchema,
  populationEvaluationSchema,
  populationSnapshotSchema,
  fingerprintPopulationDefinition,
} from "../population/index.js";
import type { TranslationFailure } from "./types.js";
import {
  ACTION_TRANSLATION_VERSION,
  type TranslationResult,
  type TranslationOrigin,
} from "./types.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import { decisionWhatSchema } from "../decision_forms/index.js";
import { validateInvestigationExecutionHorizon } from "../decision_forms/timing.js";
import { translateResolvedLegacyBusiness } from "./canonical-legacy.js";
import type { CanonicalAction } from "../canonical_action/schema.js";
import type { TimingResolution } from "../action_timing/types.js";
import { experimentWhatSchema } from "../experiment/index.js";
import { translateExperimentAction } from "./experiment.js";
import { actionEligibilitySchema } from "../action_eligibility/schema.js";
import { hasValidEligibilityAssessmentFingerprint } from "../action_eligibility/integrity.js";
import { hasCompleteEligibilityCheckManifest } from "../action_eligibility/evaluate.js";

const timestamp = z.string().datetime({ offset: true });
export const canonicalTranslationContextSchema = z
  .object({
    timing: z.unknown().optional(),
    simulator: z.unknown().optional(),
    populations: z.array(populationDefinitionSchema).optional(),
    evaluations: z.array(populationEvaluationSchema).optional(),
    snapshots: z.array(populationSnapshotSchema).optional(),
    bindingTimes: z
      .object({
        DECISION_TIME: timestamp.optional(),
        EXECUTION_TIME: timestamp.optional(),
        SEND_TIME: timestamp.optional(),
        TRIGGER_TIME: timestamp.optional(),
        EFFECTIVE_TIME: timestamp.optional(),
      })
      .strict()
      .optional(),
    eligibility: z.unknown().optional(),
    eligibilityMaximumAgeSeconds: z.number().int().nonnegative().safe().optional(),
    experimentArmRegistry: z.unknown().optional(),
  })
  .strict();
/** Resolution and eligibility are independent of simulator capability. */
export function resolveCanonicalTranslationContext(
  input: unknown,
  contextInput: unknown,
):
  | TranslationFailure
  | {
      status: "RESOLVED";
      action: CanonicalAction;
      context: z.infer<typeof canonicalTranslationContextSchema>;
      resolution: TimingResolution;
    } {
  const parsed = canonicalActionSchema.safeParse(input);
  if (!parsed.success)
    return {
      status: "INVALID_ACTION",
      code: "INVALID_CANONICAL_ACTION",
      message: parsed.error.message,
    };
  const action = parsed.data;
  const fail = (
    status: TranslationFailure["status"],
    code: string,
    message: string,
  ): TranslationFailure => ({
    status,
    code,
    message,
    actionId: action.actionId,
  });
  const checked = canonicalTranslationContextSchema.safeParse(contextInput);
  if (!checked.success)
    return fail(
      "MISSING_CONTEXT",
      "INVALID_CANONICAL_CONTEXT",
      checked.error.message,
    );
  const context = checked.data;
  if (
    !context.timing ||
    typeof context.timing !== "object" ||
    !("approvedClock" in context.timing)
  )
    return fail(
      "MISSING_CONTEXT",
      "TIMING_CONTEXT_REQUIRED",
      "An approved clock and temporal evidence are required.",
    );
  const resolution = resolveActionTiming(action.timing, {
    ...(context.timing as ActionTimingResolutionContext),
    actionId: action.actionId,
  });
  if (resolution.status !== "VALID")
    return fail(
      resolution.status === "INVALID" ? "INVALID_ACTION" : "MISSING_CONTEXT",
      "TIMING_NOT_RESOLVED",
      [
        ...resolution.validationCodes,
        ...resolution.missingContext,
        ...resolution.unresolvedDependencies,
      ].join(", "),
    );
  if (action.population) {
    const ref = action.population;
    const definitions = context.populations?.filter(
      (p) => p.populationId === ref.populationId && p.version === ref.version,
    ) ?? [];
    if (definitions.length > 1)
      return fail(
        "MISSING_CONTEXT",
        "AMBIGUOUS_POPULATION_DEFINITION",
        "More than one population definition matches the referenced identity.",
      );
    const definition = definitions[0];
    if (
      !definition ||
      fingerprintPopulationDefinition(definition) !==
        ref.definitionFingerprint ||
      definition.binding !== ref.binding ||
      definition.membershipMode !== ref.membershipMode
    )
      return fail(
        "MISSING_CONTEXT",
        "POPULATION_DEFINITION_REQUIRED",
        "The exact referenced population definition and binding must be supplied.",
      );
    const matches = (entry: {
      populationId: string;
      version: number;
      definitionFingerprint: string;
      binding: string;
      membershipMode: string;
    }) =>
      entry.populationId === ref.populationId &&
      entry.version === ref.version &&
      entry.definitionFingerprint === ref.definitionFingerprint &&
      entry.binding === ref.binding &&
      entry.membershipMode === ref.membershipMode;
    const at = context.bindingTimes?.[ref.binding];
    if (!at)
      return fail(
        "MISSING_CONTEXT",
        "MEMBERSHIP_BINDING_TIME_REQUIRED",
        "An explicit timestamp for the population binding is required.",
      );
    if (ref.membershipMode === "FROZEN_MEMBERSHIP") {
      const snapshots = context.snapshots?.filter(
        (s) =>
          ref.snapshotRef !== undefined &&
          s.snapshotId === ref.snapshotRef &&
          matches(s) &&
          Date.parse(s.evaluatedAt) === Date.parse(at),
      ) ?? [];
      if (snapshots.length > 1)
        return fail(
          "MISSING_CONTEXT",
          "AMBIGUOUS_FROZEN_MEMBERSHIP",
          "More than one frozen population snapshot matches the exact reference.",
        );
      const snapshot = snapshots[0];
      if (!snapshot || snapshot.unknownCustomerIds.length)
        return fail(
          "MISSING_CONTEXT",
          "FROZEN_MEMBERSHIP_REQUIRED",
          "A matching frozen snapshot with resolved membership is required.",
        );
    } else {
      const evaluations = context.evaluations?.filter(
        (e) => matches(e) && Date.parse(e.evaluatedAt) === Date.parse(at),
      ) ?? [];
      if (evaluations.length > 1)
        return fail(
          "MISSING_CONTEXT",
          "AMBIGUOUS_DYNAMIC_MEMBERSHIP",
          "More than one dynamic population evaluation matches the exact reference and boundary.",
        );
      const evaluation = evaluations[0];
      if (!evaluation || evaluation.unknownCount)
        return fail(
          "MISSING_CONTEXT",
          "DYNAMIC_MEMBERSHIP_REQUIRED",
          "Membership must be evaluated at the specified boundary with unresolved evidence addressed.",
        );
    }
  }
  return { status: "RESOLVED" as const, action, context, resolution };
}

export function translateCanonicalAction(
  input: unknown,
  contextInput: unknown,
  origin?: TranslationOrigin,
): TranslationResult {
  const gate = resolveCanonicalTranslationContext(input, contextInput);
  if (gate.status !== "RESOLVED") return gate as TranslationFailure;
  const { action, context, resolution } = gate;
  const decision = decisionWhatSchema.safeParse(action.what);
  const experiment = experimentWhatSchema.safeParse(action.what);
  if (!experiment.success) {
    const parsedEligibility = actionEligibilitySchema.safeParse(context.eligibility);
    if (!parsedEligibility.success)
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_REQUIRED", message: "A valid eligibility result is required before canonical translation." };
    const eligibility = parsedEligibility.data;
    if (!hasValidEligibilityAssessmentFingerprint(eligibility))
      return { status: "INVALID_ACTION", actionId: action.actionId, code: "INVALID_ACTION_ELIGIBILITY_INTEGRITY", message: "Eligibility checks do not match their assessment fingerprint." };
    if (eligibility.actionId !== action.actionId || eligibility.actionFingerprint !== fingerprintCanonicalAction(action))
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_MISMATCH", message: "Eligibility must bind the exact canonical action." };
    if (eligibility.evaluationBoundary !== "TRANSLATION_TIME")
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_BOUNDARY", message: "Canonical translation requires TRANSLATION_TIME eligibility." };
    if (!hasCompleteEligibilityCheckManifest(action, "TRANSLATION_TIME", eligibility.checks))
      return { status: "INVALID_ACTION", actionId: action.actionId, code: "INCOMPLETE_ACTION_ELIGIBILITY", message: "Eligibility must contain the complete deterministic check manifest." };
    const approvedClock = context.timing && typeof context.timing === "object" && "approvedClock" in context.timing ? (context.timing as { approvedClock?: unknown }).approvedClock : undefined;
    if (typeof approvedClock !== "string" || context.eligibilityMaximumAgeSeconds === undefined)
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_FRESHNESS_REQUIRED", message: "An approved clock and maximum eligibility age are required." };
    const evaluated = Date.parse(eligibility.evaluatedAt), approved = Date.parse(approvedClock);
    if (evaluated > approved)
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_FUTURE", message: "Eligibility cannot be evaluated in the future." };
    if (approved - evaluated > context.eligibilityMaximumAgeSeconds * 1000)
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_STALE", message: "Eligibility is stale." };
    const derived = eligibility.checks.some((check) => check.status === "VIOLATED") ? "INELIGIBLE" : eligibility.checks.some((check) => check.status === "UNKNOWN") ? "UNKNOWN" : "ELIGIBLE";
    if (derived !== eligibility.status)
      return { status: "INVALID_ACTION", actionId: action.actionId, code: "INVALID_ACTION_ELIGIBILITY", message: "Eligibility status does not match its checks." };
    if (eligibility.status === "INELIGIBLE")
      return { status: "INELIGIBLE_ACTION", actionId: action.actionId, code: "ACTION_INELIGIBLE", message: "The action violates one or more eligibility checks." };
    if (eligibility.status === "UNKNOWN")
      return { status: "MISSING_CONTEXT", actionId: action.actionId, code: "ACTION_ELIGIBILITY_UNKNOWN", message: "Action eligibility remains unresolved." };
  }
  const common = {
    status: "TRANSLATED" as const,
    originatingBusinessActionId:
      origin?.originatingBusinessActionId ?? action.actionId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    interventions: [],
  };
  if (decision.success) {
    if (decision.data.actionType === "investigation.inspect") {
      const horizon = validateInvestigationExecutionHorizon(
        decision.data,
        action.timing,
        context.timing as ActionTimingResolutionContext,
      );
      if (horizon.status !== "VALID")
        return {
          status:
            horizon.status === "INVALID" ? "INVALID_ACTION" : "MISSING_CONTEXT",
          actionId: action.actionId,
          code: horizon.code,
          message:
            "Investigation execution must resolve within its maximum horizon.",
        };
    }
    switch (decision.data.actionType) {
      case "no_op.do_nothing":
        return { ...common, decisionType: "NO_OP" };
      case "no_op.wait_observe":
        return {
          ...common,
          decisionType: "WAIT_OBSERVE",
          observationRequests: [
            {
              actionId: action.actionId,
              actionFingerprint: fingerprintCanonicalAction(action),
              specification: decision.data,
              timing: action.timing,
              ...(action.population ? { population: action.population } : {}),
            },
          ],
        };
      case "investigation.inspect":
        return {
          ...common,
          decisionType: "INVESTIGATE",
          informationTasks: [
            {
              actionId: action.actionId,
              actionFingerprint: fingerprintCanonicalAction(action),
              specification: decision.data,
              timing: action.timing,
              ...(action.population ? { population: action.population } : {}),
            },
          ],
        };
    }
  }
  if (experiment.success)
    return translateExperimentAction(action, experiment.data, context, origin);
  if ("kind" in action.what && action.what.kind === "legacy_business")
    return translateResolvedLegacyBusiness(
      action,
      resolution,
      context.simulator,
      origin,
    );
  return {
    actionId: action.actionId,
    status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
    code: "CANONICAL_SEMANTICS_UNSUPPORTED",
    message:
      "The simulator has no adapter preserving this Action’s lifecycle, population and universal timing semantics.",
  };
}
