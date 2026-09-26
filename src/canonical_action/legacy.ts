import { assertValidAction } from "../action_ontology/validation.js";
import type { Action } from "../action_ontology/types.js";
import type {
  ActionTiming,
  TimingDuration,
  TimingValue,
  TimingRecurrence,
} from "../action_timing/types.js";
import { canonicalActionSchema, type CanonicalAction } from "./schema.js";

const specified = <T>(value: T): TimingValue<T> => ({
  state: "SPECIFIED",
  value,
});
const absent = { state: "ABSENT" } as const;
/** Explicit adapter: historical readers/fingerprints never silently migrate. */
export function adaptLegacyAction(input: Action): CanonicalAction {
  const action = assertValidAction(input);
  if (action.actionType.startsWith("lifecycle."))
    throw new Error(
      "Lifecycle migration requires an explicit PopulationDefinition and flow-step timing",
    );
  if (action.termination.kind === "condition")
    throw new Error(
      "Legacy conditionRef requires explicit structural termination migration",
    );
  if (
    action.duration.kind === "until_reversed" ||
    action.termination.kind === "manual_reversal"
  )
    throw new Error(
      "Legacy manual reversal requires explicit reversal-event timing migration",
    );
  const {
    kind: _,
    schemaVersion,
    actionId,
    timing: old,
    duration,
    termination,
    provenance,
    ...business
  } = action;
  const point = (
    value: typeof old.requestedStart,
  ): TimingValue<{
    kind: "ABSOLUTE";
    time: { kind: "UTC"; at: typeof old.decisionTime; timeZone: string };
  }> =>
    value.kind === "known"
      ? specified({
          kind: "ABSOLUTE",
          time: { kind: "UTC", at: value.at, timeZone: "UTC" },
        })
      : { state: "UNKNOWN", reason: value.reason };
  let newDuration: TimingDuration;
  let recurrence: TimingValue<TimingRecurrence> = absent;
  switch (duration.kind) {
    case "instantaneous":
      newDuration = { kind: "INSTANTANEOUS" };
      break;
    case "temporary":
      newDuration = {
        kind: "ELAPSED",
        amount: duration.durationSeconds,
        unit: "SECOND",
        anchor: "EFFECTIVE_START",
      };
      break;
    case "recurring": {
      if (old.requestedStart.kind !== "known")
        throw new Error(
          "Recurring legacy Action requires a known start to migrate local recurrence",
        );
      const d = new Date(old.requestedStart.at),
        r = duration.recurrence;
      const localTime = d.toISOString().slice(11, 19);
      const frequency =
        r.kind === "daily"
          ? { kind: "DAILY" as const, interval: r.interval, localTime }
          : r.kind === "weekly"
            ? {
                kind: "WEEKLY" as const,
                interval: r.interval,
                daysOfWeek: r.daysOfWeek ?? [d.getUTCDay()],
                localTime,
              }
            : {
                kind: "MONTHLY" as const,
                interval: r.interval,
                dayOfMonth: d.getUTCDate(),
                localTime,
              };
      recurrence = specified({
        frequency,
        boundary: r.maxOccurrences
          ? { kind: "BOUNDED", maxOccurrences: r.maxOccurrences }
          : { kind: "OPEN_ENDED", explicitlyOpenEnded: true },
      });
      newDuration = { kind: "INSTANTANEOUS" };
      break;
    }
    default:
      newDuration = { kind: "PERSISTENT" };
  }
  if (
    termination.kind === "fixed_duration" &&
    duration.kind === "temporary" &&
    duration.durationSeconds !== termination.durationSeconds
  )
    throw new Error(
      "Conflicting legacy duration and termination require explicit migration",
    );
  if (termination.kind === "fixed_duration")
    newDuration = {
      kind: "ELAPSED",
      amount: termination.durationSeconds,
      unit: "SECOND",
      anchor: "EFFECTIVE_START",
    };
  const timing: ActionTiming = {
    schemaVersion: "1.0.0",
    decisionTime: specified(old.decisionTime),
    requestedStart: point(old.requestedStart),
    effectiveStart: point(old.effectiveStart),
    implementationDelay:
      old.implementationDelaySeconds.kind === "known"
        ? specified({
            kind: "ELAPSED",
            amount: old.implementationDelaySeconds.seconds,
            unit: "SECOND",
          })
        : { state: "UNKNOWN", reason: old.implementationDelaySeconds.reason },
    duration: specified(newDuration),
    end:
      termination.kind === "fixed_end"
        ? specified({
            kind: "ABSOLUTE",
            time: { kind: "UTC", at: termination.at, timeZone: "UTC" },
          })
        : termination.kind === "fixed_duration" || duration.kind === "temporary"
          ? specified({ kind: "DERIVE_FROM_DURATION" })
          : absent,
    terminationCondition: absent,
    recurrence,
    timezone: specified("UTC"),
    constraints: absent,
    dependencies: [],
  };
  return canonicalActionSchema.parse({
    schemaVersion: "2.0.0",
    actionId,
    what: {
      kind: "legacy_business",
      legacySchemaVersion: schemaVersion,
      ...business,
    },
    timing,
    provenance: provenance.evidenceRefs.length
      ? provenance.evidenceRefs
      : ["legacy_migration"],
  });
}
