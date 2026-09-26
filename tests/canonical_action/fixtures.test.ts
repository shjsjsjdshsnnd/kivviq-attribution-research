import { describe, expect, it } from "vitest";
import { createCanonicalFixtures } from "../../src/canonical_action/fixtures.js";
import {
  canonicalActionSchema,
  fingerprintCanonicalAction,
} from "../../src/canonical_action/index.js";
import { resolveActionTiming } from "../../src/action_timing/index.js";
import { utcTimestamp } from "../../src/core/units.js";
import { translateBusinessAction } from "../../src/action_translation/index.js";
describe("Steps 10–12 freeze fixtures", () => {
  it("provides all thirty numbered cases with valid contracts", () => {
    const fixtures = createCanonicalFixtures();
    expect(fixtures.map((f) => f.number)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    for (const f of fixtures)
      if (f.action)
        expect(canonicalActionSchema.safeParse(f.action).success, f.label).toBe(
          true,
        );
  });
  it("keeps one recurring Action across Toronto daylight saving", () => {
    const action = createCanonicalFixtures().find(
      (f) => f.number === 28,
    )!.action!;
    const result = resolveActionTiming(action.timing, {
      actionId: action.actionId,
      approvedClock: utcTimestamp("2026-09-26T12:00:00Z"),
    });
    expect(result.status).toBe("VALID");
    expect(result.occurrences).toHaveLength(8);
    expect(new Set(result.occurrences.map((o) => o.actionId))).toEqual(
      new Set([action.actionId]),
    );
    expect(
      new Set(result.occurrences.map((o) => o.effectiveStart.slice(11, 16))),
    ).toEqual(new Set(["14:00", "15:00"]));
  });
  it("changes counts as observations age and preserves explicit unknown consent", () => {
    const f = createCanonicalFixtures();
    expect(f[16]!.populationFixture!.evaluation.unknownCount).toBeGreaterThan(
      0,
    );
    expect(f[19]!.populationFixture!.evaluation.eligibleCount).not.toBe(
      f[19]!.populationFixture!.laterEvaluation!.eligibleCount,
    );
  });
  it("preserves send vs flow, immediate vs future, bounded vs persistent, event and recurrence identities", () => {
    const f = createCanonicalFixtures();
    const fp = (n: number) => fingerprintCanonicalAction(f[n - 1]!.action!);
    for (const [a, b] of [
      [1, 2],
      [1, 6],
      [21, 22],
      [25, 26],
      [21, 27],
    ])
      expect(fp(a!)).not.toBe(fp(b!));
    const action = f[23]!.action!;
    const alt = canonicalActionSchema.parse({
      ...action,
      timing: {
        ...action.timing,
        requestedStart: {
          state: "SPECIFIED",
          value: {
            kind: "EVENT_RELATIVE",
            relation: "AFTER_EVENT",
            eventId: "ORDER_PLACED",
            offset: { kind: "CALENDAR", amount: 14, unit: "DAY" },
          },
        },
      },
    });
    expect(fingerprintCanonicalAction(action)).not.toBe(
      fingerprintCanonicalAction(alt),
    );
  });
  it("public translator refuses complete unsupported semantics and unresolved events", () => {
    const f = createCanonicalFixtures();
    expect(
      translateBusinessAction(f[29]!.action, f[29]!.translationContext).status,
    ).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
    expect(
      translateBusinessAction(f[28]!.action, f[28]!.translationContext).status,
    ).toBe("MISSING_CONTEXT");
  });
});
