import { describe, expect, it } from "vitest";
import {
  increaseGoogleShoppingBudget20,
  increaseGoogleShoppingBudgetBy1000,
} from "../../src/action_ontology/fixtures.js";
import {
  actionFingerprint,
  actionsSemanticallyEqual,
} from "../../src/action_ontology/semantics.js";
import {
  deserializeAction,
  serializeAction,
} from "../../src/action_ontology/serialization.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Action serialization and semantic identity", () => {
  it("round-trips through deterministic canonical serialization", () => {
    const first = serializeAction(increaseGoogleShoppingBudget20);
    const second = serializeAction(increaseGoogleShoppingBudget20);

    expect(first).toBe(second);

    const restored = deserializeAction(first);
    expect(actionsSemanticallyEqual(restored, increaseGoogleShoppingBudget20)).toBe(
      true,
    );
    expect(Object.isFrozen(restored)).toBe(true);
  });

  it("ignores action ID, prose and provenance creation timestamp for semantic equality", () => {
    const copy = clone(increaseGoogleShoppingBudget20);
    copy.actionId = "action_same_semantics_different_identity";
    copy.description = "Different human-readable wording.";
    copy.provenance.createdAt = "2026-09-21T14:00:00Z";
    copy.provenance.source = "imported_manual";

    const validated = assertValidAction(copy);

    expect(actionsSemanticallyEqual(increaseGoogleShoppingBudget20, validated)).toBe(
      true,
    );
    expect(actionFingerprint(increaseGoogleShoppingBudget20)).toBe(
      actionFingerprint(validated),
    );
  });

  it("changes fingerprint when authoritative intervention semantics change", () => {
    expect(actionFingerprint(increaseGoogleShoppingBudget20)).not.toBe(
      actionFingerprint(increaseGoogleShoppingBudgetBy1000),
    );
  });

  it("does not treat constraint array ordering as different semantics", () => {
    const copy = clone(increaseGoogleShoppingBudget20);
    copy.constraints.reverse();
    const validated = assertValidAction(copy);

    expect(actionFingerprint(validated)).toBe(
      actionFingerprint(increaseGoogleShoppingBudget20),
    );
  });

  it("fails safely for unsupported versions rather than migrating implicitly", () => {
    const copy = clone(increaseGoogleShoppingBudget20);
    copy.schemaVersion = "9.0.0";

    expect(() => deserializeAction(JSON.stringify(copy))).toThrow(
      /schema version/i,
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeAction("{not json")).toThrow(/valid JSON/i);
  });
});
