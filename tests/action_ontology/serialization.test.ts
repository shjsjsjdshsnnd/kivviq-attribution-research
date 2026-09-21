import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import {
  deserializeAction,
  isBackwardCompatibleOntologyVersion,
  serializeAction,
} from "../../src/action_ontology/serialization.js";
import { actionSemanticKey } from "../../src/action_ontology/semantics.js";

describe("Step 2.1 serialization and versioning", () => {
  it("round-trips without semantic loss", () => {
    const serialized = serializeAction(increaseGoogleShoppingBudget20);
    const restored = deserializeAction(serialized);

    expect(restored).toEqual(increaseGoogleShoppingBudget20);
    expect(actionSemanticKey(restored)).toBe(
      actionSemanticKey(increaseGoogleShoppingBudget20),
    );
  });

  it("accepts backward-compatible 1.x ontology documents", () => {
    const compatible = JSON.parse(
      serializeAction(increaseGoogleShoppingBudget20),
    ) as any;
    compatible.ontologyVersion = "1.4.0";

    expect(isBackwardCompatibleOntologyVersion("1.4.0")).toBe(true);
    expect(deserializeAction(JSON.stringify(compatible)).ontologyVersion).toBe(
      "1.4.0",
    );
  });

  it("rejects incompatible future major versions", () => {
    const incompatible = JSON.parse(
      serializeAction(increaseGoogleShoppingBudget20),
    ) as any;
    incompatible.ontologyVersion = "2.0.0";

    expect(isBackwardCompatibleOntologyVersion("2.0.0")).toBe(false);
    expect(() => deserializeAction(JSON.stringify(incompatible))).toThrow(
      /Invalid Action/,
    );
  });
});
