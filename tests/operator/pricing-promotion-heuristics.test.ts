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
import { EQUAL_BUDGET_ALLOCATION_OPERATOR } from "../../src/operator/advertising-heuristics.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { FIXED_REORDER_THRESHOLD_OPERATOR } from "../../src/operator/inventory-heuristics.js";
import {
  EXCESS_INVENTORY_DISCOUNT_CONFIG,
  EXCESS_INVENTORY_DISCOUNT_OPERATOR,
  FIXED_DISCOUNT_CONFIG,
  FIXED_DISCOUNT_OPERATOR,
  FIXED_PROMOTIONAL_CALENDAR_CONFIG,
  FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
  FROZEN_PRICING_PROMOTION_HEURISTIC_CONFIGURATIONS,
  NEVER_DISCOUNT_CONFIG,
  NEVER_DISCOUNT_OPERATOR,
  PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS,
  PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
  PRICING_PROMOTION_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
  PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION,
  PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY,
  PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION,
  PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
  createPricingPromotionHeuristicOperator,
  pricingPromotionHeuristicConfigurationFingerprint,
  type PricingPromotionHeuristicConfig,
  type PricingPromotionSkuObservation,
} from "../../src/operator/pricing-promotion-heuristics.js";
import { STATUS_QUO_OPERATOR_ID } from "../../src/operator/status-quo.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const REGULAR_PRICE = 89_900;
const FIXED_DISCOUNT_PRICE = 80_910;
const EXCESS_DISCOUNT_PRICE = 76_415;

function day(sequence: number): string {
  return new Date(Date.parse(START) + sequence * DAY_MS).toISOString();
}

function sku(
  overrides: Partial<PricingPromotionSkuObservation> = {},
): PricingPromotionSkuObservation {
  return {
    skuId: "sku:A",
    productId: "product:A",
    active: true,
    excluded: false,
    promotionEligible: true,
    currency: "CAD",
    currentPriceMinor: REGULAR_PRICE,
    regularPriceMinor: REGULAR_PRICE,
    currentDiscountBasisPoints: 0,
    currentDiscountOwner: "none",
    observableInventoryUnits: 50,
    activePromotionIds: [],
    promotionOwners: {},
    activeHeuristicRuleIds: [],
    heuristicRuleStartedAt: {},
    ...overrides,
  };
}

function opportunity(sequence = 0) {
  return createFixedIntervalDecisionOpportunity(contract, START, sequence);
}

function observation(
  sequence = 0,
  item: PricingPromotionSkuObservation = sku(),
  extras: readonly {
    readonly observationKey: string;
    readonly value: unknown;
  }[] = [],
) {
  const o = opportunity(sequence);
  return buildOperatorObservationSnapshot(contract, o, [
    {
      observationKey: PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY,
      informationClass: "current_state_information",
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "commerce-ledger:step3.6-pricing-promotion-state",
      value: {
        schemaVersion: "1.0.0",
        timezone: "UTC",
        skus: [item],
      },
    },
    ...extras.map((extra) => ({
      observationKey: extra.observationKey,
      informationClass: "current_state_information" as const,
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "merchant-state:step3.6-adversarial-context",
      value: extra.value,
    })),
  ]);
}

function availability(
  sequence = 0,
  options: {
    readonly pricingAvailable?: boolean;
    readonly promotionStartAvailable?: boolean;
    readonly minimumPriceMinor?: number;
    readonly maximumPriceMinor?: number;
    readonly pricingRequiredPreconditions?: readonly string[];
    readonly promotionRequiredPreconditions?: readonly string[];
  } = {},
) {
  const o = opportunity(sequence);
  const rules = [];

  if (options.pricingAvailable !== false) {
    rules.push({
      actionType: "pricing.adjust_price",
      eligibleTargets: [
        {
          kind: "sku" as const,
          productId: "product:A",
          skuId: "sku:A",
        },
      ],
      parameterBounds:
        options.minimumPriceMinor === undefined &&
        options.maximumPriceMinor === undefined
          ? []
          : [
              {
                path: "parameters.operation.value.amountMinor",
                ...(options.minimumPriceMinor === undefined
                  ? {}
                  : { minInclusive: options.minimumPriceMinor }),
                ...(options.maximumPriceMinor === undefined
                  ? {}
                  : { maxInclusive: options.maximumPriceMinor }),
              },
            ],
      requiredPreconditionIds:
        options.pricingRequiredPreconditions ?? [],
    });
  }

  if (options.promotionStartAvailable !== false) {
    rules.push({
      actionType: "promotion.start",
      eligibleTargets: FIXED_PROMOTIONAL_CALENDAR_CONFIG.calendar.map(
        (entry) => ({
          kind: "promotion" as const,
          promotionId: entry.promotionId,
        }),
      ),
      parameterBounds: [],
      requiredPreconditionIds:
        options.promotionRequiredPreconditions ?? [],
    });
  }

  return buildActionAvailabilitySnapshot(contract, o, rules);
}

function decision(
  operator: typeof NEVER_DISCOUNT_OPERATOR,
  item: PricingPromotionSkuObservation = sku(),
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
  const obs = observation(sequence, item, options.extras ?? []);
  const avail = availability(sequence, options.availability ?? {});
  const input = toOperatorDecisionInput(o, obs, avail);
  const output = operator.decide(input);
  const audit = operator.auditDecision?.(input, output);
  return { o, obs, avail, input, output, audit };
}

function priceTarget(action: Action): number {
  expect(String(action.actionType)).toBe("pricing.adjust_price");
  expect(action.actionCategory).toBe("pricing");
  expect(action.parameters.kind).toBe("price_adjustment");
  if (
    action.parameters.kind !== "price_adjustment" ||
    action.parameters.operation.kind !== "SET"
  ) {
    throw new Error("unexpected pricing Action");
  }
  return action.parameters.operation.value.amountMinor;
}

function seeds(operatorId: string): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: 3601 },
    { namespace: "customer_generation", value: 3602 },
    { namespace: "customer_behavior", value: 3603 },
    { namespace: "demand", value: 3604 },
    { namespace: "advertising_response", value: 3605 },
    { namespace: "journey_transitions", value: 3606 },
    { namespace: "external_events", value: 3607 },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId,
    },
  ];
}

describe("Step 3.6 simple pricing and promotion heuristic baselines", () => {
  it("freezes four independent canonical operator identities and configurations", () => {
    expect(
      Object.keys(PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS),
    ).toEqual([
      "NEVER_DISCOUNT",
      "FIXED_DISCOUNT",
      "EXCESS_INVENTORY_DISCOUNT",
      "FIXED_PROMOTIONAL_CALENDAR",
    ]);

    const operators = Object.values(
      PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS,
    );
    expect(
      new Set(operators.map((operator) => operator.metadata.operatorId))
        .size,
    ).toBe(4);
    expect(
      new Set(
        operators.map(
          (operator) => operator.metadata.implementationFingerprint,
        ),
      ).size,
    ).toBe(4);

    for (const operator of operators) {
      expect(operator.metadata.operatorVersion).toBe(
        PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION,
      );
      expect(
        operator.metadata.supportedEvaluationContract.contractFingerprint,
      ).toBe(contract.contractFingerprint);
      expect(operator.metadata.supportedActionOntologyVersion).toBe(
        contract.actionSpace.ontologySchemaVersion,
      );
      const cfg =
        operator.metadata.deterministicConfiguration as any;
      expect(cfg.configurationFingerprint).toMatch(
        /^fnv1a64:[0-9a-f]{16}$/,
      );
      expect(cfg.metricSetVersion).toBe(
        PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION,
      );
      expect(cfg.simulatorVersion).toBe(
        PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      );
      expect(cfg.frozenParentCommit).toBe(
        PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
      );
    }
  });

  it("rejects incomplete or invalid promotional-calendar configuration before evaluation", () => {
    expect(() =>
      createPricingPromotionHeuristicOperator({
        ...FIXED_PROMOTIONAL_CALENDAR_CONFIG,
        calendar: [],
      }),
    ).toThrow(/requires at least one entry/);

    expect(() =>
      createPricingPromotionHeuristicOperator({
        ...FIXED_PROMOTIONAL_CALENDAR_CONFIG,
        calendar: [
          {
            ...FIXED_PROMOTIONAL_CALENDAR_CONFIG.calendar[0]!,
            endAt:
              FIXED_PROMOTIONAL_CALENDAR_CONFIG.calendar[0]!.startAt,
          },
        ],
      }),
    ).toThrow(/valid increasing UTC dates/);
  });

  describe("NEVER_DISCOUNT", () => {
    it("maintains a regular-price product without discretionary Action", () => {
      const result = decision(NEVER_DISCOUNT_OPERATOR, sku());
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).ruleEvaluation).toBe(
        "REGULAR_PRICE_MAINTAINED",
      );
    });

    it("removes an existing merchant-discretionary discount at the first valid opportunity", () => {
      const result = decision(
        NEVER_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: FIXED_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1000,
          currentDiscountOwner: "merchant_discretionary",
        }),
      );
      expect(result.output.actions).toHaveLength(1);
      expect(priceTarget(result.output.actions[0]!)).toBe(REGULAR_PRICE);
      expect((result.audit?.payload as any).restorationActionIds).toEqual([
        String(result.output.actions[0]!.actionId),
      ]);
    });

    it("preserves environment and STATUS_QUO-owned discounts", () => {
      for (const owner of ["environment", "status_quo"] as const) {
        const result = decision(
          NEVER_DISCOUNT_OPERATOR,
          sku({
            currentPriceMinor: FIXED_DISCOUNT_PRICE,
            currentDiscountBasisPoints: 1000,
            currentDiscountOwner: owner,
          }),
        );
        expect(result.output.actions).toEqual([]);
        expect((result.audit?.payload as any).ownershipEvaluation).toBe(
          "PRESERVE_NON_HEURISTIC_DISCOUNT_OWNER:" + owner,
        );
      }
    });

    it("does not re-restore after the price is already regular", () => {
      const first = decision(
        NEVER_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: FIXED_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1000,
          currentDiscountOwner: "merchant_discretionary",
        }),
      );
      const second = decision(
        NEVER_DISCOUNT_OPERATOR,
        sku(),
        { sequence: 1 },
      );
      expect(first.output.actions).toHaveLength(1);
      expect(second.output.actions).toEqual([]);
    });

    it("stays at regular price after a promotion has ended", () => {
      const result = decision(
        NEVER_DISCOUNT_OPERATOR,
        sku({
          activePromotionIds: [],
          promotionOwners: {},
          currentPriceMinor: REGULAR_PRICE,
          currentDiscountBasisPoints: 0,
          currentDiscountOwner: "none",
        }),
        { sequence: 5 },
      );
      expect(result.output.actions).toEqual([]);
    });
  });

  describe("FIXED_DISCOUNT", () => {
    it("applies the frozen 10% discount to an eligible SKU", () => {
      const result = decision(
        FIXED_DISCOUNT_OPERATOR,
        sku(),
        { sequence: 2 },
      );
      expect(result.output.actions).toHaveLength(1);
      expect(priceTarget(result.output.actions[0]!)).toBe(
        FIXED_DISCOUNT_PRICE,
      );
    });

    it("does not apply to an excluded product", () => {
      const result = decision(
        FIXED_DISCOUNT_OPERATOR,
        sku({ excluded: true }),
        { sequence: 2 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "SKU_EXCLUDED",
      );
    });

    it("does not duplicate a discount that is already heuristic-owned", () => {
      const result = decision(
        FIXED_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: FIXED_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1000,
          currentDiscountOwner: "heuristic",
          activeHeuristicRuleIds: [FIXED_DISCOUNT_CONFIG.ruleId],
          heuristicRuleStartedAt: {
            [FIXED_DISCOUNT_CONFIG.ruleId]:
              FIXED_DISCOUNT_CONFIG.startAt,
          },
        }),
        { sequence: 4 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).ruleEvaluation).toBe(
        "FIXED_DISCOUNT_ALREADY_ACTIVE",
      );
    });

    it("restores exactly the observed regular price at the promotion end without drift", () => {
      const result = decision(
        FIXED_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: FIXED_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1000,
          currentDiscountOwner: "heuristic",
          activeHeuristicRuleIds: [FIXED_DISCOUNT_CONFIG.ruleId],
          heuristicRuleStartedAt: {
            [FIXED_DISCOUNT_CONFIG.ruleId]:
              FIXED_DISCOUNT_CONFIG.startAt,
          },
        }),
        { sequence: 9 },
      );
      expect(result.output.actions).toHaveLength(1);
      expect(priceTarget(result.output.actions[0]!)).toBe(REGULAR_PRICE);
      expect((result.audit?.payload as any).restorationActionIds).toEqual([
        String(result.output.actions[0]!.actionId),
      ]);
    });

    it("preserves a non-heuristic commercial owner instead of stacking", () => {
      const result = decision(
        FIXED_DISCOUNT_OPERATOR,
        sku({
          activePromotionIds: ["merchant_policy_promo"],
          promotionOwners: {
            merchant_policy_promo: "status_quo",
          },
        }),
        { sequence: 2 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "NON_HEURISTIC_COMMERCIAL_CONFLICT",
      );
    });

    it("does not silently repair a discount blocked by frozen legal price bounds", () => {
      const result = decision(
        FIXED_DISCOUNT_OPERATOR,
        sku(),
        {
          sequence: 2,
          availability: { minimumPriceMinor: 85_000 },
        },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "PRICING_ACTION_OUTSIDE_LEGAL_BOUNDS",
      );
    });
  });

  it("honors configured SKU exclusions even when the observation flag is false", () => {
    const operator = createPricingPromotionHeuristicOperator({
      ...FIXED_DISCOUNT_CONFIG,
      excludedSkuIds: ["sku:A"],
    });
    const result = decision(
      operator as any,
      sku({ excluded: false }),
      { sequence: 2 },
    );
    expect(result.output.actions).toEqual([]);
    expect((result.audit?.payload as any).fallbackReason).toBe(
      "SKU_EXCLUDED",
    );
  });

  it("fails closed for missing price, unknown promotion state, and inactive SKU", () => {
    const missingPrice = decision(
      FIXED_DISCOUNT_OPERATOR,
      sku({ currentPriceMinor: null }),
      { sequence: 2 },
    );
    expect(missingPrice.output.actions).toEqual([]);
    expect((missingPrice.audit?.payload as any).fallbackReason).toBe(
      "PRICE_STATE_MISSING",
    );

    const unknownPromotionState = decision(
      NEVER_DISCOUNT_OPERATOR,
      sku({
        currentPriceMinor: FIXED_DISCOUNT_PRICE,
        currentDiscountBasisPoints: 1000,
        currentDiscountOwner: null,
      }),
    );
    expect(unknownPromotionState.output.actions).toEqual([]);
    expect(
      (unknownPromotionState.audit?.payload as any).fallbackReason,
    ).toBe("PRICE_OR_DISCOUNT_STATE_MISSING");

    const inactive = decision(
      FIXED_DISCOUNT_OPERATOR,
      sku({ active: false }),
      { sequence: 2 },
    );
    expect(inactive.output.actions).toEqual([]);
    expect((inactive.audit?.payload as any).fallbackReason).toBe(
      "SKU_INACTIVE",
    );
  });

  describe("EXCESS_INVENTORY_DISCOUNT", () => {
    it.each([
      [99, 0, "BELOW_EXCESS_THRESHOLD_NO_DISCOUNT"],
      [100, 0, "EXACTLY_AT_EXCESS_THRESHOLD_NO_DISCOUNT"],
      [101, 1, "EXCESS_INVENTORY_DISCOUNT_START"],
    ])(
      "uses strict GT inventory-threshold semantics at %s units",
      (inventory, actionCount, ruleEvaluation) => {
        const result = decision(
          EXCESS_INVENTORY_DISCOUNT_OPERATOR,
          sku({ observableInventoryUnits: inventory }),
        );
        expect(result.output.actions).toHaveLength(actionCount);
        expect((result.audit?.payload as any).ruleEvaluation).toBe(
          ruleEvaluation,
        );
        if (actionCount === 1) {
          expect(priceTarget(result.output.actions[0]!)).toBe(
            EXCESS_DISCOUNT_PRICE,
          );
        }
      },
    );

    it("makes no decision when observable inventory is missing", () => {
      const result = decision(
        EXCESS_INVENTORY_DISCOUNT_OPERATOR,
        sku({ observableInventoryUnits: null }),
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).fallbackReason).toBe(
        "INVENTORY_OBSERVATION_MISSING",
      );
    });

    it("does not restore before the frozen minimum duration even after inventory falls", () => {
      const result = decision(
        EXCESS_INVENTORY_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: EXCESS_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1500,
          currentDiscountOwner: "heuristic",
          observableInventoryUnits: 80,
          activeHeuristicRuleIds: [
            EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId,
          ],
          heuristicRuleStartedAt: {
            [EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId]: day(0),
          },
        }),
        { sequence: 1 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).ruleEvaluation).toBe(
        "RESTORATION_THRESHOLD_REACHED_BUT_MINIMUM_DURATION_NOT_MET",
      );
    });

    it("restores regular price once inventory falls to the restoration threshold after minimum duration", () => {
      const result = decision(
        EXCESS_INVENTORY_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: EXCESS_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1500,
          currentDiscountOwner: "heuristic",
          observableInventoryUnits: 80,
          activeHeuristicRuleIds: [
            EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId,
          ],
          heuristicRuleStartedAt: {
            [EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId]: day(0),
          },
        }),
        { sequence: 2 },
      );
      expect(result.output.actions).toHaveLength(1);
      expect(priceTarget(result.output.actions[0]!)).toBe(REGULAR_PRICE);
    });

    it("preserves explicit hysteresis: inventory between 81 and 100 does not start or restore", () => {
      const inactive = decision(
        EXCESS_INVENTORY_DISCOUNT_OPERATOR,
        sku({ observableInventoryUnits: 90 }),
      );
      const active = decision(
        EXCESS_INVENTORY_DISCOUNT_OPERATOR,
        sku({
          currentPriceMinor: EXCESS_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1500,
          currentDiscountOwner: "heuristic",
          observableInventoryUnits: 90,
          activeHeuristicRuleIds: [
            EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId,
          ],
          heuristicRuleStartedAt: {
            [EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId]: day(0),
          },
        }),
        { sequence: 3 },
      );
      expect(inactive.output.actions).toEqual([]);
      expect(active.output.actions).toEqual([]);
      expect((active.audit?.payload as any).ruleEvaluation).toBe(
        "EXCESS_INVENTORY_DISCOUNT_REMAINS_ACTIVE",
      );
    });
  });

  describe("FIXED_PROMOTIONAL_CALENDAR", () => {
    it("does nothing before the first calendar start", () => {
      const result = decision(
        FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        sku(),
        { sequence: 3 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).calendarState).toBe(
        "BEFORE_CALENDAR",
      );
    });

    it("starts the exact first calendar promotion at its frozen UTC start", () => {
      const result = decision(
        FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        sku(),
        { sequence: 4 },
      );
      expect(result.output.actions).toHaveLength(1);
      const action = result.output.actions[0]!;
      expect(String(action.actionType)).toBe("promotion.start");
      expect(action.parameters.kind).toBe("promotion_start");
      if (action.parameters.kind !== "promotion_start") {
        throw new Error("unexpected promotion Action");
      }
      expect(action.parameters.promotionId).toBe(
        "promo_heuristic_calendar_fall_a_v1",
      );
      expect(action.duration).toEqual({
        kind: "temporary",
        durationSeconds: 4 * 24 * 60 * 60,
      });
      expect(action.termination).toEqual({
        kind: "fixed_duration",
        durationSeconds: 4 * 24 * 60 * 60,
      });
    });

    it("does not re-start a calendar promotion during its active window", () => {
      const result = decision(
        FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        sku({
          activePromotionIds: ["promo_heuristic_calendar_fall_a_v1"],
          promotionOwners: {
            promo_heuristic_calendar_fall_a_v1: "heuristic",
          },
        }),
        { sequence: 5 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).calendarState).toBe(
        "DURING_CALENDAR_PROMOTION",
      );
    });

    it("allows the preregistered overlapping stackable calendar promotion at its exact start", () => {
      const result = decision(
        FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        sku({
          activePromotionIds: ["promo_heuristic_calendar_fall_a_v1"],
          promotionOwners: {
            promo_heuristic_calendar_fall_a_v1: "heuristic",
          },
        }),
        { sequence: 6 },
      );
      expect(result.output.actions).toHaveLength(1);
      const action = result.output.actions[0]!;
      expect(action.parameters.kind).toBe("promotion_start");
      if (action.parameters.kind !== "promotion_start") {
        throw new Error("unexpected promotion Action");
      }
      expect(action.parameters.promotionId).toBe(
        "promo_heuristic_calendar_overlap_b_v1",
      );
      expect(action.parameters.definition.stacking).toEqual({
        kind: "STACKABLE",
      });
      expect(action.parameters.definition.conflictResolution).toEqual({
        kind: "NONE",
      });
    });

    it("uses fixed-duration expiry for exact-end restoration without mutating base regular price", () => {
      const result = decision(
        FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        sku({
          activePromotionIds: [
            "promo_heuristic_calendar_fall_a_v1",
            "promo_heuristic_calendar_overlap_b_v1",
          ],
          promotionOwners: {
            promo_heuristic_calendar_fall_a_v1: "heuristic",
            promo_heuristic_calendar_overlap_b_v1: "heuristic",
          },
        }),
        { sequence: 8 },
      );
      expect(result.output.actions).toEqual([]);
      expect((result.audit?.payload as any).calendarState).toBe(
        "EXACT_END_RESTORATION_BY_FIXED_DURATION_EXPIRY",
      );
      expect((result.audit?.payload as any).restorationActionIds).toEqual(
        [],
      );
      expect(
        FIXED_PROMOTIONAL_CALENDAR_CONFIG.restorationBehavior,
      ).toBe(
        "PROMOTION_EXPIRY_REVEALS_UNCHANGED_REGULAR_PRICE",
      );
    });

    it("does nothing after the frozen calendar", () => {
      const result = decision(
        FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        sku(),
        { sequence: 12 },
      );
      expect(result.output.actions).toEqual([]);
    });

    it("does not duplicate a promotion ID owned by the environment or STATUS_QUO", () => {
      for (const owner of ["environment", "status_quo"] as const) {
        const result = decision(
          FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
          sku({
            activePromotionIds: ["promo_heuristic_calendar_fall_a_v1"],
            promotionOwners: {
              promo_heuristic_calendar_fall_a_v1: owner,
            },
          }),
          { sequence: 4 },
        );
        expect(result.output.actions).toEqual([]);
        expect((result.audit?.payload as any).fallbackReason).toBe(
          "PROMOTION_OWNED_BY_OTHER_SOURCE",
        );
      }
    });

    it("does not apply a calendar promotion to an excluded or ineligible SKU", () => {
      expect(
        decision(
          FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
          sku({ excluded: true }),
          { sequence: 4 },
        ).output.actions,
      ).toEqual([]);
      expect(
        decision(
          FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
          sku({ promotionEligible: false }),
          { sequence: 4 },
        ).output.actions,
      ).toEqual([]);
    });
  });

  it("uses only canonical pricing/promotion Actions", () => {
    const priceAction = decision(
      FIXED_DISCOUNT_OPERATOR,
      sku(),
      { sequence: 2 },
    ).output.actions[0]!;
    const promotionAction = decision(
      FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
      sku(),
      { sequence: 4 },
    ).output.actions[0]!;

    expect(assertValidAction(priceAction)).toEqual(priceAction);
    expect(assertValidAction(promotionAction)).toEqual(promotionAction);
    expect(String(priceAction.actionType)).toBe("pricing.adjust_price");
    expect(String(promotionAction.actionType)).toBe("promotion.start");
  });

  it("passes pricing proposals through accepted, rejected and explicit modified constraint outcomes", () => {
    const o = opportunity(2);
    const obs = observation(2, sku());
    const avail = availability(2);

    const accepted = invokeOperatorAtDecision(
      contract,
      FIXED_DISCOUNT_OPERATOR,
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
      FIXED_DISCOUNT_OPERATOR,
      o,
      obs,
      avail,
      () => ({
        issues: [
          {
            kind: "INFEASIBLE" as const,
            constraintRef: "maximum_discount",
            reason: "Synthetic maximum-discount rejection.",
          },
        ],
      }),
    );
    expect(
      rejected.decisionRecord.actionAttempts[0]?.constraintDisposition
        ?.status,
    ).toBe("REJECTED");

    const modified = invokeOperatorAtDecision(
      contract,
      FIXED_DISCOUNT_OPERATOR,
      o,
      obs,
      avail,
      (action) => {
        if (
          action.parameters.kind !== "price_adjustment" ||
          action.parameters.operation.kind !== "SET"
        ) {
          throw new Error("unexpected Action");
        }
        const replacement = assertValidAction({
          ...action,
          actionId: actionId(String(action.actionId) + "_modified"),
          parameters: {
            kind: "price_adjustment",
            operation: {
              kind: "SET",
              value: {
                ...action.parameters.operation.value,
                amountMinor: 85_000,
              },
            },
          },
        });
        return {
          issues: [
            {
              kind: "PARTIALLY_FEASIBLE" as const,
              constraintRef: "margin_floor",
              reason: "Only a shallower discount is feasible.",
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
      priceTarget(
        modified.decisionRecord.actionAttempts[0]!.executedAction!,
      ),
    ).toBe(85_000);
  });

  it("translates supported price and temporary promotion-start Actions through the frozen simulator boundary", () => {
    const priceAction = decision(
      FIXED_DISCOUNT_OPERATOR,
      sku(),
      { sequence: 2 },
    ).output.actions[0]!;
    const promotionAction = decision(
      FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
      sku(),
      { sequence: 4 },
    ).output.actions[0]!;

    const priceTranslation = translateBusinessAction(priceAction, {
      ...fullTranslationContext,
      simulatorClock: priceAction.timing.decisionTime,
    });
    const promotionTranslation = translateBusinessAction(
      promotionAction,
      {
        ...fullTranslationContext,
        simulatorClock: promotionAction.timing.decisionTime,
      },
    );

    expect(priceTranslation.status).toBe("TRANSLATED");
    expect(promotionTranslation.status).toBe("TRANSLATED");
    if (promotionTranslation.status === "TRANSLATED") {
      expect(promotionTranslation.interventions[0]?.duration).toEqual({
        kind: "temporary",
        durationSeconds: 4 * 24 * 60 * 60,
      });
      expect(promotionTranslation.interventions[0]?.endCondition).toEqual(
        {
          kind: "fixed_duration",
          durationSeconds: 4 * 24 * 60 * 60,
        },
      );
    }
  });

  it("keeps all four rules unchanged under adversarial performance context", () => {
    const contexts = [
      {
        operator: NEVER_DISCOUNT_OPERATOR,
        item: sku({
          currentPriceMinor: FIXED_DISCOUNT_PRICE,
          currentDiscountBasisPoints: 1000,
          currentDiscountOwner: "merchant_discretionary",
          observableInventoryUnits: 500,
        }),
        sequence: 0,
      },
      {
        operator: FIXED_DISCOUNT_OPERATOR,
        item: sku(),
        sequence: 2,
      },
      {
        operator: EXCESS_INVENTORY_DISCOUNT_OPERATOR,
        item: sku({ observableInventoryUnits: 101 }),
        sequence: 0,
      },
      {
        operator: FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
        item: sku({ observableInventoryUnits: 1 }),
        sequence: 4,
      },
    ] as const;

    const extras = [
      {
        observationKey: "pricing_promotion.adversarial_context",
        value: {
          organicDemandExtremelyStrong: true,
          futureDemandCollapseClaim: true,
          highMarginRisk: true,
          lowValuePurchases: true,
          apparentlyBetterDiscountBasisPoints: 700,
          scarceInventoryElsewhere: true,
          competitorPrice: 1,
        },
      },
    ] as const;

    for (const context of contexts) {
      const ordinary = decision(
        context.operator as any,
        context.item,
        { sequence: context.sequence },
      );
      const adversarial = decision(
        context.operator as any,
        context.item,
        { sequence: context.sequence, extras },
      );
      expect(adversarial.output).toEqual(ordinary.output);
    }
  });

  it("preserves paired-comparison bindings with prior baseline operators", () => {
    const worldId = "step3.6.synthetic-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    const doNothing = createEvaluationComparisonBinding(
      contract,
      PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(DO_NOTHING_OPERATOR.metadata.operatorId),
    );
    const statusQuo = createEvaluationComparisonBinding(
      contract,
      PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(STATUS_QUO_OPERATOR_ID),
    );
    const advertising = createEvaluationComparisonBinding(
      contract,
      PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(EQUAL_BUDGET_ALLOCATION_OPERATOR.metadata.operatorId),
    );
    const inventory = createEvaluationComparisonBinding(
      contract,
      PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(FIXED_REORDER_THRESHOLD_OPERATOR.metadata.operatorId),
    );

    assertEquivalentComparisonBindings(doNothing, statusQuo);
    assertEquivalentComparisonBindings(doNothing, advertising);
    assertEquivalentComparisonBindings(doNothing, inventory);

    for (const operator of Object.values(
      PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const binding = createEvaluationComparisonBinding(
        contract,
        PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
        worldId,
        worldFingerprint,
        "CAD",
        START,
        seeds(operator.metadata.operatorId),
      );
      assertEquivalentComparisonBindings(doNothing, binding);
    }
  });

  it("produces complete reproducible 90-opportunity artifacts for every pricing/promotion heuristic", () => {
    const worldId = "step3.6.artifact-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    for (const operator of Object.values(
      PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const decisions = Array.from({ length: 90 }, (_, sequence) => {
        let item = sku();

        if (operator.metadata.operatorId === NEVER_DISCOUNT_OPERATOR.metadata.operatorId) {
          item =
            sequence === 0
              ? sku({
                  currentPriceMinor: FIXED_DISCOUNT_PRICE,
                  currentDiscountBasisPoints: 1000,
                  currentDiscountOwner: "merchant_discretionary",
                })
              : sku();
        }

        if (operator.metadata.operatorId === FIXED_DISCOUNT_OPERATOR.metadata.operatorId) {
          if (sequence === 2) {
            item = sku();
          } else if (sequence > 2 && sequence <= 9) {
            item = sku({
              currentPriceMinor: FIXED_DISCOUNT_PRICE,
              currentDiscountBasisPoints: 1000,
              currentDiscountOwner: "heuristic",
              activeHeuristicRuleIds: [FIXED_DISCOUNT_CONFIG.ruleId],
              heuristicRuleStartedAt: {
                [FIXED_DISCOUNT_CONFIG.ruleId]: day(2),
              },
            });
          }
        }

        if (operator.metadata.operatorId === EXCESS_INVENTORY_DISCOUNT_OPERATOR.metadata.operatorId) {
          if (sequence === 0) {
            item = sku({ observableInventoryUnits: 101 });
          } else if (sequence === 1) {
            item = sku({
              currentPriceMinor: EXCESS_DISCOUNT_PRICE,
              currentDiscountBasisPoints: 1500,
              currentDiscountOwner: "heuristic",
              observableInventoryUnits: 120,
              activeHeuristicRuleIds: [
                EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId,
              ],
              heuristicRuleStartedAt: {
                [EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId]: day(0),
              },
            });
          } else if (sequence === 2) {
            item = sku({
              currentPriceMinor: EXCESS_DISCOUNT_PRICE,
              currentDiscountBasisPoints: 1500,
              currentDiscountOwner: "heuristic",
              observableInventoryUnits: 80,
              activeHeuristicRuleIds: [
                EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId,
              ],
              heuristicRuleStartedAt: {
                [EXCESS_INVENTORY_DISCOUNT_CONFIG.ruleId]: day(0),
              },
            });
          } else {
            item = sku({ observableInventoryUnits: 80 });
          }
        }

        if (operator.metadata.operatorId === FIXED_PROMOTIONAL_CALENDAR_OPERATOR.metadata.operatorId) {
          if (sequence === 5) {
            item = sku({
              activePromotionIds: ["promo_heuristic_calendar_fall_a_v1"],
              promotionOwners: {
                promo_heuristic_calendar_fall_a_v1: "heuristic",
              },
            });
          } else if (sequence === 6 || sequence === 7) {
            item = sku({
              activePromotionIds: ["promo_heuristic_calendar_fall_a_v1"],
              promotionOwners: {
                promo_heuristic_calendar_fall_a_v1: "heuristic",
              },
            });
          } else if (sequence === 8 || sequence === 9) {
            item = sku({
              activePromotionIds: ["promo_heuristic_calendar_overlap_b_v1"],
              promotionOwners: {
                promo_heuristic_calendar_overlap_b_v1: "heuristic",
              },
            });
          }
        }

        return invokeOperatorAtDecision(
          contract,
          operator,
          opportunity(sequence),
          observation(sequence, item),
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
        simulatorVersion:
          PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
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
            "pricing_promotion_heuristic_evaluation",
        ),
      ).toBe(true);
      expect(
        bundle.operatorMetadata?.deterministicConfiguration,
      ).toBeDefined();
    }
  });

  it("freezes preregistered pricing/promotion configurations and fingerprints", () => {
    const configs: readonly PricingPromotionHeuristicConfig[] = [
      NEVER_DISCOUNT_CONFIG,
      FIXED_DISCOUNT_CONFIG,
      EXCESS_INVENTORY_DISCOUNT_CONFIG,
      FIXED_PROMOTIONAL_CALENDAR_CONFIG,
    ];
    const configFingerprints = Object.fromEntries(
      configs.map((config) => [
        config.heuristicType,
        pricingPromotionHeuristicConfigurationFingerprint(config),
      ]),
    );

    expect(new Set(Object.values(configFingerprints)).size).toBe(4);
    for (const fingerprint of Object.values(configFingerprints)) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }

    console.log(
      "STEP3_6_PRICING_PROMOTION_HEURISTIC_FREEZE",
      JSON.stringify({
        parentCommit:
          PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
        operatorVersion:
          PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION,
        implementationFingerprints:
          PRICING_PROMOTION_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
        configurationFingerprints: configFingerprints,
        frozenConfigurations:
          FROZEN_PRICING_PROMOTION_HEURISTIC_CONFIGURATIONS,
      }),
    );
  });
});
