import type { UtcTimestamp } from "../core/units.js";
import {
  ACTION_TIMING_SCHEMA_VERSION,
  type AbsoluteTime,
  type ActionTiming,
  type RecurrenceBoundary,
  type TemporalOffset,
  type TimingDependency,
  type TimingDuration,
  type TimingValue,
} from "./types.js";

export interface TimingValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type TimingValidationResult =
  | { readonly ok: true; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly TimingValidationIssue[] };

const FORBIDDEN_TIMING_KEYS = new Set([
  "actualFutureStart",
  "actualFutureReceipt",
  "futureCustomerPurchaseTime",
  "futureStockoutTime",
  "predictedBestStart",
  "predictedOptimalDuration",
  "expectedBestSendTime",
  "futureDemandPeak",
  "recommendationScore",
  "confidenceScore",
  "expectedRevenue",
  "expectedLift",
  "recommendedTreatment",
  "bestAudience",
]);

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function add(
  issues: TimingValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validUtc(value: unknown): value is UtcTimestamp {
  return (
    typeof value === "string" &&
    value.endsWith("Z") &&
    Number.isFinite(Date.parse(value))
  );
}

function validLocalDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)
  );
}

function validTimeZone(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validateForbidden(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      validateForbidden(entry, path + "[" + index + "]", issues),
    );
    return;
  }
  if (!record(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const child = path === "$" ? key : path + "." + key;
    if (FORBIDDEN_TIMING_KEYS.has(key)) {
      add(
        issues,
        "FORBIDDEN_TIMING_INFORMATION",
        child,
        "optimization, prediction, future realized state and recommendation fields do not belong in ActionTiming",
      );
    }
    validateForbidden(entry, child, issues);
  }
}

function validateTimingValue(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
  specified: (inner: unknown, innerPath: string) => void,
): void {
  if (!record(value) || !nonEmpty(value.state)) {
    add(issues, "INVALID_TIMING_VALUE", path, "explicit timing state is required");
    return;
  }
  if (value.state === "SPECIFIED") {
    if (!("value" in value)) {
      add(issues, "MISSING_TIMING_VALUE", path + ".value", "specified state requires a value");
      return;
    }
    if (value.sourceRef !== undefined && !nonEmpty(value.sourceRef)) {
      add(issues, "INVALID_TIMING_SOURCE_REF", path + ".sourceRef", "must be non-empty");
    }
    specified(value.value, path + ".value");
    return;
  }
  if (value.state === "UNKNOWN") {
    if (!nonEmpty(value.reason)) {
      add(issues, "INVALID_UNKNOWN_TIMING", path + ".reason", "unknown state requires a reason");
    }
    return;
  }
  if (value.state === "ABSENT") {
    if (value.reason !== undefined && !nonEmpty(value.reason)) {
      add(issues, "INVALID_ABSENT_TIMING", path + ".reason", "reason must be non-empty when supplied");
    }
    return;
  }
  if (value.state === "NOT_APPLICABLE") {
    if (!nonEmpty(value.reason)) {
      add(issues, "INVALID_NOT_APPLICABLE_TIMING", path + ".reason", "not-applicable state requires a reason");
    }
    return;
  }
  add(issues, "UNKNOWN_TIMING_VALUE_STATE", path + ".state", "unsupported timing state");
}

function validateAbsoluteTime(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_ABSOLUTE_TIME", path, "absolute time kind is required");
    return;
  }
  if (value.kind === "UTC") {
    if (!validUtc(value.at)) {
      add(issues, "INVALID_UTC_TIME", path + ".at", "must be valid ISO-8601 UTC ending in Z");
    }
    if (!validTimeZone(value.timeZone)) {
      add(issues, "INVALID_TIMEZONE", path + ".timeZone", "must be a canonical IANA timezone identifier");
    }
    return;
  }
  if (value.kind === "LOCAL") {
    if (!record(value.at)) {
      add(issues, "INVALID_LOCAL_TIME", path + ".at", "local business time is required");
      return;
    }
    if (!validLocalDateTime(value.at.localDateTime)) {
      add(
        issues,
        "INVALID_LOCAL_DATETIME",
        path + ".at.localDateTime",
        "must be an ISO local datetime without an offset",
      );
    }
    if (!validTimeZone(value.at.timeZone)) {
      add(issues, "INVALID_TIMEZONE", path + ".at.timeZone", "must be a canonical IANA timezone identifier");
    }
    return;
  }
  add(issues, "UNKNOWN_ABSOLUTE_TIME_KIND", path + ".kind", "unsupported absolute time kind");
}

function validateOffset(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
  requirePositive = false,
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_TEMPORAL_OFFSET", path, "offset kind is required");
    return;
  }
  const amount = Number(value.amount);
  if (!Number.isInteger(amount) || amount < 0 || (requirePositive && amount === 0)) {
    add(
      issues,
      "INVALID_TEMPORAL_OFFSET_AMOUNT",
      path + ".amount",
      requirePositive ? "must be an integer > 0" : "must be an integer >= 0",
    );
  }
  if (value.kind === "ELAPSED") {
    if (!["SECOND", "MINUTE", "HOUR"].includes(String(value.unit))) {
      add(issues, "INVALID_ELAPSED_UNIT", path + ".unit", "unsupported elapsed-time unit");
    }
    return;
  }
  if (value.kind === "CALENDAR") {
    if (!["DAY", "WEEK", "MONTH"].includes(String(value.unit))) {
      add(issues, "INVALID_CALENDAR_UNIT", path + ".unit", "unsupported calendar unit");
    }
    return;
  }
  add(issues, "UNKNOWN_TEMPORAL_OFFSET_KIND", path + ".kind", "unsupported offset kind");
}

function validateRequestedStart(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_REQUESTED_START", path, "requested start kind is required");
    return;
  }
  if (value.kind === "IMMEDIATE") return;
  if (value.kind === "ABSOLUTE") {
    validateAbsoluteTime(value.time, path + ".time", issues);
    return;
  }
  if (value.kind === "EVENT_RELATIVE") {
    if (!["AFTER_EVENT", "BEFORE_EVENT"].includes(String(value.relation))) {
      add(issues, "INVALID_EVENT_RELATION", path + ".relation", "unsupported event relation");
    }
    if (!nonEmpty(value.eventId)) add(issues, "INVALID_EVENT_ID", path + ".eventId", "event identity is required");
    validateOffset(value.offset, path + ".offset", issues);
    return;
  }
  if (value.kind === "TRIGGER_RELATIVE") {
    if (!nonEmpty(value.triggerId)) add(issues, "INVALID_TRIGGER_ID", path + ".triggerId", "trigger identity is required");
    return;
  }
  if (value.kind === "ACTION_RELATIVE") {
    if (
      ![
        "START_AFTER_ACTION_EFFECTIVE",
        "START_AFTER_ACTION_COMPLETED",
        "END_WHEN_ACTION_STARTS",
      ].includes(String(value.relation))
    ) {
      add(issues, "INVALID_ACTION_RELATION", path + ".relation", "unsupported Action timing relation");
    }
    if (!nonEmpty(value.actionId)) add(issues, "INVALID_ACTION_REFERENCE", path + ".actionId", "Action identity is required");
    if (value.offset !== undefined) validateOffset(value.offset, path + ".offset", issues);
    return;
  }
  add(issues, "UNKNOWN_REQUESTED_START_KIND", path + ".kind", "unsupported requested start kind");
}

function validateEffectiveStart(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_EFFECTIVE_START", path, "effective start kind is required");
    return;
  }
  if (value.kind === "DERIVE_FROM_REQUESTED_START") return;
  if (value.kind === "ABSOLUTE") {
    validateAbsoluteTime(value.time, path + ".time", issues);
    return;
  }
  if (value.kind === "EVENT_RELATIVE") {
    if (!["AFTER_EVENT", "BEFORE_EVENT"].includes(String(value.relation))) {
      add(issues, "INVALID_EVENT_RELATION", path + ".relation", "unsupported event relation");
    }
    if (!nonEmpty(value.eventId)) add(issues, "INVALID_EVENT_ID", path + ".eventId", "event identity is required");
    validateOffset(value.offset, path + ".offset", issues);
    return;
  }
  if (value.kind === "ACTION_RELATIVE") {
    if (!["START_AFTER_ACTION_EFFECTIVE", "START_AFTER_ACTION_COMPLETED"].includes(String(value.relation))) {
      add(issues, "INVALID_ACTION_RELATION", path + ".relation", "unsupported Action timing relation");
    }
    if (!nonEmpty(value.actionId)) add(issues, "INVALID_ACTION_REFERENCE", path + ".actionId", "Action identity is required");
    if (value.offset !== undefined) validateOffset(value.offset, path + ".offset", issues);
    return;
  }
  add(issues, "UNKNOWN_EFFECTIVE_START_KIND", path + ".kind", "unsupported effective start kind");
}

function validateDuration(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_TIMING_DURATION", path, "duration kind is required");
    return;
  }
  if (value.kind === "INSTANTANEOUS" || value.kind === "PERSISTENT") return;
  if (value.kind === "ELAPSED" || value.kind === "CALENDAR") {
    if (!Number.isInteger(value.amount) || Number(value.amount) <= 0) {
      add(issues, "INVALID_DURATION_AMOUNT", path + ".amount", "duration must be an integer > 0");
    }
    if (value.kind === "ELAPSED" && !["SECOND", "MINUTE", "HOUR"].includes(String(value.unit))) {
      add(issues, "INVALID_ELAPSED_UNIT", path + ".unit", "unsupported elapsed duration unit");
    }
    if (value.kind === "CALENDAR" && !["DAY", "WEEK", "MONTH"].includes(String(value.unit))) {
      add(issues, "INVALID_CALENDAR_UNIT", path + ".unit", "unsupported calendar duration unit");
    }
    if (!["DECISION_TIME", "REQUESTED_START", "EFFECTIVE_START"].includes(String(value.anchor))) {
      add(issues, "INVALID_DURATION_ANCHOR", path + ".anchor", "unsupported duration anchor");
    }
    return;
  }
  add(issues, "UNKNOWN_TIMING_DURATION_KIND", path + ".kind", "unsupported duration kind");
}

function validateEnd(value: unknown, path: string, issues: TimingValidationIssue[]): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_END_RULE", path, "end rule kind is required");
    return;
  }
  if (value.kind === "ABSOLUTE") {
    validateAbsoluteTime(value.time, path + ".time", issues);
    return;
  }
  if (value.kind !== "DERIVE_FROM_DURATION") {
    add(issues, "UNKNOWN_END_RULE_KIND", path + ".kind", "unsupported end rule kind");
  }
}

function validateTermination(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_TERMINATION_CONDITION", path, "termination condition kind is required");
    return;
  }
  if (value.kind === "STATE") {
    if (!record(value.condition) || !nonEmpty(value.condition.kind)) {
      add(issues, "INVALID_STATE_TERMINATION", path + ".condition", "typed state condition is required");
      return;
    }
    const condition = value.condition;
    if (condition.kind === "METRIC_THRESHOLD") {
      if (!nonEmpty(condition.metricId)) add(issues, "INVALID_METRIC_ID", path + ".condition.metricId", "metric identity is required");
      if (!["LT", "LTE", "EQ", "GTE", "GT"].includes(String(condition.operator))) {
        add(issues, "INVALID_THRESHOLD_OPERATOR", path + ".condition.operator", "unsupported threshold operator");
      }
      if (!Number.isFinite(condition.value)) add(issues, "INVALID_THRESHOLD_VALUE", path + ".condition.value", "must be finite");
      return;
    }
    if (condition.kind === "EVENT_OCCURS") {
      if (!nonEmpty(condition.eventId)) add(issues, "INVALID_EVENT_ID", path + ".condition.eventId", "event identity is required");
      return;
    }
    if (condition.kind === "ACTION_STARTS" || condition.kind === "ACTION_COMPLETES") {
      if (!nonEmpty(condition.actionId)) add(issues, "INVALID_ACTION_REFERENCE", path + ".condition.actionId", "Action identity is required");
      return;
    }
    add(issues, "UNKNOWN_STATE_TERMINATION", path + ".condition.kind", "unsupported state condition");
    return;
  }
  if (value.kind === "COMPOSITE") {
    if (!["FIRST_OF", "LAST_OF", "ALL_REQUIRED"].includes(String(value.operator))) {
      add(issues, "INVALID_TERMINATION_OPERATOR", path + ".operator", "unsupported composition operator");
    }
    if (!Array.isArray(value.conditions) || value.conditions.length < 2) {
      add(issues, "INVALID_TERMINATION_COMPOSITION", path + ".conditions", "composite termination requires at least two conditions");
      return;
    }
    value.conditions.forEach((entry: unknown, index: number) =>
      validateTermination(entry, path + ".conditions[" + index + "]", issues),
    );
    return;
  }
  add(issues, "UNKNOWN_TERMINATION_KIND", path + ".kind", "unsupported termination condition kind");
}

function validateRecurrenceBoundary(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_RECURRENCE_BOUNDARY", path, "boundary kind is required");
    return;
  }
  if (value.kind === "OPEN_ENDED") {
    if (value.explicitlyOpenEnded !== true) {
      add(issues, "ACCIDENTAL_OPEN_RECURRENCE", path + ".explicitlyOpenEnded", "open-ended recurrence must be explicit");
    }
    return;
  }
  if (value.kind === "BOUNDED") {
    if (value.recurrenceStart !== undefined) validateAbsoluteTime(value.recurrenceStart, path + ".recurrenceStart", issues);
    if (value.recurrenceEnd !== undefined) validateAbsoluteTime(value.recurrenceEnd, path + ".recurrenceEnd", issues);
    if (value.maxOccurrences !== undefined && (!Number.isInteger(value.maxOccurrences) || Number(value.maxOccurrences) <= 0)) {
      add(issues, "INVALID_MAX_OCCURRENCES", path + ".maxOccurrences", "must be an integer > 0");
    }
    if (value.recurrenceEnd === undefined && value.maxOccurrences === undefined) {
      add(issues, "UNBOUNDED_RECURRENCE", path, "bounded recurrence requires recurrenceEnd or maxOccurrences");
    }
    return;
  }
  add(issues, "UNKNOWN_RECURRENCE_BOUNDARY", path + ".kind", "unsupported recurrence boundary kind");
}

function validateRecurrence(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !record(value.frequency)) {
    add(issues, "INVALID_RECURRENCE", path, "recurrence frequency is required");
    return;
  }
  const frequency = value.frequency;
  if (!nonEmpty(frequency.kind)) {
    add(issues, "INVALID_RECURRENCE_FREQUENCY", path + ".frequency.kind", "frequency kind is required");
  } else if (frequency.kind === "DAILY") {
    if (!Number.isInteger(frequency.interval) || Number(frequency.interval) <= 0) add(issues, "INVALID_RECURRENCE_INTERVAL", path + ".frequency.interval", "must be an integer > 0");
  } else if (frequency.kind === "WEEKLY") {
    if (!Number.isInteger(frequency.interval) || Number(frequency.interval) <= 0) add(issues, "INVALID_RECURRENCE_INTERVAL", path + ".frequency.interval", "must be an integer > 0");
    if (!Array.isArray(frequency.daysOfWeek) || frequency.daysOfWeek.length === 0 || frequency.daysOfWeek.some((day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)) {
      add(issues, "INVALID_RECURRENCE_DAYS", path + ".frequency.daysOfWeek", "must contain integers 0 through 6");
    }
    if (!nonEmpty(frequency.localTime)) add(issues, "INVALID_RECURRENCE_LOCAL_TIME", path + ".frequency.localTime", "local time is required");
  } else if (frequency.kind === "MONTHLY") {
    if (!Number.isInteger(frequency.interval) || Number(frequency.interval) <= 0) add(issues, "INVALID_RECURRENCE_INTERVAL", path + ".frequency.interval", "must be an integer > 0");
    if (!Number.isInteger(frequency.dayOfMonth) || Number(frequency.dayOfMonth) < 1 || Number(frequency.dayOfMonth) > 31) add(issues, "INVALID_DAY_OF_MONTH", path + ".frequency.dayOfMonth", "must be 1 through 31");
    if (!nonEmpty(frequency.localTime)) add(issues, "INVALID_RECURRENCE_LOCAL_TIME", path + ".frequency.localTime", "local time is required");
  } else if (frequency.kind === "CUSTOM_INTERVAL") {
    validateOffset(frequency.every, path + ".frequency.every", issues, true);
  } else {
    add(issues, "UNKNOWN_RECURRENCE_FREQUENCY", path + ".frequency.kind", "unsupported recurrence frequency");
  }
  validateRecurrenceBoundary(value.boundary, path + ".boundary", issues);
}

function validateConstraints(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value)) {
    add(issues, "INVALID_TIMING_CONSTRAINTS", path, "constraints must be an object");
    return;
  }
  if (value.earliestStart !== undefined) validateAbsoluteTime(value.earliestStart, path + ".earliestStart", issues);
  if (value.latestStart !== undefined) validateAbsoluteTime(value.latestStart, path + ".latestStart", issues);
  if (value.minimumDuration !== undefined) validateDuration(value.minimumDuration, path + ".minimumDuration", issues);
  if (value.maximumDuration !== undefined) validateDuration(value.maximumDuration, path + ".maximumDuration", issues);
}

function validateDependency(
  value: unknown,
  path: string,
  issues: TimingValidationIssue[],
): void {
  if (!record(value) || !nonEmpty(value.kind)) {
    add(issues, "INVALID_TIMING_DEPENDENCY", path, "dependency kind is required");
    return;
  }
  if (!["START_AFTER_ACTION_EFFECTIVE", "START_AFTER_ACTION_COMPLETED", "END_WHEN_ACTION_STARTS"].includes(String(value.kind))) {
    add(issues, "UNKNOWN_TIMING_DEPENDENCY", path + ".kind", "unsupported dependency kind");
  }
  if (!nonEmpty(value.actionId)) add(issues, "INVALID_ACTION_REFERENCE", path + ".actionId", "Action identity is required");
  if (value.offset !== undefined) validateOffset(value.offset, path + ".offset", issues);
}

function specified<T>(value: TimingValue<T>): T | undefined {
  return value.state === "SPECIFIED" ? value.value : undefined;
}

function utcFromAbsolute(value: AbsoluteTime | undefined): number | undefined {
  if (!value || value.kind !== "UTC") return undefined;
  return Date.parse(value.at);
}

function elapsedMilliseconds(duration: TimingDuration | undefined): number | undefined {
  if (!duration || duration.kind !== "ELAPSED") return undefined;
  const factor = duration.unit === "SECOND" ? 1000 : duration.unit === "MINUTE" ? 60_000 : 3_600_000;
  return duration.amount * factor;
}

export function validateActionTiming(input: unknown): TimingValidationResult {
  const issues: TimingValidationIssue[] = [];
  if (!record(input)) {
    return { ok: false, issues: [{ code: "INVALID_ACTION_TIMING", path: "$", message: "ActionTiming must be an object" }] };
  }

  validateForbidden(input, "$", issues);

  if (input.schemaVersion !== ACTION_TIMING_SCHEMA_VERSION) {
    add(issues, "UNSUPPORTED_TIMING_SCHEMA_VERSION", "schemaVersion", "supported timing schema is " + ACTION_TIMING_SCHEMA_VERSION);
  }

  validateTimingValue(input.decisionTime, "decisionTime", issues, (value, path) => {
    if (!validUtc(value)) add(issues, "INVALID_DECISION_TIME", path, "must be a valid UTC timestamp");
  });
  validateTimingValue(input.requestedStart, "requestedStart", issues, (value, path) => validateRequestedStart(value, path, issues));
  validateTimingValue(input.implementationDelay, "implementationDelay", issues, (value, path) => validateOffset(value, path, issues));
  validateTimingValue(input.effectiveStart, "effectiveStart", issues, (value, path) => validateEffectiveStart(value, path, issues));
  validateTimingValue(input.duration, "duration", issues, (value, path) => validateDuration(value, path, issues));
  validateTimingValue(input.end, "end", issues, (value, path) => validateEnd(value, path, issues));
  validateTimingValue(input.terminationCondition, "terminationCondition", issues, (value, path) => validateTermination(value, path, issues));
  validateTimingValue(input.recurrence, "recurrence", issues, (value, path) => validateRecurrence(value, path, issues));
  validateTimingValue(input.timezone, "timezone", issues, (value, path) => {
    if (!validTimeZone(value)) add(issues, "INVALID_TIMEZONE", path, "must be a canonical IANA timezone identifier");
  });
  validateTimingValue(input.constraints, "constraints", issues, (value, path) => validateConstraints(value, path, issues));

  if (!Array.isArray(input.dependencies)) {
    add(issues, "INVALID_TIMING_DEPENDENCIES", "dependencies", "dependencies must be an array");
  } else {
    input.dependencies.forEach((entry: unknown, index: number) => validateDependency(entry, "dependencies[" + index + "]", issues));
  }

  if (
    record(input.duration) &&
    input.duration.state === "SPECIFIED" &&
    record(input.duration.value) &&
    input.duration.value.kind === "PERSISTENT" &&
    record(input.end) &&
    input.end.state === "SPECIFIED"
  ) {
    add(issues, "PERSISTENT_ACTION_HAS_END", "end", "persistent timing cannot also declare a fixed/derived end");
  }

  const duration = record(input.duration) && input.duration.state === "SPECIFIED"
    ? (input.duration.value as TimingDuration)
    : undefined;
  const end = record(input.end) && input.end.state === "SPECIFIED" && record(input.end.value)
    ? input.end.value
    : undefined;
  const effective = record(input.effectiveStart) && input.effectiveStart.state === "SPECIFIED" && record(input.effectiveStart.value)
    ? input.effectiveStart.value
    : undefined;

  if (
    duration &&
    end &&
    end.kind === "ABSOLUTE" &&
    effective &&
    effective.kind === "ABSOLUTE"
  ) {
    const effectiveMs = utcFromAbsolute(effective.time as AbsoluteTime);
    const endMs = utcFromAbsolute(end.time as AbsoluteTime);
    const durationMs = elapsedMilliseconds(duration);
    if (
      effectiveMs !== undefined &&
      endMs !== undefined &&
      durationMs !== undefined &&
      duration.anchor === "EFFECTIVE_START" &&
      endMs !== effectiveMs + durationMs
    ) {
      add(issues, "DURATION_END_MISMATCH", "end", "explicit end must agree with elapsed duration anchored at effective start");
    }
  }

  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

export interface TimingDependencyNode {
  readonly actionId: string;
  readonly dependencies: readonly TimingDependency[];
}

export function validateTimingDependencyGraph(
  nodes: readonly TimingDependencyNode[],
): TimingValidationResult {
  const issues: TimingValidationIssue[] = [];
  const adjacency = new Map<string, readonly string[]>();
  for (const node of nodes) {
    adjacency.set(node.actionId, node.dependencies.map((dependency) => dependency.actionId));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string, trail: readonly string[]): void {
    if (visiting.has(id)) {
      add(issues, "TEMPORAL_DEPENDENCY_CYCLE", "dependencies", "cycle detected: " + [...trail, id].join(" -> "));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (adjacency.has(next)) visit(next, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) visit(node.actionId, []);
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}
