import type { Action } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function semanticProjection(action: Action): unknown {
  return {
    ontologyMajor: Number(action.ontologyVersion.split(".")[0]),
    actionType: action.actionType,
    actionCategory: action.actionCategory,
    atomicity: action.atomicity,
    target: action.target,
    parameters: action.parameters,
    timing: action.timing,
    duration: action.duration,
    constraints: action.constraints,
    reversibilityClassification: action.reversibility.classification,
    reversalOfActionId: action.reversalOfActionId ?? null,
    sharedIntentId: action.sharedIntentId ?? null,
    components: action.components?.map(semanticProjection) ?? null,
  };
}

/**
 * Deterministic semantic identity for an intervention. This intentionally
 * excludes actionId, prose, lifecycle state, risk estimates, costs and
 * measurement plans so re-estimation does not create a new intervention.
 */
export function actionSemanticKey(action: Action): string {
  return JSON.stringify(canonicalize(semanticProjection(action)));
}
