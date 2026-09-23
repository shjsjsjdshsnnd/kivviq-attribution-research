import { actionId, actionType } from "../action_ontology/identity.js";
import { doNothingAction } from "../action_ontology/fixtures.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionTarget,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { utcTimestamp } from "../core/units.js";
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

export const MERCHANDISING_HEURISTIC_SUITE_VERSION = "1.0.0" as const;
export const MERCHANDISING_HEURISTIC_OPERATOR_VERSION = "1.0.0" as const;
export const MERCHANDISING_HEURISTIC_CONFIGURATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const MERCHANDISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const MERCHANDISING_HEURISTIC_OBSERVATION_KEY =
  "merchandising.product_performance.v1" as const;

export const MERCHANDISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT =
  "b8c1f16e37d8483948d5e607e9711f0daa027adc" as const;
export const MERCHANDISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;
export const MERCHANDISING_HEURISTIC_METRIC_SET_VERSION = "1.0.0" as const;
export const MERCHANDISING_HEURISTIC_SIMULATOR_VERSION =
  "customer-journey-simulator-4.0.0" as const;
export const MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION =
  "ecommerce-economics-7.0.0" as const;
export const MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION =
  "product-economics-8.0.0" as const;

export type MerchandisingHeuristicType =
  | "RANK_BY_REVENUE"
  | "RANK_BY_CONVERSION_RATE"
  | "RANK_BY_UNITS_SOLD";

export interface MerchandisingProductObservation {
  readonly productId: string;
  readonly collectionMember: boolean;
  readonly active: boolean;
  readonly available: boolean;
  readonly merchandisingEligible: boolean;
  readonly excluded: boolean;
  readonly currentPosition: number | null;
  readonly pinnedPosition: number | null;
  readonly mandatoryPosition: number | null;
  readonly newlyLaunched: boolean;
  readonly revenueMinor: number | null;
  readonly conversions: number | null;
  readonly productViews: number | null;
  readonly unitsSold: number | null;
}

export interface MerchandisingObservationPayload {
  readonly schemaVersion:
    typeof MERCHANDISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION;
  readonly targetCollectionId: string;
  readonly currency: "CAD";
  readonly lookbackDays: number;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly products: readonly MerchandisingProductObservation[];
}

interface MerchandisingHeuristicConfigBase {
  readonly configurationSchemaVersion:
    typeof MERCHANDISING_HEURISTIC_CONFIGURATION_SCHEMA_VERSION;
  readonly heuristicType: MerchandisingHeuristicType;
  readonly observationKey:
    typeof MERCHANDISING_HEURISTIC_OBSERVATION_KEY;
  readonly targetCollectionId: "collection:X";
  readonly targetSurface: "COLLECTION_PAGE";
  readonly lookbackDays: 30;
  readonly tieBreakRule: "PRIMARY_METRIC_DESC_THEN_PRODUCT_ID_ASC";
  readonly fallbackRule:
    "VALID_METRIC_PRODUCTS_FIRST_THEN_INSUFFICIENT_OR_MISSING_BY_PRODUCT_ID_ASC";
  readonly missingDataBehavior: "STABLE_FALLBACK_NO_PREDICTION";
  readonly eligibilityBehavior:
    "COLLECTION_MEMBER_ACTIVE_AVAILABLE_MERCHANDISING_ELIGIBLE_NOT_EXCLUDED";
  readonly fixedPositionBehavior:
    "PINNED_OR_MANDATORY_POSITIONS_REMAIN_FIXED";
  readonly actionType: "merchandising.move_product";
  readonly constraintBehavior:
    "NORMAL_VALIDATION_RECORD_ACCEPTED_REJECTED_MODIFIED";
}

export interface RankByRevenueConfig
  extends MerchandisingHeuristicConfigBase {
  readonly heuristicType: "RANK_BY_REVENUE";
  readonly metricId: "revenue";
  readonly revenueSemantics: {
    readonly source:
      "ecommerce_economic_report.byProduct.netRevenueMinor";
    readonly definition:
      "SUM_PRODUCT_ORDER_LINE_NET_SALES_AFTER_DISCOUNTS_MINUS_PRODUCT_REFUNDS";
    readonly currency: "CAD";
    readonly discountTreatment: "NET_OF_DISCOUNTS";
    readonly refundTreatment: "SUBTRACT_PRODUCT_REFUNDED_REVENUE";
    readonly cancellationTreatment:
      "CANCELLED_ORDERS_ARE_NOT_REALIZED_ORDERS";
    readonly attribution: "PRODUCT_ORDER_LINE";
  };
}

export interface RankByConversionRateConfig
  extends MerchandisingHeuristicConfigBase {
  readonly heuristicType: "RANK_BY_CONVERSION_RATE";
  readonly metricId: "conversion_rate";
  readonly conversionSemantics: {
    readonly numerator:
      "REPRESENTED_REALIZED_ORDERS_CONTAINING_PRODUCT";
    readonly denominator: "OBSERVED_PRODUCT_VIEWS";
    readonly source:
      "product_economics.observedViewToPurchaseRate_inputs";
    readonly minimumProductViews: 20;
    readonly insufficientEvidencePlacement: "STABLE_FALLBACK";
    readonly zeroViewsBehavior: "INSUFFICIENT_EVIDENCE";
  };
}

export interface RankByUnitsSoldConfig
  extends MerchandisingHeuristicConfigBase {
  readonly heuristicType: "RANK_BY_UNITS_SOLD";
  readonly metricId: "units_sold";
  readonly unitsSemantics: {
    readonly source:
      "ecommerce_economic_report.byProduct.units";
    readonly definition:
      "SUM_REALIZED_ORDER_LINE_QUANTITY";
    readonly cancellationTreatment:
      "CANCELLED_ORDERS_ARE_NOT_REALIZED_ORDERS";
    readonly refundReturnTreatment:
      "RETURNS_AND_REFUNDS_DO_NOT_SUBTRACT_REALIZED_UNITS";
  };
}

export type MerchandisingHeuristicConfig =
  | RankByRevenueConfig
  | RankByConversionRateConfig
  | RankByUnitsSoldConfig;

const COMMON_CONFIGURATION = {
  configurationSchemaVersion:
    MERCHANDISING_HEURISTIC_CONFIGURATION_SCHEMA_VERSION,
  observationKey: MERCHANDISING_HEURISTIC_OBSERVATION_KEY,
  targetCollectionId: "collection:X",
  targetSurface: "COLLECTION_PAGE",
  lookbackDays: 30,
  tieBreakRule: "PRIMARY_METRIC_DESC_THEN_PRODUCT_ID_ASC",
  fallbackRule:
    "VALID_METRIC_PRODUCTS_FIRST_THEN_INSUFFICIENT_OR_MISSING_BY_PRODUCT_ID_ASC",
  missingDataBehavior: "STABLE_FALLBACK_NO_PREDICTION",
  eligibilityBehavior:
    "COLLECTION_MEMBER_ACTIVE_AVAILABLE_MERCHANDISING_ELIGIBLE_NOT_EXCLUDED",
  fixedPositionBehavior:
    "PINNED_OR_MANDATORY_POSITIONS_REMAIN_FIXED",
  actionType: "merchandising.move_product",
  constraintBehavior:
    "NORMAL_VALIDATION_RECORD_ACCEPTED_REJECTED_MODIFIED",
} as const;

export const RANK_BY_REVENUE_CONFIG: RankByRevenueConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "RANK_BY_REVENUE",
    metricId: "revenue",
    revenueSemantics: {
      source:
        "ecommerce_economic_report.byProduct.netRevenueMinor",
      definition:
        "SUM_PRODUCT_ORDER_LINE_NET_SALES_AFTER_DISCOUNTS_MINUS_PRODUCT_REFUNDS",
      currency: "CAD",
      discountTreatment: "NET_OF_DISCOUNTS",
      refundTreatment: "SUBTRACT_PRODUCT_REFUNDED_REVENUE",
      cancellationTreatment:
        "CANCELLED_ORDERS_ARE_NOT_REALIZED_ORDERS",
      attribution: "PRODUCT_ORDER_LINE",
    },
  });

export const RANK_BY_CONVERSION_RATE_CONFIG:
  RankByConversionRateConfig = deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "RANK_BY_CONVERSION_RATE",
    metricId: "conversion_rate",
    conversionSemantics: {
      numerator:
        "REPRESENTED_REALIZED_ORDERS_CONTAINING_PRODUCT",
      denominator: "OBSERVED_PRODUCT_VIEWS",
      source:
        "product_economics.observedViewToPurchaseRate_inputs",
      minimumProductViews: 20,
      insufficientEvidencePlacement: "STABLE_FALLBACK",
      zeroViewsBehavior: "INSUFFICIENT_EVIDENCE",
    },
  });

export const RANK_BY_UNITS_SOLD_CONFIG: RankByUnitsSoldConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "RANK_BY_UNITS_SOLD",
    metricId: "units_sold",
    unitsSemantics: {
      source: "ecommerce_economic_report.byProduct.units",
      definition: "SUM_REALIZED_ORDER_LINE_QUANTITY",
      cancellationTreatment:
        "CANCELLED_ORDERS_ARE_NOT_REALIZED_ORDERS",
      refundReturnTreatment:
        "RETURNS_AND_REFUNDS_DO_NOT_SUBTRACT_REALIZED_UNITS",
    },
  });

export const FROZEN_MERCHANDISING_HEURISTIC_CONFIGURATIONS =
  deepFreezeOperator({
    RANK_BY_REVENUE: RANK_BY_REVENUE_CONFIG,
    RANK_BY_CONVERSION_RATE: RANK_BY_CONVERSION_RATE_CONFIG,
    RANK_BY_UNITS_SOLD: RANK_BY_UNITS_SOLD_CONFIG,
  });

const OPERATOR_IDS: Readonly<Record<MerchandisingHeuristicType, string>> =
  deepFreezeOperator({
    RANK_BY_REVENUE: "baseline.merchandising.rank_by_revenue",
    RANK_BY_CONVERSION_RATE:
      "baseline.merchandising.rank_by_conversion_rate",
    RANK_BY_UNITS_SOLD:
      "baseline.merchandising.rank_by_units_sold",
  });

const DESCRIPTIONS: Readonly<
  Record<MerchandisingHeuristicType, string>
> = deepFreezeOperator({
  RANK_BY_REVENUE:
    "Simple merchandising baseline that sorts eligible products by trailing observed net product revenue only.",
  RANK_BY_CONVERSION_RATE:
    "Simple merchandising baseline that sorts eligible products by trailing observed product orders divided by product views, with a frozen minimum evidence requirement.",
  RANK_BY_UNITS_SOLD:
    "Simple merchandising baseline that sorts eligible products by trailing realized units sold only.",
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

function positiveIntegerOrNull(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      Number.isFinite(value) &&
      value > 0)
  );
}

function parseObservation(
  input: Readonly<OperatorDecisionInput>,
  config: MerchandisingHeuristicConfig,
):
  | {
      readonly ok: true;
      readonly payload: MerchandisingObservationPayload;
      readonly byProduct: ReadonlyMap<
        string,
        MerchandisingProductObservation
      >;
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
    value["schemaVersion"] !==
      MERCHANDISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION ||
    value["targetCollectionId"] !== config.targetCollectionId ||
    value["currency"] !== "CAD" ||
    value["lookbackDays"] !== config.lookbackDays ||
    typeof value["windowStart"] !== "string" ||
    typeof value["windowEnd"] !== "string" ||
    !Array.isArray(value["products"])
  ) {
    return { ok: false, reason: "OBSERVATION_SCHEMA_INVALID" };
  }

  const windowStart = Date.parse(value["windowStart"]);
  const windowEnd = Date.parse(value["windowEnd"]);
  const decision = Date.parse(input.decisionTime);
  if (
    !Number.isFinite(windowStart) ||
    !Number.isFinite(windowEnd) ||
    windowEnd !== decision ||
    windowEnd - windowStart !== config.lookbackDays * 24 * 60 * 60 * 1000
  ) {
    return { ok: false, reason: "LOOKBACK_WINDOW_MISMATCH" };
  }

  const products: MerchandisingProductObservation[] = [];
  const seen = new Set<string>();

  for (const raw of value["products"]) {
    if (
      !isRecord(raw) ||
      typeof raw["productId"] !== "string" ||
      raw["productId"].trim().length === 0 ||
      typeof raw["collectionMember"] !== "boolean" ||
      typeof raw["active"] !== "boolean" ||
      typeof raw["available"] !== "boolean" ||
      typeof raw["merchandisingEligible"] !== "boolean" ||
      typeof raw["excluded"] !== "boolean" ||
      !positiveIntegerOrNull(raw["currentPosition"]) ||
      !positiveIntegerOrNull(raw["pinnedPosition"]) ||
      !positiveIntegerOrNull(raw["mandatoryPosition"]) ||
      typeof raw["newlyLaunched"] !== "boolean" ||
      !(raw["revenueMinor"] === null || finiteNumber(raw["revenueMinor"])) ||
      !(raw["conversions"] === null || finiteNonNegative(raw["conversions"])) ||
      !(raw["productViews"] === null || finiteNonNegative(raw["productViews"])) ||
      !(raw["unitsSold"] === null || finiteNonNegative(raw["unitsSold"]))
    ) {
      return { ok: false, reason: "PRODUCT_OBSERVATION_INVALID" };
    }

    if (
      raw["pinnedPosition"] !== null &&
      raw["mandatoryPosition"] !== null &&
      raw["pinnedPosition"] !== raw["mandatoryPosition"]
    ) {
      return {
        ok: false,
        reason: "CONFLICTING_FIXED_PRODUCT_POSITION",
      };
    }

    if (seen.has(raw["productId"])) {
      return { ok: false, reason: "DUPLICATE_PRODUCT_OBSERVATION" };
    }
    seen.add(raw["productId"]);

    products.push({
      productId: raw["productId"],
      collectionMember: raw["collectionMember"],
      active: raw["active"],
      available: raw["available"],
      merchandisingEligible: raw["merchandisingEligible"],
      excluded: raw["excluded"],
      currentPosition: raw["currentPosition"],
      pinnedPosition: raw["pinnedPosition"],
      mandatoryPosition: raw["mandatoryPosition"],
      newlyLaunched: raw["newlyLaunched"],
      revenueMinor: raw["revenueMinor"],
      conversions: raw["conversions"],
      productViews: raw["productViews"],
      unitsSold: raw["unitsSold"],
    });
  }

  const payload: MerchandisingObservationPayload = {
    schemaVersion:
      MERCHANDISING_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
    targetCollectionId: config.targetCollectionId,
    currency: "CAD",
    lookbackDays: config.lookbackDays,
    windowStart: value["windowStart"],
    windowEnd: value["windowEnd"],
    products,
  };

  return {
    ok: true,
    payload,
    byProduct: new Map(
      products.map((product) => [product.productId, product]),
    ),
  };
}

function legalRule(
  input: Readonly<OperatorDecisionInput>,
): OperatorLegalActionRule | undefined {
  return input.legalActionSpace.rules.find(
    (rule) => rule.actionType === "merchandising.move_product",
  );
}

function legallyMovableProductIds(
  input: Readonly<OperatorDecisionInput>,
): ReadonlySet<string> {
  const rule = legalRule(input);
  if (rule === undefined || rule.requiredPreconditionIds.length > 0) {
    return new Set();
  }
  return new Set(
    rule.eligibleTargets
      .filter(
        (
          target,
        ): target is Extract<
          ActionTarget,
          { readonly kind: "product" }
        > => target.kind === "product",
      )
      .map((target) => target.productId),
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

interface ProductMetricEvaluation {
  readonly productId: string;
  readonly metricValue: number | null;
  readonly evidenceStatus:
    | "VALID"
    | "MISSING"
    | "INSUFFICIENT_CONVERSION_EVIDENCE";
  readonly tieBreakKey: string;
}

function metricEvaluation(
  config: MerchandisingHeuristicConfig,
  product: MerchandisingProductObservation,
): ProductMetricEvaluation {
  if (config.heuristicType === "RANK_BY_REVENUE") {
    return {
      productId: product.productId,
      metricValue: product.revenueMinor,
      evidenceStatus:
        product.revenueMinor === null ? "MISSING" : "VALID",
      tieBreakKey: product.productId,
    };
  }

  if (config.heuristicType === "RANK_BY_UNITS_SOLD") {
    return {
      productId: product.productId,
      metricValue: product.unitsSold,
      evidenceStatus:
        product.unitsSold === null ? "MISSING" : "VALID",
      tieBreakKey: product.productId,
    };
  }

  if (
    product.productViews === null ||
    product.conversions === null
  ) {
    return {
      productId: product.productId,
      metricValue: null,
      evidenceStatus: "MISSING",
      tieBreakKey: product.productId,
    };
  }

  if (
    product.productViews <
    config.conversionSemantics.minimumProductViews
  ) {
    return {
      productId: product.productId,
      metricValue: null,
      evidenceStatus: "INSUFFICIENT_CONVERSION_EVIDENCE",
      tieBreakKey: product.productId,
    };
  }

  return {
    productId: product.productId,
    metricValue:
      product.productViews > 0
        ? product.conversions / product.productViews
        : null,
    evidenceStatus:
      product.productViews > 0
        ? "VALID"
        : "INSUFFICIENT_CONVERSION_EVIDENCE",
    tieBreakKey: product.productId,
  };
}

function rankProducts(
  config: MerchandisingHeuristicConfig,
  products: readonly MerchandisingProductObservation[],
): {
  readonly metricRows: readonly ProductMetricEvaluation[];
  readonly rankedMovableProductIds: readonly string[];
  readonly fixedPositions: Readonly<Record<string, number>>;
  readonly finalRanking: readonly {
    readonly productId: string;
    readonly position: number;
    readonly fixed: boolean;
  }[];
  readonly tieBreakResults: readonly string[];
} {
  const fixedPositions: Record<string, number> = {};
  const movable: MerchandisingProductObservation[] = [];

  for (const product of products) {
    const fixed =
      product.mandatoryPosition ?? product.pinnedPosition;
    if (fixed !== null) {
      if (Object.values(fixedPositions).includes(fixed)) {
        throw new TypeError(
          "two eligible products claim the same frozen fixed position",
        );
      }
      fixedPositions[product.productId] = fixed;
    } else {
      movable.push(product);
    }
  }

  const metricRows = movable.map((product) =>
    metricEvaluation(config, product),
  );

  const tieBreakResults: string[] = [];
  const sorted = [...metricRows].sort((left, right) => {
    const leftValid = left.evidenceStatus === "VALID";
    const rightValid = right.evidenceStatus === "VALID";
    if (leftValid !== rightValid) return leftValid ? -1 : 1;

    if (
      leftValid &&
      rightValid &&
      left.metricValue !== right.metricValue
    ) {
      return (right.metricValue ?? 0) - (left.metricValue ?? 0);
    }

    if (
      leftValid &&
      rightValid &&
      left.metricValue === right.metricValue
    ) {
      tieBreakResults.push(
        "TIE:" +
          left.productId +
          ":" +
          right.productId +
          ":PRODUCT_ID_ASC",
      );
    }

    return left.productId.localeCompare(right.productId);
  });

  const reserved = new Set(Object.values(fixedPositions));
  const openPositions: number[] = [];
  const total = products.length;
  let candidate = 1;
  while (openPositions.length < movable.length) {
    if (!reserved.has(candidate)) openPositions.push(candidate);
    candidate += 1;
    if (candidate > total + reserved.size + movable.length + 10) {
      throw new TypeError("could not allocate deterministic merchandising positions");
    }
  }

  const finalRanking = [
    ...Object.entries(fixedPositions).map(([productId, position]) => ({
      productId,
      position,
      fixed: true,
    })),
    ...sorted.map((row, index) => ({
      productId: row.productId,
      position: openPositions[index]!,
      fixed: false,
    })),
  ].sort(
    (left, right) =>
      left.position - right.position ||
      left.productId.localeCompare(right.productId),
  );

  return {
    metricRows,
    rankedMovableProductIds: sorted.map((row) => row.productId),
    fixedPositions,
    finalRanking,
    tieBreakResults: [...new Set(tieBreakResults)].sort(),
  };
}

function moveProductAction(
  config: MerchandisingHeuristicConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  product: MerchandisingProductObservation,
  position: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<ActionTarget, { readonly kind: "product" }> = {
    kind: "product",
    productId: product.productId,
  };

  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(
      "action_" +
        config.heuristicType.toLowerCase() +
        "_" +
        product.productId.replace(/[^a-zA-Z0-9_]+/g, "_") +
        "_position_" +
        position +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("merchandising.move_product"),
    actionCategory: "merchandising",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      config.heuristicType +
      " place " +
      product.productId +
      " at position " +
      position +
      " in " +
      config.targetCollectionId +
      ".",
    target,
    scope: {
      dimensions: [
        {
          kind: "product_population",
          productIds: [product.productId],
          collectionIds: [config.targetCollectionId],
        },
      ],
    },
    parameters: {
      kind: "merchandising_position",
      collectionId: config.targetCollectionId,
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
        "Execute the frozen simple merchandising metric sort without prediction, personalization, causal correction, exploration or optimization.",
      intentRef:
        "merchandising-heuristic:" + config.heuristicType,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "merchandising-heuristic:" +
        config.heuristicType +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        MERCHANDISING_HEURISTIC_OBSERVATION_KEY,
        "heuristic-config:" + configFingerprint,
      ],
    },
  });
}

function implementationFingerprint(
  heuristicType: MerchandisingHeuristicType,
): string {
  return operatorFingerprint({
    suiteVersion: MERCHANDISING_HEURISTIC_SUITE_VERSION,
    operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorVersion: MERCHANDISING_HEURISTIC_OPERATOR_VERSION,
    heuristicType,
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        MERCHANDISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: MERCHANDISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    frozenParentCommit: MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    metricSetVersion: MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
    ecommerceEconomicsVersion:
      MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
    productEconomicsVersion:
      MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
    simulatorVersion: MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
    observationKey: MERCHANDISING_HEURISTIC_OBSERVATION_KEY,
    lookbackDays: 30,
    rankingRule: "ONE_OBSERVED_HISTORICAL_METRIC_DESC_ONLY",
    legalConstraintSemantics:
      "eligible products not legally movable remain fixed at their observable current position; movable products fill only remaining open positions",
    futureInformationAccess: false,
    hiddenStateAccess: false,
    profitabilityInput: false,
    inventoryScoringInput: false,
    forecasting: false,
    personalization: false,
    positionBiasCorrection: false,
    exploration: false,
    learning: false,
  });
}

export const MERCHANDISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS =
  deepFreezeOperator({
    RANK_BY_REVENUE: implementationFingerprint("RANK_BY_REVENUE"),
    RANK_BY_CONVERSION_RATE: implementationFingerprint(
      "RANK_BY_CONVERSION_RATE",
    ),
    RANK_BY_UNITS_SOLD: implementationFingerprint(
      "RANK_BY_UNITS_SOLD",
    ),
  });

export function merchandisingHeuristicConfigurationFingerprint(
  config: MerchandisingHeuristicConfig,
): string {
  return operatorFingerprint({
    ...config,
    frozenParentCommit: MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
    metricSetVersion: MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
    ecommerceEconomicsVersion:
      MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
    productEconomicsVersion:
      MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
    simulatorVersion: MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
  });
}

export function createMerchandisingHeuristicOperator(
  config: MerchandisingHeuristicConfig,
): CanonicalOperator {
  const configFingerprint =
    merchandisingHeuristicConfigurationFingerprint(config);
  const implementation =
    MERCHANDISING_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: OPERATOR_IDS[config.heuristicType],
    operatorType: "baseline",
    operatorVersion: MERCHANDISING_HEURISTIC_OPERATOR_VERSION,
    description: DESCRIPTIONS[config.heuristicType],
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        MERCHANDISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: MERCHANDISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      suiteVersion: MERCHANDISING_HEURISTIC_SUITE_VERSION,
      heuristicType: config.heuristicType,
      configurationFingerprint: configFingerprint,
      configuration: config as unknown as OperatorJson,
      metricSetVersion: MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
      ecommerceEconomicsVersion:
        MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
      productEconomicsVersion:
        MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
      simulatorVersion: MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
      frozenParentCommit:
        MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
      prediction: false,
      personalization: false,
      causalCorrection: false,
      exploration: false,
      inventoryOptimization: false,
      profitabilityOptimization: false,
    },
    implementationFingerprint: implementation,
  });

  const evaluate = (
    input: Readonly<OperatorDecisionInput>,
  ): {
    readonly actions: readonly Action[];
    readonly audit: OperatorJson;
  } => {
    const parsed = parseObservation(input, config);
    if (!parsed.ok) {
      return deepFreezeOperator({
        actions: [],
        audit: {
          heuristicType: config.heuristicType,
          operatorId: metadata.operatorId,
          operatorVersion: metadata.operatorVersion,
          implementationFingerprint: implementation,
          configurationFingerprint: configFingerprint,
          configuration: config as unknown as OperatorJson,
          dependencies: {
            evaluationContractFingerprint:
              MERCHANDISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
            evaluationContractFrozenCommit:
              MERCHANDISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
            frozenParentCommit:
              MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
            actionOntologyVersion: ACTION_SCHEMA_VERSION,
            metricSetVersion:
              MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
            ecommerceEconomicsVersion:
              MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
            productEconomicsVersion:
              MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
            simulatorVersion:
              MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
          },
          observationStatus: parsed.reason,
          targetCollectionId: config.targetCollectionId,
          lookbackDays: config.lookbackDays,
          eligibleProducts: [],
          observedMetrics: [],
          evidenceSufficiency: [],
          tieBreakResults: [],
          proposedRanking: [],
          proposedActionIds: [],
          fallbackReason: parsed.reason,
          simulatorCompatibility:
            "compatible_legacy_merchandising_position_single_surface_fixture",
        } as OperatorJson,
      });
    }

    const legalIds = legallyMovableProductIds(input);
    const eligible = parsed.payload.products.filter(
      (product) =>
        product.collectionMember &&
        product.active &&
        product.available &&
        product.merchandisingEligible &&
        !product.excluded,
    );

    const fixedEligible = eligible.filter(
      (product) =>
        product.pinnedPosition !== null ||
        product.mandatoryPosition !== null,
    );

    const actionSpaceFixedEligible = eligible
      .filter(
        (product) =>
          product.pinnedPosition === null &&
          product.mandatoryPosition === null &&
          !legalIds.has(product.productId) &&
          product.currentPosition !== null,
      )
      .map((product) => ({
        ...product,
        mandatoryPosition: product.currentPosition,
      }));

    const movableEligible = eligible.filter(
      (product) =>
        product.pinnedPosition === null &&
        product.mandatoryPosition === null &&
        legalIds.has(product.productId),
    );

    const productsForRanking = [
      ...fixedEligible,
      ...actionSpaceFixedEligible,
      ...movableEligible,
    ].sort((left, right) =>
      left.productId.localeCompare(right.productId),
    );

    if (productsForRanking.length === 0) {
      return deepFreezeOperator({
        actions: [],
        audit: {
          heuristicType: config.heuristicType,
          operatorId: metadata.operatorId,
          operatorVersion: metadata.operatorVersion,
          implementationFingerprint: implementation,
          configurationFingerprint: configFingerprint,
          configuration: config as unknown as OperatorJson,
          dependencies: {
            evaluationContractFingerprint:
              MERCHANDISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
            frozenParentCommit:
              MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
            actionOntologyVersion: ACTION_SCHEMA_VERSION,
            metricSetVersion:
              MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
            ecommerceEconomicsVersion:
              MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
            productEconomicsVersion:
              MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
            simulatorVersion:
              MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
          },
          observationStatus: "AVAILABLE",
          targetCollectionId: config.targetCollectionId,
          lookbackDays: config.lookbackDays,
          eligibleProducts: [],
          observedMetrics: [],
          evidenceSufficiency: [],
          tieBreakResults: [],
          proposedRanking: [],
          proposedActionIds: [],
          fallbackReason: "NO_ELIGIBLE_PRODUCTS",
          simulatorCompatibility:
            "compatible_legacy_merchandising_position_single_surface_fixture",
        } as OperatorJson,
      });
    }

    const ranked = rankProducts(config, productsForRanking);
    const rule = legalRule(input);
    const actions: Action[] = [];
    let fallbackReason: string | null = null;

    for (const row of ranked.finalRanking) {
      if (row.fixed) continue;
      const product = parsed.byProduct.get(row.productId)!;
      if (!legalIds.has(row.productId) || rule === undefined) {
        fallbackReason = "RANKING_ACTION_UNAVAILABLE";
        break;
      }
      if (product.currentPosition === row.position) {
        continue;
      }
      const action = moveProductAction(
        config,
        configFingerprint,
        input,
        product,
        row.position,
      );
      if (!actionWithinAvailabilityBounds(action, rule)) {
        fallbackReason = "RANKING_ACTION_OUTSIDE_LEGAL_BOUNDS";
        break;
      }
      actions.push(action);
    }

    if (fallbackReason !== null) {
      actions.length = 0;
    }

    const metricByProduct = new Map(
      ranked.metricRows.map((row) => [row.productId, row]),
    );

    const observedMetrics = productsForRanking.map((product) => {
      const fixed =
        product.pinnedPosition !== null ||
        product.mandatoryPosition !== null;
      const metric = fixed
        ? metricEvaluation(config, product)
        : metricByProduct.get(product.productId)!;
      return {
        productId: product.productId,
        metricValue: metric.metricValue,
      };
    });

    const evidenceSufficiency = productsForRanking.map((product) => {
      const fixed =
        product.pinnedPosition !== null ||
        product.mandatoryPosition !== null;
      const metric = fixed
        ? metricEvaluation(config, product)
        : metricByProduct.get(product.productId)!;
      return {
        productId: product.productId,
        status: metric.evidenceStatus,
        newlyLaunched: product.newlyLaunched,
      };
    });

    const excludedByEligibility = parsed.payload.products
      .filter((product) => !productsForRanking.some(
        (entry) => entry.productId === product.productId,
      ))
      .map((product) => ({
        productId: product.productId,
        collectionMember: product.collectionMember,
        active: product.active,
        available: product.available,
        merchandisingEligible: product.merchandisingEligible,
        excluded: product.excluded,
        legallyMovable:
          legalIds.has(product.productId),
      }));

    return deepFreezeOperator({
      actions,
      audit: {
        heuristicType: config.heuristicType,
        operatorId: metadata.operatorId,
        operatorVersion: metadata.operatorVersion,
        implementationFingerprint: implementation,
        configurationFingerprint: configFingerprint,
        configuration: config as unknown as OperatorJson,
        dependencies: {
          evaluationContractFingerprint:
            MERCHANDISING_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
          evaluationContractFrozenCommit:
            MERCHANDISING_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
          frozenParentCommit:
            MERCHANDISING_HEURISTIC_FROZEN_STEP_3_6_COMMIT,
          actionOntologyVersion: ACTION_SCHEMA_VERSION,
          metricSetVersion:
            MERCHANDISING_HEURISTIC_METRIC_SET_VERSION,
          ecommerceEconomicsVersion:
            MERCHANDISING_HEURISTIC_ECOMMERCE_ECONOMICS_VERSION,
          productEconomicsVersion:
            MERCHANDISING_HEURISTIC_PRODUCT_ECONOMICS_VERSION,
          simulatorVersion:
            MERCHANDISING_HEURISTIC_SIMULATOR_VERSION,
        },
        observationStatus: "AVAILABLE",
        targetCollectionId: config.targetCollectionId,
        targetSurface: config.targetSurface,
        lookbackDays: config.lookbackDays,
        windowStart: parsed.payload.windowStart,
        windowEnd: parsed.payload.windowEnd,
        metricId: config.metricId,
        eligibleProducts: productsForRanking.map(
          (product) => product.productId,
        ),
        excludedByEligibility,
        observedMetrics,
        evidenceSufficiency,
        fixedPositions: ranked.fixedPositions,
        tieBreakResults: ranked.tieBreakResults,
        rankedMovableProductIds:
          ranked.rankedMovableProductIds,
        proposedRanking: ranked.finalRanking,
        proposedActionIds: actions.map((action) =>
          String(action.actionId),
        ),
        fallbackReason:
          fallbackReason ??
          (actions.length === 0
            ? "RANKING_ALREADY_MATCHES_OR_FIXED"
            : null),
        simulatorCompatibility:
          "compatible_legacy_merchandising_position_single_surface_fixture",
        simulatorQualification:
          "legacy merchandising_position translates product position but does not preserve the richer Step 7 surface/container/displacement semantics; Step 3.7 freezes a single collection benchmark using the legacy canonical move_product contract",
      } as OperatorJson,
    });
  };

  return deepFreezeOperator({
    metadata,
    decide(
      input: Readonly<OperatorDecisionInput>,
    ): OperatorDecisionOutput {
      return { actions: evaluate(input).actions };
    },
    auditDecision(
      input: Readonly<OperatorDecisionInput>,
      output: Readonly<OperatorDecisionOutput>,
    ): OperatorDecisionAudit {
      const decision = evaluate(input);
      if (
        stableOperatorJson(output.actions) !==
        stableOperatorJson(decision.actions)
      ) {
        throw new TypeError(
          "merchandising heuristic audit does not match decision output",
        );
      }
      return {
        auditType: "merchandising_heuristic_evaluation",
        payload: decision.audit,
      };
    },
  });
}

export const RANK_BY_REVENUE_OPERATOR =
  createMerchandisingHeuristicOperator(RANK_BY_REVENUE_CONFIG);

export const RANK_BY_CONVERSION_RATE_OPERATOR =
  createMerchandisingHeuristicOperator(
    RANK_BY_CONVERSION_RATE_CONFIG,
  );

export const RANK_BY_UNITS_SOLD_OPERATOR =
  createMerchandisingHeuristicOperator(RANK_BY_UNITS_SOLD_CONFIG);

export const MERCHANDISING_HEURISTIC_BASELINE_OPERATORS =
  deepFreezeOperator({
    RANK_BY_REVENUE: RANK_BY_REVENUE_OPERATOR,
    RANK_BY_CONVERSION_RATE:
      RANK_BY_CONVERSION_RATE_OPERATOR,
    RANK_BY_UNITS_SOLD: RANK_BY_UNITS_SOLD_OPERATOR,
  });
