import { describe, expect, it } from "vitest";
import {
  delayedBudgetTiming,
  fridaySevenDayBudgetTiming,
  immediatePersistentBudgetTiming,
  inventoryFirstOfTerminationTiming,
  postPurchaseFourteenDaysTiming,
  weeklyEightWeekLifecycleTiming,
} from "../../src/action_timing/fixtures.js";
import {
  validateActionTiming,
  validateTimingDependencyGraph,
} from "../../src/action_timing/validation.js";

describe("Step 12 ActionTiming validation", () => {
  it("accepts canonical representative timing fixtures", () => {
    for (const timing of [
      immediatePersistentBudgetTiming,
      fridaySevenDayBudgetTiming,
      delayedBudgetTiming,
      postPurchaseFourteenDaysTiming,
      weeklyEightWeekLifecycleTiming,
      inventoryFirstOfTerminationTiming,
    ]) {
      expect(validateActionTiming(timing)).toEqual({ ok: true, issues: [] });
    }
  });

  it("rejects optimizer/predictive timing fields structurally", () => {
    const unsafe = {
      ...immediatePersistentBudgetTiming,
      predictedBestStart: "2026-09-25T00:00:00Z",
    };
    const result = validateActionTiming(unsafe);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "FORBIDDEN_TIMING_INFORMATION",
        ),
      ).toBe(true);
    }
  });

  it("rejects a persistent Action with a specified end", () => {
    const invalid = {
      ...immediatePersistentBudgetTiming,
      end: {
        state: "SPECIFIED",
        value: {
          kind: "ABSOLUTE",
          time: {
            kind: "UTC",
            at: "2026-10-01T00:00:00.000Z",
            timeZone: "America/Toronto",
          },
        },
      },
    };
    const result = validateActionTiming(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "PERSISTENT_ACTION_HAS_END",
        ),
      ).toBe(true);
    }
  });

  it("requires recurrence to be bounded or explicitly open-ended", () => {
    const invalid = {
      ...weeklyEightWeekLifecycleTiming,
      recurrence: {
        state: "SPECIFIED",
        value: {
          frequency: {
            kind: "WEEKLY",
            interval: 1,
            daysOfWeek: [2],
            localTime: "10:00",
          },
          boundary: { kind: "BOUNDED" },
        },
      },
    };
    const result = validateActionTiming(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some((issue) => issue.code === "UNBOUNDED_RECURRENCE"),
      ).toBe(true);
    }
  });

  it("rejects circular temporal dependency graphs", () => {
    const result = validateTimingDependencyGraph([
      {
        actionId: "action_a",
        dependencies: [
          { kind: "START_AFTER_ACTION_COMPLETED", actionId: "action_b" },
        ],
      },
      {
        actionId: "action_b",
        dependencies: [
          { kind: "START_AFTER_ACTION_COMPLETED", actionId: "action_a" },
        ],
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (issue) => issue.code === "TEMPORAL_DEPENDENCY_CYCLE",
        ),
      ).toBe(true);
    }
  });
});
