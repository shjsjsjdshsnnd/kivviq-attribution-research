import { describe, expect, it } from "vitest";
import {
  canonicalActionSchema,
  fingerprintCanonicalAction,
  serializeCanonicalAction,
  readCanonicalAction,
  adaptLegacyAction,
} from "../../src/canonical_action/index.js";
import {
  immediatePersistentBudgetTiming,
  postPurchaseFourteenDaysTiming,
} from "../../src/action_timing/fixtures.js";
import {
  doNothingAction,
  increaseGoogleShoppingBudget20,
} from "../../src/action_ontology/fixtures.js";
import { serializeAction } from "../../src/action_ontology/serialization.js";
import { translateCanonicalAction } from "../../src/action_translation/canonical.js";

const population = {
  populationId: "population_a",
  version: 1,
  definitionFingerprint: "fnv1a64:0123456789abcdef",
  binding: "SEND_TIME",
  membershipMode: "DYNAMIC_MEMBERSHIP",
};
const send = () => ({
  schemaVersion: "2.0.0",
  actionId: "action_winback",
  what: { actionType: "lifecycle.send", channel: "EMAIL", purpose: "WINBACK" },
  population,
  timing: {
    ...immediatePersistentBudgetTiming,
    duration: { state: "SPECIFIED", value: { kind: "INSTANTANEOUS" } },
  },
  provenance: ["evidence_fixture"],
});
describe("canonical WHAT WHO WHEN boundary", () => {
  it("uses independent strict contracts and round trips", () => {
    const action = canonicalActionSchema.parse(send());
    expect(readCanonicalAction(serializeCanonicalAction(action))).toEqual(
      action,
    );
    expect(
      canonicalActionSchema.safeParse({ ...send(), expectedRevenue: 3 })
        .success,
    ).toBe(false);
    expect(
      canonicalActionSchema.safeParse({
        ...send(),
        what: { ...send().what, audience: "VIP" },
      }).success,
    ).toBe(false);
  });
  it("requires explicit population for lifecycle sends", () => {
    const { population: _, ...missing } = send();
    expect(canonicalActionSchema.safeParse(missing).success).toBe(false);
  });
  it("preserves semantic distinctions while excluding action identity", () => {
    const a = canonicalActionSchema.parse(send());
    const fp = fingerprintCanonicalAction(a);
    expect(fp).toBe(
      fingerprintCanonicalAction({ ...a, actionId: "action_other" }),
    );
    expect(fp).not.toBe(
      fingerprintCanonicalAction(
        canonicalActionSchema.parse({
          ...send(),
          what: { ...send().what, channel: "SMS" },
        }),
      ),
    );
    expect(fp).not.toBe(
      fingerprintCanonicalAction(
        canonicalActionSchema.parse({
          ...send(),
          population: { ...population, binding: "DECISION_TIME" },
        }),
      ),
    );
    expect(fp).not.toBe(
      fingerprintCanonicalAction(
        canonicalActionSchema.parse({
          ...send(),
          population: { ...population, membershipMode: "FROZEN_MEMBERSHIP" },
        }),
      ),
    );
  });
  it("retains exact historical serialization and adapts other Action families explicitly", () => {
    const before = serializeAction(doNothingAction);
    expect(readCanonicalAction(before)).toEqual(doNothingAction);
    const upgraded = adaptLegacyAction(increaseGoogleShoppingBudget20);
    expect(upgraded.schemaVersion).toBe("2.0.0");
    expect(upgraded.timing.schemaVersion).toBe("1.0.0");
    expect("timing" in upgraded.what).toBe(false);
    expect(serializeAction(doNothingAction)).toBe(before);
  });
  it("does not turn missing population or events into a broadcast or immediate send", () => {
    expect(translateCanonicalAction(send(), {}).status).toBe("MISSING_CONTEXT");
    const action = { ...send(), timing: postPurchaseFourteenDaysTiming };
    const result = translateCanonicalAction(action, {
      timing: { approvedClock: "2026-09-26T12:00:00Z" },
    });
    expect(result.status).toBe("MISSING_CONTEXT");
  });
});
