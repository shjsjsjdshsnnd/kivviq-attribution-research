import type { Action } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sorted<T>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) =>
    stableJson(left).localeCompare(stableJson(right)),
  );
}

/**
 * Fields here are the authoritative business semantics used for deduplication.
 *
 * Excluded on purpose:
 * - actionId
 * - description
 * - intent
 * - provenance, including creation timestamp
 * - risk and uncertainty descriptions
 * - measurement plan
 *
 * Those fields explain, source or evaluate an intervention but do not change
 * the business manipulation itself.
 */
export function actionSemanticProjection(action: Action): unknown {
  return {
    schemaVersion: action.schemaVersion,
    actionType: action.actionType,
    actionCategory: action.actionCategory,
    target: action.target,
    scope: {
      dimensions: sorted(action.scope.dimensions),
    },
    parameters: action.parameters,
    timing: action.timing,
    duration: action.duration,
    termination: action.termination,
    cost: action.cost,
    resourceRequirements: sorted(action.resourceRequirements),
    constraints: sorted(action.constraints),
    preconditions: sorted(action.preconditions),
    reversibility: action.reversibility,
    reversalOfActionId: action.reversalOfActionId ?? null,
  };
}

export function actionSemanticKey(action: Action): string {
  return stableJson(actionSemanticProjection(action));
}

export function actionsSemanticallyEqual(
  left: Action,
  right: Action,
): boolean {
  return actionSemanticKey(left) === actionSemanticKey(right);
}

/**
 * Deterministic FNV-1a 64-bit fingerprint over canonical semantic JSON.
 * This is a reproducibility/deduplication hash, not a security primitive.
 */
export function actionFingerprint(action: Action): string {
  const input = actionSemanticKey(action);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}

export function canonicalizeForSerialization(value: unknown): unknown {
  return canonicalize(value);
}
