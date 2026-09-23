import { describe, expect, it } from "vitest";
import { actionId } from "../../src/action_ontology/identity.js";
import type { Action } from "../../src/action_ontology/types.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { fullTranslationContext } from "../../src/action_translation/fixtures.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  assertEquivalentComparisonBindings,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createEvaluationComparisonBinding,
  createEvaluationRunArtifact,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
  type EvaluationSeedValue,
} from "../../src/evaluation/baseline-contract.js";
import {
  createOperatorEvaluationBundle,
  invokeOperatorAtDecision,
  toOperatorDecisionInput,
} from "../../src/evaluation/operator-evaluation.js";
import {
  EQUAL_BUDGET_ALLOCATION_OPERATOR,
} from "../../src/operator/advertising-heuristics.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import {
  FIXED_REORDER_QUANTITY_CONFIG,
  FIXED_REORDER_QUANTITY_OPERATOR,
  FIXED_REORDER_THRESHOLD_CONFIG,
  FIXED_REORDER_THRESHOLD_OPERATOR,
  FROZEN_INVENTORY_HEURISTIC_CONFIGURATIONS,
  INVENTORY_HEURISTIC_BASELINE_OPERATORS,
  INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
  INVENTORY_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
  INVENTORY_HEURISTIC_METRIC_SET_VERSION,
  INVENTORY_HEURISTIC_OBSERVATION_KEY,
  INVENTORY_HEURISTIC_OPERATOR_VERSION,
  INVENTORY_HEURISTIC_SIMULATOR_VERSION,
  LOW_INVENTORY_DEPROMOTION_CONFIG,
  LOW_INVENTORY_DEPROMOTION_OPERATOR,
  NO_INVENTORY_AWARE_INTERVENTION_CONFIG,
  NO_INVENTORY_AWARE_INTERVENTION_OPERATOR,
  createInventoryHeuristicOperator,
  inventoryHeuristicConfigurationFingerprint,
  type InventoryHeuristicConfig,
  type InventorySkuObservation,
} from "../../src/operator/inventory-heuristics.js";
import { STATUS_QUO_OPERATOR_ID } from "../../src/operator/status-quo.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";

function sku(
  availableUnits: number | null,
  overrides: Partial<InventorySkuObservation> = {},
): InventorySkuObservation {
  return {
    skuId: "sku:B",
    productId: "product:B",
    active: true,
    discontinued: false,
    availableUnits,
    incomingUnits: 0,
    pendingReorder: false,
    observableReorderTriggered: false,
    existingReorderQuantityUnits: 50,
    supplierAvailable: true,
    activePromotionIds: ["promo_collection_x_auto_15"],
    ...overrides,
  };
}

function opportunity(sequence = 0) {
  return createFixedIntervalDecisionOpportunity(contract, START, sequence);
}

function observation(
  sequence = 0,
  skus: readonly InventorySkuObservation[] = [sku(20)],
  extras: readonly {
    readonly observationKey: string;
    readonly value: unknown;
  }[] = [],
) {
  const o = opportunity(sequence);
  return buildOperatorObservationSnapshot(contract, o, [
    {
      observationKey: INVENTORY_HEURISTIC_OBSERVATION_KEY,
      informationClass: "current_state_information",
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "inventory-ledger:step3.5-inventory-state",
      value: {
        schemaVersion: "1.0.0",
        availabilityConcept: "AVAILABLE_TO_SELL",
        skus,
      },
    },
    ...extras.map((extra) => ({
      observationKey: extra.observationKey,
      informationClass: "current_state_information" as const,
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "merchant-state:step3.5-adversarial-context",
      value: extra.value,
    })),
  ]);
}

function availability(
  sequence = 0,
  options: {
    readonly reorderAvailable?: boolean;
    readonly depromotionAvailable?: boolean;
    readonly reorderQuantityMin?: number;
    readonly reorderQuantityMax?: number;
    readonly reorderRequiredPreconditions?: readonly string[];
    readonly promotionRequiredPreconditions?: readonly string[];
  } = {},
) {
  const o = opportunity(sequence);
  const rules = [];

  if (options.reorderAvailable !== false) {
    rules.push({
      actionType: "inventory.reorder",
      eligibleTargets: [
        {
          kind: "sku" as const,
          productId: "product:B",
          skuId: "sku:B",
        },
      ],
      parameterBounds:
        options.reorderQuantityMin === undefined &&
        options.reorderQuantityMax === undefined
          ? []
          : [
              {
                path: "parameters.reorder.quantity",
                ...(options.reorderQuantityMin === undefined
                  ? {}
                  : { minInclusive: options.reorderQuantityMin }),
                ...(options.reorderQuantityMax === undefined
                  ? {}
                  : { maxInclusive: options.reorderQuantityMax }),
              },
            ],
      requiredPreconditionIds:
        options.reorderRequiredPreconditions ?? [],
    });
  }

  if (options.depromotionAvailable !== false) {
    rules.push({
      actionType: "promotion.stop",
      eligibleTargets: [
        {
          kind: "promotion" as const,
          promotionId: "promo_collection_x_auto_15",
        },
      ],
      parameterBounds: [],
      requiredPreconditionIds:
        options.promotionRequiredPreconditions ?? [],
    });
  }

  return buildActionAvailabilitySnapshot(contract, o, rules);
}

function decision(
  operator: typeof FIXED_REORDER_THRESHOLD_OPERATOR,
  skus: readonly InventorySkuObservation[] = [sku(20)],
  options: {
    readonly sequence?: number;
    readonly availability?: Parameters<typeof availability>[1];
    readonly extras?: readonly {
      readonly observationKey: string;
      readonly value: unknown;
    }[];
  } = {},
) {
  const sequence = options.sequence ?? 0;
  const o = opportunity(sequence);
  const obs = observation(sequence, skus, options.extras ?? []);
  const avail = availability(sequence, options.availability ?? {});
  const input = toOperatorDecisionInput(o, obs, avail);
  const output = operator.decide(input);
  const audit = operator.auditDecision?.(input, output);
  return { o, obs, avail, input, output, audit };
}

function reorderQuantity(action: Action): number {
  expect(String(action.actionType)).toBe("inventory.reorder");
  expect(action.actionCategory).toBe("inventory");
  expect(action.parameters.kind).toBe("inventory_reorder");
  if (action.parameters.kind !== "inventory_reorder") {
    throw new Error("unexpected inventory Action");
  }
  return action.parameters.reorder.quantity;
}

function seeds(operatorId: string): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: 3501 },
    { namespace: "customer_generation", value: 3502 },
    { namespace: "customer_behavior", value: 3503 },
    { namespace: "demand", value: 3504 },
    { namespace: "advertising_response", value: 3505 },
    { namespace: "journey_transitions", value: 3506 },
    { namespace: "external_events", value: 3507 },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId,
    },
  ];
}

describe("Step 3.5 simple inventory heuristic baselines", () => {
  it("freezes four independent canonical operators and configurations", () => {
    expect(Object.keys(INVENTORY_HEURISTIC_BASELINE_OPERATORS)).toEqual([
      "FIXED_REORDER_THRESHOLD",
      "FIXED_REORDER_QUANTITY",
      "LOW_INVENTORY_DEPROMOTION",
      "NO_INVENTORY_AWARE_INTERVENTION",
    ]);
    const operators = Object.values(INVENTORY_HEURISTIC_BASELINE_OPERATORS);
    expect(new Set(operators.map((operator) => operator.metadata.operatorId)).size).toBe(4);
    expect(
      new Set(
        operators.map(
          (operator) => operator.metadata.implementationFingerprint,
        ),
      ).size,
    ).toBe(4);

    for (const operator of operators) {
      expect(operator.metadata.operatorVersion).toBe(
        INVENTORY_HEURISTIC_OPERATOR_VERSION,
      );
      expect(operator.metadata.supportedEvaluationContract.contractFingerprint).toBe(
        contract.contractFingerprint,
      );
      expect(operator.metadata.supportedActionOntologyVersion).toBe(
        contract.actionSpace.ontologySchemaVersion,
      );
      const cfg = operator.metadata.deterministicConfiguration as any;
      expect(cfg.configurationFingerprint).toMatch(
        /^fnv1a64:[0-9a-f]{16}$/,
      );
      expect(cfg.metricSetVersion).toBe(
        INVENTORY_HEURISTIC_METRIC_SET_VERSION,
      );
      expect(cfg.simulatorVersion).toBe(
        INVENTORY_HEURISTIC_SIMULATOR_VERSION,
      );
      expect(cfg.frozenParentCommit).toBe(
        INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
      );
    }
  });

  it("keeps reorder-threshold and reorder-quantity semantics separable", () => {
    const threshold = decision(
      FIXED_REORDER_THRESHOLD_OPERATOR,
      [
        sku(9, {
          existingReorderQuantityUnits: 30,
          observableReorderTriggered: false,
        }),
      ],
    );
    expect(threshold.output.actions).toHaveLength(1);
    expect(reorderQuantity(threshold.output.actions[0]!)).toBe(30);

    const quantity = decision(
      FIXED_REORDER_QUANTITY_OPERATOR,
      [
        sku(100, {
          existingReorderQuantityUnits: 30,
          observableReorderTriggered: true,
        }),
      ],
    );
    expect(quantity.output.actions).toHaveLength(1);
    expect(reorderQuantity(quantity.output.actions[0]!)).toBe(50);
  });

  describe("FIXED_REORDER_THRESHOLD", () => {
    it.each([
      [11, 0, "ABOVE_THRESHOLD_NO_TRIGGER"],
      [10, 0, "EXACTLY_AT_THRESHOLD_NO_TRIGGER"],
      [9, 1, "BELOW_THRESHOLD_TRIGGERED"],
      [0, 1, "BELOW_THRESHOLD_TRIGGERED"],
    ])(
      "uses strict LT threshold semantics at inventory %s",
      (availableUnits, actionCount, triggerResult) => {
        const result = decision(
          FIXED_REORDER_THRESHOLD_OPERATOR,
          [sku(availableUnits)],
        );
        expect(result.output.actions).toHaveLength(actionCount);
        expect((result.audit?.payload as any).triggerResult).toBe(
          triggerResult,
        );
      },
    );

    it("uses the observable existing reorder quantity exactly", () => {
      const result = decision(
        FIXED_REORDER_THRESHOLD_OPERATOR,
        [sku(9, { existingReorderQuantityUnits: 40 })],
      );
      expect(reorderQuantity(result.output.actions[0]!)).toBe(40);
    });

    it("does nothing when observable inventory is missing", () => {
      const result = decision(
        FIXED_REORDER_THRESHOLD_OPERATOR,
        [sku(null)],
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "AVAILABLE_INVENTORY_MISSING",
      );
    });

    it("suppresses reorder while replenishment is pending or inbound", () => {
      const pending = decision(
        FIXED_REORDER_THRESHOLD_OPERATOR,
        [sku(1, { pendingReorder: true })],
      );
      const inbound = decision(
        FIXED_REORDER_THRESHOLD_OPERATOR,
        [sku(1, { incomingUnits: 20 })],
      );
      expect(pending.output.actions).toEqual([]);
      expect(inbound.output.actions).toEqual([]);
      expect((pending.audit?.payload as any).fallbackReason).toBe(
        "PENDING_REPLENISHMENT_SUPPRESSES_REORDER",
      );
      expect((inbound.audit?.payload as any).fallbackReason).toBe(
        "PENDING_REPLENISHMENT_SUPPRESSES_REORDER",
      );
    });

    it("requires observable inbound state rather than hidden simulator state", () => {
      const result = decision(
        FIXED_REORDER_THRESHOLD_OPERATOR,
        [sku(1, { pendingReorder: null, incomingUnits: null })],
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "INBOUND_REORDER_STATE_MISSING",
      );
    });
  });

  describe("FIXED_REORDER_QUANTITY", () => {
    it("orders the frozen 50-unit quantity when the observable trigger fires", () => {
      const result = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(100, { observableReorderTriggered: true })],
      );
      expect(result.output.actions).toHaveLength(1);
      expect(reorderQuantity(result.output.actions[0]!)).toBe(50);
    });

    it("does not change the fixed quantity because inventory is very low", () => {
      const low = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(1, { observableReorderTriggered: true })],
      );
      const higher = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(100, { observableReorderTriggered: true })],
      );
      expect(reorderQuantity(low.output.actions[0]!)).toBe(50);
      expect(reorderQuantity(higher.output.actions[0]!)).toBe(50);
    });

    it("respects maximum post-receipt inventory without optimizing quantity", () => {
      const result = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(160, { observableReorderTriggered: true })],
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "MAXIMUM_POST_RECEIPT_INVENTORY_EXCEEDED",
      );
    });

    it("respects observable supplier unavailability", () => {
      const result = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [
          sku(1, {
            observableReorderTriggered: true,
            supplierAvailable: false,
          }),
        ],
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "SUPPLIER_UNAVAILABLE",
      );
    });

    it("respects frozen supplier quantity constraints", () => {
      const operator = createInventoryHeuristicOperator({
        ...FIXED_REORDER_QUANTITY_CONFIG,
        supplierConstraints: {
          minimumOrderQuantity: 10,
          orderMultiple: 10,
          maximumSupplierQuantity: 40,
        },
      });
      const result = decision(
        operator as any,
        [sku(1, { observableReorderTriggered: true })],
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "FIXED_QUANTITY_VIOLATES_SUPPLIER_CONSTRAINTS",
      );
    });

    it("prevents duplicate reorder output when replenishment is already pending", () => {
      const result = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [
          sku(1, {
            observableReorderTriggered: true,
            pendingReorder: true,
          }),
        ],
      );
      expect(result.output.actions).toEqual([]);
    });

    it("uses a deterministic Action ID for the same SKU and decision opportunity", () => {
      const first = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(1, { observableReorderTriggered: true })],
      );
      const second = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(1, { observableReorderTriggered: true })],
      );
      expect(first.output.actions).toHaveLength(1);
      expect(second.output.actions).toHaveLength(1);
      expect(first.output.actions[0]!.actionId).toBe(
        second.output.actions[0]!.actionId,
      );
    });

    it("does not propose an order outside frozen legal Action bounds", () => {
      const result = decision(
        FIXED_REORDER_QUANTITY_OPERATOR,
        [sku(1, { observableReorderTriggered: true })],
        {
          availability: {
            reorderQuantityMax: 40,
          },
        },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "INVENTORY_REORDER_OUTSIDE_LEGAL_BOUNDS",
      );
    });
  });

  describe("LOW_INVENTORY_DEPROMOTION", () => {
    it.each([
      [10, 0, "HEALTHY_INVENTORY_NO_DEPROMOTION"],
      [5, 0, "EXACTLY_AT_THRESHOLD_NO_DEPROMOTION"],
      [4, 1, "LOW_INVENTORY_DEPROMOTION_TRIGGERED"],
      [0, 1, "LOW_INVENTORY_DEPROMOTION_TRIGGERED"],
    ])(
      "uses strict low-inventory threshold semantics at %s units",
      (availableUnits, actionCount, triggerResult) => {
        const result = decision(
          LOW_INVENTORY_DEPROMOTION_OPERATOR,
          [sku(availableUnits)],
        );
        expect(result.output.actions).toHaveLength(actionCount);
        expect((result.audit?.payload as any).triggerResult).toBe(
          triggerResult,
        );
        if (actionCount === 1) {
          const action = result.output.actions[0]!;
          expect(String(action.actionType)).toBe("promotion.stop");
          expect(action.actionCategory).toBe("promotion");
          expect(action.parameters).toEqual({
            kind: "promotion_stop",
            targetPromotionId: "promo_collection_x_auto_15",
          });
        }
      },
    );

    it("has explicit no-automatic-restoration semantics after inventory recovers", () => {
      expect(
        LOW_INVENTORY_DEPROMOTION_CONFIG.restorationBehavior,
      ).toBe("NO_AUTOMATIC_RESTORATION");
      const recovered = decision(
        LOW_INVENTORY_DEPROMOTION_OPERATOR,
        [sku(20, { activePromotionIds: [] })],
      );
      expect(recovered.output.actions).toEqual([]);
    });

    it("does nothing when the configured promotion is not currently active", () => {
      const result = decision(
        LOW_INVENTORY_DEPROMOTION_OPERATOR,
        [sku(1, { activePromotionIds: [] })],
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "CONFIGURED_PROMOTION_NOT_ACTIVE",
      );
    });

    it("does nothing when the canonical promotion-stop intervention is unavailable", () => {
      const result = decision(
        LOW_INVENTORY_DEPROMOTION_OPERATOR,
        [sku(1)],
        { availability: { depromotionAvailable: false } },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "PROMOTION_STOP_ACTION_UNAVAILABLE",
      );
    });
  });

  describe("NO_INVENTORY_AWARE_INTERVENTION", () => {
    it.each([100, 20, 1, 0])(
      "never creates an inventory-aware Action at %s available units",
      (availableUnits) => {
        const result = decision(
          NO_INVENTORY_AWARE_INTERVENTION_OPERATOR,
          [sku(availableUnits)],
        );
        expect(result.output.actions).toEqual([]);
        expect((result.audit?.payload as any).triggerResult).toBe(
          "INVENTORY_STATE_INTENTIONALLY_IGNORED",
        );
      },
    );

    it("is an explicit domain control distinct from DO_NOTHING", () => {
      expect(
        NO_INVENTORY_AWARE_INTERVENTION_OPERATOR.metadata.operatorId,
      ).not.toBe(DO_NOTHING_OPERATOR.metadata.operatorId);
      const result = decision(
        NO_INVENTORY_AWARE_INTERVENTION_OPERATOR,
        [sku(0)],
      );
      expect(result.audit?.auditType).toBe(
        "inventory_heuristic_evaluation",
      );
      expect(
        NO_INVENTORY_AWARE_INTERVENTION_CONFIG.inventoryPolicyEffect,
      ).toBe(
        "INVENTORY_CONDITIONS_NEVER_CREATE_DISCRETIONARY_ACTION",
      );
    });
  });

  it("emits only canonical Actions in the permitted Step 3.5 decision domain", () => {
    const reorder = decision(
      FIXED_REORDER_QUANTITY_OPERATOR,
      [sku(1, { observableReorderTriggered: true })],
    ).output.actions[0]!;
    const depromotion = decision(
      LOW_INVENTORY_DEPROMOTION_OPERATOR,
      [sku(1)],
    ).output.actions[0]!;

    expect(assertValidAction(reorder)).toEqual(reorder);
    expect(assertValidAction(depromotion)).toEqual(depromotion);
    expect(String(reorder.actionType)).toBe("inventory.reorder");
    expect(String(depromotion.actionType)).toBe("promotion.stop");
  });

  it("passes reorder proposals through accepted, rejected and explicit modified constraint outcomes", () => {
    const o = opportunity(0);
    const obs = observation(0, [
      sku(1, { observableReorderTriggered: true }),
    ]);
    const avail = availability(0);

    const accepted = invokeOperatorAtDecision(
      contract,
      FIXED_REORDER_QUANTITY_OPERATOR,
      o,
      obs,
      avail,
      () => ({ issues: [] }),
    );
    expect(
      accepted.decisionRecord.actionAttempts[0]?.constraintDisposition
        ?.status,
    ).toBe("ACCEPTED");

    const rejected = invokeOperatorAtDecision(
      contract,
      FIXED_REORDER_QUANTITY_OPERATOR,
      o,
      obs,
      avail,
      () => ({
        issues: [
          {
            kind: "INFEASIBLE" as const,
            constraintRef: "warehouse_capacity",
            reason: "Synthetic warehouse capacity rejection.",
          },
        ],
      }),
    );
    expect(
      rejected.decisionRecord.actionAttempts[0]?.constraintDisposition
        ?.status,
    ).toBe("REJECTED");
    expect(
      rejected.decisionRecord.actionAttempts[0]?.executedAction,
    ).toBeUndefined();

    const modified = invokeOperatorAtDecision(
      contract,
      FIXED_REORDER_QUANTITY_OPERATOR,
      o,
      obs,
      avail,
      (action) => {
        if (action.parameters.kind !== "inventory_reorder") {
          throw new Error("unexpected Action");
        }
        const replacement = assertValidAction({
          ...action,
          actionId: actionId(String(action.actionId) + "_modified"),
          parameters: {
            kind: "inventory_reorder",
            reorder: {
              ...action.parameters.reorder,
              quantity: 40,
            },
          },
        });
        return {
          issues: [
            {
              kind: "PARTIALLY_FEASIBLE" as const,
              constraintRef: "supplier_partial_capacity",
              reason: "Supplier can fulfill only 40 units.",
            },
          ],
          explicitModifiedAction: replacement,
        };
      },
    );
    expect(
      modified.decisionRecord.actionAttempts[0]?.constraintDisposition
        ?.status,
    ).toBe("MODIFIED");
    expect(
      modified.decisionRecord.actionAttempts[0]?.executedAction,
    ).toBeDefined();
    expect(
      reorderQuantity(
        modified.decisionRecord.actionAttempts[0]!.executedAction!,
      ),
    ).toBe(40);
  });

  it("remains deliberately simple under adversarial current-state context", () => {
    const ordinary = decision(
      FIXED_REORDER_THRESHOLD_OPERATOR,
      [sku(9, { existingReorderQuantityUnits: 50 })],
    );
    const adversarial = decision(
      FIXED_REORDER_THRESHOLD_OPERATOR,
      [sku(9, { existingReorderQuantityUnits: 50 })],
      {
        extras: [
          {
            observationKey: "inventory.adversarial_current_context",
            value: {
              recentDemandSpike: true,
              recentDemandCollapse: false,
              highMarginSku: true,
              longObservedSupplierLeadTime: true,
              currentOverstockElsewhere: true,
              promotionEconomicsStrong: true,
            },
          },
        ],
      },
    );
    expect(adversarial.output).toEqual(ordinary.output);
  });

  it("structurally excludes future demand and hidden state by using only the governed inventory observation", () => {
    const audit = decision(
      FIXED_REORDER_THRESHOLD_OPERATOR,
      [sku(9)],
    ).audit?.payload as any;
    expect(audit.dependencies.evaluationContractFingerprint).toBe(
      contract.contractFingerprint,
    );
    expect(
      (
        FIXED_REORDER_THRESHOLD_OPERATOR.metadata
          .deterministicConfiguration as any
      ).hiddenStateAccess,
    ).toBe(false);
    expect(
      (
        FIXED_REORDER_THRESHOLD_OPERATOR.metadata
          .deterministicConfiguration as any
      ).demandForecasting,
    ).toBe(false);
  });

  it("exposes frozen simulator incompatibility instead of approximating reorder or promotion stop", () => {
    const reorder = decision(
      FIXED_REORDER_QUANTITY_OPERATOR,
      [sku(1, { observableReorderTriggered: true })],
    ).output.actions[0]!;
    const depromotion = decision(
      LOW_INVENTORY_DEPROMOTION_OPERATOR,
      [sku(1)],
    ).output.actions[0]!;

    const reorderTranslation = translateBusinessAction(
      reorder,
      {
        ...fullTranslationContext,
        simulatorClock: reorder.timing.decisionTime,
      },
    );
    const depromotionTranslation = translateBusinessAction(
      depromotion,
      {
        ...fullTranslationContext,
        simulatorClock: depromotion.timing.decisionTime,
      },
    );

    expect(reorderTranslation).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "INVENTORY_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
    });
    expect(depromotionTranslation).toMatchObject({
      status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
      code: "PROMOTION_LIFECYCLE_UNSUPPORTED_BY_SIMULATOR",
    });
  });

  it("preserves paired-comparison bindings with existing baseline operators", () => {
    const worldId = "step3.5.synthetic-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    const doNothing = createEvaluationComparisonBinding(
      contract,
      INVENTORY_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(DO_NOTHING_OPERATOR.metadata.operatorId),
    );
    const statusQuo = createEvaluationComparisonBinding(
      contract,
      INVENTORY_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(STATUS_QUO_OPERATOR_ID),
    );
    const advertising = createEvaluationComparisonBinding(
      contract,
      INVENTORY_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(EQUAL_BUDGET_ALLOCATION_OPERATOR.metadata.operatorId),
    );
    assertEquivalentComparisonBindings(doNothing, statusQuo);
    assertEquivalentComparisonBindings(doNothing, advertising);

    for (const operator of Object.values(
      INVENTORY_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const binding = createEvaluationComparisonBinding(
        contract,
        INVENTORY_HEURISTIC_SIMULATOR_VERSION,
        worldId,
        worldFingerprint,
        "CAD",
        START,
        seeds(operator.metadata.operatorId),
      );
      assertEquivalentComparisonBindings(doNothing, binding);
    }
  });

  it("produces complete reproducible 90-opportunity artifacts for every inventory heuristic", () => {
    const worldId = "step3.5.artifact-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    for (const operator of Object.values(
      INVENTORY_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const decisions = Array.from({ length: 90 }, (_, sequence) => {
        const triggered =
          sequence === 0 &&
          operator.metadata.operatorId !==
            NO_INVENTORY_AWARE_INTERVENTION_OPERATOR.metadata.operatorId;
        const item =
          operator.metadata.operatorId ===
          FIXED_REORDER_THRESHOLD_OPERATOR.metadata.operatorId
            ? sku(triggered ? 9 : 20)
            : operator.metadata.operatorId ===
                FIXED_REORDER_QUANTITY_OPERATOR.metadata.operatorId
              ? sku(20, {
                  observableReorderTriggered: triggered,
                })
              : operator.metadata.operatorId ===
                  LOW_INVENTORY_DEPROMOTION_OPERATOR.metadata.operatorId
                ? sku(triggered ? 4 : 20)
                : sku(sequence % 4 === 0 ? 0 : 20);

        return invokeOperatorAtDecision(
          contract,
          operator,
          opportunity(sequence),
          observation(sequence, [item]),
          availability(sequence),
          () => ({ issues: [] }),
        );
      });

      const artifact = createEvaluationRunArtifact(contract, {
        operator: {
          operatorId: operator.metadata.operatorId,
          operatorVersion: operator.metadata.operatorVersion,
          operatorFingerprint:
            operator.metadata.implementationFingerprint,
        },
        simulatorVersion: INVENTORY_HEURISTIC_SIMULATOR_VERSION,
        worldId,
        worldFingerprint,
        worldCurrency: "CAD",
        seeds: seeds(operator.metadata.operatorId),
        interventionStartTime: START,
        decisionRecords: decisions.map(
          (entry) => entry.decisionRecord,
        ),
        outcomeSummary: {
          syntheticContractFixture: true,
          proposedActionCount: decisions.reduce(
            (sum, entry) =>
              sum + entry.invocation.proposedActionCount,
            0,
          ),
          simulatorExecutionCompatibility:
            operator.metadata.operatorId ===
            NO_INVENTORY_AWARE_INTERVENTION_OPERATOR.metadata.operatorId
              ? "compatible_no_required_intervention"
              : "frozen_simulator_cannot_faithfully_execute_required_inventory_or_promotion_lifecycle_action",
        },
        metricResults: contract.metrics.map((metric) => ({
          metricId: metric.metricId,
          value: null,
        })),
      });
      const bundle = createOperatorEvaluationBundle(
        artifact,
        decisions.map((entry) => entry.invocation),
        operator.metadata,
      );

      expect(artifact.decisionRecords).toHaveLength(90);
      expect(artifact.contractFingerprint).toBe(
        contract.contractFingerprint,
      );
      expect(artifact.metricSetVersion).toBe("1.0.0");
      expect(
        bundle.operatorInvocations.every(
          (invocation) =>
            invocation.decisionAudit?.auditType ===
            "inventory_heuristic_evaluation",
        ),
      ).toBe(true);
      expect(
        bundle.operatorMetadata?.deterministicConfiguration,
      ).toBeDefined();
    }
  });

  it("freezes preregistered inventory configurations and fingerprints", () => {
    const configs: readonly InventoryHeuristicConfig[] = [
      FIXED_REORDER_THRESHOLD_CONFIG,
      FIXED_REORDER_QUANTITY_CONFIG,
      LOW_INVENTORY_DEPROMOTION_CONFIG,
      NO_INVENTORY_AWARE_INTERVENTION_CONFIG,
    ];
    const configFingerprints = Object.fromEntries(
      configs.map((config) => [
        config.heuristicType,
        inventoryHeuristicConfigurationFingerprint(config),
      ]),
    );

    expect(new Set(Object.values(configFingerprints)).size).toBe(4);
    for (const fingerprint of Object.values(configFingerprints)) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }

    console.log(
      "STEP3_5_INVENTORY_HEURISTIC_FREEZE",
      JSON.stringify({
        parentCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
        operatorVersion: INVENTORY_HEURISTIC_OPERATOR_VERSION,
        implementationFingerprints:
          INVENTORY_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
        configurationFingerprints: configFingerprints,
        frozenConfigurations:
          FROZEN_INVENTORY_HEURISTIC_CONFIGURATIONS,
      }),
    );
  });
});
