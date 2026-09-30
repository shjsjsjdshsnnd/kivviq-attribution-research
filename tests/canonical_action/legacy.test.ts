import { expect, it } from "vitest";
import {
  adaptLegacyAction,
  canonicalActionSchema,
  fingerprintCanonicalAction,
  createCanonicalFixtures,
} from "../../src/canonical_action/index.js";
import { reorderSkuA100 } from "../../src/inventory/fixtures.js";
import { temporarySkuA799SevenDays } from "../../src/pricing/fixtures.js";
import { stopFreeStandardThresholdOffer } from "../../src/shipping/fixtures.js";
import {
  doNothingAction,
  pauseUnderperformingMetaCampaign,
} from "../../src/action_ontology/fixtures.js";
import { utcTimestamp } from "../../src/core/units.js";
it("adapts inventory placement, temporary guarded pricing, and stop-offer semantics", () => {
  for (const source of [
    reorderSkuA100,
    temporarySkuA799SevenDays,
    stopFreeStandardThresholdOffer,
  ]) {
    const result = adaptLegacyAction(source);
    expect(result.what.actionType).toBe(source.actionType);
  }
  const price = adaptLegacyAction(temporarySkuA799SevenDays);
  if ("kind" in price.what)
    expect(
      canonicalActionSchema.safeParse({
        ...price,
        what: {
          ...price.what,
          reversibility: {
            ...price.what.reversibility,
            pricingRollback: { available: false, reason: "absent" },
          },
        },
      }).success,
    ).toBe(false);
  expect(
    fingerprintCanonicalAction(adaptLegacyAction(reorderSkuA100)),
  ).not.toBe(fingerprintCanonicalAction(createCanonicalFixtures()[9]!.action!));
});
it("infers Sunday using the shared zero-based weekday convention", () => {
  const at = utcTimestamp("2026-09-27T10:00:00Z");
  const result = adaptLegacyAction({
    ...doNothingAction,
    timing: {
      ...doNothingAction.timing,
      requestedStart: { kind: "known", at },
      effectiveStart: { kind: "known", at },
    },
    duration: {
      kind: "recurring",
      recurrence: { kind: "weekly", interval: 1, maxOccurrences: 2 },
    },
  });
  expect(result.timing.recurrence.state).toBe("SPECIFIED");
});
it("refuses to erase a legacy manual reversal boundary during migration", () => {
  expect(() => adaptLegacyAction(pauseUnderperformingMetaCampaign)).toThrow(
    /explicit.*reversal/i,
  );
});
