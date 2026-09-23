import { describe, expect, it } from "vitest";
import {
  googleBudgetUp2000,
  fullTranslationContext,
  reduceSkuPrice899To849,
  runCollectionPromotion15FourDays,
} from "../../src/action_translation/fixtures.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { featureProductAHomepage } from "../../src/merchandising/fixtures.js";
import { reorderSkuB50SupplierX } from "../../src/inventory/fixtures.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createEvaluationRunArtifact,
  createFixedIntervalDecisionOpportunity,
  deriveEvaluationHorizonTimestamps,
  evaluationFingerprint,
  type EvaluationSeedValue,
} from "../../src/evaluation/baseline-contract.js";
import {
  createOperatorEvaluationBundle,
  invokeOperatorAtDecision,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import { calculateCanonicalSimulationMetrics } from "../../src/evaluation/canonical-metrics.js";
import {
  createMerchantPolicy,
  materializeMerchantPolicyAction,
  type MerchantPolicy,
  type MerchantPolicyComponents,
  type MerchantPolicyRule,
} from "../../src/operator/merchant-policy.js";
import {
  createStatusQuoOperator,
  evaluateStatusQuoPolicy,
  STATUS_QUO_IMPLEMENTATION_FINGERPRINT,
  STATUS_QUO_OPERATOR_ID,
  STATUS_QUO_OPERATOR_VERSION,
  STATUS_QUO_FROZEN_STEP_3_1_COMMIT,
  STATUS_QUO_FROZEN_STEP_3_2_COMMIT,
} from "../../src/operator/status-quo.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { WORLD_SIMULATOR_VERSION } from "../../src/simulation/kernel.js";
import { simulateWorld } from "../../src/simulation/simulator.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-09-20T13:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function day(sequence: number): string {
  return new Date(Date.parse(START) + sequence * DAY).toISOString();
}

function baseRule(
  overrides: Partial<MerchantPolicyRule> & Pick<MerchantPolicyRule, "ruleId" | "domain" | "behaviorKey" | "kind" | "ownership">,
): any {
  return {
    description: overrides.ruleId,
    version: "1.0.0",
    sourceRef: "merchant-policy-fixture:v1",
    effectivePeriod: { start: START },
    ...overrides,
  };
}

function representativePolicy(): MerchantPolicy {
  const components: MerchantPolicyComponents = {
    advertising: {
      domain: "advertising",
      coverage: "defined",
      rules: [
        baseRule({
          kind: "maintain_state",
          ruleId: "advertising.maintain_existing_allocation",
          domain: "advertising",
          behaviorKey: "advertising.existing_allocation",
          ownership: "environment_owned",
          cadence: "continuous",
          stateRef: "merchant-state:advertising-allocation",
        }),
        baseRule({
          kind: "scheduled_action",
          ruleId: "advertising.scheduled_google_budget",
          domain: "advertising",
          behaviorKey: "advertising.google_shopping_budget_schedule",
          ownership: "operator_owned",
          cadence: "scheduled_once",
          executeAt: day(1),
          actionPrototype: googleBudgetUp2000,
          simulatorCompatibility: "supported_by_frozen_translation",
        }),
      ],
    },
    pricing: {
      domain: "pricing",
      coverage: "defined",
      rules: [
        baseRule({
          kind: "maintain_state",
          ruleId: "pricing.maintain_current_prices",
          domain: "pricing",
          behaviorKey: "pricing.current_prices",
          ownership: "environment_owned",
          cadence: "continuous",
          stateRef: "merchant-state:prices",
        }),
        baseRule({
          kind: "scheduled_action",
          ruleId: "pricing.scheduled_sku_a_price",
          domain: "pricing",
          behaviorKey: "pricing.sku_a_schedule",
          ownership: "operator_owned",
          cadence: "scheduled_once",
          executeAt: day(1),
          actionPrototype: reduceSkuPrice899To849,
          simulatorCompatibility: "supported_by_frozen_translation",
        }),
      ],
    },
    promotions: {
      domain: "promotions",
      coverage: "defined",
      rules: [
        baseRule({
          kind: "scheduled_action",
          ruleId: "promotions.scheduled_collection_sale",
          domain: "promotions",
          behaviorKey: "promotions.collection_a_fall_sale",
          ownership: "operator_owned",
          cadence: "scheduled_once",
          executeAt: day(1),
          actionPrototype: runCollectionPromotion15FourDays,
          simulatorCompatibility: "supported_by_frozen_translation",
        }),
      ],
    },
    merchandising: {
      domain: "merchandising",
      coverage: "defined",
      rules: [
        baseRule({
          kind: "maintain_state",
          ruleId: "merchandising.maintain_collection_order",
          domain: "merchandising",
          behaviorKey: "merchandising.collection_order",
          ownership: "environment_owned",
          cadence: "continuous",
          stateRef: "merchant-state:collection-order",
        }),
        baseRule({
          kind: "scheduled_action",
          ruleId: "merchandising.scheduled_homepage_feature",
          domain: "merchandising",
          behaviorKey: "merchandising.homepage_feature_schedule",
          ownership: "operator_owned",
          cadence: "scheduled_once",
          executeAt: day(2),
          actionPrototype: featureProductAHomepage,
          simulatorCompatibility: "unsupported_by_frozen_simulator",
          incompatibilityReason:
            "Frozen simulator cannot preserve rigorous merchandising surface/placement semantics.",
        }),
      ],
    },
    inventory: {
      domain: "inventory",
      coverage: "defined",
      rules: [
        baseRule({
          kind: "environment_behavior",
          ruleId: "inventory.autonomous_existing_replenishment",
          domain: "inventory",
          behaviorKey: "inventory.simulator_native_replenishment",
          ownership: "environment_owned",
          cadence: "simulator_native",
          environmentMechanismRef: "simulation.inventoryMechanisms",
        }),
        baseRule({
          kind: "observation_triggered_action",
          ruleId: "inventory.reorder_sku_b_below_10",
          domain: "inventory",
          behaviorKey: "inventory.sku_b_reorder_rule",
          ownership: "operator_owned",
          cadence: "every_decision_while_true",
          observationKey: "inventory.sku_b.available_units",
          observationValuePath: "availableUnits",
          comparison: "LT",
          threshold: 10,
          actionPrototype: reorderSkuB50SupplierX,
          simulatorCompatibility: "unsupported_by_frozen_simulator",
          incompatibilityReason:
            "Frozen simulator has no semantically correct outstanding purchase-order/receipt intervention.",
        }),
      ],
    },
  };

  return createMerchantPolicy({
    policyId: "merchant-policy:representative-v1",
    policyVersion: "1.0.0",
    description: "Representative frozen business-as-usual merchant policy.",
    source: {
      sourceRef: "merchant-policy-fixture:v1",
      capturedAt: START,
      description: "Synthetic prerealization merchant operating policy.",
    },
    effectivePeriod: { start: START },
    components,
  });
}

function emptyPolicy(): MerchantPolicy {
  const maintain = (domain: keyof MerchantPolicyComponents) => ({
    domain,
    coverage: "defined" as const,
    rules: [
      baseRule({
        kind: "maintain_state",
        ruleId: domain + ".maintain",
        domain,
        behaviorKey: domain + ".existing_state",
        ownership: "environment_owned",
        cadence: "continuous",
        stateRef: "merchant-state:" + domain,
      }),
    ],
  });

  return createMerchantPolicy({
    policyId: "merchant-policy:fixed-state-v1",
    policyVersion: "1.0.0",
    description: "Merchant with no recurring operator-owned policy Actions.",
    source: {
      sourceRef: "merchant-policy-fixture:fixed-state",
      capturedAt: START,
      description: "Synthetic fixed operating policy.",
    },
    effectivePeriod: { start: START },
    components: {
      advertising: maintain("advertising"),
      pricing: maintain("pricing"),
      promotions: {
        domain: "promotions",
        coverage: "undefined",
        rules: [],
      },
      merchandising: maintain("merchandising"),
      inventory: {
        domain: "inventory",
        coverage: "defined",
        rules: [
          baseRule({
            kind: "environment_behavior",
            ruleId: "inventory.existing_lifecycle",
            domain: "inventory",
            behaviorKey: "inventory.simulator_native_replenishment",
            ownership: "environment_owned",
            cadence: "simulator_native",
            environmentMechanismRef: "simulation.inventoryMechanisms",
          }),
        ],
      },
    },
  });
}

function opportunity(sequence: number) {
  return createFixedIntervalDecisionOpportunity(
    contract,
    START,
    sequence,
  );
}

function observation(
  sequence: number,
  values: Record<string, unknown> = {},
) {
  const o = opportunity(sequence);
  return buildOperatorObservationSnapshot(
    contract,
    o,
    Object.entries(values).map(([key, value]) => ({
      observationKey: key,
      informationClass: "current_state_information" as const,
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "merchant-state:status-quo-fixture",
      value,
    })),
  );
}

function availability(sequence: number, policy = representativePolicy()) {
  const o = opportunity(sequence);
  const actionRules = Object.values(policy.components)
    .flatMap((component) => component.rules)
    .filter(
      (rule): rule is Extract<MerchantPolicyRule, { ownership: "operator_owned" }> =>
        rule.ownership === "operator_owned",
    );
  const byType = new Map<string, { actionType: string; eligibleTargets: any[]; parameterBounds: any[]; requiredPreconditionIds: string[] }>();
  for (const rule of actionRules) {
    if (rule.kind !== "scheduled_action" && rule.kind !== "observation_triggered_action") continue;
    const action = assertValidAction(rule.actionPrototype);
    const current = byType.get(String(action.actionType)) ?? {
      actionType: String(action.actionType),
      eligibleTargets: [],
      parameterBounds: [],
      requiredPreconditionIds: [],
    };
    if (!current.eligibleTargets.some((target) => JSON.stringify(target) === JSON.stringify(action.target))) {
      current.eligibleTargets.push(action.target);
    }
    for (const precondition of action.preconditions) {
      if (!current.requiredPreconditionIds.includes(precondition.preconditionId)) {
        current.requiredPreconditionIds.push(precondition.preconditionId);
      }
    }
    byType.set(current.actionType, current);
  }
  return buildActionAvailabilitySnapshot(
    contract,
    o,
    [...byType.values()],
  );
}

function invoke(
  policy: MerchantPolicy,
  sequence: number,
  values: Record<string, unknown> = {},
) {
  const operator = createStatusQuoOperator(policy);
  const o = opportunity(sequence);
  return invokeOperatorAtDecision(
    contract,
    operator,
    o,
    observation(sequence, values),
    availability(sequence, policy),
    () => ({ issues: [] }),
  );
}

function seeds(worldSeed: number, populationSeed: number, simulationSeed: number): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: worldSeed },
    { namespace: "customer_generation", value: populationSeed },
    { namespace: "customer_behavior", value: simulationSeed },
    { namespace: "demand", value: simulationSeed },
    { namespace: "advertising_response", value: simulationSeed },
    { namespace: "journey_transitions", value: simulationSeed },
    { namespace: "external_events", value: simulationSeed },
    { namespace: "operator_internal", value: 0, operatorId: STATUS_QUO_OPERATOR_ID },
  ];
}

describe("Step 3.3 canonical STATUS_QUO baseline", () => {
  it("freezes a complete explicit merchant-policy representation and deterministic fingerprint", () => {
    const policy = representativePolicy();
    expect(policy.schemaVersion).toBe("1.0.0");
    expect(policy.policyFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    console.log(
      "STEP3_3_STATUS_QUO_REPRESENTATIVE_POLICY",
      JSON.stringify({
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        policyFingerprint: policy.policyFingerprint,
        policySchemaVersion: policy.schemaVersion,
      }),
    );
    expect(Object.keys(policy.components)).toEqual([
      "advertising",
      "pricing",
      "promotions",
      "merchandising",
      "inventory",
    ]);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("rejects merchant policy captured after the evaluation policy has begun", () => {
    const policy = representativePolicy();
    const input: any = JSON.parse(JSON.stringify(policy));
    delete input.policyFingerprint;
    input.source.capturedAt = day(1);

    expect(() => createMerchantPolicy(input)).toThrow(
      /captured before or at its effective start/,
    );
  });

  it("uses the frozen Step 3.1 contract and frozen Step 3.2 canonical operator interface", () => {
    const operator = createStatusQuoOperator(representativePolicy());
    expect(STATUS_QUO_FROZEN_STEP_3_1_COMMIT).toBe("c74e9a4ba32f16aa016f06782cbb60e07e765af6");
    expect(STATUS_QUO_FROZEN_STEP_3_2_COMMIT).toBe("a540ffd87d1ff43b96ad481aeae9d62a07b55362");
    expect(operator.metadata.supportedEvaluationContract.contractFingerprint).toBe(contract.contractFingerprint);
    expect(operator.metadata.implementationFingerprint).toBe(STATUS_QUO_IMPLEMENTATION_FINGERPRINT);
  });

  it("separates merchant state from policy and preserves fixed state without inventing Actions", () => {
    const result = invoke(representativePolicy(), 0, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
    });
    const audit = result.invocation.decisionAudit?.payload as any;
    expect(audit.evaluatedRules.some((r: any) => r.status === "MAINTAIN_STATE_NO_ACTION")).toBe(true);
    expect(result.decisionRecord.actionAttempts.length).toBe(0);
  });

  it("executes only scheduled business-as-usual Actions when their frozen date arrives", () => {
    const before = invoke(representativePolicy(), 0, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
    });
    const due = invoke(representativePolicy(), 1, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
    });
    expect(before.decisionRecord.actionAttempts).toHaveLength(0);
    expect(due.decisionRecord.actionAttempts).toHaveLength(3);
    expect(due.decisionRecord.actionAttempts.every((attempt) => attempt.actionValidation.valid)).toBe(true);
  });

  it("preserves the scheduled promotion duration rather than optimizing it", () => {
    const decision = evaluateStatusQuoPolicy(
      representativePolicy(),
      toOperatorDecisionInput(opportunity(1), observation(1, {
        "inventory.sku_b.available_units": { availableUnits: 20 },
      }), availability(1)),
    );
    const promotion = decision.actions.find((action) => String(action.actionType) === "promotion.apply_discount");
    expect(promotion).toBeDefined();
    expect(promotion?.duration).toEqual({ kind: "temporary", durationSeconds: 4 * 24 * 60 * 60 });
  });

  it("maintains merchandising ordering when no scheduled change is due", () => {
    const result = invoke(representativePolicy(), 1, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
    });
    const audit = result.invocation.decisionAudit?.payload as any;
    const fixed = audit.evaluatedRules.find((r: any) => r.ruleId === "merchandising.maintain_collection_order");
    expect(fixed.status).toBe("MAINTAIN_STATE_NO_ACTION");
  });

  it("triggers the frozen inventory reorder rule exactly from permitted observation data", () => {
    const high = invoke(representativePolicy(), 2, {
      "inventory.sku_b.available_units": { availableUnits: 10 },
    });
    const low = invoke(representativePolicy(), 2, {
      "inventory.sku_b.available_units": { availableUnits: 9 },
    });
    const highInventoryActions = high.decisionRecord.actionAttempts.filter((attempt) =>
      attempt.actionValidation.valid &&
      String(attempt.actionValidation.action.actionType).startsWith("inventory."),
    );
    const lowInventoryActions = low.decisionRecord.actionAttempts.filter((attempt) =>
      attempt.actionValidation.valid &&
      String(attempt.actionValidation.action.actionType).startsWith("inventory."),
    );
    expect(highInventoryActions).toHaveLength(0);
    expect(lowInventoryActions).toHaveLength(1);

    const lowAudit = low.invocation.decisionAudit?.payload as any;
    expect(lowAudit.incompatibleRuleIds).toContain(
      "inventory.reorder_sku_b_below_10",
    );
    expect(lowAudit.benchmarkCompatibility).toBe(
      "incompatible_required_policy_semantics",
    );
  });

  it("identifies a policy/observation incompatibility rather than leaking hidden inventory truth", () => {
    const result = invoke(representativePolicy(), 3, {});
    const audit = result.invocation.decisionAudit?.payload as any;
    expect(audit.incompatibleRuleIds).toContain("inventory.reorder_sku_b_below_10");
    expect(audit.benchmarkCompatibility).toBe(
      "incompatible_required_policy_semantics",
    );
    expect(result.decisionRecord.actionAttempts).toHaveLength(0);
  });

  it("structurally prevents the same behavior from being both environment-owned and operator-owned", () => {
    const policy = representativePolicy();
    const input: any = JSON.parse(JSON.stringify(policy));
    delete input.policyFingerprint;
    input.components.inventory.rules.push({
      ...input.components.inventory.rules[1],
      ruleId: "inventory.duplicate_owner",
      behaviorKey: "inventory.simulator_native_replenishment",
    });
    expect(() => createMerchantPolicy(input)).toThrow(/both environment-owned and operator-owned/);
  });

  it("does not duplicate environment-owned simulator replenishment as an operator Action", () => {
    const policy = emptyPolicy();
    const result = invoke(policy, 0, {});
    const audit = result.invocation.decisionAudit?.payload as any;
    const inventory = audit.evaluatedRules.find((r: any) => r.ruleId === "inventory.existing_lifecycle");
    expect(inventory.status).toBe("ENVIRONMENT_OWNED_NO_OPERATOR_ACTION");
    expect(result.decisionRecord.actionAttempts).toEqual([]);
  });

  it("handles undefined policy domains without inventing behavior", () => {
    const policy = emptyPolicy();
    expect(policy.components.promotions.coverage).toBe("undefined");
    expect(policy.components.promotions.rules).toEqual([]);
    const result = invoke(policy, 0, {});
    expect(result.decisionRecord.actionAttempts).toEqual([]);
  });

  it("is policy-preserving rather than optimization-responsive", () => {
    const policy = representativePolicy();
    const badWorld = invoke(policy, 3, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
      "performance.roas": { value: 1000 },
      "performance.cac": { value: 999999 },
      "performance.conversion": { value: 0.00001 },
      "performance.margin": { value: -1 },
    });
    const normalWorld = invoke(policy, 3, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
      "performance.roas": { value: 1 },
      "performance.cac": { value: 10 },
      "performance.conversion": { value: 0.03 },
      "performance.margin": { value: 0.4 },
    });
    expect(badWorld.invocation.outputFingerprint).toBe(normalWorld.invocation.outputFingerprint);
    expect(badWorld.decisionRecord.actionAttempts).toEqual([]);
  });

  it("is semantically distinct from DO_NOTHING when a pre-existing policy Action is due", () => {
    const policy = representativePolicy();
    const o = opportunity(1);
    const obs = observation(1, {
      "inventory.sku_b.available_units": { availableUnits: 20 },
    });
    const avail = availability(1, policy);
    const statusQuo = createStatusQuoOperator(policy).decide(
      toOperatorDecisionInput(o, obs, avail),
    );
    const doNothing = DO_NOTHING_OPERATOR.decide(
      toOperatorDecisionInput(o, obs, avail),
    );
    expect(statusQuo.actions.length).toBe(3);
    expect(doNothing.actions).toEqual([]);
  });

  it("may legitimately match DO_NOTHING for merchants with no recurring operator-owned policy", () => {
    const policy = emptyPolicy();
    const o = opportunity(0);
    const obs = observation(0, {});
    const avail = availability(0, policy);
    expect(createStatusQuoOperator(policy).decide(toOperatorDecisionInput(o, obs, avail)).actions).toEqual([]);
    expect(DO_NOTHING_OPERATOR.decide(toOperatorDecisionInput(o, obs, avail)).actions).toEqual([]);
  });

  it("emits only canonical Action Ontology objects", () => {
    const decision = evaluateStatusQuoPolicy(
      representativePolicy(),
      toOperatorDecisionInput(opportunity(1), observation(1, {
        "inventory.sku_b.available_units": { availableUnits: 20 },
      }), availability(1)),
    );
    expect(decision.actions.length).toBeGreaterThan(0);
    for (const action of decision.actions) {
      expect(assertValidAction(action)).toEqual(action);
      expect(action.provenance.source).toBe("rule_based_baseline");
    }
  });

  it("preserves translation-supported policy Actions and explicitly exposes unsupported simulator semantics", () => {
    const policy = representativePolicy();
    const scheduledAdvertising = policy.components.advertising.rules[1] as any;
    const scheduledPricing = policy.components.pricing.rules[1] as any;
    const scheduledPromotion = policy.components.promotions.rules[0] as any;
    const scheduledMerch = policy.components.merchandising.rules[1] as any;
    const inventoryRule = policy.components.inventory.rules[1] as any;

    for (const rule of [scheduledAdvertising, scheduledPricing, scheduledPromotion]) {
      const action = materializeMerchantPolicyAction(rule, rule.executeAt);
      const translated = translateBusinessAction(action, {
        ...fullTranslationContext,
        simulatorClock: action.timing.decisionTime,
      });
      expect(translated.status).toBe("TRANSLATED");
    }

    const merch = materializeMerchantPolicyAction(scheduledMerch, scheduledMerch.executeAt);
    expect(translateBusinessAction(merch, { ...fullTranslationContext, simulatorClock: merch.timing.decisionTime })).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "MERCHANDISING_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
    });

    const inventory = materializeMerchantPolicyAction(inventoryRule, day(2));
    expect(translateBusinessAction(inventory, { ...fullTranslationContext, simulatorClock: inventory.timing.decisionTime })).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "INVENTORY_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
    });
  });

  it("records every decision opportunity, policy rules evaluated and triggered rules deterministically", () => {
    const policy = representativePolicy();
    const operator = createStatusQuoOperator(policy);
    const count = 90;
    const decisions = Array.from({ length: count }, (_, sequence) => {
      const values = {
        "inventory.sku_b.available_units": {
          availableUnits: sequence === 2 ? 9 : 20,
        },
      };
      return invoke(policy, sequence, values);
    });
    expect(decisions).toHaveLength(90);
    expect(new Set(decisions.map((d) => d.invocation.opportunityId)).size).toBe(90);
    expect(decisions.every((d) => d.invocation.decisionAudit?.auditType === "merchant_policy_evaluation")).toBe(true);
    expect(operator.metadata.deterministicConfiguration).toMatchObject({
      merchantPolicyVersion: "1.0.0",
      merchantPolicyFingerprint: policy.policyFingerprint,
    });
  });

  it("produces complete provenance and canonical metrics while natural business dynamics continue", () => {
    const policy = emptyPolicy();
    const operator = createStatusQuoOperator(policy);
    const world = generateMerchantWorldRecord({
      seed: 63003,
      archetype: "replenishment_heavy",
      scale: "growth",
      complexity: "normal",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 7203,
      populationConfig: { maxExplicitAgents: 160, complexity: "normal" },
    });
    const horizon = deriveEvaluationHorizonTimestamps(contract, START);
    const simulationSeed = 103;
    const result = simulateWorld({
      merchantWorld: world,
      latentPopulation: population,
      simulationSeed,
      startTime: horizon.warmUpStart,
      endTime: horizon.delayedEffectEnd,
      interventions: [],
      commercePolicy: { executeInventoryLifecycle: true },
      config: { maxEvents: 220_000, maxSessionsPerCustomer: 18 },
    });

    expect(result.provenance.interventions).toEqual([]);
    expect(result.observableEvents.length).toBeGreaterThan(0);
    expect(result.totals.representedOrders).toBeGreaterThan(0);
    expect(result.totals.representedRevenueMinor).toBeGreaterThan(0);

    const decisions = Array.from({ length: 90 }, (_, sequence) =>
      invoke(policy, sequence, {}),
    );
    expect(decisions.every((d) => d.decisionRecord.actionAttempts.length === 0)).toBe(true);

    const metrics = calculateCanonicalSimulationMetrics(
      contract,
      horizon,
      result,
      population,
      { actionCostMinor: 0 },
    );
    expect(metrics).toHaveLength(contract.metrics.length);
    expect(metrics.find((m) => m.metricId === "action_cost")?.value).toBe(0);

    const artifact = createEvaluationRunArtifact(contract, {
      operator: {
        operatorId: STATUS_QUO_OPERATOR_ID,
        operatorVersion: STATUS_QUO_OPERATOR_VERSION,
        operatorFingerprint: STATUS_QUO_IMPLEMENTATION_FINGERPRINT,
      },
      simulatorVersion: WORLD_SIMULATOR_VERSION,
      worldId: String(world.manifest.worldId),
      worldFingerprint: evaluationFingerprint(world.manifest),
      worldCurrency: String(world.manifest.merchant.currency),
      seeds: seeds(world.manifest.seed, population.populationSeed, simulationSeed),
      interventionStartTime: START,
      decisionRecords: decisions.map((d) => d.decisionRecord),
      outcomeSummary: {
        representedOrders: result.totals.representedOrders,
        representedRevenueMinor: result.totals.representedRevenueMinor,
        statusQuoPolicyFingerprint: policy.policyFingerprint,
      },
      metricResults: metrics,
    });
    const bundle = createOperatorEvaluationBundle(
      artifact,
      decisions.map((d) => d.invocation),
      operator.metadata,
    );
    expect((bundle.operatorMetadata?.deterministicConfiguration as any).merchantPolicyFingerprint).toBe(policy.policyFingerprint);
    expect(bundle.operatorInvocations.every((i) => i.decisionAudit?.auditType === "merchant_policy_evaluation")).toBe(true);
    console.log("STEP3_3_STATUS_QUO_FIXED_POLICY", JSON.stringify({
      policyFingerprint: policy.policyFingerprint,
      operatorFingerprint: STATUS_QUO_IMPLEMENTATION_FINGERPRINT,
      simulatorVersion: WORLD_SIMULATOR_VERSION,
      worldId: String(world.manifest.worldId),
      worldFingerprint: evaluationFingerprint(world.manifest),
      decisionOpportunityCount: decisions.length,
      operatorActionCount: 0,
      representedTotals: result.totals,
      metricResults: metrics,
      evaluationArtifactFingerprint: artifact.artifactFingerprint,
      operatorEvaluationBundleFingerprint: bundle.bundleFingerprint,
    }));
  }, 60_000);

  it("reproduces identical decisions from identical policy and governed input", () => {
    const policy = representativePolicy();
    const operator = createStatusQuoOperator(policy);
    const input = toOperatorDecisionInput(
      opportunity(2),
      observation(2, {
        "inventory.sku_b.available_units": { availableUnits: 9 },
      }),
      availability(2, policy),
    );
    expect(operator.decide(input)).toEqual(operator.decide(input));
    expect(operator.auditDecision?.(input, operator.decide(input))).toEqual(
      operator.auditDecision?.(input, operator.decide(input)),
    );
  });
});
