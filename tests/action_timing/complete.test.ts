import { describe, it, expect } from "vitest";
import {
  resolveActionTiming,
  validateActionTiming,
  validateTimingDependencyGraph,
} from "../../src/action_timing/index.js";
import {
  immediatePersistentBudgetTiming as base,
  weeklyEightWeekLifecycleTiming as weekly,
} from "../../src/action_timing/fixtures.js";
const clock = "2026-10-27T14:00:00.000Z" as any;
const s = (value: any): any => ({ state: "SPECIFIED", value });
const local = (at: string): any =>
  s({
    kind: "ABSOLUTE",
    time: {
      kind: "LOCAL",
      at: { localDateTime: at, timeZone: "America/Toronto" },
    },
  });
describe("complete temporal semantics", () => {
  it("rejects unknown nested fields and leakage", () => {
    expect(
      validateActionTiming({
        ...base,
        requestedStart: s({ kind: "IMMEDIATE", extra: 1 }),
      }).ok,
    ).toBe(false);
    expect(validateActionTiming({ ...base, confidenceScore: 1 }).ok).toBe(
      false,
    );
  });
  it("resolves calendar day across DST and month end", () => {
    const t = {
      ...base,
      requestedStart: local("2026-10-31T10:00"),
      duration: s({
        kind: "CALENDAR",
        amount: 1,
        unit: "DAY",
        anchor: "EFFECTIVE_START",
      }),
    };
    expect(resolveActionTiming(t, { approvedClock: clock }).resolvedEnd).toBe(
      "2026-11-01T15:00:00.000Z",
    );
    expect(
      resolveActionTiming(
        {
          ...t,
          requestedStart: local("2026-01-31T10:00"),
          duration: s({
            kind: "CALENDAR",
            amount: 1,
            unit: "MONTH",
            anchor: "EFFECTIVE_START",
          }),
        },
        { approvedClock: clock },
      ).resolvedEnd,
    ).toBe("2026-02-28T15:00:00.000Z");
  });
  it("rejects ambiguous/nonexistent local times", () => {
    for (const at of ["2026-11-01T01:30", "2026-03-08T02:30"])
      expect(
        resolveActionTiming(
          { ...base, requestedStart: local(at) },
          { approvedClock: clock },
        ).status,
      ).toBe("INVALID");
  });
  it("expands weekly recurrence preserving local clock and action identity", () => {
    const r = resolveActionTiming(
      { ...weekly, requestedStart: local("2026-10-27T10:00") },
      { approvedClock: clock, actionId: "A" } as any,
    );
    expect(r.status).toBe("VALID");
    expect(r.occurrences).toHaveLength(8);
    expect(r.occurrences[1]).toMatchObject({
      actionId: "A",
      effectiveStart: "2026-11-03T15:00:00.000Z",
    });
  });
  it("fails closed for unknown fields and bad runtime timestamps", () => {
    expect(
      resolveActionTiming(
        { ...base, duration: { state: "UNKNOWN", reason: "unknown" } },
        { approvedClock: clock },
      ).status,
    ).toBe("UNRESOLVED");
    expect(
      resolveActionTiming(base, { approvedClock: "invalid" as any }).status,
    ).toBe("INVALID");
  });
  it("applies dependencies and detects embedded cycles", () => {
    const r = resolveActionTiming(
      {
        ...base,
        dependencies: [{ kind: "EFFECTIVE_AFTER", actionId: "B" }] as any,
      },
      {
        approvedClock: clock,
        actionTimes: {
          B: { effectiveStart: "2026-11-01T15:00:00.000Z" as any },
        },
      },
    );
    expect(r.resolvedEffectiveStart).toBe("2026-11-01T15:00:00.000Z");
    expect(
      validateTimingDependencyGraph([
        {
          actionId: "A",
          dependencies: [],
          timing: {
            ...base,
            requestedStart: s({
              kind: "ACTION_RELATIVE",
              relation: "START_AFTER_ACTION_COMPLETED",
              actionId: "B",
            }),
          },
        },
        {
          actionId: "B",
          dependencies: [
            { kind: "START_AFTER_ACTION_COMPLETED", actionId: "A" },
          ],
        },
      ] as any).ok,
    ).toBe(false);
  });
  it("enforces resolved constraints and termination evidence", () => {
    expect(
      resolveActionTiming(
        {
          ...base,
          constraints: s({
            latestStart: {
              kind: "UTC",
              at: "2020-01-01T00:00:00Z",
              timeZone: "UTC",
            },
          }),
        },
        { approvedClock: clock },
      ).status,
    ).toBe("INVALID");
    expect(
      resolveActionTiming(
        {
          ...base,
          terminationCondition: s({
            kind: "STATE",
            condition: { kind: "EVENT_OCCURS", eventId: "stop" },
          }),
        },
        { approvedClock: clock },
      ).status,
    ).toBe("UNRESOLVED");
  });
});

describe("temporal guard edge cases", () => {
  it("requires bounded expansion for an open series", () => {
    const t = {
      ...weekly,
      recurrence: s({
        frequency: { kind: "DAILY", interval: 1 },
        boundary: { kind: "OPEN_ENDED", explicitlyOpenEnded: true },
      }),
    };
    expect(
      resolveActionTiming(t, { approvedClock: clock, actionId: "A" }).status,
    ).toBe("UNRESOLVED");
    expect(
      resolveActionTiming(t, {
        approvedClock: clock,
        actionId: "A",
        maxOccurrences: 3,
      }).occurrences,
    ).toHaveLength(3);
  });
  it("resolves event termination and complete/end dependency semantics", () => {
    const t = {
      ...base,
      terminationCondition: s({
        kind: "STATE",
        condition: { kind: "EVENT_OCCURS", eventId: "stop" },
      }),
    };
    expect(
      resolveActionTiming(t, {
        approvedClock: clock,
        eventTimes: { stop: clock },
      }).resolvedEnd,
    ).toBe(clock);
    for (const kind of ["COMPLETE_AFTER", "END_WITH"])
      expect(
        resolveActionTiming(
          { ...base, dependencies: [{ kind, actionId: "B" }] as any },
          { approvedClock: clock, actionTimes: { B: { completedAt: clock } } },
        ).resolvedEnd,
      ).toBe(clock);
  });
  it("rejects offset-only extra anchor and invalid UTC calendar dates", () => {
    expect(
      validateActionTiming({
        ...base,
        implementationDelay: s({
          kind: "ELAPSED",
          amount: 1,
          unit: "HOUR",
          anchor: "EFFECTIVE_START",
        }),
      }).ok,
    ).toBe(false);
    expect(
      validateActionTiming({ ...base, decisionTime: s("2026-02-30T00:00:00Z") })
        .ok,
    ).toBe(false);
  });
  it("rejects self reference during runtime resolution", () => {
    expect(
      resolveActionTiming(
        { ...base, dependencies: [{ kind: "END_WITH", actionId: "A" }] },
        {
          approvedClock: clock,
          actionId: "A",
          actionTimes: { A: { end: clock } },
        },
      ).status,
    ).toBe("INVALID");
  });
  it("does not misreport very sparse truncated series as complete", () => {
    expect(
      resolveActionTiming(
        {
          ...weekly,
          recurrence: s({
            frequency: {
              kind: "WEEKLY",
              interval: 100000,
              daysOfWeek: [2],
              localTime: "10:00",
            },
            boundary: { kind: "BOUNDED", maxOccurrences: 2 },
          }),
        },
        { approvedClock: clock, actionId: "A" },
      ).status,
    ).toBe("UNRESOLVED");
  });
});

it("rejects future observed evidence and context graph cycles", () => {
  expect(
    resolveActionTiming(base, {
      approvedClock: clock,
      eventTimes: { future: "2027-01-01T00:00:00Z" as any },
    }).status,
  ).toBe("INVALID");
  expect(
    resolveActionTiming(base, {
      approvedClock: clock,
      actionId: "A",
      dependencyGraph: [
        { actionId: "A", dependencies: [{ kind: "END_WITH", actionId: "B" }] },
        { actionId: "B", dependencies: [{ kind: "END_WITH", actionId: "A" }] },
      ],
    } as any).status,
  ).toBe("INVALID");
});
import { serializeActionTiming } from "../../src/action_timing/canonical.js";
it("guards canonical serialization and cannot silently truncate bounded recurrence", () => {
  expect(() => serializeActionTiming({ ...base, extra: 1 } as any)).toThrow();
  expect(
    resolveActionTiming(weekly, {
      approvedClock: clock,
      actionId: "A",
      maxOccurrences: 2,
    }).status,
  ).toBe("UNRESOLVED");
});
it("rejects end relation misused as a requested start", () => {
  expect(
    resolveActionTiming(
      {
        ...base,
        requestedStart: s({
          kind: "ACTION_RELATIVE",
          relation: "END_WHEN_ACTION_STARTS",
          actionId: "B",
        }),
      },
      { approvedClock: clock, actionTimes: { B: { effectiveStart: clock } } },
    ).status,
  ).toBe("INVALID");
});
it("rejects reversed recurrence boundaries", () => {
  expect(
    resolveActionTiming(
      {
        ...weekly,
        recurrence: s({
          frequency: { kind: "DAILY", interval: 1 },
          boundary: {
            kind: "BOUNDED",
            recurrenceStart: {
              kind: "UTC",
              at: "2026-11-01T00:00:00Z",
              timeZone: "UTC",
            },
            recurrenceEnd: {
              kind: "UTC",
              at: "2026-10-01T00:00:00Z",
              timeZone: "UTC",
            },
          },
        }),
      },
      { approvedClock: clock, actionId: "A" },
    ).status,
  ).toBe("INVALID");
});
it("does not relocalize elapsed recurrence through an ambiguous clock", () => {
  const r = resolveActionTiming(
    {
      ...weekly,
      requestedStart: s({
        kind: "ABSOLUTE",
        time: {
          kind: "UTC",
          at: "2026-11-01T05:30:00Z",
          timeZone: "America/Toronto",
        },
      }),
      recurrence: s({
        frequency: {
          kind: "CUSTOM_INTERVAL",
          every: { kind: "ELAPSED", amount: 1, unit: "HOUR" },
        },
        boundary: { kind: "BOUNDED", maxOccurrences: 2 },
      }),
    },
    { approvedClock: clock, actionId: "A" },
  );
  expect(r.status).toBe("VALID");
  expect(r.occurrences.map((o) => o.effectiveStart)).toEqual([
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]);
});
it("marks a bounded series cut short by a runtime horizon unresolved", () => {
  expect(
    resolveActionTiming(weekly, {
      approvedClock: clock,
      actionId: "A",
      horizonEnd: "2026-09-23T00:00:00Z" as any,
    }).status,
  ).toBe("UNRESOLVED");
});
describe("review regressions", () => {
  const at = (day: string): any => ({
    kind: "UTC",
    at: `2026-09-${day}T14:00:00.000Z`,
    timeZone: "America/Toronto",
  });
  const recurring: any = {
    ...weekly,
    requestedStart: s({ kind: "ABSOLUTE", time: at("26") }),
    duration: { state: "ABSENT" },
    recurrence: s({
      frequency: { kind: "DAILY", interval: 1 },
      boundary: { kind: "BOUNDED", maxOccurrences: 4 },
    }),
  };
  it("stops occurrences at explicit, termination and dependency ends", () => {
    for (const patch of [
      { end: s({ kind: "ABSOLUTE", time: at("27") }) },
      {
        terminationCondition: s({
          kind: "STATE",
          condition: { kind: "EVENT_OCCURS", eventId: "stop" },
        }),
      },
      { dependencies: [{ kind: "END_WITH", actionId: "B" }] },
    ]) {
      const r = resolveActionTiming(
        { ...recurring, ...patch },
        {
          approvedClock: clock,
          actionId: "A",
          eventTimes: { stop: at("27").at },
          actionTimes: { B: { end: at("27").at } },
        },
      );
      expect(r.status).toBe("VALID");
      expect(r.occurrences.map((o) => o.effectiveStart)).toEqual([
        at("26").at,
        at("27").at,
      ]);
    }
  });
  it("does not claim cap truncation when a date boundary completes the series", () => {
    const r = resolveActionTiming(
      {
        ...recurring,
        recurrence: s({
          frequency: { kind: "DAILY", interval: 1 },
          boundary: { kind: "BOUNDED", recurrenceEnd: at("27") },
        }),
      },
      { approvedClock: clock, actionId: "A", maxOccurrences: 10 },
    );
    expect(r.status).toBe("VALID");
    expect(r.occurrences).toHaveLength(2);
  });
  it("FIRST_OF resolves an observed alternative without waiting for the others", () => {
    const r = resolveActionTiming(
      {
        ...base,
        terminationCondition: s({
          kind: "COMPOSITE",
          operator: "FIRST_OF",
          conditions: [
            {
              kind: "STATE",
              condition: { kind: "EVENT_OCCURS", eventId: "X" },
            },
            {
              kind: "STATE",
              condition: { kind: "EVENT_OCCURS", eventId: "Y" },
            },
          ],
        }),
      },
      { approvedClock: clock, eventTimes: { X: clock } },
    );
    expect(r.status).toBe("VALID");
    expect(r.resolvedEnd).toBe(clock);
    expect(r.unresolvedDependencies).toEqual([]);
  });
  it.each(["2", false, null])("rejects coerced offset amount %s", (amount) => {
    expect(
      validateActionTiming({
        ...base,
        implementationDelay: s({ kind: "ELAPSED", unit: "HOUR", amount }),
      }).ok,
    ).toBe(false);
  });
});
describe("dependency constraint review regressions", () => {
  const ctx: any = {
    approvedClock: "2026-10-01T00:00:00Z",
    actionTimes: {
      B: { end: "2026-09-27T00:00:00Z" },
      C: { completedAt: "2026-09-29T00:00:00Z" },
    },
  };
  const early: any = {
    ...base,
    requestedStart: s({
      kind: "ABSOLUTE",
      time: { kind: "UTC", at: "2026-09-26T00:00:00Z", timeZone: "UTC" },
    }),
  };
  it("rejects incompatible equality and lower bounds in either order", () => {
    const deps: any = [
      { kind: "COMPLETE_AFTER", actionId: "C" },
      { kind: "END_WITH", actionId: "B" },
    ];
    const a = resolveActionTiming({ ...early, dependencies: deps }, ctx);
    const b = resolveActionTiming(
      { ...early, dependencies: [...deps].reverse() },
      ctx,
    );
    expect(a.status).toBe("INVALID");
    expect(b).toEqual(a);
  });
  it("rejects completion lower bounds conflicting with explicit end, duration or termination", () => {
    for (const patch of [
      {
        duration: { state: "ABSENT" },
        end: s({
          kind: "ABSOLUTE",
          time: { kind: "UTC", at: "2026-09-27T00:00:00Z", timeZone: "UTC" },
        }),
      },
      {
        duration: s({
          kind: "ELAPSED",
          unit: "HOUR",
          amount: 24,
          anchor: "EFFECTIVE_START",
        }),
      },
      {
        terminationCondition: s({
          kind: "STATE",
          condition: { kind: "EVENT_OCCURS", eventId: "STOP" },
        }),
      },
    ])
      expect(
        resolveActionTiming(
          {
            ...early,
            ...patch,
            dependencies: [{ kind: "COMPLETE_AFTER", actionId: "C" }],
          },
          { ...ctx, eventTimes: { STOP: "2026-09-27T00:00:00Z" } },
        ).status,
      ).toBe("INVALID");
  });
  it("does not shift requested or effective absolute values to satisfy dependencies", () => {
    expect(
      resolveActionTiming(
        { ...early, dependencies: [{ kind: "START_AFTER", actionId: "C" }] },
        {
          ...ctx,
          actionTimes: { C: { requestedStart: "2026-09-29T00:00:00Z" } },
        },
      ).status,
    ).toBe("INVALID");
    expect(
      resolveActionTiming(
        {
          ...base,
          effectiveStart: early.requestedStart,
          dependencies: [{ kind: "EFFECTIVE_AFTER", actionId: "C" }],
        },
        {
          ...ctx,
          actionTimes: { C: { effectiveStart: "2026-09-29T00:00:00Z" } },
        },
      ).status,
    ).toBe("INVALID");
  });
  it("filters weekly weekdays before DST localization", () => {
    const r = resolveActionTiming(
      {
        ...weekly,
        requestedStart: local("2026-03-03T02:30"),
        recurrence: s({
          frequency: {
            kind: "WEEKLY",
            interval: 1,
            daysOfWeek: [2],
            localTime: "02:30",
          },
          boundary: { kind: "BOUNDED", maxOccurrences: 2 },
        }),
      },
      { approvedClock: clock, actionId: "A" },
    );
    expect(r.status).toBe("VALID");
    expect(r.occurrences.map((o) => o.effectiveStart)).toEqual([
      "2026-03-03T07:30:00.000Z",
      "2026-03-10T06:30:00.000Z",
    ]);
  });
});
describe("causal start consistency", () => {
  const absolute = (at: string): any =>
    s({
      kind: "ABSOLUTE",
      time: { kind: "UTC", at, timeZone: "America/Toronto" },
    });
  it("rejects effective start before requested start", () => {
    expect(
      resolveActionTiming(
        {
          ...base,
          requestedStart: absolute("2026-10-01T14:00:00Z"),
          effectiveStart: absolute("2026-09-30T14:00:00Z"),
        },
        { approvedClock: clock },
      ).status,
    ).toBe("INVALID");
  });
  it("enforces specified elapsed implementation delay on absolute and event effective starts", () => {
    for (const effectiveStart of [
      absolute("2026-10-01T15:00:00Z"),
      s({
        kind: "EVENT_RELATIVE",
        relation: "AFTER_EVENT",
        eventId: "READY",
        offset: { kind: "ELAPSED", amount: 0, unit: "HOUR" },
      }),
    ])
      expect(
        resolveActionTiming(
          {
            ...base,
            requestedStart: absolute("2026-10-01T14:00:00Z"),
            implementationDelay: s({
              kind: "ELAPSED",
              amount: 2,
              unit: "HOUR",
            }),
            effectiveStart,
          },
          {
            approvedClock: clock,
            eventTimes: { READY: "2026-10-01T15:00:00Z" as any },
          },
        ).status,
      ).toBe("INVALID");
  });
  it("uses calendar timezone semantics for the minimum effective start", () => {
    const timing = {
      ...base,
      requestedStart: local("2026-10-31T10:00"),
      implementationDelay: s({ kind: "CALENDAR", amount: 1, unit: "DAY" }),
      effectiveStart: local("2026-11-01T09:30"),
    };
    expect(resolveActionTiming(timing, { approvedClock: clock }).status).toBe(
      "INVALID",
    );
    expect(
      resolveActionTiming(
        { ...timing, effectiveStart: local("2026-11-01T10:00") },
        { approvedClock: clock },
      ).status,
    ).toBe("VALID");
  });
});
