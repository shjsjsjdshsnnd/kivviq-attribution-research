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
    what: z.union([lifecycleWhatSchema, legacyBusinessSchema]),
    population: populationReferenceSchema.optional(),
    timing: universalTimingSchema,
    provenance: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/)).min(1),
  })
  .strict()
  .superRefine((action, ctx) => {
    guard(action, ctx);
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
export type CanonicalAction = z.infer<typeof canonicalActionSchema>;
export function assertCanonicalAction(input: unknown): CanonicalAction {
  return canonicalActionSchema.parse(input);
}
export function assertHistoricalAction(input: unknown): Action {
  return assertValidAction(input);
}
