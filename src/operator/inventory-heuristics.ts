import { actionId, actionType } from "../action_ontology/identity.js";
import { reorderSkuB50SupplierX } from "../inventory/fixtures.js";
import { stopCollectionXAutomatic15 } from "../promotion/fixtures.js";
import {
  ACTION_SCHEMA_VERSION,
  type Action,
  type ActionTarget,
  type InventorySupplierConstraints,
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

export const INVENTORY_HEURISTIC_SUITE_VERSION = "1.0.0" as const;
export const INVENTORY_HEURISTIC_OPERATOR_VERSION = "1.0.0" as const;
export const INVENTORY_HEURISTIC_CONFIGURATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const INVENTORY_HEURISTIC_OBSERVATION_SCHEMA_VERSION =
  "1.0.0" as const;
export const INVENTORY_HEURISTIC_OBSERVATION_KEY =
  "inventory.sku_state.v1" as const;

export const INVENTORY_HEURISTIC_FROZEN_STEP_3_1_COMMIT =
  "c74e9a4ba32f16aa016f06782cbb60e07e765af6" as const;
export const INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT =
  "3bb897f870c9786933cace0c5fcded978710ec36" as const;
export const INVENTORY_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT =
  "fnv1a64:b1cc22917a3e566b" as const;
export const INVENTORY_HEURISTIC_METRIC_SET_VERSION = "1.0.0" as const;
export const INVENTORY_HEURISTIC_SIMULATOR_VERSION =
  "customer-journey-simulator-4.0.0" as const;

export type InventoryHeuristicType =
  | "FIXED_REORDER_THRESHOLD"
  | "FIXED_REORDER_QUANTITY"
  | "LOW_INVENTORY_DEPROMOTION"
  | "NO_INVENTORY_AWARE_INTERVENTION";

export interface InventorySkuObservation {
  readonly skuId: string;
  readonly productId: string;
  readonly active: boolean;
  readonly discontinued: boolean;
  readonly availableUnits: number | null;
  readonly incomingUnits: number | null;
  readonly pendingReorder: boolean | null;
  readonly observableReorderTriggered: boolean | null;
  readonly existingReorderQuantityUnits: number | null;
  readonly supplierAvailable: boolean | null;
  readonly activePromotionIds: readonly string[];
}

export interface InventoryObservationPayload {
  readonly schemaVersion: typeof INVENTORY_HEURISTIC_OBSERVATION_SCHEMA_VERSION;
  readonly availabilityConcept: "AVAILABLE_TO_SELL";
  readonly skus: readonly InventorySkuObservation[];
}

interface InventoryHeuristicConfigBase {
  readonly configurationSchemaVersion:
    typeof INVENTORY_HEURISTIC_CONFIGURATION_SCHEMA_VERSION;
  readonly heuristicType: InventoryHeuristicType;
  readonly observationKey: typeof INVENTORY_HEURISTIC_OBSERVATION_KEY;
  readonly availabilityConcept: "AVAILABLE_TO_SELL";
  readonly skuOrder: readonly string[];
  readonly missingDataBehavior: "NO_NEW_INVENTORY_ACTION";
  readonly unavailableSkuBehavior: "NO_NEW_INVENTORY_ACTION";
  readonly discontinuedSkuBehavior: "NO_NEW_INVENTORY_ACTION";
  readonly supplierUnavailableBehavior: "NO_NEW_INVENTORY_ACTION";
  readonly constraintRejectionBehavior: "RECORD_REJECTION_NO_REPAIR";
  readonly partialFeasibilityBehavior:
    "EXPLICIT_EVALUATOR_MODIFICATION_ONLY";
}

export interface ReorderExecutionConfig {
  readonly supplierRelationshipId: string;
  readonly destinationLocationId: string;
  readonly leadTimeDays: number;
  readonly supplierConstraints: InventorySupplierConstraints;
  readonly maximumPostReceiptInventoryUnits: number;
  readonly inboundInventoryBehavior:
    "SKIP_WHEN_PENDING_REORDER_OR_INCOMING_UNITS_POSITIVE";
}

export interface FixedReorderThresholdConfig
  extends InventoryHeuristicConfigBase,
    ReorderExecutionConfig {
  readonly heuristicType: "FIXED_REORDER_THRESHOLD";
  readonly applicableSkuIds: readonly string[];
  readonly thresholdUnits: number;
  readonly thresholdComparison: "LT";
  readonly reorderQuantitySource:
    "OBSERVED_EXISTING_REORDER_QUANTITY";
}

export interface FixedReorderQuantityConfig
  extends InventoryHeuristicConfigBase,
    ReorderExecutionConfig {
  readonly heuristicType: "FIXED_REORDER_QUANTITY";
  readonly applicableSkuIds: readonly string[];
  readonly triggerSource: "OBSERVABLE_REORDER_TRIGGER";
  readonly reorderQuantityUnits: number;
}

export interface LowInventoryDepromotionConfig
  extends InventoryHeuristicConfigBase {
  readonly heuristicType: "LOW_INVENTORY_DEPROMOTION";
  readonly applicableSkuIds: readonly string[];
  readonly lowInventoryThresholdUnits: number;
  readonly thresholdComparison: "LT";
  readonly intervention: "STOP_CONFIGURED_PROMOTION";
  readonly promotionId: string;
  readonly restorationBehavior: "NO_AUTOMATIC_RESTORATION";
  readonly minimumDurationSeconds: 0;
}

export interface NoInventoryAwareInterventionConfig
  extends InventoryHeuristicConfigBase {
  readonly heuristicType: "NO_INVENTORY_AWARE_INTERVENTION";
  readonly inventoryPolicyEffect:
    "INVENTORY_CONDITIONS_NEVER_CREATE_DISCRETIONARY_ACTION";
}

export type InventoryHeuristicConfig =
  | FixedReorderThresholdConfig
  | FixedReorderQuantityConfig
  | LowInventoryDepromotionConfig
  | NoInventoryAwareInterventionConfig;

const COMMON_CONFIGURATION = {
  configurationSchemaVersion:
    INVENTORY_HEURISTIC_CONFIGURATION_SCHEMA_VERSION,
  observationKey: INVENTORY_HEURISTIC_OBSERVATION_KEY,
  availabilityConcept: "AVAILABLE_TO_SELL",
  skuOrder: ["sku:B"],
  missingDataBehavior: "NO_NEW_INVENTORY_ACTION",
  unavailableSkuBehavior: "NO_NEW_INVENTORY_ACTION",
  discontinuedSkuBehavior: "NO_NEW_INVENTORY_ACTION",
  supplierUnavailableBehavior: "NO_NEW_INVENTORY_ACTION",
  constraintRejectionBehavior: "RECORD_REJECTION_NO_REPAIR",
  partialFeasibilityBehavior: "EXPLICIT_EVALUATOR_MODIFICATION_ONLY",
} as const;

const REORDER_EXECUTION = {
  supplierRelationshipId: "supplier:vendor-x:sku-b",
  destinationLocationId: "warehouse:montreal",
  leadTimeDays: 14,
  supplierConstraints: {
    minimumOrderQuantity: 10,
    orderMultiple: 10,
    maximumSupplierQuantity: 100,
  },
  maximumPostReceiptInventoryUnits: 200,
  inboundInventoryBehavior:
    "SKIP_WHEN_PENDING_REORDER_OR_INCOMING_UNITS_POSITIVE",
} as const;

export const FIXED_REORDER_THRESHOLD_CONFIG: FixedReorderThresholdConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    ...REORDER_EXECUTION,
    heuristicType: "FIXED_REORDER_THRESHOLD",
    applicableSkuIds: ["sku:B"],
    thresholdUnits: 10,
    thresholdComparison: "LT",
    reorderQuantitySource: "OBSERVED_EXISTING_REORDER_QUANTITY",
  });

export const FIXED_REORDER_QUANTITY_CONFIG: FixedReorderQuantityConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    ...REORDER_EXECUTION,
    heuristicType: "FIXED_REORDER_QUANTITY",
    applicableSkuIds: ["sku:B"],
    triggerSource: "OBSERVABLE_REORDER_TRIGGER",
    reorderQuantityUnits: 50,
  });

export const LOW_INVENTORY_DEPROMOTION_CONFIG: LowInventoryDepromotionConfig =
  deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "LOW_INVENTORY_DEPROMOTION",
    applicableSkuIds: ["sku:B"],
    lowInventoryThresholdUnits: 5,
    thresholdComparison: "LT",
    intervention: "STOP_CONFIGURED_PROMOTION",
    promotionId: "promo_collection_x_auto_15",
    restorationBehavior: "NO_AUTOMATIC_RESTORATION",
    minimumDurationSeconds: 0,
  });

export const NO_INVENTORY_AWARE_INTERVENTION_CONFIG:
  NoInventoryAwareInterventionConfig = deepFreezeOperator({
    ...COMMON_CONFIGURATION,
    heuristicType: "NO_INVENTORY_AWARE_INTERVENTION",
    inventoryPolicyEffect:
      "INVENTORY_CONDITIONS_NEVER_CREATE_DISCRETIONARY_ACTION",
  });

export const FROZEN_INVENTORY_HEURISTIC_CONFIGURATIONS =
  deepFreezeOperator({
    FIXED_REORDER_THRESHOLD: FIXED_REORDER_THRESHOLD_CONFIG,
    FIXED_REORDER_QUANTITY: FIXED_REORDER_QUANTITY_CONFIG,
    LOW_INVENTORY_DEPROMOTION: LOW_INVENTORY_DEPROMOTION_CONFIG,
    NO_INVENTORY_AWARE_INTERVENTION:
      NO_INVENTORY_AWARE_INTERVENTION_CONFIG,
  });

const OPERATOR_IDS: Readonly<Record<InventoryHeuristicType, string>> =
  deepFreezeOperator({
    FIXED_REORDER_THRESHOLD:
      "baseline.inventory.fixed_reorder_threshold",
    FIXED_REORDER_QUANTITY:
      "baseline.inventory.fixed_reorder_quantity",
    LOW_INVENTORY_DEPROMOTION:
      "baseline.inventory.low_inventory_depromotion",
    NO_INVENTORY_AWARE_INTERVENTION:
      "baseline.inventory.no_inventory_aware_intervention",
  });

const DESCRIPTIONS: Readonly<Record<InventoryHeuristicType, string>> =
  deepFreezeOperator({
    FIXED_REORDER_THRESHOLD:
      "Simple inventory baseline that reorders using the observable merchant reorder quantity when available-to-sell units fall strictly below a frozen threshold.",
    FIXED_REORDER_QUANTITY:
      "Simple inventory baseline that orders a frozen quantity when an observable reorder trigger is already present.",
    LOW_INVENTORY_DEPROMOTION:
      "Simple inventory-protection baseline that stops one configured promotion when observable inventory falls strictly below a frozen threshold.",
    NO_INVENTORY_AWARE_INTERVENTION:
      "Domain-specific control baseline in which observable inventory conditions never create discretionary Actions.",
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

function stableSkuSort(
  skuIds: readonly string[],
  order: readonly string[],
): string[] {
  return [...skuIds].sort((left, right) => {
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    const leftRank =
      leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank =
      rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return leftRank - rightRank || left.localeCompare(right);
  });
}

function parseObservation(
  input: Readonly<OperatorDecisionInput>,
  config: InventoryHeuristicConfig,
):
  | {
      readonly ok: true;
      readonly payload: InventoryObservationPayload;
      readonly bySku: ReadonlyMap<string, InventorySkuObservation>;
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
    value["schemaVersion"] !== INVENTORY_HEURISTIC_OBSERVATION_SCHEMA_VERSION ||
    value["availabilityConcept"] !== config.availabilityConcept ||
    !Array.isArray(value["skus"])
  ) {
    return { ok: false, reason: "OBSERVATION_SCHEMA_INVALID" };
  }

  const skus: InventorySkuObservation[] = [];
  const seen = new Set<string>();
  for (const raw of value["skus"]) {
    if (
      !isRecord(raw) ||
      typeof raw["skuId"] !== "string" ||
      raw["skuId"].trim().length === 0 ||
      typeof raw["productId"] !== "string" ||
      raw["productId"].trim().length === 0 ||
      typeof raw["active"] !== "boolean" ||
      typeof raw["discontinued"] !== "boolean" ||
      !(
        raw["availableUnits"] === null ||
        finiteNonNegativeInteger(raw["availableUnits"])
      ) ||
      !(
        raw["incomingUnits"] === null ||
        finiteNonNegativeInteger(raw["incomingUnits"])
      ) ||
      !(
        raw["pendingReorder"] === null ||
        typeof raw["pendingReorder"] === "boolean"
      ) ||
      !(
        raw["observableReorderTriggered"] === null ||
        typeof raw["observableReorderTriggered"] === "boolean"
      ) ||
      !(
        raw["existingReorderQuantityUnits"] === null ||
        finiteNonNegativeInteger(raw["existingReorderQuantityUnits"])
      ) ||
      !(
        raw["supplierAvailable"] === null ||
        typeof raw["supplierAvailable"] === "boolean"
      ) ||
      !Array.isArray(raw["activePromotionIds"]) ||
      raw["activePromotionIds"].some(
        (promotionId) =>
          typeof promotionId !== "string" || promotionId.trim().length === 0,
      )
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
      discontinued: raw["discontinued"],
      availableUnits: raw["availableUnits"],
      incomingUnits: raw["incomingUnits"],
      pendingReorder: raw["pendingReorder"],
      observableReorderTriggered: raw["observableReorderTriggered"],
      existingReorderQuantityUnits: raw["existingReorderQuantityUnits"],
      supplierAvailable: raw["supplierAvailable"],
      activePromotionIds: [...raw["activePromotionIds"]],
    });
  }

  const payload: InventoryObservationPayload = {
    schemaVersion: INVENTORY_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
    availabilityConcept: config.availabilityConcept,
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
    (candidate) => stableOperatorJson(candidate) === stableOperatorJson(target),
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

function supplierQuantityValid(
  quantity: number,
  constraints: InventorySupplierConstraints,
): boolean {
  if (
    constraints.minimumOrderQuantity !== undefined &&
    quantity < constraints.minimumOrderQuantity
  ) {
    return false;
  }
  if (
    constraints.maximumSupplierQuantity !== undefined &&
    quantity > constraints.maximumSupplierQuantity
  ) {
    return false;
  }
  if (
    constraints.orderMultiple !== undefined &&
    quantity % constraints.orderMultiple !== 0
  ) {
    return false;
  }
  return true;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function reorderAction(
  config: FixedReorderThresholdConfig | FixedReorderQuantityConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
  sku: InventorySkuObservation,
  quantity: number,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  const target: Extract<ActionTarget, { readonly kind: "sku" }> = {
    kind: "sku",
    productId: sku.productId,
    skuId: sku.skuId,
  };
  return assertValidAction({
    ...reorderSkuB50SupplierX,
    actionId: actionId(
      "action_" +
        config.heuristicType.toLowerCase() +
        "_" +
        sanitizeId(sku.skuId) +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("inventory.reorder"),
    actionCategory: "inventory",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      config.heuristicType +
      " reorder " +
      quantity +
      " units of " +
      sku.skuId +
      ".",
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
      kind: "inventory_reorder",
      reorder: {
        sku: target,
        quantity,
        supplierRelationshipId: config.supplierRelationshipId,
        destinationLocationId: config.destinationLocationId,
        orderPlacementTime: decisionTime,
        leadTimeAssumption: {
          durationSeconds: config.leadTimeDays * 24 * 60 * 60,
          sourceRef:
            "heuristic-config:" + configFingerprint + ":lead-time",
        },
        supplierConstraints: config.supplierConstraints,
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
        "Execute the frozen simple inventory heuristic without forecasting, optimization or hidden simulator state.",
      intentRef: "inventory-heuristic:" + config.heuristicType,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "inventory-heuristic:" +
        config.heuristicType +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        INVENTORY_HEURISTIC_OBSERVATION_KEY,
        "heuristic-config:" + configFingerprint,
      ],
    },
  });
}

function depromotionAction(
  config: LowInventoryDepromotionConfig,
  configFingerprint: string,
  input: Readonly<OperatorDecisionInput>,
): Action {
  const decisionTime = utcTimestamp(input.decisionTime);
  return assertValidAction({
    ...stopCollectionXAutomatic15,
    actionId: actionId(
      "action_low_inventory_depromotion_" +
        sanitizeId(config.promotionId) +
        "_" +
        input.decisionTime.replace(/[^0-9]/g, ""),
    ),
    actionType: actionType("promotion.stop"),
    actionCategory: "promotion",
    schemaVersion: ACTION_SCHEMA_VERSION,
    description:
      "Stop configured promotion " +
      config.promotionId +
      " because observable inventory is below the frozen low-inventory threshold.",
    target: {
      kind: "promotion",
      promotionId: config.promotionId,
    },
    parameters: {
      kind: "promotion_stop",
      targetPromotionId: config.promotionId,
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
        "Execute the frozen low-inventory depromotion rule without predicting demand or optimizing sell-through.",
      intentRef: "inventory-heuristic:" + config.heuristicType,
    },
    provenance: {
      source: "rule_based_baseline",
      sourceId:
        "inventory-heuristic:" +
        config.heuristicType +
        "@1.0.0:" +
        configFingerprint,
      createdAt: decisionTime,
      evidenceRefs: [
        INVENTORY_HEURISTIC_OBSERVATION_KEY,
        "heuristic-config:" + configFingerprint,
      ],
    },
  });
}

interface SkuAudit {
  readonly skuId: string;
  readonly productId: string;
  readonly active: boolean;
  readonly discontinued: boolean;
  readonly availableUnits: number | null;
  readonly incomingUnits: number | null;
  readonly pendingReorder: boolean | null;
  readonly observableReorderTriggered: boolean | null;
  readonly existingReorderQuantityUnits: number | null;
  readonly supplierAvailable: boolean | null;
  readonly activePromotionIds: readonly string[];
  readonly applicable: boolean;
}

interface InventoryHeuristicEvaluation {
  readonly actions: readonly Action[];
  readonly audit: {
    readonly heuristicType: InventoryHeuristicType;
    readonly operatorId: string;
    readonly operatorVersion: string;
    readonly implementationFingerprint: string;
    readonly configurationFingerprint: string;
    readonly configuration: OperatorJson;
    readonly dependencies: OperatorJson;
    readonly observationStatus: string;
    readonly skus: readonly SkuAudit[];
    readonly evaluatedSkuIds: readonly string[];
    readonly thresholdUnits: number | null;
    readonly configuredReorderQuantityUnits: number | null;
    readonly reorderQuantitySource: string | null;
    readonly triggerResult: string;
    readonly lowStockState: boolean | null;
    readonly inboundState: string | null;
    readonly proposedActionIds: readonly string[];
    readonly fallbackReason: string | null;
    readonly simulatorCompatibility:
      | "compatible_no_required_intervention"
      | "incompatible_required_inventory_reorder"
      | "incompatible_required_promotion_stop";
  };
}

function implementationFingerprint(
  heuristicType: InventoryHeuristicType,
): string {
  return operatorFingerprint({
    suiteVersion: INVENTORY_HEURISTIC_SUITE_VERSION,
    operatorInterfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorVersion: INVENTORY_HEURISTIC_OPERATOR_VERSION,
    heuristicType,
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        INVENTORY_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    frozenParentCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    metricSetVersion: INVENTORY_HEURISTIC_METRIC_SET_VERSION,
    simulatorVersion: INVENTORY_HEURISTIC_SIMULATOR_VERSION,
    observationSemantics: {
      key: INVENTORY_HEURISTIC_OBSERVATION_KEY,
      schemaVersion: INVENTORY_HEURISTIC_OBSERVATION_SCHEMA_VERSION,
      hiddenStateAccess: false,
      futureInformationAccess: false,
    },
    decisionDomain:
      "inventory_conditions_and_explicit_low_inventory_protection_only",
    optimization: false,
    forecasting: false,
    learning: false,
  });
}

export const INVENTORY_HEURISTIC_IMPLEMENTATION_FINGERPRINTS =
  deepFreezeOperator({
    FIXED_REORDER_THRESHOLD: implementationFingerprint(
      "FIXED_REORDER_THRESHOLD",
    ),
    FIXED_REORDER_QUANTITY: implementationFingerprint(
      "FIXED_REORDER_QUANTITY",
    ),
    LOW_INVENTORY_DEPROMOTION: implementationFingerprint(
      "LOW_INVENTORY_DEPROMOTION",
    ),
    NO_INVENTORY_AWARE_INTERVENTION: implementationFingerprint(
      "NO_INVENTORY_AWARE_INTERVENTION",
    ),
  });

export function inventoryHeuristicConfigurationFingerprint(
  config: InventoryHeuristicConfig,
): string {
  return operatorFingerprint({
    ...config,
    frozenParentCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
    metricSetVersion: INVENTORY_HEURISTIC_METRIC_SET_VERSION,
    simulatorVersion: INVENTORY_HEURISTIC_SIMULATOR_VERSION,
  });
}

function evaluate(
  config: InventoryHeuristicConfig,
  input: Readonly<OperatorDecisionInput>,
): InventoryHeuristicEvaluation {
  const configFingerprint =
    inventoryHeuristicConfigurationFingerprint(config);
  const implFingerprint =
    INVENTORY_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];
  const parsed = parseObservation(input, config);
  let observationStatus = parsed.ok ? "AVAILABLE" : parsed.reason;
  let skuAudits: SkuAudit[] = [];
  let evaluatedSkuIds: string[] = [];
  let triggerResult = "NO_TRIGGER";
  let lowStockState: boolean | null = null;
  let inboundState: string | null = null;
  let fallbackReason: string | null = null;
  let simulatorCompatibility:
    InventoryHeuristicEvaluation["audit"]["simulatorCompatibility"] =
      "compatible_no_required_intervention";
  const actions: Action[] = [];

  if (!parsed.ok) {
    fallbackReason = parsed.reason;
  } else {
    const applicableSkuIds =
      "applicableSkuIds" in config
        ? stableSkuSort(config.applicableSkuIds, config.skuOrder)
        : stableSkuSort(
            parsed.payload.skus.map((sku) => sku.skuId),
            config.skuOrder,
          );

    skuAudits = stableSkuSort(
      parsed.payload.skus.map((sku) => sku.skuId),
      config.skuOrder,
    ).map((skuId) => {
      const sku = parsed.bySku.get(skuId)!;
      return {
        ...sku,
        applicable: applicableSkuIds.includes(skuId),
      };
    });

    if (config.heuristicType === "NO_INVENTORY_AWARE_INTERVENTION") {
      evaluatedSkuIds = applicableSkuIds;
      triggerResult = "INVENTORY_STATE_INTENTIONALLY_IGNORED";
      fallbackReason = "DOMAIN_CONTROL_NO_INVENTORY_AWARE_ACTION";
    } else {
      for (const skuId of applicableSkuIds) {
        const sku = parsed.bySku.get(skuId);
        if (sku === undefined) {
          fallbackReason = "APPLICABLE_SKU_OBSERVATION_MISSING";
          continue;
        }
        evaluatedSkuIds.push(skuId);
        if (!sku.active) {
          fallbackReason = "SKU_INACTIVE";
          continue;
        }
        if (sku.discontinued) {
          fallbackReason = "SKU_DISCONTINUED";
          continue;
        }

        if (
          config.heuristicType === "FIXED_REORDER_THRESHOLD" ||
          config.heuristicType === "FIXED_REORDER_QUANTITY"
        ) {
          if (sku.availableUnits === null) {
            fallbackReason = "AVAILABLE_INVENTORY_MISSING";
            continue;
          }
          if (
            sku.pendingReorder === null ||
            sku.incomingUnits === null
          ) {
            fallbackReason = "INBOUND_REORDER_STATE_MISSING";
            continue;
          }
          inboundState =
            sku.pendingReorder || sku.incomingUnits > 0
              ? "PENDING_OR_INCOMING"
              : "CLEAR";
          if (sku.pendingReorder || sku.incomingUnits > 0) {
            fallbackReason = "PENDING_REPLENISHMENT_SUPPRESSES_REORDER";
            continue;
          }
          if (sku.supplierAvailable !== true) {
            fallbackReason =
              sku.supplierAvailable === false
                ? "SUPPLIER_UNAVAILABLE"
                : "SUPPLIER_AVAILABILITY_MISSING";
            continue;
          }

          let quantity: number | null = null;
          if (config.heuristicType === "FIXED_REORDER_THRESHOLD") {
            lowStockState = sku.availableUnits < config.thresholdUnits;
            if (!lowStockState) {
              triggerResult =
                sku.availableUnits === config.thresholdUnits
                  ? "EXACTLY_AT_THRESHOLD_NO_TRIGGER"
                  : "ABOVE_THRESHOLD_NO_TRIGGER";
              continue;
            }
            triggerResult = "BELOW_THRESHOLD_TRIGGERED";
            if (sku.existingReorderQuantityUnits === null) {
              fallbackReason = "EXISTING_REORDER_QUANTITY_MISSING";
              continue;
            }
            quantity = sku.existingReorderQuantityUnits;
          } else {
            if (sku.observableReorderTriggered !== true) {
              triggerResult =
                sku.observableReorderTriggered === false
                  ? "OBSERVABLE_REORDER_TRIGGER_FALSE"
                  : "OBSERVABLE_REORDER_TRIGGER_MISSING";
              if (sku.observableReorderTriggered === null) {
                fallbackReason = "OBSERVABLE_REORDER_TRIGGER_MISSING";
              }
              continue;
            }
            triggerResult = "OBSERVABLE_REORDER_TRIGGERED";
            quantity = config.reorderQuantityUnits;
          }

          if (!supplierQuantityValid(quantity, config.supplierConstraints)) {
            fallbackReason = "FIXED_QUANTITY_VIOLATES_SUPPLIER_CONSTRAINTS";
            continue;
          }
          if (
            sku.availableUnits +
              sku.incomingUnits +
              quantity >
            config.maximumPostReceiptInventoryUnits
          ) {
            fallbackReason = "MAXIMUM_POST_RECEIPT_INVENTORY_EXCEEDED";
            continue;
          }

          const target: Extract<ActionTarget, { readonly kind: "sku" }> = {
            kind: "sku",
            productId: sku.productId,
            skuId: sku.skuId,
          };
          const rule = legalRule(input, "inventory.reorder");
          if (!targetEligible(rule, target) || rule === undefined) {
            fallbackReason = "INVENTORY_REORDER_ACTION_UNAVAILABLE";
            continue;
          }
          const action = reorderAction(
            config,
            configFingerprint,
            input,
            sku,
            quantity,
          );
          if (!actionWithinAvailabilityBounds(action, rule)) {
            fallbackReason = "INVENTORY_REORDER_OUTSIDE_LEGAL_BOUNDS";
            continue;
          }
          actions.push(action);
          simulatorCompatibility = "incompatible_required_inventory_reorder";
          break;
        }

        if (config.heuristicType === "LOW_INVENTORY_DEPROMOTION") {
          if (sku.availableUnits === null) {
            fallbackReason = "AVAILABLE_INVENTORY_MISSING";
            continue;
          }
          lowStockState =
            sku.availableUnits < config.lowInventoryThresholdUnits;
          if (!lowStockState) {
            triggerResult =
              sku.availableUnits === config.lowInventoryThresholdUnits
                ? "EXACTLY_AT_THRESHOLD_NO_DEPROMOTION"
                : "HEALTHY_INVENTORY_NO_DEPROMOTION";
            continue;
          }
          triggerResult = "LOW_INVENTORY_DEPROMOTION_TRIGGERED";
          if (!sku.activePromotionIds.includes(config.promotionId)) {
            fallbackReason = "CONFIGURED_PROMOTION_NOT_ACTIVE";
            continue;
          }
          const promotionTarget: Extract<
            ActionTarget,
            { readonly kind: "promotion" }
          > = {
            kind: "promotion",
            promotionId: config.promotionId,
          };
          const rule = legalRule(input, "promotion.stop");
          if (
            !targetEligible(rule, promotionTarget) ||
            rule === undefined
          ) {
            fallbackReason = "PROMOTION_STOP_ACTION_UNAVAILABLE";
            continue;
          }
          const action = depromotionAction(
            config,
            configFingerprint,
            input,
          );
          if (!actionWithinAvailabilityBounds(action, rule)) {
            fallbackReason = "PROMOTION_STOP_OUTSIDE_LEGAL_BOUNDS";
            continue;
          }
          actions.push(action);
          simulatorCompatibility = "incompatible_required_promotion_stop";
          break;
        }
      }
    }
  }

  if (
    actions.length === 0 &&
    fallbackReason === null &&
    config.heuristicType !== "NO_INVENTORY_AWARE_INTERVENTION"
  ) {
    fallbackReason = "RULE_REQUIRED_NO_DISCRETIONARY_CHANGE";
  }

  const thresholdUnits =
    config.heuristicType === "FIXED_REORDER_THRESHOLD"
      ? config.thresholdUnits
      : config.heuristicType === "LOW_INVENTORY_DEPROMOTION"
        ? config.lowInventoryThresholdUnits
        : null;

  const configuredReorderQuantityUnits =
    config.heuristicType === "FIXED_REORDER_QUANTITY"
      ? config.reorderQuantityUnits
      : null;

  const reorderQuantitySource =
    config.heuristicType === "FIXED_REORDER_THRESHOLD"
      ? config.reorderQuantitySource
      : config.heuristicType === "FIXED_REORDER_QUANTITY"
        ? "FROZEN_CONFIGURED_QUANTITY"
        : null;

  return deepFreezeOperator({
    actions,
    audit: {
      heuristicType: config.heuristicType,
      operatorId: OPERATOR_IDS[config.heuristicType],
      operatorVersion: INVENTORY_HEURISTIC_OPERATOR_VERSION,
      implementationFingerprint: implFingerprint,
      configurationFingerprint: configFingerprint,
      configuration: config as unknown as OperatorJson,
      dependencies: {
        evaluationContractFingerprint:
          INVENTORY_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
        evaluationContractFrozenCommit:
          INVENTORY_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
        frozenParentCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
        actionOntologyVersion: ACTION_SCHEMA_VERSION,
        metricSetVersion: INVENTORY_HEURISTIC_METRIC_SET_VERSION,
        simulatorVersion: INVENTORY_HEURISTIC_SIMULATOR_VERSION,
      },
      observationStatus,
      skus: skuAudits,
      evaluatedSkuIds,
      thresholdUnits,
      configuredReorderQuantityUnits,
      reorderQuantitySource,
      triggerResult,
      lowStockState,
      inboundState,
      proposedActionIds: actions.map((action) => String(action.actionId)),
      fallbackReason,
      simulatorCompatibility,
    },
  });
}

export function createInventoryHeuristicOperator(
  config: InventoryHeuristicConfig,
): CanonicalOperator {
  const configurationFingerprint =
    inventoryHeuristicConfigurationFingerprint(config);
  const implementation =
    INVENTORY_HEURISTIC_IMPLEMENTATION_FINGERPRINTS[
      config.heuristicType
    ];

  const metadata: CanonicalOperatorMetadata = deepFreezeOperator({
    interfaceVersion: OPERATOR_INTERFACE_VERSION,
    operatorId: OPERATOR_IDS[config.heuristicType],
    operatorType: "baseline",
    operatorVersion: INVENTORY_HEURISTIC_OPERATOR_VERSION,
    description: DESCRIPTIONS[config.heuristicType],
    supportedEvaluationContract: {
      contractId: "kivviq.baseline-evaluation",
      contractVersion: "1.0.0",
      contractFingerprint:
        INVENTORY_HEURISTIC_SUPPORTED_CONTRACT_FINGERPRINT,
      frozenCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_1_COMMIT,
    },
    supportedActionOntologyVersion: ACTION_SCHEMA_VERSION,
    deterministicConfiguration: {
      suiteVersion: INVENTORY_HEURISTIC_SUITE_VERSION,
      heuristicType: config.heuristicType,
      configurationFingerprint,
      configuration: config as unknown as OperatorJson,
      metricSetVersion: INVENTORY_HEURISTIC_METRIC_SET_VERSION,
      simulatorVersion: INVENTORY_HEURISTIC_SIMULATOR_VERSION,
      frozenParentCommit: INVENTORY_HEURISTIC_FROZEN_STEP_3_4_COMMIT,
      optimizationObjective: null,
      demandForecasting: false,
      stockoutPrediction: false,
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
          "inventory heuristic audit does not match decision output",
        );
      }
      return {
        auditType: "inventory_heuristic_evaluation",
        payload: decision.audit as unknown as OperatorJson,
      };
    },
  });
}

export const FIXED_REORDER_THRESHOLD_OPERATOR =
  createInventoryHeuristicOperator(FIXED_REORDER_THRESHOLD_CONFIG);

export const FIXED_REORDER_QUANTITY_OPERATOR =
  createInventoryHeuristicOperator(FIXED_REORDER_QUANTITY_CONFIG);

export const LOW_INVENTORY_DEPROMOTION_OPERATOR =
  createInventoryHeuristicOperator(LOW_INVENTORY_DEPROMOTION_CONFIG);

export const NO_INVENTORY_AWARE_INTERVENTION_OPERATOR =
  createInventoryHeuristicOperator(
    NO_INVENTORY_AWARE_INTERVENTION_CONFIG,
  );

export const INVENTORY_HEURISTIC_BASELINE_OPERATORS =
  deepFreezeOperator({
    FIXED_REORDER_THRESHOLD: FIXED_REORDER_THRESHOLD_OPERATOR,
    FIXED_REORDER_QUANTITY: FIXED_REORDER_QUANTITY_OPERATOR,
    LOW_INVENTORY_DEPROMOTION: LOW_INVENTORY_DEPROMOTION_OPERATOR,
    NO_INVENTORY_AWARE_INTERVENTION:
      NO_INVENTORY_AWARE_INTERVENTION_OPERATOR,
  });
