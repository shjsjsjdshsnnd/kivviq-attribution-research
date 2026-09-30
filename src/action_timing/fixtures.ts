import { utcTimestamp } from "../core/units.js";
import {
  ACTION_TIMING_SCHEMA_VERSION,
  type ActionTiming,
  type TimingValue,
} from "./types.js";

const specified = <T>(value: T): TimingValue<T> => ({
  state: "SPECIFIED",
  value,
});
const absent = (reason: string): TimingValue<never> => ({
  state: "ABSENT",
  reason,
});
const na = (reason: string): TimingValue<never> => ({
  state: "NOT_APPLICABLE",
  reason,
});

const DECISION = utcTimestamp("2026-09-22T14:00:00.000Z");

const base = {
  schemaVersion: ACTION_TIMING_SCHEMA_VERSION,
  decisionTime: specified(DECISION),
  timezone: specified("America/Toronto"),
  constraints: absent("no additional timing constraints"),
  dependencies: [],
} as const;

export const immediatePersistentBudgetTiming: ActionTiming = {
  ...base,
  requestedStart: specified({ kind: "IMMEDIATE" }),
  implementationDelay: absent("no implementation delay applies"),
  effectiveStart: specified({ kind: "DERIVE_FROM_REQUESTED_START" }),
  duration: specified({ kind: "PERSISTENT" }),
  end: absent("persistent until changed"),
  terminationCondition: absent("ended by a later business Action"),
  recurrence: na("persistent policy is not a recurring event"),
};

export const fridaySevenDayBudgetTiming: ActionTiming = {
  ...base,
  requestedStart: specified({
    kind: "ABSOLUTE",
    time: {
      kind: "UTC",
      at: utcTimestamp("2026-09-25T04:00:00.000Z"),
      timeZone: "America/Toronto",
    },
  }),
  implementationDelay: absent("no implementation delay applies"),
  effectiveStart: specified({ kind: "DERIVE_FROM_REQUESTED_START" }),
  duration: specified({
    kind: "ELAPSED",
    amount: 168,
    unit: "HOUR",
    anchor: "EFFECTIVE_START",
  }),
  end: specified({ kind: "DERIVE_FROM_DURATION" }),
  terminationCondition: absent("fixed duration is authoritative"),
  recurrence: na("one-time intervention"),
};

export const delayedBudgetTiming: ActionTiming = {
  ...base,
  requestedStart: specified({
    kind: "ABSOLUTE",
    time: {
      kind: "UTC",
      at: utcTimestamp("2026-09-23T14:00:00.000Z"),
      timeZone: "America/Toronto",
    },
  }),
  implementationDelay: specified({ kind: "ELAPSED", amount: 48, unit: "HOUR" }),
  effectiveStart: specified({ kind: "DERIVE_FROM_REQUESTED_START" }),
  duration: specified({ kind: "PERSISTENT" }),
  end: absent("persistent until changed"),
  terminationCondition: absent("ended by a later business Action"),
  recurrence: na("persistent policy is not recurring"),
};

export const postPurchaseFourteenDaysTiming: ActionTiming = {
  ...base,
  requestedStart: specified({
    kind: "EVENT_RELATIVE",
    relation: "AFTER_EVENT",
    eventId: "ORDER_DELIVERED",
    offset: { kind: "CALENDAR", amount: 14, unit: "DAY" },
  }),
  implementationDelay: absent(
    "message eligibility timing has no separate implementation delay",
  ),
  effectiveStart: specified({ kind: "DERIVE_FROM_REQUESTED_START" }),
  duration: specified({ kind: "INSTANTANEOUS" }),
  end: specified({ kind: "DERIVE_FROM_DURATION" }),
  terminationCondition: na("instantaneous send has no state termination"),
  recurrence: na("one-time event-relative send"),
};

export const weeklyEightWeekLifecycleTiming: ActionTiming = {
  ...base,
  requestedStart: specified({
    kind: "ABSOLUTE",
    time: {
      kind: "UTC",
      at: utcTimestamp("2026-09-22T14:00:00.000Z"),
      timeZone: "America/Toronto",
    },
  }),
  implementationDelay: absent("no implementation delay applies"),
  effectiveStart: specified({ kind: "DERIVE_FROM_REQUESTED_START" }),
  duration: specified({ kind: "INSTANTANEOUS" }),
  end: absent("recurrence boundary defines the series"),
  terminationCondition: absent("no additional state termination"),
  recurrence: specified({
    frequency: {
      kind: "WEEKLY",
      interval: 1,
      daysOfWeek: [2],
      localTime: "10:00",
    },
    boundary: {
      kind: "BOUNDED",
      maxOccurrences: 8,
    },
  }),
};

export const inventoryFirstOfTerminationTiming: ActionTiming = {
  ...base,
  requestedStart: specified({ kind: "IMMEDIATE" }),
  implementationDelay: absent("no implementation delay applies"),
  effectiveStart: specified({ kind: "DERIVE_FROM_REQUESTED_START" }),
  duration: absent("state/end composition determines termination"),
  end: absent("state/end composition determines termination"),
  terminationCondition: specified({
    kind: "COMPOSITE",
    operator: "FIRST_OF",
    conditions: [
      {
        kind: "STATE",
        condition: {
          kind: "METRIC_THRESHOLD",
          metricId: "inventory.available_units",
          operator: "LTE",
          value: 50,
          unit: "units",
        },
      },
      {
        kind: "STATE",
        condition: {
          kind: "EVENT_OCCURS",
          eventId: "OCTOBER_31_END",
        },
      },
    ],
  }),
  recurrence: na("stateful intervention is not recurring"),
};

/** Local business clock remains 10:00 when Toronto leaves daylight saving time. */
export const recurringAcrossDstTiming: ActionTiming = {
  ...weeklyEightWeekLifecycleTiming,
  requestedStart: specified({
    kind: "ABSOLUTE",
    time: {
      kind: "LOCAL",
      at: { localDateTime: "2026-10-27T10:00", timeZone: "America/Toronto" },
    },
  }),
};

export const fridayTenAmTiming: ActionTiming = {
  ...postPurchaseFourteenDaysTiming,
  requestedStart: specified({
    kind: "ABSOLUTE",
    time: {
      kind: "LOCAL",
      at: { localDateTime: "2026-10-02T10:00", timeZone: "America/Toronto" },
    },
  }),
};

export const postPurchaseCareTiming: ActionTiming = {
  ...postPurchaseFourteenDaysTiming,
  requestedStart: specified({
    kind: "EVENT_RELATIVE",
    relation: "AFTER_EVENT",
    eventId: "ORDER_FULFILLED",
    offset: { kind: "CALENDAR", amount: 2, unit: "DAY" },
  }),
};

export const productReplenishmentTiming: ActionTiming = {
  ...postPurchaseFourteenDaysTiming,
  requestedStart: specified({
    kind: "EVENT_RELATIVE",
    relation: "AFTER_EVENT",
    eventId: "PRODUCT_A_PURCHASED",
    offset: { kind: "CALENDAR", amount: 60, unit: "DAY" },
  }),
};
