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

export const FLAWED_OPTIMIZER_SUITE_VERSION = "1.0.0" as const;
export const FLAWED_OPTIMIZER_OPERATOR_VERSION = "1.0.0" as const;
export const FLAWED_OPTIMIZER_CONFIGURATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const FLAWED_OPTIMIZER_OBSERVATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const FLAWED_OPTIMIZER_OBSERVATION_KEY =
  "flawed_optimizer.kpi_evidence.v1" as const;

export const FLAWED_OPTIMIZER_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT =
  "5a461df3c962f22fbae9a1fcc5b4d39a3f1e5bae" as const;
export const FLAWED_OPTIMIZER_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;
export const FLAWED_OPTIMIZER_METRIC_SET_VERSION = "1.0.0" as const;
export const FLAWED_OPTIMIZER_SIMULATOR_VERSION =
  "customer-journey-simulator-4.0.0" as const;
export const FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION =
  "ecommerce-economics-7.0.0" as const;
export const FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION =
  "product-economics-8.0.0" as const;

export type FlawedOptimizerObjective =
  | "MAX_ROAS"
  | "MIN_CAC"
  | "MAX_REVENUE"
  | "BEST_SELLER_PUSH"
  | "LOWEST_CPA"
  | "HIGHEST_CONVERSION_RATE";

export type FlawedOptimizerDomain =
  | "no_op"
  | "advertising"
  | "pricing"
  | "promotion"
  | "merchandising";

export interface FlawedChannelObservation {
  readonly channelId: string;
  readonly active: boolean;
  readonly currentBudgetMinor: number;
  readonly spendMinor: number | null;
  readonly attributedRevenueMinor: number | null;
  readonly representedNewCustomers: number | null;
  readonly representedPurchaseConversions: number | null;
}

export interface FlawedProductObservation {
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
  readonly unitsSold: number | null;
  readonly conversions: number | null;
  readonly productViews: number | null;
  readonly currentPosition: number | null;
}

export interface FlawedOptimizerObservationPayload {
  readonly schemaVersion:
    typeof FLAWED_OPTIMIZER_OBSERVATION_SCHEMA_VERSION;
  readonly currency: "CAD";
  readonly lookbackDays: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly channels: readonly FlawedChannelObservation[];
  readonly products: readonly FlawedProductObservation[];
}

export interface FlawedPromotionTemplate {
  readonly promotionId: string;
  readonly productId: string;
  readonly skuId: string;
  readonly discountBasisPoints: number;
  readonly durationSeconds: number;
}

export interface FlawedOptimizerConfig {
  readonly configurationSchemaVersion:
    typeof FLAWED_OPTIMIZER_CONFIGURATION_SCHEMA_VERSION;
  readonly objective: FlawedOptimizerObjective;
  readonly objectiveMetricId:
    | "observed_roas"
    | "observed_cac_minor"
    | "estimated_short_term_revenue_minor"
    | "observed_units_sold"
    | "observed_cpa_minor"
    | "observed_conversion_rate";
  readonly objectiveDirection: "MAXIMIZE" | "MINIMIZE";
  readonly rankingTransform:
    | "IDENTITY_HIGHER_IS_BETTER"
    | "RECIPROCAL_ONE_PLUS_KPI_LOWER_IS_BETTER";
  readonly objectiveDefinition: string;
  readonly scope: string;
  readonly population: string;
  readonly currency: "CAD";
  readonly lookbackDays: 7;
  readonly minimumEvidence: {
    readonly minimumSpendMinor: 1;
    readonly minimumNewCustomers: 1;
    readonly minimumPurchaseConversions: 1;
    readonly minimumProductViews: 20;
  };
  readonly observationKey:
    typeof FLAWED_OPTIMIZER_OBSERVATION_KEY;
  readonly eligibleActionDomains: readonly FlawedOptimizerDomain[];
  readonly candidateActionTypeOrder: readonly [
    "no_action",
    "advertising.adjust_budget",
    "pricing.adjust_price",
    "promotion.start",
    "merchandising.move_product",
  ];
  readonly candidateParameterGrid: {
    readonly advertisingBudgetIncreaseMinor: readonly [100000];
    readonly pricingPriceChangeBasisPoints: readonly [-1000, 500];
    readonly promotionTemplates: readonly FlawedPromotionTemplate[];
    readonly merchandisingPositions: readonly [1];
  };
  readonly maxTargetsPerActionType: 8;
  readonly maximumCandidateCount: 64;
  readonly noActionRankingScore: 0;
  readonly missingDataBehavior: "EXCLUDE_CANDIDATE";
  readonly tieBreakRule:
    "RANKING_SCORE_DESC_NO_ACTION_FIRST_ACTION_TYPE_ORDER_TARGET_ASC_PARAMETER_ASC";
  readonly causalityCorrection: false;
  readonly uncertaintyAdjustment: false;
  readonly delayedEffectAdjustment: false;
  readonly substitutionAdjustment: false;
  readonly retentionClvAdjustment: false;
  readonly profitSubstitution: false;
}

const COMMON_CONFIG = {
  configurationSchemaVersion:
    FLAWED_OPTIMIZER_CONFIGURATION_SCHEMA_VERSION,
  currency: "CAD",
  lookbackDays: 7,
  minimumEvidence: {
    minimumSpendMinor: 1,
    minimumNewCustomers: 1,
    minimumPurchaseConversions: 1,
    minimumProductViews: 20,
  },
  observationKey: FLAWED_OPTIMIZER_OBSERVATION_KEY,
  candidateActionTypeOrder: [
    "no_action",
    "advertising.adjust_budget",
    "pricing.adjust_price",
    "promotion.start",
    "merchandising.move_product",
  ],
  candidateParameterGrid: {
    advertisingBudgetIncreaseMinor: [100000],
    pricingPriceChangeBasisPoints: [-1000, 500],
    promotionTemplates: [
      {
        promotionId: "promo_flawed_product_a_10pct",
        productId: "product:A",
        skuId: "sku:A",
        discountBasisPoints: 1000,
        durationSeconds: 7 * 24 * 60 * 60,
      },
      {
        promotionId: "promo_flawed_product_b_10pct",
        productId: "product:B",
        skuId: "sku:B",
        discountBasisPoints: 1000,
        durationSeconds: 7 * 24 * 60 * 60,
      },
    ],
    merchandisingPositions: [1],
  },
  maxTargetsPerActionType: 8,
  maximumCandidateCount: 64,
  noActionRankingScore: 0,
  missingDataBehavior: "EXCLUDE_CANDIDATE",
  tieBreakRule:
    "RANKING_SCORE_DESC_NO_ACTION_FIRST_ACTION_TYPE_ORDER_TARGET_ASC_PARAMETER_ASC",
  causalityCorrection: false,
  uncertaintyAdjustment: false,
  delayedEffectAdjustment: false,
  substitutionAdjustment: false,
  retentionClvAdjustment: false,
  profitSubstitution: false,
} as const;

export const MAX_ROAS_CONFIG: FlawedOptimizerConfig =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "MAX_ROAS",
    objectiveMetricId: "observed_roas",
    objectiveDirection: "MAXIMIZE",
    rankingTransform: "IDENTITY_HIGHER_IS_BETTER",
    objectiveDefinition:
      "ATTRIBUTED_REVENUE_MINOR_DIVIDED_BY_OBSERVED_ADVERTISING_SPEND_MINOR",
    scope: "ADVERTISING_CHANNEL",
    population: "ACTIVE_LEGAL_ADVERTISING_CHANNELS",
    eligibleActionDomains: ["no_op", "advertising"],
  });

export const MIN_CAC_CONFIG: FlawedOptimizerConfig =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "MIN_CAC",
    objectiveMetricId: "observed_cac_minor",
    objectiveDirection: "MINIMIZE",
    rankingTransform:
      "RECIPROCAL_ONE_PLUS_KPI_LOWER_IS_BETTER",
    objectiveDefinition:
      "OBSERVED_ACQUISITION_SPEND_MINOR_DIVIDED_BY_REPRESENTED_NEW_CUSTOMERS",
    scope: "ADVERTISING_CHANNEL",
    population:
      "CANONICAL_NEW_CUSTOMERS_FIRST_REALIZED_ORDER_IN_LOOKBACK",
    eligibleActionDomains: ["no_op", "advertising"],
  });

export const MAX_REVENUE_CONFIG: FlawedOptimizerConfig =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "MAX_REVENUE",
    objectiveMetricId: "estimated_short_term_revenue_minor",
    objectiveDirection: "MAXIMIZE",
    rankingTransform: "IDENTITY_HIGHER_IS_BETTER",
    objectiveDefinition:
      "NAIVE_OBSERVABLE_IMMEDIATE_REVENUE_ESTIMATE_FOR_CANONICAL_ACTION",
    scope: "ONE_CANONICAL_ACTION_AT_CURRENT_DECISION",
    population:
      "LEGAL_ACTION_TARGETS_WITH_OBSERVABLE_REVENUE_EVIDENCE",
    eligibleActionDomains: [
      "no_op",
      "advertising",
      "pricing",
      "promotion",
      "merchandising",
    ],
  });

export const BEST_SELLER_PUSH_CONFIG: FlawedOptimizerConfig =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "BEST_SELLER_PUSH",
    objectiveMetricId: "observed_units_sold",
    objectiveDirection: "MAXIMIZE",
    rankingTransform: "IDENTITY_HIGHER_IS_BETTER",
    objectiveDefinition:
      "REALIZED_ORDER_LINE_UNITS_SOLD_FOR_PRODUCT_IN_LOOKBACK",
    scope: "PRODUCT_IN_COLLECTION_X",
    population:
      "ACTIVE_AVAILABLE_LEGAL_MERCHANDISING_OR_PROMOTION_PRODUCTS",
    eligibleActionDomains: ["no_op", "merchandising", "promotion"],
  });

export const LOWEST_CPA_CONFIG: FlawedOptimizerConfig =
  deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "LOWEST_CPA",
    objectiveMetricId: "observed_cpa_minor",
    objectiveDirection: "MINIMIZE",
    rankingTransform:
      "RECIPROCAL_ONE_PLUS_KPI_LOWER_IS_BETTER",
    objectiveDefinition:
      "OBSERVED_ADVERTISING_SPEND_MINOR_DIVIDED_BY_REPRESENTED_REALIZED_PURCHASE_CONVERSION_EVENTS",
    scope: "ADVERTISING_CHANNEL",
    population:
      "CONFIGURED_REALIZED_PURCHASE_CONVERSION_EVENTS_IN_LOOKBACK",
    eligibleActionDomains: ["no_op", "advertising"],
  });

export const HIGHEST_CONVERSION_RATE_CONFIG:
  FlawedOptimizerConfig = deepFreezeOperator({
    ...COMMON_CONFIG,
    objective: "HIGHEST_CONVERSION_RATE",
    objectiveMetricId: "observed_conversion_rate",
    objectiveDirection: "MAXIMIZE",
    rankingTransform: "IDENTITY_HIGHER_IS_BETTER",
    objectiveDefinition:
      "REPRESENTED_REALIZED_ORDERS_CONTAINING_PRODUCT_DIVIDED_BY_OBSERVED_PRODUCT_VIEWS",
    scope: "PRODUCT_IN_COLLECTION_X",
    population:
      "ACTIVE_AVAILABLE_PRODUCTS_WITH_AT_LEAST_20_OBSERVED_PRODUCT_VIEWS",
    eligibleActionDomains: ["no_op", "merchandising", "promotion"],
  });

export const FROZEN_FLAWED_OPTIMIZER_CONFIGURATIONS =
  deepFreezeOperator({
    MAX_ROAS: MAX_ROAS_CONFIG,
    MIN_CAC: MIN_CAC_CONFIG,
    MAX_REVENUE: MAX_REVENUE_CONFIG,
    BEST_SELLER_PUSH: BEST_SELLER_PUSH_CONFIG,
    LOWEST_CPA: LOWEST_CPA_CONFIG,
    HIGHEST_CONVERSION_RATE: HIGHEST_CONVERSION_RATE_CONFIG,
  });

const OPERATOR_IDS: Readonly<
  Record<FlawedOptimizerObjective, string>
> = deepFreezeOperator({
  MAX_ROAS: "baseline.flawed.max_roas",
  MIN_CAC: "baseline.flawed.min_cac",
  MAX_REVENUE: "baseline.flawed.max_revenue",
  BEST_SELLER_PUSH: "baseline.flawed.best_seller_push",
  LOWEST_CPA: "baseline.flawed.lowest_cpa",
  HIGHEST_CONVERSION_RATE:
    "baseline.flawed.highest_conversion_rate",
});

const DESCRIPTIONS: Readonly<
  Record<FlawedOptimizerObjective, string>
> = deepFreezeOperator({
  MAX_ROAS:
    "Aggressively favors legal advertising budget increases toward the highest observed attributed ROAS.",
  MIN_CAC:
    "Aggressively favors legal advertising budget increases toward the lowest observed cost per canonical new customer.",
  MAX_REVENUE:
    "Aggressively favors the legal canonical Action with the highest naive observable short-term revenue estimate.",
  BEST_SELLER_PUSH:
    "Aggressively increases exposure to the product with the highest observed realized units sold.",
  LOWEST_CPA:
    "Aggressively favors legal advertising budget increases toward the lowest observed cost per configured realized purchase-conversion event.",
  HIGHEST_CONVERSION_RATE:
    "Aggressively increases exposure to the eligible product with the highest observed orders-per-view conversion rate.",
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
  config: FlawedOptimizerConfig,
):
  | {
      readonly ok: true;
      readonly payload: FlawedOptimizerObservationPayload;
      readonly channels: ReadonlyMap<string, FlawedChannelObservation>;
      readonly productsById: ReadonlyMap<string, FlawedProductObservation>;
      readonly productsBySku: ReadonlyMap<string, FlawedProductObservation>;
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
    value["schemaVersion"] !==
      FLAWED_OPTIMIZER_OBSERVATION_SCHEMA_VERSION ||
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

  const channels: FlawedChannelObservation[] = [];
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
        raw["representedNewCustomers"] === null ||
        finiteNonNegative(raw["representedNewCustomers"])
      ) ||
      !(
        raw["representedPurchaseConversions"] === null ||
        finiteNonNegative(raw["representedPurchaseConversions"])
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
      representedNewCustomers: raw["representedNewCustomers"],
      representedPurchaseConversions:
        raw["representedPurchaseConversions"],
    });
  }

  const products: FlawedProductObservation[] = [];
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
        raw["unitsSold"] === null ||
        finiteNonNegative(raw["unitsSold"])
      ) ||
      !(
        raw["conversions"] === null ||
        finiteNonNegative(raw["conversions"])
      ) ||
      !(
        raw["productViews"] === null ||
        finiteNonNegative(raw["productViews"])
      ) ||
      !(
        raw["currentPosition"] === null ||
        (Number.isInteger(raw["currentPosition"]) &&
          Number(raw["currentPosition"]) > 0)
      )
    ) {
      return { ok: false, reason: "PRODUCT_OBSERVATION_INVALID" };
    }
    if (productIds.has(raw["productId"]) || skuIds.has(raw["skuId"])) {
      return {
        ok: false,
        reason: "DUPLICATE_PRODUCT_OR_SKU_OBSERVATION",
      };
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
      unitsSold: raw["unitsSold"],
      conversions: raw["conversions"],
      productViews: raw["productViews"],
      currentPosition: raw["currentPosition"] as number | null,
    });
  }

  const payload: FlawedOptimizerObservationPayload = {
    schemaVersion: FLAWED_OPTIMIZER_OBSERVATION_SCHEMA_VERSION,
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
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  channel: FlawedChannelObservation,
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
      "action_flawed_" +
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
      config.objective +
      " increase " +
      channel.channelId +
      " weekly budget by " +
      increaseMinor +
      " minor units.",
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
        "Aggressively optimize the frozen observable KPI while deliberately ignoring broader business value.",
      intentRef: "flawed-optimizer:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "flawed-optimizer:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        FLAWED_OPTIMIZER_OBSERVATION_KEY,
        "flawed-config:" + configFingerprint,
      ],
    },
  });
}

function pricingAction(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: FlawedProductObservation,
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
      "action_flawed_" +
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
        "Aggressively optimize observable short-term revenue without protecting margin or long-term value.",
      intentRef: "flawed-optimizer:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "flawed-optimizer:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        FLAWED_OPTIMIZER_OBSERVATION_KEY,
        "flawed-config:" + configFingerprint,
      ],
    },
  });
}

function promotionAction(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: FlawedProductObservation,
  template: FlawedPromotionTemplate,
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
      "action_flawed_" +
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
        "Increase exposure for the observable KPI leader without broader business-value correction.",
      intentRef: "flawed-optimizer:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "flawed-optimizer:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        FLAWED_OPTIMIZER_OBSERVATION_KEY,
        "flawed-config:" + configFingerprint,
      ],
    },
  });
}

function merchandisingAction(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: FlawedProductObservation,
  position: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(
      "action_flawed_" +
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
        "Increase exposure for the product with the strongest frozen observable KPI.",
      intentRef: "flawed-optimizer:" + config.objective,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "flawed-optimizer:" +
        config.objective +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        FLAWED_OPTIMIZER_OBSERVATION_KEY,
        "flawed-config:" + configFingerprint,
      ],
    },
  });
}

export interface FlawedCandidateAudit {
  readonly candidateId: string;
  readonly domain: FlawedOptimizerDomain;
  readonly actionType: string | null;
  readonly targetKey: string;
  readonly parameterKey: string;
  readonly action: Action | null;
  readonly kpiValue: number | null;
  readonly rankingScore: number | null;
  readonly selectable: boolean;
  readonly evidenceStatus: "AVAILABLE" | "MISSING" | "NOT_REQUIRED";
  readonly exclusionReason: string | null;
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

function rankingScore(
  config: FlawedOptimizerConfig,
  kpiValue: number,
): number {
  if (
    config.rankingTransform === "IDENTITY_HIGHER_IS_BETTER"
  ) {
    return kpiValue;
  }
  if (kpiValue < 0) {
    throw new TypeError("minimization KPI cannot be negative");
  }
  return 1 / (1 + kpiValue);
}

function actionTypeRank(
  config: FlawedOptimizerConfig,
  candidate: FlawedCandidateAudit,
): number {
  const key = candidate.actionType ?? "no_action";
  const rank = config.candidateActionTypeOrder.indexOf(
    key as FlawedOptimizerConfig["candidateActionTypeOrder"][number],
  );
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function compareCandidates(
  config: FlawedOptimizerConfig,
  left: FlawedCandidateAudit,
  right: FlawedCandidateAudit,
): number {
  const leftScore = left.rankingScore ?? -Infinity;
  const rightScore = right.rankingScore ?? -Infinity;
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

function implementationFingerprint(
  objective: FlawedOptimizerObjective,
): string {
  return operatorFingerprint({
    suiteVersion: FLAWED_OPTIMIZER_SUITE_VERSION,
    operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorVersion: FLAWED_OPTIMIZER_OPERATOR_VERSION,
    objective,
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        FLAWED_OPTIMIZER_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: FLAWED_OPTIMIZER_FROZEN_STEP_3_1_COMMIT,
    },
    frozenParentCommit: FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    metricSetVersion: FLAWED_OPTIMIZER_METRIC_SET_VERSION,
    ecommerceEconomicsVersion:
      FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION,
    productEconomicsVersion:
      FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION,
    simulatorVersion: FLAWED_OPTIMIZER_SIMULATOR_VERSION,
    observationKey: FLAWED_OPTIMIZER_OBSERVATION_KEY,
    architecture:
      "PERMITTED_OBSERVATIONS_TO_LEGAL_CANDIDATES_TO_SINGLE_KPI_SCORE_TO_RANK_TO_CANONICAL_ACTION",
    causalityCorrection: false,
    uncertaintyAdjustment: false,
    delayedEffects: false,
    substitution: false,
    retentionClv: false,
    profitSubstitution: false,
    learning: false,
    hiddenStateAccess: false,
  });
}

export const FLAWED_OPTIMIZER_IMPLEMENTATION_FINGERPRINTS =
  deepFreezeOperator({
    MAX_ROAS: implementationFingerprint("MAX_ROAS"),
    MIN_CAC: implementationFingerprint("MIN_CAC"),
    MAX_REVENUE: implementationFingerprint("MAX_REVENUE"),
    BEST_SELLER_PUSH: implementationFingerprint(
      "BEST_SELLER_PUSH",
    ),
    LOWEST_CPA: implementationFingerprint("LOWEST_CPA"),
    HIGHEST_CONVERSION_RATE: implementationFingerprint(
      "HIGHEST_CONVERSION_RATE",
    ),
  });

export function flawedOptimizerConfigurationFingerprint(
  config: FlawedOptimizerConfig,
): string {
  return operatorFingerprint({
    ...config,
    frozenParentCommit: FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
    metricSetVersion: FLAWED_OPTIMIZER_METRIC_SET_VERSION,
    ecommerceEconomicsVersion:
      FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION,
    productEconomicsVersion:
      FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION,
    simulatorVersion: FLAWED_OPTIMIZER_SIMULATOR_VERSION,
  });
}

function enumerateAdvertisingCandidates(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  observation: Extract<ReturnType<typeof parseObservation>, { ok: true }>,
): FlawedCandidateAudit[] {
  const candidates: FlawedCandidateAudit[] = [];
  if (!config.eligibleActionDomains.includes("advertising")) {
    return candidates;
  }
  const rule = legalRule(input, "advertising.adjust_budget");
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
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "CHANNEL_OBSERVATION_MISSING_OR_INACTIVE",
          evidence: {},
        });
        continue;
      }
      const action = advertisingAction(
        config,
        configFingerprint,
        input,
        channel,
        increaseMinor,
      );
      if (
        rule === undefined ||
        !targetEligible(rule, target) ||
        !actionWithinAvailabilityBounds(action, rule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "advertising",
          actionType: "advertising.adjust_budget",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          evidence: {},
        });
        continue;
      }

      let kpi: number | null = null;
      let evidence: OperatorJson = {};
      let missingReason = "MISSING_KPI";

      if (config.objective === "MAX_ROAS") {
        if (
          channel.spendMinor !== null &&
          channel.spendMinor >=
            config.minimumEvidence.minimumSpendMinor &&
          channel.attributedRevenueMinor !== null
        ) {
          kpi =
            channel.attributedRevenueMinor / channel.spendMinor;
          evidence = {
            spendMinor: channel.spendMinor,
            attributedRevenueMinor: channel.attributedRevenueMinor,
          };
        } else {
          missingReason = "INSUFFICIENT_ROAS_EVIDENCE";
        }
      }

      if (config.objective === "MIN_CAC") {
        if (
          channel.spendMinor !== null &&
          channel.representedNewCustomers !== null &&
          channel.representedNewCustomers >=
            config.minimumEvidence.minimumNewCustomers
        ) {
          kpi =
            channel.spendMinor /
            channel.representedNewCustomers;
          evidence = {
            spendMinor: channel.spendMinor,
            representedNewCustomers:
              channel.representedNewCustomers,
            customerPopulation:
              "CANONICAL_NEW_CUSTOMERS_FIRST_REALIZED_ORDER_IN_LOOKBACK",
          };
        } else {
          missingReason = "INSUFFICIENT_CAC_EVIDENCE";
        }
      }

      if (config.objective === "LOWEST_CPA") {
        if (
          channel.spendMinor !== null &&
          channel.representedPurchaseConversions !== null &&
          channel.representedPurchaseConversions >=
            config.minimumEvidence.minimumPurchaseConversions
        ) {
          kpi =
            channel.spendMinor /
            channel.representedPurchaseConversions;
          evidence = {
            spendMinor: channel.spendMinor,
            representedPurchaseConversions:
              channel.representedPurchaseConversions,
            conversionEvent:
              "REPRESENTED_REALIZED_PURCHASE_ORDER",
            population:
              "CONFIGURED_REALIZED_PURCHASE_CONVERSION_EVENTS_IN_LOOKBACK",
          };
        } else {
          missingReason = "INSUFFICIENT_CPA_EVIDENCE";
        }
      }

      if (config.objective === "MAX_REVENUE") {
        if (
          channel.spendMinor !== null &&
          channel.spendMinor >=
            config.minimumEvidence.minimumSpendMinor &&
          channel.attributedRevenueMinor !== null
        ) {
          kpi =
            (channel.attributedRevenueMinor /
              channel.spendMinor) *
            increaseMinor;
          evidence = {
            spendMinor: channel.spendMinor,
            attributedRevenueMinor: channel.attributedRevenueMinor,
            proposedSpendIncreaseMinor: increaseMinor,
            estimator:
              "ATTRIBUTED_REVENUE_PER_SPEND_TIMES_SPEND_INCREASE",
          };
        } else {
          missingReason = "INSUFFICIENT_REVENUE_EVIDENCE";
        }
      }

      if (kpi === null) {
        candidates.push({
          candidateId: id,
          domain: "advertising",
          actionType: "advertising.adjust_budget",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: missingReason,
          evidence,
        });
        continue;
      }

      candidates.push({
        candidateId: id,
        domain: "advertising",
        actionType: "advertising.adjust_budget",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        kpiValue: kpi,
        rankingScore: rankingScore(config, kpi),
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        evidence,
      });
    }
  }
  return candidates;
}

function enumeratePricingCandidates(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  observation: Extract<ReturnType<typeof parseObservation>, { ok: true }>,
): FlawedCandidateAudit[] {
  const candidates: FlawedCandidateAudit[] = [];
  if (
    config.objective !== "MAX_REVENUE" ||
    !config.eligibleActionDomains.includes("pricing")
  ) {
    return candidates;
  }
  const rule = legalRule(input, "pricing.adjust_price");
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
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "INSUFFICIENT_PRICING_REVENUE_EVIDENCE",
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
        rule === undefined ||
        !targetEligible(rule, target) ||
        !actionWithinAvailabilityBounds(action, rule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "pricing",
          actionType: "pricing.adjust_price",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          evidence: {},
        });
        continue;
      }
      if (
        action.parameters.kind !== "price_adjustment" ||
        action.parameters.operation.kind !== "SET"
      ) {
        throw new TypeError("MAX_REVENUE pricing candidate must be SET");
      }
      const priceDelta =
        action.parameters.operation.value.amountMinor -
        product.currentPriceMinor;
      const kpi = product.recentUnits * priceDelta;
      candidates.push({
        candidateId: id,
        domain: "pricing",
        actionType: "pricing.adjust_price",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        kpiValue: kpi,
        rankingScore: rankingScore(config, kpi),
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        evidence: {
          recentUnits: product.recentUnits,
          currentPriceMinor: product.currentPriceMinor,
          immediatePriceDeltaMinor: priceDelta,
          ignoredCosts: [
            "COGS",
            "discount_cost_beyond_price_delta",
            "shipping",
            "returns",
            "long_term_profitability",
            "CLV",
          ],
        },
      });
    }
  }
  return candidates;
}

function productKpi(
  config: FlawedOptimizerConfig,
  product: FlawedProductObservation,
): {
  readonly kpi: number | null;
  readonly reason: string | null;
  readonly evidence: OperatorJson;
} {
  if (config.objective === "BEST_SELLER_PUSH") {
    if (product.unitsSold === null) {
      return {
        kpi: null,
        reason: "MISSING_UNITS_SOLD",
        evidence: {},
      };
    }
    return {
      kpi: product.unitsSold,
      reason: null,
      evidence: {
        unitsSold: product.unitsSold,
        definition: "SUM_REALIZED_ORDER_LINE_QUANTITY",
      },
    };
  }

  if (config.objective === "HIGHEST_CONVERSION_RATE") {
    if (
      product.productViews === null ||
      product.conversions === null ||
      product.productViews <
        config.minimumEvidence.minimumProductViews
    ) {
      return {
        kpi: null,
        reason: "INSUFFICIENT_CONVERSION_RATE_EVIDENCE",
        evidence: {
          productViews: product.productViews,
          conversions: product.conversions,
          minimumProductViews:
            config.minimumEvidence.minimumProductViews,
        },
      };
    }
    return {
      kpi:
        product.productViews > 0
          ? product.conversions / product.productViews
          : null,
      reason:
        product.productViews > 0
          ? null
          : "ZERO_CONVERSION_DENOMINATOR",
      evidence: {
        productViews: product.productViews,
        conversions: product.conversions,
        numerator:
          "REPRESENTED_REALIZED_ORDERS_CONTAINING_PRODUCT",
        denominator: "OBSERVED_PRODUCT_VIEWS",
      },
    };
  }

  if (config.objective === "MAX_REVENUE") {
    if (product.revenueMinor === null) {
      return {
        kpi: null,
        reason: "MISSING_PRODUCT_REVENUE",
        evidence: {},
      };
    }
    return {
      kpi: product.revenueMinor,
      reason: null,
      evidence: {
        revenueMinor: product.revenueMinor,
        ignoredProfitability: true,
      },
    };
  }

  return {
    kpi: null,
    reason: "PRODUCT_DOMAIN_NOT_USED_BY_OBJECTIVE",
    evidence: {},
  };
}

function enumeratePromotionCandidates(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  observation: Extract<ReturnType<typeof parseObservation>, { ok: true }>,
): FlawedCandidateAudit[] {
  const candidates: FlawedCandidateAudit[] = [];
  if (!config.eligibleActionDomains.includes("promotion")) {
    return candidates;
  }
  const rule = legalRule(input, "promotion.start");
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
      !product.promotionEligible
    ) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action: null,
        kpiValue: null,
        rankingScore: null,
        selectable: false,
        evidenceStatus: "MISSING",
        exclusionReason: "PRODUCT_NOT_PROMOTION_ELIGIBLE",
        evidence: {},
      });
      continue;
    }

    if (
      rule === undefined ||
      !targetEligible(rule, target)
    ) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action: null,
        kpiValue: null,
        rankingScore: null,
        selectable: false,
        evidenceStatus: "AVAILABLE",
        exclusionReason: "PROMOTION_TARGET_NOT_LEGAL",
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
    if (!actionWithinAvailabilityBounds(action, rule)) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        kpiValue: null,
        rankingScore: null,
        selectable: false,
        evidenceStatus: "AVAILABLE",
        exclusionReason: "LEGAL_ACTION_BOUND_FAILURE",
        evidence: {},
      });
      continue;
    }

    if (config.objective === "MAX_REVENUE") {
      if (
        product.currentPriceMinor === null ||
        product.recentUnits === null
      ) {
        candidates.push({
          candidateId: id,
          domain: "promotion",
          actionType: "promotion.start",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "INSUFFICIENT_PROMOTION_REVENUE_EVIDENCE",
          evidence: {},
        });
        continue;
      }
      const immediateDiscountCost =
        product.recentUnits *
        ((product.currentPriceMinor *
          template.discountBasisPoints) /
          10_000);
      const kpi = -immediateDiscountCost;
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        kpiValue: kpi,
        rankingScore: rankingScore(config, kpi),
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        evidence: {
          recentUnits: product.recentUnits,
          currentPriceMinor: product.currentPriceMinor,
          discountBasisPoints: template.discountBasisPoints,
          immediateRevenueEffectMinor: kpi,
          demandLiftAssumption: "NONE",
        },
      });
      continue;
    }

    const metric = productKpi(config, product);
    if (metric.kpi === null) {
      candidates.push({
        candidateId: id,
        domain: "promotion",
        actionType: "promotion.start",
        targetKey: targetKeyValue,
        parameterKey: parameterKeyValue,
        action,
        kpiValue: null,
        rankingScore: null,
        selectable: false,
        evidenceStatus: "MISSING",
        exclusionReason: metric.reason,
        evidence: metric.evidence,
      });
      continue;
    }
    candidates.push({
      candidateId: id,
      domain: "promotion",
      actionType: "promotion.start",
      targetKey: targetKeyValue,
      parameterKey: parameterKeyValue,
      action,
      kpiValue: metric.kpi,
      rankingScore: rankingScore(config, metric.kpi),
      selectable: true,
      evidenceStatus: "AVAILABLE",
      exclusionReason: null,
      evidence: metric.evidence,
    });
  }
  return candidates;
}

function enumerateMerchandisingCandidates(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  observation: Extract<ReturnType<typeof parseObservation>, { ok: true }>,
): FlawedCandidateAudit[] {
  const candidates: FlawedCandidateAudit[] = [];
  if (!config.eligibleActionDomains.includes("merchandising")) {
    return candidates;
  }
  const rule = legalRule(input, "merchandising.move_product");
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
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: "PRODUCT_NOT_MERCHANDISING_ELIGIBLE",
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
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "ALREADY_AT_TARGET_POSITION",
          evidence: {},
        });
        continue;
      }

      const action = merchandisingAction(
        config,
        configFingerprint,
        input,
        product,
        position,
      );
      if (
        rule === undefined ||
        !targetEligible(rule, target) ||
        !actionWithinAvailabilityBounds(action, rule)
      ) {
        candidates.push({
          candidateId: id,
          domain: "merchandising",
          actionType: "merchandising.move_product",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "AVAILABLE",
          exclusionReason: "LEGAL_ACTION_BOUND_OR_ELIGIBILITY_FAILURE",
          evidence: {},
        });
        continue;
      }

      const metric = productKpi(config, product);
      if (metric.kpi === null) {
        candidates.push({
          candidateId: id,
          domain: "merchandising",
          actionType: "merchandising.move_product",
          targetKey: targetKeyValue,
          parameterKey: parameterKeyValue,
          action,
          kpiValue: null,
          rankingScore: null,
          selectable: false,
          evidenceStatus: "MISSING",
          exclusionReason: metric.reason,
          evidence: metric.evidence,
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
        kpiValue: metric.kpi,
        rankingScore: rankingScore(config, metric.kpi),
        selectable: true,
        evidenceStatus: "AVAILABLE",
        exclusionReason: null,
        evidence: metric.evidence,
      });
    }
  }
  return candidates;
}

function enumerateCandidates(
  config: FlawedOptimizerConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  observation: Extract<ReturnType<typeof parseObservation>, { ok: true }>,
): readonly FlawedCandidateAudit[] {
  const candidates: FlawedCandidateAudit[] = [
    {
      candidateId: "candidate:no_action",
      domain: "no_op",
      actionType: null,
      targetKey: "",
      parameterKey: "",
      action: null,
      kpiValue: null,
      rankingScore: config.noActionRankingScore,
      selectable: true,
      evidenceStatus: "NOT_REQUIRED",
      exclusionReason: null,
      evidence: {
        noActionRankingScore: config.noActionRankingScore,
      },
    },
    ...enumerateAdvertisingCandidates(
      config,
      configFingerprint,
      input,
      observation,
    ),
    ...enumeratePricingCandidates(
      config,
      configFingerprint,
      input,
      observation,
    ),
    ...enumeratePromotionCandidates(
      config,
      configFingerprint,
      input,
      observation,
    ),
    ...enumerateMerchandisingCandidates(
      config,
      configFingerprint,
      input,
      observation,
    ),
  ];

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
      "flawed optimizer candidate enumeration exceeds frozen maximumCandidateCount",
    );
  }

  return deepFreezeOperator(stable);
}

function evaluate(
  config: FlawedOptimizerConfig,
  input: Readonly<OperatorDecisionInput>,
): {
  readonly actions: readonly Action[];
  readonly audit: OperatorJson;
} {
  const configFingerprint =
    flawedOptimizerConfigurationFingerprint(config);
  const implementation =
    FLAWED_OPTIMIZER_IMPLEMENTATION_FINGERPRINTS[
      config.objective
    ];
  const parsed = parseObservation(input, config);

  if (!parsed.ok) {
    return deepFreezeOperator({
      actions: [],
      audit: {
        objective: config.objective,
        objectiveMetricId: config.objectiveMetricId,
        objectiveDefinition: config.objectiveDefinition,
        operatorId: OPERATOR_IDS[config.objective],
        operatorVersion: FLAWED_OPTIMIZER_OPERATOR_VERSION,
        implementationFingerprint: implementation,
        configurationFingerprint: configFingerprint,
        observationStatus: parsed.reason,
        candidateSet: [],
        candidateRanking: [],
        selectedCandidateId: "candidate:no_action",
        selectedActionId: null,
        selectedKpiValue: null,
        selectedRankingScore: config.noActionRankingScore,
        noActionRankingScore: config.noActionRankingScore,
        fallbackReason: parsed.reason,
        objectiveSeparatedFromEvaluationMetrics: true,
        dependencies: {
          evaluationContractFingerprint:
            FLAWED_OPTIMIZER_SUPPORTED_CONTRACT_FINGERPRINT,
          evaluationContractFrozenCommit:
            FLAWED_OPTIMIZER_FROZEN_STEP_3_1_COMMIT,
          frozenParentCommit:
            FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
          actionOntologyVersion: ACTION_SCHEMA_VERSION,
          metricSetVersion:
            FLAWED_OPTIMIZER_METRIC_SET_VERSION,
          simulatorVersion:
            FLAWED_OPTIMIZER_SIMULATOR_VERSION,
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
        candidate.rankingScore !== null,
    )
    .sort((left, right) =>
      compareCandidates(config, left, right),
    );
  if (selectable.length === 0) {
    throw new TypeError(
      "flawed optimizer candidate set must contain no action",
    );
  }

  const selected = selectable[0]!;
  const actions =
    selected.domain === "no_op" || selected.action === null
      ? []
      : [selected.action];

  const ranking = selectable.map((candidate, index) => ({
    rank: index + 1,
    candidateId: candidate.candidateId,
    kpiValue: candidate.kpiValue,
    rankingScore: candidate.rankingScore,
    actionType: candidate.actionType,
    targetKey: candidate.targetKey,
    parameterKey: candidate.parameterKey,
  }));

  const tieBreakDecisions: string[] = [];
  for (let index = 1; index < selectable.length; index += 1) {
    const prior = selectable[index - 1]!;
    const current = selectable[index]!;
    if (prior.rankingScore === current.rankingScore) {
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

  const excludedCandidates = candidates
    .filter((candidate) => !candidate.selectable)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      actionType: candidate.actionType,
      targetKey: candidate.targetKey,
      parameterKey: candidate.parameterKey,
      kpiValue: candidate.kpiValue,
      rankingScore: candidate.rankingScore,
      evidenceStatus: candidate.evidenceStatus,
      exclusionReason: candidate.exclusionReason,
    }));

  return deepFreezeOperator({
    actions,
    audit: {
      objective: config.objective,
      objectiveMetricId: config.objectiveMetricId,
      objectiveDirection: config.objectiveDirection,
      objectiveDefinition: config.objectiveDefinition,
      scope: config.scope,
      population: config.population,
      currency: config.currency,
      lookbackDays: config.lookbackDays,
      minimumEvidence: config.minimumEvidence,
      operatorId: OPERATOR_IDS[config.objective],
      operatorVersion: FLAWED_OPTIMIZER_OPERATOR_VERSION,
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
      excludedCandidates,
      candidateRanking: ranking,
      tieBreakDecisions,
      selectedCandidateId: selected.candidateId,
      selectedActionId:
        selected.action === null
          ? null
          : String(selected.action.actionId),
      selectedKpiValue: selected.kpiValue,
      selectedRankingScore: selected.rankingScore,
      noActionRankingScore: config.noActionRankingScore,
      objectiveSeparatedFromEvaluationMetrics: true,
      evaluatorOutcomeMetricUsedInDecision: false,
      ignoredBusinessValue: [
        "causality",
        "uncertainty",
        "delayed_effects",
        "substitution",
        "cannibalization",
        "retention",
        "clv",
        "broader_profitability_except_named_kpi",
      ],
      dependencies: {
        evaluationContractFingerprint:
          FLAWED_OPTIMIZER_SUPPORTED_CONTRACT_FINGERPRINT,
        evaluationContractFrozenCommit:
          FLAWED_OPTIMIZER_FROZEN_STEP_3_1_COMMIT,
        frozenParentCommit:
          FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
        actionOntologyVersion: ACTION_SCHEMA_VERSION,
        metricSetVersion:
          FLAWED_OPTIMIZER_METRIC_SET_VERSION,
        ecommerceEconomicsVersion:
          FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION,
        productEconomicsVersion:
          FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION,
        simulatorVersion:
          FLAWED_OPTIMIZER_SIMULATOR_VERSION,
      },
    } as OperatorJson,
  });
}

export function createFlawedOptimizerOperator(
  config: FlawedOptimizerConfig,
): CanonicalOperator {
  const configurationFingerprint =
    flawedOptimizerConfigurationFingerprint(config);
  const implementation =
    FLAWED_OPTIMIZER_IMPLEMENTATION_FINGERPRINTS[
      config.objective
    ];

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: OPERATOR_IDS[config.objective],
    operatorType: "baseline",
    operatorVersion: FLAWED_OPTIMIZER_OPERATOR_VERSION,
    description: DESCRIPTIONS[config.objective],
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        FLAWED_OPTIMIZER_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: FLAWED_OPTIMIZER_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      suiteVersion: FLAWED_OPTIMIZER_SUITE_VERSION,
      objective: config.objective,
      objectiveMetricId: config.objectiveMetricId,
      configurationFingerprint,
      configuration: config as unknown as OperatorJson,
      metricSetVersion: FLAWED_OPTIMIZER_METRIC_SET_VERSION,
      ecommerceEconomicsVersion:
        FLAWED_OPTIMIZER_ECOMMERCE_ECONOMICS_VERSION,
      productEconomicsVersion:
        FLAWED_OPTIMIZER_PRODUCT_ECONOMICS_VERSION,
      simulatorVersion: FLAWED_OPTIMIZER_SIMULATOR_VERSION,
      frozenParentCommit:
        FLAWED_OPTIMIZER_FROZEN_STEP_3_8_COMMIT,
      objectiveSeparatedFromEvaluationMetrics: true,
      causalCorrection: false,
      uncertaintyAdjustment: false,
      delayedEffectAdjustment: false,
      substitutionAdjustment: false,
      retentionClvAdjustment: false,
      profitSubstitution: false,
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
          "flawed optimizer audit does not match decision output",
        );
      }
      return {
        auditType: "flawed_optimizer_candidate_evaluation",
        payload: decision.audit,
      };
    },
  });
}

export const MAX_ROAS_OPERATOR =
  createFlawedOptimizerOperator(MAX_ROAS_CONFIG);
export const MIN_CAC_OPERATOR =
  createFlawedOptimizerOperator(MIN_CAC_CONFIG);
export const MAX_REVENUE_OPERATOR =
  createFlawedOptimizerOperator(MAX_REVENUE_CONFIG);
export const BEST_SELLER_PUSH_OPERATOR =
  createFlawedOptimizerOperator(BEST_SELLER_PUSH_CONFIG);
export const LOWEST_CPA_OPERATOR =
  createFlawedOptimizerOperator(LOWEST_CPA_CONFIG);
export const HIGHEST_CONVERSION_RATE_OPERATOR =
  createFlawedOptimizerOperator(HIGHEST_CONVERSION_RATE_CONFIG);

export const FLAWED_OPTIMIZER_BASELINE_OPERATORS =
  deepFreezeOperator({
    MAX_ROAS: MAX_ROAS_OPERATOR,
    MIN_CAC: MIN_CAC_OPERATOR,
    MAX_REVENUE: MAX_REVENUE_OPERATOR,
    BEST_SELLER_PUSH: BEST_SELLER_PUSH_OPERATOR,
    LOWEST_CPA: LOWEST_CPA_OPERATOR,
    HIGHEST_CONVERSION_RATE:
      HIGHEST_CONVERSION_RATE_OPERATOR,
  });
