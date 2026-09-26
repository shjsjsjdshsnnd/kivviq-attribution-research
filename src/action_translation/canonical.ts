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

const timestamp = z.string().datetime({ offset: true });
const contextSchema = z
  .object({
    timing: z.unknown().optional(),
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
  })
  .strict();
/** No simulator supports these complete semantics yet. Resolve evidence before
 * reporting unsupported capability, and never invent effects or broadcasts. */
export function translateCanonicalAction(
  input: unknown,
  contextInput: unknown,
): TranslationFailure {
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
  const checked = contextSchema.safeParse(contextInput);
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
    const definition = context.populations?.find(
      (p) => p.populationId === ref.populationId && p.version === ref.version,
    );
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
      const snapshot = context.snapshots?.find(
        (s) =>
          ref.snapshotRef !== undefined &&
          s.snapshotId === ref.snapshotRef &&
          matches(s) &&
          Date.parse(s.evaluatedAt) === Date.parse(at),
      );
      if (!snapshot || snapshot.unknownCustomerIds.length)
        return fail(
          "MISSING_CONTEXT",
          "FROZEN_MEMBERSHIP_REQUIRED",
          "A matching frozen snapshot with resolved membership is required.",
        );
    } else {
      const evaluation = context.evaluations?.find(
        (e) => matches(e) && Date.parse(e.evaluatedAt) === Date.parse(at),
      );
      if (!evaluation || evaluation.unknownCount)
        return fail(
          "MISSING_CONTEXT",
          "DYNAMIC_MEMBERSHIP_REQUIRED",
          "Membership must be evaluated at the specified boundary with unresolved evidence addressed.",
        );
    }
  }
  return fail(
    "UNSUPPORTED_SIMULATOR_CAPABILITY",
    "CANONICAL_SEMANTICS_UNSUPPORTED",
    "The simulator has no adapter preserving this Action’s lifecycle, population and universal timing semantics.",
  );
}
