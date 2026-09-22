import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import {
  assessPromotionPairConflict,
} from "../../src/promotion/conflicts.js";
import {
  overlappingCollection20NonStackable,
  overlappingFurniture15NonStackable,
  startAutomaticCollectionX15FourDays,
  startProductA100CadOff,
} from "../../src/promotion/fixtures.js";

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

describe("Step 5 promotion overlap/conflict contracts", () => {
  it("allows two explicitly stackable simple promotions", () => {
    expect(
      assessPromotionPairConflict(
        startAutomaticCollectionX15FourDays,
        startProductA100CadOff,
      ),
    ).toEqual({ status: "STACKABLE" });
  });

  it("returns explicit ambiguity for overlapping non-stackable promotions without compatible resolution", () => {
    expect(
      assessPromotionPairConflict(
        overlappingFurniture15NonStackable,
        overlappingCollection20NonStackable,
      ),
    ).toEqual({
      status: "AMBIGUOUS",
      code: "NON_STACKABLE_OVERLAP_WITHOUT_RESOLUTION",
    });
  });

  it("supports deterministic priority resolution when explicitly configured", () => {
    const left = clone(overlappingCollection20NonStackable);
    left.actionId = "action_promo_priority_left";
    left.target.promotionId = "promo_priority_left";
    left.parameters.promotionId = "promo_priority_left";
    left.parameters.definition.conflictResolution = {
      kind: "PRIORITY",
      precedence: 20,
    };

    const right = clone(overlappingCollection20NonStackable);
    right.actionId = "action_promo_priority_right";
    right.target.promotionId = "promo_priority_right";
    right.parameters.promotionId = "promo_priority_right";
    right.parameters.definition.conflictResolution = {
      kind: "PRIORITY",
      precedence: 10,
    };

    expect(
      assessPromotionPairConflict(
        assertValidAction(left),
        assertValidAction(right),
      ),
    ).toMatchObject({
      status: "RESOLVABLE",
      strategy: "PRIORITY",
      winnerPromotionId: "promo_priority_left",
    });
  });
});
