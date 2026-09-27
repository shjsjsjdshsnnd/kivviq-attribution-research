import { z } from "zod";
import {
  compoundActionSchema,
  compoundDependencyGraph,
} from "../compound_action/schema.js";
import {
  assessCompoundActionReadiness,
  compoundReadinessContextSchema,
  type CompoundActionReadiness,
  type CompoundReadinessContext,
  type ComponentReadinessStatus,
} from "../compound_action/readiness.js";

import type { ActionTimingResolutionContext } from "../action_timing/types.js";
import {
  translateCanonicalAction,
  canonicalTranslationContextSchema,
} from "./canonical.js";
import {
  ACTION_TRANSLATION_VERSION,
  type TranslationFailure,
  type TranslationResult,
  type TranslatedResult,
} from "./types.js";

export const compoundTranslationContextSchema = z
  .object({
    timing: compoundReadinessContextSchema.shape.timing,
    components: z.record(z.unknown()),
    readiness: compoundReadinessContextSchema
      .omit({ timing: true })
      .extend({
        eligibilityResults: z.record(z.unknown()),
        eligibilityMaximumAgeSeconds: z.number().int().nonnegative().safe(),
      }),
  })
  .strict();
export interface CompoundTranslationMetadata {
  compoundActionId: string;
  partial: boolean;
  readiness: CompoundActionReadiness;
  components: {
    componentId: string;
    actionId: string;
    readiness: CompoundActionReadiness["components"][number];
    result: TranslationResult;
  }[];
  emittedComponentIds: string[];
}
export type CanonicalCompoundTranslationResult = TranslationResult & {
  compound?: CompoundTranslationMetadata;
};
const fail = (
  status: TranslationFailure["status"],
  code: string,
  message: string,
  actionId?: string,
): TranslationFailure => ({
  status,
  code,
  message,
  ...(actionId ? { actionId } : {}),
});
function failureReadiness(result: TranslationResult): ComponentReadinessStatus {
  if (result.status === "TRANSLATED") return "READY";
  if (
    result.status === "MISSING_CONTEXT" ||
    result.status === "AMBIGUOUS_TRANSLATION"
  )
    return "MISSING_CONTEXT";
  if (result.status === "INVALID_ACTION" || result.status === "INELIGIBLE_ACTION") return "INELIGIBLE";
  return "UNSUPPORTED_SIMULATOR_CAPABILITY";
}

/** Translation produces a reviewable plan, never executes components or rolls them back. */
export function translateCanonicalCompoundAction(
  input: unknown,
  contextInput: unknown,
): CanonicalCompoundTranslationResult {
  const parsed = compoundActionSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      "INVALID_ACTION",
      "INVALID_COMPOUND_ACTION",
      parsed.error.message,
    );
  const action = parsed.data,
    checked = compoundTranslationContextSchema.safeParse(contextInput);
  if (!checked.success)
    return fail(
      "MISSING_CONTEXT",
      "INVALID_COMPOUND_CONTEXT",
      checked.error.message,
      action.compoundActionId,
    );
  const context = checked.data;
  let readiness: CompoundActionReadiness;
  const timing = context.timing as unknown as ActionTimingResolutionContext;
  try {
    readiness = assessCompoundActionReadiness(action, {
      ...context.readiness,
      timing,
      eligibilityBoundary: "TRANSLATION_TIME",
    } as CompoundReadinessContext);
  } catch {
    return fail(
      "MISSING_CONTEXT",
      "INVALID_COMPOUND_CONTEXT",
      "Compound timing or readiness evidence is malformed.",
      action.compoundActionId,
    );
  }
  const actionTimes = { ...timing.actionTimes };
  for (const component of action.components) {
    const resolved = readiness.timing.components[component.componentId];
    if (resolved?.status === "VALID")
      actionTimes[component.action.actionId] = {
        ...actionTimes[component.action.actionId],
        ...(resolved.resolvedRequestedStart
          ? { requestedStart: resolved.resolvedRequestedStart }
          : {}),
        ...(resolved.resolvedEffectiveStart
          ? { effectiveStart: resolved.resolvedEffectiveStart }
          : {}),
        ...(resolved.resolvedEnd ? { end: resolved.resolvedEnd } : {}),
      };
  }
  const components = action.components.map((component, index) => {
    const initial = readiness.components[index]!;
    let result: TranslationResult;
    if (initial.status !== "READY")
      result = fail(
        initial.status === "UNSUPPORTED_SIMULATOR_CAPABILITY"
          ? initial.status
          : initial.status === "INELIGIBLE"
            ? "INELIGIBLE_ACTION"
            : "MISSING_CONTEXT",
        "COMPONENT_NOT_READY",
        initial.codes.join(", ") || initial.status,
        component.action.actionId,
      );
    else {
      const componentContext = context.components[component.componentId];
      if (
        !componentContext ||
        typeof componentContext !== "object" ||
        Array.isArray(componentContext)
      )
        result = fail(
          "MISSING_CONTEXT",
          "COMPONENT_CONTEXT_REQUIRED",
          "Every component requires its own translation context.",
          component.action.actionId,
        );
      else
        try {
          const checkedComponent =
            canonicalTranslationContextSchema.safeParse(componentContext);
          if (!checkedComponent.success)
            throw new Error("Invalid component context");
          const componentTiming = checkedComponent.data.timing;
          if (
            componentTiming !== undefined &&
            (!componentTiming ||
              typeof componentTiming !== "object" ||
              Array.isArray(componentTiming))
          )
            throw new Error("Invalid component timing");
          result = translateCanonicalAction(
            component.action,
            {
              ...checkedComponent.data,
              eligibility:
                context.readiness.eligibilityResults[component.componentId],
              eligibilityMaximumAgeSeconds:
                context.readiness.eligibilityMaximumAgeSeconds,
              timing: {
                ...(componentTiming as object),
                ...timing,
                actionTimes,
              },
            },
            {
              originatingBusinessActionId: action.compoundActionId,
              sourceActionId: component.action.actionId,
              componentIndex: index,
              componentCount: action.components.length,
            },
          );
        } catch {
          result = fail(
            "MISSING_CONTEXT",
            "INVALID_COMPONENT_CONTEXT",
            "Component translation context is malformed.",
            component.action.actionId,
          );
        }
    }
    if (initial.status === "READY" && result.status !== "TRANSLATED") {
      initial.status = failureReadiness(result);
      initial.codes.push(
        result.status === "EXPERIMENT_REQUIRES_ENGINE"
          ? "EXPERIMENT_REQUIRES_ENGINE"
          : result.code,
      );
    }
    return {
      componentId: component.componentId,
      actionId: component.action.actionId,
      readiness: initial,
      result,
    };
  });
  // Include explicit, canonical timing, and implicit ORDERED edges. A supported
  // translation must not escape a failed prerequisite through a different syntax.
  const graph = compoundDependencyGraph(action);
  for (let pass = 0; pass < components.length; pass++) {
    for (const node of graph) {
      const destination = components.find((c) => c.actionId === node.actionId)!;
      for (const dependency of node.dependencies) {
        const source = components.find(
          (c) => c.actionId === dependency.actionId,
        );
        if (
          source &&
          source.readiness.status !== "READY" &&
          destination.readiness.status === "READY"
        ) {
          destination.readiness.status = "MISSING_CONTEXT";
          destination.readiness.codes.push("DEPENDENCY_NOT_READY");
        }
      }
    }
    // Budget neutrality couples the emitted subset, not merely the full intent.
    // Revisit dependencies after group gating so downstream work is also held.
    for (const constraint of action.constraints) {
      if (constraint.kind !== "BUDGET_NEUTRAL") continue;
      const group = components.filter((component) =>
        constraint.componentIds.includes(component.componentId),
      );
      if (group.some((component) => component.readiness.status !== "READY")) {
        for (const component of group) {
          if (component.readiness.status === "READY") {
            component.readiness.status = "MISSING_CONTEXT";
            component.readiness.codes.push("BUDGET_NEUTRAL_GROUP_NOT_READY");
          }
        }
      }
    }
  }
  const ready = components.filter(
    (c) => c.readiness.status === "READY" && c.result.status === "TRANSLATED",
  );
  const blocked = components.some(
    (c) =>
      c.readiness.status === "INELIGIBLE" ||
      c.readiness.status === "UNSUPPORTED_SIMULATOR_CAPABILITY",
  );
  readiness.status =
    ready.length === components.length
      ? "READY"
      : action.atomicity === "ALL_OR_NOTHING"
        ? blocked
          ? "BLOCKED"
          : "UNKNOWN"
        : ready.length
          ? "PARTIALLY_READY"
          : blocked
            ? "BLOCKED"
            : "UNKNOWN";
  const emitted =
    action.atomicity === "ALL_OR_NOTHING" && ready.length !== components.length
      ? []
      : ready;
  const compound: CompoundTranslationMetadata = {
    compoundActionId: action.compoundActionId,
    partial: emitted.length > 0 && emitted.length !== components.length,
    readiness,
    components,
    emittedComponentIds: emitted.map((c) => c.componentId),
  };
  if (!emitted.length) {
    const problem = components.find((c) => c.result.status !== "TRANSLATED");
    const result = problem?.result;
    return {
      ...(result &&
      result.status !== "TRANSLATED" &&
      result.status !== "EXPERIMENT_REQUIRES_ENGINE"
        ? result
        : fail(
            "MISSING_CONTEXT",
            "COMPOUND_NOT_READY",
            "No components can be translated under the compound policy.",
            action.compoundActionId,
          )),
      actionId: action.compoundActionId,
      compound,
    };
  }
  const interventions: TranslatedResult["interventions"][number][] = [],
    informationTasks: NonNullable<
      TranslatedResult["informationTasks"]
    >[number][] = [],
    observationRequests: NonNullable<
      TranslatedResult["observationRequests"]
    >[number][] = [],
    experimentTasks: NonNullable<TranslatedResult["experimentTasks"]>[number][] = [];
  for (const component of emitted) {
    if (component.result.status !== "TRANSLATED") continue;
    interventions.push(...component.result.interventions);
    informationTasks.push(
      ...(component.result.informationTasks ?? []).map((task) => ({
        ...task,
        compoundActionId: action.compoundActionId,
        componentId: component.componentId,
      })),
    );
    observationRequests.push(
      ...(component.result.observationRequests ?? []).map((request) => ({
        ...request,
        compoundActionId: action.compoundActionId,
        componentId: component.componentId,
      })),
    );
    experimentTasks.push(
      ...(component.result.experimentTasks ?? []).map((task) => ({
        ...task,
        compoundActionId: action.compoundActionId,
        componentId: component.componentId,
      })),
    );
  }
  return {
    status: "TRANSLATED",
    originatingBusinessActionId: action.compoundActionId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    interventions,
    compound,
    ...(informationTasks.length ? { informationTasks } : {}),
    ...(observationRequests.length ? { observationRequests } : {}),
    ...(experimentTasks.length ? { experimentTasks } : {}),
  };
}
