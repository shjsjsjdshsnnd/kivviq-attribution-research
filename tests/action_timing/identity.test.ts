import { describe, expect, it } from "vitest";
import type { ActionTiming } from "../../src/action_timing/types.js";
import {
  actionTimingFingerprint,
  serializeActionTiming,
  timingsSemanticallyEqual,
} from "../../src/action_timing/canonical.js";
import {
  fridaySevenDayBudgetTiming,
  immediatePersistentBudgetTiming,
  inventoryFirstOfTerminationTiming,
  weeklyEightWeekLifecycleTiming,
} from "../../src/action_timing/fixtures.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("Step 12 timing semantic identity", () => {
  it("distinguishes temporary timing from persistent timing", () => {
    expect(actionTimingFingerprint(fridaySevenDayBudgetTiming)).not.toBe(
      actionTimingFingerprint(immediatePersistentBudgetTiming),
    );
  });

  it("canonicalizes weekly day ordering", () => {
    const reordered = clone(weeklyEightWeekLifecycleTiming) as ActionTiming;
    const recurrence = reordered.recurrence;
    if (
      recurrence.state !== "SPECIFIED" ||
      recurrence.value.frequency.kind !== "WEEKLY"
    ) {
      throw new Error("fixture must remain weekly");
    }
    const equivalent = {
      ...reordered,
      recurrence: {
        ...recurrence,
        value: {
          ...recurrence.value,
          frequency: {
            ...recurrence.value.frequency,
            daysOfWeek: [5, 2, 1],
          },
        },
      },
    } as ActionTiming;
    const equivalentReordered = {
      ...equivalent,
      recurrence: {
        ...equivalent.recurrence,
        value: {
          ...(equivalent.recurrence.state === "SPECIFIED"
            ? equivalent.recurrence.value
            : recurrence.value),
          frequency: {
            kind: "WEEKLY",
            interval: 1,
            daysOfWeek: [1, 5, 2],
            localTime: "10:00",
          },
        },
      },
    } as ActionTiming;
    expect(serializeActionTiming(equivalent)).toBe(
      serializeActionTiming(equivalentReordered),
    );
  });

  it("canonicalizes commutative termination composition", () => {
    const left = inventoryFirstOfTerminationTiming;
    const right = clone(left) as ActionTiming;
    if (
      right.terminationCondition.state !== "SPECIFIED" ||
      right.terminationCondition.value.kind !== "COMPOSITE"
    ) {
      throw new Error("fixture must remain composite");
    }
    const reversed = {
      ...right,
      terminationCondition: {
        ...right.terminationCondition,
        value: {
          ...right.terminationCondition.value,
          conditions: [
            ...right.terminationCondition.value.conditions,
          ].reverse(),
        },
      },
    } as ActionTiming;
    expect(timingsSemanticallyEqual(left, reversed)).toBe(true);
    expect(actionTimingFingerprint(left)).toBe(
      actionTimingFingerprint(reversed),
    );
  });

  it("keeps IMMEDIATE as intent rather than replacing it with a generated now timestamp", () => {
    expect(serializeActionTiming(immediatePersistentBudgetTiming)).toContain(
      '"kind":"IMMEDIATE"',
    );
    expect(
      serializeActionTiming(immediatePersistentBudgetTiming),
    ).not.toContain('"resolvedRequestedStart"');
  });
});
