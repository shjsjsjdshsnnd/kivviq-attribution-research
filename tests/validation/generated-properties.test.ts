import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import { canonicalOperatorDecisionFingerprint, ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { FIXED_REORDER_THRESHOLD_OPERATOR, INVENTORY_HEURISTIC_OBSERVATION_KEY } from "../../src/operator/inventory-heuristics.js";
import { FROZEN_BASELINE_VALIDATION_SEED_SET } from "../../src/validation/index.js";
import { emptyCanonicalContext } from "./helpers.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";

function inventoryThresholdInput(availableUnits: number, sequence: number) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, [{
    observationKey: INVENTORY_HEURISTIC_OBSERVATION_KEY,
    informationClass: "current_state_information",
    sourceMinOccurredAt: opportunity.at,
    sourceMaxOccurredAt: opportunity.at,
    availableAt: opportunity.at,
    sourceRef: "inventory-ledger:step3.5-inventory-state",
    value: {
      schemaVersion: "1.0.0",
      availabilityConcept: "AVAILABLE_TO_SELL",
      skus: [{ skuId: "sku:B", productId: "product:B", active: true, discontinued: false, availableUnits, incomingUnits: 0, pendingReorder: false, observableReorderTriggered: false, existingReorderQuantityUnits: 50, supplierAvailable: true, activePromotionIds: [] }],
    },
  }]);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, [{
    actionType: "inventory.reorder",
    eligibleTargets: [{ kind: "sku", productId: "product:B", skuId: "sku:B" }],
    parameterBounds: [],
    requiredPreconditionIds: [],
  }]);
  return buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
}

function* frozenIntegers(): Generator<{ value: number; profile: string }> {
  for (const seedCase of FROZEN_BASELINE_VALIDATION_SEED_SET.cases) {
    let state = seedCase.seeds.shared_evaluation_environment >>> 0;
    for (let index = 0; index < 24; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      yield { value: state, profile: seedCase.worldProfile };
    }
  }
}

describe("deterministically generated canonical baseline properties", () => {
  it("checks at least 100 empty/no-op and threshold-neighbor decisions across frozen profiles", () => {
    const generated = [...frozenIntegers()];
    expect(generated.length).toBeGreaterThanOrEqual(100);
    expect(new Set(generated.map((entry) => entry.profile)).size).toBeGreaterThanOrEqual(3);

    const thresholdOperator = ensureCanonicalOperatorV2(FIXED_REORDER_THRESHOLD_OPERATOR);
    const doNothing = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    for (const [index, sample] of generated.entries()) {
      const sequence = sample.value % 90;
      const availableUnits = [9, 10, 11][sample.value % 3]!;
      const input = inventoryThresholdInput(availableUnits, sequence);
      const operator = thresholdOperator;
      const first = operator.decide(input);
      const second = operator.decide(input);
      expect(canonicalOperatorDecisionFingerprint(first), `sample ${index}`).toBe(
        canonicalOperatorDecisionFingerprint(second),
      );
      for (const action of first.actions) expect(assertValidAction(action)).toEqual(action);
      expect(first.actions).toHaveLength(availableUnits === 9 ? 1 : 0);

      const emptyInput = emptyCanonicalContext(sequence).input;
      expect(doNothing.decide(emptyInput).actions).toEqual([]);
    }
  });
});
