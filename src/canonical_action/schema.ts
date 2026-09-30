import { z } from "zod";
import {
  validateAction,
  assertValidAction,
} from "../action_ontology/validation.js";
import type { Action } from "../action_ontology/types.js";
import { utcTimestamp } from "../core/units.js";
import type { ActionTiming } from "../action_timing/types.js";
import { validateActionTiming } from "../action_timing/validation.js";
import { lifecycleWhatSchema } from "../lifecycle/canonical.js";
import { populationReferenceSchema } from "../population/index.js";
import { decisionWhatSchema } from "../decision_forms/index.js";
import { experimentWhatSchema } from "../experiment/schema.js";
import { hardConstraintsSchema } from "../action_constraints/schema.js";
import { actionDependenciesSchema } from "../action_dependencies/schema.js";
import { actionConflictsSchema } from "../action_conflicts/schema.js";
import { actionCharacteristicsSchema } from "../action_characteristics/schema.js";
import { actionRiskMeasurementContractsSchema } from "../action_risk/schema.js";
import { actionOutcomeContractsSchema } from "../action_outcomes/schema.js";
import { expectedDomainEligibilityCheckIdsForWhat } from "../action_eligibility/definitions.js";
import type { ActionCharacteristics } from "../action_characteristics/schema.js";
import type { ActionRiskMeasurementContracts } from "../action_risk/schema.js";
import type { ActionOutcomeContracts } from "../action_outcomes/schema.js";

export const CANONICAL_ACTION_SCHEMA_VERSION = "2.0.0" as const;
export type LegacyBusiness = Omit<
  Action,
  | "kind"
  | "schemaVersion"
  | "actionId"
  | "timing"
  | "duration"
  | "termination"
  | "provenance"
> & {
  readonly kind: "legacy_business";
  readonly legacySchemaVersion: Action["schemaVersion"];
};
const validationTime = utcTimestamp("2000-01-01T00:00:00Z");
/** Used only to validate the retained business fields, never for execution. */
function legacyValidationInput(
  value: LegacyBusiness,
  timing: ActionTiming,
  actionId: string,
): unknown {
  const { kind: _, legacySchemaVersion, ...business } = value;
  const decision =
    timing.decisionTime.state === "SPECIFIED"
      ? timing.decisionTime.value
      : validationTime;
  const point = (
    part: ActionTiming["requestedStart"] | ActionTiming["effectiveStart"],
  ) =>
    part.state === "SPECIFIED" &&
    part.value.kind === "ABSOLUTE" &&
    part.value.time.kind === "UTC"
      ? { kind: "known", at: part.value.time.at }
      : { kind: "unknown", reason: "Universal timing resolved separately" };
  const durationValue =
    timing.duration.state === "SPECIFIED" ? timing.duration.value : undefined;
  const duration =
    durationValue?.kind === "INSTANTANEOUS"
      ? { kind: "instantaneous" }
      : durationValue?.kind === "ELAPSED"
        ? {
            kind: "temporary",
            durationSeconds:
              durationValue.amount *
              (durationValue.unit === "SECOND"
                ? 1
                : durationValue.unit === "MINUTE"
                  ? 60
                  : 3600),
          }
        : // A positive witness invokes inherited temporary-policy safety checks. Its
          // magnitude is never stored or used for resolution; universal timing alone
          // defines calendar arithmetic, and no legacy translator receives this object.
          durationValue?.kind === "CALENDAR"
          ? { kind: "temporary", durationSeconds: 1 }
          : { kind: "persistent" };
  const end = timing.end.state === "SPECIFIED" ? timing.end.value : undefined;
  const termination =
    end?.kind === "ABSOLUTE" && end.time.kind === "UTC"
      ? { kind: "fixed_end", at: end.time.at }
      : duration.kind === "temporary"
        ? { kind: "fixed_duration", durationSeconds: duration.durationSeconds }
        : { kind: "persistent" };
  return {
    ...business,
    kind: "atomic_action",
    schemaVersion: legacySchemaVersion,
    actionId,
    timing: {
      decisionTime: decision,
      requestedStart: point(timing.requestedStart),
      effectiveStart: point(timing.effectiveStart),
      implementationDelaySeconds: {
        kind: "unknown",
        reason: "Universal timing resolved separately",
      },
    },
    duration,
    termination,
    provenance: { source: "human", createdAt: decision, evidenceRefs: [] },
  };
}
const excludedBusinessKeys = new Set([
  "actionId",
  "schemaVersion",
  "timing",
  "duration",
  "termination",
  "provenance",
]);
export const legacyBusinessSchema = z.custom<LegacyBusiness>((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as LegacyBusiness;
  if (
    value.kind !== "legacy_business" ||
    typeof value.actionType !== "string" ||
    value.actionType.startsWith("lifecycle.")
  )
    return false;
  if (Object.keys(value).some((key) => excludedBusinessKeys.has(key)))
    return false;
  return true;
}, "Invalid legacy business fields or competing temporal contract");

export const universalTimingSchema = z.custom<ActionTiming>(
  (value) => validateActionTiming(value).ok,
  "Invalid universal ActionTiming",
);
export const actionCharacteristicsStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ABSENT") }).strict(),
  z.object({ state: z.literal("PRESENT"), value: actionCharacteristicsSchema }).strict(),
]);
export const actionRiskDimensionsStateSchema = z.union([
  z.object({ state: z.literal("ABSENT") }).strict(),
  actionRiskMeasurementContractsSchema,
]);
export const actionOutcomeContractsStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ABSENT") }).strict(),
  z.object({ state: z.literal("PRESENT"), value: actionOutcomeContractsSchema }).strict(),
]);
const forbidden = new Set([
  "expectedOpenRate",
  "expectedClickRate",
  "expectedConversion",
  "expectedRevenue",
  "expectedProfit",
  "expectedRetentionLift",
  "expectedLTV",
  "predictedChurn",
  "predictedOptimalSendTime",
  "responseProbability",
  "bestAudience",
  "recommendedTreatment",
  "recommendationScore",
  "confidenceScore",
  "futurePurchase",
  "counterfactualRevenue",
  "score",
  "rank",
  "expectedLift",
  "expectedROAS",
  "expectedSynergy",
  "expectedValueOfInformation",
  "expectedProfitFromInvestigation",
  "recommendedInvestigationScore",
  "predictedBestAction",
  "predictedInvestigationValue",
  "bestCandidate",
  "winner",
  "lift",
  "significance",
  "posterior",
  "recommendation",
  "best",
  "groundTruth",
  "trueWorld",
  "oracle",
  "godMode",
  "latentState",
  "actualBest",
  "optimalAction",
  "regret",
  "adaptive",
  "sequential",
  "results",
  "email",
  "phone",
  "name",
  "postalAddress",
]);
function guard(
  value: unknown,
  ctx: z.RefinementCtx,
  path: (string | number)[] = [],
): void {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key))
      ctx.addIssue({
        code: "custom",
        path: [...path, key],
        message:
          "Canonical intent cannot contain predictions, desirability, or raw PII",
      });
    guard(entry, ctx, [...path, key]);
  }
}
export const canonicalActionSchema = z
  .object({
    schemaVersion: z.literal(CANONICAL_ACTION_SCHEMA_VERSION),
    actionId: z.string().regex(/^action_[A-Za-z0-9._:-]+$/),
    what: z.union([
      lifecycleWhatSchema,
      decisionWhatSchema,
      experimentWhatSchema,
      legacyBusinessSchema,
    ]),
    population: populationReferenceSchema.optional(),
    timing: universalTimingSchema,
    constraints: hardConstraintsSchema.default([]),
    dependencies: actionDependenciesSchema.default([]),
    conflicts: actionConflictsSchema.default([]),
    characteristics: actionCharacteristicsStateSchema.default({ state: "ABSENT" }),
    riskDimensions: actionRiskDimensionsStateSchema.default({ state: "ABSENT" }),
    outcomes: actionOutcomeContractsStateSchema.default({ state: "ABSENT" }),
    provenance: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/)).min(1),
  })
  .strict()
  .superRefine((action, ctx) => {
    guard(action, ctx);
    const constraintsById = new Map(
      action.constraints.map((constraint) => [constraint.constraintId, constraint]),
    );
    const eligibilityCheckIds = localEligibilityCheckIds(action.what);
    action.dependencies.forEach((dependency, index) => {
      if (dependency.kind === "HARD_CONSTRAINT_GATE") {
        const constraint = constraintsById.get(dependency.constraintId);
        if (!constraint) {
          ctx.addIssue({ code: "custom", path: ["dependencies", index, "constraintId"], message: "Hard-constraint gate must reference a local constraint" });
        } else if (constraint.evaluationBoundary !== dependency.evaluationBoundary) {
          ctx.addIssue({ code: "custom", path: ["dependencies", index, "evaluationBoundary"], message: "Hard-constraint gate boundary must equal its local constraint boundary" });
        }
      }
      if (
        dependency.kind === "ELIGIBILITY_CHECK_GATE" &&
        !eligibilityCheckIds.has(dependency.checkId)
      )
        ctx.addIssue({ code: "custom", path: ["dependencies", index, "checkId"], message: "Eligibility gate must reference a local eligibility check" });
    });
    const decision = decisionWhatSchema.safeParse(action.what);
    const experiment = experimentWhatSchema.safeParse(action.what);
    if (experiment.success) {
      if (!action.population)
        ctx.addIssue({
          code: "custom",
          path: ["population"],
          message: "Experiments require the canonical envelope population",
        });
      if (
        experiment.data.stopping.timingHorizon === "ENVELOPE_TIMING" &&
        !hasFiniteTimingHorizon(action.timing)
      )
        ctx.addIssue({
          code: "custom",
          path: ["timing"],
          message:
            "Experiment envelope timing must define a finite stopping horizon",
        });
    }
    if (
      decision.success &&
      decision.data.actionType === "investigation.inspect" &&
      decision.data.targets.some((target) => target.kind === "POPULATION") &&
      !action.population
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["population"],
        message:
          "Population investigations require the canonical envelope population",
      });
    }
    if (
      "scope" in action.what &&
      action.what.scope &&
      "kind" in action.what.scope &&
      action.what.scope.kind === "POPULATION" &&
      !action.population
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["population"],
        message:
          "Population-scoped decisions require a canonical population reference",
      });
    }
    if ("kind" in action.what && action.what.kind === "legacy_business") {
      const checked = validateAction(
        legacyValidationInput(action.what, action.timing, action.actionId),
      );
      if (!checked.ok)
        for (const error of checked.errors)
          ctx.addIssue({
            code: "custom",
            path: ["what", error.path],
            message: error.message,
          });
    }
    if (
      (action.what.actionType === "lifecycle.send" ||
        action.what.actionType === "lifecycle.start_flow") &&
      !action.population
    )
      ctx.addIssue({
        code: "custom",
        path: ["population"],
        message:
          "Lifecycle sends and flow starts require explicit population membership",
      });
    if (
      action.what.actionType === "lifecycle.send" &&
      (action.timing.duration.state !== "SPECIFIED" ||
        action.timing.duration.value.kind !== "INSTANTANEOUS")
    )
      ctx.addIssue({
        code: "custom",
        path: ["timing", "duration"],
        message: "A send is an instantaneous communication event",
      });
  });

function localEligibilityCheckIds(what: CanonicalAction["what"]): Set<string> {
  const ids = new Set(expectedDomainEligibilityCheckIdsForWhat(what));
  if ("kind" in what && what.kind === "legacy_business") {
    for (const precondition of what.preconditions) ids.add(precondition.preconditionId);
  }
  return ids;
}

function hasFiniteTimingHorizon(timing: ActionTiming): boolean {
  if (timing.recurrence.state === "UNKNOWN") return false;
  if (timing.recurrence.state === "SPECIFIED") {
    const boundary = timing.recurrence.value.boundary;
    if (boundary.kind === "OPEN_ENDED") return false;
    if (
      boundary.maxOccurrences === undefined &&
      boundary.recurrenceEnd === undefined
    )
      return false;
  }
  if (
    timing.end.state === "SPECIFIED" &&
    (timing.end.value.kind === "ABSOLUTE" ||
      timing.end.value.kind === "DERIVE_FROM_DURATION")
  )
    return true;
  return (
    timing.duration.state === "SPECIFIED" &&
    timing.duration.value.kind !== "PERSISTENT"
  );
}
export type CanonicalAction = z.infer<typeof canonicalActionSchema>;
export type NewCanonicalAction = Omit<
  CanonicalAction,
  "characteristics" | "riskDimensions" | "outcomes"
> & {
  characteristics: { state: "PRESENT"; value: ActionCharacteristics };
  riskDimensions: ActionRiskMeasurementContracts;
  outcomes: { state: "PRESENT"; value: ActionOutcomeContracts };
};
export const newCanonicalActionSchema = canonicalActionSchema.superRefine(
  (action, context) => {
    if (action.characteristics.state !== "PRESENT")
      context.addIssue({ code: "custom", path: ["characteristics"], message: "New Actions require explicit characteristics" });
    if ("state" in action.riskDimensions)
      context.addIssue({ code: "custom", path: ["riskDimensions"], message: "New Actions require all six risk measurement dimensions" });
    if (action.outcomes.state !== "PRESENT")
      context.addIssue({ code: "custom", path: ["outcomes"], message: "New Actions require measurable outcome contracts" });
  },
) as unknown as z.ZodType<NewCanonicalAction>;
export function assertCanonicalAction(input: unknown): CanonicalAction {
  return canonicalActionSchema.parse(input);
}
export function assertNewCanonicalAction(input: unknown): NewCanonicalAction {
  return newCanonicalActionSchema.parse(input);
}
export function assertHistoricalAction(input: unknown): Action {
  return assertValidAction(input);
}
