import {
  canonicalizeForSerialization,
  actionSemanticProjection,
} from "../action_ontology/semantics.js";
import { deserializeAction } from "../action_ontology/serialization.js";
import { canonicalizeTiming } from "../action_timing/canonical.js";
import { canonicalActionSchema, type CanonicalAction } from "./schema.js";
import type { Action } from "../action_ontology/types.js";

export function serializeCanonicalAction(input: CanonicalAction): string {
  return JSON.stringify(
    canonicalizeForSerialization(canonicalActionSchema.parse(input)),
  );
}
export function readCanonicalAction(
  serialized: string,
): CanonicalAction | Action {
  const value: unknown = JSON.parse(serialized);
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion === "2.0.0"
  )
    return canonicalActionSchema.parse(value);
  return deserializeAction(serialized);
}
export function fingerprintCanonicalAction(input: CanonicalAction): string {
  const { schemaVersion, what, population, timing } =
    canonicalActionSchema.parse(input);
  const semanticWhat =
    "kind" in what && what.kind === "legacy_business"
      ? legacyProjection(what)
      : what;
  const serialized = JSON.stringify(
    canonicalizeForSerialization({
      schemaVersion,
      what: semanticWhat,
      population,
      timing: canonicalizeTiming(timing),
    }),
  );
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < serialized.length; i++)
    hash =
      ((hash ^ BigInt(serialized.charCodeAt(i))) * 0x100000001b3n) &
      0xffffffffffffffffn;
  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}
function legacyProjection(what: unknown): unknown {
  // The existing projection remains authoritative for inherited business semantics.
  const value = what as Action;
  const projected = actionSemanticProjection(value) as Record<string, unknown>;
  delete projected["timing"];
  delete projected["duration"];
  delete projected["termination"];
  return projected;
}
