import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import {
  delayedBudgetTiming,
  fridaySevenDayBudgetTiming,
  immediatePersistentBudgetTiming,
  postPurchaseFourteenDaysTiming,
} from "../../src/action_timing/fixtures.js";
import { resolveActionTiming } from "../../src/action_timing/resolution.js";

const approvedClock = utcTimestamp("2026-09-22T14:00:00.000Z");

describe("Step 12 deterministic timing resolution", () => {
  it("resolves IMMEDIATE against the approved clock without changing canonical intent", () => {
    const resolution = resolveActionTiming(immediatePersistentBudgetTiming, { approvedClock });
    expect(resolution.status).toBe("VALID");
    expect(resolution.resolvedRequestedStart).toBe(approvedClock);
    expect(resolution.resolvedEffectiveStart).toBe(approvedClock);
    expect(resolution.resolvedEnd).toBeUndefined();
  });

  it("resolves an elapsed seven-day window from effective start", () => {
    const resolution = resolveActionTiming(fridaySevenDayBudgetTiming, { approvedClock });
    expect(resolution.status).toBe("VALID");
    expect(resolution.resolvedEffectiveStart).toBe("2026-09-25T04:00:00.000Z");
    expect(resolution.resolvedEnd).toBe("2026-10-02T04:00:00.000Z");
  });

  it("keeps implementation delay separate from requested start", () => {
    const resolution = resolveActionTiming(delayedBudgetTiming, { approvedClock });
    expect(resolution.status).toBe("VALID");
    expect(resolution.resolvedRequestedStart).toBe("2026-09-23T14:00:00.000Z");
    expect(resolution.resolvedEffectiveStart).toBe("2026-09-25T14:00:00.000Z");
  });

  it("keeps future event-relative timing unresolved instead of inventing a date", () => {
    const resolution = resolveActionTiming(postPurchaseFourteenDaysTiming, { approvedClock });
    expect(resolution.status).toBe("UNRESOLVED");
    expect(resolution.resolvedRequestedStart).toBeUndefined();
    expect(resolution.unresolvedDependencies).toContain("EVENT_NOT_YET_OBSERVED:ORDER_DELIVERED");
  });

  it("fails closed when calendar arithmetic requires a timezone-aware resolver", () => {
    const resolution = resolveActionTiming(postPurchaseFourteenDaysTiming, {
      approvedClock,
      eventTimes: {
        ORDER_DELIVERED: utcTimestamp("2026-09-20T14:00:00.000Z"),
      },
    });
    expect(resolution.status).toBe("UNRESOLVED");
    expect(resolution.missingContext).toContain("CALENDAR_OFFSET_RESOLVER_REQUIRED:ORDER_DELIVERED");
  });

  it("is deterministic for identical timing and context", () => {
    expect(
      resolveActionTiming(fridaySevenDayBudgetTiming, { approvedClock }),
    ).toEqual(
      resolveActionTiming(fridaySevenDayBudgetTiming, { approvedClock }),
    );
  });
});
