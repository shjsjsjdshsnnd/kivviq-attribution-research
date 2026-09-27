import { z } from "zod";
import type { CanonicalAction } from "../canonical_action/schema.js";
import { canonicalActionSchema } from "../canonical_action/schema.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import type { CompoundAction } from "../compound_action/schema.js";
import { compoundActionSchema, fingerprintCompoundAction } from "../compound_action/schema.js";
import { resolveActionTiming } from "../action_timing/resolution.js";
import type { ActionTimingResolutionContext } from "../action_timing/types.js";
import {
  fingerprintPopulationDefinition,
  populationDefinitionSchema,
  populationEvaluationSchema,
  populationSnapshotSchema,
} from "../population/index.js";
import { experimentWhatSchema, type ExperimentArm } from "./schema.js";

const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{1,159}$/);
const evidenceRefs = z.array(ref).min(1);
const timestamp = z.string().datetime({ offset: true }).refine((value) => value.endsWith("Z"));
const populationEvidence = {
  populations: z.array(populationDefinitionSchema),
  evaluations: z.array(populationEvaluationSchema),
  snapshots: z.array(populationSnapshotSchema).optional(),
  bindingTimes: z
    .object({
      DECISION_TIME: timestamp.optional(),
      EXECUTION_TIME: timestamp.optional(),
      SEND_TIME: timestamp.optional(),
      TRIGGER_TIME: timestamp.optional(),
      EFFECTIVE_TIME: timestamp.optional(),
    })
    .strict(),
};

const registryEntrySchema = z.union([
  z.object({ entityKind: z.literal("ACTION"), action: z.custom<CanonicalAction>((value) => canonicalActionSchema.safeParse(value).success) }).strict(),
  z.object({ entityKind: z.literal("COMPOUND"), action: z.lazy(() => compoundActionSchema) }).strict(),
]);
const timingContextSchema = z
  .object({
    approvedClock: timestamp,
    eventTimes: z.record(timestamp).optional(),
    triggerTimes: z.record(timestamp).optional(),
    actionTimes: z.record(
      z.object({
        requestedStart: timestamp.optional(),
        effectiveStart: timestamp.optional(),
        end: timestamp.optional(),
        completedAt: timestamp.optional(),
      }).strict(),
    ).optional(),
    metricObservations: z.record(
      z.object({ value: z.number().finite(), unit: z.string().optional(), observedAt: timestamp }).strict(),
    ).optional(),
    dependencyGraph: z.array(z.unknown()).optional(),
    horizonEnd: timestamp.optional(),
    maxOccurrences: z.number().int().positive().max(10_000).optional(),
    disambiguation: z.enum(["compatible", "earlier", "later", "reject"]).optional(),
  })
  .strict();

const experimentReadinessContextObjectSchema = z
  .object({
    armRegistry: z.array(registryEntrySchema),
    graphRegistry: z.array(registryEntrySchema),
    timing: timingContextSchema,
    ...populationEvidence,
    metricDefinitions: z.array(
      z.object({ metricRef: ref, evidenceRefs }).strict(),
    ),
    eligibleTraffic: z
      .object({
        populationId: ref,
        version: z.number().int().positive(),
        definitionFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/),
        binding: z.enum(["DECISION_TIME", "EXECUTION_TIME", "SEND_TIME", "TRIGGER_TIME", "EFFECTIVE_TIME"]),
        membershipMode: z.enum(["FROZEN_MEMBERSHIP", "DYNAMIC_MEMBERSHIP"]),
        evaluatedAt: timestamp,
        snapshotRef: ref.optional(),
        evidenceRefs,
      })
      .strict(),
    engineCapability: z
      .object({
        status: z.enum(["AVAILABLE", "UNAVAILABLE", "UNKNOWN"]),
        randomizationUnits: z.array(z.enum(["CUSTOMER", "SESSION", "ORDER", "CUSTOM"])),
        evidenceRefs,
      })
      .strict(),
    customRandomizationRegistrations: z.array(
      z.object({ registryRef: ref, code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/), evidenceRefs }).strict(),
    ),
  })
  .strict();

export const experimentReadinessContextSchema: z.ZodEffects<
  typeof experimentReadinessContextObjectSchema
> = experimentReadinessContextObjectSchema.superRefine((context, refinement) => {
    for (const [collection, entries] of [
      ["evaluations", context.evaluations],
      ["snapshots", context.snapshots ?? []],
    ] as const)
      entries.forEach((entry, index) => {
        if (!entry.evaluatedAt.endsWith("Z"))
          refinement.addIssue({
            code: "custom",
            path: [collection, index, "evaluatedAt"],
            message: "Readiness evidence timestamps must be UTC and end in Z",
          });
      });
  });

export type ExperimentReadinessContext = z.infer<
  typeof experimentReadinessContextSchema
>;
export type ExperimentReadinessStatus = "READY" | "BLOCKED" | "UNKNOWN";
export interface ExperimentArmReadiness {
  armId: string;
  entityKind: "ACTION" | "COMPOUND";
  referenceId: string;
  status: "READY" | "BLOCKED" | "UNKNOWN";
  reasonCodes: string[];
  missingRefs: string[];
  evidenceRefs: string[];
}
export interface ExperimentReadiness {
  actionId?: string;
  status: ExperimentReadinessStatus;
  reasonCodes: string[];
  missingRefs: string[];
  evidenceRefs: string[];
  arms: ExperimentArmReadiness[];
}

type RegistryValue =
  | { entityKind: "ACTION"; action: CanonicalAction }
  | { entityKind: "COMPOUND"; action: CompoundAction };

export function assessExperimentReadiness(
  input: unknown,
  contextInput: unknown,
): ExperimentReadiness {
  const parsed = canonicalActionSchema.safeParse(input);
  if (!parsed.success || !experimentWhatSchema.safeParse(parsed.success ? parsed.data.what : undefined).success)
    return result(undefined, "BLOCKED", ["INVALID_EXPERIMENT_ACTION"]);
  const action = parsed.data;
  const what = experimentWhatSchema.parse(action.what);
  const checked = experimentReadinessContextSchema.safeParse(contextInput);
  if (!checked.success)
    return result(action.actionId, "BLOCKED", ["INVALID_READINESS_CONTEXT"]);
  const context = checked.data;
  const reasons: string[] = [];
  const missing = new Set<string>();
  const evidence = new Set<string>();
  let hasBlocked = false;
  let hasUnknown = false;
  const blocked = (code: string) => {
    hasBlocked = true;
    reasons.push(code);
  };
  const unknown = (code: string, missingRef?: string) => {
    hasUnknown = true;
    reasons.push(code);
    if (missingRef) missing.add(missingRef);
  };

  const registryEntries = [...context.armRegistry, ...context.graphRegistry];
  const registryKeys = registryEntries.map((entry) =>
    entry.entityKind === "ACTION"
      ? `ACTION:${entry.action.actionId}`
      : `COMPOUND:${entry.action.compoundActionId}`,
  );
  const ambiguousRegistryKeys = new Set(
    registryKeys.filter((key, index) => registryKeys.indexOf(key) !== index),
  );
  if (ambiguousRegistryKeys.size)
    blocked("AMBIGUOUS_ARM_REGISTRY");
  const registry = parseRegistry(registryEntries, ambiguousRegistryKeys);
  const arms = what.arms.map((arm) =>
    resolveArm(arm, registry, ambiguousRegistryKeys, evidence),
  );
  for (const arm of arms) {
    if (arm.status === "UNKNOWN") unknown("ARM_REFERENCE_REQUIRED", arm.referenceId);
    else if (arm.status === "BLOCKED") blocked(arm.reasonCodes[0]!);
  }

  if (hasExperimentCycle(action, registry)) blocked("EXPERIMENT_REFERENCE_CYCLE");

  let timing;
  try {
    timing = resolveActionTiming(action.timing, {
      ...(context.timing as unknown as ActionTimingResolutionContext),
      actionId: action.actionId,
    });
  } catch {
    return result(action.actionId, "BLOCKED", ["INVALID_TIMING_CONTEXT"]);
  }
  if (timing.status === "INVALID") blocked("EXPERIMENT_TIMING_INVALID");
  else if (timing.status !== "VALID") unknown("EXPERIMENT_TIMING_UNRESOLVED");
  if (what.stopping.timingHorizon === "ENVELOPE_TIMING" && timing.status === "VALID") {
    if (!timing.resolvedEffectiveStart || Date.parse(what.measurementWindow.start) < Date.parse(timing.resolvedEffectiveStart))
      blocked("MEASUREMENT_WINDOW_BEFORE_EXECUTION");
    if (!timing.resolvedEnd || Date.parse(timing.resolvedEnd) < Date.parse(what.measurementWindow.end))
      blocked("FIXED_TIMING_HORIZON_TOO_SHORT");
  } else if (timing.status === "VALID" && timing.resolvedEffectiveStart &&
      Date.parse(what.measurementWindow.start) < Date.parse(timing.resolvedEffectiveStart)) {
    blocked("MEASUREMENT_WINDOW_BEFORE_EXECUTION");
  }

  const eligibleCount = checkPopulation(action, context, blocked, unknown, evidence);

  for (const metricRef of [what.primaryMetricRef, ...(what.guardrailMetricRefs ?? [])]) {
    const definitions = context.metricDefinitions.filter((definition) => definition.metricRef === metricRef);
    if (!definitions.length) unknown("METRIC_DEFINITION_REQUIRED", metricRef);
    else if (definitions.length > 1) blocked("AMBIGUOUS_METRIC_DEFINITION");
    else definitions[0]!.evidenceRefs.forEach((entry) => evidence.add(entry));
  }

  context.eligibleTraffic.evidenceRefs.forEach((entry) => evidence.add(entry));
  const traffic = context.eligibleTraffic;
  const populationRef = action.population!;
  const bindingTime = context.bindingTimes[populationRef.binding];
  if (traffic.populationId !== populationRef.populationId || traffic.version !== populationRef.version ||
      traffic.definitionFingerprint !== populationRef.definitionFingerprint || traffic.binding !== populationRef.binding ||
      traffic.membershipMode !== populationRef.membershipMode || traffic.snapshotRef !== populationRef.snapshotRef ||
      (bindingTime !== undefined && Date.parse(traffic.evaluatedAt) !== Date.parse(bindingTime)))
    blocked("ELIGIBLE_TRAFFIC_POPULATION_MISMATCH");
  if (Date.parse(traffic.evaluatedAt) > Date.parse(context.timing.approvedClock))
    blocked("FUTURE_TRAFFIC_EVIDENCE");
  if (what.stopping.sampleTarget !== undefined && eligibleCount !== undefined && eligibleCount < what.stopping.sampleTarget)
    blocked("INSUFFICIENT_ELIGIBLE_TRAFFIC");

  context.engineCapability.evidenceRefs.forEach((entry) => evidence.add(entry));
  if (context.engineCapability.status === "UNAVAILABLE") blocked("EXPERIMENT_ENGINE_UNAVAILABLE");
  else if (context.engineCapability.status === "UNKNOWN") unknown("EXPERIMENT_ENGINE_CAPABILITY_UNKNOWN");
  const unit = typeof what.randomizationUnit === "string" ? what.randomizationUnit : "CUSTOM";
  if (!context.engineCapability.randomizationUnits.includes(unit)) blocked("RANDOMIZATION_UNIT_UNSUPPORTED");
  const customUnit = typeof what.randomizationUnit === "string" ? undefined : what.randomizationUnit;
  if (customUnit) {
    const registration = context.customRandomizationRegistrations.find(
      (entry) => entry.registryRef === customUnit.registryRef && entry.code === customUnit.code,
    );
    if (!registration) unknown("CUSTOM_RANDOMIZATION_REGISTRATION_REQUIRED", `${customUnit.registryRef}:${customUnit.code}`);
    else registration.evidenceRefs.forEach((entry) => evidence.add(entry));
  }

  const uniqueReasons = [...new Set(reasons)];
  const status: ExperimentReadinessStatus = hasBlocked
    ? "BLOCKED"
    : hasUnknown
      ? "UNKNOWN"
      : "READY";
  return {
    actionId: action.actionId,
    status,
    reasonCodes: uniqueReasons,
    missingRefs: [...missing].sort(),
    evidenceRefs: [...evidence].sort(),
    arms,
  };
}

function parseRegistry(
  entries: ExperimentReadinessContext["armRegistry"],
  excluded: ReadonlySet<string>,
): Map<string, RegistryValue> {
  const registry = new Map<string, RegistryValue>();
  for (const entry of entries) {
    if (entry.entityKind === "ACTION") {
      const parsed = canonicalActionSchema.safeParse(entry.action);
      const key = parsed.success ? `ACTION:${parsed.data.actionId}` : undefined;
      if (parsed.success && key && !excluded.has(key)) registry.set(key, { entityKind: "ACTION", action: parsed.data });
    } else {
      const parsed = compoundActionSchema.safeParse(entry.action);
      const key = parsed.success ? `COMPOUND:${parsed.data.compoundActionId}` : undefined;
      if (parsed.success && key && !excluded.has(key)) registry.set(key, { entityKind: "COMPOUND", action: parsed.data });
    }
  }
  return registry;
}

function armIdentity(arm: ExperimentArm) {
  return arm.entityKind === "COMPOUND"
    ? { entityKind: "COMPOUND" as const, referenceId: arm.compoundActionId }
    : { entityKind: "ACTION" as const, referenceId: arm.actionId };
}

function resolveArm(
  arm: ExperimentArm,
  registry: Map<string, RegistryValue>,
  ambiguous: ReadonlySet<string>,
  evidence: Set<string>,
): ExperimentArmReadiness {
  const identity = armIdentity(arm);
  const key = `${identity.entityKind}:${identity.referenceId}`;
  if (ambiguous.has(key))
    return { armId: arm.armId, ...identity, status: "BLOCKED", reasonCodes: ["AMBIGUOUS_ARM_REGISTRY"], missingRefs: [], evidenceRefs: [] };
  const registered = registry.get(key);
  if (!registered)
    return { armId: arm.armId, ...identity, status: "UNKNOWN", reasonCodes: ["ARM_REFERENCE_REQUIRED"], missingRefs: [identity.referenceId], evidenceRefs: [] };
  const actual = registered.entityKind === "ACTION"
    ? fingerprintCanonicalAction(registered.action)
    : fingerprintCompoundAction(registered.action);
  if (actual !== arm.actionFingerprint)
    return { armId: arm.armId, ...identity, status: "BLOCKED", reasonCodes: ["ARM_FINGERPRINT_MISMATCH"], missingRefs: [], evidenceRefs: [] };
  const refEvidence = registered.action.provenance;
  refEvidence.forEach((entry) => evidence.add(entry));
  return { armId: arm.armId, ...identity, status: "READY", reasonCodes: [], missingRefs: [], evidenceRefs: [...refEvidence] };
}

function hasExperimentCycle(root: CanonicalAction, registry: Map<string, RegistryValue>): boolean {
  const visit = (value: RegistryValue, path: Set<string>): boolean => {
    const key = value.entityKind === "ACTION" ? `ACTION:${value.action.actionId}` : `COMPOUND:${value.action.compoundActionId}`;
    if (path.has(key)) return true;
    const nextPath = new Set(path).add(key);
    if (value.entityKind === "COMPOUND")
      return value.action.components.some((component) =>
        component.action.what.actionType === "experiment.run"
          ? visit({ entityKind: "ACTION", action: component.action }, nextPath)
          : false,
      );
    const experiment = experimentWhatSchema.safeParse(value.action.what);
    if (!experiment.success) return false;
    return experiment.data.arms.some((arm) => {
      const identity = armIdentity(arm);
      const childKey = `${identity.entityKind}:${identity.referenceId}`;
      if (nextPath.has(childKey)) return true;
      const child = registry.get(childKey);
      return child ? visit(child, nextPath) : false;
    });
  };
  return visit({ entityKind: "ACTION", action: root }, new Set());
}

function checkPopulation(
  action: CanonicalAction,
  context: ExperimentReadinessContext,
  blocked: (code: string) => void,
  unknown: (code: string, ref?: string) => void,
  evidence: Set<string>,
): number | undefined {
  const reference = action.population!;
  const sameIdentity = context.populations.filter((definition) =>
    definition.populationId === reference.populationId && definition.version === reference.version,
  );
  if (!sameIdentity.length) {
    unknown("POPULATION_DEFINITION_REQUIRED", reference.populationId);
    return undefined;
  }
  if (sameIdentity.length > 1) {
    blocked("AMBIGUOUS_POPULATION_DEFINITION");
    return undefined;
  }
  const definition = sameIdentity.find((candidate) =>
    fingerprintPopulationDefinition(candidate) === reference.definitionFingerprint &&
    candidate.binding === reference.binding && candidate.membershipMode === reference.membershipMode,
  );
  if (!definition) {
    blocked("POPULATION_DEFINITION_MISMATCH");
    return undefined;
  }
  definition.provenance.forEach((entry) => evidence.add(entry));
  const at = context.bindingTimes[reference.binding];
  if (!at) {
    unknown("POPULATION_BINDING_TIME_REQUIRED", reference.binding);
    return undefined;
  }
  const matches = (entry: { populationId: string; version: number; definitionFingerprint: string; binding: string; membershipMode: string; evaluatedAt: string }) =>
    entry.populationId === reference.populationId && entry.version === reference.version &&
    entry.definitionFingerprint === reference.definitionFingerprint && entry.binding === reference.binding &&
    entry.membershipMode === reference.membershipMode && Date.parse(entry.evaluatedAt) === Date.parse(at);
  if (reference.membershipMode === "FROZEN_MEMBERSHIP") {
    const snapshots = context.snapshots?.filter((candidate) => candidate.snapshotId === reference.snapshotRef && matches(candidate)) ?? [];
    if (snapshots.length > 1) blocked("AMBIGUOUS_POPULATION_SNAPSHOT");
    else if (!snapshots.length) unknown("FROZEN_POPULATION_SNAPSHOT_REQUIRED", reference.snapshotRef);
    const snapshot = snapshots.length === 1 ? snapshots[0] : undefined;
    if (!snapshot) return undefined;
    else if (snapshot.unknownCustomerIds.length) unknown("POPULATION_MEMBERSHIP_UNRESOLVED");
    else {
      snapshot.provenance.forEach((entry) => evidence.add(entry));
      return snapshot.customerIds.length;
    }
  } else {
    const evaluations = context.evaluations.filter(matches);
    if (evaluations.length > 1) blocked("AMBIGUOUS_POPULATION_EVALUATION");
    else if (!evaluations.length) unknown("DYNAMIC_POPULATION_EVALUATION_REQUIRED", reference.populationId);
    const evaluation = evaluations.length === 1 ? evaluations[0] : undefined;
    if (!evaluation) return undefined;
    else if (evaluation.unknownCount) unknown("POPULATION_MEMBERSHIP_UNRESOLVED");
    else {
      evaluation.provenance.forEach((entry) => evidence.add(entry));
      return evaluation.eligibleCount;
    }
  }
  return undefined;
}

function result(actionId: string | undefined, status: ExperimentReadinessStatus, reasonCodes: string[]): ExperimentReadiness {
  return { ...(actionId ? { actionId } : {}), status, reasonCodes, missingRefs: [], evidenceRefs: [], arms: [] };
}
