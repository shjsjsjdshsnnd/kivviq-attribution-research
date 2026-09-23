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
  FROZEN_GREEDY_CONFIGURATIONS,
  GREEDY_BASELINE_OPERATORS,
  GREEDY_FROZEN_STEP_3_7_COMMIT,
  GREEDY_IMPLEMENTATION_FINGERPRINTS,
  GREEDY_IMMEDIATE_CONTRIBUTION_CONFIG,
  GREEDY_IMMEDIATE_CONTRIBUTION_OPERATOR,
  GREEDY_IMMEDIATE_GROSS_PROFIT_CONFIG,
  GREEDY_IMMEDIATE_GROSS_PROFIT_OPERATOR,
  GREEDY_IMMEDIATE_REVENUE_CONFIG,
  GREEDY_IMMEDIATE_REVENUE_OPERATOR,
  GREEDY_METRIC_SET_VERSION,
  GREEDY_OBSERVATION_KEY,
  GREEDY_OPERATOR_VERSION,
  GREEDY_SIMULATOR_VERSION,
  greedyConfigurationFingerprint,
  type GreedyChannelObservation,
  type GreedyConfiguration,
  type GreedyProductObservation,
} from "../../src/operator/greedy-operators.js";
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
  overrides: Partial<GreedyChannelObservation> = {},
): GreedyChannelObservation {
  return {
    channelId,
    active: true,
    currentBudgetMinor: 500_000,
    spendMinor: 100_000,
    attributedRevenueMinor:
      channelId === "google_ads" ? 400_000 : 250_000,
    attributedGrossProfitMinor:
      channelId === "google_ads" ? 200_000 : 150_000,
    attributedContributionMinor:
      channelId === "google_ads" ? 100_000 : 75_000,
    ...overrides,
  };
}

function product(
  productId: string,
  skuId: string,
  overrides: Partial<GreedyProductObservation> = {},
): GreedyProductObservation {
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
    grossProfitMinor: isA ? 40_000 : 70_000,
    contributionMinor: isA ? 20_000 : 50_000,
    productViews: 100,
    conversions: isA ? 10 : 15,
    currentPosition: isA ? 2 : 3,
    availableUnits: 50,
    pendingReorder: false,
    incomingUnits: 0,
    supplierAvailable: true,
    ...overrides,
  };
}

function defaultChannels(): readonly GreedyChannelObservation[] {
  return [channel("google_ads"), channel("meta_ads")];
}

function defaultProducts(): readonly GreedyProductObservation[] {
  return [
    product("product:A", "sku:A"),
    product("product:B", "sku:B"),
  ];
}

function observation(
  sequence = 0,
  channels: readonly GreedyChannelObservation[] = defaultChannels(),
  products: readonly GreedyProductObservation[] = defaultProducts(),
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
      observationKey: GREEDY_OBSERVATION_KEY,
      informationClass: "historical_information",
      sourceMinOccurredAt: start,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "historical-observable:step3.8-greedy-evidence",
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
      sourceRef: "merchant-state:step3.8-adversarial-context",
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
    readonly inventory?: boolean;
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
          promotionId: "promo_greedy_product_a_10pct",
        },
        {
          kind: "promotion" as const,
          promotionId: "promo_greedy_product_b_10pct",
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

  if (options.inventory !== false) {
    rules.push({
      actionType: "inventory.reorder",
      eligibleTargets: [
        { kind: "sku" as const, productId: "product:A", skuId: "sku:A" },
        { kind: "sku" as const, productId: "product:B", skuId: "sku:B" },
      ],
      parameterBounds: [],
      requiredPreconditionIds: [],
    });
  }

  return buildActionAvailabilitySnapshot(contract, o, rules);
}

function decision(
  operator: CanonicalOperator = GREEDY_IMMEDIATE_REVENUE_OPERATOR,
  channels: readonly GreedyChannelObservation[] = defaultChannels(),
  products: readonly GreedyProductObservation[] = defaultProducts(),
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
    { namespace: "world_generation", value: 3801 },
    { namespace: "customer_generation", value: 3802 },
    { namespace: "customer_behavior", value: 3803 },
    { namespace: "demand", value: 3804 },
    { namespace: "advertising_response", value: 3805 },
    { namespace: "journey_transitions", value: 3806 },
    { namespace: "external_events", value: 3807 },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId,
    },
  ];
}

describe("Step 3.8 canonical greedy baseline operators", () => {
  it("freezes three explicit greedy objective configurations", () => {
    expect(Object.keys(GREEDY_BASELINE_OPERATORS)).toEqual([
      "IMMEDIATE_REVENUE",
      "IMMEDIATE_GROSS_PROFIT",
      "IMMEDIATE_CONTRIBUTION",
    ]);
    const operators = Object.values(GREEDY_BASELINE_OPERATORS);
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
        GREEDY_OPERATOR_VERSION,
      );
      expect(
        operator.metadata.supportedEvaluationContract.contractFingerprint,
      ).toBe(contract.contractFingerprint);
      const cfg = operator.metadata.deterministicConfiguration as any;
      expect(cfg.configurationFingerprint).toMatch(
        /^fnv1a64:[0-9a-f]{16}$/,
      );
      expect(cfg.metricSetVersion).toBe(GREEDY_METRIC_SET_VERSION);
      expect(cfg.simulatorVersion).toBe(GREEDY_SIMULATOR_VERSION);
      expect(cfg.frozenParentCommit).toBe(
        GREEDY_FROZEN_STEP_3_7_COMMIT,
      );
      expect(cfg.candidateScoringSeparatedFromEvaluationScoring).toBe(
        true,
      );
    }
  });

  it("freezes immediate-return semantics, bounded enumeration and no-action score", () => {
    expect(GREEDY_IMMEDIATE_REVENUE_CONFIG).toMatchObject({
      objectiveMetricId: "estimated_immediate_revenue_minor",
      currency: "CAD",
      lookbackDays: 7,
      maximumCandidateCount: 64,
      maxTargetsPerActionType: 8,
      noActionImmediateReturnMinor: 0,
      missingEvidenceBehavior: "EXCLUDE_CANDIDATE",
      causalityCorrection: false,
      uncertaintyAdjustment: false,
      delayedEffectAdjustment: false,
      substitutionAdjustment: false,
      retentionClvAdjustment: false,
    });
    expect(
      GREEDY_IMMEDIATE_REVENUE_CONFIG.candidateParameterGrid,
    ).toMatchObject({
      advertisingBudgetIncreaseMinor: [100000],
      pricingPriceChangeBasisPoints: [-1000, 500],
      merchandisingPositions: [1],
      inventoryReorderQuantities: [50],
    });
  });

  it("chooses the highest observed immediate-return advertising spend candidate", () => {
    const result = decision();
    expect(result.output.actions).toHaveLength(1);
    expect(String(result.output.actions[0]!.actionType)).toBe(
      "advertising.adjust_budget",
    );
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
    expect(
      (result.audit?.payload as any).selectedImmediateReturnMinor,
    ).toBe(400_000);
  });

  it("uses separate objective configurations rather than switching objectives opportunistically", () => {
    const channels = [
      channel("google_ads", {
        attributedRevenueMinor: 500_000,
        attributedGrossProfitMinor: 20_000,
        attributedContributionMinor: 5_000,
      }),
      channel("meta_ads", {
        attributedRevenueMinor: 100_000,
        attributedGrossProfitMinor: 10_000,
        attributedContributionMinor: 5_000,
      }),
    ];
    const products = [
      product("product:A", "sku:A", {
        revenueMinor: 50_000,
        grossProfitMinor: 60_000,
        contributionMinor: 70_000,
      }),
      product("product:B", "sku:B", {
        revenueMinor: 60_000,
        grossProfitMinor: 80_000,
        contributionMinor: 90_000,
      }),
    ];

    expect(
      selectedCandidate(
        decision(
          GREEDY_IMMEDIATE_REVENUE_OPERATOR,
          channels,
          products,
        ),
      ).domain,
    ).toBe("advertising");

    expect(
      selectedCandidate(
        decision(
          GREEDY_IMMEDIATE_GROSS_PROFIT_OPERATOR,
          channels,
          products,
        ),
      ).domain,
    ).toBe("merchandising");

    expect(
      selectedCandidate(
        decision(
          GREEDY_IMMEDIATE_CONTRIBUTION_OPERATOR,
          channels,
          products,
        ),
      ).domain,
    ).toBe("merchandising");
  });

  it("includes no action at score zero and selects it rather than a negative or zero intervention", () => {
    const channels = [
      channel("google_ads", {
        attributedRevenueMinor: -10_000,
        attributedGrossProfitMinor: -10_000,
        attributedContributionMinor: -10_000,
      }),
      channel("meta_ads", {
        attributedRevenueMinor: -20_000,
        attributedGrossProfitMinor: -20_000,
        attributedContributionMinor: -20_000,
      }),
    ];
    const products = [
      product("product:A", "sku:A", {
        recentUnits: 0,
        revenueMinor: -1,
        grossProfitMinor: -1,
        contributionMinor: -1,
        currentPosition: 1,
      }),
      product("product:B", "sku:B", {
        recentUnits: 0,
        revenueMinor: -2,
        grossProfitMinor: -2,
        contributionMinor: -2,
        currentPosition: 1,
      }),
    ];
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      channels,
      products,
    );
    expect(result.output.actions).toEqual([]);
    expect((result.audit?.payload as any).selectedCandidateId).toBe(
      "candidate:no_action",
    );
    expect(
      (result.audit?.payload as any).selectedImmediateReturnMinor,
    ).toBe(0);
  });

  it("uses deterministic tie-breaking without runtime iteration order", () => {
    const channels = [
      channel("meta_ads", {
        spendMinor: 100_000,
        attributedRevenueMinor: 100_000,
      }),
      channel("google_ads", {
        spendMinor: 100_000,
        attributedRevenueMinor: 100_000,
      }),
    ];
    const products = defaultProducts().map((entry) => ({
      ...entry,
      revenueMinor: 1,
      currentPosition: 1,
      recentUnits: 0,
    }));
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      channels,
      products,
    );
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
    expect(
      (result.audit?.payload as any).tieBreakDecisions.length,
    ).toBeGreaterThan(0);
  });

  it("excludes candidates with missing evidence instead of inventing estimates", () => {
    const channels = [
      channel("google_ads", { spendMinor: null }),
      channel("meta_ads", {
        spendMinor: 100_000,
        attributedRevenueMinor: 250_000,
      }),
    ];
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      channels,
      defaultProducts(),
    );
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "meta_ads",
    });
    expect(
      (result.audit?.payload as any).excludedCandidates,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "advertising.adjust_budget",
          exclusionReason: "INSUFFICIENT_ADVERTISING_EVIDENCE",
        }),
      ]),
    );
  });

  it("keeps candidate generation finite, deterministic and below the frozen bound", () => {
    const first = decision();
    const second = decision();
    const firstAudit = first.audit?.payload as any;
    const secondAudit = second.audit?.payload as any;
    expect(firstAudit.candidateSet.length).toBeLessThanOrEqual(64);
    expect(firstAudit.candidateSet).toEqual(secondAudit.candidateSet);
    expect(firstAudit.candidateRanking).toEqual(
      secondAudit.candidateRanking,
    );
  });

  it("uses the same greedy semantics for pricing candidates", () => {
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      [],
      [
        product("product:A", "sku:A", {
          recentUnits: 100,
          revenueMinor: 1,
          currentPosition: 1,
        }),
        product("product:B", "sku:B", {
          recentUnits: 1,
          revenueMinor: 1,
          currentPosition: 1,
        }),
      ],
      {
        availability: {
          advertising: false,
          merchandising: false,
          inventory: false,
        },
      },
    );
    expect(String(result.output.actions[0]!.actionType)).toBe(
      "pricing.adjust_price",
    );
    expect(
      result.output.actions[0]!.parameters.kind,
    ).toBe("price_adjustment");
    expect(
      selectedCandidate(result).parameterKey,
    ).toBe("price_change_bps=500");
  });

  it("enumerates promotion candidates with their naïve immediate configured price effect", () => {
    const result = decision();
    const promotions = ((result.audit?.payload as any).candidateSet as any[])
      .filter((candidate) => candidate.domain === "promotion");
    expect(promotions).toHaveLength(2);
    expect(
      promotions.every(
        (candidate) =>
          candidate.estimatedImmediateReturnMinor !== null &&
          candidate.estimatedImmediateReturnMinor < 0,
      ),
    ).toBe(true);
  });

  it("uses the same greedy semantics for merchandising candidates", () => {
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      [],
      [
        product("product:A", "sku:A", {
          revenueMinor: 80_000,
          recentUnits: 0,
        }),
        product("product:B", "sku:B", {
          revenueMinor: 200_000,
          recentUnits: 0,
        }),
      ],
      {
        availability: {
          advertising: false,
          pricing: false,
          promotion: false,
          inventory: false,
        },
      },
    );
    expect(String(result.output.actions[0]!.actionType)).toBe(
      "merchandising.move_product",
    );
    expect(result.output.actions[0]!.target).toEqual({
      kind: "product",
      productId: "product:B",
    });
  });

  it("audits canonical inventory candidates but excludes them because the frozen simulator cannot execute them faithfully", () => {
    const result = decision();
    const inventory = ((result.audit?.payload as any).candidateSet as any[])
      .filter((candidate) => candidate.domain === "inventory");
    expect(inventory).toHaveLength(2);
    expect(
      inventory.every(
        (candidate) =>
          candidate.action?.actionType === "inventory.reorder" &&
          candidate.selectable === false &&
          candidate.exclusionReason ===
            "FROZEN_SIMULATOR_INVENTORY_ACTIONS_UNSUPPORTED",
      ),
    ).toBe(true);
  });

  it("anti-causality: chooses the observed-ROAS winner and Step 3.1 blocks GroundTruth", () => {
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      [
        channel("google_ads", {
          spendMinor: 100_000,
          attributedRevenueMinor: 500_000,
        }),
        channel("meta_ads", {
          spendMinor: 100_000,
          attributedRevenueMinor: 200_000,
        }),
      ],
      defaultProducts(),
      {
        extras: [
          {
            observationKey: "greedy.incrementality_concern",
            value: {
              channelAConcern: "HIGH",
              channelBConcern: "LOW",
            },
          },
        ],
      },
    );
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });

    const o = opportunity(0);
    expect(() =>
      buildOperatorObservationSnapshot(contract, o, [
        {
          observationKey: "forbidden.truth",
          informationClass: "simulator_latent_state",
          sourceMinOccurredAt: o.at,
          sourceMaxOccurredAt: o.at,
          availableAt: o.at,
          sourceRef: "ground-truth:channel-effects",
          value: { hiddenChannelEffect: 1 },
        },
      ]),
    ).toThrow();
  });

  it("anti-uncertainty: chooses score 101 over 100 without evidence-size penalty", () => {
    const result = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      [
        channel("google_ads", {
          spendMinor: 1_000,
          attributedRevenueMinor: 1.01,
        }),
        channel("meta_ads", {
          spendMinor: 1_000_000,
          attributedRevenueMinor: 1_000,
        }),
      ],
      defaultProducts().map((entry) => ({
        ...entry,
        revenueMinor: 1,
        recentUnits: 0,
        currentPosition: 1,
      })),
    );
    expect(result.output.actions[0]!.target).toEqual({
      kind: "advertising_channel",
      channelId: "google_ads",
    });
    expect(
      (result.audit?.payload as any).selectedImmediateReturnMinor,
    ).toBeCloseTo(101, 8);
  });

  it.each([
    [
      "delayed effects",
      {
        longHorizonRisk: "HIGH",
        delayedConversionPreference: "OTHER_CANDIDATE",
      },
    ],
    [
      "substitution and cannibalization",
      {
        substitutionConcern: "HIGH",
        cannibalizationConcern: "HIGH",
      },
    ],
    [
      "retention and CLV",
      {
        retentionQualityConcern: "HIGH",
        longHorizonCustomerValuePreference: "OTHER_CANDIDATE",
      },
    ],
  ])(
    "remains greedy when current context flags %s",
    (_, contextValue) => {
      const ordinary = decision();
      const adversarial = decision(
        GREEDY_IMMEDIATE_REVENUE_OPERATOR,
        defaultChannels(),
        defaultProducts(),
        {
          extras: [
            {
              observationKey: "greedy.long_horizon_context",
              value: contextValue,
            },
          ],
        },
      );
      expect(adversarial.output).toEqual(ordinary.output);
    },
  );

  it("adversarial failure modes do not rescue the greedy action", () => {
    const ordinary = decision();
    const adversarial = decision(
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      defaultChannels(),
      defaultProducts(),
      {
        extras: [
          {
            observationKey: "greedy.adversarial_context",
            value: {
              attributionBiasConcern: true,
              noisyEstimateConcern: true,
              inventoryDepletionConcern: true,
              promotionPullForwardConcern: true,
              lowQualityAcquisitionConcern: true,
              longTermMarginConcern: true,
            },
          },
        ],
      },
    );
    expect(adversarial.output).toEqual(ordinary.output);
  });

  it("passes the selected greedy Action through accepted, rejected and explicit modified constraint outcomes", () => {
    const o = opportunity(0);
    const obs = observation(0);
    const avail = availability(0);

    const accepted = invokeOperatorAtDecision(
      contract,
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
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
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
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
      GREEDY_IMMEDIATE_REVENUE_OPERATOR,
      o,
      obs,
      avail,
      (action) => {
        if (
          action.parameters.kind !== "budget_adjustment" ||
          action.parameters.operation.kind !== "SET"
        ) {
          throw new Error("unexpected greedy Action");
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
    expect(
      modified.decisionRecord.actionAttempts[0]?.executedAction,
    ).toBeDefined();
  });

  it("keeps internal candidate score separate from evaluator outcome metrics", () => {
    const result = decision();
    const audit = result.audit?.payload as any;
    expect(audit.candidateScoringSeparatedFromEvaluationScoring).toBe(
      true,
    );
    expect(audit.evaluatorOutcomeMetricUsedInDecision).toBe(false);
    expect(audit.objectiveMetricId).toBe(
      "estimated_immediate_revenue_minor",
    );
  });

  it("selected supported Actions translate through the frozen simulator boundary", () => {
    const action = decision().output.actions[0]!;
    const translation = translateBusinessAction(action, {
      ...fullTranslationContext,
      simulatorClock: action.timing.decisionTime,
    });
    expect(translation.status).toBe("TRANSLATED");
  });

  it("preserves paired-comparison bindings with the prior baseline ladder", () => {
    const worldId = "step3.8.synthetic-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    const priorOperators = [
      DO_NOTHING_OPERATOR,
      EQUAL_BUDGET_ALLOCATION_OPERATOR,
      FIXED_REORDER_THRESHOLD_OPERATOR,
      FIXED_DISCOUNT_OPERATOR,
      RANK_BY_REVENUE_OPERATOR,
    ];

    const reference = createEvaluationComparisonBinding(
      contract,
      GREEDY_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(DO_NOTHING_OPERATOR.metadata.operatorId),
    );

    const statusQuo = createEvaluationComparisonBinding(
      contract,
      GREEDY_SIMULATOR_VERSION,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      seeds(STATUS_QUO_OPERATOR_ID),
    );
    assertEquivalentComparisonBindings(reference, statusQuo);

    for (const operator of [
      ...priorOperators,
      ...Object.values(GREEDY_BASELINE_OPERATORS),
    ]) {
      const binding = createEvaluationComparisonBinding(
        contract,
        GREEDY_SIMULATOR_VERSION,
        worldId,
        worldFingerprint,
        "CAD",
        START,
        seeds(operator.metadata.operatorId),
      );
      assertEquivalentComparisonBindings(reference, binding);
    }
  });

  it("produces complete reproducible 90-opportunity artifacts for every greedy objective", () => {
    const worldId = "step3.8.artifact-world";
    const worldFingerprint = evaluationFingerprint({ fixture: worldId });

    for (const operator of Object.values(GREEDY_BASELINE_OPERATORS)) {
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
        simulatorVersion: GREEDY_SIMULATOR_VERSION,
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
          decisionScoreIsNotEvaluationScore: true,
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
            "greedy_candidate_evaluation",
        ),
      ).toBe(true);
      const firstAudit = bundle.operatorInvocations[0]!
        .decisionAudit?.payload as any;
      expect(firstAudit.candidateSet.length).toBeGreaterThan(1);
      expect(firstAudit.candidateRanking.length).toBeGreaterThan(0);
      expect(firstAudit.selectedCandidateId).toBeDefined();
    }
  });

  it("freezes the preregistered greedy configurations and fingerprints", () => {
    const configs: readonly GreedyConfiguration[] = [
      GREEDY_IMMEDIATE_REVENUE_CONFIG,
      GREEDY_IMMEDIATE_GROSS_PROFIT_CONFIG,
      GREEDY_IMMEDIATE_CONTRIBUTION_CONFIG,
    ];
    const configFingerprints = Object.fromEntries(
      configs.map((config) => [
        config.objective,
        greedyConfigurationFingerprint(config),
      ]),
    );

    expect(new Set(Object.values(configFingerprints)).size).toBe(3);
    for (const fingerprint of Object.values(configFingerprints)) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }

    console.log(
      "STEP3_8_GREEDY_FREEZE",
      JSON.stringify({
        parentCommit: GREEDY_FROZEN_STEP_3_7_COMMIT,
        operatorVersion: GREEDY_OPERATOR_VERSION,
        implementationFingerprints:
          GREEDY_IMPLEMENTATION_FINGERPRINTS,
        configurationFingerprints: configFingerprints,
        frozenConfigurations: FROZEN_GREEDY_CONFIGURATIONS,
      }),
    );
  });
});
