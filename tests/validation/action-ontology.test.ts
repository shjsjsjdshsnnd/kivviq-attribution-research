import { describe, expect, it } from "vitest";
import {
  increaseGoogleShoppingBudget20,
  pauseUnderperformingMetaCampaign,
  reorderInventoryWith45DayDelay,
  runCollectionPromotion15FourDays,
} from "../../src/action_ontology/fixtures.js";
import { actionId } from "../../src/action_ontology/identity.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import {
  buildCanonicalOperatorInput,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import { ADVERTISING_HEURISTIC_BASELINE_OPERATORS } from "../../src/operator/advertising-heuristics.js";
import {
  CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
  CANONICAL_OPERATOR_INTERFACE_VERSION,
  canonicalizeActionOrdering,
  conformLegacyOperator,
  type CanonicalOperatorMetadataV2,
} from "../../src/operator/canonical-interface.js";
import { operatorFingerprint } from "../../src/operator/identity.js";
import { validateDecisionActionConformance } from "../../src/validation/index.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const start = String(increaseGoogleShoppingBudget20.timing.decisionTime);

function clone<T>(value: T): any {
  return structuredClone(value);
}

function setup() {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, start, 0);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, [
    {
      actionType: String(increaseGoogleShoppingBudget20.actionType),
      eligibleTargets: [increaseGoogleShoppingBudget20.target],
      parameterBounds: [],
      requiredPreconditionIds: ["campaign_exists"],
    },
    {
      actionType: String(pauseUnderperformingMetaCampaign.actionType),
      eligibleTargets: [pauseUnderperformingMetaCampaign.target],
      parameterBounds: [],
      requiredPreconditionIds: [],
    },
  ]);
  const canonicalInput = buildCanonicalOperatorInput(
    contract,
    opportunity,
    observation,
    availability,
    toOperatorDecisionInput(opportunity, observation, availability),
  );
  const base = conformLegacyOperator(
    ADVERTISING_HEURISTIC_BASELINE_OPERATORS.FIXED_CHANNEL_ALLOCATION,
  ).metadata;
  const operatorMetadata: CanonicalOperatorMetadataV2 = {
    ...base,
    operatorId: "validation.synthetic.action-conformance",
    operatorVersion: "1.0.0",
    implementationFingerprint: operatorFingerprint({ implementation: "validation fixture" }),
    configurationFingerprint: operatorFingerprint({ configuration: "validation fixture" }),
    capabilities: {
      ...base.capabilities,
      actionDomains: ["advertising"],
      maximumActionsPerDecision: 4,
    },
    adapterFingerprint: operatorFingerprint({ adapter: "validation fixture" }),
  };
  const decisionMetadata = {
    interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
    decisionTimestamp: opportunity.at,
    deterministicReplayExpected: operatorMetadata.capabilities.randomness.kind === "deterministic",
    randomness: operatorMetadata.capabilities.randomness,
    canonicalActionOrdering: "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC" as const,
  };
  const evidence = {
    contract,
    opportunity,
    availability,
    canonicalInput,
    operatorMetadata,
    decisionEnvelope: {
      schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION,
      actions: [],
      operatorMetadata,
      decisionMetadata,
    },
  };
  return { ...evidence, decisionMetadata };
}

function withActions(actions: readonly unknown[]) {
  const { decisionMetadata, ...evidence } = setup();
  return {
    ...evidence,
    decisionEnvelope: { ...evidence.decisionEnvelope, actions, decisionMetadata },
  };
}

describe("Action conformance evidence", () => {
  it("passes zero, one, and canonically ordered multiple Actions immutably", () => {
    const zero = validateDecisionActionConformance(withActions([]));
    const one = validateDecisionActionConformance(withActions([increaseGoogleShoppingBudget20]));
    const ordered = canonicalizeActionOrdering([
      increaseGoogleShoppingBudget20,
      pauseUnderperformingMetaCampaign,
    ]);
    const multiple = validateDecisionActionConformance(withActions(ordered));

    expect([zero.status, one.status, multiple.status]).toEqual(["PASS", "PASS", "PASS"]);
    expect(Object.isFrozen(multiple)).toBe(true);
    expect(Object.isFrozen(multiple.issues)).toBe(true);
    expect(multiple.evidenceFingerprints).toHaveLength(1);
  });

  it.each([
    ["unknown Action type", (a: any) => { a.actionType = "unknown.action"; }],
    ["unsupported schema version", (a: any) => { a.schemaVersion = "99.0.0"; }],
    ["missing target", (a: any) => { delete a.target; }],
    ["missing required parameter", (a: any) => { delete a.parameters.operation; }],
    ["NaN", (a: any) => { a.parameters.operation.factor = Number.NaN; }],
    ["Infinity", (a: any) => { a.parameters.operation.factor = Number.POSITIVE_INFINITY; }],
    ["invalid currency", (a: any) => {
      a.parameters.operation = {
        kind: "SET",
        value: { kind: "money_rate", amountMinor: 100, currency: "cad", per: "week" },
      };
    }],
    ["invalid unit", (a: any) => {
      a.parameters.operation = {
        kind: "SET",
        value: { kind: "money_rate", amountMinor: 100, currency: "CAD", per: "fortnight" },
      };
    }],
  ])("fails malformed output: %s", (_label, mutate) => {
    const malformed = clone(increaseGoogleShoppingBudget20);
    mutate(malformed);
    const result = validateDecisionActionConformance(withActions([malformed]));
    expect(result.status).toBe("FAIL");
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "INVALID_ACTION",
      path: "evidence.decisionEnvelope.actions[0]",
    }));
  });

  it("rejects invalid percentage units and unavailable SKUs without repairing them", () => {
    const invalidPercentage = clone(runCollectionPromotion15FourDays);
    invalidPercentage.parameters.discount.value.basisPoints = 10_001;
    const percent = validateDecisionActionConformance(withActions([invalidPercentage]));
    expect(percent.issues).toContainEqual(expect.objectContaining({ code: "INVALID_ACTION" }));

    const invalidSku = clone(reorderInventoryWith45DayDelay);
    invalidSku.target.skuId = "";
    expect(validateDecisionActionConformance(withActions([invalidSku])).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_ACTION", path: "evidence.decisionEnvelope.actions[0]" }),
    );

    const unavailableSku = clone(increaseGoogleShoppingBudget20);
    unavailableSku.target = { kind: "campaign", channelId: "google_ads", campaignId: "unavailable" };
    const unavailable = validateDecisionActionConformance(withActions([unavailableSku]));
    expect(unavailable.issues).toContainEqual(expect.objectContaining({
      code: "TARGET_NOT_ELIGIBLE",
      path: "evidence.decisionEnvelope.actions[0]",
    }));
  });

  it("rejects identical duplicates, incompatible proposals, and unstable ordering", () => {
    const duplicate = validateDecisionActionConformance(withActions([
      increaseGoogleShoppingBudget20,
      increaseGoogleShoppingBudget20,
    ]));
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ code: "DUPLICATE_ACTIONS" }));

    const incompatible = clone(increaseGoogleShoppingBudget20);
    incompatible.actionId = actionId("action_google_shopping_budget_other");
    incompatible.parameters.operation.factor = 1.1;
    const conflict = validateDecisionActionConformance(withActions(canonicalizeActionOrdering([
      increaseGoogleShoppingBudget20,
      incompatible,
    ])));
    expect(conflict.issues).toContainEqual(expect.objectContaining({ code: "CONFLICTING_ACTIONS" }));

    const ordered = canonicalizeActionOrdering([
      increaseGoogleShoppingBudget20,
      pauseUnderperformingMetaCampaign,
    ]);
    const unstable = validateDecisionActionConformance(withActions([...ordered].reverse()));
    expect(unstable.issues).toContainEqual(expect.objectContaining({ code: "UNSTABLE_ACTION_ORDER" }));
  });

  it("fails exact-key, binding, capability, and legal-availability violations deterministically", () => {
    const extra = { ...withActions([]), unexpected: true };
    expect(validateDecisionActionConformance(extra).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_EVIDENCE_SHAPE", path: "evidence" }),
    );
    expect(validateDecisionActionConformance({
      ...withActions([]),
      canonicalInput: { malformed: true },
    }).status).toBe("FAIL");

    const limited = withActions([increaseGoogleShoppingBudget20]);
    limited.operatorMetadata = {
      ...limited.operatorMetadata,
      capabilities: { ...limited.operatorMetadata.capabilities, maximumActionsPerDecision: 0 },
    };
    limited.decisionEnvelope = {
      ...limited.decisionEnvelope,
      operatorMetadata: limited.operatorMetadata,
    };
    expect(validateDecisionActionConformance(limited).issues).toContainEqual(
      expect.objectContaining({ code: "CAPABILITY_VIOLATION" }),
    );

    const first = validateDecisionActionConformance(withActions([increaseGoogleShoppingBudget20]));
    const second = validateDecisionActionConformance(withActions([increaseGoogleShoppingBudget20]));
    expect(second).toEqual(first);
  });

  it.each([
    ["top level", (input: any) => { input.extra = true; }],
    ["observation", (input: any) => { input.observation.extra = true; }],
    ["legal Action space", (input: any) => { input.legalActionSpace.extra = true; }],
    ["constraint policy", (input: any) => { input.constraints.extra = true; }],
    ["decision context", (input: any) => { input.decisionContext.extra = true; }],
    ["trigger", (input: any) => { input.decisionContext.trigger.extra = true; }],
    ["provenance", (input: any) => { input.provenance.extra = true; }],
  ])("rejects unknown canonical input keys at the %s", (_label, mutate) => {
    const evidence = withActions([]);
    evidence.canonicalInput = clone(evidence.canonicalInput);
    mutate(evidence.canonicalInput);
    expect(validateDecisionActionConformance(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_INPUT_SCHEMA" }),
    );
  });

  it("recomputes observation and legal Action-space fingerprints instead of trusting provenance", () => {
    const observation = withActions([]);
    observation.canonicalInput = clone(observation.canonicalInput);
    (observation.canonicalInput as any).provenance.observationFingerprint = "fnv1a64:0000000000000000";
    expect(validateDecisionActionConformance(observation).issues).toContainEqual(
      expect.objectContaining({ code: "OBSERVATION_INTEGRITY" }),
    );

    const actionSpace = withActions([]);
    actionSpace.canonicalInput = clone(actionSpace.canonicalInput);
    (actionSpace.canonicalInput as any).legalActionSpace.rules = [];
    (actionSpace.canonicalInput as any).provenance.legalActionSpaceFingerprint = evaluationFingerprint({
      opportunityId: actionSpace.canonicalInput.opportunityId,
      rules: [],
      mutualExclusionGroups: actionSpace.canonicalInput.legalActionSpace.mutualExclusionGroups,
    });
    expect(validateDecisionActionConformance(actionSpace).issues).toContainEqual(
      expect.objectContaining({ code: "ACTION_SPACE_INTEGRITY" }),
    );
  });
});
