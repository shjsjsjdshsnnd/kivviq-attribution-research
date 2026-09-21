import type {
  SimulatorIntervention,
  SimulatorInterventionDraft,
} from "./types.js";

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

export function canonicalInterventionJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }

  return hash.toString(16).padStart(16, "0");
}

export function interventionFingerprint(
  intervention: SimulatorIntervention | SimulatorInterventionDraft,
): string {
  const semantic =
    "interventionId" in intervention
      ? Object.fromEntries(
          Object.entries(intervention).filter(([key]) => key !== "interventionId"),
        )
      : intervention;

  return "fnv1a64:" + fnv1a64(canonicalInterventionJson(semantic));
}

export function deterministicInterventionId(
  intervention: SimulatorInterventionDraft,
): string {
  return "intervention_" + interventionFingerprint(intervention).split(":")[1];
}
