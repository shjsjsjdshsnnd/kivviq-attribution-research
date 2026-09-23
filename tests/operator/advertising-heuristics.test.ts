import { describe, expect, it } from "vitest";
import { actionId } from "../../src/action_ontology/identity.js";
import type { Action } from "../../src/action_ontology/types.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
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
  ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION,
  ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
  ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
  ADVERTISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
  ADVERTISING_HEURISTIC_METRIC_SET_VERSION,
  ADVERTISING_HEURISTIC_OBSERVATION_KEY,
  ADVERTISING_HEURISTIC_OPERATOR_VERSION,
  EQUAL_BUDGET_ALLOCATION_CONFIG,
  EQUAL_BUDGET_ALLOCATION_OPERATOR,
  FIXED_CHANNEL_ALLOCATION_CONFIG,
  FIXED_CHANNEL_ALLOCATION_OPERATOR,
  HIGHEST_OBSERVED_ROAS_CONFIG,
  HIGHEST_OBSERVED_ROAS_OPERATOR,
  ROAS_THRESHOLD_DECREASE_CONFIG,
  ROAS_THRESHOLD_DECREASE_OPERATOR,
  ROAS_THRESHOLD_INCREASE_CONFIG,
  ROAS_THRESHOLD_INCREASE_OPERATOR,
  advertisingHeuristicConfigurationFingerprint,
  createAdvertisingHeuristicOperator,
  type AdvertisingChannelObservation,
  type AdvertisingHeuristicConfig,
} from "../../src/operator/advertising-heuristics.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { STATUS_QUO_OPERATOR_ID } from "../../src/operator/status-quo.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const START = "2026-10-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function day(sequence: number): string {
  return new Date(Date.parse(START) + sequence * DAY_MS).toISOString();
}

function channel(
  channelId: string,
  currentBudgetMinor: number,
  spendMinor: number | null,
  attributedRevenueMinor: number | null,
  overrides: Partial<AdvertisingChannelObservation> = {},
): AdvertisingChannelObservation {
  return {
    channelId,
    active: true,
    currency: "CAD",
    currentBudgetMinor,
    spendMinor,
    attributedRevenueMinor,
    historyDays: 7,
    ...overrides,
  };
}

function defaultChannels(): readonly AdvertisingChannelObservation[] {
  return [
    channel("google_ads", 600_000, 100_000, 400_000),
    channel("meta_ads", 300_000, 100_000, 200_000),
    channel("pinterest_ads", 100_000, 100_000, 100_000),
  ];
}

function opportunity(sequence = 0) {
  return createFixedIntervalDecisionOpportunity(contract, START, sequence);
}

function observation(
  sequence = 0,
  channels: readonly AdvertisingChannelObservation[] = defaultChannels(),
  lookbackDays = 7,
  extras: readonly {
    readonly observationKey: string;
    readonly value: unknown;
  }[] = [],
) {
  const o = opportunity(sequence);
  return buildOperatorObservationSnapshot(contract, o, [
    {
      observationKey: ADVERTISING_HEURISTIC_OBSERVATION_KEY,
      informationClass: "derived_observable_metric",
      sourceMinOccurredAt: new Date(
        Date.parse(o.at) - lookbackDays * DAY_MS,
      ).toISOString(),
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "platform-report:advertising-channel-metrics",
      value: {
        schemaVersion: "1.0.0",
        attributionSemantics: "operator_observed_attributed_revenue",
        budgetPeriod: "week",
        lookbackDays,
        channels,
      },
    },
    ...extras.map((extra) => ({
      observationKey: extra.observationKey,
      informationClass: "current_state_information" as const,
      sourceMinOccurredAt: o.at,
      sourceMaxOccurredAt: o.at,
      availableAt: o.at,
      sourceRef: "merchant-state:step3.4-adversarial-context",
      value: extra.value,
    })),
  ]);
}

function availability(
  sequence = 0,
  channelIds: readonly string[] = [
    "google_ads",
    "meta_ads",
    "pinterest_ads",
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
    channelIds.length === 0
      ? []
      : [
          {
            actionType: "advertising.adjust_budget",
            eligibleTargets: channelIds.map((channelId) => ({
              kind: "advertising_channel" as const,
              channelId,
            })),
            parameterBounds,
            requiredPreconditionIds,
          },
        ],
  );
}

function decision(
  operator: typeof EQUAL_BUDGET_ALLOCATION_OPERATOR,
  channels: readonly AdvertisingChannelObservation[] = defaultChannels(),
  options: {
    readonly sequence?: number;
    readonly lookbackDays?: number;
    readonly eligibleChannels?: readonly string[];
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
    channels,
    options.lookbackDays ?? 7,
    options.extras ?? [],
  );
  const avail = availability(
    sequence,
    options.eligibleChannels ?? [
      "google_ads",
      "meta_ads",
      "pinterest_ads",
    ],
    options.parameterBounds ?? [],
    options.requiredPreconditionIds ?? [],
  );
  const input = toOperatorDecisionInput(o, obs, avail);
  const output = operator.decide(input);
  const audit = operator.auditDecision?.(input, output);
  return { o, obs, avail, input, output, audit };
}

function targetBudgets(actions: readonly Action[]): Record<string, number> {
  return Object.fromEntries(
    actions.map((action) => {
      expect(action.actionCategory).toBe("advertising");
      expect(String(action.actionType)).toBe("advertising.adjust_budget");
      expect(action.target.kind).toBe("advertising_channel");
      expect(action.parameters.kind).toBe("budget_adjustment");
      if (
        action.target.kind !== "advertising_channel" ||
        action.parameters.kind !== "budget_adjustment" ||
        action.parameters.operation.kind !== "SET"
      ) {
        throw new Error("unexpected advertising budget Action");
      }
      return [
        action.target.channelId,
        action.parameters.operation.value.amountMinor,
      ];
    }),
  );
}

function sharedSeeds(operatorId: string): readonly EvaluationSeedValue[] {
  return [
    { namespace: "world_generation", value: 3001 },
    { namespace: "customer_generation", value: 3002 },
    { namespace: "customer_behavior", value: 3003 },
    { namespace: "demand", value: 3004 },
    { namespace: "advertising_response", value: 3005 },
    { namespace: "journey_transitions", value: 3006 },
    { namespace: "external_events", value: 3007 },
    {
      namespace: "operator_internal",
      value: 0,
      operatorId,
    },
  ];
}

describe("Step 3.4 simple advertising heuristic baselines", () => {
  it("freezes five independent canonical operator identities and configurations", () => {
    expect(Object.keys(ADVERTISING_HEURISTIC_BASELINE_OPERATORS)).toEqual([
      "EQUAL_BUDGET_ALLOCATION",
      "ROAS_THRESHOLD_INCREASE",
      "ROAS_THRESHOLD_DECREASE",
      "HIGHEST_OBSERVED_ROAS",
      "FIXED_CHANNEL_ALLOCATION",
    ]);

    const operators = Object.values(
      ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
    );
    expect(new Set(operators.map((operator) => operator.metadata.operatorId)).size).toBe(
      5,
    );
    expect(
      new Set(
        operators.map(
          (operator) => operator.metadata.implementationFingerprint,
        ),
      ).size,
    ).toBe(5);

    for (const operator of operators) {
      expect(operator.metadata.operatorVersion).toBe(
        ADVERTISING_HEURISTIC_OPERATOR_VERSION,
      );
      expect(operator.metadata.supportedEvaluationContract.contractFingerprint).toBe(
        contract.contractFingerprint,
      );
      expect(operator.metadata.supportedActionOntologyVersion).toBe(
        contract.actionSpace.ontologySchemaVersion,
      );
      const configuration =
        operator.metadata.deterministicConfiguration as any;
      expect(configuration.configurationFingerprint).toMatch(
        /^fnv1a64:[0-9a-f]{16}$/,
      );
      expect(configuration.metricSetVersion).toBe(
        ADVERTISING_HEURISTIC_METRIC_SET_VERSION,
      );
      expect(configuration.advertisingEconomicsVersion).toBe(
        ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION,
      );
      expect(configuration.frozenParentCommit).toBe(
        ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
      );
    }
  });

  it("keeps all emitted interventions inside the canonical advertising Action domain", () => {
    for (const operator of Object.values(
      ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const { output } = decision(operator as any);
      for (const action of output.actions) {
        expect(assertValidAction(action)).toEqual(action);
        expect(action.actionCategory).toBe("advertising");
        expect(String(action.actionType)).toBe(
          "advertising.adjust_budget",
        );
      }
    }
  });

  describe("EQUAL_BUDGET_ALLOCATION", () => {
    it("equalizes two channels without using performance", () => {
      const channels = [
        channel("google_ads", 700_000, 1, 1000),
        channel("meta_ads", 300_000, 1_000_000, 0),
      ];
      const { output } = decision(
        EQUAL_BUDGET_ALLOCATION_OPERATOR,
        channels,
        { eligibleChannels: ["google_ads", "meta_ads"] },
      );
      expect(targetBudgets(output.actions)).toEqual({
        google_ads: 500_000,
        meta_ads: 500_000,
      });
    });

    it("equalizes three unequal starting budgets while conserving total spend", () => {
      const { output } = decision(EQUAL_BUDGET_ALLOCATION_OPERATOR);
      const budgets = targetBudgets(output.actions);
      expect(budgets).toEqual({
        google_ads: 333_334,
        meta_ads: 333_333,
        pinterest_ads: 333_333,
      });
      expect(Object.values(budgets).reduce((a, b) => a + b, 0)).toBe(
        1_000_000,
      );
    });

    it("handles indivisible minor units deterministically by stable channel order", () => {
      const channels = [
        channel("google_ads", 1, 10, 10),
        channel("meta_ads", 1, 10, 10),
        channel("pinterest_ads", 2, 10, 10),
      ];
      const { output } = decision(
        EQUAL_BUDGET_ALLOCATION_OPERATOR,
        channels,
      );
      expect(targetBudgets(output.actions)).toEqual({
        google_ads: 2,
        pinterest_ads: 1,
      });
    });

    it("ignores unavailable channels and reallocates only the eligible pool", () => {
      const { output } = decision(
        EQUAL_BUDGET_ALLOCATION_OPERATOR,
        defaultChannels(),
        { eligibleChannels: ["google_ads", "meta_ads"] },
      );
      expect(targetBudgets(output.actions)).toEqual({
        google_ads: 450_000,
        meta_ads: 450_000,
      });
    });

    it("falls back to no action when equal targets violate a frozen maximum", () => {
      const operator = createAdvertisingHeuristicOperator({
        ...EQUAL_BUDGET_ALLOCATION_CONFIG,
        maximumChannelBudgetMinor: 300_000,
      });
      const { output, audit } = decision(operator as any);
      expect(output.actions).toEqual([]);
      expect((audit?.payload as any).fallbackReason).toBe(
        "EQUAL_ALLOCATION_OUTSIDE_FROZEN_BOUNDS",
      );
    });

    it("does not silently repair a target that violates legal Action bounds", () => {
      const { output, audit } = decision(
        EQUAL_BUDGET_ALLOCATION_OPERATOR,
        defaultChannels(),
        {
          parameterBounds: [
            {
              path: "parameters.operation.value.amountMinor",
              maxInclusive: 300_000,
            },
          ],
        },
      );
      expect(output.actions).toEqual([]);
      expect((audit?.payload as any).fallbackReason).toBe(
        "TARGET_BUDGET_OUTSIDE_LEGAL_BOUNDS",
      );
    });
  });

  describe("ROAS_THRESHOLD_INCREASE", () => {
    it.each([
      [2.9, 0],
      [3.0, 0],
      [3.1, 1],
    ])("uses strict threshold semantics at ROAS %s", (roasValue, actionCount) => {
      const channels = [
        channel(
          "google_ads",
          500_000,
          100_000,
          Math.round(roasValue * 100_000),
        ),
      ];
      const { output } = decision(
        ROAS_THRESHOLD_INCREASE_OPERATOR,
        channels,
        { eligibleChannels: ["google_ads"] },
      );
      expect(output.actions).toHaveLength(actionCount);
      if (actionCount === 1) {
        expect(targetBudgets(output.actions)).toEqual({
          google_ads: 550_000,
        });
      }
    });

    it("makes no change when ROAS is missing", () => {
      const channels = [
        channel("google_ads", 500_000, null, null),
      ];
      expect(
        decision(ROAS_THRESHOLD_INCREASE_OPERATOR, channels, {
          eligibleChannels: ["google_ads"],
        }).output.actions,
      ).toEqual([]);
    });

    it("makes no change with insufficient history or mismatched lookback", () => {
      const channels = [
        channel("google_ads", 500_000, 100_000, 500_000, {
          historyDays: 3,
        }),
      ];
      expect(
        decision(ROAS_THRESHOLD_INCREASE_OPERATOR, channels, {
          eligibleChannels: ["google_ads"],
        }).output.actions,
      ).toEqual([]);
      expect(
        decision(ROAS_THRESHOLD_INCREASE_OPERATOR, defaultChannels(), {
          lookbackDays: 14,
        }).output.actions,
      ).toEqual([]);
    });

    it("respects the frozen maximum channel budget", () => {
      const channels = [
        channel("google_ads", 1_500_000, 100_000, 500_000),
      ];
      expect(
        decision(ROAS_THRESHOLD_INCREASE_OPERATOR, channels, {
          eligibleChannels: ["google_ads"],
        }).output.actions,
      ).toEqual([]);
    });
  });

  describe("ROAS_THRESHOLD_DECREASE", () => {
    it.each([
      [1.4, 1],
      [1.5, 0],
      [1.6, 0],
    ])("uses strict threshold semantics at ROAS %s", (roasValue, actionCount) => {
      const channels = [
        channel(
          "google_ads",
          500_000,
          100_000,
          Math.round(roasValue * 100_000),
        ),
      ];
      const { output } = decision(
        ROAS_THRESHOLD_DECREASE_OPERATOR,
        channels,
        { eligibleChannels: ["google_ads"] },
      );
      expect(output.actions).toHaveLength(actionCount);
      if (actionCount === 1) {
        expect(targetBudgets(output.actions)).toEqual({
          google_ads: 450_000,
        });
      }
    });

    it("makes no change for missing ROAS or zero spend", () => {
      expect(
        decision(
          ROAS_THRESHOLD_DECREASE_OPERATOR,
          [channel("google_ads", 500_000, null, null)],
          { eligibleChannels: ["google_ads"] },
        ).output.actions,
      ).toEqual([]);
      expect(
        decision(
          ROAS_THRESHOLD_DECREASE_OPERATOR,
          [channel("google_ads", 500_000, 0, 0)],
          { eligibleChannels: ["google_ads"] },
        ).output.actions,
      ).toEqual([]);
    });

    it("respects the frozen minimum channel budget", () => {
      const channels = [
        channel("google_ads", 100_000, 100_000, 0),
      ];
      expect(
        decision(ROAS_THRESHOLD_DECREASE_OPERATOR, channels, {
          eligibleChannels: ["google_ads"],
        }).output.actions,
      ).toEqual([]);
    });
  });

  describe("HIGHEST_OBSERVED_ROAS", () => {
    it("reallocates a fixed increment from lowest observed ROAS to clear winner", () => {
      const { output, audit } = decision(
        HIGHEST_OBSERVED_ROAS_OPERATOR,
      );
      expect(targetBudgets(output.actions)).toEqual({
        google_ads: 700_000,
        pinterest_ads: 0,
      });
      expect((audit?.payload as any).selectedChannel).toBe(
        "google_ads",
      );
      expect((audit?.payload as any).fundingChannel).toBe(
        "pinterest_ads",
      );
    });

    it("breaks winner ties by frozen stable channel order", () => {
      const channels = [
        channel("google_ads", 400_000, 100_000, 400_000),
        channel("meta_ads", 400_000, 100_000, 400_000),
        channel("pinterest_ads", 200_000, 100_000, 100_000),
      ];
      const { audit } = decision(
        HIGHEST_OBSERVED_ROAS_OPERATOR,
        channels,
      );
      expect((audit?.payload as any).selectedChannel).toBe(
        "google_ads",
      );
      expect((audit?.payload as any).tieBreakResult).toBe(
        "WINNER_TIE_RESOLVED_BY_STABLE_CHANNEL_ORDER:google_ads",
      );
    });

    it("ignores missing and zero-spend ROAS channels", () => {
      const channels = [
        channel("google_ads", 500_000, null, null),
        channel("meta_ads", 300_000, 0, 0),
        channel("pinterest_ads", 200_000, 100_000, 200_000),
      ];
      expect(
        decision(HIGHEST_OBSERVED_ROAS_OPERATOR, channels).output
          .actions,
      ).toEqual([]);
    });

    it("makes no change when the winner is already at maximum budget", () => {
      const channels = [
        channel("google_ads", 1_500_000, 100_000, 500_000),
        channel("meta_ads", 500_000, 100_000, 100_000),
      ];
      const { output, audit } = decision(
        HIGHEST_OBSERVED_ROAS_OPERATOR,
        channels,
        { eligibleChannels: ["google_ads", "meta_ads"] },
      );
      expect(output.actions).toEqual([]);
      expect((audit?.payload as any).fallbackReason).toBe(
        "REALLOCATION_NOT_FEASIBLE_AT_FROZEN_INCREMENT",
      );
    });

    it("conserves total budget exactly", () => {
      const { output } = decision(HIGHEST_OBSERVED_ROAS_OPERATOR);
      const budgets = targetBudgets(output.actions);
      const before = 600_000 + 100_000;
      expect(budgets["google_ads"]! + budgets["pinterest_ads"]!).toBe(before);
    });
  });

  describe("FIXED_CHANNEL_ALLOCATION", () => {
    it("emits no Actions when the configured allocation is already correct", () => {
      const channels = [
        channel("google_ads", 500_000, 100_000, 100_000),
        channel("meta_ads", 350_000, 100_000, 100_000),
        channel("pinterest_ads", 150_000, 100_000, 100_000),
      ];
      expect(
        decision(FIXED_CHANNEL_ALLOCATION_OPERATOR, channels).output
          .actions,
      ).toEqual([]);
    });

    it("corrects allocation drift to the frozen 50/35/15 shares", () => {
      expect(
        targetBudgets(
          decision(FIXED_CHANNEL_ALLOCATION_OPERATOR).output.actions,
        ),
      ).toEqual({
        google_ads: 500_000,
        meta_ads: 350_000,
        pinterest_ads: 150_000,
      });
    });

    it("preserves frozen proportions when total advertising budget changes", () => {
      const channels = [
        channel("google_ads", 600_000, 100_000, 100_000),
        channel("meta_ads", 600_000, 100_000, 100_000),
        channel("pinterest_ads", 800_000, 100_000, 100_000),
      ];
      expect(
        targetBudgets(
          decision(FIXED_CHANNEL_ALLOCATION_OPERATOR, channels).output
            .actions,
        ),
      ).toEqual({
        google_ads: 1_000_000,
        meta_ads: 700_000,
        pinterest_ads: 300_000,
      });
    });

    it("falls back to no action when a configured channel is unavailable", () => {
      const { output, audit } = decision(
        FIXED_CHANNEL_ALLOCATION_OPERATOR,
        defaultChannels(),
        { eligibleChannels: ["google_ads", "meta_ads"] },
      );
      expect(output.actions).toEqual([]);
      expect((audit?.payload as any).fallbackReason).toBe(
        "CONFIGURED_CHANNEL_UNAVAILABLE",
      );
    });

    it("uses deterministic largest-remainder rounding", () => {
      const operator = createAdvertisingHeuristicOperator({
        ...FIXED_CHANNEL_ALLOCATION_CONFIG,
        channelSharesBasisPoints: {
          google_ads: 3334,
          meta_ads: 3333,
          pinterest_ads: 3333,
        },
      });
      const channels = [
        channel("google_ads", 1, 10, 10),
        channel("meta_ads", 1, 10, 10),
        channel("pinterest_ads", 2, 10, 10),
      ];
      expect(
        targetBudgets(decision(operator as any, channels).output.actions),
      ).toEqual({
        google_ads: 2,
        pinterest_ads: 1,
      });
    });

    it("does not silently repair constrained fixed allocations", () => {
      const { output, audit } = decision(
        FIXED_CHANNEL_ALLOCATION_OPERATOR,
        defaultChannels(),
        {
          parameterBounds: [
            {
              path: "parameters.operation.value.amountMinor",
              maxInclusive: 400_000,
            },
          ],
        },
      );
      expect(output.actions).toEqual([]);
      expect((audit?.payload as any).fallbackReason).toBe(
        "TARGET_BUDGET_OUTSIDE_LEGAL_BOUNDS",
      );
    });
  });

  it("treats inactive/new channels and missing evidence deterministically", () => {
    const channels = [
      channel("google_ads", 500_000, 100_000, 500_000, {
        active: false,
      }),
      channel("meta_ads", 300_000, 100_000, 500_000, {
        historyDays: 1,
      }),
      channel("pinterest_ads", 200_000, null, null),
    ];
    expect(
      decision(ROAS_THRESHOLD_INCREASE_OPERATOR, channels).output
        .actions,
    ).toEqual([]);
  });

  it("passes accepted and rejected proposals through the normal constraint path", () => {
    const channels = [
      channel("google_ads", 500_000, 100_000, 500_000),
    ];
    const sequence = 0;
    const o = opportunity(sequence);
    const obs = observation(sequence, channels);
    const avail = availability(sequence, ["google_ads"]);

    const accepted = invokeOperatorAtDecision(
      contract,
      ROAS_THRESHOLD_INCREASE_OPERATOR,
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
      ROAS_THRESHOLD_INCREASE_OPERATOR,
      o,
      obs,
      avail,
      () => ({
        issues: [
          {
            kind: "INFEASIBLE" as const,
            constraintRef: "merchant_cash_limit",
            reason: "Synthetic constraint rejection.",
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
  });

  it("records explicit modifications rather than silently repairing proposals", () => {
    const channels = [
      channel("google_ads", 500_000, 100_000, 500_000),
    ];
    const o = opportunity(0);
    const obs = observation(0, channels);
    const avail = availability(0, ["google_ads"]);

    const modified = invokeOperatorAtDecision(
      contract,
      ROAS_THRESHOLD_INCREASE_OPERATOR,
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
                  action.parameters.operation.value.amountMinor - 10_000,
              },
            },
          },
        });
        return {
          issues: [
            {
              kind: "PARTIALLY_FEASIBLE" as const,
              constraintRef: "merchant_cash_limit",
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

  it("does not become smarter in adversarial worlds", () => {
    const ordinary = decision(
      HIGHEST_OBSERVED_ROAS_OPERATOR,
      defaultChannels(),
    );
    const adversarial = decision(
      HIGHEST_OBSERVED_ROAS_OPERATOR,
      defaultChannels(),
      {
        extras: [
          {
            observationKey: "advertising.adversarial_context",
            value: {
              winnerMostlyNonIncremental: true,
              cannibalizesOrganicDemand: true,
              lowCustomerQuality: true,
              lowRoasChannelStrongRepeatPurchase: true,
              delayedConversionsDistortRoas: true,
              winnerInventoryConstrained: true,
              attributionFavorsWinner: true,
            },
          },
        ],
      },
    );
    expect(adversarial.output).toEqual(ordinary.output);
  });

  it("preserves paired-comparison bindings with DO_NOTHING and STATUS_QUO", () => {
    const simulatorVersion = "customer-journey-simulator-4.0.0";
    const worldId = "step3.4.synthetic-world";
    const worldFingerprint = evaluationFingerprint({
      fixture: "step3.4.synthetic-world",
    });

    const baseline = createEvaluationComparisonBinding(
      contract,
      simulatorVersion,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      sharedSeeds(DO_NOTHING_OPERATOR.metadata.operatorId),
    );
    const statusQuo = createEvaluationComparisonBinding(
      contract,
      simulatorVersion,
      worldId,
      worldFingerprint,
      "CAD",
      START,
      sharedSeeds(STATUS_QUO_OPERATOR_ID),
    );
    assertEquivalentComparisonBindings(baseline, statusQuo);

    for (const operator of Object.values(
      ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
    )) {
      const binding = createEvaluationComparisonBinding(
        contract,
        simulatorVersion,
        worldId,
        worldFingerprint,
        "CAD",
        START,
        sharedSeeds(operator.metadata.operatorId),
      );
      assertEquivalentComparisonBindings(baseline, binding);
    }
  });

  it("produces complete reproducible evaluation artifacts for all five heuristics", () => {
    const simulatorVersion = "customer-journey-simulator-4.0.0";
    const worldId = "step3.4.artifact-world";
    const worldFingerprint = evaluationFingerprint({
      fixture: worldId,
    });

    for (const operator of Object.values(
      ADVERTISING_HEURISTIC_BASELINE_OPERATORS,
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
        simulatorVersion,
        worldId,
        worldFingerprint,
        worldCurrency: "CAD",
        seeds: sharedSeeds(operator.metadata.operatorId),
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
      expect(artifact.contractFingerprint).toBe(
        contract.contractFingerprint,
      );
      expect(artifact.metricSetVersion).toBe("1.0.0");
      expect(artifact.decisionRecords).toHaveLength(90);
      expect(
        bundle.operatorInvocations.every(
          (invocation) =>
            invocation.decisionAudit?.auditType ===
            "advertising_heuristic_evaluation",
        ),
      ).toBe(true);
      expect(bundle.operatorMetadata?.deterministicConfiguration).toBeDefined();
    }
  });

  it("freezes the preregistered benchmark configuration fingerprints", () => {
    const configs: readonly AdvertisingHeuristicConfig[] = [
      EQUAL_BUDGET_ALLOCATION_CONFIG,
      ROAS_THRESHOLD_INCREASE_CONFIG,
      ROAS_THRESHOLD_DECREASE_CONFIG,
      HIGHEST_OBSERVED_ROAS_CONFIG,
      FIXED_CHANNEL_ALLOCATION_CONFIG,
    ];
    const frozen = Object.fromEntries(
      configs.map((config) => [
        config.heuristicType,
        advertisingHeuristicConfigurationFingerprint(config),
      ]),
    );
    expect(new Set(Object.values(frozen)).size).toBe(5);
    for (const fingerprint of Object.values(frozen)) {
      expect(fingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    }
    console.log(
      "STEP3_4_ADVERTISING_HEURISTIC_FREEZE",
      JSON.stringify({
        parentCommit: ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
        operatorVersion: ADVERTISING_HEURISTIC_OPERATOR_VERSION,
        implementationFingerprints:
          ADVERTISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS,
        configurationFingerprints: frozen,
        frozenConfigurations: Object.fromEntries(
          configs.map((config) => [
            config.heuristicType,
            config,
          ]),
        ),
      }),
    );
  });
});
