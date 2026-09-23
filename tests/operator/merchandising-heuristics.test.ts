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
  FROZEN_MERCHANDISING_HEURISTIC_CONFIGURATIONS,
  MERCHANDISING_HEURISTIC_BASELINE_OPERATORS,
  MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
  MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
  MERCHANDISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
  MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
  MERCHANDISING_HEURISTIC_OBSERVATION_KEY,
  MERCHANDISING_HEURISTIC_OPERATOR_VERSION,
  MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
  MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
  RANK_BY_CONVERSION_RATE_CONFIG,
  RANK_BY_CONVERSION_RATE_OPERATOR,
  RANK_BY_REVENUE_CONFIG,
  RANK_BY_REVENUE_OPERATOR,
  RANK_BY_UNITS_SOLD_CONFIG,
  RANK_BY_UNITS_SOLD_OPERATOR,
  createMerchandisingHeuristicOperator,
  merchandisingHeuristicConfigurationFingerprint,
  type MerchandisingHeuristicConfig,
  type MerchandisingProductObservation,
} from "../../src/operator/merchandising-heuristics.js";
import { FIXED_PROMOTIONAL_CALENDAR_OPERATOR } from "../../src/operator/pricing-promotion-heuristics.js";
import { STATUS_QUO_OPERATOR_ID } from "../../src/operator/status-quo.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function day(sequence: number): string {
  return new Date(Date.parse(START) + sequence * DAY_MS).toISOString();
}

function product(
  productId: string,
  currentPosition: number,
  overrides: Partial<MerchandisingProductObservation> = {},
): MerchandisingProductObservation {
  return {
    productId,
    collectionMember: true,
    active: true,
    available: true,
    merchandisingEligible: true,
    excluded: false,
    currentPosition,
    pinnedPosition: null,
    mandatoryPosition: null,
    newlyLaunched: false,
    revenueMinor: 0,
    conversions: 0,
    productViews: 100,
    unitsSold: 0,
    ...overrides,
  };
}

function defaultProducts(): readonly MerchandisingProductObservation[] {
  return [
    product("product:A", 1, {
      revenueMinor: 10_000,
      conversions: 10,
      productViews: 100,
      unitsSold: 10,
    }),
    product("product:B", 2, {
      revenueMinor: 30_000,
      conversions: 20,
      productViews: 100,
      unitsSold: 30,
    }),
    product("product:C", 3, {
      revenueMinor: 20_000,
      conversions: 15,
      productViews: 100,
      unitsSold: 20,
    }),
  ];
}

function opportunity(sequence = 0) {
  return createFixedIntervalDecisionOpportunity(contract, START, sequence);
}

function observation(
  sequence = 0,
  products: readonly MerchandisingProductObservation[] = defaultProducts(),
  lookbackDays = 30,
  extras: readonly {
    readonly observationKey: string;
    readonly value: unknown;
  }[] = [],
) {
  const o = opportunity(sequence);
  const end = Date.parse(o.at);
  const start = new Date(end - lookbackDays * DAY_MS).toISOString();

  return buildOperatorObservationSnapshot(contract, o, [
    {
      observationKey: MERCHANDISING_HEURISTIC_OBSERVATION_KEY,
      informationClass: "historical_information",
      sourceMinOccurredAt: start,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "commerce-report:step3.7-product-performance",
      value: {
        schemaVersion: "1.0.0",
        targetCollectionId: "collection:X",
        currency: "CAD",
        lookbackDays,
        windowStart: start,
        windowEnd: o.at,
        products,
      },
    },
    ...extras.map((extra) => ({
      observationKey: extra.observationKey,
      informationClass: "current_state_information" as const,
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "merchant-state:step3.7-adversarial-context",
      value: extra.value,
    })),
  ]);
}

function availability(
  sequence = 0,
  productIds: readonly string[] = [
    "product:A",
    "product:B",
    "product:C",
  ],
  parameterBounds: readonly {
    readonly path: string;
    readonly minInclusive?: number;
    readonly maxInclusive?: number;
  }[] = [],
  requiredPreconditionIds: readonly string[] = [],
) {
  const o = opportunity(sequence);
  return buildActionAvailabilitySnapshot(
    contract,
    o,
    productIds.length === 0
      ? []
      : [
          {
            actionType: "merchandising.move_product",
            eligibleTargets: productIds.map((productId) => ({
              kind: "product" as const,
              productId,
            })),
            parameterBounds,
            requiredPreconditionIds,
          },
        ],
  );
}

function decision(
  operator: typeof RANK_BY_REVENUE_OPERATOR,
  products: readonly MerchandisingProductObservation[] = defaultProducts(),
  options: {
    readonly sequence?: number;
    readonly lookbackDays?: number;
    readonly legalProductIds?: readonly string[];
    readonly parameterBounds?: readonly {
      readonly path: string;
      readonly minInclusive?: number;
      readonly maxInclusive?: number;
    }[];
    readonly requiredPreconditionIds?: readonly string[];
    readonly extras?: readonly {
      readonly observationKey: string;
      readonly value: unknown;
    }[];
  } = {},
) {
  const sequence = options.sequence ?? 0;
  const o = opportunity(sequence);
  const obs = observation(
    sequence,
    products,
    options.lookbackDays ?? 30,
    options.extras ?? [],
  );
  const avail = availability(
    sequence,
    options.legalProductIds ?? [
      "product:A",
      "product:B",
      "product:C",
    ],
    options.parameterBounds ?? [],
    options.requiredPreconditionIds ?? [],
  );
  const input = toOperatorDecisionInput(o, obs, avail);
  const output = operator.decide(input);
  const audit = operator.auditDecision?.(input, output);
  return { o, obs, avail, input, output, audit };
}

function proposedRanking(
  result: ReturnType<typeof decision>,
): readonly { readonly productId: string; readonly position: number; readonly fixed: boolean }[] {
  return (result.audit?.payload as any).proposedRanking;
}

function actionPositions(actions: readonly Action[]): Record<string, number> {
  return Object.fromEntries(
    actions.map((action) => {
      expect(action.actionCategory).toBe("merchandising");
      expect(String(action.actionType)).toBe(
        "merchandising.move_product",
      );
      expect(action.parameters.kind).toBe("merchandising_position");
      if (
        action.target.kind !== "product" ||
        action.parameters.kind !== "merchandising_position"
      ) {
        throw new Error("unexpected merchandising Action");
      }
      return [action.target.productId, action.parameters.position];
    }),
  );
}

function seeds(operatorId: string): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: 3701 },
    { namespace: "customer_generation", value: 3702 },
    { namespace: "customer_behavior", value: 3703 },
    { namespace: "demand", value: 3704 },
    { namespace: "advertising_response", value: 3705 },
    { namespace: "journey_transitions", value: 3706 },
    { namespace: "external_events", value: 3707 },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId,
    },
  ];
}

describe("Step 3.7 simple merchandising heuristic baselines", () => {
  it("freezes three independent canonical operators and configurations", () => {
    expect(
      Object.keys(MERCHANDISING_HEURISTIC_BASELINE_OPERATORS),
    ).toEqual([
      "RANK_BY_REVENUE",
      "RANK_BY_CONVERSION_RATE",
      "RANK_BY_UNITS_SOLD",
    ]);

    const operators = Object.values(
      MERCHANDISING_HEURISTIC_BASELINE_OPERATORS,
    );
    expect(
      new Set(operators.map((operator) => operator.metadata.operatorId))
        .size,
    ).toBe(3);
    expect(
      new Set(
        operators.map(
          (operator) => operator.metadata.implementationFingerprint,
        ),
      ).size,
    ).toBe(3);

    for (const operator of operators) {
      expect(operator.metadata.operatorVersion).toBe(
        MERCHANDISING_HEURISTIC_OPERATOR_VERSION,
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
        MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
      );
      expect(cfg.ecommerceEconomicsVersion).toBe(
        MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
      );
      expect(cfg.productEconomicsVersion).toBe(
        MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
      );
      expect(cfg.simulatorVersion).toBe(
        MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      );
      expect(cfg.frozenParentCommit).toBe(
        MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
      );
    }
  });

  it("freezes a trailing 30-day observation window and fails closed on mismatch", () => {
    expect(RANK_BY_REVENUE_CONFIG.lookbackDays).toBe(30);
    expect(
      decision(RANK_BY_REVENUE_OPERATOR, defaultProducts(), {
        lookbackDays: 14,
      }).output.actions,
    ).toEqual([]);
  });

  it("binds revenue, conversion and units semantics to existing frozen commerce definitions", () => {
    expect(RANK_BY_REVENUE_CONFIG.revenueSemantics).toEqual({
      source: "ecommerce_economic_report.byProduct.netRevenueMinor",
      definition:
        "SUM_PRODUCT_ORDER_LINE_NET_SALES_AFTER_DISCOUNTS_MINUS_PRODUCT_REFUNDS",
      currency: "CAD",
      discountTreatment: "NET_OF_DISCOUNTS",
      refundTreatment: "SUBTRACT_PRODUCT_REFUNDED_REVENUE",
      cancellationTreatment:
        "CANCELLED_ORDERS_ARE_NOT_REALIZED_ORDERS",
      attribution: "PRODUCT_ORDER_LINE",
    });
    expect(
      RANK_BY_CONVERSION_RATE_CONFIG.conversionSemantics,
    ).toMatchObject({
      numerator:
        "REPRESENTED_REALIZED_ORDERS_CONTAINING_PRODUCT",
      denominator: "OBSERVED_PRODUCT_VIEWS",
      minimumProductViews: 20,
    });
    expect(RANK_BY_UNITS_SOLD_CONFIG.unitsSemantics).toEqual({
      source: "ecommerce_economic_report.byProduct.units",
      definition: "SUM_REALIZED_ORDER_LINE_QUANTITY",
      cancellationTreatment:
        "CANCELLED_ORDERS_ARE_NOT_REALIZED_ORDERS",
      refundReturnTreatment:
        "RETURNS_AND_REFUNDS_DO_NOT_SUBTRACT_REALIZED_UNITS",
    });
  });

  describe("RANK_BY_REVENUE", () => {
    it("ranks clear observed net revenue descending", () => {
      const result = decision(RANK_BY_REVENUE_OPERATOR);
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:C", "product:A"]);
      expect(actionPositions(result.output.actions)).toEqual({
        "product:A": 3,
        "product:B": 1,
        "product:C": 2,
      });
    });

    it("breaks equal revenue by canonical product ID ascending", () => {
      const products = [
        product("product:A", 2, { revenueMinor: 10_000 }),
        product("product:B", 1, { revenueMinor: 10_000 }),
      ];
      const result = decision(
        RANK_BY_REVENUE_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:A", "product:B"]);
      expect(
        (result.audit?.payload as any).tieBreakResults.length,
      ).toBeGreaterThan(0);
    });

    it("treats zero and negative net revenue as valid observed values", () => {
      const products = [
        product("product:A", 1, { revenueMinor: 0 }),
        product("product:B", 2, { revenueMinor: -5_000 }),
        product("product:C", 3, { revenueMinor: 2_000 }),
      ];
      const result = decision(RANK_BY_REVENUE_OPERATOR, products);
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:C", "product:A", "product:B"]);
    });

    it("places missing-revenue products after valid products in stable fallback order", () => {
      const products = [
        product("product:A", 1, { revenueMinor: null }),
        product("product:B", 2, { revenueMinor: 0 }),
        product("product:C", 3, { revenueMinor: null }),
      ];
      const result = decision(RANK_BY_REVENUE_OPERATOR, products);
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A", "product:C"]);
    });

    it("excludes products outside the target merchandising population", () => {
      const products = [
        product("product:A", 1, { revenueMinor: 1 }),
        product("product:B", 2, {
          revenueMinor: 1_000_000,
          excluded: true,
        }),
        product("product:C", 3, { revenueMinor: 2 }),
      ];
      const result = decision(RANK_BY_REVENUE_OPERATOR, products);
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:C", "product:A"]);
      expect(
        (result.audit?.payload as any).excludedByEligibility,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productId: "product:B" }),
        ]),
      );
    });

    it("places a newly launched product with missing history by stable fallback rather than prediction", () => {
      const products = [
        product("product:A", 1, {
          revenueMinor: null,
          newlyLaunched: true,
        }),
        product("product:B", 2, { revenueMinor: 100 }),
      ];
      const result = decision(
        RANK_BY_REVENUE_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A"]);
      expect(
        (result.audit?.payload as any).evidenceSufficiency,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productId: "product:A",
            status: "MISSING",
            newlyLaunched: true,
          }),
        ]),
      );
    });
  });

  describe("RANK_BY_CONVERSION_RATE", () => {
    it("ranks clear observed conversion rate descending", () => {
      const products = [
        product("product:A", 1, {
          conversions: 10,
          productViews: 100,
        }),
        product("product:B", 2, {
          conversions: 30,
          productViews: 100,
        }),
        product("product:C", 3, {
          conversions: 20,
          productViews: 100,
        }),
      ];
      const result = decision(
        RANK_BY_CONVERSION_RATE_OPERATOR,
        products,
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:C", "product:A"]);
    });

    it("breaks equal conversion rates by product ID rather than denominator size", () => {
      const products = [
        product("product:A", 2, {
          conversions: 20,
          productViews: 100,
        }),
        product("product:B", 1, {
          conversions: 40,
          productViews: 200,
        }),
      ];
      const result = decision(
        RANK_BY_CONVERSION_RATE_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:A", "product:B"]);
    });

    it("uses the frozen denominator consistently across different view counts", () => {
      const products = [
        product("product:A", 1, {
          conversions: 20,
          productViews: 200,
        }),
        product("product:B", 2, {
          conversions: 15,
          productViews: 50,
        }),
      ];
      const result = decision(
        RANK_BY_CONVERSION_RATE_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A"]);
    });

    it("treats zero conversions as a valid zero rate when evidence is sufficient", () => {
      const products = [
        product("product:A", 1, {
          conversions: 0,
          productViews: 100,
        }),
        product("product:B", 2, {
          conversions: 1,
          productViews: 100,
        }),
      ];
      const result = decision(
        RANK_BY_CONVERSION_RATE_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A"]);
      expect(
        (result.audit?.payload as any).evidenceSufficiency,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productId: "product:A",
            status: "VALID",
          }),
        ]),
      );
    });

    it("places insufficient-evidence products in deterministic fallback order", () => {
      const products = [
        product("product:A", 1, {
          conversions: 10,
          productViews: 19,
        }),
        product("product:B", 2, {
          conversions: 2,
          productViews: 20,
        }),
        product("product:C", 3, {
          conversions: 0,
          productViews: 10,
        }),
      ];
      const result = decision(
        RANK_BY_CONVERSION_RATE_OPERATOR,
        products,
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A", "product:C"]);
    });

    it("treats missing views as missing evidence without prediction", () => {
      const products = [
        product("product:A", 1, {
          conversions: 1,
          productViews: null,
        }),
        product("product:B", 2, {
          conversions: 0,
          productViews: 20,
        }),
      ];
      const result = decision(
        RANK_BY_CONVERSION_RATE_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A"]);
    });
  });

  describe("RANK_BY_UNITS_SOLD", () => {
    it("ranks clear realized units sold descending", () => {
      const result = decision(RANK_BY_UNITS_SOLD_OPERATOR);
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:C", "product:A"]);
    });

    it("breaks equal units by product ID ascending", () => {
      const products = [
        product("product:A", 2, { unitsSold: 10 }),
        product("product:B", 1, { unitsSold: 10 }),
      ];
      const result = decision(
        RANK_BY_UNITS_SOLD_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:A", "product:B"]);
    });

    it("treats zero realized sales as valid and missing units as fallback", () => {
      const products = [
        product("product:A", 1, { unitsSold: 0 }),
        product("product:B", 2, { unitsSold: null }),
        product("product:C", 3, { unitsSold: 5 }),
      ];
      const result = decision(RANK_BY_UNITS_SOLD_OPERATOR, products);
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:C", "product:A", "product:B"]);
    });

    it("does not let refunds or low net revenue alter the canonical realized-units ranking", () => {
      const products = [
        product("product:A", 1, {
          unitsSold: 10,
          revenueMinor: -50_000,
        }),
        product("product:B", 2, {
          unitsSold: 5,
          revenueMinor: 500_000,
        }),
      ];
      const result = decision(
        RANK_BY_UNITS_SOLD_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:A", "product:B"]);
      expect(
        RANK_BY_UNITS_SOLD_CONFIG.unitsSemantics.refundReturnTreatment,
      ).toBe(
        "RETURNS_AND_REFUNDS_DO_NOT_SUBTRACT_REALIZED_UNITS",
      );
    });

    it("places missing units observations after valid values", () => {
      const products = [
        product("product:A", 1, { unitsSold: null }),
        product("product:B", 2, { unitsSold: 0 }),
      ];
      const result = decision(
        RANK_BY_UNITS_SOLD_OPERATOR,
        products,
        { legalProductIds: ["product:A", "product:B"] },
      );
      expect(
        proposedRanking(result).map((row) => row.productId),
      ).toEqual(["product:B", "product:A"]);
    });
  });

  it("uses availability only for eligibility and never as a ranking score", () => {
    const base = [
      product("product:A", 1, {
        revenueMinor: 100,
        available: true,
      }),
      product("product:B", 2, {
        revenueMinor: 1_000,
        available: true,
      }),
    ];
    const result = decision(
      RANK_BY_REVENUE_OPERATOR,
      base,
      { legalProductIds: ["product:A", "product:B"] },
    );
    expect(
      proposedRanking(result).map((row) => row.productId),
    ).toEqual(["product:B", "product:A"]);

    const unavailable = decision(
      RANK_BY_REVENUE_OPERATOR,
      [
        base[0]!,
        { ...base[1]!, available: false },
      ],
      { legalProductIds: ["product:A", "product:B"] },
    );
    expect(
      proposedRanking(unavailable).map((row) => row.productId),
    ).toEqual(["product:A"]);
  });

  it("preserves pinned and mandatory positions while ranking only open positions", () => {
    const products = [
      product("product:A", 1, { revenueMinor: 100 }),
      product("product:B", 2, {
        revenueMinor: 1,
        pinnedPosition: 1,
      }),
      product("product:C", 3, { revenueMinor: 200 }),
    ];
    const result = decision(RANK_BY_REVENUE_OPERATOR, products);
    expect(proposedRanking(result)).toEqual([
      { productId: "product:B", position: 1, fixed: true },
      { productId: "product:C", position: 2, fixed: false },
      { productId: "product:A", position: 3, fixed: false },
    ]);
  });

  it("honors legal Action-space restrictions in the eligible movable population", () => {
    const result = decision(
      RANK_BY_REVENUE_OPERATOR,
      defaultProducts(),
      { legalProductIds: ["product:A", "product:C"] },
    );
    expect(
      proposedRanking(result).map((row) => row.productId),
    ).toEqual(["product:C", "product:A"]);
    expect(
      (result.audit?.payload as any).excludedByEligibility,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: "product:B",
          legallyMovable: false,
        }),
      ]),
    );
  });

  it("does not silently repair a ranking that violates legal position bounds", () => {
    const result = decision(
      RANK_BY_REVENUE_OPERATOR,
      defaultProducts(),
      {
        parameterBounds: [
          {
            path: "parameters.position",
            maxInclusive: 2,
          },
        ],
      },
    );
    expect(result.output.actions).toEqual([]);
    expect((result.audit?.payload as any).fallbackReason).toBe(
      "RANKING_ACTION_OUTSIDE_LEGAL_BOUNDS",
    );
  });

  it("uses only canonical merchandising.move_product Actions", () => {
    const result = decision(RANK_BY_REVENUE_OPERATOR);
    for (const action of result.output.actions) {
      expect(assertValidAction(action)).toEqual(action);
      expect(String(action.actionType)).toBe(
        "merchandising.move_product",
      );
      expect(action.actionCategory).toBe("merchandising");
    }
  });

  it("passes ranking proposals through accepted, rejected and explicit modified constraint outcomes", () => {
    const o = opportunity(0);
    const obs = observation(0);
    const avail = availability(0);

    const accepted = invokeOperatorAtDecision(
      contract,
      RANK_BY_REVENUE_OPERATOR,
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
      RANK_BY_REVENUE_OPERATOR,
      o,
      obs,
      avail,
      (_, index) => ({
        issues:
          index === 0
            ? [
                {
                  kind: "INFEASIBLE" as const,
                  constraintRef: "pinned_position",
                  reason: "Synthetic pinned-position rejection.",
                },
              ]
            : [],
      }),
    );
    expect(
      rejected.decisionRecord.actionAttempts[0]?.constraintDisposition
        ?.status,
    ).toBe("REJECTED");

    const modified = invokeOperatorAtDecision(
      contract,
      RANK_BY_REVENUE_OPERATOR,
      o,
      obs,
      avail,
      (action, index) => {
        if (index !== 0) return { issues: [] };
        if (action.parameters.kind !== "merchandising_position") {
          throw new Error("unexpected Action");
        }
        const replacement = assertValidAction({
          ...action,
          actionId: actionId(String(action.actionId) + "_modified"),
          parameters: {
            ...action.parameters,
            position: 2,
          },
        });
        return {
          issues: [
            {
              kind: "PARTIALLY_FEASIBLE" as const,
              constraintRef: "mandatory_position",
              reason: "Only position 2 is feasible.",
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
  });

  it("translates the legacy canonical move_product ranking Action through the frozen simulator boundary", () => {
    const action = decision(RANK_BY_REVENUE_OPERATOR).output.actions[0]!;
    const context = {
      ...fullTranslationContext,
      simulatorClock: action.timing.decisionTime,
      entityMappings: [
        ...fullTranslationContext.entityMappings,
        {
          actionTarget: {
            kind: "product" as const,
            productId: "product:A",
          },
          simulatorTarget: {
            kind: "product" as const,
            simulatorProductId: "sim:product:A",
          },
          sourceRef: "mapping:step3.7:product-a",
        },
        {
          actionTarget: {
            kind: "product" as const,
            productId: "product:B",
          },
          simulatorTarget: {
            kind: "product" as const,
            simulatorProductId: "sim:product:B",
          },
          sourceRef: "mapping:step3.7:product-b",
        },
        {
          actionTarget: {
            kind: "product" as const,
            productId: "product:C",
          },
          simulatorTarget: {
            kind: "product" as const,
            simulatorProductId: "sim:product:C",
          },
          sourceRef: "mapping:step3.7:product-c",
        },
      ],
    };

    const translation = translateBusinessAction(action, context);
    expect(translation.status).toBe("TRANSLATED");
    if (translation.status === "TRANSLATED") {
      expect(translation.interventions).toHaveLength(1);
      expect(translation.interventions[0]?.interventionType).toBe(
        "merchandising_position",
      );
    }
  });

  it("keeps all three rankings naïve under adversarial profitability, inventory, future-demand and position-bias context", () => {
    const contexts = [
      {
        operator: RANK_BY_REVENUE_OPERATOR,
        products: [
          product("product:A", 1, { revenueMinor: 100 }),
          product("product:B", 2, { revenueMinor: 1_000 }),
        ],
      },
      {
        operator: RANK_BY_CONVERSION_RATE_OPERATOR,
        products: [
          product("product:A", 1, {
            conversions: 4,
            productViews: 20,
          }),
          product("product:B", 2, {
            conversions: 30,
            productViews: 100,
          }),
        ],
      },
      {
        operator: RANK_BY_UNITS_SOLD_OPERATOR,
        products: [
          product("product:A", 1, { unitsSold: 5 }),
          product("product:B", 2, { unitsSold: 20 }),
        ],
      },
    ] as const;

    const extras = [
      {
        observationKey: "merchandising.adversarial_context",
        value: {
          marginByProduct: {
            "product:A": 100_000,
            "product:B": -100_000,
          },
          nearStockoutProductId: "product:B",
          futureDemandWinner: "product:A",
          counterfactualBetterExposureProduct: "product:A",
          currentPositionBiasWinner: "product:B",
          highReturnProductId: "product:B",
        },
      },
    ] as const;

    for (const context of contexts) {
      const legalProductIds = context.products.map(
        (entry) => entry.productId,
      );
      const ordinary = decision(
        context.operator as any,
        context.products,
        { legalProductIds },
      );
      const adversarial = decision(
        context.operator as any,
        context.products,
        { legalProductIds, extras },
      );
      expect(adversarial.output).toEqual(ordinary.output);
    }
  });

  it("does not add feedback-loop, exploration or position-bias correction", () => {
    const products = [
      product("product:A", 1, { revenueMinor: 100 }),
      product("product:B", 2, { revenueMinor: 1_000 }),
    ];
    const first = decision(
      RANK_BY_REVENUE_OPERATOR,
      products,
      { legalProductIds: ["product:A", "product:B"] },
    );
    const reinforced = decision(
      RANK_BY_REVENUE_OPERATOR,
      [
        { ...products[0]!, currentPosition: 2, revenueMinor: 100 },
        { ...products[1]!, currentPosition: 1, revenueMinor: 2_000 },
      ],
      {
        sequence: 1,
        legalProductIds: ["product:A", "product:B"],
      },
    );

    expect(
      proposedRanking(first).map((row) => row.productId),
    ).toEqual(["product:B", "product:A"]);
    expect(
      proposedRanking(reinforced).map((row) => row.productId),
    ).toEqual(["product:B", "product:A"]);
  });

  it("preserves paired-comparison bindings with prior baseline operators", () => {
    const worldId = "step3.7.synthetic-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    const doNothing = createEvaluationComparisonBinding(
      contract,
      MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(DO_NOTHING_OPERATOR.metadata.operatorId),
    );
    const statusQuo = createEvaluationComparisonBinding(
      contract,
      MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(STATUS_QUO_OPERATOR_ID),
    );
    const advertising = createEvaluationComparisonBinding(
      contract,
      MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(EQUAL_BUDGET_ALLOCATION_OPERATOR.metadata.operatorId),
    );
    const inventory = createEvaluationComparisonBinding(
      contract,
      MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(FIXED_REORDER_THRESHOLD_OPERATOR.metadata.operatorId),
    );
    const pricing = createEvaluationComparisonBinding(
      contract,
      MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(FIXED_PROMOTIONAL_CALENDAR_OPERATOR.metadata.operatorId),
    );

    assertEquivalentComparisonBindings(doNothing, statusQuo);
    assertEquivalentComparisonBindings(doNothing, advertising);
    assertEquivalentComparisonBindings(doNothing, inventory);
    assertEquivalentComparisonBindings(doNothing, pricing);

    for (const operator of Object.values(
      MERCHANDISING_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const binding = createEvaluationComparisonBinding(
        contract,
        MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
        worldId,
        worldFingerprint,
        "CAD",
        START,
        seeds(operator.metadata.operatorId),
      );
      assertEquivalentComparisonBindings(doNothing, binding);
    }
  });

  it("produces complete reproducible 90-opportunity artifacts for every merchandising heuristic", () => {
    const worldId = "step3.7.artifact-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    for (const operator of Object.values(
      MERCHANDISING_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const decisions = Array.from({ length: 90 }, (_, sequence) => {
        const products = defaultProducts().map((entry) => ({
          ...entry,
          currentPosition:
            operator.metadata.operatorId ===
            RANK_BY_REVENUE_OPERATOR.metadata.operatorId
              ? sequence === 0
                ? entry.currentPosition
                : entry.productId === "product:B"
                  ? 1
                  : entry.productId === "product:C"
                    ? 2
                    : 3
              : entry.currentPosition,
        }));

        return invokeOperatorAtDecision(
          contract,
          operator,
          opportunity(sequence),
          observation(sequence, products),
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
        simulatorVersion: MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
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
          simulatorQualification:
            "legacy merchandising_position supports simple product position but not richer Step 7 surface/container/displacement semantics",
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
            "merchandising_heuristic_evaluation",
        ),
      ).toBe(true);
      expect(
        bundle.operatorMetadata?.deterministicConfiguration,
      ).toBeDefined();
    }
  });

  it("freezes preregistered merchandising configurations and fingerprints", () => {
    const configs: readonly MerchandisingHeuristicConfig[] = [
      RANK_BY_REVENUE_CONFIG,
      RANK_BY_CONVERSION_RATE_CONFIG,
      RANK_BY_UNITS_SOLD_CONFIG,
    ];
    const configFingerprints = Object.fromEntries(
      configs.map((config) => [
        config.heuristicType,
        merchandisingHeuristicConfigurationFingerprint(config),
      ]),
    );

    expect(new Set(Object.values(configFingerprints)).size).toBe(3);
    for (const fingerprint of Object.values(configFingerprints)) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }

    console.log(
      "STEP3_7_MERCHANDISING_HEURISTIC_FREEZE",
      JSON.stringify({
        parentCommit: MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
        operatorVersion: MERCHANDISING_HEURISTIC_OPERATOR_VERSION,
        implementationFingerprints:
          MERCHANDISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
        configurationFingerprints: configFingerprints,
        frozenConfigurations:
          FROZEN_MERCHANDISING_HEURISTIC_CONFIGURATIONS,
      }),
    );
  });
});
