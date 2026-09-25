import { describe, expect, it } from "vitest";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import { canonicalInputFingerprint, canonicalOperatorDecisionFingerprint, ensureCanonicalOperatorV2, validateCanonicalDecisionEnvelope } from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { ADVERTISING_HEURISTIC_OBSERVATION_KEY, HIGHEST_OBSERVED_ROAS_OPERATOR } from "../../src/operator/advertising-heuristics.js";
import { FIXED_REORDER_THRESHOLD_OPERATOR, INVENTORY_HEURISTIC_OBSERVATION_KEY } from "../../src/operator/inventory-heuristics.js";
import { FROZEN_BASELINE_VALIDATION_SEED_SET } from "../../src/validation/index.js";
import { emptyCanonicalContext } from "./helpers.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";

function inventoryThresholdInput(availableUnits: number, sequence: number, reorderQuantityUnits: number) {
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
      skus: [{ skuId: "sku:B", productId: "product:B", active: true, discontinued: false, availableUnits, incomingUnits: 0, pendingReorder: false, observableReorderTriggered: false, existingReorderQuantityUnits: reorderQuantityUnits, supplierAvailable: true, activePromotionIds: [] }],
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

function advertisingRoasInput(winner: "google_ads" | "meta_ads", sequence: number, profileIndex: number) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const channels = ["google_ads", "meta_ads"].map((channelId) => ({
    channelId,
    active: true,
    currency: "CAD",
    currentBudgetMinor: channelId === "google_ads" ? 600_000 + profileIndex * 10_000 : 300_000 + profileIndex * 10_000,
    spendMinor: 100_000,
    attributedRevenueMinor: channelId === winner ? 400_000 : 100_000,
    historyDays: 7,
  }));
  const observation = buildOperatorObservationSnapshot(contract, opportunity, [{
    observationKey: ADVERTISING_HEURISTIC_OBSERVATION_KEY,
    informationClass: "derived_observable_metric",
    sourceMinOccurredAt: opportunity.at,
    sourceMaxOccurredAt: opportunity.at,
    availableAt: opportunity.at,
    sourceRef: "platform-report:generated-advertising-profile",
    value: { schemaVersion: "1.0.0", attributionSemantics: "operator_observed_attributed_revenue", budgetPeriod: "week", lookbackDays: 7, channels },
  }]);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, [{
    actionType: "advertising.adjust_budget",
    eligibleTargets: channels.map(({ channelId }) => ({ kind: "advertising_channel", channelId })),
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
  it("checks at least 100 no-op, threshold-neighbor, and advertising winner decisions across frozen profiles", () => {
    const generated = [...frozenIntegers()];
    expect(generated.length).toBeGreaterThanOrEqual(100);
    expect(new Set(generated.map((entry) => entry.profile)).size).toBeGreaterThanOrEqual(3);

    const thresholdOperator = ensureCanonicalOperatorV2(FIXED_REORDER_THRESHOLD_OPERATOR);
    const doNothing = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    const advertising = ensureCanonicalOperatorV2(HIGHEST_OBSERVED_ROAS_OPERATOR);
    const profileInputs = new Map<string, Set<string>>();
    for (const [index, sample] of generated.entries()) {
      const sequence = sample.value % 90;
      const availableUnits = [9, 10, 11][sample.value % 3]!;
      const profileIndex = FROZEN_BASELINE_VALIDATION_SEED_SET.cases.findIndex((entry) => entry.worldProfile === sample.profile);
      const input = inventoryThresholdInput(availableUnits, sequence, 40 + Math.max(profileIndex, 0) * 10);
      const profileSet = profileInputs.get(sample.profile) ?? new Set<string>();
      profileSet.add(canonicalInputFingerprint(input));
      profileInputs.set(sample.profile, profileSet);
      const operator = thresholdOperator;
      const first = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      const second = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      expect(canonicalOperatorDecisionFingerprint(first), `sample ${index}`).toBe(
        canonicalOperatorDecisionFingerprint(second),
      );
      for (const action of first.actions) expect(assertValidAction(action)).toEqual(action);
      expect(first.actions).toHaveLength(availableUnits === 9 ? 1 : 0);

      const emptyInput = emptyCanonicalContext(sequence).input;
      expect(validateCanonicalDecisionEnvelope(emptyInput, doNothing.metadata, doNothing.decide(emptyInput)).actions).toEqual([]);

      const advertisingInput = advertisingRoasInput(sample.value % 2 === 0 ? "google_ads" : "meta_ads", sequence, Math.max(profileIndex, 0));
      const advertisingDecision = validateCanonicalDecisionEnvelope(advertisingInput, advertising.metadata, advertising.decide(advertisingInput));
      expect(advertisingDecision.actions).toHaveLength(2);
      for (const action of advertisingDecision.actions) expect(assertValidAction(action)).toEqual(action);
    }
    expect([...profileInputs.values()].every((fingerprints) => fingerprints.size > 0)).toBe(true);
    expect(new Set([...profileInputs.values()].map((fingerprints) => [...fingerprints][0])).size).toBeGreaterThanOrEqual(3);

    const profileEvidenceFingerprints = FROZEN_BASELINE_VALIDATION_SEED_SET.cases.map((_, profileIndex) =>
      inventoryThresholdInput(9, 0, 40 + profileIndex * 10).provenance.observationFingerprint,
    );
    expect(new Set(profileEvidenceFingerprints).size).toBe(FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length);
    const profileAdvertisingDecisions = FROZEN_BASELINE_VALIDATION_SEED_SET.cases.map((_, profileIndex) => {
      const profileInput = advertisingRoasInput("google_ads", 0, profileIndex);
      return canonicalOperatorDecisionFingerprint(advertising.decide(profileInput));
    });
    expect(new Set(profileAdvertisingDecisions).size).toBe(FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length);
  });
});
