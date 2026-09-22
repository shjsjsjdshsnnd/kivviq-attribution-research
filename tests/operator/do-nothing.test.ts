import { describe, expect, it } from "vitest";
import * as operatorSafeApi from "../../src/index.js";
import { ACTION_SCHEMA_VERSION } from "../../src/action_ontology/types.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  assertEquivalentComparisonBindings,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createEvaluationComparisonBinding,
  createEvaluationRunArtifact,
  createFixedIntervalDecisionOpportunity,
  deriveEvaluationHorizonTimestamps,
  evaluationFingerprint,
  type ActionAvailabilitySnapshot,
  type DecisionOpportunity,
  type EvaluationObservationDatum,
  type EvaluationSeedValue,
} from "../../src/evaluation/baseline-contract.js";
import {
  createOperatorEvaluationBundle,
  invokeOperatorAtDecision,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import { calculateCanonicalSimulationMetrics } from "../../src/evaluation/canonical-metrics.js";
import {
  DO_NOTHING_CONFIGURATION,
  DO_NOTHING_FROZEN_STEP_3_1_COMMIT,
  DO_NOTHING_IMPLEMENTATION_FINGERPRINT,
  DO_NOTHING_METADATA,
  DO_NOTHING_OPERATOR,
  DO_NOTHING_OPERATOR_ID,
  DO_NOTHING_OPERATOR_VERSION,
  DO_NOTHING_SUPPORTED_CONTRACT_FINGERPRINT,
} from "../../src/operator/do-nothing.js";
import { WORLD_SIMULATOR_VERSION } from "../../src/simulation/kernel.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import type { SimulationResult } from "../../src/simulation/types.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const INTERVENTION_START = "2026-05-01T00:00:00.000Z";
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

function decision(sequence = 0): DecisionOpportunity {
  return createFixedIntervalDecisionOpportunity(
    contract,
    INTERVENTION_START,
    sequence,
  );
}

function availabilityFor(
  opportunity: DecisionOpportunity,
  productId = "product:synthetic",
): ActionAvailabilitySnapshot {
  return buildActionAvailabilitySnapshot(contract, opportunity, [
    {
      actionType: "pricing.adjust_price",
      eligibleTargets: [{ kind: "product", productId }],
      parameterBounds: [],
      requiredPreconditionIds: [],
    },
    {
      actionType: "promotion.apply_discount",
      eligibleTargets: [{ kind: "product", productId }],
      parameterBounds: [],
      requiredPreconditionIds: [],
    },
    {
      actionType: "inventory.protect_inventory",
      eligibleTargets: [{ kind: "product", productId }],
      parameterBounds: [],
      requiredPreconditionIds: [],
    },
    {
      actionType: "advertising.adjust_budget",
      eligibleTargets: [
        { kind: "advertising_channel", channelId: "meta" },
      ],
      parameterBounds: [],
      requiredPreconditionIds: [],
    },
  ]);
}

function observationFor(
  opportunity: DecisionOpportunity,
  observationKey: string,
  value: unknown,
): ReturnType<typeof buildOperatorObservationSnapshot> {
  const sourceMinOccurredAt = new Date(
    Date.parse(opportunity.at) - 7 * ONE_DAY_MS,
  ).toISOString();

  return buildOperatorObservationSnapshot(contract, opportunity, [
    {
      observationKey,
      informationClass: "derived_observable_metric",
      sourceMinOccurredAt,
      sourceMaxOccurredAt: opportunity.at,
      availableAt: opportunity.at,
      sourceRef: "derived-observable:step3.2-test-v1",
      value,
    },
  ]);
}

function fixedCadenceCount(): number {
  if (contract.cadence.kind !== "fixed_interval") {
    throw new Error("frozen Step 3.1 contract must use fixed_interval cadence");
  }
  return Math.ceil(
    contract.horizon.interventionSeconds /
      contract.cadence.intervalSeconds,
  );
}

function seedsFor(
  worldSeed: number,
  populationSeed: number,
  simulationSeed: number,
): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: worldSeed },
    { namespace: "customer_generation", value: populationSeed },
    { namespace: "customer_behavior", value: simulationSeed },
    { namespace: "demand", value: simulationSeed },
    { namespace: "advertising_response", value: simulationSeed },
    { namespace: "journey_transitions", value: simulationSeed },
    { namespace: "external_events", value: simulationSeed },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId: DO_NOTHING_OPERATOR_ID,
    },
  ];
}

function simulationObservation(
  opportunity: DecisionOpportunity,
  result: SimulationResult,
): ReturnType<typeof buildOperatorObservationSnapshot> {
  const endMs = Date.parse(opportunity.at);
  const startMs = endMs - 7 * ONE_DAY_MS;

  const events = result.observableEvents.filter((event) => {
    const occurredAt = Date.parse(event.occurredAt);
    return occurredAt >= startMs && occurredAt < endMs;
  });
  const purchases = result.purchases.filter((purchase) => {
    const occurredAt = Date.parse(purchase.occurredAt);
    return occurredAt >= startMs && occurredAt < endMs;
  });

  return buildOperatorObservationSnapshot(contract, opportunity, [
    {
      observationKey: "business.trailing_7d",
      informationClass: "derived_observable_metric",
      sourceMinOccurredAt: new Date(startMs).toISOString(),
      sourceMaxOccurredAt: opportunity.at,
      availableAt: opportunity.at,
      sourceRef: "derived-observable:simulator-projection-v1",
      value: {
        observableEventCount: events.length,
        purchaseCount: purchases.length,
        netRevenueMinor: purchases.reduce(
          (sum, purchase) => sum + purchase.netRevenueMinor,
          0,
        ),
      },
    },
  ]);
}

describe("Step 3.2 canonical DO_NOTHING baseline", () => {
  it("freezes the canonical operator identity, configuration and exact Step 3.1 dependency", () => {
    expect(DO_NOTHING_OPERATOR_ID).toBe("baseline.do_nothing");
    expect(DO_NOTHING_OPERATOR_VERSION).toBe("1.0.0");
    expect(DO_NOTHING_FROZEN_STEP_3_1_COMMIT).toBe(
      "c74e9a4ba32f16aa016f06782cbb60e07e765af6",
    );
    expect(DO_NOTHING_SUPPORTED_CONTRACT_FINGERPRINT).toBe(
      contract.contractFingerprint,
    );
    expect(DO_NOTHING_METADATA.supportedActionOntologyVersion).toBe(
      ACTION_SCHEMA_VERSION,
    );
    expect(
      DO_NOTHING_METADATA.supportedEvaluationContract.contractVersion,
    ).toBe(contract.contractVersion);
    expect(DO_NOTHING_IMPLEMENTATION_FINGERPRINT).toMatch(
      /^fnv1a64:[0-9a-f]{16}$/,
    );
    expect(DO_NOTHING_METADATA.implementationFingerprint).toBe(
      DO_NOTHING_IMPLEMENTATION_FINGERPRINT,
    );
    expect(Object.isFrozen(DO_NOTHING_METADATA)).toBe(true);
    expect(Object.isFrozen(DO_NOTHING_CONFIGURATION)).toBe(true);
    expect(Object.isFrozen(DO_NOTHING_OPERATOR)).toBe(true);
  });

  it("contains no business threshold, forecasting, optimization or recommendation policy", () => {
    const serialized = JSON.stringify(
      DO_NOTHING_CONFIGURATION,
    ).toLowerCase();

    expect(serialized).not.toMatch(
      /roas|cac|inventory|revenue|profit|margin|forecast|recommend|optim|threshold|causal/,
    );
    expect(DO_NOTHING_CONFIGURATION).toEqual({
      policy: "always_return_empty_action_array",
      discretionaryActionLimit: 0,
      usesPolicyRandomness: false,
      readsBusinessConditionsToChooseIntervention: false,
      discretionaryInterventionsEnabled: false,
    });
  });

  it("uses the normal operator/evaluator interface and explicitly records no discretionary Action", () => {
    const opportunity = decision();
    const observation = observationFor(
      opportunity,
      "business.snapshot",
      { orders: 12, conversionRate: 0.021 },
    );
    const availability = availabilityFor(opportunity);

    const left = invokeOperatorAtDecision(
      contract,
      DO_NOTHING_OPERATOR,
      opportunity,
      observation,
      availability,
    );
    const right = invokeOperatorAtDecision(
      contract,
      DO_NOTHING_OPERATOR,
      opportunity,
      observation,
      availability,
    );

    expect(left).toEqual(right);
    expect(left.invocation.disposition).toBe(
      "NO_DISCRETIONARY_ACTIONS",
    );
    expect(left.invocation.proposedActionCount).toBe(0);
    expect(left.invocation.outputFingerprint).toBe(
      evaluationFingerprint({ actions: [] }),
    );
    expect(left.decisionRecord.actionAttempts).toEqual([]);
    expect(left.decisionRecord.observation).toEqual(observation);
    expect(left.decisionRecord.availability).toEqual(availability);
  });

  it("returns Action[] = [] rather than fabricating a no-op Action object", () => {
    const opportunity = decision();
    const observation = observationFor(
      opportunity,
      "business.snapshot",
      { orders: 10 },
    );
    const availability = availabilityFor(opportunity);
    const input = toOperatorDecisionInput(
      opportunity,
      observation,
      availability,
    );

    const output = DO_NOTHING_OPERATOR.decide(input);

    expect(output).toEqual({ actions: [] });
    expect(output.actions).toHaveLength(0);
    expect(
      output.actions.some(
        (action) =>
          String(action.actionType) === "no_op.do_nothing",
      ),
    ).toBe(false);
  });

  it.each([
    ["extremely high ROAS", { roas: 999 }],
    ["collapsed ROAS", { roas: 0.01 }],
    ["critically low inventory", { availableUnits: 1 }],
    ["sold-out product", { availableUnits: 0, soldOut: true }],
    ["demand spike", { demandIndex: 9.5 }],
    ["conversion collapse", { conversionRate: 0.0001 }],
    ["margin deterioration", { contributionMarginBasisPoints: 50 }],
    [
      "large promotional opportunity",
      { promotionOpportunityIndex: 100 },
    ],
    [
      "another product becomes much more profitable",
      { relativeProductContributionIndex: 25 },
    ],
  ])(
    "is policy-invariant when %s",
    (_label, condition) => {
      const opportunity = decision();
      const observation = observationFor(
        opportunity,
        "adversarial.business.condition",
        condition,
      );
      const evaluated = invokeOperatorAtDecision(
        contract,
        DO_NOTHING_OPERATOR,
        opportunity,
        observation,
        availabilityFor(opportunity),
      );

      expect(evaluated.invocation.proposedActionCount).toBe(0);
      expect(evaluated.decisionRecord.actionAttempts).toEqual([]);
      expect(evaluated.invocation.disposition).toBe(
        "NO_DISCRETIONARY_ACTIONS",
      );
    },
  );

  it("invokes the operator at every frozen decision opportunity and records every explicit no-action result", () => {
    const count = fixedCadenceCount();
    const evaluated = Array.from(
      { length: count },
      (_, sequence) => {
        const opportunity = decision(sequence);
        return invokeOperatorAtDecision(
          contract,
          DO_NOTHING_OPERATOR,
          opportunity,
          observationFor(
            opportunity,
            "business.snapshot",
            { sequence },
          ),
          availabilityFor(opportunity),
        );
      },
    );

    expect(evaluated).toHaveLength(count);
    expect(
      new Set(
        evaluated.map(
          (entry) => entry.invocation.opportunityId,
        ),
      ).size,
    ).toBe(count);
    expect(
      evaluated.every(
        (entry) =>
          entry.invocation.disposition ===
            "NO_DISCRETIONARY_ACTIONS" &&
          entry.invocation.proposedActionCount === 0 &&
          entry.decisionRecord.actionAttempts.length === 0,
      ),
    ).toBe(true);
  });

  it("cannot receive hidden, future or evaluator-only information because it must use the Step 3.1 observation boundary", () => {
    const opportunity = decision();

    const prohibited: readonly EvaluationObservationDatum[] = [
      {
        observationKey: "hidden.intent",
        informationClass: "simulator_latent_state",
        sourceMinOccurredAt: opportunity.at,
        sourceMaxOccurredAt: opportunity.at,
        availableAt: opportunity.at,
        sourceRef: "derived-observable:test",
        value: { intent: 0.99 },
      },
      {
        observationKey: "oracle.metric",
        informationClass: "evaluator_only_metric",
        sourceMinOccurredAt: opportunity.at,
        sourceMaxOccurredAt: opportunity.at,
        availableAt: opportunity.at,
        sourceRef: "derived-observable:test",
        value: { amountMinor: 123 },
      },
    ];

    for (const record of prohibited) {
      expect(() =>
        buildOperatorObservationSnapshot(
          contract,
          opportunity,
          [record],
        ),
      ).toThrow(/not permitted/);
    }

    const future = new Date(
      Date.parse(opportunity.at) + 1_000,
    ).toISOString();
    expect(() =>
      buildOperatorObservationSnapshot(contract, opportunity, [
        {
          observationKey: "future.metric",
          informationClass: "derived_observable_metric",
          sourceMinOccurredAt: future,
          sourceMaxOccurredAt: future,
          availableAt: future,
          sourceRef: "derived-observable:test",
          value: { orders: 99 },
        },
      ]),
    ).toThrow(/future/);
  });

  it(
    "proves no operator intervention is distinct from no business activity and produces a complete canonical artifact",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 62002,
        archetype: "replenishment_heavy",
        scale: "growth",
        complexity: "normal",
      });
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 7102,
        populationConfig: {
          maxExplicitAgents: 180,
          complexity: "normal",
          maxCategoryPreferences: 4,
          maxProductPreferences: 6,
        },
      });
      const horizon = deriveEvaluationHorizonTimestamps(
        contract,
        INTERVENTION_START,
      );
      const simulationSeed = 92;

      const result = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed,
        startTime: horizon.warmUpStart,
        endTime: horizon.delayedEffectEnd,
        interventions: [],
        config: {
          maxEvents: 220_000,
          maxSessionsPerCustomer: 18,
        },
      });

      expect(result.provenance.simulatorVersion).toBe(
        WORLD_SIMULATOR_VERSION,
      );
      expect(result.provenance.interventions).toEqual([]);
      expect(result.observableEvents.length).toBeGreaterThan(0);
      expect(result.purchases.length).toBeGreaterThan(0);
      expect(result.totals.representedOrders).toBeGreaterThan(0);
      expect(
        result.totals.representedRevenueMinor,
      ).toBeGreaterThan(0);

      const fulfilledUnits = result.purchases.reduce(
        (sum, purchase) =>
          sum +
          purchase.lines.reduce(
            (lineSum, line) => lineSum + line.quantity,
            0,
          ),
        0,
      );
      const realizedCosts = result.purchases.reduce(
        (sum, purchase) =>
          sum +
          purchase.estimatedCogsMinor +
          purchase.fulfillmentMinor +
          purchase.shippingSubsidyMinor +
          purchase.paymentFeeMinor,
        0,
      );
      expect(fulfilledUnits).toBeGreaterThan(0);
      expect(realizedCosts).toBeGreaterThan(0);

      const productId =
        world.manifest.productDemandMechanisms[0]?.productId ??
        "product:synthetic";
      const decisions = Array.from(
        { length: fixedCadenceCount() },
        (_, sequence) => {
          const opportunity = decision(sequence);
          return invokeOperatorAtDecision(
            contract,
            DO_NOTHING_OPERATOR,
            opportunity,
            simulationObservation(opportunity, result),
            availabilityFor(opportunity, productId),
          );
        },
      );

      expect(
        decisions.every(
          (entry) =>
            entry.invocation.proposedActionCount === 0 &&
            entry.decisionRecord.actionAttempts.length === 0,
        ),
      ).toBe(true);

      const metricResults =
        calculateCanonicalSimulationMetrics(
          contract,
          horizon,
          result,
          population,
          { actionCostMinor: 0 },
        );

      const metric = (metricId: string) =>
        metricResults.find(
          (candidate) => candidate.metricId === metricId,
        )?.value;

      expect(metricResults).toHaveLength(contract.metrics.length);
      expect(metric("orders")).not.toBeNull();
      expect(Number(metric("orders"))).toBeGreaterThan(0);
      expect(Number(metric("revenue"))).toBeGreaterThan(0);
      expect(Number(metric("units_sold"))).toBeGreaterThan(0);
      expect(metric("action_cost")).toBe(0);

      const seeds = seedsFor(
        world.manifest.seed,
        population.populationSeed,
        simulationSeed,
      );
      const evaluationArtifact = createEvaluationRunArtifact(
        contract,
        {
          operator: {
            operatorId: DO_NOTHING_OPERATOR_ID,
            operatorVersion: DO_NOTHING_OPERATOR_VERSION,
            operatorFingerprint:
              DO_NOTHING_IMPLEMENTATION_FINGERPRINT,
          },
          simulatorVersion: result.provenance.simulatorVersion,
          worldId: String(world.manifest.worldId),
          worldFingerprint: evaluationFingerprint(
            world.manifest,
          ),
          worldCurrency: String(world.manifest.merchant.currency),
          seeds,
          interventionStartTime: INTERVENTION_START,
          decisionRecords: decisions.map(
            (entry) => entry.decisionRecord,
          ),
          outcomeSummary: {
            representedOrders:
              result.totals.representedOrders,
            representedRevenueMinor:
              result.totals.representedRevenueMinor,
            representedContributionProfitMinor:
              result.totals.representedContributionProfitMinor,
            observableEventCount:
              result.totals.observableEventCount,
            operatorDiscretionaryActionCount: 0,
          },
          metricResults,
        },
      );

      const bundle = createOperatorEvaluationBundle(
        evaluationArtifact,
        decisions.map((entry) => entry.invocation),
      );

      expect(bundle.evaluationArtifact.operator).toEqual({
        operatorId: DO_NOTHING_OPERATOR_ID,
        operatorVersion: DO_NOTHING_OPERATOR_VERSION,
        operatorFingerprint:
          DO_NOTHING_IMPLEMENTATION_FINGERPRINT,
      });
      expect(
        bundle.operatorInvocations.every(
          (invocation) =>
            invocation.disposition ===
              "NO_DISCRETIONARY_ACTIONS" &&
            invocation.proposedActionCount === 0,
        ),
      ).toBe(true);
      expect(
        bundle.evaluationArtifact.decisionRecords.every(
          (record) => record.actionAttempts.length === 0,
        ),
      ).toBe(true);
      expect(bundle.bundleFingerprint).toMatch(
        /^fnv1a64:[0-9a-f]{16}$/,
      );
      expect(Object.isFrozen(bundle)).toBe(true);
    },
    60_000,
  );

  it("preserves everything required for a future shared-randomness paired comparison", () => {
    const seeds = seedsFor(62002, 7102, 92);
    const left = createEvaluationComparisonBinding(
      contract,
      WORLD_SIMULATOR_VERSION,
      "world-paired-test",
      "world-fingerprint-paired-test",
      "CAD",
      INTERVENTION_START,
      seeds,
    );
    const hypotheticalOtherOperatorSeeds = seeds.map((seed) =>
      seed.namespace === "operator_internal"
        ? {
            ...seed,
            value: 999,
            operatorId: "baseline.other",
          }
        : seed,
    );
    const right = createEvaluationComparisonBinding(
      contract,
      WORLD_SIMULATOR_VERSION,
      "world-paired-test",
      "world-fingerprint-paired-test",
      "CAD",
      INTERVENTION_START,
      hypotheticalOtherOperatorSeeds,
    );

    expect(() =>
      assertEquivalentComparisonBindings(left, right),
    ).not.toThrow();
  });

  it("keeps evaluator/simulator internals off the Operator-safe API while exposing the canonical operator contract", () => {
    expect(operatorSafeApi).toHaveProperty(
      "DO_NOTHING_OPERATOR",
    );
    expect(operatorSafeApi).toHaveProperty(
      "DO_NOTHING_IMPLEMENTATION_FINGERPRINT",
    );
    expect(operatorSafeApi).not.toHaveProperty("simulateWorld");
    expect(operatorSafeApi).not.toHaveProperty(
      "createEvaluationRunArtifact",
    );
    expect(operatorSafeApi).not.toHaveProperty(
      "invokeOperatorAtDecision",
    );
    expect(operatorSafeApi).not.toHaveProperty(
      "createGroundTruthEvaluatorAccess",
    );
  });
});
