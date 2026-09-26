import { assertValidActionTiming } from "./validation.js";
import type { ActionTiming, TerminationCondition } from "./types.js";

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sorted<T>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) =>
    stableJson(left).localeCompare(stableJson(right)),
  );
}

function canonicalTermination(
  condition: TerminationCondition,
): TerminationCondition {
  if (condition.kind === "STATE") return condition;
  return {
    ...condition,
    conditions: sorted(condition.conditions.map(canonicalTermination)),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (entry === undefined) continue;
    let next = entry;

    if (key === "daysOfWeek" && Array.isArray(entry)) {
      next = [...entry].sort((a, b) => Number(a) - Number(b));
    } else if (
      key === "conditions" &&
      Array.isArray(entry) &&
      record["kind"] === "COMPOSITE"
    ) {
      next = sorted(
        (entry as readonly TerminationCondition[]).map(canonicalTermination),
      );
    } else if (key === "dependencies" && Array.isArray(entry)) {
      next = sorted(entry);
    }

    normalized[key] = canonicalize(next);
  }

  return Object.fromEntries(
    Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function canonicalizeTiming(timing: ActionTiming): unknown {
  assertValidActionTiming(timing);
  return canonicalize(timing);
}

export function serializeActionTiming(timing: ActionTiming): string {
  assertValidActionTiming(timing);
  return stableJson(timing);
}

export function actionTimingFingerprint(timing: ActionTiming): string {
  const input = serializeActionTiming(timing);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}

export function timingsSemanticallyEqual(
  left: ActionTiming,
  right: ActionTiming,
): boolean {
  return serializeActionTiming(left) === serializeActionTiming(right);
}
