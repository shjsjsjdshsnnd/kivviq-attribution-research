import { actionId, actionType } from "../action_ontology/identity.js";
import { setSkuA849Cad } from "../pricing/fixtures.js";
import { startAutomaticCollectionX15FourDays } from "../promotion/fixtures.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionTarget,
  type PromotionDefinition,
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

export const PRICING_PROMOTION_HEURISTIC_SUITE_VERSION = "1.0.0" as const;
export const PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION = "1.0.0" as const;
export const PRICING_PROMOTION_HEURISTIC_CONFIGURATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const PRICING_PROMOTION_HEURISTIC_OBSERVATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY =
  "pricing_promotion.sku_state.v1" as const;

export const PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT =
  "cc6c07d0b1ec152e3548d5b306c0ee7debed6aa3" as const;
export const PRICING_PROMOTION_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;
export const PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION = "1.0.0" as const;
export const PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION =
  "customer-journey-simulator-4.0.0" as const;

export type PricingPromotionHeuristicType =
  | "NEVER_DISCOUNT"
  | "FIXED_DISCOUNT"
  | "EXCESS_INVENTORY_DISCOUNT"
  | "FIXED_PROMOTIONAL_CALENDAR";

export type DiscountOwner =
  | "none"
  | "environment"
  | "status_quo"
  | "merchant_discretionary"
  | "heuristic";

export interface PricingPromotionSkuObservation {
  readonly skuId: string;
  readonly productId: string;
  readonly active: boolean;
  readonly excluded: boolean;
  readonly promotionEligible: boolean | null;
  readonly currency: string;
  readonly currentPriceMinor: number | null;
  readonly regularPriceMinor: number | null;
  readonly currentDiscountBasisPoints: number | null;
  readonly currentDiscountOwner: DiscountOwner | null;
  readonly observableInventoryUnits: number | null;
  readonly activePromotionIds: readonly string[];
  readonly promotionOwners: Readonly<Record<string, Exclude<DiscountOwner, "none">>>;
  readonly activeHeuristicRuleIds: readonly string[];
  readonly heuristicRuleStartedAt: Readonly<Record<string, string>>;
}

export interface PricingPromotionObservationPayload {
  readonly schemaVersion:
    typeof PRICING_PROMOTION_HEURISTIC_OBSERVATION_SCHEMA_VERSION;
  readonly timezone: "UTC";
  readonly skus: readonly PricingPromotionSkuObservation[];
}

interface PricingPromotionHeuristicConfigBase {
  readonly configurationSchemaVersion:
    typeof PRICING_PROMOTION_HEURISTIC_CONFIGURATION_SCHEMA_VERSION;
  readonly heuristicType: PricingPromotionHeuristicType;
  readonly observationKey:
    typeof PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY;
  readonly timezone: "UTC";
  readonly currency: "CAD";
  readonly missingDataBehavior: "NO_NEW_DISCRETIONARY_ACTION";
  readonly unavailableSkuBehavior: "NO_NEW_DISCRETIONARY_ACTION";
  readonly invalidEligibilityBehavior: "NO_NEW_DISCRETIONARY_ACTION";
  readonly ownershipConflictBehavior: "PRESERVE_EXISTING_OWNER_NO_DUPLICATE";
  readonly constraintRejectionBehavior: "RECORD_REJECTION_NO_REPAIR";
  readonly partialFeasibilityBehavior:
    "EXPLICIT_EVALUATOR_MODIFICATION_ONLY";
  readonly regularPriceRestoration:
    "SET_EXPLICIT_OBSERVED_REGULAR_PRICE_NO_DRIFT";
}

export interface NeverDiscountConfig
  extends PricingPromotionHeuristicConfigBase {
  readonly heuristicType: "NEVER_DISCOUNT";
  readonly applicableSkuIds: readonly string[];
  readonly discretionaryDiscountBasisPoints: 0;
  readonly preexistingDiscountSemantics:
    "REMOVE_AT_FIRST_VALID_OPPORTUNITY_IF_OPERATOR_OWNABLE";
  readonly removableOwners: readonly ("merchant_discretionary" | "heuristic")[];
  readonly preserveOwners: readonly ("environment" | "status_quo")[];
}

export interface FixedDiscountConfig
  extends PricingPromotionHeuristicConfigBase {
  readonly heuristicType: "FIXED_DISCOUNT";
  readonly ruleId: string;
  readonly applicableSkuIds: readonly string[];
  readonly excludedSkuIds: readonly string[];
  readonly discountBasisPoints: number;
  readonly startAt: string;
  readonly durationSeconds: number;
  readonly startCondition:
    "AT_OR_AFTER_START_BEFORE_END_IF_NOT_ALREADY_APPLIED";
  readonly stackingSemantics:
    "NO_STACKING_WITH_ACTIVE_NON_HEURISTIC_DISCOUNT_OR_PROMOTION";
  readonly restorationBehavior: "RESTORE_REGULAR_PRICE_AT_END";
}

export interface ExcessInventoryDiscountConfig
  extends PricingPromotionHeuristicConfigBase {
  readonly heuristicType: "EXCESS_INVENTORY_DISCOUNT";
  readonly ruleId: string;
  readonly applicableSkuIds: readonly string[];
  readonly excludedSkuIds: readonly string[];
  readonly excessInventoryThresholdUnits: number;
  readonly thresholdComparison: "GT";
  readonly discountBasisPoints: number;
  readonly restorationThresholdUnits: number;
  readonly restorationComparison: "LTE";
  readonly minimumPromotionDurationSeconds: number;
  readonly stackingSemantics:
    "NO_STACKING_WITH_ACTIVE_NON_HEURISTIC_DISCOUNT_OR_PROMOTION";
  readonly restorationBehavior:
    "RESTORE_REGULAR_PRICE_WHEN_INVENTORY_AT_OR_BELOW_RESTORATION_THRESHOLD_AFTER_MINIMUM_DURATION";
}

export interface PromotionalCalendarEntry {
  readonly entryId: string;
  readonly promotionId: string;
  readonly skuId: string;
  readonly productId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly discountBasisPoints: number;
  readonly stacking: "STACKABLE";
  readonly conflictResolution: "NONE";
}

export interface FixedPromotionalCalendarConfig
  extends PricingPromotionHeuristicConfigBase {
  readonly heuristicType: "FIXED_PROMOTIONAL_CALENDAR";
  readonly calendar: readonly PromotionalCalendarEntry[];
  readonly calendarSemantics: "UTC_EXACT_START_FIXED_DURATION";
  readonly restorationBehavior:
    "PROMOTION_EXPIRY_REVEALS_UNCHANGED_REGULAR_PRICE";
  readonly overlapSemantics:
    "CONFIGURED_CALENDAR_ENTRIES_MAY_STACK";
  readonly conflictSemantics:
    "SAME_PROMOTION_ID_OWNED_BY_OTHER_SOURCE_SKIPS_ENTRY";
  readonly unavailableProductBehavior:
    "NO_NEW_DISCRETIONARY_ACTION";
  readonly ownership:
    "HEURISTIC_OWNS_ONLY_CONFIGURED_PROMOTION_IDS";
}

export type PricingPromotionHeuristicConfig =
  | NeverDiscountConfig
  | FixedDiscountConfig
  | ExcessInventoryDiscountConfig
  | FixedPromotionalCalendarConfig;

const COMMON_CONFIGURATION = {
  configurationSchemaVersion:
    PRICING_PROMOTION_HEURISTIC_CONFIGURATION_SCHEMA_VERSION,
  observationKey: PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY,
  timezone: "UTC",
  currency: "CAD",
  missingDataBehavior: "NO_NEW_DISCRETIONARY_ACTION",
  unavailableSkuBehavior: "NO_NEW_DISCRETIONARY_ACTION",
  invalidEligibilityBehavior: "NO_NEW_DISCRETIONARY_ACTION",
  ownershipConflictBehavior: "PRESERVE_EXISTING_OWNER_NO_DUPLICATE",
  constraintRejectionBehavior: "RECORD_REJECTION_NO_REPAIR",
  partialFeasibilityBehavior: "EXPLICIT_EVALUATOR_MODIFICATION_ONLY",
  regularPriceRestoration:
    "SET_EXPLICIT_OBSERVED_REGULAR_PRICE_NO_DRIFT",
} as const;

export const NEVER_DISCOUNT_CONFIG: NeverDiscountConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "NEVER_DISCOUNT",
    applicableSkuIds: ["sku:A"],
    discretionaryDiscountBasisPoints: 0,
    preexistingDiscountSemantics:
      "REMOVE_AT_FIRST_VALID_OPPORTUNITY_IF_OPERATOR_OWNABLE",
    removableOwners: ["merchant_discretionary", "heuristic"],
    preserveOwners: ["environment", "status_quo"],
  });

export const FIXED_DISCOUNT_CONFIG: FixedDiscountConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "FIXED_DISCOUNT",
    ruleId: "heuristic.fixed_discount.sku_a.v1",
    applicableSkuIds: ["sku:A"],
    excludedSkuIds: [],
    discountBasisPoints: 1000,
    startAt: "2026-10-03T00:00:00.000Z",
    durationSeconds: 7 * 24 * 60 * 60,
    startCondition:
      "AT_OR_AFTER_START_BEFORE_END_IF_NOT_ALREADY_APPLIED",
    stackingSemantics:
      "NO_STACKING_WITH_ACTIVE_NON_HEURISTIC_DISCOUNT_OR_PROMOTION",
    restorationBehavior: "RESTORE_REGULAR_PRICE_AT_END",
  });

export const EXCESS_INVENTORY_DISCOUNT_CONFIG:
  ExcessInventoryDiscountConfig = deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "EXCESS_INVENTORY_DISCOUNT",
    ruleId: "heuristic.excess_inventory_discount.sku_a.v1",
    applicableSkuIds: ["sku:A"],
    excludedSkuIds: [],
    excessInventoryThresholdUnits: 100,
    thresholdComparison: "GT",
    discountBasisPoints: 1500,
    restorationThresholdUnits: 80,
    restorationComparison: "LTE",
    minimumPromotionDurationSeconds: 2 * 24 * 60 * 60,
    stackingSemantics:
      "NO_STACKING_WITH_ACTIVE_NON_HEURISTIC_DISCOUNT_OR_PROMOTION",
    restorationBehavior:
      "RESTORE_REGULAR_PRICE_WHEN_INVENTORY_AT_OR_BELOW_RESTORATION_THRESHOLD_AFTER_MINIMUM_DURATION",
  });

export const FIXED_PROMOTIONAL_CALENDAR_CONFIG:
  FixedPromotionalCalendarConfig = deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "FIXED_PROMOTIONAL_CALENDAR",
    calendar: [
      {
        entryId: "calendar.fall_a",
        promotionId: "promo_heuristic_calendar_fall_a_v1",
        skuId: "sku:A",
        productId: "product:A",
        startAt: "2026-10-05T00:00:00.000Z",
        endAt: "2026-10-09T00:00:00.000Z",
        discountBasisPoints: 1000,
        stacking: "STACKABLE",
        conflictResolution: "NONE",
      },
      {
        entryId: "calendar.overlap_b",
        promotionId: "promo_heuristic_calendar_overlap_b_v1",
        skuId: "sku:A",
        productId: "product:A",
        startAt: "2026-10-07T00:00:00.000Z",
        endAt: "2026-10-11T00:00:00.000Z",
        discountBasisPoints: 1500,
        stacking: "STACKABLE",
        conflictResolution: "NONE",
      },
    ],
    calendarSemantics: "UTC_EXACT_START_FIXED_DURATION",
    restorationBehavior:
      "PROMOTION_EXPIRY_REVEALS_UNCHANGED_REGULAR_PRICE",
    overlapSemantics: "CONFIGURED_CALENDAR_ENTRIES_MAY_STACK",
    conflictSemantics:
      "SAME_PROMOTION_ID_OWNED_BY_OTHER_SOURCE_SKIPS_ENTRY",
    unavailableProductBehavior: "NO_NEW_DISCRETIONARY_ACTION",
    ownership: "HEURISTIC_OWNS_ONLY_CONFIGURED_PROMOTION_IDS",
  });

export const FROZEN_PRICING_PROMOTION_HEURISTIC_CONFIGURATIONS =
  deepFreezeOperator({
    NEVER_DISCOUNT: NEVER_DISCOUNT_CONFIG,
    FIXED_DISCOUNT: FIXED_DISCOUNT_CONFIG,
    EXCESS_INVENTORY_DISCOUNT: EXCESS_INVENTORY_DISCOUNT_CONFIG,
    FIXED_PROMOTIONAL_CALENDAR: FIXED_PROMOTIONAL_CALENDAR_CONFIG,
  });

const OPERATOR_IDS: Readonly<Record<PricingPromotionHeuristicType, string>> =
  deepFreezeOperator({
    NEVER_DISCOUNT: "baseline.pricing.never_discount",
    FIXED_DISCOUNT: "baseline.pricing.fixed_discount",
    EXCESS_INVENTORY_DISCOUNT:
      "baseline.pricing.excess_inventory_discount",
    FIXED_PROMOTIONAL_CALENDAR:
      "baseline.promotion.fixed_promotional_calendar",
  });

const DESCRIPTIONS: Readonly<
  Record<PricingPromotionHeuristicType, string>
> = deepFreezeOperator({
  NEVER_DISCOUNT:
    "Simple pricing control that restores regular price for operator-ownable discretionary discounts and never introduces a new discretionary discount.",
  FIXED_DISCOUNT:
    "Simple pricing baseline that applies a frozen discount to eligible SKUs for a frozen period and restores the observed regular price exactly.",
  EXCESS_INVENTORY_DISCOUNT:
    "Simple inventory-triggered pricing baseline: observable inventory above a frozen threshold receives a frozen discount, with deterministic restoration.",
  FIXED_PROMOTIONAL_CALENDAR:
    "Simple promotion baseline that starts a preregistered calendar of temporary stackable promotions at exact UTC start times regardless of performance.",
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

function parsePromotionOwners(
  value: unknown,
): Readonly<Record<string, Exclude<DiscountOwner, "none">>> | null {
  if (!isRecord(value)) return null;
  const output: Record<string, Exclude<DiscountOwner, "none">> = {};
  for (const [key, owner] of Object.entries(value)) {
    if (
      ![
        "environment",
        "status_quo",
        "merchant_discretionary",
        "heuristic",
      ].includes(String(owner))
    ) {
      return null;
    }
    output[key] = owner as Exclude<DiscountOwner, "none">;
  }
  return output;
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || !Number.isFinite(Date.parse(entry))) {
      return null;
    }
    output[key] = entry;
  }
  return output;
}

function parseObservation(
  input: Readonly<OperatorDecisionInput>,
  config: PricingPromotionHeuristicConfig,
):
  | {
      readonly ok: true;
      readonly payload: PricingPromotionObservationPayload;
      readonly bySku: ReadonlyMap<string, PricingPromotionSkuObservation>;
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
      PRICING_PROMOTION_HEURISTIC_OBSERVATION_SCHEMA_VERSION ||
    value["timezone"] !== config.timezone ||
    !Array.isArray(value["skus"])
  ) {
    return { ok: false, reason: "OBSERVATION_SCHEMA_INVALID" };
  }

  const skus: PricingPromotionSkuObservation[] = [];
  const seen = new Set<string>();
  for (const raw of value["skus"]) {
    if (!isRecord(raw)) {
      return { ok: false, reason: "SKU_OBSERVATION_INVALID" };
    }
    const owners = parsePromotionOwners(raw["promotionOwners"]);
    const ruleStartedAt = parseStringRecord(raw["heuristicRuleStartedAt"]);
    if (
      typeof raw["skuId"] !== "string" ||
      raw["skuId"].trim().length === 0 ||
      typeof raw["productId"] !== "string" ||
      raw["productId"].trim().length === 0 ||
      typeof raw["active"] !== "boolean" ||
      typeof raw["excluded"] !== "boolean" ||
      !(
        raw["promotionEligible"] === null ||
        typeof raw["promotionEligible"] === "boolean"
      ) ||
      raw["currency"] !== config.currency ||
      !(
        raw["currentPriceMinor"] === null ||
        finiteNonNegativeInteger(raw["currentPriceMinor"])
      ) ||
      !(
        raw["regularPriceMinor"] === null ||
        finiteNonNegativeInteger(raw["regularPriceMinor"])
      ) ||
      !(
        raw["currentDiscountBasisPoints"] === null ||
        finiteNonNegativeInteger(raw["currentDiscountBasisPoints"])
      ) ||
      !(
        raw["currentDiscountOwner"] === null ||
        [
          "none",
          "environment",
          "status_quo",
          "merchant_discretionary",
          "heuristic",
        ].includes(String(raw["currentDiscountOwner"]))
      ) ||
      !(
        raw["observableInventoryUnits"] === null ||
        finiteNonNegativeInteger(raw["observableInventoryUnits"])
      ) ||
      !Array.isArray(raw["activePromotionIds"]) ||
      raw["activePromotionIds"].some(
        (entry) => typeof entry !== "string" || entry.trim().length === 0,
      ) ||
      owners === null ||
      !Array.isArray(raw["activeHeuristicRuleIds"]) ||
      raw["activeHeuristicRuleIds"].some(
        (entry) => typeof entry !== "string" || entry.trim().length === 0,
      ) ||
      ruleStartedAt === null
    ) {
      return { ok: false, reason: "SKU_OBSERVATION_INVALID" };
    }
    if (seen.has(raw["skuId"])) {
      return { ok: false, reason: "DUPLICATE_SKU_OBSERVATION" };
    }
    seen.add(raw["skuId"]);
    skus.push({
      skuId: raw["skuId"],
      productId: raw["productId"],
      active: raw["active"],
      excluded: raw["excluded"],
      promotionEligible: raw["promotionEligible"],
      currency: raw["currency"],
      currentPriceMinor: raw["currentPriceMinor"],
      regularPriceMinor: raw["regularPriceMinor"],
      currentDiscountBasisPoints: raw["currentDiscountBasisPoints"],
      currentDiscountOwner:
        raw["currentDiscountOwner"] as DiscountOwner | null,
      observableInventoryUnits: raw["observableInventoryUnits"],
      activePromotionIds: [...raw["activePromotionIds"]],
      promotionOwners: owners,
      activeHeuristicRuleIds: [...raw["activeHeuristicRuleIds"]],
      heuristicRuleStartedAt: ruleStartedAt,
    });
  }

  const payload: PricingPromotionObservationPayload = {
    schemaVersion:
      PRICING_PROMOTION_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
    timezone: config.timezone,
    skus,
  };
  return {
    ok: true,
    payload,
    bySku: new Map(skus.map((sku) => [sku.skuId, sku])),
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

function targetEligible(
  rule: OperatorLegalActionRule | undefined,
  target: ActionTarget,
): boolean {
  if (rule === undefined || rule.requiredPreconditionIds.length > 0) {
    return false;
  }
  return rule.eligibleTargets.some(
    (candidate) =>
      stableOperatorJson(candidate) === stableOperatorJson(target),
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

function discountPrice(
  regularPriceMinor: number,
  discountBasisPoints: number,
): number {
  return Math.floor(
    (regularPriceMinor * (10_000 - discountBasisPoints)) / 10_000,
  );
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function priceSetAction(
  heuristicType: PricingPromotionHeuristicType,
  role: "discount" | "restore",
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  sku: PricingPromotionSkuObservation,
  targetPriceMinor: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<ActionTarget, { readonly kind: "sku" }> = {
    kind: "sku",
    productId: sku.productId,
    skuId: sku.skuId,
  };
  return assertValidAction({
    ...setSkuA849Cad,
    actionId: actionId(
      "action_" +
        heuristicType.toLowerCase() +
        "_" +
        role +
        "_" +
        sanitizeId(sku.skuId) +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("pricing.adjust_price"),
    actionCategory: "pricing",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      heuristicType +
      " " +
      role +
      " set " +
      sku.skuId +
      " price to " +
      targetPriceMinor +
      " minor units.",
    target,
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [sku.productId],
          skuIds: [sku.skuId],
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
        "Execute the frozen simple pricing heuristic without elasticity estimation, forecasting, learning or optimization.",
      intentRef:
        "pricing-promotion-heuristic:" + heuristicType + ":" + role,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "pricing-promotion-heuristic:" +
        heuristicType +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY,
        "heuristic-config:" + configFingerprint,
      ],
    },
  });
}

function calendarPromotionAction(
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  entry: PromotionalCalendarEntry,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const durationSeconds = Math.floor(
    (Date.parse(entry.endAt) - Date.parse(entry.startAt)) / 1000,
  );
  const definition: PromotionDefinition = {
    mechanism: {
      kind: "DISCOUNT",
      discount: {
        kind: "PERCENTAGE",
        basisPoints: entry.discountBasisPoints,
      },
    },
    applicationScope: {
      kind: "PRODUCT_SCOPE",
      products: {
        include: [
          {
            kind: "sku",
            skuId: entry.skuId,
            productId: entry.productId,
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
    stacking: { kind: entry.stacking },
    conflictResolution: { kind: entry.conflictResolution },
    terminationBehavior: "DEACTIVATE_PROMOTION",
  };
  return assertValidAction({
    ...startAutomaticCollectionX15FourDays,
    actionId: actionId(
      "action_fixed_calendar_" +
        sanitizeId(entry.entryId) +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("promotion.start"),
    actionCategory: "promotion",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Start frozen calendar promotion " +
      entry.promotionId +
      " for " +
      entry.skuId +
      ".",
    target: {
      kind: "promotion",
      promotionId: entry.promotionId,
    },
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [entry.productId],
          skuIds: [entry.skuId],
        },
      ],
    },
    parameters: {
      kind: "promotion_start",
      promotionId: entry.promotionId,
      definition,
    },
    timing: {
      decisionTime,
      requestedStart: {
        kind: "known",
        at: utcTimestamp(entry.startAt),
      },
      effectiveStart: {
        kind: "known",
        at: utcTimestamp(entry.startAt),
      },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    },
    duration: { kind: "temporary", durationSeconds },
    termination: { kind: "fixed_duration", durationSeconds },
    constraints: [],
    preconditions: [],
    intent: {
      statement:
        "Execute the frozen promotional calendar regardless of observed performance.",
      intentRef:
        "pricing-promotion-heuristic:FIXED_PROMOTIONAL_CALENDAR:" +
        entry.entryId,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "pricing-promotion-heuristic:FIXED_PROMOTIONAL_CALENDAR@1.0.0:" +
        configFingerprint +
        ":" +
        entry.entryId,
      createdAt: decisionTime,
      evidenceRefs: [
        PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY,
        "heuristic-config:" + configFingerprint,
      ],
    },
  });
}

function hasNonHeuristicCommercialConflict(
  sku: PricingPromotionSkuObservation,
): boolean {
  if (
    sku.currentDiscountBasisPoints !== null &&
    sku.currentDiscountBasisPoints > 0 &&
    sku.currentDiscountOwner !== "heuristic" &&
    sku.currentDiscountOwner !== "none"
  ) {
    return true;
  }
  return sku.activePromotionIds.some(
    (promotionId) => sku.promotionOwners[promotionId] !== "heuristic",
  );
}

interface SkuAudit {
  readonly skuId: string;
  readonly productId: string;
  readonly active: boolean;
  readonly excluded: boolean;
  readonly promotionEligible: boolean | null;
  readonly currentPriceMinor: number | null;
  readonly regularPriceMinor: number | null;
  readonly currentDiscountBasisPoints: number | null;
  readonly currentDiscountOwner: DiscountOwner | null;
  readonly observableInventoryUnits: number | null;
  readonly activePromotionIds: readonly string[];
  readonly promotionOwners: Readonly<Record<string, Exclude<DiscountOwner, "none">>>;
  readonly activeHeuristicRuleIds: readonly string[];
  readonly heuristicRuleStartedAt: Readonly<Record<string, string>>;
}

interface PricingPromotionHeuristicEvaluation {
  readonly actions: readonly Action[];
  readonly audit: {
    readonly heuristicType: PricingPromotionHeuristicType;
    readonly operatorId: string;
    readonly operatorVersion: string;
    readonly implementationFingerprint: string;
    readonly configurationFingerprint: string;
    readonly configuration: OperatorJson;
    readonly dependencies: OperatorJson;
    readonly observationStatus: string;
    readonly decisionTime: string;
    readonly skus: readonly SkuAudit[];
    readonly evaluatedSkuIds: readonly string[];
    readonly currentPriceMinor: number | null;
    readonly regularPriceMinor: number | null;
    readonly currentDiscountBasisPoints: number | null;
    readonly observableInventoryUnits: number | null;
    readonly configuredInventoryThresholdUnits: number | null;
    readonly configuredDiscountBasisPoints: number | null;
    readonly calendarState: string | null;
    readonly promotionEligibility: boolean | null;
    readonly ownershipEvaluation: string | null;
    readonly ruleEvaluation: string;
    readonly proposedActionIds: readonly string[];
    readonly restorationActionIds: readonly string[];
    readonly fallbackReason: string | null;
    readonly simulatorCompatibility:
      | "compatible_no_required_intervention"
      | "compatible_pricing_adjustment"
      | "compatible_temporary_promotion_start";
  };
}

function implementationFingerprint(
  heuristicType: PricingPromotionHeuristicType,
): string {
  return operatorFingerprint({
    suiteVersion: PRICING_PROMOTION_HEURISTIC_SUITE_VERSION,
    operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorVersion: PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION,
    heuristicType,
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        PRICING_PROMOTION_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit:
        PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    frozenParentCommit:
      PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    metricSetVersion: PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION,
    simulatorVersion: PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
    observationSemantics: {
      key: PRICING_PROMOTION_HEURISTIC_OBSERVATION_KEY,
      schemaVersion:
        PRICING_PROMOTION_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
      futureInformationAccess: false,
      hiddenStateAccess: false,
    },
    decisionDomain: "pricing_and_promotion_only",
    eligibilitySemantics:
      "honor frozen configured SKU exclusions plus observable active/excluded/promotion-eligibility state; fail closed when eligibility is unknown",
    priceOptimization: false,
    elasticityEstimation: false,
    forecasting: false,
    learning: false,
  });
}

export const PRICING_PROMOTION_HEURISTIC_IMPLEMENTATION_FINGERPRINTS =
  deepFreezeOperator({
    NEVER_DISCOUNT: implementationFingerprint("NEVER_DISCOUNT"),
    FIXED_DISCOUNT: implementationFingerprint("FIXED_DISCOUNT"),
    EXCESS_INVENTORY_DISCOUNT: implementationFingerprint(
      "EXCESS_INVENTORY_DISCOUNT",
    ),
    FIXED_PROMOTIONAL_CALENDAR: implementationFingerprint(
      "FIXED_PROMOTIONAL_CALENDAR",
    ),
  });

function assertValidConfig(
  config: PricingPromotionHeuristicConfig,
): PricingPromotionHeuristicConfig {
  const requireCondition = (condition: unknown, message: string) => {
    if (!condition) throw new TypeError(message);
  };

  if (config.heuristicType === "NEVER_DISCOUNT") {
    requireCondition(
      config.applicableSkuIds.length > 0,
      "NEVER_DISCOUNT requires at least one applicable SKU",
    );
  }

  if (config.heuristicType === "FIXED_DISCOUNT") {
    requireCondition(
      Number.isFinite(Date.parse(config.startAt)),
      "FIXED_DISCOUNT startAt must be ISO-8601",
    );
    requireCondition(
      config.durationSeconds > 0,
      "FIXED_DISCOUNT durationSeconds must be positive",
    );
    requireCondition(
      config.discountBasisPoints > 0 &&
        config.discountBasisPoints <= 10_000,
      "FIXED_DISCOUNT discount must be within (0,10000] basis points",
    );
  }

  if (config.heuristicType === "EXCESS_INVENTORY_DISCOUNT") {
    requireCondition(
      Number.isSafeInteger(config.excessInventoryThresholdUnits) &&
        config.excessInventoryThresholdUnits >= 0,
      "EXCESS_INVENTORY_DISCOUNT threshold must be a non-negative integer",
    );
    requireCondition(
      Number.isSafeInteger(config.restorationThresholdUnits) &&
        config.restorationThresholdUnits >= 0 &&
        config.restorationThresholdUnits <=
          config.excessInventoryThresholdUnits,
      "EXCESS_INVENTORY_DISCOUNT restoration threshold must be valid",
    );
    requireCondition(
      config.discountBasisPoints > 0 &&
        config.discountBasisPoints <= 10_000,
      "EXCESS_INVENTORY_DISCOUNT discount must be within (0,10000] basis points",
    );
  }

  if (config.heuristicType === "FIXED_PROMOTIONAL_CALENDAR") {
    requireCondition(
      config.calendar.length > 0,
      "FIXED_PROMOTIONAL_CALENDAR requires at least one entry",
    );
    const entryIds = new Set<string>();
    const promotionIds = new Set<string>();
    for (const entry of config.calendar) {
      requireCondition(
        !entryIds.has(entry.entryId),
        "FIXED_PROMOTIONAL_CALENDAR entry IDs must be unique",
      );
      requireCondition(
        !promotionIds.has(entry.promotionId),
        "FIXED_PROMOTIONAL_CALENDAR promotion IDs must be unique",
      );
      entryIds.add(entry.entryId);
      promotionIds.add(entry.promotionId);
      const start = Date.parse(entry.startAt);
      const end = Date.parse(entry.endAt);
      requireCondition(
        Number.isFinite(start) && Number.isFinite(end) && end > start,
        "FIXED_PROMOTIONAL_CALENDAR entries require valid increasing UTC dates",
      );
      requireCondition(
        entry.discountBasisPoints > 0 &&
          entry.discountBasisPoints <= 10_000,
        "FIXED_PROMOTIONAL_CALENDAR discount must be within (0,10000] basis points",
      );
    }
  }

  return config;
}

export function pricingPromotionHeuristicConfigurationFingerprint(
  config: PricingPromotionHeuristicConfig,
): string {
  return operatorFingerprint({
    ...config,
    frozenParentCommit:
      PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
    metricSetVersion: PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION,
    simulatorVersion: PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
  });
}

function evaluate(
  config: PricingPromotionHeuristicConfig,
  input: Readonly<OperatorDecisionInput>,
): PricingPromotionHeuristicEvaluation {
  const configFingerprint =
    pricingPromotionHeuristicConfigurationFingerprint(config);
  const implFingerprint =
    PRICING_PROMOTION_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];
  const parsed = parseObservation(input, config);
  let observationStatus = parsed.ok ? "AVAILABLE" : parsed.reason;
  let skuAudits: SkuAudit[] = [];
  let evaluatedSkuIds: string[] = [];
  let currentPriceMinor: number | null = null;
  let regularPriceMinor: number | null = null;
  let currentDiscountBasisPoints: number | null = null;
  let observableInventoryUnits: number | null = null;
  let configuredInventoryThresholdUnits: number | null = null;
  let configuredDiscountBasisPoints: number | null = null;
  let calendarState: string | null = null;
  let promotionEligibility: boolean | null = null;
  let ownershipEvaluation: string | null = null;
  let ruleEvaluation = "NO_RULE_EVALUATED";
  let fallbackReason: string | null = null;
  let simulatorCompatibility:
    PricingPromotionHeuristicEvaluation["audit"]["simulatorCompatibility"] =
      "compatible_no_required_intervention";
  const actions: Action[] = [];
  const restorationActionIds: string[] = [];

  if (!parsed.ok) {
    fallbackReason = parsed.reason;
  } else {
    skuAudits = parsed.payload.skus.map((sku) => ({ ...sku }));

    const proposePriceSet = (
      sku: PricingPromotionSkuObservation,
      targetPrice: number,
      role: "discount" | "restore",
    ) => {
      const target: Extract<ActionTarget, { readonly kind: "sku" }> = {
        kind: "sku",
        productId: sku.productId,
        skuId: sku.skuId,
      };
      const rule = legalRule(input, "pricing.adjust_price");
      if (!targetEligible(rule, target) || rule === undefined) {
        fallbackReason = "PRICING_ACTION_UNAVAILABLE";
        return;
      }
      const action = priceSetAction(
        config.heuristicType,
        role,
        configFingerprint,
        input,
        sku,
        targetPrice,
      );
      if (!actionWithinAvailabilityBounds(action, rule)) {
        fallbackReason = "PRICING_ACTION_OUTSIDE_LEGAL_BOUNDS";
        return;
      }
      actions.push(action);
      if (role === "restore") {
        restorationActionIds.push(String(action.actionId));
      }
      simulatorCompatibility = "compatible_pricing_adjustment";
    };

    const applicable =
      config.heuristicType === "FIXED_PROMOTIONAL_CALENDAR"
        ? [...new Set(config.calendar.map((entry) => entry.skuId))]
        : config.applicableSkuIds;

    for (const skuId of applicable) {
      const sku = parsed.bySku.get(skuId);
      if (sku === undefined) {
        fallbackReason = "APPLICABLE_SKU_OBSERVATION_MISSING";
        continue;
      }
      evaluatedSkuIds.push(skuId);
      currentPriceMinor = sku.currentPriceMinor;
      regularPriceMinor = sku.regularPriceMinor;
      currentDiscountBasisPoints = sku.currentDiscountBasisPoints;
      observableInventoryUnits = sku.observableInventoryUnits;
      promotionEligibility = sku.promotionEligible;

      if (!sku.active) {
        fallbackReason = "SKU_INACTIVE";
        continue;
      }
      const configuredExcluded =
        "excludedSkuIds" in config &&
        config.excludedSkuIds.includes(sku.skuId);
      if (sku.excluded || configuredExcluded) {
        fallbackReason = "SKU_EXCLUDED";
        continue;
      }
      if (sku.promotionEligible !== true) {
        fallbackReason =
          sku.promotionEligible === false
            ? "SKU_NOT_PROMOTION_ELIGIBLE"
            : "PROMOTION_ELIGIBILITY_UNKNOWN";
        continue;
      }

      if (config.heuristicType === "NEVER_DISCOUNT") {
        configuredDiscountBasisPoints =
          config.discretionaryDiscountBasisPoints;
        if (
          sku.currentPriceMinor === null ||
          sku.regularPriceMinor === null ||
          sku.currentDiscountBasisPoints === null ||
          sku.currentDiscountOwner === null
        ) {
          fallbackReason = "PRICE_OR_DISCOUNT_STATE_MISSING";
          continue;
        }
        if (
          sku.currentDiscountBasisPoints === 0 ||
          sku.currentPriceMinor === sku.regularPriceMinor
        ) {
          ruleEvaluation = "REGULAR_PRICE_MAINTAINED";
          continue;
        }
        if (
          sku.currentDiscountOwner === "environment" ||
          sku.currentDiscountOwner === "status_quo"
        ) {
          ownershipEvaluation =
            "PRESERVE_NON_HEURISTIC_DISCOUNT_OWNER:" +
            sku.currentDiscountOwner;
          ruleEvaluation = "NON_HEURISTIC_DISCOUNT_PRESERVED";
          continue;
        }
        if (
          !config.removableOwners.includes(
            sku.currentDiscountOwner as "merchant_discretionary" | "heuristic",
          )
        ) {
          fallbackReason = "DISCOUNT_OWNER_NOT_REMOVABLE";
          continue;
        }
        ownershipEvaluation =
          "OPERATOR_OWNABLE_DISCOUNT:" + sku.currentDiscountOwner;
        ruleEvaluation = "RESTORE_REGULAR_PRICE";
        proposePriceSet(sku, sku.regularPriceMinor, "restore");
        break;
      }

      if (config.heuristicType === "FIXED_DISCOUNT") {
        configuredDiscountBasisPoints = config.discountBasisPoints;
        const startMs = Date.parse(config.startAt);
        const endMs = startMs + config.durationSeconds * 1000;
        const decisionMs = Date.parse(input.decisionTime);
        const isActive = sku.activeHeuristicRuleIds.includes(config.ruleId);

        if (sku.currentPriceMinor === null || sku.regularPriceMinor === null) {
          fallbackReason = "PRICE_STATE_MISSING";
          continue;
        }

        if (isActive) {
          ownershipEvaluation = "HEURISTIC_RULE_OWNED:" + config.ruleId;
          if (
            sku.currentDiscountBasisPoints !== null &&
            sku.currentDiscountBasisPoints > 0 &&
            sku.currentDiscountOwner !== "heuristic"
          ) {
            fallbackReason = "ACTIVE_RULE_DISCOUNT_OWNERSHIP_CONFLICT";
            ownershipEvaluation = "PRESERVE_EXISTING_COMMERCIAL_OWNER";
            break;
          }
          if (decisionMs >= endMs) {
            ruleEvaluation = "FIXED_DISCOUNT_END_RESTORE";
            proposePriceSet(sku, sku.regularPriceMinor, "restore");
          } else {
            ruleEvaluation = "FIXED_DISCOUNT_ALREADY_ACTIVE";
          }
          break;
        }

        if (decisionMs < startMs) {
          ruleEvaluation = "BEFORE_FIXED_DISCOUNT_WINDOW";
          break;
        }
        if (decisionMs >= endMs) {
          ruleEvaluation = "AFTER_FIXED_DISCOUNT_WINDOW";
          break;
        }
        if (hasNonHeuristicCommercialConflict(sku)) {
          fallbackReason = "NON_HEURISTIC_COMMERCIAL_CONFLICT";
          ownershipEvaluation = "PRESERVE_EXISTING_COMMERCIAL_OWNER";
          break;
        }
        ruleEvaluation = "FIXED_DISCOUNT_START";
        proposePriceSet(
          sku,
          discountPrice(sku.regularPriceMinor, config.discountBasisPoints),
          "discount",
        );
        break;
      }

      if (config.heuristicType === "EXCESS_INVENTORY_DISCOUNT") {
        configuredInventoryThresholdUnits =
          config.excessInventoryThresholdUnits;
        configuredDiscountBasisPoints = config.discountBasisPoints;

        if (
          sku.currentPriceMinor === null ||
          sku.regularPriceMinor === null
        ) {
          fallbackReason = "PRICE_STATE_MISSING";
          continue;
        }
        if (sku.observableInventoryUnits === null) {
          fallbackReason = "INVENTORY_OBSERVATION_MISSING";
          continue;
        }

        const isActive = sku.activeHeuristicRuleIds.includes(config.ruleId);
        if (isActive) {
          ownershipEvaluation = "HEURISTIC_RULE_OWNED:" + config.ruleId;
          if (
            sku.currentDiscountBasisPoints !== null &&
            sku.currentDiscountBasisPoints > 0 &&
            sku.currentDiscountOwner !== "heuristic"
          ) {
            fallbackReason = "ACTIVE_RULE_DISCOUNT_OWNERSHIP_CONFLICT";
            ownershipEvaluation = "PRESERVE_EXISTING_COMMERCIAL_OWNER";
            break;
          }
          if (
            sku.observableInventoryUnits <=
            config.restorationThresholdUnits
          ) {
            const startedAt = sku.heuristicRuleStartedAt[config.ruleId];
            if (startedAt === undefined) {
              fallbackReason = "HEURISTIC_RULE_START_TIME_MISSING";
              break;
            }
            const ageSeconds = Math.floor(
              (Date.parse(input.decisionTime) - Date.parse(startedAt)) /
                1000,
            );
            if (ageSeconds < config.minimumPromotionDurationSeconds) {
              ruleEvaluation =
                "RESTORATION_THRESHOLD_REACHED_BUT_MINIMUM_DURATION_NOT_MET";
              break;
            }
            ruleEvaluation = "EXCESS_INVENTORY_DISCOUNT_RESTORE";
            proposePriceSet(sku, sku.regularPriceMinor, "restore");
          } else {
            ruleEvaluation = "EXCESS_INVENTORY_DISCOUNT_REMAINS_ACTIVE";
          }
          break;
        }

        if (
          sku.observableInventoryUnits ===
          config.excessInventoryThresholdUnits
        ) {
          ruleEvaluation = "EXACTLY_AT_EXCESS_THRESHOLD_NO_DISCOUNT";
          break;
        }
        if (
          sku.observableInventoryUnits <
          config.excessInventoryThresholdUnits
        ) {
          ruleEvaluation = "BELOW_EXCESS_THRESHOLD_NO_DISCOUNT";
          break;
        }
        if (hasNonHeuristicCommercialConflict(sku)) {
          fallbackReason = "NON_HEURISTIC_COMMERCIAL_CONFLICT";
          ownershipEvaluation = "PRESERVE_EXISTING_COMMERCIAL_OWNER";
          break;
        }
        ruleEvaluation = "EXCESS_INVENTORY_DISCOUNT_START";
        proposePriceSet(
          sku,
          discountPrice(sku.regularPriceMinor, config.discountBasisPoints),
          "discount",
        );
        break;
      }

      if (config.heuristicType === "FIXED_PROMOTIONAL_CALENDAR") {
        const decisionMs = Date.parse(input.decisionTime);
        const entries = config.calendar
          .filter((entry) => entry.skuId === sku.skuId)
          .sort(
            (left, right) =>
              Date.parse(left.startAt) - Date.parse(right.startAt) ||
              left.entryId.localeCompare(right.entryId),
          );
        const exactStartEntries = entries.filter(
          (entry) => Date.parse(entry.startAt) === decisionMs,
        );
        const exactEndEntries = entries.filter(
          (entry) => Date.parse(entry.endAt) === decisionMs,
        );
        const activeEntries = entries.filter(
          (entry) =>
            Date.parse(entry.startAt) < decisionMs &&
            decisionMs < Date.parse(entry.endAt),
        );

        if (exactStartEntries.length === 0) {
          if (exactEndEntries.length > 0) {
            calendarState =
              "EXACT_END_RESTORATION_BY_FIXED_DURATION_EXPIRY";
            ruleEvaluation =
              "CALENDAR_PROMOTION_ENDS_WITHOUT_BASE_PRICE_MUTATION";
          } else if (activeEntries.length > 0) {
            calendarState = "DURING_CALENDAR_PROMOTION";
            ruleEvaluation = "CALENDAR_PROMOTION_ALREADY_RUNNING";
          } else if (
            entries.every((entry) => decisionMs < Date.parse(entry.startAt))
          ) {
            calendarState = "BEFORE_CALENDAR";
            ruleEvaluation = "BEFORE_CALENDAR_ENTRY";
          } else {
            calendarState = "AFTER_OR_BETWEEN_CALENDAR_ENTRIES";
            ruleEvaluation = "NO_CALENDAR_START_AT_THIS_OPPORTUNITY";
          }
          break;
        }

        for (const entry of exactStartEntries) {
          configuredDiscountBasisPoints = entry.discountBasisPoints;
          calendarState = "EXACT_CALENDAR_START:" + entry.entryId;
          if (sku.activePromotionIds.includes(entry.promotionId)) {
            const owner = sku.promotionOwners[entry.promotionId];
            if (owner === "heuristic") {
              ownershipEvaluation =
                "HEURISTIC_PROMOTION_ALREADY_ACTIVE:" +
                entry.promotionId;
              ruleEvaluation = "CALENDAR_DUPLICATE_SUPPRESSED";
            } else {
              ownershipEvaluation =
                "PROMOTION_OWNERSHIP_CONFLICT:" +
                String(owner ?? "unknown");
              fallbackReason = "PROMOTION_OWNED_BY_OTHER_SOURCE";
            }
            continue;
          }

          const target: Extract<
            ActionTarget,
            { readonly kind: "promotion" }
          > = {
            kind: "promotion",
            promotionId: entry.promotionId,
          };
          const rule = legalRule(input, "promotion.start");
          if (!targetEligible(rule, target) || rule === undefined) {
            fallbackReason = "PROMOTION_START_ACTION_UNAVAILABLE";
            continue;
          }
          const action = calendarPromotionAction(
            configFingerprint,
            input,
            entry,
          );
          if (!actionWithinAvailabilityBounds(action, rule)) {
            fallbackReason = "PROMOTION_START_OUTSIDE_LEGAL_BOUNDS";
            continue;
          }
          actions.push(action);
          ownershipEvaluation =
            "HEURISTIC_OWNS_CONFIGURED_PROMOTION:" +
            entry.promotionId;
          ruleEvaluation = "CALENDAR_PROMOTION_START";
          simulatorCompatibility =
            "compatible_temporary_promotion_start";
        }
        break;
      }
    }
  }

  if (actions.length === 0 && fallbackReason === null) {
    fallbackReason = "RULE_REQUIRED_NO_NEW_DISCRETIONARY_ACTION";
  }

  return deepFreezeOperator({
    actions,
    audit: {
      heuristicType: config.heuristicType,
      operatorId: OPERATOR_IDS[config.heuristicType],
      operatorVersion:
        PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION,
      implementationFingerprint: implFingerprint,
      configurationFingerprint: configFingerprint,
      configuration: config as unknown as OperatorJson,
      dependencies: {
        evaluationContractFingerprint:
          PRICING_PROMOTION_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
        evaluationContractFrozenCommit:
          PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
        frozenParentCommit:
          PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
        actionOntologyVersion: ACTION_SCHEMA_VERSION,
        metricSetVersion:
          PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION,
        simulatorVersion:
          PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      },
      observationStatus,
      decisionTime: input.decisionTime,
      skus: skuAudits,
      evaluatedSkuIds,
      currentPriceMinor,
      regularPriceMinor,
      currentDiscountBasisPoints,
      observableInventoryUnits,
      configuredInventoryThresholdUnits,
      configuredDiscountBasisPoints,
      calendarState,
      promotionEligibility,
      ownershipEvaluation,
      ruleEvaluation,
      proposedActionIds: actions.map((action) =>
        String(action.actionId),
      ),
      restorationActionIds,
      fallbackReason,
      simulatorCompatibility,
    },
  });
}

export function createPricingPromotionHeuristicOperator(
  configInput: PricingPromotionHeuristicConfig,
): CanonicalOperator {
  const config = assertValidConfig(configInput);
  const configurationFingerprint =
    pricingPromotionHeuristicConfigurationFingerprint(config);
  const implementation =
    PRICING_PROMOTION_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: OPERATOR_IDS[config.heuristicType],
    operatorType: "baseline",
    operatorVersion:
      PRICING_PROMOTION_HEURISTIC_OPERATOR_VERSION,
    description: DESCRIPTIONS[config.heuristicType],
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        PRICING_PROMOTION_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit:
        PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      suiteVersion: PRICING_PROMOTION_HEURISTIC_SUITE_VERSION,
      heuristicType: config.heuristicType,
      configurationFingerprint,
      configuration: config as unknown as OperatorJson,
      metricSetVersion:
        PRICING_PROMOTION_HEURISTIC_METRIC_SET_VERSION,
      simulatorVersion:
        PRICING_PROMOTION_HEURISTIC_SIMULATOR_VERSION,
      frozenParentCommit:
        PRICING_PROMOTION_HEURISTIC_FROZEN_STEP_3_5_COMMIT,
      priceOptimization: false,
      promotionOptimization: false,
      elasticityEstimation: false,
      forecasting: false,
      causalLiftEstimation: false,
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
          "pricing/promotion heuristic audit does not match decision output",
        );
      }
      return {
        auditType: "pricing_promotion_heuristic_evaluation",
        payload: decision.audit as unknown as OperatorJson,
      };
    },
  });
}

export const NEVER_DISCOUNT_OPERATOR =
  createPricingPromotionHeuristicOperator(NEVER_DISCOUNT_CONFIG);

export const FIXED_DISCOUNT_OPERATOR =
  createPricingPromotionHeuristicOperator(FIXED_DISCOUNT_CONFIG);

export const EXCESS_INVENTORY_DISCOUNT_OPERATOR =
  createPricingPromotionHeuristicOperator(
    EXCESS_INVENTORY_DISCOUNT_CONFIG,
  );

export const FIXED_PROMOTIONAL_CALENDAR_OPERATOR =
  createPricingPromotionHeuristicOperator(
    FIXED_PROMOTIONAL_CALENDAR_CONFIG,
  );

export const PRICING_PROMOTION_HEURISTIC_BASELINE_OPERATORS =
  deepFreezeOperator({
    NEVER_DISCOUNT: NEVER_DISCOUNT_OPERATOR,
    FIXED_DISCOUNT: FIXED_DISCOUNT_OPERATOR,
    EXCESS_INVENTORY_DISCOUNT:
      EXCESS_INVENTORY_DISCOUNT_OPERATOR,
    FIXED_PROMOTIONAL_CALENDAR:
      FIXED_PROMOTIONAL_CALENDAR_OPERATOR,
  });
