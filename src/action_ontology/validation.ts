import {
  ACTION_SCHEMA_VERSION,
  SUPPORTED_ACTION_SCHEMA_VERSIONS,
  OUTCOME_FAMILIES,
  RISK_DIMENSIONS,
  UNCERTAINTY_DIMENSIONS,
  type Action,
  type ActionConstraint,
  type ActionParameters,
  type ActionTarget,
  type ConstraintExpression,
  type KnownOrUnknown,
  type MonetaryValue,
  type ResourceRequirement,
  type ScalarValue,
} from "./types.js";
import {
  CORE_ACTION_TYPE_CONTRACTS,
  CORE_CONSTRAINT_PROPERTIES,
  getCoreActionTypeContract,
  type ActionTypeContract,
} from "./registry.js";

export interface ActionValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ActionValidationResult =
  | {
      readonly ok: true;
      readonly action: Action;
      readonly errors: readonly [];
    }
  | {
      readonly ok: false;
      readonly errors: readonly ActionValidationIssue[];
    };

export interface ActionValidationOptions {
  readonly additionalConstraintProperties?: readonly string[];
  readonly additionalActionTypeContracts?: readonly ActionTypeContract[];
}

export class ActionValidationError extends Error {
  public readonly issues: readonly ActionValidationIssue[];

  public constructor(issues: readonly ActionValidationIssue[]) {
    super(
      "Invalid Action: " +
        issues.map((issue) => issue.path + ": " + issue.message).join("; "),
    );
    this.name = "ActionValidationError";
    this.issues = issues;
  }
}

const ACTION_ID_PATTERN = /^action_[A-Za-z0-9._:-]+$/;
const ACTION_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ISO_UTC_PATTERN = /Z$/;

const TOP_LEVEL_FIELDS = new Set([
  "kind",
  "actionId",
  "actionType",
  "actionCategory",
  "schemaVersion",
  "description",
  "target",
  "scope",
  "parameters",
  "timing",
  "duration",
  "termination",
  "cost",
  "resourceRequirements",
  "constraints",
  "preconditions",
  "reversibility",
  "riskDimensions",
  "uncertaintyDimensions",
  "measurement",
  "intent",
  "provenance",
  "reversalOfActionId",
]);

const FORBIDDEN_ACTION_KEYS = new Set([
  "trueIncrementalROAS",
  "trueResponseCurve",
  "futureDemand",
  "futureStockout",
  "futureMargin",
  "counterfactualRevenue",
  "oracleBestAction",
  "expectedRevenue",
  "expectedProfit",
  "expectedContribution",
  "expectedDemand",
  "expectedUnitsSold",
  "expectedROAS",
  "expectedConversions",
  "predictedElasticity",
  "predictedLift",
  "confidence",
  "confidenceScore",
  "rank",
  "priority",
  "recommendationScore",
  "bestAction",
  "state",
  "status",
  "lifecycleState",
  "executionStatus",
  "outcome",
  "success",
]);

function record(value: unknown): value is any {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function add(
  errors: ActionValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  errors.push({ code, path, message });
}

function validateTimestamp(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (
    typeof input !== "string" ||
    !ISO_UTC_PATTERN.test(input) ||
    !Number.isFinite(Date.parse(input))
  ) {
    add(
      errors,
      "INVALID_TIMESTAMP",
      path,
      "must be a valid UTC ISO-8601 timestamp ending in Z",
    );
  }
}

function validateNonNegativeInteger(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Number.isInteger(input) || Number(input) < 0) {
    add(errors, "INVALID_NON_NEGATIVE_INTEGER", path, "must be an integer >= 0");
  }
}

function validatePositiveInteger(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Number.isInteger(input) || Number(input) <= 0) {
    add(errors, "INVALID_POSITIVE_INTEGER", path, "must be an integer > 0");
  }
}

function validateForbiddenInformation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (Array.isArray(input)) {
    input.forEach((entry, index) =>
      validateForbiddenInformation(entry, path + "[" + index + "]", errors),
    );
    return;
  }
  if (!record(input)) return;

  for (const [key, value] of Object.entries(input)) {
    const keyPath = path === "$" ? key : path + "." + key;
    if (FORBIDDEN_ACTION_KEYS.has(key)) {
      add(
        errors,
        "FORBIDDEN_ACTION_INFORMATION",
        keyPath,
        "predictions, rankings, lifecycle state and God-mode truth do not belong in Action",
      );
    }
    validateForbiddenInformation(value, keyPath, errors);
  }
}

const ACTION_SCHEMA_1_1_TARGET_KINDS = new Set([
  "advertising_account",
  "campaign_group",
  "ad_group",
  "creative",
  "product_group",
]);

const ACTION_SCHEMA_1_1_PARAMETER_KINDS = new Set([
  "spend_cap_adjustment",
  "paid_media_delivery",
  "paid_media_allocation",
  "paid_media_transfer_leg",
]);

const ACTION_SCHEMA_1_1_ACTION_TYPES = new Set([
  "advertising.adjust_spend_cap",
  "advertising.set_delivery_state",
  "advertising.set_allocation",
  "advertising.transfer_budget_leg",
]);

const ACTION_SCHEMA_1_2_PARAMETER_KINDS = new Set([
  "price_rollback",
]);

const ACTION_SCHEMA_1_2_ACTION_TYPES = new Set([
  "pricing.rollback_price",
]);

const ACTION_SCHEMA_1_3_TARGET_KINDS = new Set([
  "promotion",
  "brand",
  "product_set",
]);

const ACTION_SCHEMA_1_3_PARAMETER_KINDS = new Set([
  "promotion_start",
  "promotion_stop",
  "promotion_modify",
]);

const ACTION_SCHEMA_1_3_ACTION_TYPES = new Set([
  "promotion.start",
  "promotion.stop",
  "promotion.modify",
]);

function validateSchemaFeatureCompatibility(
  input: any,
  errors: ActionValidationIssue[],
): void {
  const schemaVersion = String(input.schemaVersion);

  if (schemaVersion === "1.0.0") {

  if (
    record(input.target) &&
    ACTION_SCHEMA_1_1_TARGET_KINDS.has(String(input.target.kind))
  ) {
    add(
      errors,
      "SCHEMA_FEATURE_REQUIRES_1_1",
      "target.kind",
      "this target kind requires Action schema 1.1.0",
    );
  }

  if (
    record(input.scope) &&
    Array.isArray(input.scope.dimensions) &&
    input.scope.dimensions.some(
      (dimension: unknown) =>
        record(dimension) && dimension.kind === "paid_media_segment",
    )
  ) {
    add(
      errors,
      "SCHEMA_FEATURE_REQUIRES_1_1",
      "scope",
      "paid_media_segment scope requires Action schema 1.1.0",
    );
  }

  if (
    record(input.parameters) &&
    ACTION_SCHEMA_1_1_PARAMETER_KINDS.has(String(input.parameters.kind))
  ) {
    add(
      errors,
      "SCHEMA_FEATURE_REQUIRES_1_1",
      "parameters.kind",
      "this parameter kind requires Action schema 1.1.0",
    );
  }

  if (
    typeof input.actionType === "string" &&
    ACTION_SCHEMA_1_1_ACTION_TYPES.has(input.actionType)
  ) {
    add(
      errors,
      "SCHEMA_FEATURE_REQUIRES_1_1",
      "actionType",
      "this Action type requires Action schema 1.1.0",
    );
  }

  if (
    input.actionType === "advertising.adjust_budget" &&
    record(input.target) &&
    !["advertising_channel", "campaign"].includes(String(input.target.kind))
  ) {
    add(
      errors,
      "SCHEMA_FEATURE_REQUIRES_1_1",
      "target.kind",
      "paid-media budget targets beyond channel/campaign require schema 1.1.0",
    );
  }
  }

  if (schemaVersion === "1.0.0" || schemaVersion === "1.1.0") {
    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_2_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_2",
        "parameters.kind",
        "this pricing parameter kind requires Action schema 1.2.0",
      );
    }

    if (
      record(input.parameters) &&
      input.parameters.kind === "price_adjustment" &&
      input.parameters.membership !== undefined
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_2",
        "parameters.membership",
        "pricing membership semantics require Action schema 1.2.0",
      );
    }

    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_2_ACTION_TYPES.has(input.actionType)
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_2",
        "actionType",
        "this pricing Action type requires Action schema 1.2.0",
      );
    }

    if (
      input.actionType === "pricing.adjust_price" &&
      record(input.target) &&
      ["category", "collection"].includes(String(input.target.kind))
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_2",
        "target.kind",
        "category/collection pricing requires Action schema 1.2.0",
      );
    }

    if (
      record(input.reversibility) &&
      input.reversibility.pricingRollback !== undefined
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_2",
        "reversibility.pricingRollback",
        "pricing rollback semantics require Action schema 1.2.0",
      );
    }
  }

  if (
    schemaVersion === "1.0.0" ||
    schemaVersion === "1.1.0" ||
    schemaVersion === "1.2.0"
  ) {
    if (
      record(input.target) &&
      ACTION_SCHEMA_1_3_TARGET_KINDS.has(String(input.target.kind))
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_3",
        "target.kind",
        "this promotion target kind requires Action schema 1.3.0",
      );
    }

    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_3_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_3",
        "parameters.kind",
        "this promotion parameter kind requires Action schema 1.3.0",
      );
    }

    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_3_ACTION_TYPES.has(input.actionType)
    ) {
      add(
        errors,
        "SCHEMA_FEATURE_REQUIRES_1_3",
        "actionType",
        "this promotion Action type requires Action schema 1.3.0",
      );
    }
  }
}

function validateTarget(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_TARGET", path, "typed target kind is required");
    return;
  }

  const required: Readonly<Record<string, readonly string[]>> = {
    advertising_channel: ["channelId"],
    advertising_account: ["channelId", "accountId"],
    campaign: ["channelId", "campaignId"],
    campaign_group: ["channelId", "campaignGroupId"],
    ad_set: ["channelId", "campaignId", "adSetId"],
    ad_group: ["channelId", "campaignId", "adGroupId"],
    ad: ["channelId", "campaignId", "adId"],
    creative: ["channelId", "creativeId"],
    audience: ["audienceId"],
    product: ["productId"],
    sku: ["skuId"],
    category: ["categoryId"],
    collection: ["collectionId"],
    brand: ["brandId"],
    product_set: ["productSetId"],
    product_group: ["productGroupId"],
    customer_segment: ["segmentId"],
    funnel_stage: ["funnelId", "stageId"],
    page: ["pageId"],
    lifecycle_program: ["programId"],
    shipping_policy: ["shippingPolicyId"],
    inventory_policy: ["inventoryPolicyId"],
    experiment: ["experimentId"],
    promotion: ["promotionId"],
    merchant: ["merchantId"],
  };

  const fields = required[input.kind];
  if (!fields) {
    add(errors, "UNKNOWN_TARGET_KIND", path + ".kind", "unsupported target kind");
    return;
  }
  for (const field of fields) {
    if (!nonEmpty(input[field])) {
      add(errors, "MISSING_TARGET_ID", path + "." + field, "required");
    }
  }
}

function validateStringArray(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  allowEmpty = false,
): void {
  if (
    !Array.isArray(input) ||
    (!allowEmpty && input.length === 0) ||
    input.some((value) => !nonEmpty(value))
  ) {
    add(
      errors,
      "INVALID_STRING_ARRAY",
      path,
      allowEmpty
        ? "must be an array of non-empty strings"
        : "must contain at least one non-empty string",
    );
  }
}

function validateScope(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !Array.isArray(input.dimensions)) {
    add(errors, "INVALID_SCOPE", path, "scope.dimensions must be an array");
    return;
  }

  const seen = new Set<string>();
  input.dimensions.forEach((dimension: unknown, index: number) => {
    const itemPath = path + ".dimensions[" + index + "]";
    if (!record(dimension) || !nonEmpty(dimension.kind)) {
      add(errors, "INVALID_SCOPE_DIMENSION", itemPath, "kind is required");
      return;
    }
    if (seen.has(dimension.kind)) {
      add(
        errors,
        "DUPLICATE_SCOPE_DIMENSION",
        itemPath + ".kind",
        "each scope dimension kind may appear only once",
      );
    }
    seen.add(dimension.kind);

    switch (dimension.kind) {
      case "geography": {
        const includeOk =
          Array.isArray(dimension.include) &&
          dimension.include.every((value: unknown) => nonEmpty(value));
        const excludeOk =
          dimension.exclude === undefined ||
          (Array.isArray(dimension.exclude) &&
            dimension.exclude.every((value: unknown) => nonEmpty(value)));
        if (!includeOk || !excludeOk) {
          add(errors, "INVALID_GEOGRAPHY_SCOPE", itemPath, "invalid geography lists");
        }
        if (
          Array.isArray(dimension.include) &&
          Array.isArray(dimension.exclude) &&
          dimension.include.length === 0 &&
          dimension.exclude.length === 0
        ) {
          add(
            errors,
            "EMPTY_GEOGRAPHY_SCOPE",
            itemPath,
            "geography scope must include or exclude at least one geography",
          );
        }
        return;
      }
      case "device":
        if (
          !Array.isArray(dimension.devices) ||
          dimension.devices.length === 0 ||
          dimension.devices.some(
            (value: unknown) =>
              !["desktop", "mobile", "tablet", "other"].includes(String(value)),
          )
        ) {
          add(errors, "INVALID_DEVICE_SCOPE", itemPath + ".devices", "invalid devices");
        }
        return;
      case "customer_population":
        validateStringArray(
          dimension.segmentIds,
          itemPath + ".segmentIds",
          errors,
        );
        return;
      case "product_population": {
        const groups = [
          dimension.productIds,
          dimension.skuIds,
          dimension.collectionIds,
        ].filter(Array.isArray) as unknown[][];
        if (
          groups.length === 0 ||
          groups.every((group) => group.length === 0) ||
          groups.some((group) => group.some((value) => !nonEmpty(value)))
        ) {
          add(
            errors,
            "INVALID_PRODUCT_POPULATION_SCOPE",
            itemPath,
            "at least one valid product, SKU or collection is required",
          );
        }
        return;
      }
      case "channel_subset":
        validateStringArray(
          dimension.channelIds,
          itemPath + ".channelIds",
          errors,
        );
        if (dimension.campaignIds !== undefined) {
          validateStringArray(
            dimension.campaignIds,
            itemPath + ".campaignIds",
            errors,
            true,
          );
        }
        return;
      case "paid_media_segment":
        if (
          !["prospecting", "retargeting", "brand", "non_brand", "custom"].includes(
            String(dimension.classification),
          )
        ) {
          add(
            errors,
            "INVALID_PAID_MEDIA_CLASSIFICATION",
            itemPath + ".classification",
            "unsupported paid-media business classification",
          );
        }
        if (
          !["merchant_defined", "kivviq_canonical"].includes(
            String(dimension.taxonomySource),
          )
        ) {
          add(
            errors,
            "INVALID_PAID_MEDIA_TAXONOMY_SOURCE",
            itemPath + ".taxonomySource",
            "classification source must be explicit",
          );
        }
        if (
          dimension.segmentId !== undefined &&
          !nonEmpty(dimension.segmentId)
        ) {
          add(
            errors,
            "INVALID_PAID_MEDIA_SEGMENT_ID",
            itemPath + ".segmentId",
            "segmentId must be non-empty when supplied",
          );
        }
        return;
      case "time_window":
        validateTimestamp(dimension.start, itemPath + ".start", errors);
        validateTimestamp(dimension.end, itemPath + ".end", errors);
        if (
          typeof dimension.start === "string" &&
          typeof dimension.end === "string" &&
          Number.isFinite(Date.parse(dimension.start)) &&
          Number.isFinite(Date.parse(dimension.end)) &&
          Date.parse(dimension.end) < Date.parse(dimension.start)
        ) {
          add(errors, "INVALID_SCOPE_TIME_WINDOW", itemPath, "end must not precede start");
        }
        return;
      default:
        add(
          errors,
          "UNKNOWN_SCOPE_DIMENSION",
          itemPath + ".kind",
          "unsupported scope dimension",
        );
    }
  });
}

function validateMoney(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || input.kind !== "money") {
    add(errors, "INVALID_MONEY", path, "must be a money value");
    return;
  }
  if (!Number.isInteger(input.amountMinor) || Number(input.amountMinor) < 0) {
    add(
      errors,
      "INVALID_MONEY_MINOR",
      path + ".amountMinor",
      "must be a non-negative integer in minor units",
    );
  }
  if (typeof input.currency !== "string" || !CURRENCY_PATTERN.test(input.currency)) {
    add(
      errors,
      "INVALID_CURRENCY",
      path + ".currency",
      "must be an explicit three-letter uppercase currency code",
    );
  }
}

function validateMoneyRate(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || input.kind !== "money_rate") {
    add(errors, "INVALID_MONEY_RATE", path, "must be a money_rate value");
    return;
  }
  if (!Number.isInteger(input.amountMinor) || Number(input.amountMinor) < 0) {
    add(
      errors,
      "INVALID_MONEY_MINOR",
      path + ".amountMinor",
      "must be a non-negative integer in minor units",
    );
  }
  if (typeof input.currency !== "string" || !CURRENCY_PATTERN.test(input.currency)) {
    add(errors, "INVALID_CURRENCY", path + ".currency", "invalid currency");
  }
  if (!["day", "week", "month"].includes(String(input.per))) {
    add(
      errors,
      "INVALID_MONEY_RATE_PERIOD",
      path + ".per",
      "must be day, week or month",
    );
  }
}

function validateScalar(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_SCALAR", path, "typed scalar value is required");
    return;
  }
  switch (input.kind) {
    case "money":
      validateMoney(input, path, errors);
      return;
    case "money_rate":
      validateMoneyRate(input, path, errors);
      return;
    case "percentage":
      if (
        !Number.isInteger(input.basisPoints) ||
        Number(input.basisPoints) < 0 ||
        Number(input.basisPoints) > 10_000
      ) {
        add(
          errors,
          "INVALID_PERCENTAGE",
          path + ".basisPoints",
          "must be integer basis points within [0,10000]",
        );
      }
      return;
    case "quantity":
      if (!finite(input.value) || Number(input.value) < 0 || !nonEmpty(input.unit)) {
        add(
          errors,
          "INVALID_QUANTITY",
          path,
          "quantity requires finite non-negative value and explicit unit",
        );
      }
      return;
    case "frequency":
      if (!finite(input.count) || Number(input.count) <= 0) {
        add(errors, "INVALID_FREQUENCY", path + ".count", "must be finite and > 0");
      }
      if (!["day", "week", "month"].includes(String(input.per))) {
        add(errors, "INVALID_FREQUENCY_PERIOD", path + ".per", "invalid period");
      }
      return;
    case "boolean":
      if (typeof input.value !== "boolean") {
        add(errors, "INVALID_BOOLEAN", path + ".value", "must be boolean");
      }
      return;
    case "string":
      if (!nonEmpty(input.value)) {
        add(errors, "INVALID_STRING_VALUE", path + ".value", "must be non-empty");
      }
      return;
    default:
      add(errors, "UNKNOWN_SCALAR_KIND", path + ".kind", "unsupported scalar kind");
  }
}

function scalarKind(value: unknown): string | undefined {
  return record(value) && typeof value.kind === "string" ? value.kind : undefined;
}

function validateReference(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime: string | undefined,
  expectedValueKind?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_REFERENCE_VALUE", path, "reference kind is required");
    return;
  }
  switch (input.kind) {
    case "current_at_decision":
      validateTimestamp(input.decisionTime, path + ".decisionTime", errors);
      if (
        decisionTime &&
        typeof input.decisionTime === "string" &&
        input.decisionTime !== decisionTime
      ) {
        add(
          errors,
          "REFERENCE_DECISION_TIME_MISMATCH",
          path + ".decisionTime",
          "current_at_decision must reference Action.timing.decisionTime",
        );
      }
      return;
    case "baseline_snapshot":
      if (!nonEmpty(input.baselineId)) {
        add(errors, "INVALID_BASELINE_ID", path + ".baselineId", "required");
      }
      return;
    case "previous_period":
      validatePositiveInteger(input.lookbackSeconds, path + ".lookbackSeconds", errors);
      return;
    case "explicit_baseline":
      validateScalar(input.value, path + ".value", errors);
      if (
        expectedValueKind &&
        scalarKind(input.value) !== expectedValueKind
      ) {
        add(
          errors,
          "BASELINE_UNIT_KIND_MISMATCH",
          path + ".value",
          "explicit baseline must use the same value kind as the change",
        );
      }
      return;
    default:
      add(errors, "UNKNOWN_REFERENCE_KIND", path + ".kind", "unsupported reference");
  }
}

function validateOperation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  expectedKind: string,
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_OPERATION", path, "operation kind is required");
    return;
  }

  if (input.kind === "SET") {
    validateScalar(input.value, path + ".value", errors);
    if (scalarKind(input.value) !== expectedKind) {
      add(
        errors,
        "OPERATION_UNIT_KIND_MISMATCH",
        path + ".value",
        "SET value uses the wrong unit kind",
      );
    }
    return;
  }

  if (input.kind === "DELTA") {
    if (!["increase", "decrease"].includes(String(input.direction))) {
      add(errors, "INVALID_DELTA_DIRECTION", path + ".direction", "invalid direction");
    }
    validateScalar(input.amount, path + ".amount", errors);
    if (scalarKind(input.amount) !== expectedKind) {
      add(
        errors,
        "OPERATION_UNIT_KIND_MISMATCH",
        path + ".amount",
        "DELTA amount uses the wrong unit kind",
      );
    }
    validateReference(
      input.reference,
      path + ".reference",
      errors,
      decisionTime,
      expectedKind,
    );
    return;
  }

  if (input.kind === "MULTIPLY") {
    if (!finite(input.factor) || Number(input.factor) <= 0) {
      add(
        errors,
        "INVALID_MULTIPLIER",
        path + ".factor",
        "multiplier must be finite and > 0",
      );
    }
    validateReference(
      input.reference,
      path + ".reference",
      errors,
      decisionTime,
      expectedKind,
    );
    return;
  }

  add(
    errors,
    "UNKNOWN_OPERATION",
    path + ".kind",
    "operation must be SET, DELTA or MULTIPLY",
  );
}


function validatePaidMediaAllocationMember(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_ALLOCATION_MEMBER", path, "allocation member is required");
    return;
  }

  if (input.kind === "strategy") {
    if (!["prospecting", "retargeting"].includes(String(input.classification))) {
      add(errors, "INVALID_ALLOCATION_MEMBER", path + ".classification", "invalid strategy");
    }
    if (input.segmentId !== undefined && !nonEmpty(input.segmentId)) {
      add(errors, "INVALID_ALLOCATION_MEMBER", path + ".segmentId", "invalid segmentId");
    }
    return;
  }

  if (input.kind === "traffic_classification") {
    if (!["brand", "non_brand"].includes(String(input.classification))) {
      add(errors, "INVALID_ALLOCATION_MEMBER", path + ".classification", "invalid traffic classification");
    }
    if (input.segmentId !== undefined && !nonEmpty(input.segmentId)) {
      add(errors, "INVALID_ALLOCATION_MEMBER", path + ".segmentId", "invalid segmentId");
    }
    return;
  }

  if (input.kind === "target") {
    validateTarget(input.target, path + ".target", errors);
    if (input.scope !== undefined) {
      validateScope(input.scope, path + ".scope", errors);
    }
    return;
  }

  add(errors, "UNKNOWN_ALLOCATION_MEMBER", path + ".kind", "unsupported allocation member");
}

function validateAllocationShares(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Array.isArray(input) || input.length < 2) {
    add(errors, "INVALID_ALLOCATION_SHARES", path, "at least two shares are required");
    return;
  }

  const ids = new Set<string>();
  let total = 0;
  input.forEach((share: unknown, index: number) => {
    const sharePath = path + "[" + index + "]";
    if (!record(share) || !nonEmpty(share.memberId)) {
      add(errors, "INVALID_ALLOCATION_SHARE", sharePath, "memberId is required");
      return;
    }
    if (ids.has(share.memberId)) {
      add(errors, "DUPLICATE_ALLOCATION_MEMBER", sharePath + ".memberId", "duplicate memberId");
    }
    ids.add(share.memberId);

    if (
      !Number.isInteger(share.shareBasisPoints) ||
      Number(share.shareBasisPoints) < 0 ||
      Number(share.shareBasisPoints) > 10_000
    ) {
      add(errors, "INVALID_ALLOCATION_SHARE", sharePath + ".shareBasisPoints", "share must be integer basis points within [0,10000]");
    } else {
      total += Number(share.shareBasisPoints);
    }
    validatePaidMediaAllocationMember(share.member, sharePath + ".member", errors);
  });

  if (total !== 10_000) {
    add(errors, "ALLOCATION_SHARES_MUST_SUM_100_PERCENT", path, "allocation shares must sum exactly to 10000 basis points");
  }
}

function validatePaidMediaTransferAmount(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_TRANSFER_AMOUNT", path, "transfer amount kind is required");
    return;
  }

  if (input.kind === "money_rate") {
    validateScalar(input.value, path + ".value", errors);
    if (!record(input.value) || input.value.kind !== "money_rate") {
      add(errors, "TRANSFER_MONEY_RATE_REQUIRED", path + ".value", "money-rate transfer requires money_rate value");
    }
    return;
  }

  if (input.kind === "percentage_of_source") {
    if (
      !Number.isInteger(input.basisPoints) ||
      Number(input.basisPoints) <= 0 ||
      Number(input.basisPoints) > 10_000
    ) {
      add(errors, "INVALID_TRANSFER_PERCENTAGE", path + ".basisPoints", "source share must be within (0,10000]");
    }
    validateTarget(input.sourceTarget, path + ".sourceTarget", errors);
    validateScope(input.sourceScope, path + ".sourceScope", errors);
    validateReference(
      input.sourceReference,
      path + ".sourceReference",
      errors,
      decisionTime,
      "money_rate",
    );
    return;
  }

  add(errors, "UNKNOWN_TRANSFER_AMOUNT_KIND", path + ".kind", "unsupported transfer amount kind");
}


function validatePricingMembership(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PRICING_MEMBERSHIP", path, "membership semantics are required");
    return;
  }
  if (
    !["decision_time", "translation_time", "effective_time"].includes(
      String(input.evaluateAt),
    )
  ) {
    add(
      errors,
      "INVALID_PRICING_MEMBERSHIP_BOUNDARY",
      path + ".evaluateAt",
      "must be decision_time, translation_time or effective_time",
    );
  }
  if (input.bindingRef !== undefined && !nonEmpty(input.bindingRef)) {
    add(
      errors,
      "INVALID_PRICING_MEMBERSHIP_BINDING_REF",
      path + ".bindingRef",
      "bindingRef must be non-empty when supplied",
    );
  }
}

function validatePriceOperation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  validateOperation(input, path, errors, "money", decisionTime);
  if (!record(input)) return;

  if (
    input.kind === "DELTA" &&
    record(input.amount) &&
    input.amount.kind === "money" &&
    record(input.reference) &&
    input.reference.kind === "explicit_baseline" &&
    record(input.reference.value) &&
    input.reference.value.kind === "money"
  ) {
    if (input.amount.currency !== input.reference.value.currency) {
      add(
        errors,
        "PRICE_CURRENCY_MISMATCH",
        path,
        "price DELTA amount and explicit baseline must use the same currency",
      );
    }
    if (
      input.direction === "decrease" &&
      Number.isInteger(input.amount.amountMinor) &&
      Number.isInteger(input.reference.value.amountMinor) &&
      Number(input.amount.amountMinor) > Number(input.reference.value.amountMinor)
    ) {
      add(
        errors,
        "PRICE_WOULD_BECOME_NEGATIVE",
        path,
        "price decrease cannot exceed the explicit baseline price",
      );
    }
  }
}

function validatePriceRollbackStrategy(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PRICE_ROLLBACK_STRATEGY", path, "rollback strategy is required");
    return;
  }

  if (input.kind === "RESTORE_PRE_ACTION_VALUE") {
    if (!record(input.source) || !nonEmpty(input.source.kind)) {
      add(errors, "INVALID_ROLLBACK_RESTORE_SOURCE", path + ".source", "restore source is required");
      return;
    }
    if (input.source.kind === "single_price") {
      validateReference(
        input.source.preActionPrice,
        path + ".source.preActionPrice",
        errors,
        decisionTime,
        "money",
      );
      return;
    }
    if (input.source.kind === "membership_snapshot") {
      if (!nonEmpty(input.source.bindingRef)) {
        add(errors, "INVALID_ROLLBACK_MEMBERSHIP_BINDING", path + ".source.bindingRef", "bindingRef is required");
      }
      return;
    }
    add(errors, "UNKNOWN_ROLLBACK_RESTORE_SOURCE", path + ".source.kind", "unsupported restore source");
    return;
  }

  if (input.kind === "SET_EXPLICIT_VALUE") {
    validateMoney(input.value, path + ".value", errors);
    return;
  }

  add(
    errors,
    "UNKNOWN_PRICE_ROLLBACK_STRATEGY",
    path + ".kind",
    "rollback must use RESTORE_PRE_ACTION_VALUE or SET_EXPLICIT_VALUE",
  );
}

function validatePriceRollbackConflictGuard(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  originalActionId?: string,
): void {
  if (!record(input) || input.kind !== "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT") {
    add(
      errors,
      "INVALID_PRICE_ROLLBACK_CONFLICT_GUARD",
      path,
      "safe rollback requires REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
    );
    return;
  }
  if (!nonEmpty(input.sourceActionId)) {
    add(errors, "INVALID_ROLLBACK_SOURCE_ACTION", path + ".sourceActionId", "required");
  } else if (originalActionId && input.sourceActionId !== originalActionId) {
    add(
      errors,
      "ROLLBACK_SOURCE_ACTION_MISMATCH",
      path + ".sourceActionId",
      "conflict guard must reference the original pricing Action",
    );
  }
  if (!record(input.expected) || !nonEmpty(input.expected.kind)) {
    add(errors, "INVALID_ROLLBACK_EXPECTED_STATE", path + ".expected", "expected state is required");
  } else if (input.expected.kind === "single_price") {
    validateMoney(
      input.expected.price,
      path + ".expected.price",
      errors,
    );
  } else if (input.expected.kind === "membership_state") {
    if (!nonEmpty(input.expected.stateRef)) {
      add(errors, "INVALID_ROLLBACK_MEMBERSHIP_STATE", path + ".expected.stateRef", "stateRef is required");
    }
  } else {
    add(errors, "UNKNOWN_ROLLBACK_EXPECTED_STATE", path + ".expected.kind", "unsupported expected state");
  }
}

function validatePriceRollbackParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input)) {
    add(errors, "INVALID_PRICE_ROLLBACK", path, "rollback parameters are required");
    return;
  }
  if (!nonEmpty(input.originalActionId)) {
    add(errors, "INVALID_ROLLBACK_ORIGINAL_ACTION", path + ".originalActionId", "required");
  }
  validatePriceRollbackStrategy(
    input.strategy,
    path + ".strategy",
    errors,
    decisionTime,
  );
  validatePriceRollbackConflictGuard(
    input.conflictGuard,
    path + ".conflictGuard",
    errors,
    typeof input.originalActionId === "string"
      ? input.originalActionId
      : undefined,
  );
}

function validateParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PARAMETERS", path, "typed parameter kind is required");
    return;
  }

  switch (input.kind) {
    case "budget_adjustment":
      validateOperation(
        input.operation,
        path + ".operation",
        errors,
        "money_rate",
        decisionTime,
      );
      return;
    case "spend_cap_adjustment":
      validateOperation(
        input.operation,
        path + ".operation",
        errors,
        "money_rate",
        decisionTime,
      );
      return;
    case "paid_media_delivery":
      if (!["PAUSE", "RESUME"].includes(String(input.operation))) {
        add(errors, "INVALID_PAID_MEDIA_DELIVERY_OPERATION", path + ".operation", "must be PAUSE or RESUME");
      }
      return;
    case "paid_media_allocation":
      if (!["budget", "spend_cap"].includes(String(input.control))) {
        add(errors, "INVALID_PAID_MEDIA_CONTROL", path + ".control", "must be budget or spend_cap");
      }
      if (input.operation !== "SET") {
        add(errors, "INVALID_ALLOCATION_OPERATION", path + ".operation", "allocation action must use SET");
      }
      if (!record(input.denominator) || input.denominator.kind !== "target_scope") {
        add(errors, "AMBIGUOUS_ALLOCATION_DENOMINATOR", path + ".denominator", "explicit target_scope denominator is required");
      } else {
        if (!["budget", "spend_cap"].includes(String(input.denominator.control))) {
          add(errors, "INVALID_ALLOCATION_DENOMINATOR_CONTROL", path + ".denominator.control", "invalid control");
        }
        validateTarget(input.denominator.target, path + ".denominator.target", errors);
        validateScope(input.denominator.scope, path + ".denominator.scope", errors);
      }
      validateAllocationShares(input.shares, path + ".shares", errors);
      if (input.baselineShares !== undefined) {
        validateAllocationShares(input.baselineShares, path + ".baselineShares", errors);
      }
      return;
    case "paid_media_transfer_leg":
      if (!nonEmpty(input.transferId)) {
        add(errors, "INVALID_TRANSFER_ID", path + ".transferId", "transferId is required");
      }
      if (!["source", "destination"].includes(String(input.role))) {
        add(errors, "INVALID_TRANSFER_ROLE", path + ".role", "must be source or destination");
      }
      if (!["budget", "spend_cap"].includes(String(input.control))) {
        add(errors, "INVALID_PAID_MEDIA_CONTROL", path + ".control", "must be budget or spend_cap");
      }
      if (input.operation !== "DELTA") {
        add(errors, "INVALID_TRANSFER_OPERATION", path + ".operation", "transfer legs must use DELTA");
      }
      if (!["increase", "decrease"].includes(String(input.direction))) {
        add(errors, "INVALID_TRANSFER_DIRECTION", path + ".direction", "invalid direction");
      }
      if (input.role === "source" && input.direction !== "decrease") {
        add(errors, "TRANSFER_SOURCE_MUST_DECREASE", path + ".direction", "source transfer leg must decrease");
      }
      if (input.role === "destination" && input.direction !== "increase") {
        add(errors, "TRANSFER_DESTINATION_MUST_INCREASE", path + ".direction", "destination transfer leg must increase");
      }
      validatePaidMediaTransferAmount(input.amount, path + ".amount", errors, decisionTime);
      return;
    case "price_adjustment":
      validatePriceOperation(
        input.operation,
        path + ".operation",
        errors,
        decisionTime,
      );
      if (input.membership !== undefined) {
        validatePricingMembership(
          input.membership,
          path + ".membership",
          errors,
        );
      }
      return;
    case "price_rollback":
      validatePriceRollbackParameters(
        input,
        path,
        errors,
        decisionTime,
      );
      return;
    case "promotion":
      validateOperation(
        input.discount,
        path + ".discount",
        errors,
        "percentage",
        decisionTime,
      );
      if (input.code !== undefined && !nonEmpty(input.code)) {
        add(errors, "INVALID_PROMOTION_CODE", path + ".code", "must be non-empty");
      }
      return;
    case "inventory":
      validateOperation(
        input.operation,
        path + ".operation",
        errors,
        "quantity",
        decisionTime,
      );
      return;
    case "frequency_adjustment":
      validateOperation(
        input.operation,
        path + ".operation",
        errors,
        "frequency",
        decisionTime,
      );
      return;
    case "toggle":
      if (!nonEmpty(input.setting)) {
        add(errors, "INVALID_TOGGLE_SETTING", path + ".setting", "required");
      }
      if (typeof input.value !== "boolean") {
        add(errors, "INVALID_TOGGLE_VALUE", path + ".value", "must be boolean");
      }
      return;
    case "merchandising_position":
      if (!nonEmpty(input.collectionId) || !nonEmpty(input.productId)) {
        add(errors, "INVALID_MERCHANDISING_TARGET", path, "collectionId and productId are required");
      }
      validatePositiveInteger(input.position, path + ".position", errors);
      return;
    case "shipping_policy":
      if (!nonEmpty(input.setting)) {
        add(errors, "INVALID_SHIPPING_SETTING", path + ".setting", "required");
      }
      if (!record(input.operation) || !nonEmpty(input.operation.kind)) {
        add(errors, "INVALID_OPERATION", path + ".operation", "required");
      } else if (input.operation.kind === "SET") {
        validateScalar(input.operation.value, path + ".operation.value", errors);
      } else if (input.operation.kind === "DELTA") {
        validateScalar(input.operation.amount, path + ".operation.amount", errors);
        validateReference(
          input.operation.reference,
          path + ".operation.reference",
          errors,
          decisionTime,
          scalarKind(input.operation.amount),
        );
      } else if (input.operation.kind === "MULTIPLY") {
        if (!finite(input.operation.factor) || Number(input.operation.factor) <= 0) {
          add(errors, "INVALID_MULTIPLIER", path + ".operation.factor", "must be > 0");
        }
        validateReference(
          input.operation.reference,
          path + ".operation.reference",
          errors,
          decisionTime,
        );
      } else {
        add(errors, "UNKNOWN_OPERATION", path + ".operation.kind", "unsupported");
      }
      return;
    case "page_change":
      if (!nonEmpty(input.changeId) || !nonEmpty(input.variantRef)) {
        add(errors, "INVALID_PAGE_CHANGE", path, "changeId and variantRef are required");
      }
      return;
    case "segment_targeting":
      if (!nonEmpty(input.segmentId) || typeof input.enabled !== "boolean") {
        add(errors, "INVALID_SEGMENT_TARGETING", path, "segmentId and enabled are required");
      }
      return;
    case "run_experiment":
      for (const field of [
        "hypothesisRef",
        "interventionActionId",
        "controlActionId",
        "targetPopulationRef",
        "primaryOutcomeMetricId",
      ]) {
        if (!nonEmpty(input[field])) {
          add(errors, "INVALID_EXPERIMENT_PARAMETER", path + "." + field, "required");
        }
      }
      validatePositiveInteger(input.durationSeconds, path + ".durationSeconds", errors);
      if (
        nonEmpty(input.interventionActionId) &&
        input.interventionActionId === input.controlActionId
      ) {
        add(
          errors,
          "EXPERIMENT_IDENTICAL_ARMS",
          path,
          "intervention and control must reference different actions",
        );
      }
      return;
    case "investigate":
      if (
        ![
          "tracking_anomaly",
          "checkout_decline",
          "missing_margin_data",
          "channel_shift",
          "custom",
        ].includes(String(input.investigationType))
      ) {
        add(errors, "INVALID_INVESTIGATION_TYPE", path + ".investigationType", "unsupported");
      }
      if (!nonEmpty(input.question)) {
        add(errors, "INVALID_INVESTIGATION_QUESTION", path + ".question", "required");
      }
      validateStringArray(
        input.requestedEvidenceRefs,
        path + ".requestedEvidenceRefs",
        errors,
        true,
      );
      return;
    case "no_op":
      if (!nonEmpty(input.reasonCode)) {
        add(errors, "INVALID_NO_OP_REASON", path + ".reasonCode", "required");
      }
      return;
    case "wait_observe":
      if (!record(input.observationUntil) || !nonEmpty(input.observationUntil.kind)) {
        add(errors, "INVALID_OBSERVATION_BOUNDARY", path + ".observationUntil", "required");
      } else if (input.observationUntil.kind === "time") {
        validateTimestamp(input.observationUntil.at, path + ".observationUntil.at", errors);
      } else if (input.observationUntil.kind === "evidence_condition") {
        if (!nonEmpty(input.observationUntil.conditionRef)) {
          add(errors, "INVALID_OBSERVATION_CONDITION", path + ".observationUntil.conditionRef", "required");
        }
      } else {
        add(errors, "UNKNOWN_OBSERVATION_BOUNDARY", path + ".observationUntil.kind", "unsupported");
      }
      return;
    default:
      add(errors, "UNKNOWN_PARAMETER_KIND", path + ".kind", "unsupported parameter kind");
  }
}

function validateTemporalPoint(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): string | undefined {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_TEMPORAL_POINT", path, "temporal point kind is required");
    return undefined;
  }
  if (input.kind === "known") {
    validateTimestamp(input.at, path + ".at", errors);
    return typeof input.at === "string" ? input.at : undefined;
  }
  if (input.kind === "unknown") {
    if (!nonEmpty(input.reason)) {
      add(errors, "INVALID_UNKNOWN_TIME", path + ".reason", "reason is required");
    }
    return undefined;
  }
  add(errors, "UNKNOWN_TEMPORAL_POINT", path + ".kind", "unsupported temporal point");
  return undefined;
}

function validateTiming(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): { readonly decisionTime: string | undefined; readonly effectiveStart: string | undefined } {
  if (!record(input)) {
    add(errors, "INVALID_TIMING", path, "timing is required");
    return { decisionTime: undefined, effectiveStart: undefined };
  }

  validateTimestamp(input.decisionTime, path + ".decisionTime", errors);
  const decisionTime =
    typeof input.decisionTime === "string" ? input.decisionTime : undefined;
  const requested = validateTemporalPoint(
    input.requestedStart,
    path + ".requestedStart",
    errors,
  );
  const effective = validateTemporalPoint(
    input.effectiveStart,
    path + ".effectiveStart",
    errors,
  );

  let implementationDelay: number | undefined;
  if (!record(input.implementationDelaySeconds) || !nonEmpty(input.implementationDelaySeconds.kind)) {
    add(
      errors,
      "INVALID_IMPLEMENTATION_DELAY",
      path + ".implementationDelaySeconds",
      "known or unknown implementation delay is required",
    );
  } else if (input.implementationDelaySeconds.kind === "known") {
    validateNonNegativeInteger(
      input.implementationDelaySeconds.seconds,
      path + ".implementationDelaySeconds.seconds",
      errors,
    );
    if (Number.isInteger(input.implementationDelaySeconds.seconds)) {
      implementationDelay = Number(input.implementationDelaySeconds.seconds);
    }
  } else if (input.implementationDelaySeconds.kind === "unknown") {
    if (!nonEmpty(input.implementationDelaySeconds.reason)) {
      add(
        errors,
        "INVALID_IMPLEMENTATION_DELAY",
        path + ".implementationDelaySeconds.reason",
        "reason is required",
      );
    }
  } else {
    add(
      errors,
      "INVALID_IMPLEMENTATION_DELAY",
      path + ".implementationDelaySeconds.kind",
      "unsupported delay kind",
    );
  }

  if (decisionTime && Number.isFinite(Date.parse(decisionTime))) {
    const decisionMs = Date.parse(decisionTime);
    if (requested && Date.parse(requested) < decisionMs) {
      add(
        errors,
        "REQUESTED_START_BEFORE_DECISION",
        path + ".requestedStart",
        "requested start cannot precede decision time",
      );
    }
    if (effective && Date.parse(effective) < decisionMs) {
      add(
        errors,
        "EFFECTIVE_START_BEFORE_DECISION",
        path + ".effectiveStart",
        "effective start cannot precede decision time",
      );
    }
    if (
      effective &&
      implementationDelay !== undefined &&
      Date.parse(effective) < decisionMs + implementationDelay * 1000
    ) {
      add(
        errors,
        "EFFECTIVE_START_BEFORE_IMPLEMENTATION_DELAY",
        path + ".effectiveStart",
        "effective start violates the declared implementation delay",
      );
    }
  }

  if (requested && effective && Date.parse(effective) < Date.parse(requested)) {
    add(
      errors,
      "EFFECTIVE_START_BEFORE_REQUESTED_START",
      path + ".effectiveStart",
      "effective start cannot precede requested start",
    );
  }

  return { decisionTime, effectiveStart: effective };
}

function validateDuration(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_DURATION", path, "duration kind is required");
    return;
  }

  switch (input.kind) {
    case "instantaneous":
    case "persistent":
    case "until_reversed":
      return;
    case "temporary":
      validatePositiveInteger(input.durationSeconds, path + ".durationSeconds", errors);
      return;
    case "recurring":
      if (!record(input.recurrence) || !nonEmpty(input.recurrence.kind)) {
        add(errors, "INVALID_RECURRENCE", path + ".recurrence", "required");
        return;
      }
      if (!["daily", "weekly", "monthly"].includes(String(input.recurrence.kind))) {
        add(errors, "INVALID_RECURRENCE", path + ".recurrence.kind", "unsupported");
      }
      validatePositiveInteger(input.recurrence.interval, path + ".recurrence.interval", errors);
      if (input.recurrence.maxOccurrences !== undefined) {
        validatePositiveInteger(
          input.recurrence.maxOccurrences,
          path + ".recurrence.maxOccurrences",
          errors,
        );
      }
      if (input.recurrence.daysOfWeek !== undefined) {
        if (
          !Array.isArray(input.recurrence.daysOfWeek) ||
          input.recurrence.daysOfWeek.some(
            (day: unknown) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6,
          )
        ) {
          add(
            errors,
            "INVALID_RECURRENCE_DAYS",
            path + ".recurrence.daysOfWeek",
            "days must be integers from 0 through 6",
          );
        }
      }
      return;
    default:
      add(errors, "UNKNOWN_DURATION_KIND", path + ".kind", "unsupported duration kind");
  }
}

function validateTermination(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  effectiveStart?: string,
  duration?: unknown,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_TERMINATION", path, "termination kind is required");
    return;
  }
  if (input.kind === "fixed_end") {
    validateTimestamp(input.at, path + ".at", errors);
    if (
      effectiveStart &&
      typeof input.at === "string" &&
      Number.isFinite(Date.parse(input.at)) &&
      Date.parse(input.at) < Date.parse(effectiveStart)
    ) {
      add(
        errors,
        "TERMINATION_BEFORE_EFFECTIVE_START",
        path + ".at",
        "fixed end cannot precede effective start",
      );
    }
  } else if (input.kind === "fixed_duration") {
    validatePositiveInteger(input.durationSeconds, path + ".durationSeconds", errors);
    if (
      record(duration) &&
      duration.kind === "temporary" &&
      Number.isInteger(duration.durationSeconds) &&
      Number.isInteger(input.durationSeconds) &&
      Number(duration.durationSeconds) !== Number(input.durationSeconds)
    ) {
      add(
        errors,
        "DURATION_TERMINATION_MISMATCH",
        path + ".durationSeconds",
        "temporary duration and fixed termination duration must agree",
      );
    }
  } else if (input.kind === "condition") {
    if (!nonEmpty(input.conditionRef)) {
      add(errors, "INVALID_TERMINATION_CONDITION", path + ".conditionRef", "required");
    }
  } else if (!["manual_reversal", "persistent"].includes(String(input.kind))) {
    add(errors, "UNKNOWN_TERMINATION_KIND", path + ".kind", "unsupported");
  }

  if (record(duration)) {
    if (duration.kind === "persistent" && input.kind !== "persistent") {
      add(
        errors,
        "PERSISTENT_TERMINATION_MISMATCH",
        path,
        "persistent duration requires persistent termination",
      );
    }
    if (duration.kind === "until_reversed" && input.kind !== "manual_reversal") {
      add(
        errors,
        "REVERSAL_TERMINATION_MISMATCH",
        path,
        "until_reversed duration requires manual_reversal termination",
      );
    }
  }
}

function validateKnownOrUnknown(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  validateKnown: (value: unknown, valuePath: string) => void,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_KNOWN_OR_UNKNOWN", path, "known or unknown value is required");
    return;
  }
  if (input.kind === "known") {
    validateKnown(input.value, path + ".value");
    if (input.sourceRef !== undefined && !nonEmpty(input.sourceRef)) {
      add(errors, "INVALID_SOURCE_REF", path + ".sourceRef", "must be non-empty");
    }
  } else if (input.kind === "unknown") {
    if (!nonEmpty(input.reason)) {
      add(errors, "INVALID_UNKNOWN_VALUE", path + ".reason", "reason is required");
    }
  } else {
    add(errors, "INVALID_KNOWN_OR_UNKNOWN", path + ".kind", "unsupported");
  }
}

function validateCost(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_COST", path, "cost ontology is required");
    return;
  }
  for (const field of [
    "directFinancialCost",
    "mediaSpend",
    "implementationCost",
    "engineeringCost",
    "operationalCost",
    "promotionalCost",
    "inventoryCommitment",
  ]) {
    validateKnownOrUnknown(input[field], path + "." + field, errors, (value, valuePath) =>
      validateMoney(value, valuePath, errors),
    );
  }
  if (
    input.opportunityCostReference !== undefined &&
    !nonEmpty(input.opportunityCostReference)
  ) {
    add(
      errors,
      "INVALID_OPPORTUNITY_COST_REFERENCE",
      path + ".opportunityCostReference",
      "must be a reference, not a realized accounting number",
    );
  }
}

function validateResource(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.resourceType)) {
    add(errors, "INVALID_RESOURCE_REQUIREMENT", path, "resourceType is required");
    return;
  }
  const moneyResources = new Set(["advertising_budget"]);
  const quantityResources = new Set([
    "inventory",
    "engineering_capacity",
    "creative_capacity",
    "email_audience",
    "operational_capacity",
    "testing_traffic",
  ]);

  if (moneyResources.has(input.resourceType)) {
    validateKnownOrUnknown(input.amount, path + ".amount", errors, (value, valuePath) =>
      validateMoney(value, valuePath, errors),
    );
    return;
  }
  if (quantityResources.has(input.resourceType)) {
    validateKnownOrUnknown(input.amount, path + ".amount", errors, (value, valuePath) => {
      if (!record(value) || value.kind !== "quantity") {
        add(errors, "INVALID_RESOURCE_UNIT", valuePath, "must be a quantity value");
      } else {
        validateScalar(value, valuePath, errors);
      }
    });
    return;
  }
  add(
    errors,
    "UNKNOWN_RESOURCE_TYPE",
    path + ".resourceType",
    "unsupported resource type",
  );
}

function validateExpression(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  validProperties: ReadonlySet<string>,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_CONSTRAINT_EXPRESSION", path, "expression kind is required");
    return;
  }
  switch (input.kind) {
    case "property_comparison":
      if (!nonEmpty(input.propertyId) || !validProperties.has(String(input.propertyId))) {
        add(
          errors,
          "UNKNOWN_CONSTRAINT_PROPERTY",
          path + ".propertyId",
          "property is not registered",
        );
      }
      if (!["LT", "LTE", "EQ", "NEQ", "GTE", "GT"].includes(String(input.operator))) {
        add(errors, "INVALID_COMPARISON_OPERATOR", path + ".operator", "unsupported");
      }
      validateScalar(input.value, path + ".value", errors);
      return;
    case "entity_exists":
      validateTarget(input.target, path + ".target", errors);
      return;
    case "capability_available":
      if (!nonEmpty(input.capabilityId)) {
        add(errors, "INVALID_CAPABILITY_ID", path + ".capabilityId", "required");
      }
      return;
    case "evidence_available":
      if (!nonEmpty(input.evidenceRef)) {
        add(errors, "INVALID_EVIDENCE_REF", path + ".evidenceRef", "required");
      }
      if (input.maximumAgeSeconds !== undefined) {
        validateNonNegativeInteger(
          input.maximumAgeSeconds,
          path + ".maximumAgeSeconds",
          errors,
        );
      }
      return;
    default:
      add(
        errors,
        "UNKNOWN_CONSTRAINT_EXPRESSION",
        path + ".kind",
        "unsupported expression kind",
      );
  }
}

function comparableScalar(value: unknown):
  | { readonly kind: string; readonly unitKey: string; readonly value: number }
  | undefined {
  if (!record(value) || !nonEmpty(value.kind)) return undefined;
  if (value.kind === "money" && Number.isInteger(value.amountMinor) && nonEmpty(value.currency)) {
    return { kind: "money", unitKey: String(value.currency), value: Number(value.amountMinor) };
  }
  if (
    value.kind === "money_rate" &&
    Number.isInteger(value.amountMinor) &&
    nonEmpty(value.currency) &&
    nonEmpty(value.per)
  ) {
    return {
      kind: "money_rate",
      unitKey: String(value.currency) + "/" + String(value.per),
      value: Number(value.amountMinor),
    };
  }
  if (value.kind === "percentage" && Number.isInteger(value.basisPoints)) {
    return { kind: "percentage", unitKey: "bp", value: Number(value.basisPoints) };
  }
  if (value.kind === "quantity" && finite(value.value) && nonEmpty(value.unit)) {
    return { kind: "quantity", unitKey: String(value.unit), value: Number(value.value) };
  }
  return undefined;
}

function validateConstraintBounds(
  constraints: readonly unknown[],
  errors: ActionValidationIssue[],
): void {
  const bounds = new Map<
    string,
    {
      lower?: { readonly value: number; readonly unitKey: string };
      upper?: { readonly value: number; readonly unitKey: string };
    }
  >();

  constraints.forEach((constraint) => {
    if (!record(constraint) || !record(constraint.expression)) return;
    const expression = constraint.expression;
    if (
      expression.kind !== "property_comparison" ||
      !nonEmpty(expression.propertyId)
    ) {
      return;
    }
    const comparable = comparableScalar(expression.value);
    if (!comparable) return;

    const key = String(expression.propertyId);
    const existing = bounds.get(key) ?? {};
    if (expression.operator === "GTE" || expression.operator === "GT") {
      bounds.set(key, {
        ...existing,
        lower: { value: comparable.value, unitKey: comparable.unitKey },
      });
    } else if (expression.operator === "LTE" || expression.operator === "LT") {
      bounds.set(key, {
        ...existing,
        upper: { value: comparable.value, unitKey: comparable.unitKey },
      });
    }
  });

  for (const [propertyId, pair] of bounds.entries()) {
    if (
      pair.lower &&
      pair.upper &&
      pair.lower.unitKey === pair.upper.unitKey &&
      pair.lower.value > pair.upper.value
    ) {
      add(
        errors,
        "CONSTRAINT_MIN_EXCEEDS_MAX",
        "constraints",
        "minimum exceeds maximum for " + propertyId,
      );
    }
  }
}

function validateConstraint(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  validProperties: ReadonlySet<string>,
): void {
  if (!record(input)) {
    add(errors, "INVALID_CONSTRAINT", path, "constraint object is required");
    return;
  }
  if (!nonEmpty(input.constraintId)) {
    add(errors, "INVALID_CONSTRAINT_ID", path + ".constraintId", "required");
  }
  if (!["hard", "soft"].includes(String(input.constraintClass))) {
    add(
      errors,
      "INVALID_CONSTRAINT_CLASS",
      path + ".constraintClass",
      "must be hard or soft",
    );
  }
  validateExpression(input.expression, path + ".expression", errors, validProperties);
  if (input.description !== undefined && !nonEmpty(input.description)) {
    add(errors, "INVALID_CONSTRAINT_DESCRIPTION", path + ".description", "must be non-empty");
  }
}


function validatePricingRollbackContract(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || typeof input.available !== "boolean") {
    add(errors, "INVALID_PRICING_ROLLBACK_CONTRACT", path, "available must be explicit");
    return;
  }

  if (input.available === false) {
    if (!nonEmpty(input.reason)) {
      add(errors, "INVALID_PRICING_ROLLBACK_REASON", path + ".reason", "reason is required");
    }
    return;
  }

  validateTarget(input.target, path + ".target", errors);
  validatePriceRollbackStrategy(
    input.strategy,
    path + ".strategy",
    errors,
  );

  if (!record(input.trigger) || !nonEmpty(input.trigger.kind)) {
    add(errors, "INVALID_PRICING_ROLLBACK_TRIGGER", path + ".trigger", "trigger is required");
  } else if (input.trigger.kind === "AT") {
    validateTimestamp(input.trigger.at, path + ".trigger.at", errors);
  } else if (input.trigger.kind !== "ON_TERMINATION") {
    add(errors, "INVALID_PRICING_ROLLBACK_TRIGGER", path + ".trigger.kind", "unsupported trigger");
  }

  validateNonNegativeInteger(
    input.delaySeconds,
    path + ".delaySeconds",
    errors,
  );
  validateKnownOrUnknown(
    input.cost,
    path + ".cost",
    errors,
    (value, valuePath) => validateMoney(value, valuePath, errors),
  );
  validatePriceRollbackConflictGuard(
    input.conflictGuard,
    path + ".conflictGuard",
    errors,
  );
}

function validatePrecondition(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  validProperties: ReadonlySet<string>,
): void {
  if (!record(input)) {
    add(errors, "INVALID_PRECONDITION", path, "precondition object is required");
    return;
  }
  if (!nonEmpty(input.preconditionId)) {
    add(errors, "INVALID_PRECONDITION_ID", path + ".preconditionId", "required");
  }
  validateExpression(input.expression, path + ".expression", errors, validProperties);
  if (!["unknown_eligibility", "ineligible"].includes(String(input.whenUnknown))) {
    add(
      errors,
      "INVALID_PRECONDITION_UNKNOWN_POLICY",
      path + ".whenUnknown",
      "unsupported unknown policy",
    );
  }
}

function validateReversibility(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.classification)) {
    add(errors, "INVALID_REVERSIBILITY", path, "classification is required");
    return;
  }
  if (
    ![
      "immediately_reversible",
      "reversible_with_delay",
      "partially_reversible",
      "effectively_irreversible",
    ].includes(String(input.classification))
  ) {
    add(errors, "INVALID_REVERSIBILITY_CLASS", path + ".classification", "unsupported");
  }

  if (!record(input.reversal) || !nonEmpty(input.reversal.kind)) {
    add(errors, "INVALID_REVERSAL_REFERENCE", path + ".reversal", "required");
  } else if (input.reversal.kind === "restore_previous_value") {
    validateTarget(input.reversal.target, path + ".reversal.target", errors);
    if (!nonEmpty(input.reversal.parameterKind)) {
      add(errors, "INVALID_REVERSAL_PARAMETER_KIND", path + ".reversal.parameterKind", "required");
    }
  } else if (input.reversal.kind === "explicit_action") {
    if (!nonEmpty(input.reversal.actionId)) {
      add(errors, "INVALID_REVERSAL_ACTION_ID", path + ".reversal.actionId", "required");
    }
  } else if (input.reversal.kind === "none") {
    if (!nonEmpty(input.reversal.reason)) {
      add(errors, "INVALID_REVERSAL_NONE_REASON", path + ".reversal.reason", "required");
    }
  } else {
    add(errors, "UNKNOWN_REVERSAL_REFERENCE", path + ".reversal.kind", "unsupported");
  }

  if (input.minimumDelaySeconds !== undefined) {
    validateNonNegativeInteger(
      input.minimumDelaySeconds,
      path + ".minimumDelaySeconds",
      errors,
    );
  }

  if (input.classification === "effectively_irreversible") {
    if (!record(input.reversal) || input.reversal.kind !== "none") {
      add(
        errors,
        "IRREVERSIBLE_ACTION_HAS_REVERSAL",
        path + ".reversal",
        "effectively irreversible actions must use reversal kind none",
      );
    }
  } else if (record(input.reversal) && input.reversal.kind === "none") {
    add(
      errors,
      "REVERSIBLE_ACTION_MISSING_REVERSAL",
      path + ".reversal",
      "reversible actions must define how reversal is represented",
    );
  }

  if (
    input.classification === "immediately_reversible" &&
    input.minimumDelaySeconds !== undefined &&
    Number(input.minimumDelaySeconds) !== 0
  ) {
    add(
      errors,
      "IMMEDIATE_REVERSAL_HAS_DELAY",
      path + ".minimumDelaySeconds",
      "immediately reversible actions cannot require a positive delay",
    );
  }

  if (
    input.classification === "reversible_with_delay" &&
    (!Number.isInteger(input.minimumDelaySeconds) ||
      Number(input.minimumDelaySeconds) <= 0)
  ) {
    add(
      errors,
      "DELAYED_REVERSAL_REQUIRES_DELAY",
      path + ".minimumDelaySeconds",
      "reversible_with_delay requires a positive delay",
    );
  }

  if (input.pricingRollback !== undefined) {
    validatePricingRollbackContract(
      input.pricingRollback,
      path + ".pricingRollback",
      errors,
    );
  }
}

function validateRiskDimensions(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Array.isArray(input)) {
    add(errors, "INVALID_RISK_DIMENSIONS", path, "must be an array");
    return;
  }
  const seen = new Set<string>();
  input.forEach((risk, index) => {
    const itemPath = path + "[" + index + "]";
    if (!record(risk) || !RISK_DIMENSIONS.includes(risk.dimension as never)) {
      add(errors, "INVALID_RISK_DIMENSION", itemPath + ".dimension", "unsupported");
      return;
    }
    if (seen.has(String(risk.dimension))) {
      add(errors, "DUPLICATE_RISK_DIMENSION", itemPath + ".dimension", "duplicate");
    }
    seen.add(String(risk.dimension));
    if (!nonEmpty(risk.downsideDefinition)) {
      add(errors, "INVALID_RISK_DEFINITION", itemPath + ".downsideDefinition", "required");
    }
  });
}

function validateUncertaintyDimensions(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Array.isArray(input)) {
    add(errors, "INVALID_UNCERTAINTY_DIMENSIONS", path, "must be an array");
    return;
  }
  const seen = new Set<string>();
  input.forEach((item, index) => {
    const itemPath = path + "[" + index + "]";
    if (
      !record(item) ||
      !UNCERTAINTY_DIMENSIONS.includes(item.dimension as never)
    ) {
      add(errors, "INVALID_UNCERTAINTY_DIMENSION", itemPath + ".dimension", "unsupported");
      return;
    }
    if (seen.has(String(item.dimension))) {
      add(errors, "DUPLICATE_UNCERTAINTY_DIMENSION", itemPath + ".dimension", "duplicate");
    }
    seen.add(String(item.dimension));
    if (!nonEmpty(item.informationGap)) {
      add(errors, "INVALID_UNCERTAINTY_GAP", itemPath + ".informationGap", "required");
    }
    if (item.evidenceRefs !== undefined) {
      validateStringArray(item.evidenceRefs, itemPath + ".evidenceRefs", errors, true);
    }
  });
}

function validateMeasurement(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_MEASUREMENT", path, "measurement horizon is required");
    return;
  }

  validateNonNegativeInteger(
    input.earliestMeaningfulEvaluationSeconds,
    path + ".earliestMeaningfulEvaluationSeconds",
    errors,
  );
  validateNonNegativeInteger(
    input.primaryEvaluationSeconds,
    path + ".primaryEvaluationSeconds",
    errors,
  );
  if (input.longTermFollowUpSeconds !== undefined) {
    validateNonNegativeInteger(
      input.longTermFollowUpSeconds,
      path + ".longTermFollowUpSeconds",
      errors,
    );
  }

  if (
    Number.isInteger(input.earliestMeaningfulEvaluationSeconds) &&
    Number.isInteger(input.primaryEvaluationSeconds) &&
    Number(input.primaryEvaluationSeconds) <
      Number(input.earliestMeaningfulEvaluationSeconds)
  ) {
    add(
      errors,
      "PRIMARY_HORIZON_BEFORE_EARLIEST",
      path + ".primaryEvaluationSeconds",
      "primary horizon cannot precede earliest meaningful evaluation",
    );
  }
  if (
    Number.isInteger(input.primaryEvaluationSeconds) &&
    Number.isInteger(input.longTermFollowUpSeconds) &&
    Number(input.longTermFollowUpSeconds) < Number(input.primaryEvaluationSeconds)
  ) {
    add(
      errors,
      "LONG_TERM_HORIZON_BEFORE_PRIMARY",
      path + ".longTermFollowUpSeconds",
      "long-term follow-up cannot precede primary evaluation",
    );
  }

  if (!Array.isArray(input.outcomes) || input.outcomes.length === 0) {
    add(errors, "MISSING_TARGET_OUTCOMES", path + ".outcomes", "at least one outcome is required");
    return;
  }
  let primaryCount = 0;
  input.outcomes.forEach((outcome: unknown, index: number) => {
    const itemPath = path + ".outcomes[" + index + "]";
    if (!record(outcome) || !OUTCOME_FAMILIES.includes(outcome.family as never)) {
      add(errors, "INVALID_OUTCOME_FAMILY", itemPath + ".family", "unsupported");
      return;
    }
    if (!["primary", "guardrail"].includes(String(outcome.role))) {
      add(errors, "INVALID_OUTCOME_ROLE", itemPath + ".role", "must be primary or guardrail");
    }
    if (outcome.role === "primary") primaryCount += 1;
    if (outcome.metricId !== undefined && !nonEmpty(outcome.metricId)) {
      add(errors, "INVALID_OUTCOME_METRIC_ID", itemPath + ".metricId", "must be non-empty");
    }
  });
  if (primaryCount === 0) {
    add(errors, "MISSING_PRIMARY_OUTCOME", path + ".outcomes", "at least one primary outcome is required");
  }
}

function validateIntent(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.statement)) {
    add(errors, "INVALID_ACTION_INTENT", path + ".statement", "intent statement is required");
    return;
  }
  if (input.intentRef !== undefined && !nonEmpty(input.intentRef)) {
    add(errors, "INVALID_ACTION_INTENT_REF", path + ".intentRef", "must be non-empty");
  }
}

function validateProvenance(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROVENANCE", path, "provenance is required");
    return;
  }
  if (
    ![
      "human",
      "rule_based_baseline",
      "diagnosis_engine",
      "opportunity_engine",
      "optimizer",
      "experiment_selector",
      "imported_manual",
    ].includes(String(input.source))
  ) {
    add(errors, "INVALID_PROVENANCE_SOURCE", path + ".source", "unsupported");
  }
  if (input.sourceId !== undefined && !nonEmpty(input.sourceId)) {
    add(errors, "INVALID_PROVENANCE_SOURCE_ID", path + ".sourceId", "must be non-empty");
  }
  validateTimestamp(input.createdAt, path + ".createdAt", errors);
  validateStringArray(input.evidenceRefs, path + ".evidenceRefs", errors, true);
}

function contractFor(
  actionType: string,
  options: ActionValidationOptions,
): ActionTypeContract | undefined {
  return (
    options.additionalActionTypeContracts?.find(
      (contract) => contract.actionType === actionType,
    ) ?? getCoreActionTypeContract(actionType)
  );
}


function canonicalRuntimeKey(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalRuntimeKey).join(",") + "]";
  }
  if (!record(value)) return JSON.stringify(value);
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalRuntimeKey(value[key]))
      .join(",") +
    "}"
  );
}

function validatePricingActionSemantics(
  input: any,
  errors: ActionValidationIssue[],
): void {
  if (
    input.actionType !== "pricing.adjust_price" &&
    input.actionType !== "pricing.rollback_price"
  ) {
    return;
  }

  if (
    !record(input.target) ||
    !["sku", "product", "category", "collection"].includes(
      String(input.target.kind),
    )
  ) {
    add(
      errors,
      "INVALID_PRICING_TARGET",
      "target.kind",
      "pricing Actions must target SKU, product, category or collection",
    );
    return;
  }

  if (input.actionType === "pricing.adjust_price") {
    if (!record(input.parameters) || input.parameters.kind !== "price_adjustment") {
      return;
    }

    if (
      input.schemaVersion === "1.2.0" &&
      ["product", "category", "collection"].includes(String(input.target.kind))
    ) {
      if (input.parameters.membership === undefined) {
        add(
          errors,
          "MISSING_PRICING_MEMBERSHIP_SEMANTICS",
          "parameters.membership",
          "product/category/collection pricing requires an explicit membership evaluation boundary",
        );
      }
    }

    if (
      input.schemaVersion === "1.2.0" &&
      input.target.kind === "sku" &&
      input.parameters.membership !== undefined
    ) {
      add(
        errors,
        "SKU_PRICING_MEMBERSHIP_NOT_APPLICABLE",
        "parameters.membership",
        "SKU pricing does not require membership expansion semantics",
      );
    }

    const temporary =
      input.schemaVersion === "1.2.0" &&
      record(input.duration) &&
      input.duration.kind === "temporary";
    if (temporary) {
      if (
        !record(input.reversibility) ||
        !record(input.reversibility.pricingRollback) ||
        input.reversibility.pricingRollback.available !== true
      ) {
        add(
          errors,
          "TEMPORARY_PRICE_REQUIRES_SAFE_ROLLBACK",
          "reversibility.pricingRollback",
          "temporary pricing requires an available conflict-protected rollback contract",
        );
      }
    }

    if (
      record(input.reversibility) &&
      record(input.reversibility.pricingRollback) &&
      input.reversibility.pricingRollback.available === true
    ) {
      const rollback = input.reversibility.pricingRollback;
      if (
        canonicalRuntimeKey(rollback.target) !== canonicalRuntimeKey(input.target)
      ) {
        add(
          errors,
          "PRICING_ROLLBACK_TARGET_MISMATCH",
          "reversibility.pricingRollback.target",
          "rollback target must match the pricing Action target",
        );
      }
      if (
        record(rollback.conflictGuard) &&
        rollback.conflictGuard.sourceActionId !== input.actionId
      ) {
        add(
          errors,
          "PRICING_ROLLBACK_SOURCE_MISMATCH",
          "reversibility.pricingRollback.conflictGuard.sourceActionId",
          "rollback conflict guard must reference this pricing Action",
        );
      }
      if (
        record(rollback.trigger) &&
        rollback.trigger.kind === "AT" &&
        record(input.timing) &&
        record(input.timing.effectiveStart) &&
        input.timing.effectiveStart.kind === "known" &&
        typeof rollback.trigger.at === "string" &&
        Date.parse(rollback.trigger.at) <
          Date.parse(input.timing.effectiveStart.at)
      ) {
        add(
          errors,
          "ROLLBACK_BEFORE_PRICE_EFFECTIVE_TIME",
          "reversibility.pricingRollback.trigger.at",
          "rollback cannot occur before the price Action becomes effective",
        );
      }
    }
  }

  if (input.actionType === "pricing.rollback_price") {
    if (!record(input.parameters) || input.parameters.kind !== "price_rollback") {
      return;
    }
    if (!nonEmpty(input.reversalOfActionId)) {
      add(
        errors,
        "PRICING_ROLLBACK_REQUIRES_REVERSAL_REFERENCE",
        "reversalOfActionId",
        "rollback Action must reference the original pricing Action",
      );
    } else if (input.reversalOfActionId !== input.parameters.originalActionId) {
      add(
        errors,
        "PRICING_ROLLBACK_ORIGINAL_ACTION_MISMATCH",
        "reversalOfActionId",
        "rollback Action references must identify the same original pricing Action",
      );
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

export function validateAction(
  input: unknown,
  options: ActionValidationOptions = {},
): ActionValidationResult {
  const errors: ActionValidationIssue[] = [];

  if (!record(input)) {
    return {
      ok: false,
      errors: [{ code: "INVALID_ACTION", path: "$", message: "Action must be an object" }],
    };
  }

  validateForbiddenInformation(input, "$", errors);

  for (const key of Object.keys(input)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      add(
        errors,
        "UNKNOWN_ACTION_FIELD",
        key,
        "unknown Action fields are rejected rather than silently reinterpreted",
      );
    }
  }

  if (input.kind !== "atomic_action") {
    add(errors, "INVALID_ACTION_KIND", "kind", "Step 1 canonical Action must be atomic_action");
  }
  if (!SUPPORTED_ACTION_SCHEMA_VERSIONS.includes(input.schemaVersion as never)) {
    add(
      errors,
      "UNSUPPORTED_SCHEMA_VERSION",
      "schemaVersion",
      "supported Action schema versions are " +
        SUPPORTED_ACTION_SCHEMA_VERSIONS.join(", "),
    );
  }
  if (!nonEmpty(input.actionId) || !ACTION_ID_PATTERN.test(input.actionId)) {
    add(
      errors,
      "INVALID_ACTION_ID",
      "actionId",
      "must be a stable identifier beginning with action_",
    );
  }
  if (!nonEmpty(input.actionType) || !ACTION_TYPE_PATTERN.test(input.actionType)) {
    add(
      errors,
      "INVALID_ACTION_TYPE",
      "actionType",
      "must be a namespaced identifier such as advertising.adjust_budget",
    );
  }
  if (!nonEmpty(input.actionCategory) || !CATEGORY_PATTERN.test(input.actionCategory)) {
    add(errors, "INVALID_ACTION_CATEGORY", "actionCategory", "must be snake_case");
  }
  if (!nonEmpty(input.description)) {
    add(errors, "MISSING_DESCRIPTION", "description", "human-readable description is required");
  }

  validateSchemaFeatureCompatibility(input, errors);
  validateTarget(input.target, "target", errors);
  validateScope(input.scope, "scope", errors);

  const timing = validateTiming(input.timing, "timing", errors);
  validateParameters(input.parameters, "parameters", errors, timing.decisionTime);
  validateDuration(input.duration, "duration", errors);
  validateTermination(
    input.termination,
    "termination",
    errors,
    timing.effectiveStart,
    input.duration,
  );
  validateCost(input.cost, "cost", errors);

  if (!Array.isArray(input.resourceRequirements)) {
    add(errors, "INVALID_RESOURCE_REQUIREMENTS", "resourceRequirements", "must be an array");
  } else {
    input.resourceRequirements.forEach((resource: unknown, index: number) =>
      validateResource(resource, "resourceRequirements[" + index + "]", errors),
    );
  }

  const validProperties = new Set<string>([
    ...CORE_CONSTRAINT_PROPERTIES,
    ...(options.additionalConstraintProperties ?? []),
  ]);

  if (!Array.isArray(input.constraints)) {
    add(errors, "INVALID_CONSTRAINTS", "constraints", "must be an array");
  } else {
    input.constraints.forEach((constraint: unknown, index: number) =>
      validateConstraint(
        constraint,
        "constraints[" + index + "]",
        errors,
        validProperties,
      ),
    );
    validateConstraintBounds(input.constraints, errors);
  }

  if (!Array.isArray(input.preconditions)) {
    add(errors, "INVALID_PRECONDITIONS", "preconditions", "must be an array");
  } else {
    input.preconditions.forEach((precondition: unknown, index: number) =>
      validatePrecondition(
        precondition,
        "preconditions[" + index + "]",
        errors,
        validProperties,
      ),
    );
  }

  validateReversibility(input.reversibility, "reversibility", errors);
  if (
    record(input.duration) &&
    input.duration.kind === "until_reversed" &&
    record(input.reversibility) &&
    input.reversibility.classification === "effectively_irreversible"
  ) {
    add(
      errors,
      "UNTIL_REVERSED_BUT_IRREVERSIBLE",
      "duration",
      "until_reversed is incompatible with an effectively irreversible action",
    );
  }

  validateRiskDimensions(input.riskDimensions, "riskDimensions", errors);
  validateUncertaintyDimensions(
    input.uncertaintyDimensions,
    "uncertaintyDimensions",
    errors,
  );
  validateMeasurement(input.measurement, "measurement", errors);
  validateIntent(input.intent, "intent", errors);
  validateProvenance(input.provenance, "provenance", errors);
  validatePricingActionSemantics(input, errors);

  if (input.reversalOfActionId !== undefined) {
    if (!nonEmpty(input.reversalOfActionId)) {
      add(errors, "INVALID_REVERSAL_OF_ACTION_ID", "reversalOfActionId", "must be non-empty");
    } else if (input.reversalOfActionId === input.actionId) {
      add(errors, "SELF_REVERSAL", "reversalOfActionId", "action cannot reverse itself");
    }
  }

  const actionType = typeof input.actionType === "string" ? input.actionType : "";
  const contract = contractFor(actionType, options);
  if (!contract && actionType.length > 0) {
    add(
      errors,
      "UNREGISTERED_ACTION_TYPE",
      "actionType",
      "action type must have an explicit ActionTypeContract",
    );
  } else if (contract) {
    if (input.actionCategory !== contract.category) {
      add(
        errors,
        "ACTION_CATEGORY_MISMATCH",
        "actionCategory",
        "category does not match registered action type",
      );
    }
    if (
      record(input.target) &&
      typeof input.target.kind === "string" &&
      !contract.allowedTargetKinds.includes(input.target.kind as never)
    ) {
      add(
        errors,
        "ACTION_TARGET_KIND_MISMATCH",
        "target.kind",
        "target kind is not allowed for this action type",
      );
    }
    if (
      record(input.parameters) &&
      input.parameters.kind !== contract.parameterKind
    ) {
      add(
        errors,
        "ACTION_PARAMETER_KIND_MISMATCH",
        "parameters.kind",
        "parameter kind does not match registered action type",
      );
    }
  }

  return errors.length === 0
    ? { ok: true, action: input as unknown as Action, errors: [] }
    : { ok: false, errors };
}

export function assertValidAction(
  input: unknown,
  options: ActionValidationOptions = {},
): Action {
  const result = validateAction(input, options);
  if (!result.ok) throw new ActionValidationError(result.errors);
  return deepFreeze(result.action);
}

export const DEFAULT_ACTION_TYPE_CONTRACTS = CORE_ACTION_TYPE_CONTRACTS;
