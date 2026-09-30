import {
  canonicalizeForSerialization,
  actionSemanticProjection,
} from "../action_ontology/semantics.js";
import { deserializeAction } from "../action_ontology/serialization.js";
import { canonicalizeTiming } from "../action_timing/canonical.js";
import { canonicalActionSchema, type CanonicalAction } from "./schema.js";
import type { Action } from "../action_ontology/types.js";
import { experimentWhatSchema } from "../experiment/index.js";
import { canonicalizeActionOutcomePlan } from "../action_outcomes/schema.js";

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
  const {
    schemaVersion, what, population, timing, constraints,
    dependencies, conflicts, characteristics, riskDimensions, outcomePlan,
  } =
    canonicalActionSchema.parse(input);
  const experiment = experimentWhatSchema.safeParse(what);
  const semanticWhat =
    "kind" in what && what.kind === "legacy_business"
      ? legacyProjection(what)
      : experiment.success
        ? {
            ...experiment.data,
            arms: [...experiment.data.arms].sort((left, right) =>
              left.armId.localeCompare(right.armId),
            ),
          }
        : what;
  const serialized = JSON.stringify(
    canonicalizeForSerialization({
      schemaVersion,
      what: semanticWhat,
      population,
      timing: canonicalizeTiming(timing),
      ...(constraints.length > 0
        ? {
            constraints: [...constraints].sort((left, right) =>
              left.constraintId.localeCompare(right.constraintId),
            ),
          }
        : {}),
      ...(dependencies.length > 0
        ? { dependencies: [...dependencies].sort((left, right) => left.dependencyId.localeCompare(right.dependencyId)) }
        : {}),
      ...(conflicts.length > 0
        ? { conflicts: [...conflicts].sort((left, right) => left.conflictId.localeCompare(right.conflictId)).map(canonicalConflict) }
        : {}),
      ...(characteristics.state === "PRESENT"
        ? { characteristics: { state: "PRESENT", value: canonicalCharacteristics(characteristics.value) } }
        : {}),
      ...(!("state" in riskDimensions)
        ? { riskDimensions: canonicalRiskDimensions(riskDimensions) }
        : {}),
      ...(outcomePlan === undefined
        ? {}
        : { outcomePlan: canonicalizeActionOutcomePlan(outcomePlan) }),
    }),
  );
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < serialized.length; i++)
    hash =
      ((hash ^ BigInt(serialized.charCodeAt(i))) * 0x100000001b3n) &
      0xffffffffffffffffn;
  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}
function stable(value: unknown): string {
  return JSON.stringify(canonicalizeForSerialization(value));
}
function byStable(left: unknown, right: unknown): number {
  return stable(left).localeCompare(stable(right));
}
function canonicalConflict<T extends { scope: { coordinates: readonly unknown[] } }>(value: T): T {
  return { ...value, scope: { ...value.scope, coordinates: [...value.scope.coordinates].sort(byStable) } };
}
function sortCosts<T extends { lineItemId: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.lineItemId.localeCompare(right.lineItemId));
}
function sortBurdens<T extends { burdenId: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.burdenId.localeCompare(right.burdenId));
}
function canonicalCharacteristics<T extends {
  implementationCost: readonly { lineItemId: string }[];
  reversibility: { kind: string; irreversibleEffects?: readonly unknown[] };
  cancellationCosts: readonly { stage: string; cancellationCost: readonly { lineItemId: string }[]; compensationCost: readonly { lineItemId: string }[]; operationalBurden: readonly { burdenId: string }[] }[];
  operationalBurden: readonly { burdenId: string }[];
}>(value: T): unknown {
  return {
    ...value,
    implementationCost: sortCosts(value.implementationCost),
    reversibility: value.reversibility.irreversibleEffects
      ? { ...value.reversibility, irreversibleEffects: [...value.reversibility.irreversibleEffects].sort(byStable) }
      : value.reversibility,
    cancellationCosts: [...value.cancellationCosts]
      .sort((left, right) => left.stage.localeCompare(right.stage))
      .map((stage) => ({ ...stage, cancellationCost: sortCosts(stage.cancellationCost), compensationCost: sortCosts(stage.compensationCost), operationalBurden: sortBurdens(stage.operationalBurden) })),
    operationalBurden: sortBurdens(value.operationalBurden),
  };
}
function canonicalRiskDimensions<T extends Record<string, readonly { measurementId: string; irreversibleEffectKinds?: readonly string[] }[]>>(value: T): unknown {
  return Object.fromEntries(Object.entries(value).map(([dimension, measurements]) => [
    dimension,
    [...measurements]
      .sort((left, right) => left.measurementId.localeCompare(right.measurementId))
      .map((measurement) => measurement.irreversibleEffectKinds
        ? { ...measurement, irreversibleEffectKinds: [...measurement.irreversibleEffectKinds].sort() }
        : measurement),
  ]));
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
