import { actionId, actionType } from "../action_ontology/identity.js";
import { setGoogleShoppingBudgetAbsolute } from "../action_ontology/fixtures.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionTarget,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { currencyCode, utcTimestamp } from "../core/units.js";
import {
  deepFreezeOperator,
  operatorFingerprint,
  stableOperatorJson,
} from "./identity.js";
import {
  OPERATOR_INTERFACE_VERSION,
  type CanonicalOperator,
  type CanonicalOperatorMetadata,
  type OperatorDecisionAudit,
  type OperatorDecisionInput,
  type OperatorDecisionOutput,
  type OperatorJson,
  type OperatorLegalActionRule,
} from "./types.js";

export const ADVERTISING_HEURISTIC_SUITE_VERSION = "1.0.0" as const;
export const ADVERTISING_HEURISTIC_OPERATOR_VERSION = "1.0.0" as const;
export const ADVERTISING_HEURISTIC_CONFIGURATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const ADVERTISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const ADVERTISING_HEURISTIC_OBSERVATION_KEY =
  "advertising.channel_metrics.v1" as const;

export const ADVERTISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT =
  "a2ab0b96451894a3cd5e8c62186b5c9faeaea289" as const;
export const ADVERTISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;
export const ADVERTISING_HEURISTIC_METRIC_SET_VERSION = "1.0.0" as const;
export const ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION =
  "advertising-economics-5.0.0" as const;

export type AdvertisingHeuristicType =
  | "EQUAL_BUDGET_ALLOCATION"
  | "ROAS_THRESHOLD_INCREASE"
  | "ROAS_THRESHOLD_DECREASE"
  | "HIGHEST_OBSERVED_ROAS"
  | "FIXED_CHANNEL_ALLOCATION";

export type AdvertisingBudgetSemantics =
  | "REALLOCATE_CURRENT_TOTAL"
  | "INCREASE_TOTAL_SPEND"
  | "DECREASE_TOTAL_SPEND"
  | "MAINTAIN_CURRENT_TOTAL";

export interface AdvertisingChannelObservation {
  readonly channelId: string;
  readonly active: boolean;
  readonly currency: string;
  readonly currentBudgetMinor: number;
  readonly spendMinor: number | null;
  readonly attributedRevenueMinor: number | null;
  readonly historyDays: number;
}

export interface AdvertisingObservationPayload {
  readonly schemaVersion: typeof ADVERTISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION;
  readonly attributionSemantics: "operator_observed_attributed_revenue";
  readonly budgetPeriod: "week";
  readonly lookbackDays: number;
  readonly channels: readonly AdvertisingChannelObservation[];
}

interface AdvertisingHeuristicConfigBase {
  readonly configurationSchemaVersion:
    typeof ADVERTISING_HEURISTIC_CONFIGURATION_SCHEMA_VERSION;
  readonly heuristicType: AdvertisingHeuristicType;
  readonly currency: "CAD";
  readonly budgetPeriod: "week";
  readonly observationKey: typeof ADVERTISING_HEURISTIC_OBSERVATION_KEY;
  readonly attributionSemantics: "operator_observed_attributed_revenue";
  readonly channelOrder: readonly string[];
  readonly missingDataBehavior: "NO_DISCRETIONARY_CHANGE";
  readonly infeasibleActionBehavior: "NO_DISCRETIONARY_CHANGE";
  readonly roundingRule: "LARGEST_REMAINDER_THEN_STABLE_CHANNEL_ORDER";
  readonly budgetSemantics: AdvertisingBudgetSemantics;
}

export interface EqualBudgetAllocationConfig
  extends AdvertisingHeuristicConfigBase {
  readonly heuristicType: "EQUAL_BUDGET_ALLOCATION";
  readonly minimumChannelBudgetMinor: number;
  readonly maximumChannelBudgetMinor: number;
}

export interface RoasThresholdIncreaseConfig
  extends AdvertisingHeuristicConfigBase {
  readonly heuristicType: "ROAS_THRESHOLD_INCREASE";
  readonly roasThreshold: number;
  readonly lookbackDays: number;
  readonly minimumHistoryDays: number;
  readonly increaseBasisPoints: number;
  readonly maximumIncreaseMinor: number;
  readonly maximumChannelBudgetMinor: number;
}

export interface RoasThresholdDecreaseConfig
  extends AdvertisingHeuristicConfigBase {
  readonly heuristicType: "ROAS_THRESHOLD_DECREASE";
  readonly roasThreshold: number;
  readonly lookbackDays: number;
  readonly minimumHistoryDays: number;
  readonly decreaseBasisPoints: number;
  readonly maximumDecreaseMinor: number;
  readonly minimumChannelBudgetMinor: number;
}

export interface HighestObservedRoasConfig
  extends AdvertisingHeuristicConfigBase {
  readonly heuristicType: "HIGHEST_OBSERVED_ROAS";
  readonly lookbackDays: number;
  readonly minimumHistoryDays: number;
  readonly incrementalBudgetMinor: number;
  readonly minimumChannelBudgetMinor: number;
  readonly maximumChannelBudgetMinor: number;
  readonly fundingRule: "LOWEST_OBSERVED_ROAS_ELIGIBLE_CHANNEL";
  readonly tieBreakRule: "STABLE_CHANNEL_ORDER";
}

export interface FixedChannelAllocationConfig
  extends AdvertisingHeuristicConfigBase {
  readonly heuristicType: "FIXED_CHANNEL_ALLOCATION";
  readonly channelSharesBasisPoints: Readonly<Record<string, number>>;
  readonly unavailableConfiguredChannelBehavior: "NO_DISCRETIONARY_CHANGE";
  readonly minimumChannelBudgetMinor: number;
  readonly maximumChannelBudgetMinor: number;
}

export type AdvertisingHeuristicConfig =
  | EqualBudgetAllocationConfig
  | RoasThresholdIncreaseConfig
  | RoasThresholdDecreaseConfig
  | HighestObservedRoasConfig
  | FixedChannelAllocationConfig;

const COMMON_CONFIGURATION = {
  configurationSchemaVersion:
    ADVERTISING_HEURISTIC_CONFIGURATION_SCHEMA_VERSION,
  currency: "CAD",
  budgetPeriod: "week",
  observationKey: ADVERTISING_HEURISTIC_OBSERVATION_KEY,
  attributionSemantics: "operator_observed_attributed_revenue",
  channelOrder: ["google_ads", "meta_ads", "pinterest_ads"],
  missingDataBehavior: "NO_DISCRETIONARY_CHANGE",
  infeasibleActionBehavior: "NO_DISCRETIONARY_CHANGE",
  roundingRule: "LARGEST_REMAINDER_THEN_STABLE_CHANNEL_ORDER",
} as const;

export const EQUAL_BUDGET_ALLOCATION_CONFIG: EqualBudgetAllocationConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "EQUAL_BUDGET_ALLOCATION",
    budgetSemantics: "REALLOCATE_CURRENT_TOTAL",
    minimumChannelBudgetMinor: 0,
    maximumChannelBudgetMinor: 2_000_000,
  });

export const ROAS_THRESHOLD_INCREASE_CONFIG: RoasThresholdIncreaseConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "ROAS_THRESHOLD_INCREASE",
    budgetSemantics: "INCREASE_TOTAL_SPEND",
    roasThreshold: 3,
    lookbackDays: 7,
    minimumHistoryDays: 7,
    increaseBasisPoints: 1000,
    maximumIncreaseMinor: 100_000,
    maximumChannelBudgetMinor: 1_500_000,
  });

export const ROAS_THRESHOLD_DECREASE_CONFIG: RoasThresholdDecreaseConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "ROAS_THRESHOLD_DECREASE",
    budgetSemantics: "DECREASE_TOTAL_SPEND",
    roasThreshold: 1.5,
    lookbackDays: 7,
    minimumHistoryDays: 7,
    decreaseBasisPoints: 1000,
    maximumDecreaseMinor: 100_000,
    minimumChannelBudgetMinor: 100_000,
  });

export const HIGHEST_OBSERVED_ROAS_CONFIG: HighestObservedRoasConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "HIGHEST_OBSERVED_ROAS",
    budgetSemantics: "REALLOCATE_CURRENT_TOTAL",
    lookbackDays: 7,
    minimumHistoryDays: 7,
    incrementalBudgetMinor: 100_000,
    minimumChannelBudgetMinor: 100_000,
    maximumChannelBudgetMinor: 1_500_000,
    fundingRule: "LOWEST_OBSERVED_ROAS_ELIGIBLE_CHANNEL",
    tieBreakRule: "STABLE_CHANNEL_ORDER",
  });

export const FIXED_CHANNEL_ALLOCATION_CONFIG: FixedChannelAllocationConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "FIXED_CHANNEL_ALLOCATION",
    budgetSemantics: "MAINTAIN_CURRENT_TOTAL",
    channelSharesBasisPoints: {
      google_ads: 5000,
      meta_ads: 3500,
      pinterest_ads: 1500,
    },
    unavailableConfiguredChannelBehavior: "NO_DISCRETIONARY_CHANGE",
    minimumChannelBudgetMinor: 0,
    maximumChannelBudgetMinor: 2_000_000,
  });

export const FROZEN_ADVERTISING_HEURISTIC_CONFIGURATIONS =
  deepFreezeOperator({
    EQUAL_BUDGET_ALLOCATION: EQUAL_BUDGET_ALLOCATION_CONFIG,
    ROAS_THRESHOLD_INCREASE: ROAS_THRESHOLD_INCREASE_CONFIG,
    ROAS_THRESHOLD_DECREASE: ROAS_THRESHOLD_DECREASE_CONFIG,
    HIGHEST_OBSERVED_ROAS: HIGHEST_OBSERVED_ROAS_CONFIG,
    FIXED_CHANNEL_ALLOCATION: FIXED_CHANNEL_ALLOCATION_CONFIG,
  });

const OPERATOR_IDS: Readonly<Record<AdvertisingHeuristicType, string>> =
  deepFreezeOperator({
    EQUAL_BUDGET_ALLOCATION:
      "baseline.advertising.equal_budget_allocation",
    ROAS_THRESHOLD_INCREASE:
      "baseline.advertising.roas_threshold_increase",
    ROAS_THRESHOLD_DECREASE:
      "baseline.advertising.roas_threshold_decrease",
    HIGHEST_OBSERVED_ROAS:
      "baseline.advertising.highest_observed_roas",
    FIXED_CHANNEL_ALLOCATION:
      "baseline.advertising.fixed_channel_allocation",
  });

const DESCRIPTIONS: Readonly<Record<AdvertisingHeuristicType, string>> =
  deepFreezeOperator({
    EQUAL_BUDGET_ALLOCATION:
      "Simple baseline that splits the currently allocatable advertising budget equally across eligible channels without using performance.",
    ROAS_THRESHOLD_INCREASE:
      "Simple baseline that increases an eligible channel budget when observable ROAS is strictly above a frozen threshold.",
    ROAS_THRESHOLD_DECREASE:
      "Simple baseline that decreases an eligible channel budget when observable ROAS is strictly below a frozen threshold.",
    HIGHEST_OBSERVED_ROAS:
      "Simple greedy baseline that reallocates a fixed budget increment from the lowest observable-ROAS eligible channel to the highest observable-ROAS eligible channel.",
    FIXED_CHANNEL_ALLOCATION:
      "Simple baseline that maintains frozen channel-share weights against the current total advertising budget.",
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function finiteNonNegativeNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function canonicalChannelRank(
  channelId: string,
  order: readonly string[],
): readonly [number, string] {
  const index = order.indexOf(channelId);
  return [index === -1 ? Number.MAX_SAFE_INTEGER : index, channelId];
}

function stableChannelSort(
  channelIds: readonly string[],
  order: readonly string[],
): string[] {
  return [...channelIds].sort((left, right) => {
    const [leftRank, leftName] = canonicalChannelRank(left, order);
    const [rightRank, rightName] = canonicalChannelRank(right, order);
    return leftRank - rightRank || leftName.localeCompare(rightName);
  });
}

function parseObservation(
  input: Readonly<OperatorDecisionInput>,
  config: AdvertisingHeuristicConfig,
):
  | {
      readonly ok: true;
      readonly payload: AdvertisingObservationPayload;
      readonly byChannel: ReadonlyMap<string, AdvertisingChannelObservation>;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    } {
  const record = input.observation.records.find(
    (entry) => entry.observationKey === config.observationKey,
  );
  if (record === undefined) {
    return { ok: false, reason: "OBSERVATION_MISSING" };
  }
  const value = record.value;
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== ADVERTISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION ||
    value["attributionSemantics"] !== config.attributionSemantics ||
    value["budgetPeriod"] !== config.budgetPeriod ||
    !finiteNonNegativeInteger(value["lookbackDays"]) ||
    !Array.isArray(value["channels"])
  ) {
    return { ok: false, reason: "OBSERVATION_SCHEMA_INVALID" };
  }

  const channels: AdvertisingChannelObservation[] = [];
  const seen = new Set<string>();
  for (const raw of value["channels"]) {
    if (
      !isRecord(raw) ||
      typeof raw["channelId"] !== "string" ||
      raw["channelId"].trim().length === 0 ||
      typeof raw["active"] !== "boolean" ||
      raw["currency"] !== config.currency ||
      !finiteNonNegativeInteger(raw["currentBudgetMinor"]) ||
      !(raw["spendMinor"] === null || finiteNonNegativeInteger(raw["spendMinor"])) ||
      !(
        raw["attributedRevenueMinor"] === null ||
        finiteNonNegativeInteger(raw["attributedRevenueMinor"])
      ) ||
      !finiteNonNegativeNumber(raw["historyDays"])
    ) {
      return { ok: false, reason: "CHANNEL_OBSERVATION_INVALID" };
    }
    if (seen.has(raw["channelId"])) {
      return { ok: false, reason: "DUPLICATE_CHANNEL_OBSERVATION" };
    }
    seen.add(raw["channelId"]);
    channels.push({
      channelId: raw["channelId"],
      active: raw["active"],
      currency: raw["currency"],
      currentBudgetMinor: raw["currentBudgetMinor"],
      spendMinor: raw["spendMinor"],
      attributedRevenueMinor: raw["attributedRevenueMinor"],
      historyDays: raw["historyDays"],
    });
  }

  const payload: AdvertisingObservationPayload = {
    schemaVersion: ADVERTISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
    attributionSemantics: config.attributionSemantics,
    budgetPeriod: config.budgetPeriod,
    lookbackDays: value["lookbackDays"],
    channels,
  };

  return {
    ok: true,
    payload,
    byChannel: new Map(channels.map((channel) => [channel.channelId, channel])),
  };
}

function budgetRule(
  input: Readonly<OperatorDecisionInput>,
): OperatorLegalActionRule | undefined {
  return input.legalActionSpace.rules.find(
    (rule) => rule.actionType === "advertising.adjust_budget",
  );
}

function eligibleChannelIds(
  input: Readonly<OperatorDecisionInput>,
  observation: ReadonlyMap<string, AdvertisingChannelObservation>,
  config: AdvertisingHeuristicConfig,
): string[] {
  const rule = budgetRule(input);
  if (rule === undefined || rule.requiredPreconditionIds.length > 0) {
    return [];
  }
  const legal = rule.eligibleTargets
    .filter(
      (
        target,
      ): target is Extract<ActionTarget, { readonly kind: "advertising_channel" }> =>
        target.kind === "advertising_channel",
    )
    .map((target) => target.channelId)
    .filter((channelId) => observation.get(channelId)?.active === true);
  return stableChannelSort([...new Set(legal)], config.channelOrder);
}

function numericAtPath(input: unknown, path: string): number | undefined {
  let current: unknown = input;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return typeof current === "number" && Number.isFinite(current)
    ? current
    : undefined;
}

function actionWithinAvailabilityBounds(
  action: Action,
  rule: OperatorLegalActionRule,
): boolean {
  for (const bound of rule.parameterBounds) {
    const value = numericAtPath(action, bound.path);
    if (value === undefined) return false;
    if (
      (bound.minInclusive !== undefined && value < bound.minInclusive) ||
      (bound.maxInclusive !== undefined && value > bound.maxInclusive)
    ) {
      return false;
    }
  }
  return true;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function budgetAction(
  heuristicType: AdvertisingHeuristicType,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  channelId: string,
  targetBudgetMinor: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<ActionTarget, { readonly kind: "advertising_channel" }> =
    {
      kind: "advertising_channel",
      channelId,
    };

  return assertValidAction({
    ...setGoogleShoppingBudgetAbsolute,
    actionId: actionId(
      "action_" +
        heuristicType.toLowerCase() +
        "_" +
        sanitizeId(channelId) +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("advertising.adjust_budget"),
    actionCategory: "advertising",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      heuristicType +
      " set " +
      channelId +
      " weekly budget to " +
      targetBudgetMinor +
      " minor units.",
    target,
    scope: {
      dimensions: [
        {
          kind: "channel_subset",
          channelIds: [channelId],
        },
      ],
    },
    parameters: {
      kind: "budget_adjustment",
      operation: {
        kind: "SET",
        value: {
          kind: "money_rate",
          amountMinor: targetBudgetMinor,
          currency: currencyCode("CAD"),
          per: "week",
        },
      },
    },
    timing: {
      decisionTime,
      requestedStart: { kind: "known", at: decisionTime },
      effectiveStart: { kind: "known", at: decisionTime },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    },
    duration: { kind: "persistent" },
    termination: { kind: "persistent" },
    preconditions: [],
    reversibility: {
      classification: "immediately_reversible",
      reversal: {
        kind: "restore_previous_value",
        target,
        parameterKind: "budget_adjustment",
      },
      minimumDelaySeconds: 0,
    },
    intent: {
      statement:
        "Execute the frozen simple advertising heuristic without forecasting, causal correction, learning or advanced optimization.",
      intentRef: "advertising-heuristic:" + heuristicType,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "advertising-heuristic:" +
        heuristicType +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        ADVERTISING_HEURISTIC_OBSERVATION_KEY,
        "heuristic-config:" + configFingerprint,
      ],
    },
  });
}

function roas(
  channel: AdvertisingChannelObservation,
  config: AdvertisingHeuristicConfig,
): {
  readonly value: number | null;
  readonly status:
    | "AVAILABLE"
    | "MISSING_SPEND"
    | "MISSING_ATTRIBUTED_REVENUE"
    | "ZERO_SPEND"
    | "INSUFFICIENT_HISTORY";
} {
  const minimumHistory =
    "minimumHistoryDays" in config ? config.minimumHistoryDays : 0;
  const requiredLookback =
    "lookbackDays" in config ? config.lookbackDays : 0;

  if (channel.historyDays < minimumHistory) {
    return { value: null, status: "INSUFFICIENT_HISTORY" };
  }
  if (
    requiredLookback > 0 &&
    channel.historyDays < requiredLookback
  ) {
    return { value: null, status: "INSUFFICIENT_HISTORY" };
  }
  if (channel.spendMinor === null) {
    return { value: null, status: "MISSING_SPEND" };
  }
  if (channel.attributedRevenueMinor === null) {
    return { value: null, status: "MISSING_ATTRIBUTED_REVENUE" };
  }
  if (channel.spendMinor === 0) {
    return { value: null, status: "ZERO_SPEND" };
  }
  return {
    value: channel.attributedRevenueMinor / channel.spendMinor,
    status: "AVAILABLE",
  };
}

function equalTargets(
  channels: readonly AdvertisingChannelObservation[],
  order: readonly string[],
): Readonly<Record<string, number>> {
  const ids = stableChannelSort(
    channels.map((channel) => channel.channelId),
    order,
  );
  const total = channels.reduce(
    (sum, channel) => sum + channel.currentBudgetMinor,
    0,
  );
  const base = Math.floor(total / ids.length);
  let residual = total - base * ids.length;
  const result: Record<string, number> = {};
  for (const channelId of ids) {
    result[channelId] = base + (residual > 0 ? 1 : 0);
    if (residual > 0) residual -= 1;
  }
  return result;
}

function weightedTargets(
  total: number,
  shares: Readonly<Record<string, number>>,
  order: readonly string[],
): Readonly<Record<string, number>> {
  const ids = stableChannelSort(Object.keys(shares), order);
  const provisional = ids.map((channelId) => {
    const exact = (total * shares[channelId]!) / 10_000;
    return {
      channelId,
      floor: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let residual =
    total - provisional.reduce((sum, entry) => sum + entry.floor, 0);
  const remainderOrder = [...provisional].sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return stableChannelSort(
      [left.channelId, right.channelId],
      order,
    )[0] === left.channelId
      ? -1
      : 1;
  });
  const result = Object.fromEntries(
    provisional.map((entry) => [entry.channelId, entry.floor]),
  ) as Record<string, number>;
  for (let index = 0; residual > 0; index += 1) {
    const channel = remainderOrder[index % remainderOrder.length]!;
    result[channel.channelId] = result[channel.channelId]! + 1;
    residual -= 1;
  }
  return result;
}

interface ChannelAudit {
  readonly channelId: string;
  readonly active: boolean;
  readonly eligible: boolean;
  readonly currentBudgetMinor: number;
  readonly spendMinor: number | null;
  readonly attributedRevenueMinor: number | null;
  readonly observedRoas: number | null;
  readonly roasStatus: string;
  readonly historyDays: number;
}

interface HeuristicEvaluation {
  readonly actions: readonly Action[];
  readonly audit: {
    readonly heuristicType: AdvertisingHeuristicType;
    readonly operatorId: string;
    readonly operatorVersion: string;
    readonly implementationFingerprint: string;
    readonly configurationFingerprint: string;
    readonly configuration: OperatorJson;
    readonly dependencies: OperatorJson;
    readonly observationStatus: string;
    readonly observationLookbackDays: number | null;
    readonly attributionSemantics: string;
    readonly budgetSemantics: AdvertisingBudgetSemantics;
    readonly eligibleChannels: readonly string[];
    readonly channels: readonly ChannelAudit[];
    readonly currentBudgetMinorByChannel: Readonly<Record<string, number>>;
    readonly targetBudgetMinorByChannel: Readonly<Record<string, number>>;
    readonly selectedChannel: string | null;
    readonly fundingChannel: string | null;
    readonly tieBreakResult: string | null;
    readonly fallbackReason: string | null;
    readonly threshold: number | null;
    readonly proposedActionIds: readonly string[];
  };
}

function implementationFingerprint(
  heuristicType: AdvertisingHeuristicType,
): string {
  return operatorFingerprint({
    suiteVersion: ADVERTISING_HEURISTIC_SUITE_VERSION,
    operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorVersion: ADVERTISING_HEURISTIC_OPERATOR_VERSION,
    heuristicType,
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        ADVERTISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: ADVERTISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    frozenParentCommit: ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    metricSetVersion: ADVERTISING_HEURISTIC_METRIC_SET_VERSION,
    advertisingEconomicsVersion:
      ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION,
    observationSemantics: {
      key: ADVERTISING_HEURISTIC_OBSERVATION_KEY,
      schemaVersion: ADVERTISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
      roas:
        "observed_attributed_revenue_minor divided by observed_spend_minor for positive spend; zero spend is unavailable",
      missingData: "no discretionary change",
    },
    decisionDomain: "advertising_budget_only",
    advancedOptimization: false,
  });
}

export const ADVERTISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS =
  deepFreezeOperator({
    EQUAL_BUDGET_ALLOCATION: implementationFingerprint(
      "EQUAL_BUDGET_ALLOCATION",
    ),
    ROAS_THRESHOLD_INCREASE: implementationFingerprint(
      "ROAS_THRESHOLD_INCREASE",
    ),
    ROAS_THRESHOLD_DECREASE: implementationFingerprint(
      "ROAS_THRESHOLD_DECREASE",
    ),
    HIGHEST_OBSERVED_ROAS: implementationFingerprint(
      "HIGHEST_OBSERVED_ROAS",
    ),
    FIXED_CHANNEL_ALLOCATION: implementationFingerprint(
      "FIXED_CHANNEL_ALLOCATION",
    ),
  });

export function advertisingHeuristicConfigurationFingerprint(
  config: AdvertisingHeuristicConfig,
): string {
  return operatorFingerprint({
    ...config,
    frozenParentCommit: ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
    metricSetVersion: ADVERTISING_HEURISTIC_METRIC_SET_VERSION,
    advertisingEconomicsVersion:
      ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION,
  });
}

function evaluate(
  config: AdvertisingHeuristicConfig,
  input: Readonly<OperatorDecisionInput>,
): HeuristicEvaluation {
  const configFingerprint =
    advertisingHeuristicConfigurationFingerprint(config);
  const implFingerprint =
    ADVERTISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];
  const parsed = parseObservation(input, config);
  const currentBudgetMinorByChannel: Record<string, number> = {};
  const targetBudgetMinorByChannel: Record<string, number> = {};
  let selectedChannel: string | null = null;
  let fundingChannel: string | null = null;
  let tieBreakResult: string | null = null;
  let fallbackReason: string | null = null;
  let observationStatus = parsed.ok ? "AVAILABLE" : parsed.reason;
  let observationLookbackDays: number | null = null;
  let eligibleChannels: string[] = [];
  let channelAudits: ChannelAudit[] = [];
  const actions: Action[] = [];

  if (!parsed.ok) {
    fallbackReason = parsed.reason;
  } else {
    observationLookbackDays = parsed.payload.lookbackDays;
    eligibleChannels = eligibleChannelIds(
      input,
      parsed.byChannel,
      config,
    );
    if (eligibleChannels.length === 0) {
      fallbackReason = "NO_ELIGIBLE_ACTIVE_CHANNELS";
    }

    channelAudits = stableChannelSort(
      parsed.payload.channels.map((channel) => channel.channelId),
      config.channelOrder,
    ).map((channelId) => {
      const channel = parsed.byChannel.get(channelId)!;
      const measured = roas(channel, config);
      currentBudgetMinorByChannel[channelId] =
        channel.currentBudgetMinor;
      return {
        channelId,
        active: channel.active,
        eligible: eligibleChannels.includes(channelId),
        currentBudgetMinor: channel.currentBudgetMinor,
        spendMinor: channel.spendMinor,
        attributedRevenueMinor: channel.attributedRevenueMinor,
        observedRoas: measured.value,
        roasStatus: measured.status,
        historyDays: channel.historyDays,
      };
    });

    const rule = budgetRule(input);
    const canEmit =
      rule !== undefined && rule.requiredPreconditionIds.length === 0;

    const attemptSetTargets = (
      targets: Readonly<Record<string, number>>,
      allOrNothing: boolean,
    ) => {
      const proposed: Action[] = [];
      for (const channelId of stableChannelSort(
        Object.keys(targets),
        config.channelOrder,
      )) {
        const channel = parsed.byChannel.get(channelId);
        if (channel === undefined) {
          if (allOrNothing) {
            fallbackReason = "TARGET_CHANNEL_OBSERVATION_MISSING";
            return;
          }
          continue;
        }
        const targetBudget = targets[channelId]!;
        targetBudgetMinorByChannel[channelId] = targetBudget;
        if (targetBudget === channel.currentBudgetMinor) continue;
        if (!canEmit || rule === undefined) {
          if (allOrNothing) {
            fallbackReason =
              "LEGAL_BUDGET_ACTION_UNAVAILABLE_OR_REQUIRES_PRECONDITIONS";
            return;
          }
          continue;
        }
        const action = budgetAction(
          config.heuristicType,
          configFingerprint,
          input,
          channelId,
          targetBudget,
        );
        if (!actionWithinAvailabilityBounds(action, rule)) {
          if (allOrNothing) {
            fallbackReason = "TARGET_BUDGET_OUTSIDE_LEGAL_BOUNDS";
            return;
          }
          continue;
        }
        proposed.push(action);
      }
      actions.push(...proposed);
    };

    if (eligibleChannels.length > 0) {
      switch (config.heuristicType) {
        case "EQUAL_BUDGET_ALLOCATION": {
          const channels = eligibleChannels.map(
            (channelId) => parsed.byChannel.get(channelId)!,
          );
          const targets = equalTargets(channels, config.channelOrder);
          const values = Object.values(targets);
          if (
            values.some(
              (value) =>
                value < config.minimumChannelBudgetMinor ||
                value > config.maximumChannelBudgetMinor,
            )
          ) {
            fallbackReason = "EQUAL_ALLOCATION_OUTSIDE_FROZEN_BOUNDS";
            break;
          }
          attemptSetTargets(targets, true);
          break;
        }

        case "ROAS_THRESHOLD_INCREASE": {
          if (parsed.payload.lookbackDays !== config.lookbackDays) {
            fallbackReason = "LOOKBACK_WINDOW_MISMATCH";
            break;
          }
          for (const channelId of eligibleChannels) {
            const channel = parsed.byChannel.get(channelId)!;
            const measured = roas(channel, config);
            if (
              measured.status !== "AVAILABLE" ||
              measured.value === null ||
              measured.value <= config.roasThreshold
            ) {
              continue;
            }
            const rawIncrease = Math.floor(
              (channel.currentBudgetMinor *
                config.increaseBasisPoints) /
                10_000,
            );
            const increase = Math.min(
              rawIncrease,
              config.maximumIncreaseMinor,
            );
            if (increase <= 0) continue;
            const target = channel.currentBudgetMinor + increase;
            if (target > config.maximumChannelBudgetMinor) continue;
            attemptSetTargets({ [channelId]: target }, false);
          }
          break;
        }

        case "ROAS_THRESHOLD_DECREASE": {
          if (parsed.payload.lookbackDays !== config.lookbackDays) {
            fallbackReason = "LOOKBACK_WINDOW_MISMATCH";
            break;
          }
          for (const channelId of eligibleChannels) {
            const channel = parsed.byChannel.get(channelId)!;
            const measured = roas(channel, config);
            if (
              measured.status !== "AVAILABLE" ||
              measured.value === null ||
              measured.value >= config.roasThreshold
            ) {
              continue;
            }
            const rawDecrease = Math.floor(
              (channel.currentBudgetMinor *
                config.decreaseBasisPoints) /
                10_000,
            );
            const decrease = Math.min(
              rawDecrease,
              config.maximumDecreaseMinor,
            );
            if (decrease <= 0) continue;
            const target = channel.currentBudgetMinor - decrease;
            if (target < config.minimumChannelBudgetMinor) continue;
            attemptSetTargets({ [channelId]: target }, false);
          }
          break;
        }

        case "HIGHEST_OBSERVED_ROAS": {
          if (parsed.payload.lookbackDays !== config.lookbackDays) {
            fallbackReason = "LOOKBACK_WINDOW_MISMATCH";
            break;
          }
          const available = eligibleChannels
            .map((channelId) => {
              const channel = parsed.byChannel.get(channelId)!;
              return {
                channel,
                roas: roas(channel, config),
              };
            })
            .filter(
              (
                entry,
              ): entry is {
                channel: AdvertisingChannelObservation;
                roas: { value: number; status: "AVAILABLE" };
              } =>
                entry.roas.status === "AVAILABLE" &&
                entry.roas.value !== null,
            );
          if (available.length < 2) {
            fallbackReason = "INSUFFICIENT_ROAS_CHANNELS_FOR_REALLOCATION";
            break;
          }
          const rankedHigh = [...available].sort((left, right) => {
            if (right.roas.value !== left.roas.value) {
              return right.roas.value - left.roas.value;
            }
            return (
              stableChannelSort(
                [left.channel.channelId, right.channel.channelId],
                config.channelOrder,
              )[0] === left.channel.channelId
                ? -1
                : 1
            );
          });
          const winner = rankedHigh[0]!;
          const tiedHigh = rankedHigh.filter(
            (entry) => entry.roas.value === winner.roas.value,
          );
          selectedChannel = winner.channel.channelId;
          tieBreakResult =
            tiedHigh.length > 1
              ? "WINNER_TIE_RESOLVED_BY_STABLE_CHANNEL_ORDER:" +
                winner.channel.channelId
              : "NO_WINNER_TIE";

          const donors = available
            .filter(
              (entry) =>
                entry.channel.channelId !== winner.channel.channelId,
            )
            .sort((left, right) => {
              if (left.roas.value !== right.roas.value) {
                return left.roas.value - right.roas.value;
              }
              return (
                stableChannelSort(
                  [left.channel.channelId, right.channel.channelId],
                  config.channelOrder,
                )[0] === left.channel.channelId
                  ? -1
                  : 1
              );
            });
          const donor = donors[0]!;
          fundingChannel = donor.channel.channelId;
          const increment = config.incrementalBudgetMinor;
          if (
            winner.channel.currentBudgetMinor + increment >
              config.maximumChannelBudgetMinor ||
            donor.channel.currentBudgetMinor - increment <
              config.minimumChannelBudgetMinor
          ) {
            fallbackReason = "REALLOCATION_NOT_FEASIBLE_AT_FROZEN_INCREMENT";
            break;
          }
          attemptSetTargets(
            {
              [winner.channel.channelId]:
                winner.channel.currentBudgetMinor + increment,
              [donor.channel.channelId]:
                donor.channel.currentBudgetMinor - increment,
            },
            true,
          );
          break;
        }

        case "FIXED_CHANNEL_ALLOCATION": {
          const configuredChannels = stableChannelSort(
            Object.keys(config.channelSharesBasisPoints),
            config.channelOrder,
          );
          if (
            configuredChannels.some(
              (channelId) => !eligibleChannels.includes(channelId),
            )
          ) {
            fallbackReason = "CONFIGURED_CHANNEL_UNAVAILABLE";
            break;
          }
          const weightTotal = configuredChannels.reduce(
            (sum, channelId) =>
              sum + config.channelSharesBasisPoints[channelId]!,
            0,
          );
          if (weightTotal !== 10_000) {
            fallbackReason = "FIXED_WEIGHTS_DO_NOT_SUM_TO_10000";
            break;
          }
          const total = configuredChannels.reduce(
            (sum, channelId) =>
              sum +
              parsed.byChannel.get(channelId)!.currentBudgetMinor,
            0,
          );
          const targets = weightedTargets(
            total,
            config.channelSharesBasisPoints,
            config.channelOrder,
          );
          if (
            Object.values(targets).some(
              (value) =>
                value < config.minimumChannelBudgetMinor ||
                value > config.maximumChannelBudgetMinor,
            )
          ) {
            fallbackReason = "FIXED_ALLOCATION_OUTSIDE_FROZEN_BOUNDS";
            break;
          }
          attemptSetTargets(targets, true);
          break;
        }
      }
    }
  }

  if (actions.length === 0 && fallbackReason === null) {
    fallbackReason = "RULE_REQUIRED_NO_DISCRETIONARY_CHANGE";
  }

  const threshold =
    config.heuristicType === "ROAS_THRESHOLD_INCREASE" ||
    config.heuristicType === "ROAS_THRESHOLD_DECREASE"
      ? config.roasThreshold
      : null;

  return deepFreezeOperator({
    actions,
    audit: {
      heuristicType: config.heuristicType,
      operatorId: OPERATOR_IDS[config.heuristicType],
      operatorVersion: ADVERTISING_HEURISTIC_OPERATOR_VERSION,
      implementationFingerprint: implFingerprint,
      configurationFingerprint: configFingerprint,
      configuration: config as unknown as OperatorJson,
      dependencies: {
        evaluationContractFingerprint:
          ADVERTISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
        evaluationContractFrozenCommit:
          ADVERTISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
        frozenParentCommit:
          ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
        actionOntologyVersion: ACTION_SCHEMA_VERSION,
        metricSetVersion: ADVERTISING_HEURISTIC_METRIC_SET_VERSION,
        advertisingEconomicsVersion:
          ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION,
      },
      observationStatus,
      observationLookbackDays,
      attributionSemantics: config.attributionSemantics,
      budgetSemantics: config.budgetSemantics,
      eligibleChannels,
      channels: channelAudits,
      currentBudgetMinorByChannel,
      targetBudgetMinorByChannel,
      selectedChannel,
      fundingChannel,
      tieBreakResult,
      fallbackReason,
      threshold,
      proposedActionIds: actions.map((action) => String(action.actionId)),
    },
  });
}

export function createAdvertisingHeuristicOperator(
  config: AdvertisingHeuristicConfig,
): CanonicalOperator {
  const configurationFingerprint =
    advertisingHeuristicConfigurationFingerprint(config);
  const implementation =
    ADVERTISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: OPERATOR_IDS[config.heuristicType],
    operatorType: "baseline",
    operatorVersion: ADVERTISING_HEURISTIC_OPERATOR_VERSION,
    description: DESCRIPTIONS[config.heuristicType],
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        ADVERTISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: ADVERTISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      suiteVersion: ADVERTISING_HEURISTIC_SUITE_VERSION,
      heuristicType: config.heuristicType,
      configurationFingerprint,
      configuration: config as unknown as OperatorJson,
      metricSetVersion: ADVERTISING_HEURISTIC_METRIC_SET_VERSION,
      advertisingEconomicsVersion:
        ADVERTISING_HEURISTIC_ADVERTISING_ECONOMICS_VERSION,
      frozenParentCommit:
        ADVERTISING_HEURISTIC_FROZEN_STEP_3_3_COMMIT,
      optimizationObjective: null,
      learning: false,
      forecasting: false,
      causalCorrection: false,
    },
    implementationFingerprint: implementation,
  });

  return deepFreezeOperator({
    metadata,
    decide(
      input: Readonly<OperatorDecisionInput>,
    ): OperatorDecisionOutput {
      return { actions: evaluate(config, input).actions };
    },
    auditDecision(
      input: Readonly<OperatorDecisionInput>,
      output: Readonly<OperatorDecisionOutput>,
    ): OperatorDecisionAudit {
      const decision = evaluate(config, input);
      if (
        stableOperatorJson(output.actions) !==
        stableOperatorJson(decision.actions)
      ) {
        throw new TypeError(
          "advertising heuristic audit does not match decision output",
        );
      }
      return {
        auditType: "advertising_heuristic_evaluation",
        payload: decision.audit as unknown as OperatorJson,
      };
    },
  });
}

export const EQUAL_BUDGET_ALLOCATION_OPERATOR =
  createAdvertisingHeuristicOperator(EQUAL_BUDGET_ALLOCATION_CONFIG);

export const ROAS_THRESHOLD_INCREASE_OPERATOR =
  createAdvertisingHeuristicOperator(ROAS_THRESHOLD_INCREASE_CONFIG);

export const ROAS_THRESHOLD_DECREASE_OPERATOR =
  createAdvertisingHeuristicOperator(ROAS_THRESHOLD_DECREASE_CONFIG);

export const HIGHEST_OBSERVED_ROAS_OPERATOR =
  createAdvertisingHeuristicOperator(HIGHEST_OBSERVED_ROAS_CONFIG);

export const FIXED_CHANNEL_ALLOCATION_OPERATOR =
  createAdvertisingHeuristicOperator(FIXED_CHANNEL_ALLOCATION_CONFIG);

export const ADVERTISING_HEURISTIC_BASELINE_OPERATORS =
  deepFreezeOperator({
    EQUAL_BUDGET_ALLOCATION: EQUAL_BUDGET_ALLOCATION_OPERATOR,
    ROAS_THRESHOLD_INCREASE: ROAS_THRESHOLD_INCREASE_OPERATOR,
    ROAS_THRESHOLD_DECREASE: ROAS_THRESHOLD_DECREASE_OPERATOR,
    HIGHEST_OBSERVED_ROAS: HIGHEST_OBSERVED_ROAS_OPERATOR,
    FIXED_CHANNEL_ALLOCATION: FIXED_CHANNEL_ALLOCATION_OPERATOR,
  });
