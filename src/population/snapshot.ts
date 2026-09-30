import { z } from "zod";
import {
  id,
  populationDefinitionSchema,
  populationEvaluationSchema,
  populationSnapshotSchema,
} from "./schema.js";
import type { PopulationSnapshot } from "./schema.js";
import { hash } from "./identity.js";
import { fingerprintPopulationDefinition } from "./fingerprint.js";
export function createPopulationSnapshot(
  definition: unknown,
  evaluation: unknown,
  options: { snapshotId: string },
): Readonly<PopulationSnapshot> {
  const d = populationDefinitionSchema.parse(definition),
    e = populationEvaluationSchema.parse(evaluation);
  z.object({ snapshotId: id("snapshot") })
    .strict()
    .parse(options);
  if (
    e.definitionFingerprint !== fingerprintPopulationDefinition(d) ||
    e.populationId !== d.populationId ||
    e.version !== d.version ||
    e.binding !== d.binding ||
    e.membershipMode !== d.membershipMode
  )
    throw new Error("Evaluation does not match definition");
  const body = {
    schemaVersion: 1 as const,
    snapshotId: options.snapshotId,
    populationId: d.populationId,
    version: d.version,
    definitionFingerprint: e.definitionFingerprint,
    binding: d.binding,
    membershipMode: d.membershipMode,
    evaluatedAt: e.evaluatedAt,
    customerIds: e.members
      .filter((x) => x.status === "ELIGIBLE")
      .map((x) => x.customerId)
      .sort(),
    unknownCustomerIds: e.members
      .filter((x) => x.status === "UNKNOWN")
      .map((x) => x.customerId)
      .sort(),
    provenance: d.provenance,
  };
  const snapshot = populationSnapshotSchema.parse({
    ...body,
    snapshotFingerprint: hash(body),
  });
  Object.freeze(snapshot.customerIds);
  Object.freeze(snapshot.unknownCustomerIds);
  Object.freeze(snapshot.provenance);
  return Object.freeze(snapshot);
}
