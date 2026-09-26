import { Temporal } from "@js-temporal/polyfill";
import { utcTimestamp, type UtcTimestamp } from "../core/units.js";
import type {
  AbsoluteTime,
  ActionTiming,
  ActionTimingResolutionContext,
  TemporalOffset,
  TimingDuration,
  TimingResolution,
  TimingValue,
  TerminationCondition,
  ResolvedOccurrence,
} from "./types.js";
import {
  validateActionTiming,
  validateTimingDependencyGraph,
} from "./validation.js";
const specified = <T>(v: TimingValue<T>): T | undefined =>
  v.state === "SPECIFIED" ? v.value : undefined;
const stamp = (i: Temporal.Instant): UtcTimestamp =>
  utcTimestamp(i.toString({ smallestUnit: "millisecond" }));
export function resolveActionTiming(
  timing: ActionTiming,
  context: ActionTimingResolutionContext,
): TimingResolution {
  const missing: string[] = [],
    unresolved: string[] = [],
    codes: string[] = [];
  let requested: UtcTimestamp | undefined,
    effective: UtcTimestamp | undefined,
    end: UtcTimestamp | undefined;
  const occurrences: ResolvedOccurrence[] = [];
  const validation = validateActionTiming(timing);
  const result = (): TimingResolution => ({
    timingSchemaVersion: timing.schemaVersion,
    status: codes.length
      ? "INVALID"
      : missing.length || unresolved.length
        ? "UNRESOLVED"
        : "VALID",
    ...(requested ? { resolvedRequestedStart: requested } : {}),
    ...(effective ? { resolvedEffectiveStart: effective } : {}),
    ...(end ? { resolvedEnd: end } : {}),
    occurrences:
      codes.length || missing.length || unresolved.length ? [] : occurrences,
    unresolvedDependencies: unresolved,
    missingContext: missing,
    validationCodes: codes,
    provenance: [
      "action-timing-validator@1.0.0",
      "action-timing-resolver@1.0.0",
    ],
  });
  if (!validation.ok) {
    codes.push(...validation.issues.map((i) => i.code));
    return result();
  }
  const graph = [
    ...(context.dependencyGraph ?? []).filter(
      (node) => node.actionId !== context.actionId,
    ),
    ...(context.actionId
      ? [
          {
            actionId: context.actionId,
            dependencies: [
              ...timing.dependencies,
              ...(context.dependencyGraph?.find(
                (node) => node.actionId === context.actionId,
              )?.dependencies ?? []),
            ],
            timing,
          },
        ]
      : []),
  ];
  const graphValidation = validateTimingDependencyGraph(graph);
  if (!graphValidation.ok) {
    codes.push(...graphValidation.issues.map((i) => i.code));
    return result();
  }
  const zone = specified(timing.timezone);
  const disambiguation = context.disambiguation ?? "reject";
  const utc = (s: string): UtcTimestamp => {
    if (!s.endsWith("Z")) throw Error("INVALID_RUNTIME_TIMESTAMP");
    return stamp(Temporal.Instant.from(s));
  };
  const absolute = (a: AbsoluteTime): UtcTimestamp =>
    a.kind === "UTC"
      ? utc(a.at)
      : stamp(
          Temporal.PlainDateTime.from(a.at.localDateTime)
            .toZonedDateTime(a.at.timeZone, { disambiguation })
            .toInstant(),
        );
  const offset = (
    base: UtcTimestamp | undefined,
    o: TemporalOffset | undefined,
    sign = 1,
  ): UtcTimestamp | undefined => {
    if (!base || !o) return base;
    const i = Temporal.Instant.from(base);
    const amount = o.amount * sign;
    if (o.kind === "ELAPSED")
      return stamp(
        i.add({
          seconds:
            amount *
            (o.unit === "SECOND" ? 1 : o.unit === "MINUTE" ? 60 : 3600),
        }),
      );
    if (!zone) {
      missing.push("TIMEZONE_REQUIRED");
      return undefined;
    }
    const z = i.toZonedDateTimeISO(zone);
    const p = z
      .toPlainDateTime()
      .add(
        o.unit === "DAY"
          ? { days: amount }
          : o.unit === "WEEK"
            ? { weeks: amount }
            : { months: amount },
        { overflow: "constrain" },
      );
    return stamp(p.toZonedDateTime(zone, { disambiguation }).toInstant());
  };
  const later = (a: UtcTimestamp | undefined, b: UtcTimestamp | undefined) =>
    !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;
  const earlier = (a: UtcTimestamp | undefined, b: UtcTimestamp | undefined) =>
    !a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b;
  const evidence = (at: UtcTimestamp | undefined, key: string) => {
    if (!at) unresolved.push(key);
    return at;
  };
  const start = (v: any): UtcTimestamp | undefined => {
    if (v.kind === "IMMEDIATE") return utc(context.approvedClock);
    if (v.kind === "ABSOLUTE") return absolute(v.time);
    if (v.kind === "TRIGGER_RELATIVE")
      return evidence(
        context.triggerTimes?.[v.triggerId],
        "TRIGGER_NOT_YET_SATISFIED:" + v.triggerId,
      );
    if (v.kind === "EVENT_RELATIVE")
      return offset(
        evidence(
          context.eventTimes?.[v.eventId],
          "EVENT_NOT_YET_OBSERVED:" + v.eventId,
        ),
        v.offset,
        v.relation === "BEFORE_EVENT" ? -1 : 1,
      );
    if (v.kind === "ACTION_RELATIVE")
      return offset(
        evidence(
          v.relation === "START_AFTER_ACTION_COMPLETED"
            ? context.actionTimes?.[v.actionId]?.completedAt
            : context.actionTimes?.[v.actionId]?.effectiveStart,
          "ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + v.actionId,
        ),
        v.offset,
      );
    return undefined;
  };
  const durationEnd = (
    d: TimingDuration | undefined,
    req: UtcTimestamp | undefined,
    eff: UtcTimestamp | undefined,
  ): UtcTimestamp | undefined => {
    if (!d || d.kind === "PERSISTENT") return undefined;
    if (d.kind === "INSTANTANEOUS") return eff;
    const base =
      d.anchor === "DECISION_TIME"
        ? specified(timing.decisionTime)
        : d.anchor === "REQUESTED_START"
          ? req
          : eff;
    if (!base) missing.push("DURATION_ANCHOR_REQUIRED");
    return offset(base, d);
  };
  const terminate = (t: TerminationCondition): UtcTimestamp | undefined => {
    if (t.kind === "COMPOSITE") {
      const missingBefore = missing.length;
      const unresolvedBefore = unresolved.length;
      const ends = t.conditions.map(terminate);
      if (
        t.operator === "FIRST_OF" &&
        ends.some(
          (at) => at && Date.parse(at) <= Date.parse(context.approvedClock),
        )
      ) {
        // Observed evidence is the authoritative as-of-clock record. An observed
        // alternative conclusively terminates FIRST_OF; unobserved alternatives
        // cannot postpone it. The earliest observed hit is the resolved end.
        missing.splice(missingBefore);
        unresolved.splice(unresolvedBefore);
        return ends.reduce(earlier);
      }
      if (ends.some((x) => !x)) return undefined;
      return ends.reduce((a, b) =>
        t.operator === "FIRST_OF" ? earlier(a, b) : later(a, b),
      );
    }
    const c = t.condition;
    if (c.kind === "EVENT_OCCURS")
      return evidence(
        context.eventTimes?.[c.eventId],
        "TERMINATION_EVENT_UNRESOLVED:" + c.eventId,
      );
    if (c.kind === "ACTION_STARTS" || c.kind === "ACTION_COMPLETES")
      return evidence(
        c.kind === "ACTION_STARTS"
          ? context.actionTimes?.[c.actionId]?.effectiveStart
          : context.actionTimes?.[c.actionId]?.completedAt,
        "TERMINATION_ACTION_UNRESOLVED:" + c.actionId,
      );
    const obs = context.metricObservations?.[c.metricId];
    if (!obs || (c.unit !== undefined && obs.unit !== c.unit)) {
      missing.push("TERMINATION_METRIC_EVIDENCE_REQUIRED:" + c.metricId);
      return undefined;
    }
    const hit =
      c.operator === "LT"
        ? obs.value < c.value
        : c.operator === "LTE"
          ? obs.value <= c.value
          : c.operator === "EQ"
            ? obs.value === c.value
            : c.operator === "GTE"
              ? obs.value >= c.value
              : obs.value > c.value;
    if (!hit) {
      unresolved.push("TERMINATION_NOT_REACHED:" + c.metricId);
      return undefined;
    }
    return obs.observedAt;
  };
  try {
    utc(context.approvedClock);
    const observed = (at: string) => {
      utc(at);
      if (Date.parse(at) > Date.parse(context.approvedClock))
        throw Error("FUTURE_RUNTIME_EVIDENCE");
    };
    for (const map of [context.eventTimes, context.triggerTimes])
      for (const at of Object.values(map ?? {})) observed(at);
    for (const action of Object.values(context.actionTimes ?? {}))
      for (const at of Object.values(action)) if (at !== undefined) utc(at);
    for (const action of Object.values(context.actionTimes ?? {}))
      if (action.completedAt) observed(action.completedAt);
    for (const obs of Object.values(context.metricObservations ?? {})) {
      observed(obs.observedAt);
      if (!Number.isFinite(obs.value))
        throw Error("INVALID_METRIC_OBSERVATION");
    }
    if (context.horizonEnd) utc(context.horizonEnd);
    if (
      context.maxOccurrences !== undefined &&
      (!Number.isInteger(context.maxOccurrences) ||
        context.maxOccurrences <= 0 ||
        context.maxOccurrences > 10000)
    )
      throw Error("INVALID_OCCURRENCE_CAP");
    for (const [key, v] of Object.entries(timing))
      if (v && typeof v === "object" && "state" in v && v.state === "UNKNOWN")
        unresolved.push("TIMING_VALUE_UNKNOWN:" + key);
    const req = specified(timing.requestedStart);
    if (req) requested = start(req);
    else missing.push("REQUESTED_START_REQUIRED");
    let requestedLowerBound: UtcTimestamp | undefined;
    for (const dep of timing.dependencies) {
      if (dep.kind !== "START_AFTER") continue;
      requestedLowerBound = later(
        requestedLowerBound,
        offset(
          evidence(
            context.actionTimes?.[dep.actionId]?.requestedStart ??
              context.actionTimes?.[dep.actionId]?.effectiveStart,
            "ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + dep.actionId,
          ),
          dep.offset,
        ),
      );
    }
    if (
      req?.kind === "ABSOLUTE" &&
      requested &&
      requestedLowerBound &&
      Date.parse(requested) < Date.parse(requestedLowerBound)
    )
      codes.push("REQUESTED_START_DEPENDENCY_CONFLICT");
    else requested = later(requested, requestedLowerBound);
    const eff = specified(timing.effectiveStart);
    effective =
      eff?.kind === "DERIVE_FROM_REQUESTED_START"
        ? offset(requested, specified(timing.implementationDelay))
        : eff
          ? start(eff)
          : undefined;
    if (!eff) missing.push("EFFECTIVE_START_REQUIRED");
    let effectiveLowerBound: UtcTimestamp | undefined;
    for (const dep of timing.dependencies) {
      const a = context.actionTimes?.[dep.actionId];
      if (
        [
          "EFFECTIVE_AFTER",
          "START_AFTER_ACTION_EFFECTIVE",
          "START_AFTER_ACTION_COMPLETED",
        ].includes(dep.kind)
      ) {
        effectiveLowerBound = later(
          effectiveLowerBound,
          offset(
            evidence(
              dep.kind === "START_AFTER_ACTION_COMPLETED"
                ? a?.completedAt
                : a?.effectiveStart,
              "ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + dep.actionId,
            ),
            "offset" in dep ? dep.offset : undefined,
          ),
        );
      }
    }
    if (
      eff?.kind === "ABSOLUTE" &&
      effective &&
      effectiveLowerBound &&
      Date.parse(effective) < Date.parse(effectiveLowerBound)
    )
      codes.push("EFFECTIVE_START_DEPENDENCY_CONFLICT");
    else effective = later(effective, effectiveLowerBound);
    const minimumEffective = offset(
      requested,
      specified(timing.implementationDelay),
    );
    if (
      effective &&
      minimumEffective &&
      Date.parse(effective) < Date.parse(minimumEffective)
    )
      codes.push("EFFECTIVE_START_BEFORE_REQUESTED_WITH_DELAY");
    const d = specified(timing.duration),
      e = specified(timing.end),
      calculated = durationEnd(d, requested, effective);
    end = e?.kind === "ABSOLUTE" ? absolute(e.time) : calculated;
    if (e?.kind === "DERIVE_FROM_DURATION" && !d)
      missing.push("DURATION_REQUIRED");
    if (e?.kind === "ABSOLUTE" && calculated && calculated !== end)
      codes.push("DURATION_END_MISMATCH");
    const term = specified(timing.terminationCondition);
    if (term) end = earlier(end, terminate(term));
    // End rules and durations fix an end; COMPLETE_AFTER is a lower bound,
    // while END_WITH is an equality. Accumulate before solving so ordering
    // never overwrites a previously satisfied constraint.
    const fixedEnd = end;
    let endLowerBound: UtcTimestamp | undefined;
    const endEqualities: UtcTimestamp[] = [];
    for (const dep of timing.dependencies) {
      const a = context.actionTimes?.[dep.actionId];
      if (dep.kind === "COMPLETE_AFTER")
        endLowerBound = later(
          endLowerBound,
          offset(
            evidence(
              a?.completedAt,
              "ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + dep.actionId,
            ),
            dep.offset,
          ),
        );
      if (dep.kind === "END_WITH" || dep.kind === "END_WHEN_ACTION_STARTS") {
        const equality = offset(
          evidence(
            dep.kind === "END_WITH"
              ? (a?.end ?? a?.completedAt)
              : a?.effectiveStart,
            "ACTION_TIMING_DEPENDENCY_UNRESOLVED:" + dep.actionId,
          ),
          "offset" in dep ? dep.offset : undefined,
        );
        if (equality) endEqualities.push(equality);
      }
    }
    const equalityEnd = endEqualities.reduce<UtcTimestamp | undefined>(
      earlier,
      undefined,
    );
    end = fixedEnd ?? equalityEnd ?? endLowerBound;
    if (
      (end &&
        endEqualities.some((at) => Date.parse(at) !== Date.parse(end!))) ||
      (end && endLowerBound && Date.parse(end) < Date.parse(endLowerBound))
    )
      codes.push("END_DEPENDENCY_CONFLICT");
    const constraints = specified(timing.constraints);
    if (constraints && effective) {
      if (
        constraints.earliestStart &&
        Date.parse(effective) < Date.parse(absolute(constraints.earliestStart))
      )
        codes.push("EARLIEST_START_VIOLATION");
      if (
        constraints.latestStart &&
        Date.parse(effective) > Date.parse(absolute(constraints.latestStart))
      )
        codes.push("LATEST_START_VIOLATION");
      for (const [key, dur] of [
        ["minimumDuration", constraints.minimumDuration],
        ["maximumDuration", constraints.maximumDuration],
      ] as const) {
        if (!dur) continue;
        const bound = durationEnd(dur, requested, effective);
        if (!bound || !end)
          missing.push("DURATION_CONSTRAINT_UNRESOLVED:" + key);
        else if (
          key === "minimumDuration"
            ? Date.parse(end) < Date.parse(bound)
            : Date.parse(end) > Date.parse(bound)
        )
          codes.push("DURATION_CONSTRAINT_VIOLATION");
      }
    }
    if (end && effective && Date.parse(end) < Date.parse(effective))
      codes.push("END_BEFORE_EFFECTIVE_START");
    const recurrence = specified(timing.recurrence);
    if (recurrence && effective) {
      if (!context.actionId) missing.push("ORIGINATING_ACTION_ID_REQUIRED");
      if (!zone) missing.push("TIMEZONE_REQUIRED");
      const b = recurrence.boundary,
        f = recurrence.frequency;
      if (
        b.kind === "OPEN_ENDED" &&
        !context.maxOccurrences &&
        !context.horizonEnd
      )
        missing.push("RECURRENCE_HORIZON_OR_CAP_REQUIRED");
      if (
        zone &&
        context.actionId &&
        (b.kind === "BOUNDED" || context.maxOccurrences || context.horizonEnd)
      ) {
        const begin =
          b.kind === "BOUNDED" && b.recurrenceStart
            ? later(effective, absolute(b.recurrenceStart))!
            : effective;
        // A per-occurrence duration is not a series boundary. Explicit Action
        // ends, termination, and end dependencies do bound the whole series.
        const hasSeriesEnd =
          (e && (e.kind === "ABSOLUTE" || d?.kind !== "INSTANTANEOUS")) ||
          term ||
          timing.dependencies.some((dep) =>
            ["END_WITH", "END_WHEN_ACTION_STARTS", "COMPLETE_AFTER"].includes(
              dep.kind,
            ),
          );
        const businessStop = earlier(
          b.kind === "BOUNDED" && b.recurrenceEnd
            ? absolute(b.recurrenceEnd)
            : undefined,
          hasSeriesEnd ? end : undefined,
        );
        if (businessStop && Date.parse(businessStop) < Date.parse(begin))
          codes.push("RECURRENCE_END_BEFORE_START");
        const canonicalCount =
          b.kind === "BOUNDED" ? (b.maxOccurrences ?? Infinity) : Infinity;
        const count = Math.min(
          canonicalCount,
          context.maxOccurrences ?? 10000,
          10000,
        );
        const origin = Temporal.Instant.from(begin)
          .toZonedDateTimeISO(zone)
          .toPlainDateTime();
        let candidate = origin;
        let exhausted = true;
        for (let n = 0; n < 10000; n++) {
          let intervalInstant: UtcTimestamp | undefined;
          if (f.kind === "CUSTOM_INTERVAL") {
            const at = offset(begin, {
              ...f.every,
              amount: f.every.amount * n,
            });
            if (!at) break;
            intervalInstant = at;
            candidate = Temporal.Instant.from(at)
              .toZonedDateTimeISO(zone)
              .toPlainDateTime();
          } else if (f.kind === "MONTHLY")
            candidate = origin
              .with({ day: 1 })
              .add({ months: n * f.interval })
              .with({ day: f.dayOfMonth }, { overflow: "constrain" })
              .withPlainTime(Temporal.PlainTime.from(f.localTime));
          else {
            candidate = origin.add({
              days: f.kind === "DAILY" ? n * f.interval : n,
            });
            if (f.localTime)
              candidate = candidate.withPlainTime(
                Temporal.PlainTime.from(f.localTime),
              );
          }
          if (
            f.kind === "WEEKLY" &&
            (!f.daysOfWeek.includes(candidate.dayOfWeek % 7) ||
              Math.floor(
                origin.toPlainDate().until(candidate.toPlainDate()).days / 7,
              ) %
                f.interval !==
                0)
          )
            continue;
          const at =
            intervalInstant ??
            stamp(
              candidate.toZonedDateTime(zone, { disambiguation }).toInstant(),
            );
          if (businessStop && Date.parse(at) > Date.parse(businessStop)) {
            exhausted = false;
            break;
          }
          if (Date.parse(at) < Date.parse(begin)) continue;
          if (
            (context.horizonEnd &&
              Date.parse(at) > Date.parse(context.horizonEnd)) ||
            occurrences.length >= count
          ) {
            if (b.kind === "BOUNDED" && occurrences.length < canonicalCount)
              missing.push("RECURRENCE_PARTIAL_EXPANSION");
            exhausted = false;
            break;
          }
          const occurrenceEnd = earlier(
            durationEnd(d, at, at),
            hasSeriesEnd ? end : undefined,
          );
          occurrences.push({
            actionId: context.actionId,
            occurrenceIndex: occurrences.length,
            effectiveStart: at,
            ...(occurrenceEnd ? { end: occurrenceEnd } : {}),
          });
          if (
            occurrences.length === canonicalCount ||
            (b.kind === "OPEN_ENDED" && occurrences.length === count)
          ) {
            exhausted = false;
            break;
          }
        }
        if (exhausted) missing.push("RECURRENCE_EXPANSION_LIMIT");
      }
    }
  } catch (error) {
    codes.push(
      error instanceof RangeError
        ? "INVALID_OR_AMBIGUOUS_TEMPORAL_VALUE"
        : error instanceof Error
          ? error.message
          : "INVALID_TEMPORAL_CONTEXT",
    );
  }
  return result();
}
