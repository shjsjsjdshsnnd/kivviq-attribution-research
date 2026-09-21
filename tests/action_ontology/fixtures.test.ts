import { describe, expect, it } from "vitest";
import {
  ACTION_ONTOLOGY_FIXTURES,
  increaseGoogleShoppingBudget20,
  reallocateMetaToGoogle1000PerWeek,
} from "../../src/action_ontology/fixtures.js";
import { actionSemanticKey } from "../../src/action_ontology/semantics.js";
import { validateAction } from "../../src/action_ontology/validation.js";

describe("Step 2.1 Action Ontology fixtures", () => {
  it("represents all ten required ecommerce interventions as valid Actions", () => {
    expect(ACTION_ONTOLOGY_FIXTURES).toHaveLength(10);

    for (const action of ACTION_ONTOLOGY_FIXTURES) {
      const result = validateAction(action);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.errors, null, 2)).toBe(true);
    }
  });

  it("preserves coordinated component intent for compound reallocations", () => {
    expect(reallocateMetaToGoogle1000PerWeek.atomicity).toBe("COMPOUND");
    expect(reallocateMetaToGoogle1000PerWeek.components).toHaveLength(2);

    for (const component of reallocateMetaToGoogle1000PerWeek.components ?? []) {
      expect(component.parentActionId).toBe(reallocateMetaToGoogle1000PerWeek.actionId);
      expect(component.sharedIntentId).toBe(
        reallocateMetaToGoogle1000PerWeek.sharedIntentId,
      );
    }
  });

  it("does not collapse materially different actions into one representation", () => {
    const keys = ACTION_ONTOLOGY_FIXTURES.map(actionSemanticKey);
    expect(new Set(keys).size).toBe(keys.length);

    const opposite = JSON.parse(
      JSON.stringify(increaseGoogleShoppingBudget20),
    ) as any;
    opposite.parameters[0].mode = "DECREASE_BY_PERCENT";

    expect(actionSemanticKey(opposite)).not.toBe(
      actionSemanticKey(increaseGoogleShoppingBudget20),
    );
  });
});
