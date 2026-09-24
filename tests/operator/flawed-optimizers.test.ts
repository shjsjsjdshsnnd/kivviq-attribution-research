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
import {
  BEST_SELLER_PUSH_CONFIG,
  BEST_SELLER_PUSH_OPERATOR,
  FLAWED_OPTIMIZER_BASELINE_OPERATORS,
  FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION,
  FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
  FLAWED_OPTIMIZER_IMPLEMENTATION_FINGERPRINTS,
  FLAWED_OPTIMIZER_METRIC_SET_VERSION,
  FLAWED_OPTIMIZER_OBSERVATION_KEY,
  FLAWED_OPTIMIZER_OPERATOR_VERSION,
  FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION,
  FLAWED_OPTIMIZER_SIMULATOR_VERSION,
  FROZEN_FLAWED_OPTIMIZER_CONFIGURATIONS,
  HIGHEST_CONVERSION_RATE_CONFIG,
  HIGHEST_CONVERSION_RATE_OPERATOR,
  LOWEST_CPA_CONFIG,
  LOWEST_CPA_OPERATOR,
  MAX_REVENUE_CONFIG,
  MAX_REVENUE_OPERATOR,
  MAX_ROAS_CONFIG,
  MAX_ROAS_OPERATOR,
  MIN_CAC_CONFIG,
  MIN_CAC_OPERATOR,
  flawedOptimizerConfigurationFingerprint,
  type FlawedChannelObservation,
  type FlawedOptimizerConfig,
  type FlawedProductObservation,
} from "../../src/operator/flawed-optimizers.js";
import { GREEDY_IMMEDIATE_REVENUE_OPERATOR } from "../../src/operator/greedy-operators.js";
import { FIXED_REORDER_THRESHOLD_OPERATOR } from "../../src/operator/inventory-heuristics.js";
import { RANK_BY_REVENUE_OPERATOR } from "../../src/operator/merchandising-heuristics.js";
import { FIXED_DISCOUNT_OPERATOR } from "../../src/operator/pricing-promotion-heuristics.js";
import { STATUS_QUO_OPERATOR_ID } from "../../src/operator/status-quo.js";
import type { CanonicalOperator } from "../../src/operator/types.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function opportunity(sequence = 0) {
  return createFixedIntervalDecisionOpportunity(contract, START, sequence);
}

function channel(
  channelId: string,
  overrides: Partial<FlawedChannelObservation> = {},
): FlawedChannelObservation {
  return {
    channelId,
    active: true,
    currentBudgetMinor: 500_000,
    spendMinor: 100_000,
    attributedRevenueMinor:
      channelId === "google_ads" ? 400_000 : 250_000,
    representedNewCustomers:
      channelId === "google_ads" ? 4 : 5,
    representedPurchaseConversions:
      channelId === "google_ads" ? 8 : 10,
    ...overrides,
  };
}

function product(
  productId: string,
  skuId: string,
  overrides: Partial<FlawedProductObservation> = {},
): FlawedProductObservation {
  const isA = productId === "product:A";
  return {
    productId,
    skuId,
    collectionId: "collection:X",
    active: true,
    available: true,
    promotionEligible: true,
    merchandisingEligible: true,
    currentPriceMinor: isA ? 10_000 : 20_000,
    recentUnits: isA ? 10 : 5,
    revenueMinor: isA ? 80_000 : 100_000,
    unitsSold: isA ? 10 : 5,
    conversions: isA ? 10 : 15,
    productViews: 100,
    currentPosition: isA ? 2 : 3,
    ...overrides,
  };
}

function defaultChannels(): readonly FlawedChannelObservation[] {
  return [channel("google_ads"), channel("meta_ads")];
}

function defaultProducts(): readonly FlawedProductObservation[] {
  return [
    product("product:A", "sku:A"),
    product("product:B", "sku:B"),
  ];
}

function observation(
  sequence = 0,
  channels: readonly FlawedChannelObservation[] = defaultChannels(),
  products: readonly FlawedProductObservation[] = defaultProducts(),
  extras: readonly {
    readonly observationKey: string;
    readonly value: unknown;
  }[] = [],
  lookbackDays = 7,
) {
  const o = opportunity(sequence);
  const end = Date.parse(o.at);
  const start = new Date(end - lookbackDays * DAY_MS).toISOString();
  return buildOperatorObservationSnapshot(contract, o, [
    {
      observationKey: FLAWED_OPTIMIZER_OBSERVATION_KEY,
      informationClass: "historical_information",
      sourceMinOccurredAt: start,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "historical-observable:step3.9-flawed-kpi-evidence",
      value: {
        schemaVersion: "1.0.0",
        currency: "CAD",
        lookbackDays,
        windowStart: start,
        windowEnd: o.at,
        channels,
        products,
      },
    },
    ...extras.map((extra) => ({
      observationKey: extra.observationKey,
      informationClass: "current_state_information" as const,
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "merchant-state:step3.9-adversarial-context",
      value: extra.value,
    })),
  ]);
}

function availability(
  sequence = 0,
  options: {
    readonly advertising?: boolean;
    readonly pricing?: boolean;
    readonly promotion?: boolean;
    readonly merchandising?: boolean;
    readonly adMaxBudgetMinor?: number;
    readonly priceMinMinor?: number;
    readonly merchandisingMaxPosition?: number;
  } = {},
) {
  const o = opportunity(sequence);
  const rules = [];

  if (options.advertising !== false) {
    rules.push({
      actionType: "advertising.adjust_budget",
      eligibleTargets: ["google_ads", "meta_ads"].map((channelId) => ({
        kind: "advertising_channel" as const,
        channelId,
      })),
      parameterBounds:
        options.adMaxBudgetMinor === undefined
          ? []
          : [
              {
                path: "parameters.operation.value.amountMinor",
                maxInclusive: options.adMaxBudgetMinor,
              },
            ],
      requiredPreconditionIds: [],
    });
  }

  if (options.pricing !== false) {
    rules.push({
      actionType: "pricing.adjust_price",
      eligibleTargets: [
        { kind: "sku" as const, productId: "product:A", skuId: "sku:A" },
        { kind: "sku" as const, productId: "product:B", skuId: "sku:B" },
      ],
      parameterBounds:
        options.priceMinMinor === undefined
          ? []
          : [
              {
                path: "parameters.operation.value.amountMinor",
                minInclusive: options.priceMinMinor,
              },
            ],
      requiredPreconditionIds: [],
    });
  }

  if (options.promotion !== false) {
    rules.push({
      actionType: "promotion.start",
      eligibleTargets: [
        {
          kind: "promotion" as const,
          promotionId: "promo_flawed_product_a_10pct",
        },
        {
          kind: "promotion" as const,
          promotionId: "promo_flawed_product_b_10pct",
        },
      ],
      parameterBounds: [],
      requiredPreconditionIds: [],
    });
  }

  if (options.merchandising !== false) {
    rules.push({
      actionType: "merchandising.move_product",
      eligibleTargets: ["product:A", "product:B"].map((productId) => ({
        kind: "product" as const,
        productId,
      })),
      parameterBounds:
        options.merchandisingMaxPosition === undefined
          ? []
          : [
              {
                path: "parameters.position",
                maxInclusive: options.merchandisingMaxPosition,
              },
            ],
      requiredPreconditionIds: [],
    });
  }

  return buildActionAvailabilitySnapshot(contract, o, rules);
}

function decision(
  operator: CanonicalOperator = MAX_ROAS_OPERATOR,
  channels: readonly FlawedChannelObservation[] = defaultChannels(),
  products: readonly FlawedProductObservation[] = defaultProducts(),
  options: {
    readonly sequence?: number;
    readonly extras?: readonly {
      readonly observationKey: string;
      readonly value: unknown;
    }[];
    readonly availability?: Parameters<typeof availability>[1];
    readonly lookbackDays?: number;
  } = {},
) {
  const sequence = options.sequence ?? 0;
  const o = opportunity(sequence);
  const obs = observation(
    sequence,
    channels,
    products,
    options.extras ?? [],
    options.lookbackDays ?? 7,
  );
  const avail = availability(sequence, options.availability ?? {});
  const input = toOperatorDecisionInput(o, obs, avail);
  const output = operator.decide(input);
  const audit = operator.auditDecision?.(input, output);
  return { o, obs, avail, input, output, audit };
}

function selectedCandidate(result: ReturnType<typeof decision>): any {
  const audit = result.audit?.payload as any;
  return (audit.candidateSet as any[]).find(
    (candidate) => candidate.candidateId === audit.selectedCandidateId,
  );
}

function seeds(operatorId: string): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: 3901 },
    { namespace: "customer_generation", value: 3902 },
    { namespace: "customer_behavior", value: 3903 },
    { namespace: "demand", value: 3904 },
    { namespace: "advertising_response", value: 3905 },
    { namespace: "journey_transitions", value: 3906 },
    { namespace: "external_events", value: 3907 },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId,
    },
  ];
}

describe("Step 3.9 plausible but flawed optimization baselines", () => {
  it("freezes six independent objective-specific operators", () => {
    expect(
      Object.keys(FLAWED_OPTIMIZER_BASELINE_OPERATORS),
    ).toEqual([
      "MAX_ROAS",
      "MIN_CAC",
      "MAX_REVENUE",
      "BEST_SELLER_PUSH",
      "LOWEST_CPA",
      "HIGHEST_CONVERSION_RATE",
    ]);
    const operators = Object.values(
      FLAWED_OPTIMIZER_BASELINE_OPERATORS,
    );
    expect(
      new Set(operators.map((operator) => operator.metadata.operatorId))
        .size,
    ).toBe(6);
    expect(
      new Set(
        operators.map(
          (operator) => operator.metadata.implementationFingerprint,
        ),
      ).size,
    ).toBe(6);

    for (const operator of operators) {
      expect(operator.metadata.operatorVersion).toBe(
        FLAWED_OPTIMIZER_OPERATOR_VERSION,
      );
      expect(
        operator.metadata.supportedEvaluationContract.contractFingerprint,
      ).toBe(contract.contractFingerprint);
      const cfg = operator.metadata.deterministicConfiguration as any;
      expect(cfg.configurationFingerprint).toMatch(
        /^fnv1a64:[0-9a-f]{16}$/,
      );
      expect(cfg.metricSetVersion).toBe(
        FLAWED_OPTIMIZER_METRIC_SET_VERSION,
      );
      expect(cfg.ecommerceEconomicsVersion).toBe(
        FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION,
      );
      expect(cfg.productEconomicsVersion).toBe(
        FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION,
      );
      expect(cfg.simulatorVersion).toBe(
        FLAWED_OPTIMIZER_SIMULATOR_VERSION,
      );
      expect(cfg.frozenParentCommit).toBe(
        FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
      );
    }
  });

  it("freezes explicit KPI formulas, windows, populations and evidence requirements", () => {
    expect(MAX_ROAS_CONFIG).toMatchObject({
      objectiveMetricId: "observed_roas",
      objectiveDirection: "MAXIMIZE",
      lookbackDays: 7,
      objectiveDefinition:
        "ATTRIBUTED_REVENUE_MINOR_DIVIDED_BY_OBSERVED_ADVERTISING_SPEND_MINOR",
    });
    expect(MIN_CAC_CONFIG).toMatchObject({
      objectiveMetricId: "observed_cac_minor",
      objectiveDirection: "MINIMIZE",
      population:
        "CANONICAL_NEW_CUSTOMERS_FIRST_REALIZED_ORDER_IN_LOOKBACK",
    });
    expect(LOWEST_CPA_CONFIG).toMatchObject({
      objectiveMetricId: "observed_cpa_minor",
      objectiveDirection: "MINIMIZE",
      population:
        "CONFIGURED_REALIZED_PURCHASE_CONVERSION_EVENTS_IN_LOOKBACK",
    });
    expect(HIGHEST_CONVERSION_RATE_CONFIG.minimumEvidence.minimumProductViews).toBe(
      20,
    );
  });

  it("objective fidelity: MAX_ROAS, MIN_CAC and MAX_REVENUE disagree when their KPIs disagree", () => {
    const channels = [
      channel("google_ads", {
        spendMinor: 125_000,
        attributedRevenueMinor: 1_000_000,
        representedNewCustomers: 1,
        representedPurchaseConversions: 5,
      }),
      channel("meta_ads", {
        spendMinor: 400_000,
        attributedRevenueMinor: 2_000_000,
        representedNewCustomers: 10,
        representedPurchaseConversions: 20,
      }),
    ];
    const products = defaultProducts().map((entry) => ({
      ...entry,
      revenueMinor: 1,
      recentUnits: 0,
      currentPosition: 1,
    }));

    expect(
      selectedCandidate(
        decision(MAX_ROAS_OPERATOR, channels, products),
      ).targetKey,
    ).toContain("google_ads");

    expect(
      selectedCandidate(
        decision(MIN_CAC_OPERATOR, channels, products),
      ).targetKey,
    ).toContain("meta_ads");

    expect(
      selectedCandidate(
        decision(MAX_REVENUE_OPERATOR, channels, products, {
          availability: {
            pricing: false,
            promotion: false,
            merchandising: false,
          },
        }),
      ).targetKey,
    ).toContain("meta_ads");
  });

  it("keeps MIN_CAC and LOWEST_CPA semantically distinct", () => {
    const channels = [
      channel("google_ads", {
        spendMinor: 100_000,
        representedNewCustomers: 10,
        representedPurchaseConversions: 2,
      }),
      channel("meta_ads", {
        spendMinor: 100_000,
        representedNewCustomers: 5,
        representedPurchaseConversions: 20,
      }),
    ];

    const cac = decision(MIN_CAC_OPERATOR, channels);
    const cpa = decision(LOWEST_CPA_OPERATOR, channels);

    expect(cac.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
    expect(cpa.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "meta_ads",
    });
    expect(
      (cac.audit?.payload as any).population,
    ).toBe("CANONICAL_NEW_CUSTOMERS_FIRST_REALIZED_ORDER_IN_LOOKBACK");
    expect(
      (cpa.audit?.payload as any).population,
    ).toBe(
      "CONFIGURED_REALIZED_PURCHASE_CONVERSION_EVENTS_IN_LOOKBACK",
    );
  });

  it("BEST_SELLER_PUSH increases exposure to the canonical observed units-sold leader", () => {
    const products = [
      product("product:A", "sku:A", {
        unitsSold: 100,
        revenueMinor: 10,
        currentPosition: 3,
      }),
      product("product:B", "sku:B", {
        unitsSold: 80,
        revenueMinor: 1_000_000,
        currentPosition: 2,
      }),
    ];
    const result = decision(
      BEST_SELLER_PUSH_OPERATOR,
      [],
      products,
    );
    expect(String(result.output.actions[0]!.actionType)).toBe(
      "promotion.start",
    );
    expect(
      selectedCandidate(result).targetKey,
    ).toContain("promo_flawed_product_a_10pct");
    expect((result.audit?.payload as any).selectedKpiValue).toBe(100);
  });

  it("HIGHEST_CONVERSION_RATE favors the highest observed orders-per-view product", () => {
    const products = [
      product("product:A", "sku:A", {
        conversions: 5,
        productViews: 100,
        currentPosition: 3,
      }),
      product("product:B", "sku:B", {
        conversions: 8,
        productViews: 20,
        currentPosition: 2,
      }),
    ];
    const result = decision(
      HIGHEST_CONVERSION_RATE_OPERATOR,
      [],
      products,
    );
    expect(
      selectedCandidate(result).targetKey,
    ).toContain("product:B");
    expect((result.audit?.payload as any).selectedKpiValue).toBeCloseTo(
      0.4,
      10,
    );
  });

  it("uses deterministic no-action when no selectable positive KPI candidate remains", () => {
    const channels = [
      channel("google_ads", {
        spendMinor: null,
        attributedRevenueMinor: null,
        representedNewCustomers: null,
        representedPurchaseConversions: null,
      }),
      channel("meta_ads", {
        active: false,
      }),
    ];
    const products = defaultProducts().map((entry) => ({
      ...entry,
      available: false,
    }));

    const result = decision(MAX_ROAS_OPERATOR, channels, products);
    expect(result.output.actions).toEqual([]);
    expect((result.audit?.payload as any).selectedCandidateId).toBe(
      "candidate:no_action",
    );
  });

  it("uses frozen deterministic tie-breaking", () => {
    const channels = [
      channel("meta_ads", {
        spendMinor: 100_000,
        attributedRevenueMinor: 500_000,
      }),
      channel("google_ads", {
        spendMinor: 100_000,
        attributedRevenueMinor: 500_000,
      }),
    ];
    const result = decision(MAX_ROAS_OPERATOR, channels);
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
    expect(
      (result.audit?.payload as any).tieBreakDecisions.length,
    ).toBeGreaterThan(0);
  });

  it("excludes missing/zero-denominator KPI candidates rather than inventing estimates", () => {
    const channels = [
      channel("google_ads", {
        spendMinor: 100_000,
        representedNewCustomers: 0,
        representedPurchaseConversions: 0,
      }),
      channel("meta_ads", {
        spendMinor: 100_000,
        representedNewCustomers: 5,
        representedPurchaseConversions: 5,
      }),
    ];

    const cac = decision(MIN_CAC_OPERATOR, channels);
    const cpa = decision(LOWEST_CPA_OPERATOR, channels);

    expect(
      (cac.audit?.payload as any).excludedCandidates,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exclusionReason: "INSUFFICIENT_CAC_EVIDENCE",
        }),
      ]),
    );
    expect(
      (cpa.audit?.payload as any).excludedCandidates,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exclusionReason: "INSUFFICIENT_CPA_EVIDENCE",
        }),
      ]),
    );
  });

  it("enforces the frozen minimum conversion evidence without uncertainty penalties above the threshold", () => {
    const products = [
      product("product:A", "sku:A", {
        conversions: 10,
        productViews: 19,
        currentPosition: 3,
      }),
      product("product:B", "sku:B", {
        conversions: 4,
        productViews: 20,
        currentPosition: 2,
      }),
    ];
    const result = decision(
      HIGHEST_CONVERSION_RATE_OPERATOR,
      [],
      products,
    );
    expect(
      selectedCandidate(result).targetKey,
    ).toContain("product:B");
    expect(
      (result.audit?.payload as any).excludedCandidates,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exclusionReason:
            "INSUFFICIENT_CONVERSION_RATE_EVIDENCE",
        }),
      ]),
    );
  });

  it("MAX_REVENUE ignores margin and chooses the greater observable revenue opportunity", () => {
    const channels = [
      channel("google_ads", {
        attributedRevenueMinor: 2_000_000,
      }),
      channel("meta_ads", {
        attributedRevenueMinor: 500_000,
      }),
    ];
    const ordinary = decision(
      MAX_REVENUE_OPERATOR,
      channels,
      defaultProducts(),
      {
        availability: {
          pricing: false,
          promotion: false,
          merchandising: false,
        },
      },
    );
    const adversarial = decision(
      MAX_REVENUE_OPERATOR,
      channels,
      defaultProducts(),
      {
        availability: {
          pricing: false,
          promotion: false,
          merchandising: false,
        },
        extras: [
          {
            observationKey: "flawed.profit_conflict",
            value: {
              googleContributionMinor: -1_000_000,
              metaContributionMinor: 500_000,
            },
          },
        ],
      },
    );
    expect(adversarial.output).toEqual(ordinary.output);
    expect(adversarial.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
  });

  it.each([
    [
      "MAX_ROAS",
      MAX_ROAS_OPERATOR,
      {
        attributionBias: true,
        lowIncrementalityLeader: "google_ads",
      },
    ],
    [
      "MIN_CAC",
      MIN_CAC_OPERATOR,
      {
        poorRetentionCheapestCustomers: true,
        lowFutureCustomerValue: true,
      },
    ],
    [
      "MAX_REVENUE",
      MAX_REVENUE_OPERATOR,
      {
        marginDestruction: true,
        returnCostDifference: true,
      },
    ],
    [
      "BEST_SELLER_PUSH",
      BEST_SELLER_PUSH_OPERATOR,
      {
        bestsellerNearStockout: true,
        substitutionRisk: true,
      },
    ],
    [
      "LOWEST_CPA",
      LOWEST_CPA_OPERATOR,
      {
        cheapConversionsLowValue: true,
        lowQualityCustomers: true,
      },
    ],
    [
      "HIGHEST_CONVERSION_RATE",
      HIGHEST_CONVERSION_RATE_OPERATOR,
      {
        highConversionLowAov: true,
        positionBias: true,
      },
    ],
  ])(
    "%s remains narrowly KPI-driven under broader-value conflict",
    (_name, operator, contextValue) => {
      const ordinary = decision(operator as CanonicalOperator);
      const conflicted = decision(
        operator as CanonicalOperator,
        defaultChannels(),
        defaultProducts(),
        {
          extras: [
            {
              observationKey: "flawed.conflict_context",
              value: contextValue,
            },
          ],
        },
      );
      expect(conflicted.output).toEqual(ordinary.output);
    },
  );

  it("ignores uncertainty after frozen minimum evidence requirements are met", () => {
    const channels = [
      channel("google_ads", {
        spendMinor: 1_000,
        attributedRevenueMinor: 8_000,
      }),
      channel("meta_ads", {
        spendMinor: 1_000_000,
        attributedRevenueMinor: 7_900_000,
      }),
    ];
    const result = decision(MAX_ROAS_OPERATOR, channels);
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
  });

  it("ignores delayed effects, substitution, cannibalization and promotion pull-forward", () => {
    const ordinary = decision(BEST_SELLER_PUSH_OPERATOR);
    const adversarial = decision(
      BEST_SELLER_PUSH_OPERATOR,
      defaultChannels(),
      defaultProducts(),
      {
        extras: [
          {
            observationKey: "flawed.adversarial_context",
            value: {
              delayedEffects: true,
              substitution: true,
              cannibalization: true,
              promotionPullForward: true,
              futureDemandReversal: true,
            },
          },
        ],
      },
    );
    expect(adversarial.output).toEqual(ordinary.output);
  });

  it("Step 3.1 blocks GroundTruth from the flawed optimizer observation boundary", () => {
    const o = opportunity(0);
    expect(() =>
      buildOperatorObservationSnapshot(contract, o, [
        {
          observationKey: "forbidden.truth",
          informationClass: "simulator_latent_state",
          sourceMinOccurredAt: o.at,
          sourceMaxOccurredAt: o.at,
          availableAt: o.at,
          sourceRef: "ground-truth:flawed-optimizer",
          value: { trueCausalLift: 1 },
        },
      ]),
    ).toThrow();
  });

  it("generates a finite deterministic canonical candidate set", () => {
    const first = decision(MAX_REVENUE_OPERATOR);
    const second = decision(MAX_REVENUE_OPERATOR);
    const firstAudit = first.audit?.payload as any;
    const secondAudit = second.audit?.payload as any;
    expect(firstAudit.candidateSet.length).toBeLessThanOrEqual(64);
    expect(firstAudit.candidateSet).toEqual(secondAudit.candidateSet);
    expect(firstAudit.candidateRanking).toEqual(
      secondAudit.candidateRanking,
    );
    for (const candidate of firstAudit.candidateSet as any[]) {
      if (candidate.action !== null) {
        expect(assertValidAction(candidate.action)).toEqual(
          candidate.action,
        );
      }
    }
  });

  it("passes selected Actions through accepted, rejected and explicit modified constraint outcomes", () => {
    const o = opportunity(0);
    const obs = observation(0);
    const avail = availability(0);

    const accepted = invokeOperatorAtDecision(
      contract,
      MAX_ROAS_OPERATOR,
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
      MAX_ROAS_OPERATOR,
      o,
      obs,
      avail,
      () => ({
        issues: [
          {
            kind: "INFEASIBLE" as const,
            constraintRef: "merchant_budget",
            reason: "Synthetic budget rejection.",
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
      MAX_ROAS_OPERATOR,
      o,
      obs,
      avail,
      (action) => {
        if (
          action.parameters.kind !== "budget_adjustment" ||
          action.parameters.operation.kind !== "SET"
        ) {
          throw new Error("unexpected Action");
        }
        const replacement = assertValidAction({
          ...action,
          actionId: actionId(String(action.actionId) + "_modified"),
          parameters: {
            kind: "budget_adjustment",
            operation: {
              kind: "SET",
              value: {
                ...action.parameters.operation.value,
                amountMinor:
                  action.parameters.operation.value.amountMinor - 50_000,
              },
            },
          },
        });
        return {
          issues: [
            {
              kind: "PARTIALLY_FEASIBLE" as const,
              constraintRef: "merchant_budget",
              reason: "Only a smaller increase is feasible.",
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

  it("keeps operator KPI objective separate from evaluator outcome metrics", () => {
    const result = decision(MAX_REVENUE_OPERATOR);
    const audit = result.audit?.payload as any;
    expect(audit.objectiveSeparatedFromEvaluationMetrics).toBe(true);
    expect(audit.evaluatorOutcomeMetricUsedInDecision).toBe(false);
    expect(audit.objectiveMetricId).toBe(
      "estimated_short_term_revenue_minor",
    );
  });

  it("selected supported advertising Actions translate through the frozen simulator boundary", () => {
    const action = decision(MAX_ROAS_OPERATOR).output.actions[0]!;
    const translation = translateBusinessAction(action, {
      ...fullTranslationContext,
      simulatorClock: action.timing.decisionTime,
      entityMappings: [
        ...fullTranslationContext.entityMappings,
        {
          actionTarget: {
            kind: "advertising_channel",
            channelId: "google_ads",
          },
          simulatorTarget: {
            kind: "channel",
            simulatorChannelId: "sim:google_ads",
          },
          sourceRef: "mapping:step3.9:google-channel",
        },
      ],
    });
    expect(translation.status).toBe("TRANSLATED");
  });

  it("preserves paired-comparison validity with the prior baseline ladder", () => {
    const worldId = "step3.9.synthetic-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });
    const reference = createEvaluationComparisonBinding(
      contract,
      FLAWED_OPTIMIZER_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(DO_NOTHING_OPERATOR.metadata.operatorId),
    );

    const statusQuo = createEvaluationComparisonBinding(
      contract,
      FLAWED_OPTIMIZER_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(STATUS_QUO_OPERATOR_ID),
    );
    assertEquivalentComparisonBindings(reference, statusQuo);

    for (const operator of [
      EQUAL_BUDGET_ALLOCATION_OPERATOR,
      FIXED_REORDER_THRESHOLD_OPERATOR,
      FIXED_DISCOUNT_OPERATOR,
      RANK_BY_REVENUE_OPERATOR,
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      ...Object.values(FLAWED_OPTIMIZER_BASELINE_OPERATORS),
    ]) {
      const binding = createEvaluationComparisonBinding(
        contract,
        FLAWED_OPTIMIZER_SIMULATOR_VERSION,
        worldId,
        worldFingerprint,
        "CAD",
        START,
        seeds(operator.metadata.operatorId),
      );
      assertEquivalentComparisonBindings(reference, binding);
    }
  });

  it("produces complete reproducible 90-opportunity artifacts for all six flawed optimizers", () => {
    const worldId = "step3.9.artifact-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    for (const operator of Object.values(
      FLAWED_OPTIMIZER_BASELINE_OPERATORS,
    )) {
      const decisions = Array.from({ length: 90 }, (_, sequence) =>
        invokeOperatorAtDecision(
          contract,
          operator,
          opportunity(sequence),
          observation(sequence),
          availability(sequence),
          () => ({ issues: [] }),
        ),
      );

      const artifact = createEvaluationRunArtifact(contract, {
        operator: {
          operatorId: operator.metadata.operatorId,
          operatorVersion: operator.metadata.operatorVersion,
          operatorFingerprint:
            operator.metadata.implementationFingerprint,
        },
        simulatorVersion: FLAWED_OPTIMIZER_SIMULATOR_VERSION,
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
          objectiveIsNotEvaluationOutcome: true,
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
      expect(
        bundle.operatorInvocations.every(
          (invocation) =>
            invocation.decisionAudit?.auditType ===
            "flawed_optimizer_candidate_evaluation",
        ),
      ).toBe(true);
      const audit = bundle.operatorInvocations[0]!
        .decisionAudit?.payload as any;
      expect(audit.candidateSet.length).toBeGreaterThan(0);
      expect(audit.candidateRanking.length).toBeGreaterThan(0);
      expect(audit.selectedCandidateId).toBeDefined();
    }
  }, 20_000);

  it("freezes all six configurations and fingerprints", () => {
    const configs: readonly FlawedOptimizerConfig[] = [
      MAX_ROAS_CONFIG,
      MIN_CAC_CONFIG,
      MAX_REVENUE_CONFIG,
      BEST_SELLER_PUSH_CONFIG,
      LOWEST_CPA_CONFIG,
      HIGHEST_CONVERSION_RATE_CONFIG,
    ];
    const configFingerprints = Object.fromEntries(
      configs.map((config) => [
        config.objective,
        flawedOptimizerConfigurationFingerprint(config),
      ]),
    );
    expect(new Set(Object.values(configFingerprints)).size).toBe(6);
    for (const fingerprint of Object.values(configFingerprints)) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }

    console.log(
      "STEP3_9_FLAWED_OPTIMIZER_FREEZE",
      JSON.stringify({
        parentCommit: FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
        operatorVersion: FLAWED_OPTIMIZER_OPERATOR_VERSION,
        implementationFingerprints:
          FLAWED_OPTIMIZER_IMPLEMENTATION_FINGERPRINTS,
        configurationFingerprints: configFingerprints,
        frozenConfigurations:
          FROZEN_FLAWED_OPTIMIZER_CONFIGURATIONS,
      }),
    );
  });
});
