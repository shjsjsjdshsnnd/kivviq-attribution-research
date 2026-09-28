export const BASELINE_VALIDATION_CANONICAL_JSON_VERSION = "1.0.0" as const;

export class BaselineValidationCanonicalJsonError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BaselineValidationCanonicalJsonError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalizeValidationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeValidationValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => [key, canonicalizeValidationValue(entry)]),
  );
}

export function stableValidationJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(canonicalizeValidationValue(value));
    if (serialized === undefined) throw new TypeError("value is not JSON serializable");
    return serialized;
  } catch (error) {
    throw new BaselineValidationCanonicalJsonError(
      "validation values must be deterministic JSON: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

export function validationFingerprint(value: unknown): string {
  const input = stableValidationJson(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}
