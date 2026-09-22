import { describe, expect, it } from "vitest";
import * as operatorSafeApi from "../../src/index.js";
import {
  ACTION_SCHEMA_VERSION,
} from "../../src/action_ontology/types.js";
import {
  doNothingAction,
  increaseGoogleShoppingBudget20,
} from "../../src/action_ontology/fixtures.js";
import { serializeGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import {
  BASELINE_METRIC_SET_VERSION,
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  assertEquivalentComparisonBindings,
  assertValidBaselineEvaluationContract,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createEvaluationActionAttemptRecord,
  createEvaluationComparisonBinding,
  createEvaluationRunArtifact,
  createFixedIntervalDecisionOpportunity,
  deriveEvaluationHorizonTimestamps,
  evaluationFingerprint,
  resolveActionConstraintAssessment,
  validateActionAtDecision,
  validateActionBatchAtDecision,
  type ActionAvailabilitySnapshot,
  type DecisionOpportunity,
  type EvaluationSeedValue,
  type MetricResult,
} from "../../src/evaluation/baseline-contract.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const decisionAnchor = String(
  increaseGoogleShoppingBudget20.timing.decisionTime,
);

function clone<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

function opportunity(sequence = 0): DecisionOpportunity {
  return createFixedIntervalDecisionOpportunity(
    contract,
    decisionAnchor,
    sequence,
  );
}

function googleBudgetAvailability(
  decision = opportunity(),
): ActionAvailabilitySnapshot {
  return buildActionAvailabilitySnapshot(contract, decision, [
    {
      actionType: String(increaseGoogleShoppingBudget20.actionType),
      eligibleTargets: [increaseGoogleShoppingBudget20.target],
      parameterBounds: [
        {
          path: "parameters.operation.factor",
          minInclusive: 1,
          maxInclusive: 2,
        },
      ],
      requiredPreconditionIds: ["campaign_exists"],
    },
  ]);
}

function seeds(operatorId: string): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: 101 },
    { namespace: "customer_generation", value: 202 },
    { namespace: "customer_behavior", value: 303 },
    { namespace: "demand", value: 404 },
    { namespace: "advertising_response", value: 505 },
    { namespace: "journey_transitions", value: 606 },
    { namespace: "external_events", value: 707 },
    {
      namespace: "operator_internal",
      value: operatorId === "operator-a" ? 808 : 909,
      operatorId,
    },
  ];
}

function allMetricResults(): readonly MetricResult[] {
  return contract.metrics.map((metric) => ({
    metricId: metric.metricId,
    value: null,
  }));
}

function noActionDecisionRecords() {
  if (contract.cadence.kind !== "fixed_interval") {
    throw new Error("canonical test contract must use fixed_interval cadence");
  }
  const count = Math.ceil(
    contract.horizon.interventionSeconds /
      contract.cadence.intervalSeconds,
  );

  return Array.from({ length: count }, (_, sequence) => {
    const decision = opportunity(sequence);
    const observation = buildOperatorObservationSnapshot(
      contract,
      decision,
      [
        {
          observationKey: "orders.trailing_7d",
          informationClass: "derived_observable_metric" as const,
          sourceMaxOccurredAt: decision.at,
          availableAt: decision.at,
          sourceRef: "merchant-observations:v1",
          value: { orders: 12 },
        },
      ],
    );
    const availability = googleBudgetAvailability(decision);

    return {
      opportunity: decision,
      observation,
      availability,
      actionAttempts: [],
    };
  });
}

describe("Step 3.1 baseline evaluation contract", () => {
  it("freezes one canonical typed contract with deterministic fingerprinting", () => {
    expect(contract.contractId).toBe("kivviq.baseline-evaluation");
    expect(contract.contractVersion).toBe("1.0.0");
    expect(contract.actionSpace.ontologySchemaVersion).toBe(
      ACTION_SCHEMA_VERSION,
    );
    expect(contract.provenance.metricSetVersion).toBe(
      BASELINE_METRIC_SET_VERSION,
    );
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.observation)).toBe(true);
    expect(Object.isFrozen(contract.metrics)).toBe(true);

    const validated = assertValidBaselineEvaluationContract(
      JSON.parse(JSON.stringify(contract)),
    );
    expect(validated.contractFingerprint).toBe(
      contract.contractFingerprint,
    );
  });

  it("rejects silent mutation of a frozen contract fingerprint", () => {
    const mutated = clone(contract);
    mutated.horizon.warmUpSeconds += 1;

    expect(() =>
      assertValidBaselineEvaluationContract(mutated),
    ).toThrow(/fingerprint mismatch/);
  });

  it("contains every comparison-critical world component and canonical metric", () => {
    expect(contract.world.requiredComponents).toEqual(
      expect.arrayContaining([
        "merchant_characteristics",
        "products",
        "customers",
        "latent_customer_properties",
        "customer_journeys",
        "demand",
        "advertising_economics",
        "cross_channel_interactions",
        "inventory",
        "pricing",
        "retention",
        "seasonality",
        "external_events",
      ]),
    );

    expect(contract.metrics.map((metric) => metric.metricId)).toEqual(
      expect.arrayContaining([
        "revenue",
        "gross_profit",
        "contribution_profit",
        "orders",
        "units_sold",
        "aov",
        "cac",
        "roas",
        "advertising_spend",
        "new_customers",
        "repeat_customers",
        "retention",
        "clv",
        "inventory_remaining",
        "stockouts",
        "lost_demand",
        "returns",
        "discount_cost",
        "shipping_cost",
        "action_cost",
      ]),
    );
  });

  it("reproduces the same generated initial merchant world from the same seed and specification", () => {
    const config = {
      seed: 3101,
      archetype: "furniture",
      scale: "mid_market",
      complexity: "complex",
    } as const;

    const left = generateMerchantWorldRecord(config);
    const right = generateMerchantWorldRecord(config);

    expect(serializeGroundTruthManifest(left.manifest)).toBe(
      serializeGroundTruthManifest(right.manifest),
    );
    expect(left.provenance).toEqual(right.provenance);
    expect(left.summary).toEqual(right.summary);
  });

  it("gives equivalent operators the identical permitted observation snapshot", () => {
    const decision = opportunity();
    const records = [
      {
        observationKey: "orders.trailing_7d",
        informationClass: "derived_observable_metric" as const,
        sourceMaxOccurredAt: decision.at,
        availableAt: decision.at,
        sourceRef: "merchant-observations:v1",
        value: { orders: 12 },
      },
      {
        observationKey: "budget.google.current",
        informationClass: "current_state_information" as const,
        sourceMaxOccurredAt: decision.at,
        availableAt: decision.at,
        sourceRef: "merchant-state:v1",
        value: { amountMinor: 500_000, currency: "CAD" },
      },
    ];

    const left = buildOperatorObservationSnapshot(
      contract,
      decision,
      records,
    );
    const right = buildOperatorObservationSnapshot(
      contract,
      decision,
      [...records].reverse(),
    );

    expect(left.observationFingerprint).toBe(
      right.observationFingerprint,
    );
    expect(left.records).toEqual(right.records);
  });

  it("fails closed on future, latent, evaluator-only and covert hidden information", () => {
    const decision = opportunity();
    const future = new Date(
      Date.parse(decision.at) + 1_000,
    ).toISOString();

    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "future.orders",
          informationClass: "observable_merchant_data",
          sourceMaxOccurredAt: decision.at,
          availableAt: future,
          sourceRef: "merchant-observations:v1",
          value: { orders: 99 },
        },
      ]),
    ).toThrow(/future information/);

    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "latent.intent",
          informationClass: "simulator_latent_state",
          sourceMaxOccurredAt: decision.at,
          availableAt: decision.at,
          sourceRef: "merchant-observations:v1",
          value: { intent: 0.9 },
        },
      ]),
    ).toThrow(/not permitted/);

    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "true.incremental.profit",
          informationClass: "evaluator_only_metric",
          sourceMaxOccurredAt: decision.at,
          availableAt: decision.at,
          sourceRef: "merchant-observations:v1",
          value: { amountMinor: 123_000 },
        },
      ]),
    ).toThrow(/not permitted/);

    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "apparently.safe",
          informationClass: "current_state_information",
          sourceMaxOccurredAt: decision.at,
          availableAt: decision.at,
          sourceRef: "merchant-state:v1",
          value: { nested: { seed: 777 } },
        },
      ]),
    ).toThrow(/forbidden latent key/);


    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "benchmark.identity",
          informationClass: "current_state_information",
          sourceMaxOccurredAt: decision.at,
          availableAt: decision.at,
          sourceRef: "merchant-state:v1",
          value: { worldId: "synthetic-world-3101" },
        },
      ]),
    ).toThrow(/benchmark identity field/);

    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "bad.source",
          informationClass: "current_state_information",
          sourceMaxOccurredAt: decision.at,
          availableAt: decision.at,
          sourceRef: "evaluator:oracle",
          value: { safe: true },
        },
      ]),
    ).toThrow(/evaluator\/God-mode only/);

    const futureSource = new Date(
      Date.parse(decision.at) + 2_000,
    ).toISOString();
    expect(() =>
      buildOperatorObservationSnapshot(contract, decision, [
        {
          observationKey: "backdated.derived.metric",
          informationClass: "derived_observable_metric",
          sourceMaxOccurredAt: futureSource,
          availableAt: futureSource,
          sourceRef: "derived-observable:v1",
          value: { orders: 100 },
        },
      ]),
    ).toThrow(/future source events/);
  });

  it("provides identical decision opportunities at the frozen daily cadence", () => {
    const first = opportunity(0);
    const repeated = opportunity(0);
    const second = opportunity(1);

    expect(first).toEqual(repeated);
    expect(first.opportunityId).toBe(repeated.opportunityId);
    expect(
      Date.parse(second.at) - Date.parse(first.at),
    ).toBe(24 * 60 * 60 * 1_000);
  });

  it("freezes the same legal action availability and validates emitted Actions against it", () => {
    const decision = opportunity();
    const left = googleBudgetAvailability(decision);
    const right = googleBudgetAvailability(decision);

    expect(left.availabilityFingerprint).toBe(
      right.availabilityFingerprint,
    );

    const accepted = validateActionAtDecision(
      contract,
      decision,
      left,
      increaseGoogleShoppingBudget20,
    );
    expect(accepted.valid).toBe(true);

    const tooLarge = clone(increaseGoogleShoppingBudget20);
    tooLarge.parameters.operation.factor = 3;
    const rejected = validateActionAtDecision(
      contract,
      decision,
      left,
      tooLarge,
    );
    expect(rejected).toMatchObject({
      valid: false,
      code: "PARAMETER_OUT_OF_RANGE",
    });
  });

  it("does not allow an operator to delay a decision to obtain more information", () => {
    const laterDecision = opportunity(1);
    const availability = googleBudgetAvailability(laterDecision);

    const result = validateActionAtDecision(
      contract,
      laterDecision,
      availability,
      increaseGoogleShoppingBudget20,
    );

    expect(result).toMatchObject({
      valid: false,
      code: "DECISION_TIME_MISMATCH",
    });
  });

  it("deterministically rejects mutually exclusive concurrent actions", () => {
    const decision = opportunity();
    const availability = buildActionAvailabilitySnapshot(
      contract,
      decision,
      [
        {
          actionType: String(
            increaseGoogleShoppingBudget20.actionType,
          ),
          eligibleTargets: [
            increaseGoogleShoppingBudget20.target,
          ],
          parameterBounds: [],
          requiredPreconditionIds: ["campaign_exists"],
        },
        {
          actionType: String(doNothingAction.actionType),
          eligibleTargets: [doNothingAction.target],
          parameterBounds: [],
          requiredPreconditionIds: [],
        },
      ],
      [
        {
          groupId: "one-policy-per-decision",
          actionTypes: [
            String(increaseGoogleShoppingBudget20.actionType),
            String(doNothingAction.actionType),
          ],
        },
      ],
    );

    const results = validateActionBatchAtDecision(
      contract,
      decision,
      availability,
      [increaseGoogleShoppingBudget20, doNothingAction],
    );

    expect(results).toHaveLength(2);
    expect(results.every((result) => !result.valid)).toBe(true);
  });

  it("records invalid, infeasible, partial and modified outcomes without silent changes", () => {
    const infeasible = resolveActionConstraintAssessment(
      contract,
      increaseGoogleShoppingBudget20,
      [
        {
          kind: "INFEASIBLE",
          constraintRef: "budget.available_minor",
          reason: "insufficient budget",
        },
      ],
    );
    expect(infeasible.status).toBe("REJECTED");

    const partialWithoutReplacement =
      resolveActionConstraintAssessment(
        contract,
        increaseGoogleShoppingBudget20,
        [
          {
            kind: "PARTIALLY_FEASIBLE",
            constraintRef: "budget.available_minor",
            reason: "only a smaller increase is feasible",
          },
        ],
      );
    expect(partialWithoutReplacement.status).toBe("REJECTED");

    const explicitReplacement = clone(
      increaseGoogleShoppingBudget20,
    );
    explicitReplacement.actionId =
      "action_google_shopping_budget_multiply_110";
    explicitReplacement.parameters.operation.factor = 1.1;

    const modified = resolveActionConstraintAssessment(
      contract,
      increaseGoogleShoppingBudget20,
      [
        {
          kind: "PARTIALLY_FEASIBLE",
          constraintRef: "budget.available_minor",
          reason: "only a smaller increase is feasible",
        },
      ],
      explicitReplacement,
    );
    expect(modified.status).toBe("MODIFIED");
    if (modified.status === "MODIFIED") {
      expect(modified.executedActionFingerprint).not.toBe(
        modified.proposedActionFingerprint,
      );
    }
  });

  it("uses common random numbers while isolating operator-internal randomness", () => {
    const left = createEvaluationComparisonBinding(
      contract,
      "simulator-contract-binding-test",
      "world-3101",
      "world-fingerprint-3101",
      "CAD",
      decisionAnchor,
      seeds("operator-a"),
    );
    const right = createEvaluationComparisonBinding(
      contract,
      "simulator-contract-binding-test",
      "world-3101",
      "world-fingerprint-3101",
      "CAD",
      decisionAnchor,
      seeds("operator-b"),
    );

    expect(() =>
      assertEquivalentComparisonBindings(left, right),
    ).not.toThrow();
    expect(left.sharedSeeds).toEqual(right.sharedSeeds);
    expect(
      left.sharedSeeds.some(
        (seed) => seed.namespace === "operator_internal",
      ),
    ).toBe(false);

    const differentWorld = clone(right);
    differentWorld.worldFingerprint = "different-world";
    expect(() =>
      assertEquivalentComparisonBindings(left, differentWorld),
    ).toThrow(/identical comparison-critical bindings/);
  });

  it("records raw Action attempts, validation, disposition and exact executed Action", () => {
    const decision = opportunity();
    const availability = googleBudgetAvailability(decision);

    const accepted = createEvaluationActionAttemptRecord(
      contract,
      decision,
      availability,
      increaseGoogleShoppingBudget20,
    );
    expect(accepted.actionValidation.valid).toBe(true);
    expect(accepted.constraintDisposition?.status).toBe("ACCEPTED");
    expect(accepted.executedAction).toEqual(
      increaseGoogleShoppingBudget20,
    );

    const tooLarge = clone(increaseGoogleShoppingBudget20);
    tooLarge.parameters.operation.factor = 3;
    const rejected = createEvaluationActionAttemptRecord(
      contract,
      decision,
      availability,
      tooLarge,
    );
    expect(rejected.actionValidation).toMatchObject({
      valid: false,
      code: "PARAMETER_OUT_OF_RANGE",
    });
    expect(rejected.constraintDisposition).toBeUndefined();
    expect(rejected.executedAction).toBeUndefined();
  });

  it("fails artifacts closed when a recorded observation snapshot is tampered with", () => {
    const decisionRecords = clone(noActionDecisionRecords());
    decisionRecords[0].observation.records[0].value.orders = 999;

    expect(() =>
      createEvaluationRunArtifact(contract, {
        operator: {
          operatorId: "operator-a",
          operatorVersion: "1.0.0",
          operatorFingerprint: "operator-fingerprint-a",
        },
        simulatorVersion: "simulator-contract-binding-test",
        worldId: "world-3101",
        worldFingerprint: "world-fingerprint-3101",
        worldCurrency: "CAD",
        seeds: seeds("operator-a"),
        interventionStartTime: decisionAnchor,
        decisionRecords,
        outcomeSummary: {},
        metricResults: allMetricResults(),
      }),
    ).toThrow(/observation snapshot fingerprint mismatch/);
  });

  it("keeps evaluator-only metrics distinct from operator observations", () => {
    const evaluatorOnly = contract.metrics.filter(
      (metric) => metric.visibility === "evaluator_only",
    );

    expect(evaluatorOnly.map((metric) => metric.metricId)).toEqual(
      expect.arrayContaining([
        "lost_demand",
        "true_incremental_profit",
        "causal_lift",
        "counterfactual_regret",
      ]),
    );
    expect(contract.observation.forbiddenClasses).toContain(
      "evaluator_only_metric",
    );
  });

  it("produces a complete deterministic self-auditing artifact and records every no-op opportunity", () => {
    const decisionRecords = noActionDecisionRecords();
    const input = {
      operator: {
        operatorId: "operator-a",
        operatorVersion: "1.0.0",
        operatorFingerprint: "operator-fingerprint-a",
      },
      simulatorVersion: "simulator-contract-binding-test",
      worldId: "world-3101",
      worldFingerprint: "world-fingerprint-3101",
      worldCurrency: "CAD",
      seeds: seeds("operator-a"),
      interventionStartTime: decisionAnchor,
      decisionRecords,
      outcomeSummary: {
        representedOrders: 12,
      },
      metricResults: allMetricResults(),
    };

    const left = createEvaluationRunArtifact(contract, input);
    const right = createEvaluationRunArtifact(contract, input);
    const expectedHorizon = deriveEvaluationHorizonTimestamps(
      contract,
      decisionAnchor,
    );

    expect(left.evaluationRunId).toBe(right.evaluationRunId);
    expect(left.artifactFingerprint).toBe(
      right.artifactFingerprint,
    );
    expect(left.horizonTimestamps).toEqual(expectedHorizon);
    expect(left.worldCurrency).toBe("CAD");
    expect(left.metricResults).toHaveLength(
      contract.metrics.length,
    );
    expect(left.decisionRecords).toHaveLength(
      decisionRecords.length,
    );
    expect(
      left.decisionRecords.every(
        (record) => record.actionAttempts.length === 0,
      ),
    ).toBe(true);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.decisionRecords)).toBe(true);
    expect(Object.isFrozen(left.decisionRecords[0]?.observation)).toBe(true);
  });

  it("does not permit an operator to choose or omit its evaluation metrics", () => {
    const base = {
      operator: {
        operatorId: "operator-a",
        operatorVersion: "1.0.0",
        operatorFingerprint: "operator-fingerprint-a",
      },
      simulatorVersion: "simulator-contract-binding-test",
      worldId: "world-3101",
      worldFingerprint: "world-fingerprint-3101",
      worldCurrency: "CAD",
      seeds: seeds("operator-a"),
      interventionStartTime: decisionAnchor,
      decisionRecords: noActionDecisionRecords(),
      outcomeSummary: {},
    };

    expect(() =>
      createEvaluationRunArtifact(contract, {
        ...base,
        metricResults: allMetricResults().slice(1),
      }),
    ).toThrow(/every frozen metric definition/);
  });

  it("keeps the entire evaluator contract surface off the Operator-safe root API", () => {
    expect(operatorSafeApi).not.toHaveProperty(
      "CANONICAL_BASELINE_EVALUATION_CONTRACT_V1",
    );
    expect(operatorSafeApi).not.toHaveProperty(
      "createEvaluationRunArtifact",
    );
    expect(operatorSafeApi).not.toHaveProperty(
      "buildOperatorObservationSnapshot",
    );
  });

  it("fingerprints metric definitions independently of operator outcomes", () => {
    const metricFingerprint = evaluationFingerprint(
      contract.metrics,
    );

    expect(metricFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(metricFingerprint).toBe(
      evaluationFingerprint(contract.metrics),
    );
  });
});
