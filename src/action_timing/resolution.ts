import { utcTimestamp, type UtcTimestamp } from "../core/units.js";
import type {
  AbsoluteTime,
  ActionTiming,
  ActionTimingResolutionContext,
  EffectiveStart,
  RequestedStart,
  TemporalOffset,
  TimingResolution,
  TimingValue,
} from "./types.js";
import { validateActionTiming } from "./validation.js";

function specified<T>(value: TimingValue<T>): T | undefined {
  return value.state === "SPECIFIED" ? value.value : undefined;
}

function elapsedMs(offset: TemporalOffset): number | undefined {
  if (offset.kind !== "ELAPSED") return undefined;
  if (offset.unit === "SECOND") return offset.amount * 1000;
  if (offset.unit === "MINUTE") return offset.amount * 60_000;
  return offset.amount * 3_600_000;
}

function applyOffset(
  base: UtcTimestamp,
  offset: TemporalOffset | undefined,
  direction: 1 | -1,
): UtcTimestamp | undefined {
  if (!offset) return base;
  const ms = elapsedMs(offset);
  if (ms === undefined) return undefined;
  return utcTimestamp(new Date(Date.parse(base) + direction * ms).toISOString());
}

function absoluteUtc(
  value: AbsoluteTime,
  missing: string[],
): UtcTimestamp | undefined {
  if (value.kind === "UTC") return value.at;
  missing.push("LOCAL_TIMEZONE_RESOLUTION_REQUIRED:" + value.at.timeZone);
  return undefined;
}

function resolveRequested(
  start: RequestedStart,
  context: ActionTimingResolutionContext,
  missing: string[],
  unresolved: string[],
): UtcTimestamp | undefined {
  if (start.kind === "IMMEDIATE") return context.approvedClock;
  if (start.kind === "ABSOLUTE") return absoluteUtc(start.time, missing);
  if (start.kind === "TRIGGER_RELATIVE") {
    const at = context.triggerTimes?.[start.triggerId];
    if (!at) unresolved.push("TRIGGER_NOT_YET_SATISFIED:" + start.triggerId);
    return at;
  }
  if (start.kind === "EVENT_RELATIVE") {
    const at = context.eventTimes?.[start.eventId];
    if (!at) {
      unresolved.push("EVENT_NOT_YET_OBSERVED:" + start.eventId);
      return undefined;
    }
    const resolved = applyOffset(
      at,
      start.offset,
      start.relation === "AFTER_EVENT" ? 1 : -1,
    );
    if (!resolved) missing.push("CALENDAR_OFFSET_RESOLVER_REQUIRED:" + start.eventId);
    return resolved;
  }

  const referenced = context.actionTimes?.[start.actionId];
  const base =
    start.relation === "START_AFTER_ACTION_COMPLETED"
      ? referenced?.completedAt
      : referenced?.effectiveStart;
  if (!base) {
    unresolved.push("ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + start.actionId);
    return undefined;
  }
  const resolved = applyOffset(base, start.offset, 1);
  if (!resolved) missing.push("CALENDAR_OFFSET_RESOLVER_REQUIRED:" + start.actionId);
  return resolved;
}

function resolveEffective(
  effective: EffectiveStart,
  requested: UtcTimestamp | undefined,
  delay: TimingValue<TemporalOffset>,
  context: ActionTimingResolutionContext,
  missing: string[],
  unresolved: string[],
): UtcTimestamp | undefined {
  if (effective.kind === "ABSOLUTE") return absoluteUtc(effective.time, missing);
  if (effective.kind === "EVENT_RELATIVE") {
    const at = context.eventTimes?.[effective.eventId];
    if (!at) {
      unresolved.push("EVENT_NOT_YET_OBSERVED:" + effective.eventId);
      return undefined;
    }
    const resolved = applyOffset(
      at,
      effective.offset,
      effective.relation === "AFTER_EVENT" ? 1 : -1,
    );
    if (!resolved) missing.push("CALENDAR_OFFSET_RESOLVER_REQUIRED:" + effective.eventId);
    return resolved;
  }
  if (effective.kind === "ACTION_RELATIVE") {
    const referenced = context.actionTimes?.[effective.actionId];
    const base =
      effective.relation === "START_AFTER_ACTION_COMPLETED"
        ? referenced?.completedAt
        : referenced?.effectiveStart;
    if (!base) {
      unresolved.push("ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + effective.actionId);
      return undefined;
    }
    const resolved = applyOffset(base, effective.offset, 1);
    if (!resolved) missing.push("CALENDAR_OFFSET_RESOLVER_REQUIRED:" + effective.actionId);
    return resolved;
  }

  if (!requested) return undefined;
  if (delay.state === "UNKNOWN") {
    unresolved.push("IMPLEMENTATION_DELAY_UNKNOWN");
    return undefined;
  }
  if (delay.state === "SPECIFIED") {
    const resolved = applyOffset(requested, delay.value, 1);
    if (!resolved) missing.push("CALENDAR_IMPLEMENTATION_DELAY_RESOLVER_REQUIRED");
    return resolved;
  }
  return requested;
}

function resolveDurationEnd(
  timing: ActionTiming,
  requested: UtcTimestamp | undefined,
  effective: UtcTimestamp | undefined,
  missing: string[],
): UtcTimestamp | undefined {
  const explicitEnd = specified(timing.end);
  if (explicitEnd?.kind === "ABSOLUTE") return absoluteUtc(explicitEnd.time, missing);

  const duration = specified(timing.duration);
  if (!duration || duration.kind === "PERSISTENT" || duration.kind === "INSTANTANEOUS") {
    return duration?.kind === "INSTANTANEOUS" ? effective : undefined;
  }
  if (duration.kind === "CALENDAR") {
    missing.push("CALENDAR_DURATION_RESOLVER_REQUIRED");
    return undefined;
  }

  const base =
    duration.anchor === "DECISION_TIME"
      ? specified(timing.decisionTime)
      : duration.anchor === "REQUESTED_START"
        ? requested
        : effective;
  if (!base) return undefined;

  const offset: TemporalOffset = {
    kind: "ELAPSED",
    amount: duration.amount,
    unit: duration.unit,
  };
  return applyOffset(base, offset, 1);
}

export function resolveActionTiming(
  timing: ActionTiming,
  context: ActionTimingResolutionContext,
): TimingResolution {
  const validation = validateActionTiming(timing);
  if (!validation.ok) {
    return {
      timingSchemaVersion: timing.schemaVersion,
      status: "INVALID",
      occurrences: [],
      unresolvedDependencies: [],
      missingContext: [],
      validationCodes: validation.issues.map((issue) => issue.code),
      provenance: ["action-timing-validator@1.0.0"],
    };
  }

  const missing: string[] = [];
  const unresolved: string[] = [];

  const startIntent = specified(timing.requestedStart);
  const requested = startIntent
    ? resolveRequested(startIntent, context, missing, unresolved)
    : undefined;

  const effectiveIntent = specified(timing.effectiveStart);
  const effective = effectiveIntent
    ? resolveEffective(
        effectiveIntent,
        requested,
        timing.implementationDelay,
        context,
        missing,
        unresolved,
      )
    : undefined;

  const end = resolveDurationEnd(timing, requested, effective, missing);
  const status =
    missing.length > 0 ||
    unresolved.length > 0 ||
    timing.decisionTime.state === "UNKNOWN" ||
    timing.requestedStart.state === "UNKNOWN" ||
    timing.effectiveStart.state === "UNKNOWN"
      ? "UNRESOLVED"
      : "VALID";

  return {
    timingSchemaVersion: timing.schemaVersion,
    status,
    ...(requested ? { resolvedRequestedStart: requested } : {}),
    ...(effective ? { resolvedEffectiveStart: effective } : {}),
    ...(end ? { resolvedEnd: end } : {}),
    occurrences: [],
    unresolvedDependencies: unresolved,
    missingContext: missing,
    validationCodes: [],
    provenance: ["action-timing-validator@1.0.0", "action-timing-resolver@1.0.0"],
  };
}
