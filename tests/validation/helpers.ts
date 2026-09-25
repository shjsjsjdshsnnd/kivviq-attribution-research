import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import {
  buildCanonicalOperatorInput,
  invokeOperatorAtDecision,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import {
  canonicalInputFingerprint,
  canonicalOperatorDecisionFingerprint,
  ensureCanonicalOperatorV2,
} from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { ADVERTISING_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/advertising-heuristics.js";
import { INVENTORY_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/inventory-heuristics.js";
import { PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/pricing-promotion-heuristics.js";
import { MERCHANDISING_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/merchandising-heuristics.js";
import { GREEDY_BASELINE_OPERATORS } from "../../src/operator/greedy-operators.js";
import { FLAWED_OPTIMIZER_BASELINE_OPERATORS } from "../../src/operator/flawed-optimizers.js";
import { createMerchantPolicy } from "../../src/operator/merchant-policy.js";
import { createStatusQuoOperator } from "../../src/operator/status-quo.js";
import type { CanonicalOperator } from "../../src/operator/types.js";
import {
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  baselineValidationCaseFingerprint,
  canonicalPolicyDecisionFingerprint,
  canonicalProbeDecisionFingerprint,
  canonicalReplaySchemaFingerprint,
  createRecordedDecisionArtifact,
  declarativeProbeFingerprint,
  type BaselineValidationCase,
  type ExecutableConformanceProbe,
  type ProhibitedInformationProbe,
} from "../../src/validation/index.js";

const START = "2026-10-01T00:00:00.000Z";
const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;

function emptyStatusQuoOperator(): CanonicalOperator {
  const component = (domain: "advertising" | "pricing" | "promotions" | "merchandising" | "inventory") => ({
    domain,
    coverage: "undefined" as const,
    componentVersion: "1.0.0",
    sourceRef: `merchant-policy-fixture:empty:${domain}`,
    effectivePeriod: { start: START },
    parameters: { policyKind: "undefined" },
    rules: [],
  });
  return createStatusQuoOperator(createMerchantPolicy({
    policyId: "merchant-policy:empty-captured-policy-v1",
    policyVersion: "1.0.0",
    description: "Frozen captured policy with no operator-owned actions.",
    source: { sourceRef: "merchant-policy-fixture:empty", capturedAt: START, description: "Empty captured policy." },
    effectivePeriod: { start: START },
    components: {
      advertising: component("advertising"),
      pricing: component("pricing"),
      promotions: component("promotions"),
      merchandising: component("merchandising"),
      inventory: component("inventory"),
    },
  }));
}

export const FROZEN_BASELINE_OPERATORS = Object.freeze([
  DO_NOTHING_OPERATOR,
  emptyStatusQuoOperator(),
  ...Object.values(ADVERTISING_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(INVENTORY_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(MERCHANDISING_HEURISTIC_BASELINE_OPERATORS),
  ...Object.values(GREEDY_BASELINE_OPERATORS),
  ...Object.values(FLAWED_OPTIMIZER_BASELINE_OPERATORS),
] as const);

export const FROZEN_BASELINE_OPERATOR_IDS = Object.freeze([
  "baseline.do_nothing",
  "baseline.status_quo",
  "baseline.advertising.equal_budget_allocation",
  "baseline.advertising.roas_threshold_increase",
  "baseline.advertising.roas_threshold_decrease",
  "baseline.advertising.highest_observed_roas",
  "baseline.advertising.fixed_channel_allocation",
  "baseline.inventory.fixed_reorder_threshold",
  "baseline.inventory.fixed_reorder_quantity",
  "baseline.inventory.low_inventory_depromotion",
  "baseline.inventory.no_inventory_aware_intervention",
  "baseline.pricing.never_discount",
  "baseline.pricing.fixed_discount",
  "baseline.pricing.excess_inventory_discount",
  "baseline.promotion.fixed_promotional_calendar",
  "baseline.merchandising.rank_by_revenue",
  "baseline.merchandising.rank_by_conversion_rate",
  "baseline.merchandising.rank_by_units_sold",
  "baseline.greedy.immediate_revenue",
  "baseline.greedy.immediate_gross_profit",
  "baseline.greedy.immediate_contribution",
  "baseline.flawed.max_roas",
  "baseline.flawed.min_cac",
  "baseline.flawed.max_revenue",
  "baseline.flawed.best_seller_push",
  "baseline.flawed.lowest_cpa",
  "baseline.flawed.highest_conversion_rate",
] as const);

export function emptyCanonicalContext(sequence = 0) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  const legacyInput = toOperatorDecisionInput(opportunity, observation, availability);
  const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, legacyInput);
  return { opportunity, observation, availability, input };
}

function permittedObservationContext(sequence: number, value: number) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, START, sequence);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, [{
    observationKey: "validation.permitted_probe",
    informationClass: "observable_merchant_data",
    sourceMinOccurredAt: opportunity.at,
    sourceMaxOccurredAt: opportunity.at,
    availableAt: opportunity.at,
    sourceRef: "merchant-observations:permitted",
    value: { value },
  }]);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
  return { opportunity, observation, availability, input };
}

function executableProbe(
  operator: ReturnType<typeof ensureCanonicalOperatorV2>,
  caseId: string,
  checkId: ExecutableConformanceProbe["checkId"],
  fixtureId: string,
  inputs: readonly ReturnType<typeof emptyCanonicalContext>["input"][],
  expectation: ExecutableConformanceProbe["expectation"],
): ExecutableConformanceProbe {
  const body = {
    probeId: `${caseId}:${checkId}`,
    checkId,
    operatorId: operator.metadata.operatorId,
    configurationFingerprint: operator.metadata.configurationFingerprint,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId),
    invocations: inputs.map((canonicalInput) => ({
      fixtureId,
      canonicalInput,
      inputFingerprint: canonicalInputFingerprint(canonicalInput),
    })),
    expectation,
  };
  return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

function prohibitedProbe(operator: ReturnType<typeof ensureCanonicalOperatorV2>, caseId: string, input: ReturnType<typeof emptyCanonicalContext>["input"]): ProhibitedInformationProbe {
  const body = {
    probeId: `${caseId}:prohibited`,
    checkId: "prohibited_information_invariance" as const,
    operatorId: operator.metadata.operatorId,
    configurationFingerprint: operator.metadata.configurationFingerprint,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId),
    pairs: [{
      pairId: `${caseId}:hidden-future`,
      leftFixtureId: "hidden_truth_pair",
      rightFixtureId: "future_pair",
      leftInput: input,
      rightInput: input,
      leftWitnessFingerprint: evaluationFingerprint({ caseId, witness: "hidden" }),
      rightWitnessFingerprint: evaluationFingerprint({ caseId, witness: "future" }),
    }],
  };
  return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

export function createCompleteBaselineValidationCase(legacyOperator: CanonicalOperator, index: number): BaselineValidationCase {
  const operator = ensureCanonicalOperatorV2(legacyOperator);
  const caseId = `frozen-baseline-${String(index + 1).padStart(2, "0")}`;
  const { opportunity, observation, availability, input } = emptyCanonicalContext(index % 3);
  const decision = operator.decide(input);
  const decisionFingerprint = canonicalOperatorDecisionFingerprint(decision);
  const policyFingerprint = canonicalProbeDecisionFingerprint(decision.actions.map(actionFingerprint));
  const seedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[index % FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length]!;
  const secondSeedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[(index + 1) % FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length]!;
  const seedBindingFingerprint = evaluationFingerprint({ seedCaseId: seedCase.caseId, seeds: seedCase.seeds });
  const sample = (sampleId: string) => ({
    sampleId,
    canonicalInputFingerprint: canonicalInputFingerprint(input),
    operatorFingerprint: operator.metadata.implementationFingerprint,
    configurationFingerprint: operator.metadata.configurationFingerprint,
    seedBindingFingerprint,
    actions: decision.actions,
    decisionEnvelope: decision,
  });
  const isolationSide = (kind: string) => ({
    visibleInputFingerprint: canonicalInputFingerprint(input),
    witnessFingerprint: evaluationFingerprint({ caseId, kind }),
    decisionFingerprint: canonicalPolicyDecisionFingerprint(decision.actions),
    actions: decision.actions,
  });
  const evaluated = invokeOperatorAtDecision(contract, legacyOperator, opportunity, observation, availability);
  const disposition = { contract, opportunity, availability, attempts: [] };
  const replay = createRecordedDecisionArtifact(operator, input, decision, {
    constraintFingerprint: evaluationFingerprint(input.constraints),
    schemaFingerprint: canonicalReplaySchemaFingerprint(),
    seedCaseId: seedCase.caseId,
    seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion,
    seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint,
    seeds: seedCase.seeds,
    seedFingerprint: evaluationFingerprint(seedCase.seeds),
  });
  const exact = { kind: "exact" as const, expectedDecisionFingerprints: [policyFingerprint], expectedActionFingerprints: [decision.actions.map(actionFingerprint)] };
  const permittedA = permittedObservationContext(index % 3, 1).input;
  const permittedB = permittedObservationContext(index % 3, 2).input;
  const multiExact = { kind: "exact" as const, expectedDecisionFingerprints: [policyFingerprint], expectedActionFingerprints: [decision.actions.map(actionFingerprint)] };
  return {
    caseId,
    operator: legacyOperator,
    evidence: {
      determinism: [sample("canonical-a"), sample("canonical-b")],
      seedReproducibility: ["seed-a", "seed-b"].map((sampleId) => ({ sampleId, seedSetFingerprint: seedBindingFingerprint, canonicalInputFingerprint: canonicalInputFingerprint(input), operatorFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, runFingerprint: decisionFingerprint })),
      hiddenTruthIsolation: [{ pairId: `${caseId}:hidden`, baseline: isolationSide("hidden-a"), variant: isolationSide("hidden-b") }],
      futureInformationIsolation: [{ pairId: `${caseId}:future`, baseline: isolationSide("future-a"), variant: isolationSide("future-b") }],
      temporalBoundary: { decisionTimestamp: opportunity.at, observations: [] },
      lookbackWindow: { startInclusive: "2026-09-01T00:00:00.000Z", endInclusive: opportunity.at, decisionTimestamp: opportunity.at, observations: [] },
      actionConformance: { contract, opportunity, availability, canonicalInput: input, operatorMetadata: operator.metadata, decisionEnvelope: decision },
      constraintConformance: disposition,
      policySemantics: executableProbe(operator, caseId, "policy_semantics", "missing_data", [input], exact),
      permittedInformationSensitivity: executableProbe(operator, caseId, "permitted_information_sensitivity", "single_action", [permittedA, permittedB], { kind: "invariant" }),
      prohibitedInformationInvariance: prohibitedProbe(operator, caseId, input),
      tieBreaking: executableProbe(operator, caseId, "tie_breaking", "exact_tie", [input], exact),
      missingDataBehavior: executableProbe(operator, caseId, "missing_data_behavior", "missing_data", [input], exact),
      zeroActionBehavior: executableProbe(operator, caseId, "zero_action_behavior", "empty", [input], { kind: "zero_actions" }),
      multiActionBehavior: executableProbe(operator, caseId, "multi_action_behavior", "multi_action", [input], multiExact),
      artifactReplay: replay,
      provenanceIntegrity: [
        { label: `${seedCase.worldProfile}:input`, value: input, recordedFingerprint: evaluationFingerprint(input) },
        { label: `${secondSeedCase.worldProfile}:decision`, value: decision, recordedFingerprint: evaluationFingerprint(decision) },
      ],
      uncontrolledRandomness: [sample("random-a"), sample("random-b"), sample("random-c")],
      operatorIsolation: { canonicalInputBefore: input, canonicalInputAfter: input, operatorMetadata: operator.metadata, decisionEnvelope: decision, evaluatedDecision: evaluated, dispositionEvidence: disposition },
    },
  };
}

export const ALL_BASELINE_VALIDATION_CASES = Object.freeze(
  FROZEN_BASELINE_OPERATORS.map(createCompleteBaselineValidationCase),
);
