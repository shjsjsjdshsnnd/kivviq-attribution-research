import { actionId, actionType } from "../action_ontology/identity.js";
import {
  doNothingAction,
  setGoogleShoppingBudgetAbsolute,
} from "../action_ontology/fixtures.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionTarget,
  type PromotionDefinition,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { currencyCode, utcTimestamp } from "../core/units.js";
import { reorderSkuB50SupplierX } from "../inventory/fixtures.js";
import { setSkuA849Cad } from "../pricing/fixtures.js";
import { startAutomaticCollectionX15FourDays } from "../promotion/fixtures.js";
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

export const GREEDY_OPERATOR_SUITE_VERSION = "1.0.0" as const;
export const GREEDY_OPERATOR_VERSION = "1.0.0" as const;
export const GREEDY_CONFIGURATION_SCHEMA_VERSION = "1.0.0" as const;
export const GREEDY_OBSERVATION_SCHEMA_VERSION = "1.0.0" as const;
export const GREEDY_OBSERVATION_KEY =
  "greedy.immediate_return_evidence.v1" as const;

export const GREEDY_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const GREEDY_FROZEN_STEP_3_7_COMMIT =
  "e23b336582b34b175524c82a802a8194ed1427e7" as const;
export const GREEDY_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;
export const GREEDY_METRIC_SET_VERSION = "1.0.0" as const;
export const GREEDY_SIMULATOR_VERSION =
  "customer-journey-simulator-4.0.0" as const;

export type GreedyObjective =
  | "IMMEDIATE_REVENUE"
  | "IMMEDIATE_GROSS_PROFIT"
  | "IMMEDIATE_CONTRIBUTION";

export type GreedyCandidateDomain =
  | "no_op"
  | "advertising"
  | "pricing"
  | "promotion"
  | "merchandising"
  | "inventory";

export interface GreedyChannelObservation {
  readonly channelId: string;
  readonly active: boolean;
  readonly currentBudgetMinor: number;
  readonly spendMinor: number | null;
  readonly attributedRevenueMinor: number | null;
  readonly attributedGrossProfitMinor: number | null;
  readonly attributedContributionMinor: number | null;
}

export interface GreedyProductObservation {
  readonly productId: string;
  readonly skuId: string;
  readonly collectionId: string;
  readonly active: boolean;
  readonly available: boolean;
  readonly promotionEligible: boolean;
  readonly merchandisingEligible: boolean;
  readonly currentPriceMinor: number | null;
  readonly recentUnits: number | null;
  readonly revenueMinor: number | null;
  readonly grossProfitMinor: number | null;
  readonly contributionMinor: number | null;
  readonly productViews: number | null;
  readonly conversions: number | null;
  readonly currentPosition: number | null;
  readonly availableUnits: number | null;
  readonly pendingReorder: boolean | null;
  readonly incomingUnits: number | null;
  readonly supplierAvailable: boolean | null;
}

export interface GreedyObservationPayload {
  readonly schemaVersion: typeof GREEDY_OBSERVATION_SCHEMA_VERSION;
  readonly currency: "CAD";
  readonly lookbackDays: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly channels: readonly GreedyChannelObservation[];
  readonly products: readonly GreedyProductObservation[];
}

export interface GreedyPromotionTemplate {
  readonly promotionId: string;
  readonly productId: string;
  readonly skuId: string;
  readonly discountBasisPoints: number;
  readonly durationSeconds: number;
}

export interface GreedyConfiguration {
  readonly configurationSchemaVersion:
    typeof GREEDY_CONFIGURATION_SCHEMA_VERSION;
  readonly objective: GreedyObjective;
  readonly objectiveMetricId:
    | "estimated_immediate_revenue_minor"
    | "estimated_immediate_gross_profit_minor"
    | "estimated_immediate_contribution_minor";
  readonly objectiveDefinition:
    "POINT_ESTIMATE_OF_IMMEDIATE_OBSERVABLE_RETURN_IN_CAD_MINOR";
  readonly population:
    "LEGAL_ACTION_TARGETS_WITH_PERMITTED_OBSERVABLE_EVIDENCE";
  readonly scope: "ONE_CANONICAL_ACTION_AT_CURRENT_DECISION";
  readonly currency: "CAD";
  readonly lookbackDays: 7;
  readonly observationKey: typeof GREEDY_OBSERVATION_KEY;
  readonly eligibleActionDomains: readonly [
    "advertising",
    "pricing",
    "promotion",
    "merchandising",
    "inventory",
  ];
  readonly candidateActionTypeOrder: readonly [
    "no_action",
    "advertising.adjust_budget",
    "pricing.adjust_price",
    "promotion.start",
    "merchandising.move_product",
    "inventory.reorder",
  ];
  readonly candidateParameterGrid: {
    readonly advertisingBudgetIncreaseMinor: readonly [100000];
    readonly pricingPriceChangeBasisPoints: readonly [-1000, 500];
    readonly promotionTemplates: readonly GreedyPromotionTemplate[];
    readonly merchandisingPositions: readonly [1];
    readonly inventoryReorderQuantities: readonly [50];
  };
  readonly maxTargetsPerActionType: 8;
  readonly maximumCandidateCount: 64;
  readonly noActionImmediateReturnMinor: 0;
  readonly missingEvidenceBehavior: "EXCLUDE_CANDIDATE";
  readonly unsupportedSimulatorBehavior:
    "AUDIT_CANONICAL_CANDIDATE_BUT_EXCLUDE_FROM_SELECTION";
  readonly inventorySelectionSupport:
    "FROZEN_SIMULATOR_INVENTORY_ACTIONS_UNSUPPORTED";
  readonly tieBreakRule:
    "SCORE_DESC_NO_ACTION_FIRST_ACTION_TYPE_ORDER_TARGET_ASC_PARAMETER_ASC";
  readonly advertisingEstimator:
    "OBSERVED_OBJECTIVE_PER_SPEND_TIMES_PROPOSED_SPEND_INCREASE";
  readonly pricingEstimator:
    "RECENT_UNITS_TIMES_IMMEDIATE_PRICE_DELTA";
  readonly promotionEstimator:
    "RECENT_UNITS_TIMES_NEGATIVE_IMMEDIATE_DISCOUNT_VALUE";
  readonly merchandisingEstimator:
    "OBSERVED_TRAILING_OBJECTIVE_VALUE_OF_MOVED_PRODUCT";
  readonly inventoryEstimator:
    "OBSERVED_REVENUE_PER_UNIT_TIMES_MIN_FIXED_REORDER_QTY_RECENT_UNITS";
  readonly pricingCostAssumption:
    "UNIT_VARIABLE_COST_UNCHANGED_SO_PRICE_DELTA_EQUALS_GP_AND_CONTRIBUTION_DELTA";
  readonly causalityCorrection: false;
  readonly uncertaintyAdjustment: false;
  readonly delayedEffectAdjustment: false;
  readonly substitutionAdjustment: false;
  readonly retentionClvAdjustment: false;
  readonly crossDomainSecondOrderAdjustment: false;
}

const COMMON_CONFIG = {
  configurationSchemaVersion: GREEDY_CONFIGURATION_SCHEMA_VERSION,
  objectiveDefinition:
    "POINT_ESTIMATE_OF_IMMEDIATE_OBSERVABLE_RETURN_IN_CAD_MINOR",
  population: "LEGAL_ACTION_TARGETS_WITH_PERMITTED_OBSERVABLE_EVIDENCE",
  scope: "ONE_CANONICAL_ACTION_AT_CURRENT_DECISION",
  currency: "CAD",
  lookbackDays: 7,
  observationKey: GREEDY_OBSERVATION_KEY,
  eligibleActionDomains: [
    "advertising",
    "pricing",
    "promotion",
    "merchandising",
    "inventory",
  ],
  candidateActionTypeOrder: [
    "no_action",
    "advertising.adjust_budget",
    "pricing.adjust_price",
    "promotion.start",
    "merchandising.move_product",
    "inventory.reorder",
  ],
  candidateParameterGrid: {
    advertisingBudgetIncreaseMinor: [100000],
    pricingPriceChangeBasisPoints: [-1000, 500],
    promotionTemplates: [
      {
        promotionId: "promo_greedy_product_a_10pct",
        productId: "product:A",
        skuId: "sku:A",
        discountBasisPoints: 1000,
        durationSeconds: 7 * 24 * 60 * 60,
      },
      {
        promotionId: "promo_greedy_product_b_10pct",
        productId: "product:B",
        skuId: "sku:B",
        discountBasisPoints: 1000,
        durationSeconds: 7 * 24 * 60 * 60,
      },
    ],
    merchandisingPositions: [1],
    inventoryReorderQuantities: [50],
  },
  maxTargetsPerActionType: 8,
  maximumCandidateCount: 64,
  noActionImmediateReturnMinor: 0,
  missingEvidenceBehavior: "EXCLUDE_CANDIDATE",
  unsupportedSimulatorBehavior:
    "AUDIT_CANONICAL_CANDIDATE_BUT_EXCLUDE_FROM_SELECTION",
  inventorySelectionSupport:
    "FROZEN_SIMULATOR_INVENTORY_ACTIONS_UNSUPPORTED",
  tieBreakRule:
    "SCORE_DESC_NO_ACTION_FIRST_ACTION_TYPE_ORDER_TARGET_ASC_PARAMETER_ASC",
  advertisingEstimator:
    "OBSERVED_OBJECTIVE_PER_SPEND_TIMES_PROPOSED_SPEND_INCREASE",
  pricingEstimator: "RECENT_UNITS_TIMES_IMMEDIATE_PRICE_DELTA",
  promotionEstimator:
    "RECENT_UNITS_TIMES_NEGATIVE_IMMEDIATE_DISCOUNT_VALUE",
  merchandisingEstimator:
    "OBSERVED_TRAILING_OBJECTIVE_VALUE_OF_MOVED_PRODUCT",
  inventoryEstimator:
    "OBSERVED_REVENUE_PER_UNIT_TIMES_MIN_FIXED_REORDER_QTY_RECENT_UNITS",
  pricingCostAssumption:
    "UNIT_VARIABLE_COST_UNCHANGED_SO_PRICE_DELTA_EQUALS_GP_AND_CONTRIBUTION_DELTA",
  causalityCorrection: false,
  uncertaintyAdjustment: false,
  delayedEffectAdjustment: false,
  substitutionAdjustment: false,
  retentionClvAdjustment: false,
  crossDomainSecondOrderAdjustment: false,
} as const;

export const GREEDY_IMMEDIATE_REVENUE_CONFIG: GreedyConfiguration =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "IMMEDIATE_REVENUE",
    objectiveMetricId: "estimated_immediate_revenue_minor",
  });

export const GREEDY_IMMEDIATE_GROSS_PROFIT_CONFIG: GreedyConfiguration =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "IMMEDIATE_GROSS_PROFIT",
    objectiveMetricId: "estimated_immediate_gross_profit_minor",
  });

export const GREEDY_IMMEDIATE_CONTRIBUTION_CONFIG: GreedyConfiguration =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "IMMEDIATE_CONTRIBUTION",
    objectiveMetricId: "estimated_immediate_contribution_minor",
  });

export const FROZEN_GREEDY_CONFIGURATIONS = deepFreezeOperator({
  IMMEDIATE_REVENUE: GREEDY_IMMEDIATE_REVENUE_CONFIG,
  IMMEDIATE_GROSS_PROFIT: GREEDY_IMMEDIATE_GROSS_PROFIT_CONFIG,
  IMMEDIATE_CONTRIBUTION: GREEDY_IMMEDIATE_CONTRIBUTION_CONFIG,
});

const OPERATOR_IDS: Readonly<Record<GreedyObjective, string>> =
  deepFreezeOperator({
    IMMEDIATE_REVENUE: "baseline.greedy.immediate_revenue",
    IMMEDIATE_GROSS_PROFIT:
      "baseline.greedy.immediate_gross_profit",
    IMMEDIATE_CONTRIBUTION:
      "baseline.greedy.immediate_contribution",
  });

const DESCRIPTIONS: Readonly<Record<GreedyObjective, string>> =
  deepFreezeOperator({
    IMMEDIATE_REVENUE:
      "Myopic greedy baseline that chooses the legal selectable candidate with the highest observable estimated immediate revenue.",
    IMMEDIATE_GROSS_PROFIT:
      "Myopic greedy baseline that chooses the legal selectable candidate with the highest observable estimated immediate gross profit.",
    IMMEDIATE_CONTRIBUTION:
      "Myopic greedy baseline that chooses the legal selectable candidate with the highest observable estimated immediate contribution.",
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteNonNegative(value: unknown): value is number {
  return finiteNumber(value) && value >= 0;
}

function parseObservation(
  input: Readonly<OperatorDecisionInput>,
  config: GreedyConfiguration,
):
  | {
      readonly ok: true;
      readonly payload: GreedyObservationPayload;
      readonly channels: ReadonlyMap<string, GreedyChannelObservation>;
      readonly productsById: ReadonlyMap<string, GreedyProductObservation>;
      readonly productsBySku: ReadonlyMap<string, GreedyProductObservation>;
    }
  | { readonly ok: false; readonly reason: string } {
  const record = input.observation.records.find(
    (entry) => entry.observationKey === config.observationKey,
  );
  if (record === undefined) {
    return { ok: false, reason: "OBSERVATION_MISSING" };
  }
  const value = record.value;
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== GREEDY_OBSERVATION_SCHEMA_VERSION ||
    value["currency"] !== config.currency ||
    value["lookbackDays"] !== config.lookbackDays ||
    typeof value["windowStart"] !== "string" ||
    typeof value["windowEnd"] !== "string" ||
    !Array.isArray(value["channels"]) ||
    !Array.isArray(value["products"])
  ) {
    return { ok: false, reason: "OBSERVATION_SCHEMA_INVALID" };
  }

  const decisionMs = Date.parse(input.decisionTime);
  const startMs = Date.parse(value["windowStart"]);
  const endMs = Date.parse(value["windowEnd"]);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs !== decisionMs ||
    endMs - startMs !== config.lookbackDays * 24 * 60 * 60 * 1000
  ) {
    return { ok: false, reason: "LOOKBACK_WINDOW_MISMATCH" };
  }

  const channels: GreedyChannelObservation[] = [];
  const channelIds = new Set<string>();
  for (const raw of value["channels"]) {
    if (
      !isRecord(raw) ||
      typeof raw["channelId"] !== "string" ||
      raw["channelId"].trim().length === 0 ||
      typeof raw["active"] !== "boolean" ||
      !finiteNonNegative(raw["currentBudgetMinor"]) ||
      !(
        raw["spendMinor"] === null ||
        finiteNonNegative(raw["spendMinor"])
      ) ||
      !(
        raw["attributedRevenueMinor"] === null ||
        finiteNumber(raw["attributedRevenueMinor"])
      ) ||
      !(
        raw["attributedGrossProfitMinor"] === null ||
        finiteNumber(raw["attributedGrossProfitMinor"])
      ) ||
      !(
        raw["attributedContributionMinor"] === null ||
        finiteNumber(raw["attributedContributionMinor"])
      )
    ) {
      return { ok: false, reason: "CHANNEL_OBSERVATION_INVALID" };
    }
    if (channelIds.has(raw["channelId"])) {
      return { ok: false, reason: "DUPLICATE_CHANNEL_OBSERVATION" };
    }
    channelIds.add(raw["channelId"]);
    channels.push({
      channelId: raw["channelId"],
      active: raw["active"],
      currentBudgetMinor: raw["currentBudgetMinor"],
      spendMinor: raw["spendMinor"],
      attributedRevenueMinor: raw["attributedRevenueMinor"],
      attributedGrossProfitMinor: raw["attributedGrossProfitMinor"],
      attributedContributionMinor: raw["attributedContributionMinor"],
    });
  }

  const products: GreedyProductObservation[] = [];
  const productIds = new Set<string>();
  const skuIds = new Set<string>();
  for (const raw of value["products"]) {
    if (
      !isRecord(raw) ||
      typeof raw["productId"] !== "string" ||
      raw["productId"].trim().length === 0 ||
      typeof raw["skuId"] !== "string" ||
      raw["skuId"].trim().length === 0 ||
      typeof raw["collectionId"] !== "string" ||
      raw["collectionId"].trim().length === 0 ||
      typeof raw["active"] !== "boolean" ||
      typeof raw["available"] !== "boolean" ||
      typeof raw["promotionEligible"] !== "boolean" ||
      typeof raw["merchandisingEligible"] !== "boolean" ||
      !(
        raw["currentPriceMinor"] === null ||
        finiteNonNegative(raw["currentPriceMinor"])
      ) ||
      !(
        raw["recentUnits"] === null ||
        finiteNonNegative(raw["recentUnits"])
      ) ||
      !(
        raw["revenueMinor"] === null ||
        finiteNumber(raw["revenueMinor"])
      ) ||
      !(
        raw["grossProfitMinor"] === null ||
        finiteNumber(raw["grossProfitMinor"])
      ) ||
      !(
        raw["contributionMinor"] === null ||
        finiteNumber(raw["contributionMinor"])
      ) ||
      !(
        raw["productViews"] === null ||
        finiteNonNegative(raw["productViews"])
      ) ||
      !(
        raw["conversions"] === null ||
        finiteNonNegative(raw["conversions"])
      ) ||
      !(
        raw["currentPosition"] === null ||
        (Number.isInteger(raw["currentPosition"]) &&
          Number(raw["currentPosition"]) > 0)
      ) ||
      !(
        raw["availableUnits"] === null ||
        finiteNonNegative(raw["availableUnits"])
      ) ||
      !(
        raw["pendingReorder"] === null ||
        typeof raw["pendingReorder"] === "boolean"
      ) ||
      !(
        raw["incomingUnits"] === null ||
        finiteNonNegative(raw["incomingUnits"])
      ) ||
      !(
        raw["supplierAvailable"] === null ||
        typeof raw["supplierAvailable"] === "boolean"
      )
    ) {
      return { ok: false, reason: "PRODUCT_OBSERVATION_INVALID" };
    }
    if (productIds.has(raw["productId"]) || skuIds.has(raw["skuId"])) {
      return { ok: false, reason: "DUPLICATE_PRODUCT_OR_SKU_OBSERVATION" };
    }
    productIds.add(raw["productId"]);
    skuIds.add(raw["skuId"]);
    products.push({
      productId: raw["productId"],
      skuId: raw["skuId"],
      collectionId: raw["collectionId"],
      active: raw["active"],
      available: raw["available"],
      promotionEligible: raw["promotionEligible"],
      merchandisingEligible: raw["merchandisingEligible"],
      currentPriceMinor: raw["currentPriceMinor"],
      recentUnits: raw["recentUnits"],
      revenueMinor: raw["revenueMinor"],
      grossProfitMinor: raw["grossProfitMinor"],
      contributionMinor: raw["contributionMinor"],
      productViews: raw["productViews"],
      conversions: raw["conversions"],
      currentPosition: raw["currentPosition"] as number | null,
      availableUnits: raw["availableUnits"],
      pendingReorder: raw["pendingReorder"],
      incomingUnits: raw["incomingUnits"],
      supplierAvailable: raw["supplierAvailable"],
    });
  }

  const payload: GreedyObservationPayload = {
    schemaVersion: GREEDY_OBSERVATION_SCHEMA_VERSION,
    currency: "CAD",
    lookbackDays: config.lookbackDays,
    windowStart: value["windowStart"],
    windowEnd: value["windowEnd"],
    channels,
    products,
  };
  return {
    ok: true,
    payload,
    channels: new Map(channels.map((channel) => [channel.channelId, channel])),
    productsById: new Map(
      products.map((product) => [product.productId, product]),
    ),
    productsBySku: new Map(
      products.map((product) => [product.skuId, product]),
    ),
  };
}

function legalRule(
  input: Readonly<OperatorDecisionInput>,
  actionTypeValue: string,
): OperatorLegalActionRule | undefined {
  return input.legalActionSpace.rules.find(
    (rule) => rule.actionType === actionTypeValue,
  );
}

function targetKey(target: ActionTarget): string {
  return stableOperatorJson(target);
}

function legalTargets(
  input: Readonly<OperatorDecisionInput>,
  actionTypeValue: string,
  maxTargets: number,
): readonly ActionTarget[] {
  const rule = legalRule(input, actionTypeValue);
  if (rule === undefined || rule.requiredPreconditionIds.length > 0) {
    return [];
  }
  return [...rule.eligibleTargets]
    .sort((left, right) => targetKey(left).localeCompare(targetKey(right)))
    .slice(0, maxTargets);
}

function targetEligible(
  rule: OperatorLegalActionRule | undefined,
  target: ActionTarget,
): boolean {
  if (rule === undefined || rule.requiredPreconditionIds.length > 0) {
    return false;
  }
  return rule.eligibleTargets.some(
    (candidate) => targetKey(candidate) === targetKey(target),
  );
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

function advertisingAction(
  config: GreedyConfiguration,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  channel: GreedyChannelObservation,
  increaseMinor: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<
    ActionTarget,
    { readonly kind: "advertising_channel" }
  > = {
    kind: "advertising_channel",
    channelId: channel.channelId,
  };
  return assertValidAction({
    ...setGoogleShoppingBudgetAbsolute,
    actionId: actionId(
      "action_greedy_" +
        config.objective.toLowerCase() +
        "_advertising_" +
        sanitizeId(channel.channelId) +
        "_" +
        increaseMinor +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("advertising.adjust_budget"),
    actionCategory: "advertising",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Greedy " +
      config.objective +
      " increase " +
      channel.channelId +
      " budget by " +
      increaseMinor +
      " minor units/week.",
    target,
    scope: {
      dimensions: [
        {
          kind: "channel_subset",
          channelIds: [channel.channelId],
        },
      ],
    },
    parameters: {
      kind: "budget_adjustment",
      operation: {
        kind: "SET",
        value: {
          kind: "money_rate",
          amountMinor: channel.currentBudgetMinor + increaseMinor,
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
    constraints: [],
    preconditions: [],
    intent: {
      statement:
        "Choose the candidate with the highest frozen observable immediate-return estimate; ignore causality, uncertainty and delayed effects.",
      intentRef: "greedy:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "greedy:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        GREEDY_OBSERVATION_KEY,
        "greedy-config:" + configFingerprint,
      ],
    },
  });
}

function pricingAction(
  config: GreedyConfiguration,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: GreedyProductObservation,
  basisPoints: number,
): Action {
  if (product.currentPriceMinor === null) {
    throw new TypeError("pricing candidate requires current price");
  }
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<ActionTarget, { readonly kind: "sku" }> = {
    kind: "sku",
    productId: product.productId,
    skuId: product.skuId,
  };
  const targetPriceMinor = Math.floor(
    (product.currentPriceMinor * (10_000 + basisPoints)) / 10_000,
  );
  return assertValidAction({
    ...setSkuA849Cad,
    actionId: actionId(
      "action_greedy_" +
        config.objective.toLowerCase() +
        "_pricing_" +
        sanitizeId(product.skuId) +
        "_" +
        String(basisPoints).replace("-", "minus_") +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("pricing.adjust_price"),
    actionCategory: "pricing",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Greedy " +
      config.objective +
      " change " +
      product.skuId +
      " price by " +
      basisPoints +
      " basis points.",
    target,
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [product.productId],
          skuIds: [product.skuId],
        },
      ],
    },
    parameters: {
      kind: "price_adjustment",
      operation: {
        kind: "SET",
        value: {
          kind: "money",
          amountMinor: targetPriceMinor,
          currency: currencyCode("CAD"),
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
    constraints: [],
    preconditions: [],
    intent: {
      statement:
        "Choose the candidate with the highest frozen observable immediate-return estimate; ignore elasticity and longer-term pricing effects.",
      intentRef: "greedy:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "greedy:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        GREEDY_OBSERVATION_KEY,
        "greedy-config:" + configFingerprint,
      ],
    },
  });
}

function promotionAction(
  config: GreedyConfiguration,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: GreedyProductObservation,
  template: GreedyPromotionTemplate,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const definition: PromotionDefinition = {
    mechanism: {
      kind: "DISCOUNT",
      discount: {
        kind: "PERCENTAGE",
        basisPoints: template.discountBasisPoints,
      },
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [
          {
            kind: "sku",
            skuId: product.skuId,
            productId: product.productId,
          },
        ],
        exclude: [],
        exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE",
        conditions: [],
      },
    },
    customerEligibility: { kind: "ALL_CUSTOMERS" },
    purchaseRequirements: [],
    redemption: { kind: "AUTOMATIC" },
    usageLimits: {},
    stacking: { kind: "STACKABLE" },
    conflictResolution: { kind: "NONE" },
    terminationBehavior: "DEACTIVATE_PROMOTION",
  };
  return assertValidAction({
    ...startAutomaticCollectionX15FourDays,
    actionId: actionId(
      "action_greedy_" +
        config.objective.toLowerCase() +
        "_promotion_" +
        sanitizeId(template.promotionId) +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("promotion.start"),
    actionCategory: "promotion",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Greedy " +
      config.objective +
      " start " +
      template.discountBasisPoints +
      " basis-point promotion for " +
      product.skuId +
      ".",
    target: {
      kind: "promotion",
      promotionId: template.promotionId,
    },
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [product.productId],
          skuIds: [product.skuId],
        },
      ],
    },
    parameters: {
      kind: "promotion_start",
      promotionId: template.promotionId,
      definition,
    },
    timing: {
      decisionTime,
      requestedStart: { kind: "known", at: decisionTime },
      effectiveStart: { kind: "known", at: decisionTime },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    },
    duration: {
      kind: "temporary",
      durationSeconds: template.durationSeconds,
    },
    termination: {
      kind: "fixed_duration",
      durationSeconds: template.durationSeconds,
    },
    constraints: [],
    preconditions: [],
    intent: {
      statement:
        "Choose the candidate with the highest frozen observable immediate-return estimate; ignore pull-forward and delayed promotion effects.",
      intentRef: "greedy:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "greedy:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        GREEDY_OBSERVATION_KEY,
        "greedy-config:" + configFingerprint,
      ],
    },
  });
}

function merchandisingAction(
  config: GreedyConfiguration,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: GreedyProductObservation,
  position: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(
      "action_greedy_" +
        config.objective.toLowerCase() +
        "_merch_" +
        sanitizeId(product.productId) +
        "_position_" +
        position +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("merchandising.move_product"),
    actionCategory: "merchandising",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Greedy " +
      config.objective +
      " move " +
      product.productId +
      " to position " +
      position +
      ".",
    target: {
      kind: "product",
      productId: product.productId,
    },
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [product.productId],
          collectionIds: [product.collectionId],
        },
      ],
    },
    parameters: {
      kind: "merchandising_position",
      collectionId: product.collectionId,
      productId: product.productId,
      position,
    },
    timing: {
      decisionTime,
      requestedStart: { kind: "known", at: decisionTime },
      effectiveStart: { kind: "known", at: decisionTime },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    },
    duration: { kind: "persistent" },
    termination: { kind: "persistent" },
    constraints: [],
    preconditions: [],
    intent: {
      statement:
        "Choose the product with the highest frozen observable immediate-return point estimate; ignore position bias and substitution.",
      intentRef: "greedy:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "greedy:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        GREEDY_OBSERVATION_KEY,
        "greedy-config:" + configFingerprint,
      ],
    },
  });
}

function inventoryAction(
  config: GreedyConfiguration,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: GreedyProductObservation,
  quantity: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<ActionTarget, { readonly kind: "sku" }> = {
    kind: "sku",
    productId: product.productId,
    skuId: product.skuId,
  };
  return assertValidAction({
    ...reorderSkuB50SupplierX,
    actionId: actionId(
      "action_greedy_" +
        config.objective.toLowerCase() +
        "_inventory_" +
        sanitizeId(product.skuId) +
        "_" +
        quantity +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("inventory.reorder"),
    actionCategory: "inventory",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Greedy " +
      config.objective +
      " reorder " +
      quantity +
      " units of " +
      product.skuId +
      ".",
    target,
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [product.productId],
          skuIds: [product.skuId],
        },
      ],
    },
    parameters: {
      kind: "inventory_reorder",
      reorder: {
        sku: target,
        quantity,
        supplierRelationshipId:
          "supplier:greedy:" + product.skuId.toLowerCase(),
        destinationLocationId: "warehouse:montreal",
        orderPlacementTime: decisionTime,
        leadTimeAssumption: {
          durationSeconds: 14 * 24 * 60 * 60,
          sourceRef: "greedy-config:" + configFingerprint + ":lead-time",
        },
        supplierConstraints: {
          minimumOrderQuantity: 1,
          orderMultiple: 1,
          maximumSupplierQuantity: 100,
        },
      },
    },
    timing: {
      decisionTime,
      requestedStart: { kind: "known", at: decisionTime },
      effectiveStart: { kind: "known", at: decisionTime },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    },
    duration: { kind: "instantaneous" },
    termination: { kind: "fixed_end", at: decisionTime },
    constraints: [],
    preconditions: [],
    intent: {
      statement:
        "Audit the finite inventory candidate using observable sales evidence; frozen simulator incompatibility excludes it from cross-domain greedy selection.",
      intentRef: "greedy:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "greedy:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        GREEDY_OBSERVATION_KEY,
        "greedy-config:" + configFingerprint,
      ],
    },
  });
}

function objectiveProductValue(
  objective: GreedyObjective,
  product: GreedyProductObservation,
): number | null {
  if (objective === "IMMEDIATE_REVENUE") return product.revenueMinor;
  if (objective === "IMMEDIATE_GROSS_PROFIT") {
    return product.grossProfitMinor;
  }
  return product.contributionMinor;
}

function objectiveChannelValue(
  objective: GreedyObjective,
  channel: GreedyChannelObservation,
): number | null {
  if (objective === "IMMEDIATE_REVENUE") {
    return channel.attributedRevenueMinor;
  }
  if (objective === "IMMEDIATE_GROSS_PROFIT") {
    return channel.attributedGrossProfitMinor;
  }
  return channel.attributedContributionMinor;
}

export interface GreedyCandidateAudit {
  readonly candidateId: string;
  readonly domain: GreedyCandidateDomain;
  readonly actionType: string | null;
  readonly targetKey: string;
  readonly parameterKey: string;
  readonly action: Action | null;
  readonly estimatedImmediateReturnMinor: number | null;
  readonly selectable: boolean;
  readonly evidenceStatus: "AVAILABLE" | "MISSING" | "NOT_REQUIRED";
  readonly exclusionReason: string | null;
  readonly estimator: string;
  readonly evidence: OperatorJson;
}

function candidateId(
  actionTypeValue: string,
  targetKeyValue: string,
  parameterKeyValue: string,
): string {
  return (
    "candidate:" +
    actionTypeValue +
    ":" +
    sanitizeId(targetKeyValue) +
    ":" +
    sanitizeId(parameterKeyValue)
  );
}

function actionTypeRank(
  config: GreedyConfiguration,
  candidate: GreedyCandidateAudit,
): number {
  const key = candidate.actionType ?? "no_action";
  const rank = config.candidateActionTypeOrder.indexOf(
    key as GreedyConfiguration["candidateActionTypeOrder"][number],
  );
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function compareCandidates(
  config: GreedyConfiguration,
  left: GreedyCandidateAudit,
  right: GreedyCandidateAudit,
): number {
  const leftScore = left.estimatedImmediateReturnMinor ?? -Infinity;
  const rightScore = right.estimatedImmediateReturnMinor ?? -Infinity;
  if (rightScore !== leftScore) return rightScore - leftScore;

  const leftNoAction = left.domain === "no_op";
  const rightNoAction = right.domain === "no_op";
  if (leftNoAction !== rightNoAction) return leftNoAction ? -1 : 1;

  const typeDelta =
    actionTypeRank(config, left) - actionTypeRank(config, right);
  if (typeDelta !== 0) return typeDelta;

  const targetDelta = left.targetKey.localeCompare(right.targetKey);
  if (targetDelta !== 0) return targetDelta;

  const parameterDelta = left.parameterKey.localeCompare(
    right.parameterKey,
  );
  if (parameterDelta !== 0) return parameterDelta;

  return left.candidateId.localeCompare(right.candidateId);
}

function implementationFingerprint(objective: GreedyObjective): string {
  return operatorFingerprint({
    suiteVersion: GREEDY_OPERATOR_SUITE_VERSION,
    operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorVersion: GREEDY_OPERATOR_VERSION,
    objective,
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint: GREEDY_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: GREEDY_FROZEN_STEP_3_1_COMMIT,
    },
    frozenParentCommit: GREEDY_FROZEN_STEP_3_7_COMMIT,
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    metricSetVersion: GREEDY_METRIC_SET_VERSION,
    simulatorVersion: GREEDY_SIMULATOR_VERSION,
    observationKey: GREEDY_OBSERVATION_KEY,
    candidateGeneration:
      "FINITE_LEGAL_ACTION_SPACE_ENUMERATION_WITH_FROZEN_PARAMETER_GRID",
    noActionScoreMinor: 0,
    missingEvidence: "EXCLUDE_CANDIDATE",
    candidateScoringSeparatedFromEvaluatorScoring: true,
    causality: false,
    uncertaintyAdjustment: false,
    delayedEffects: false,
    substitution: false,
    retentionClv: false,
    crossDomainSecondOrderEffects: false,
    forwardSimulationSearch: false,
    continuousOptimization: false,
    learning: false,
  });
}

export const GREEDY_IMPLEMENTATION_FINGERPRINTS = deepFreezeOperator({
  IMMEDIATE_REVENUE: implementationFingerprint("IMMEDIATE_REVENUE"),
  IMMEDIATE_GROSS_PROFIT: implementationFingerprint(
    "IMMEDIATE_GROSS_PROFIT",
  ),
  IMMEDIATE_CONTRIBUTION: implementationFingerprint(
    "IMMEDIATE_CONTRIBUTION",
  ),
});

export function greedyConfigurationFingerprint(
  config: GreedyConfiguration,
): string {
  return operatorFingerprint({
    ...config,
    frozenParentCommit: GREEDY_FROZEN_STEP_3_7_COMMIT,
    metricSetVersion: GREEDY_METRIC_SET_VERSION,
    simulatorVersion: GREEDY_SIMULATOR_VERSION,
  });
}

function enumerateCandidates(
  config: GreedyConfiguration,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  observation: Extract<ReturnType<typeof parseObservation>, { ok: true }>,
): readonly GreedyCandidateAudit[] {
  const candidates: GreedyCandidateAudit[] = [
    {
      candidateId: "candidate:no_action",
      domain: "no_op",
      actionType: null,
      targetKey: "",
      parameterKey: "",
      action: null,
      estimatedImmediateReturnMinor:
        config.noActionImmediateReturnMinor,
      selectable: true,
      evidenceStatus: "NOT_REQUIRED",
      exclusionReason: null,
      estimator: "NO_ACTION_FIXED_ZERO",
      evidence: {
        immediateReturnMinor: config.noActionImmediateReturnMinor,
      },
    },
  ];

  const advertisingRule = legalRule(input, "advertising.adjust_budget");
  for (const target of legalTargets(
    input,
    "advertising.adjust_budget",
    config.maxTargetsPerActionType,
  )) {
    if (target.kind !== "advertising_channel") continue;
    const channel = observation.channels.get(target.channelId);
    for (const increaseMinor of config.candidateParameterGrid
      .advertisingBudgetIncreaseMinor) {
      const targetKeyValue = targetKey(target);
      const parameterKeyValue = "increase_minor=" + increaseMinor;
      const id = candidateId(
        "advertising.adjust_budget",
        targetKeyValue,
        parameterKeyValue,
      );
      if (channel === undefined || !channel.active) {
        candidates.push({
          candidateId: id,
          domain: "advertising",
          actionType: "advertising.adjust_budget",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action: null,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "CHANNEL_OBSERVATION_MISSING_OR_INACTIVE",
          estimator: config.advertisingEstimator,
          evidence: {},
        });
        continue;
      }
      const objectiveValue = objectiveChannelValue(
        config.objective,
        channel,
      );
      const action = advertisingAction(
        config,
        configFingerprint,
        input,
        channel,
        increaseMinor,
      );
      if (
        advertisingRule === undefined ||
        !targetEligible(advertisingRule, target) ||
        !actionWithinAvailabilityBounds(action, advertisingRule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "advertising",
          actionType: "advertising.adjust_budget",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          estimator: config.advertisingEstimator,
          evidence: {
            currentBudgetMinor: channel.currentBudgetMinor,
          },
        });
        continue;
      }
      if (
        channel.spendMinor === null ||
        channel.spendMinor <= 0 ||
        objectiveValue === null
      ) {
        candidates.push({
          candidateId: id,
          domain: "advertising",
          actionType: "advertising.adjust_budget",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "INSUFFICIENT_ADVERTISING_EVIDENCE",
          estimator: config.advertisingEstimator,
          evidence: {
            spendMinor: channel.spendMinor,
            objectiveValueMinor: objectiveValue,
          },
        });
        continue;
      }
      const score =
        (objectiveValue / channel.spendMinor) * increaseMinor;
      candidates.push({
        candidateId: id,
        domain: "advertising",
        actionType: "advertising.adjust_budget",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        estimatedImmediateReturnMinor: score,
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        estimator: config.advertisingEstimator,
        evidence: {
          spendMinor: channel.spendMinor,
          objectiveValueMinor: objectiveValue,
          observedObjectivePerSpend:
            objectiveValue / channel.spendMinor,
          proposedSpendIncreaseMinor: increaseMinor,
        },
      });
    }
  }

  const pricingRule = legalRule(input, "pricing.adjust_price");
  for (const target of legalTargets(
    input,
    "pricing.adjust_price",
    config.maxTargetsPerActionType,
  )) {
    if (target.kind !== "sku") continue;
    const product = observation.productsBySku.get(target.skuId);
    for (const basisPoints of config.candidateParameterGrid
      .pricingPriceChangeBasisPoints) {
      const targetKeyValue = targetKey(target);
      const parameterKeyValue = "price_change_bps=" + basisPoints;
      const id = candidateId(
        "pricing.adjust_price",
        targetKeyValue,
        parameterKeyValue,
      );
      if (
        product === undefined ||
        !product.active ||
        product.currentPriceMinor === null ||
        product.recentUnits === null
      ) {
        candidates.push({
          candidateId: id,
          domain: "pricing",
          actionType: "pricing.adjust_price",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action: null,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "INSUFFICIENT_PRICING_EVIDENCE",
          estimator: config.pricingEstimator,
          evidence: {},
        });
        continue;
      }
      const action = pricingAction(
        config,
        configFingerprint,
        input,
        product,
        basisPoints,
      );
      if (
        pricingRule === undefined ||
        !targetEligible(pricingRule, target) ||
        !actionWithinAvailabilityBounds(action, pricingRule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "pricing",
          actionType: "pricing.adjust_price",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          estimator: config.pricingEstimator,
          evidence: {},
        });
        continue;
      }
      if (
        action.parameters.kind !== "price_adjustment" ||
        action.parameters.operation.kind !== "SET"
      ) {
        throw new TypeError("greedy pricing action must be SET");
      }
      const priceDelta =
        action.parameters.operation.value.amountMinor -
        product.currentPriceMinor;
      const score = product.recentUnits * priceDelta;
      candidates.push({
        candidateId: id,
        domain: "pricing",
        actionType: "pricing.adjust_price",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        estimatedImmediateReturnMinor: score,
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        estimator: config.pricingEstimator,
        evidence: {
          recentUnits: product.recentUnits,
          currentPriceMinor: product.currentPriceMinor,
          priceDeltaMinor: priceDelta,
          costAssumption: config.pricingCostAssumption,
        },
      });
    }
  }

  const promotionRule = legalRule(input, "promotion.start");
  for (const template of [...config.candidateParameterGrid.promotionTemplates]
    .sort((left, right) =>
      left.promotionId.localeCompare(right.promotionId),
    )
    .slice(0, config.maxTargetsPerActionType)) {
    const product = observation.productsById.get(template.productId);
    const target: Extract<ActionTarget, { readonly kind: "promotion" }> =
      {
        kind: "promotion",
        promotionId: template.promotionId,
      };
    const targetKeyValue = targetKey(target);
    const parameterKeyValue =
      "discount_bps=" + template.discountBasisPoints;
    const id = candidateId(
      "promotion.start",
      targetKeyValue,
      parameterKeyValue,
    );
    if (
      product === undefined ||
      !product.active ||
      !product.available ||
      !product.promotionEligible ||
      product.currentPriceMinor === null ||
      product.recentUnits === null
    ) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action: null,
        estimatedImmediateReturnMinor: null,
        selectable: false,
        evidenceStatus: "MISSING",
        exclusionReason: "INSUFFICIENT_PROMOTION_EVIDENCE",
        estimator: config.promotionEstimator,
        evidence: {},
      });
      continue;
    }
    if (
      promotionRule === undefined ||
      !targetEligible(promotionRule, target)
    ) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action: null,
        estimatedImmediateReturnMinor: null,
        selectable: false,
        evidenceStatus: "AVAILABLE",
        exclusionReason: "PROMOTION_TARGET_NOT_LEGAL",
        estimator: config.promotionEstimator,
        evidence: {},
      });
      continue;
    }
    const action = promotionAction(
      config,
      configFingerprint,
      input,
      product,
      template,
    );
    if (!actionWithinAvailabilityBounds(action, promotionRule)) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        estimatedImmediateReturnMinor: null,
        selectable: false,
        evidenceStatus: "AVAILABLE",
        exclusionReason: "LEGAL_ACTION_BOUND_FAILURE",
        estimator: config.promotionEstimator,
        evidence: {},
      });
      continue;
    }
    const discountPerUnit =
      (product.currentPriceMinor * template.discountBasisPoints) /
      10_000;
    const score = -product.recentUnits * discountPerUnit;
    candidates.push({
      candidateId: id,
      domain: "promotion",
      actionType: "promotion.start",
      targetKey: targetKeyValue,
      parameterKey: parameterKeyValue,
      action,
      estimatedImmediateReturnMinor: score,
      selectable: true,
      evidenceStatus: "AVAILABLE",
      exclusionReason: null,
      estimator: config.promotionEstimator,
      evidence: {
        recentUnits: product.recentUnits,
        currentPriceMinor: product.currentPriceMinor,
        discountBasisPoints: template.discountBasisPoints,
        immediateDiscountCostMinor: -score,
      },
    });
  }

  const merchandisingRule = legalRule(
    input,
    "merchandising.move_product",
  );
  for (const target of legalTargets(
    input,
    "merchandising.move_product",
    config.maxTargetsPerActionType,
  )) {
    if (target.kind !== "product") continue;
    const product = observation.productsById.get(target.productId);
    for (const position of config.candidateParameterGrid
      .merchandisingPositions) {
      const targetKeyValue = targetKey(target);
      const parameterKeyValue = "position=" + position;
      const id = candidateId(
        "merchandising.move_product",
        targetKeyValue,
        parameterKeyValue,
      );
      if (
        product === undefined ||
        !product.active ||
        !product.available ||
        !product.merchandisingEligible
      ) {
        candidates.push({
          candidateId: id,
          domain: "merchandising",
          actionType: "merchandising.move_product",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action: null,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "PRODUCT_NOT_MERCHANDISING_ELIGIBLE",
          estimator: config.merchandisingEstimator,
          evidence: {},
        });
        continue;
      }
      if (product.currentPosition === position) {
        candidates.push({
          candidateId: id,
          domain: "merchandising",
          actionType: "merchandising.move_product",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action: null,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "ALREADY_AT_TARGET_POSITION",
          estimator: config.merchandisingEstimator,
          evidence: {
            currentPosition: product.currentPosition,
          },
        });
        continue;
      }
      const objectiveValue = objectiveProductValue(
        config.objective,
        product,
      );
      const action = merchandisingAction(
        config,
        configFingerprint,
        input,
        product,
        position,
      );
      if (
        merchandisingRule === undefined ||
        !targetEligible(merchandisingRule, target) ||
        !actionWithinAvailabilityBounds(action, merchandisingRule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "merchandising",
          actionType: "merchandising.move_product",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          estimator: config.merchandisingEstimator,
          evidence: {},
        });
        continue;
      }
      if (objectiveValue === null) {
        candidates.push({
          candidateId: id,
          domain: "merchandising",
          actionType: "merchandising.move_product",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "MISSING_MERCHANDISING_OBJECTIVE_EVIDENCE",
          estimator: config.merchandisingEstimator,
          evidence: {},
        });
        continue;
      }
      candidates.push({
        candidateId: id,
        domain: "merchandising",
        actionType: "merchandising.move_product",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        estimatedImmediateReturnMinor: objectiveValue,
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        estimator: config.merchandisingEstimator,
        evidence: {
          observedTrailingObjectiveMinor: objectiveValue,
          currentPosition: product.currentPosition,
          proposedPosition: position,
        },
      });
    }
  }

  const inventoryRule = legalRule(input, "inventory.reorder");
  for (const target of legalTargets(
    input,
    "inventory.reorder",
    config.maxTargetsPerActionType,
  )) {
    if (target.kind !== "sku") continue;
    const product = observation.productsBySku.get(target.skuId);
    for (const quantity of config.candidateParameterGrid
      .inventoryReorderQuantities) {
      const targetKeyValue = targetKey(target);
      const parameterKeyValue = "reorder_qty=" + quantity;
      const id = candidateId(
        "inventory.reorder",
        targetKeyValue,
        parameterKeyValue,
      );
      if (
        product === undefined ||
        !product.active ||
        product.availableUnits === null ||
        product.pendingReorder === null ||
        product.incomingUnits === null ||
        product.supplierAvailable !== true ||
        product.recentUnits === null ||
        product.revenueMinor === null
      ) {
        candidates.push({
          candidateId: id,
          domain: "inventory",
          actionType: "inventory.reorder",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action: null,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "INSUFFICIENT_INVENTORY_EVIDENCE",
          estimator: config.inventoryEstimator,
          evidence: {},
        });
        continue;
      }
      if (product.pendingReorder || product.incomingUnits > 0) {
        candidates.push({
          candidateId: id,
          domain: "inventory",
          actionType: "inventory.reorder",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action: null,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "PENDING_OR_INCOMING_REPLENISHMENT",
          estimator: config.inventoryEstimator,
          evidence: {},
        });
        continue;
      }
      const action = inventoryAction(
        config,
        configFingerprint,
        input,
        product,
        quantity,
      );
      if (
        inventoryRule === undefined ||
        !targetEligible(inventoryRule, target) ||
        !actionWithinAvailabilityBounds(action, inventoryRule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "inventory",
          actionType: "inventory.reorder",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          estimatedImmediateReturnMinor: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          estimator: config.inventoryEstimator,
          evidence: {},
        });
        continue;
      }
      const revenuePerUnit =
        product.recentUnits > 0
          ? product.revenueMinor / product.recentUnits
          : null;
      const score =
        revenuePerUnit === null
          ? null
          : revenuePerUnit *
            Math.min(quantity, product.recentUnits);
      candidates.push({
        candidateId: id,
        domain: "inventory",
        actionType: "inventory.reorder",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        estimatedImmediateReturnMinor: score,
        selectable: false,
        evidenceStatus:
          score === null ? "MISSING" : "AVAILABLE",
        exclusionReason:
          "FROZEN_SIMULATOR_INVENTORY_ACTIONS_UNSUPPORTED",
        estimator: config.inventoryEstimator,
        evidence: {
          recentUnits: product.recentUnits,
          revenueMinor: product.revenueMinor,
          revenuePerUnitMinor: revenuePerUnit,
          fixedReorderQuantity: quantity,
          simulatorSupport: config.inventorySelectionSupport,
        },
      });
    }
  }

  const stable = [...candidates].sort((left, right) => {
    const typeDelta =
      actionTypeRank(config, left) - actionTypeRank(config, right);
    if (typeDelta !== 0) return typeDelta;
    const targetDelta = left.targetKey.localeCompare(right.targetKey);
    if (targetDelta !== 0) return targetDelta;
    const parameterDelta = left.parameterKey.localeCompare(
      right.parameterKey,
    );
    if (parameterDelta !== 0) return parameterDelta;
    return left.candidateId.localeCompare(right.candidateId);
  });

  if (stable.length > config.maximumCandidateCount) {
    throw new TypeError(
      "greedy candidate enumeration exceeds frozen maximumCandidateCount",
    );
  }

  return deepFreezeOperator(stable);
}

function evaluate(
  config: GreedyConfiguration,
  input: Readonly<OperatorDecisionInput>,
): {
  readonly actions: readonly Action[];
  readonly audit: OperatorJson;
} {
  const configFingerprint = greedyConfigurationFingerprint(config);
  const implementation =
    GREEDY_IMPLEMENTATION_FINGERPRINTS[config.objective];
  const parsed = parseObservation(input, config);

  if (!parsed.ok) {
    return deepFreezeOperator({
      actions: [],
      audit: {
        objective: config.objective,
        objectiveMetricId: config.objectiveMetricId,
        operatorId: OPERATOR_IDS[config.objective],
        operatorVersion: GREEDY_OPERATOR_VERSION,
        implementationFingerprint: implementation,
        configurationFingerprint: configFingerprint,
        configuration: config as unknown as OperatorJson,
        observationStatus: parsed.reason,
        candidateSet: [],
        excludedCandidates: [],
        candidateRanking: [],
        selectedCandidateId: "candidate:no_action",
        selectedActionId: null,
        selectedImmediateReturnMinor:
          config.noActionImmediateReturnMinor,
        noActionImmediateReturnMinor:
          config.noActionImmediateReturnMinor,
        tieBreakDecisions: [],
        fallbackReason: parsed.reason,
        candidateScoringSeparatedFromEvaluationScoring: true,
        dependencies: {
          evaluationContractFingerprint:
            GREEDY_SUPPORTED_CONTRACT_FINGERPRINT,
          evaluationContractFrozenCommit:
            GREEDY_FROZEN_STEP_3_1_COMMIT,
          frozenParentCommit: GREEDY_FROZEN_STEP_3_7_COMMIT,
          actionOntologyVersion: ACTION_SCHEMA_VERSION,
          metricSetVersion: GREEDY_METRIC_SET_VERSION,
          simulatorVersion: GREEDY_SIMULATOR_VERSION,
        },
      } as OperatorJson,
    });
  }

  const candidates = enumerateCandidates(
    config,
    configFingerprint,
    input,
    parsed,
  );
  const selectable = candidates
    .filter(
      (candidate) =>
        candidate.selectable &&
        candidate.estimatedImmediateReturnMinor !== null,
    )
    .sort((left, right) =>
      compareCandidates(config, left, right),
    );

  if (selectable.length === 0) {
    throw new TypeError("greedy candidate set must contain no-action");
  }

  const selected = selectable[0]!;
  const actions =
    selected.domain === "no_op" || selected.action === null
      ? []
      : [selected.action];

  const ranked = [...selectable].map((candidate, index) => ({
    rank: index + 1,
    candidateId: candidate.candidateId,
    estimatedImmediateReturnMinor:
      candidate.estimatedImmediateReturnMinor,
    actionType: candidate.actionType,
    targetKey: candidate.targetKey,
    parameterKey: candidate.parameterKey,
  }));

  const tieBreakDecisions: string[] = [];
  for (let index = 1; index < selectable.length; index += 1) {
    const prior = selectable[index - 1]!;
    const current = selectable[index]!;
    if (
      prior.estimatedImmediateReturnMinor ===
      current.estimatedImmediateReturnMinor
    ) {
      tieBreakDecisions.push(
        "TIE:" +
          prior.candidateId +
          ":" +
          current.candidateId +
          ":" +
          config.tieBreakRule,
      );
    }
  }

  const excluded = candidates
    .filter((candidate) => !candidate.selectable)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      actionType: candidate.actionType,
      targetKey: candidate.targetKey,
      parameterKey: candidate.parameterKey,
      estimatedImmediateReturnMinor:
        candidate.estimatedImmediateReturnMinor,
      evidenceStatus: candidate.evidenceStatus,
      exclusionReason: candidate.exclusionReason,
    }));

  return deepFreezeOperator({
    actions,
    audit: {
      objective: config.objective,
      objectiveMetricId: config.objectiveMetricId,
      objectiveDefinition: config.objectiveDefinition,
      population: config.population,
      scope: config.scope,
      currency: config.currency,
      lookbackDays: config.lookbackDays,
      operatorId: OPERATOR_IDS[config.objective],
      operatorVersion: GREEDY_OPERATOR_VERSION,
      implementationFingerprint: implementation,
      configurationFingerprint: configFingerprint,
      configuration: config as unknown as OperatorJson,
      observationStatus: "AVAILABLE",
      observationWindow: {
        start: parsed.payload.windowStart,
        end: parsed.payload.windowEnd,
      },
      legalActionSpaceFingerprint: operatorFingerprint(
        input.legalActionSpace as unknown as OperatorJson,
      ),
      candidateSet: candidates as unknown as OperatorJson,
      excludedCandidates: excluded,
      candidateRanking: ranked,
      selectedCandidateId: selected.candidateId,
      selectedActionId:
        selected.action === null
          ? null
          : String(selected.action.actionId),
      selectedImmediateReturnMinor:
        selected.estimatedImmediateReturnMinor,
      noActionImmediateReturnMinor:
        config.noActionImmediateReturnMinor,
      tieBreakDecisions,
      candidateScoringSeparatedFromEvaluationScoring: true,
      evaluatorOutcomeMetricUsedInDecision: false,
      ignoredConsequences: [
        "causality",
        "uncertainty",
        "delayed_effects",
        "substitution",
        "cannibalization",
        "retention",
        "clv",
        "cross_domain_second_order_effects",
      ],
      simulatorQualification:
        "inventory.reorder candidates may be audited but are excluded from selection because the frozen simulator cannot execute inventory reorder semantics faithfully",
      dependencies: {
        evaluationContractFingerprint:
          GREEDY_SUPPORTED_CONTRACT_FINGERPRINT,
        evaluationContractFrozenCommit:
          GREEDY_FROZEN_STEP_3_1_COMMIT,
        frozenParentCommit: GREEDY_FROZEN_STEP_3_7_COMMIT,
        actionOntologyVersion: ACTION_SCHEMA_VERSION,
        metricSetVersion: GREEDY_METRIC_SET_VERSION,
        simulatorVersion: GREEDY_SIMULATOR_VERSION,
      },
    } as OperatorJson,
  });
}

export function createGreedyOperator(
  config: GreedyConfiguration,
): CanonicalOperator {
  const configurationFingerprint =
    greedyConfigurationFingerprint(config);
  const implementation =
    GREEDY_IMPLEMENTATION_FINGERPRINTS[config.objective];

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: OPERATOR_IDS[config.objective],
    operatorType: "baseline",
    operatorVersion: GREEDY_OPERATOR_VERSION,
    description: DESCRIPTIONS[config.objective],
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint: GREEDY_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: GREEDY_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      suiteVersion: GREEDY_OPERATOR_SUITE_VERSION,
      objective: config.objective,
      objectiveMetricId: config.objectiveMetricId,
      configurationFingerprint,
      configuration: config as unknown as OperatorJson,
      metricSetVersion: GREEDY_METRIC_SET_VERSION,
      simulatorVersion: GREEDY_SIMULATOR_VERSION,
      frozenParentCommit: GREEDY_FROZEN_STEP_3_7_COMMIT,
      candidateScoringSeparatedFromEvaluationScoring: true,
      forwardSimulationSearch: false,
      continuousOptimization: false,
      causalCorrection: false,
      uncertaintyAdjustment: false,
      delayedEffectAdjustment: false,
      substitutionAdjustment: false,
      retentionClvAdjustment: false,
      learning: false,
      hiddenStateAccess: false,
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
          "greedy operator audit does not match decision output",
        );
      }
      return {
        auditType: "greedy_candidate_evaluation",
        payload: decision.audit,
      };
    },
  });
}

export const GREEDY_IMMEDIATE_REVENUE_OPERATOR =
  createGreedyOperator(GREEDY_IMMEDIATE_REVENUE_CONFIG);

export const GREEDY_IMMEDIATE_GROSS_PROFIT_OPERATOR =
  createGreedyOperator(GREEDY_IMMEDIATE_GROSS_PROFIT_CONFIG);

export const GREEDY_IMMEDIATE_CONTRIBUTION_OPERATOR =
  createGreedyOperator(GREEDY_IMMEDIATE_CONTRIBUTION_CONFIG);

export const GREEDY_BASELINE_OPERATORS = deepFreezeOperator({
  IMMEDIATE_REVENUE: GREEDY_IMMEDIATE_REVENUE_OPERATOR,
  IMMEDIATE_GROSS_PROFIT:
    GREEDY_IMMEDIATE_GROSS_PROFIT_OPERATOR,
  IMMEDIATE_CONTRIBUTION:
    GREEDY_IMMEDIATE_CONTRIBUTION_OPERATOR,
});
