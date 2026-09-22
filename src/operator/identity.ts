import type { OperatorJson } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function stableOperatorJson(value: OperatorJson | unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) {
    throw new TypeError("operator value must be JSON serializable");
  }
  return serialized;
}

/**
 * Deterministic FNV-1a 64-bit fingerprint over a canonical semantic manifest.
 * This is a reproducibility fingerprint, not a security primitive.
 */
export function operatorFingerprint(value: OperatorJson | unknown): string {
  const input = stableOperatorJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}

export function deepFreezeOperator<T>(value: T): T {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeOperator(child);
  }
  return value;
}
