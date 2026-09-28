import { createHash } from "node:crypto";
import { z } from "zod";
import { WORLD_SIMULATOR_VERSION } from "../simulation/kernel.js";
import type { SimulateWorldRequest } from "../simulation/types.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import { validateLatentCustomerPopulation } from "../customer_population/validation.js";
import { MEASUREMENT_VERSION, corruptionConfigSchema, perfectWorldSchema } from "../measurement_corruption/index.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { runMeasuredWorld, type EvaluatorWorldBundle, type MeasurementRunOptions } from "./measured-world.js";

export const REPLAY_MANIFEST_VERSION = "evaluator-replay-manifest/1.0.0" as const;

/** Canonical JSON rejects non-JSON values instead of silently hashing lossy serialization. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  function encode(item: unknown): string {
    if (item === null) return "null";
    if (typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new RangeError("non-finite value in reproducibility manifest");
      return JSON.stringify(item);
    }
    if (typeof item !== "object") throw new TypeError("manifest must contain only JSON values");
    if (active.has(item)) throw new TypeError("cyclic manifest");
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("manifest cannot serialize Date, Map, Set or class instances");
    }
    active.add(item);
    let result: string;
    if (Array.isArray(item)) result = `[${Array.from(item, encode).join(",")}]`;
    else {
      const object = item as Record<string, unknown>;
      result = `{${Object.keys(object).sort().filter(k => object[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${encode(object[k])}`).join(",")}}`;
    }
    active.delete(item);
    return result;
  }
  return encode(value);
}
export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);
const optionsSchema = z.object({
  corruption: corruptionConfigSchema,
  asOf: observationTimeSchema,
  platformSpend: perfectWorldSchema.shape.spend,
  scope: z.literal("explicit_simulated_agents"),
}).strict();
const manifestSchema = z.object({
  payload: z.object({
    schemaVersion: z.literal(REPLAY_MANIFEST_VERSION),
    simulatorVersion: z.literal(WORLD_SIMULATOR_VERSION),
    measurementVersion: z.literal(MEASUREMENT_VERSION),
    scenarioId: z.string().min(1),
    scenarioVersion: z.string().min(1),
    codeRevision: revision,
    runtime: z.object({ node: z.string(), platform: z.string(), architecture: z.string() }).strict(),
    request: z.unknown(),
    options: optionsSchema,
    groundTruth: z.unknown(),
    outputHashes: z.object({ simulation: hash, perfect: hash, corrupted: hash }).strict(),
  }).strict(),
  sha256: hash,
}).strict();
export type ReplayManifest = z.infer<typeof manifestSchema>;

function validatedRequest(value: unknown): SimulateWorldRequest {
  // Assert JSON safety before the established simulator validators consume the data.
  canonicalJson(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid replay request");
  const request = value as SimulateWorldRequest;
  observationTimeSchema.parse(request.startTime);
  observationTimeSchema.parse(request.endTime);
  if (Date.parse(request.endTime) <= Date.parse(request.startTime)) throw new RangeError("invalid replay horizon");
  if (!Number.isSafeInteger(request.simulationSeed) || request.simulationSeed < 0) throw new RangeError("invalid simulation seed");
  if (!request.merchantWorld || !request.latentPopulation) throw new TypeError("replay requires complete frozen inputs");
  validateGroundTruthManifest(request.merchantWorld.manifest);
  validateLatentCustomerPopulation(request.latentPopulation, request.merchantWorld);
  return structuredClone(request);
}
function hashes(bundle: EvaluatorWorldBundle): ReplayManifest["payload"]["outputHashes"] {
  return { simulation: sha256(bundle.latentTruth.simulation), perfect: sha256(bundle.perfectObservableTruth), corrupted: sha256(bundle.corruptedObservation) };
}

/** Manifests include hidden seeds, causal truth and identity parameters. Never send to an Operator. */
export function createMeasuredManifest(input: {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly codeRevision: string;
  readonly request: SimulateWorldRequest;
  readonly options: MeasurementRunOptions;
}): { readonly manifest: ReplayManifest; readonly bundle: EvaluatorWorldBundle } {
  revision.parse(input.codeRevision);
  const request = validatedRequest(input.request);
  const options = optionsSchema.parse(input.options);
  const bundle = runMeasuredWorld(request, options);
  const payload: ReplayManifest["payload"] = {
    schemaVersion: REPLAY_MANIFEST_VERSION, simulatorVersion: WORLD_SIMULATOR_VERSION,
    measurementVersion: MEASUREMENT_VERSION,
    scenarioId: input.scenarioId, scenarioVersion: input.scenarioVersion,
    codeRevision: input.codeRevision,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    request, options, groundTruth: bundle.latentTruth.simulation.godMode,
    outputHashes: hashes(bundle),
  };
  const manifest = manifestSchema.parse({ payload, sha256: sha256(payload) });
  return { manifest, bundle };
}

/** Integrity check, not a cryptographic signature proving who authored the manifest. */
export function verifyManifest(value: unknown, runningCodeRevision: string): ReplayManifest {
  const manifest = manifestSchema.parse(value);
  if (manifest.sha256 !== sha256(manifest.payload)) throw new RangeError("manifest integrity mismatch");
  if (manifest.payload.codeRevision !== revision.parse(runningCodeRevision)) throw new RangeError("wrong code revision for replay");
  return manifest;
}

export function replayMeasuredManifest(value: unknown, runningCodeRevision: string): EvaluatorWorldBundle {
  const manifest = verifyManifest(value, runningCodeRevision);
  const bundle = runMeasuredWorld(validatedRequest(manifest.payload.request), manifest.payload.options);
  if (canonicalJson(hashes(bundle)) !== canonicalJson(manifest.payload.outputHashes) ||
      sha256(bundle.latentTruth.simulation.godMode) !== sha256(manifest.payload.groundTruth)) {
    throw new RangeError("replayed world does not match sealed truth/perfect/observed outputs");
  }
  return bundle;
}
