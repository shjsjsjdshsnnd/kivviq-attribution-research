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
const PROMOTION_ID_PATTERN = /^promo_[A-Za-z0-9._:-]+$/;
const SHIPPING_OFFER_ID_PATTERN = /^shipoffer_[A-Za-z0-9._:-]+$/;
const MERCHANDISING_PLACEMENT_ID_PATTERN = /^merchplace_[A-Za-z0-9._:-]+$/;
const MERCHANDISING_RELATIONSHIP_ID_PATTERN = /^merchrel_[A-Za-z0-9._:-]+$/;
const CRO_EXPERIENCE_ID_PATTERN = /^croexp_[A-Za-z0-9._:-]+$/;
const LIFECYCLE_FLOW_ID_PATTERN = /^lifecycleflow_[A-Za-z0-9._:-]+$/;
const LIFECYCLE_POLICY_ID_PATTERN = /^lifecyclepolicy_[A-Za-z0-9._:-]+$/;

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
  "expectedLift",
  "expectedSynergy",
  "expectedValueOfInformation",
  "predictedBestAction",
  "predictedInvestigationValue",
  "bestCandidate",
  "expectedContribution",
  "expectedDemand",
  "expectedDemandLift",
  "expectedUnitsSold",
  "expectedROAS",
  "expectedConversions",
  "predictedElasticity",
  "predictedLift",
  "predictedRedemptions",
  "predictedAOV",
  "expectedConversionLift",
  "expectedAOV",
  "expectedOrders",
  "expectedShippingCost",
  "predictedDemand",
  "predictedAbandonmentReduction",
  "expectedCTR",
  "predictedPurchaseProbability",
  "predictedCrossSellRate",
  "predictedUpsellRate",
  "forecastDemand",
  "predictedStockoutDate",
  "predictedSellThrough",
  "expectedMargin",
  "predictedSupplierDelay",
  "futureSales",
  "futureReturns",
  "futureRealizedSupplierDelay",
  "actualReceiptAt",
  "counterfactualInventory",
  "expectedConversionRate",
  "expectedBounceReduction",
  "expectedCheckoutCompletion",
  "predictedRevenue",
  "counterfactualConversion",
  "trafficAllocation",
  "randomizationUnit",
  "significanceThreshold",
  "experimentResult",
  "variantPayload",
  "domSelector",
  "checkoutExtensionId",
  "shopifySectionId",
  "providerPayload",
  "futureSessions",
  "futureOrders",
  "expectedOpenRate",
  "expectedClickRate",
  "expectedRepeatPurchase",
  "expectedRetentionLift",
  "expectedLTV",
  "predictedChurnReduction",
  "predictedOptimalSendTime",
  "futurePurchase",
  "futureEngagement",
  "futureChurn",
  "futureSegmentMembership",
  "futureCustomerBehavior",
  "controlGroup",
  "statisticalPower",
  "subjectLine",
  "messageBody",
  "messageCreative",
  "smsCopy",
  "providerWorkflowId",
  "omnisendWorkflowId",
  "klaviyoFlowId",
  "mailchimpCampaignId",
  "attentiveCampaignId",
  "shopifyEmailCampaignId",
  "futureConversion",
  "futureInventory",
  "futureRevenue",
  "futureCartValue",
  "futureShippingCost",
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

const ACTION_SCHEMA_1_4_TARGET_KINDS = new Set([
  "shipping_offer",
]);

const ACTION_SCHEMA_1_4_PARAMETER_KINDS = new Set([
  "shipping_offer_set",
  "shipping_offer_modify",
  "shipping_offer_stop",
  "shipping_policy_adjustment",
  "shipping_policy_rollback",
]);

const ACTION_SCHEMA_1_4_ACTION_TYPES = new Set([
  "shipping.set_offer",
  "shipping.modify_offer",
  "shipping.stop_offer",
  "shipping.adjust_policy",
  "shipping.rollback_policy",
]);

const ACTION_SCHEMA_1_5_TARGET_KINDS = new Set([
  "merchandising_placement",
  "merchandising_relationship",
]);

const ACTION_SCHEMA_1_5_PARAMETER_KINDS = new Set([
  "merchandising_visibility",
  "merchandising_rank",
  "merchandising_relationship",
  "merchandising_remove_placement",
  "merchandising_remove_relationship",
  "merchandising_rank_rollback",
]);

const ACTION_SCHEMA_1_5_ACTION_TYPES = new Set([
  "merchandising.feature",
  "merchandising.deprioritize",
  "merchandising.set_rank",
  "merchandising.promote_substitute",
  "merchandising.set_cross_sell",
  "merchandising.set_upsell",
  "merchandising.remove_placement",
  "merchandising.remove_relationship",
  "merchandising.rollback_rank",
]);

const ACTION_SCHEMA_1_6_TARGET_KINDS = new Set([
  "inventory_location",
  "supplier_relationship",
  "inventory_set",
]);

const ACTION_SCHEMA_1_6_PARAMETER_KINDS = new Set([
  "inventory_reorder",
  "inventory_reorder_quantity",
  "inventory_reorder_timing",
  "inventory_policy_control",
  "inventory_protection",
  "inventory_backorder_policy",
  "inventory_clearance",
  "inventory_acceleration",
  "inventory_policy_rollback",
]);

const ACTION_SCHEMA_1_6_ACTION_TYPES = new Set([
  "inventory.reorder",
  "inventory.adjust_reorder_quantity",
  "inventory.adjust_reorder_timing",
  "inventory.set_safety_stock",
  "inventory.set_reorder_point",
  "inventory.protect_inventory",
  "inventory.set_backorder_policy",
  "inventory.clearance",
  "inventory.accelerate_excess_stock",
  "inventory.rollback_policy",
]);

const ACTION_SCHEMA_1_7_TARGET_KINDS = new Set([
  "cro_experience",
]);

const ACTION_SCHEMA_1_7_PARAMETER_KINDS = new Set([
  "cro_intervention",
  "cro_rollback",
]);

const ACTION_SCHEMA_1_7_ACTION_TYPES = new Set([
  "cro.modify_experience",
  "cro.add_element",
  "cro.remove_element",
  "cro.reorder_elements",
  "cro.modify_interaction",
  "cro.modify_navigation",
  "cro.modify_search",
  "cro.modify_checkout",
  "cro.rollback_experience",
]);

const ACTION_SCHEMA_1_8_TARGET_KINDS = new Set([
  "lifecycle_flow",
  "lifecycle_contact_policy",
]);

const ACTION_SCHEMA_1_8_PARAMETER_KINDS = new Set([
  "lifecycle_send",
  "lifecycle_flow_start",
  "lifecycle_flow_stop",
  "lifecycle_flow_modify",
  "lifecycle_targeting",
  "lifecycle_policy_rollback",
]);

const ACTION_SCHEMA_1_8_ACTION_TYPES = new Set([
  "lifecycle.send",
  "lifecycle.start_flow",
  "lifecycle.stop_flow",
  "lifecycle.modify_flow",
  "lifecycle.target_segment",
  "lifecycle.rollback_policy",
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

  if (
    schemaVersion === "1.0.0" ||
    schemaVersion === "1.1.0" ||
    schemaVersion === "1.2.0" ||
    schemaVersion === "1.3.0"
  ) {
    if (
      record(input.target) &&
      ACTION_SCHEMA_1_4_TARGET_KINDS.has(String(input.target.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_4","target.kind","this shipping target kind requires Action schema 1.4.0");
    }
    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_4_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_4","parameters.kind","this shipping parameter kind requires Action schema 1.4.0");
    }
    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_4_ACTION_TYPES.has(input.actionType)
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_4","actionType","this shipping Action type requires Action schema 1.4.0");
    }
    if (
      record(input.reversibility) &&
      input.reversibility.shippingRollback !== undefined
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_4","reversibility.shippingRollback","shipping rollback semantics require Action schema 1.4.0");
    }
  }

  if (
    schemaVersion === "1.0.0" ||
    schemaVersion === "1.1.0" ||
    schemaVersion === "1.2.0" ||
    schemaVersion === "1.3.0" ||
    schemaVersion === "1.4.0"
  ) {
    if (
      record(input.target) &&
      ACTION_SCHEMA_1_5_TARGET_KINDS.has(String(input.target.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_5","target.kind","this merchandising target kind requires Action schema 1.5.0");
    }
    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_5_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_5","parameters.kind","this merchandising parameter kind requires Action schema 1.5.0");
    }
    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_5_ACTION_TYPES.has(input.actionType)
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_5","actionType","this merchandising Action type requires Action schema 1.5.0");
    }
    if (
      record(input.reversibility) &&
      input.reversibility.merchandisingRollback !== undefined
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_5","reversibility.merchandisingRollback","merchandising rollback semantics require Action schema 1.5.0");
    }
  }

  if (
    schemaVersion === "1.0.0" ||
    schemaVersion === "1.1.0" ||
    schemaVersion === "1.2.0" ||
    schemaVersion === "1.3.0" ||
    schemaVersion === "1.4.0" ||
    schemaVersion === "1.5.0"
  ) {
    if (
      record(input.target) &&
      ACTION_SCHEMA_1_6_TARGET_KINDS.has(String(input.target.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_6","target.kind","this inventory target kind requires Action schema 1.6.0");
    }
    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_6_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_6","parameters.kind","this inventory parameter kind requires Action schema 1.6.0");
    }
    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_6_ACTION_TYPES.has(input.actionType)
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_6","actionType","this inventory Action type requires Action schema 1.6.0");
    }
    if (
      record(input.reversibility) &&
      input.reversibility.inventoryRollback !== undefined
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_6","reversibility.inventoryRollback","inventory rollback semantics require Action schema 1.6.0");
    }
  }

  if (
    schemaVersion === "1.0.0" ||
    schemaVersion === "1.1.0" ||
    schemaVersion === "1.2.0" ||
    schemaVersion === "1.3.0" ||
    schemaVersion === "1.4.0" ||
    schemaVersion === "1.5.0" ||
    schemaVersion === "1.6.0"
  ) {
    if (
      record(input.target) &&
      ACTION_SCHEMA_1_7_TARGET_KINDS.has(String(input.target.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_7","target.kind","this CRO target kind requires Action schema 1.7.0");
    }
    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_7_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_7","parameters.kind","this CRO parameter kind requires Action schema 1.7.0");
    }
    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_7_ACTION_TYPES.has(input.actionType)
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_7","actionType","this CRO Action type requires Action schema 1.7.0");
    }
    if (
      record(input.reversibility) &&
      input.reversibility.croRollback !== undefined
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_7","reversibility.croRollback","CRO rollback semantics require Action schema 1.7.0");
    }
  }

  if (
    schemaVersion === "1.0.0" ||
    schemaVersion === "1.1.0" ||
    schemaVersion === "1.2.0" ||
    schemaVersion === "1.3.0" ||
    schemaVersion === "1.4.0" ||
    schemaVersion === "1.5.0" ||
    schemaVersion === "1.6.0" ||
    schemaVersion === "1.7.0"
  ) {
    if (
      record(input.target) &&
      ACTION_SCHEMA_1_8_TARGET_KINDS.has(String(input.target.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_8","target.kind","this lifecycle target kind requires Action schema 1.8.0");
    }
    if (
      record(input.parameters) &&
      ACTION_SCHEMA_1_8_PARAMETER_KINDS.has(String(input.parameters.kind))
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_8","parameters.kind","this lifecycle parameter kind requires Action schema 1.8.0");
    }
    if (
      typeof input.actionType === "string" &&
      ACTION_SCHEMA_1_8_ACTION_TYPES.has(input.actionType)
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_8","actionType","this lifecycle Action type requires Action schema 1.8.0");
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "frequency_adjustment" &&
      input.parameters.policy !== undefined
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_8","parameters.policy","structured lifecycle frequency policy requires Action schema 1.8.0");
    }
    if (
      record(input.reversibility) &&
      input.reversibility.lifecycleRollback !== undefined
    ) {
      add(errors,"SCHEMA_FEATURE_REQUIRES_1_8","reversibility.lifecycleRollback","lifecycle rollback semantics require Action schema 1.8.0");
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
    lifecycle_flow: ["flowId"],
    lifecycle_contact_policy: ["contactPolicyId"],
    shipping_policy: ["shippingPolicyId"],
    shipping_offer: ["shippingOfferId"],
    inventory_policy: ["inventoryPolicyId"],
    inventory_location: ["inventoryLocationId"],
    supplier_relationship: ["supplierRelationshipId"],
    inventory_set: ["inventorySetId"],
    cro_experience: ["experienceId"],
    experiment: ["experimentId"],
    promotion: ["promotionId"],
    merchandising_placement: ["placementId"],
    merchandising_relationship: ["relationshipId"],
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


function validatePromotionMembership(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROMOTION_MEMBERSHIP", path, "membership semantics are required");
    return;
  }
  if (
    !["decision_time", "translation_time", "effective_time"].includes(
      String(input.evaluateAt),
    )
  ) {
    add(
      errors,
      "INVALID_PROMOTION_MEMBERSHIP_BOUNDARY",
      path + ".evaluateAt",
      "must be decision_time, translation_time or effective_time",
    );
  }
  if (input.bindingRef !== undefined && !nonEmpty(input.bindingRef)) {
    add(
      errors,
      "INVALID_PROMOTION_MEMBERSHIP_BINDING_REF",
      path + ".bindingRef",
      "bindingRef must be non-empty when supplied",
    );
  }
}

function promotionSelectorKey(input: unknown): string {
  if (!record(input)) return "";
  switch (input.kind) {
    case "sku":
      return "sku:" + String(input.skuId ?? "");
    case "product":
      return "product:" + String(input.productId ?? "");
    case "category":
      return "category:" + String(input.categoryId ?? "");
    case "collection":
      return "collection:" + String(input.collectionId ?? "");
    case "product_set":
      return "product_set:" + String(input.productSetId ?? "");
    case "brand":
      return "brand:" + String(input.brandId ?? "");
    default:
      return "";
  }
}

function validatePromotionEntitySelector(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_SELECTOR", path, "selector kind is required");
    return;
  }
  const required: Readonly<Record<string, string>> = {
    sku: "skuId",
    product: "productId",
    category: "categoryId",
    collection: "collectionId",
    product_set: "productSetId",
    brand: "brandId",
  };
  const field = required[input.kind];
  if (!field) {
    add(errors, "UNKNOWN_PROMOTION_SELECTOR", path + ".kind", "unsupported selector");
    return;
  }
  if (!nonEmpty(input[field])) {
    add(errors, "INVALID_PROMOTION_SELECTOR_ID", path + "." + field, "required");
  }
  if (input.kind === "sku" && input.productId !== undefined && !nonEmpty(input.productId)) {
    add(errors, "INVALID_PROMOTION_SELECTOR_PRODUCT_ID", path + ".productId", "must be non-empty");
  }
}

function validatePromotionDiscount(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_DISCOUNT", path, "discount kind is required");
    return;
  }
  if (input.kind === "PERCENTAGE") {
    if (
      !Number.isInteger(input.basisPoints) ||
      Number(input.basisPoints) <= 0 ||
      Number(input.basisPoints) > 10_000
    ) {
      add(
        errors,
        "INVALID_PROMOTION_PERCENTAGE",
        path + ".basisPoints",
        "percentage discount must be integer basis points within (0,10000]",
      );
    }
    return;
  }
  if (input.kind === "FIXED_AMOUNT") {
    validateMoney(input.value, path + ".value", errors);
    if (
      record(input.value) &&
      Number.isInteger(input.value.amountMinor) &&
      Number(input.value.amountMinor) <= 0
    ) {
      add(
        errors,
        "INVALID_FIXED_PROMOTION_AMOUNT",
        path + ".value.amountMinor",
        "fixed discount amount must be greater than zero",
      );
    }
    return;
  }
  if (input.kind === "FIXED_PROMOTIONAL_PRICE") {
    validateMoney(input.value, path + ".value", errors);
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_DISCOUNT", path + ".kind", "unsupported discount kind");
}

function validatePromotionBundleComponents(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  minimum: number,
): void {
  if (!Array.isArray(input) || input.length < minimum) {
    add(
      errors,
      "INVALID_PROMOTION_BUNDLE_COMPONENTS",
      path,
      "bundle requires at least " + minimum + " component(s)",
    );
    return;
  }
  const ids = new Set<string>();
  input.forEach((component: unknown, index: number) => {
    const componentPath = path + "[" + index + "]";
    if (!record(component) || !nonEmpty(component.componentId)) {
      add(errors, "INVALID_PROMOTION_BUNDLE_COMPONENT", componentPath, "componentId is required");
      return;
    }
    if (ids.has(component.componentId)) {
      add(errors, "DUPLICATE_PROMOTION_BUNDLE_COMPONENT", componentPath + ".componentId", "duplicate componentId");
    }
    ids.add(component.componentId);
    validateTarget(component.target, componentPath + ".target", errors);
    if (
      record(component.target) &&
      !["sku", "product"].includes(String(component.target.kind))
    ) {
      add(
        errors,
        "INVALID_PROMOTION_BUNDLE_TARGET",
        componentPath + ".target.kind",
        "bundle component must target SKU or product",
      );
    }
    validatePositiveInteger(component.quantity, componentPath + ".quantity", errors);
  });
}

function validatePromotionMechanism(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_MECHANISM", path, "mechanism kind is required");
    return;
  }
  if (input.kind === "DISCOUNT") {
    validatePromotionDiscount(input.discount, path + ".discount", errors);
    return;
  }
  if (input.kind === "BUNDLE_FIXED_PRICE") {
    validatePromotionBundleComponents(input.components, path + ".components", errors, 2);
    validateMoney(input.bundlePrice, path + ".bundlePrice", errors);
    return;
  }
  if (input.kind === "BUNDLE_PERCENTAGE_DISCOUNT") {
    validatePromotionBundleComponents(input.components, path + ".components", errors, 2);
    if (
      !Number.isInteger(input.basisPoints) ||
      Number(input.basisPoints) <= 0 ||
      Number(input.basisPoints) > 10_000
    ) {
      add(
        errors,
        "INVALID_BUNDLE_DISCOUNT_PERCENTAGE",
        path + ".basisPoints",
        "must be integer basis points within (0,10000]",
      );
    }
    return;
  }
  if (input.kind === "CONDITIONAL_ITEM_DISCOUNT") {
    validatePromotionBundleComponents(
      input.qualifyingComponents,
      path + ".qualifyingComponents",
      errors,
      1,
    );
    validateTarget(input.rewardTarget, path + ".rewardTarget", errors);
    if (
      record(input.rewardTarget) &&
      !["sku", "product"].includes(String(input.rewardTarget.kind))
    ) {
      add(
        errors,
        "INVALID_CONDITIONAL_REWARD_TARGET",
        path + ".rewardTarget.kind",
        "reward target must be SKU or product",
      );
    }
    validatePositiveInteger(input.rewardQuantity, path + ".rewardQuantity", errors);
    validatePromotionDiscount(input.discount, path + ".discount", errors);
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_MECHANISM", path + ".kind", "unsupported mechanism");
}

function validatePromotionProductScope(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROMOTION_PRODUCT_SCOPE", path, "product scope is required");
    return;
  }
  if (!Array.isArray(input.include) || input.include.length === 0) {
    add(errors, "PROMOTION_SCOPE_REQUIRES_INCLUDE", path + ".include", "at least one canonical inclusion selector is required");
  } else {
    input.include.forEach((selector: unknown, index: number) =>
      validatePromotionEntitySelector(selector, path + ".include[" + index + "]", errors),
    );
  }
  if (!Array.isArray(input.exclude)) {
    add(errors, "INVALID_PROMOTION_EXCLUSIONS", path + ".exclude", "exclude must be an array");
  } else {
    input.exclude.forEach((selector: unknown, index: number) =>
      validatePromotionEntitySelector(selector, path + ".exclude[" + index + "]", errors),
    );
  }

  if (Array.isArray(input.include)) {
    const keys = input.include.map(promotionSelectorKey).filter(Boolean);
    if (new Set(keys).size !== keys.length) {
      add(errors, "DUPLICATE_PROMOTION_INCLUDE", path + ".include", "include selectors must be unique");
    }
  }
  if (Array.isArray(input.exclude)) {
    const keys = input.exclude.map(promotionSelectorKey).filter(Boolean);
    if (new Set(keys).size !== keys.length) {
      add(errors, "DUPLICATE_PROMOTION_EXCLUDE", path + ".exclude", "exclude selectors must be unique");
    }
  }
  if (input.exclusionPrecedence !== "EXCLUDE_OVERRIDES_INCLUDE") {
    add(
      errors,
      "INVALID_PROMOTION_EXCLUSION_PRECEDENCE",
      path + ".exclusionPrecedence",
      "explicit EXCLUDE_OVERRIDES_INCLUDE precedence is required",
    );
  }

  const mutableSelector =
    (Array.isArray(input.include) ? input.include : [])
      .concat(Array.isArray(input.exclude) ? input.exclude : [])
      .some(
        (selector: unknown) =>
          record(selector) &&
          ["category", "collection", "product_set", "brand"].includes(
            String(selector.kind),
          ),
      );
  if (mutableSelector && input.membership === undefined) {
    add(
      errors,
      "MISSING_PROMOTION_MEMBERSHIP_SEMANTICS",
      path + ".membership",
      "mutable promotion scope requires an explicit membership evaluation boundary",
    );
  }
  if (input.membership !== undefined) {
    validatePromotionMembership(input.membership, path + ".membership", errors);
  }

  if (!Array.isArray(input.conditions)) {
    add(errors, "INVALID_PROMOTION_PRODUCT_CONDITIONS", path + ".conditions", "conditions must be an array");
  } else {
    input.conditions.forEach((condition: unknown, index: number) => {
      const conditionPath = path + ".conditions[" + index + "]";
      if (!record(condition) || !nonEmpty(condition.kind)) {
        add(errors, "INVALID_PROMOTION_PRODUCT_CONDITION", conditionPath, "condition kind is required");
        return;
      }
      if (condition.kind === "INVENTORY_AT_LEAST") {
        validatePromotionEntitySelector(condition.target, conditionPath + ".target", errors);
        validateNonNegativeInteger(condition.units, conditionPath + ".units", errors);
      } else if (condition.kind === "NOT_CLEARANCE") {
        return;
      } else if (condition.kind === "BRAND_NOT") {
        if (!nonEmpty(condition.brandId)) {
          add(errors, "INVALID_PROMOTION_EXCLUDED_BRAND", conditionPath + ".brandId", "brandId is required");
        }
      } else {
        add(errors, "UNKNOWN_PROMOTION_PRODUCT_CONDITION", conditionPath + ".kind", "unsupported condition");
      }
    });
  }
}

function validatePromotionApplicationScope(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_APPLICATION_SCOPE", path, "application scope kind is required");
    return;
  }
  if (input.kind === "PRODUCT_SCOPE") {
    validatePromotionProductScope(input.products, path + ".products", errors);
    return;
  }
  if (["ORDER_SCOPE", "BUNDLE_SCOPE"].includes(String(input.kind))) return;
  add(errors, "UNKNOWN_PROMOTION_APPLICATION_SCOPE", path + ".kind", "unsupported application scope");
}

function validatePromotionCustomerEligibility(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_CUSTOMER_ELIGIBILITY", path, "customer eligibility kind is required");
    return;
  }
  if (
    ["ALL_CUSTOMERS", "NEW_CUSTOMERS", "RETURNING_CUSTOMERS", "EMAIL_SUBSCRIBERS"].includes(
      String(input.kind),
    )
  ) {
    return;
  }
  if (["CUSTOMER_SEGMENT", "LOYALTY_SEGMENT"].includes(String(input.kind))) {
    if (!nonEmpty(input.segmentId)) {
      add(errors, "INVALID_PROMOTION_CUSTOMER_SEGMENT", path + ".segmentId", "segmentId is required");
    }
    validatePromotionMembership(input.membership, path + ".membership", errors);
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_CUSTOMER_ELIGIBILITY", path + ".kind", "unsupported customer eligibility");
}

function validatePromotionPurchaseRequirement(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_PURCHASE_REQUIREMENT", path, "requirement kind is required");
    return;
  }
  if (input.kind === "MIN_ORDER_VALUE") {
    validateMoney(input.value, path + ".value", errors);
    return;
  }
  if (input.kind === "MIN_QUANTITY") {
    validatePositiveInteger(input.quantity, path + ".quantity", errors);
    if (input.target !== undefined) {
      validatePromotionEntitySelector(input.target, path + ".target", errors);
    }
    return;
  }
  if (input.kind === "REQUIRED_TARGET") {
    validatePromotionEntitySelector(input.target, path + ".target", errors);
    validatePositiveInteger(input.quantity, path + ".quantity", errors);
    return;
  }
  if (input.kind === "REQUIRED_BUNDLE_COMPOSITION") {
    validatePromotionBundleComponents(input.components, path + ".components", errors, 1);
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_PURCHASE_REQUIREMENT", path + ".kind", "unsupported requirement");
}

function validatePromotionRedemption(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_REDEMPTION", path, "redemption kind is required");
    return;
  }
  if (input.kind === "AUTOMATIC") return;
  if (input.kind === "COUPON") {
    const hasCode = nonEmpty(input.code);
    const hasFamily = nonEmpty(input.codeFamilyRef);
    if (hasCode === hasFamily) {
      add(
        errors,
        "INVALID_COUPON_REFERENCE",
        path,
        "coupon requires exactly one of code or codeFamilyRef",
      );
    }
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_REDEMPTION", path + ".kind", "unsupported redemption");
}

function validatePromotionUsageLimits(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROMOTION_USAGE_LIMITS", path, "usageLimits object is required");
    return;
  }
  for (const field of [
    "maxTotalRedemptions",
    "maxRedemptionsPerCustomer",
    "maxDiscountedUnitsPerOrder",
  ]) {
    if (input[field] !== undefined) {
      validateNonNegativeInteger(input[field], path + "." + field, errors);
    }
  }
  if (input.maxPromotionalExposure !== undefined) {
    validateMoney(input.maxPromotionalExposure, path + ".maxPromotionalExposure", errors);
  }
}

function validatePromotionStacking(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_STACKING", path, "stacking kind is required");
    return;
  }
  if (["STACKABLE", "NON_STACKABLE"].includes(String(input.kind))) return;
  if (input.kind === "STACKABLE_WITH_TYPES") {
    const validTypes = new Set(["AUTOMATIC", "COUPON", "PRODUCT", "ORDER", "BUNDLE", "SHIPPING"]);
    if (
      !Array.isArray(input.types) ||
      input.types.length === 0 ||
      input.types.some((value: unknown) => !validTypes.has(String(value))) ||
      new Set(input.types.map(String)).size !== input.types.length
    ) {
      add(errors, "INVALID_PROMOTION_STACKING_TYPES", path + ".types", "types must be a non-empty unique supported list");
    }
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_STACKING", path + ".kind", "unsupported stacking kind");
}

function validatePromotionConflictResolution(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_PROMOTION_CONFLICT_RESOLUTION", path, "conflict resolution kind is required");
    return;
  }
  if (["NONE", "BEST_DISCOUNT"].includes(String(input.kind))) return;
  if (input.kind === "PRIORITY") {
    validateNonNegativeInteger(input.precedence, path + ".precedence", errors);
    return;
  }
  if (input.kind === "MUTUALLY_EXCLUSIVE_GROUP") {
    if (!nonEmpty(input.groupId)) {
      add(errors, "INVALID_PROMOTION_CONFLICT_GROUP", path + ".groupId", "groupId is required");
    }
    if (input.precedence !== undefined) {
      validateNonNegativeInteger(input.precedence, path + ".precedence", errors);
    }
    return;
  }
  add(errors, "UNKNOWN_PROMOTION_CONFLICT_RESOLUTION", path + ".kind", "unsupported conflict resolution");
}

function validatePromotionDefinition(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROMOTION_DEFINITION", path, "promotion definition is required");
    return;
  }

  validatePromotionMechanism(input.mechanism, path + ".mechanism", errors);
  validatePromotionApplicationScope(input.applicationScope, path + ".applicationScope", errors);
  validatePromotionCustomerEligibility(input.customerEligibility, path + ".customerEligibility", errors);

  if (!Array.isArray(input.purchaseRequirements)) {
    add(errors, "INVALID_PROMOTION_PURCHASE_REQUIREMENTS", path + ".purchaseRequirements", "must be an array");
  } else {
    input.purchaseRequirements.forEach((requirement: unknown, index: number) =>
      validatePromotionPurchaseRequirement(requirement, path + ".purchaseRequirements[" + index + "]", errors),
    );
  }

  validatePromotionRedemption(input.redemption, path + ".redemption", errors);
  validatePromotionUsageLimits(input.usageLimits, path + ".usageLimits", errors);
  validatePromotionStacking(input.stacking, path + ".stacking", errors);
  validatePromotionConflictResolution(input.conflictResolution, path + ".conflictResolution", errors);

  if (input.terminationBehavior !== "DEACTIVATE_PROMOTION") {
    add(
      errors,
      "INVALID_PROMOTION_TERMINATION_BEHAVIOR",
      path + ".terminationBehavior",
      "promotion termination must deactivate the promotion without mutating regular price",
    );
  }

  if (
    record(input.mechanism) &&
    ["BUNDLE_FIXED_PRICE", "BUNDLE_PERCENTAGE_DISCOUNT", "CONDITIONAL_ITEM_DISCOUNT"].includes(
      String(input.mechanism.kind),
    ) &&
    (!record(input.applicationScope) || input.applicationScope.kind !== "BUNDLE_SCOPE")
  ) {
    add(
      errors,
      "BUNDLE_MECHANISM_REQUIRES_BUNDLE_SCOPE",
      path + ".applicationScope",
      "bundle mechanisms require BUNDLE_SCOPE",
    );
  }

  if (
    record(input.mechanism) &&
    input.mechanism.kind === "DISCOUNT" &&
    record(input.mechanism.discount) &&
    input.mechanism.discount.kind === "FIXED_PROMOTIONAL_PRICE" &&
    record(input.applicationScope) &&
    input.applicationScope.kind === "ORDER_SCOPE"
  ) {
    add(
      errors,
      "PROMOTIONAL_PRICE_REQUIRES_PRODUCT_SCOPE",
      path + ".applicationScope",
      "fixed promotional price cannot target an order-wide scope",
    );
  }
}

function validatePromotionParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROMOTION_PARAMETERS", path, "promotion parameters are required");
    return;
  }
  if (input.kind === "promotion_start") {
    if (!nonEmpty(input.promotionId)) {
      add(errors, "INVALID_PROMOTION_ID", path + ".promotionId", "promotionId is required");
    }
    validatePromotionDefinition(input.definition, path + ".definition", errors);
    return;
  }
  if (input.kind === "promotion_stop") {
    if (!nonEmpty(input.targetPromotionId)) {
      add(errors, "INVALID_PROMOTION_ID", path + ".targetPromotionId", "targetPromotionId is required");
    }
    return;
  }
  if (input.kind === "promotion_modify") {
    if (!nonEmpty(input.targetPromotionId)) {
      add(errors, "INVALID_PROMOTION_ID", path + ".targetPromotionId", "targetPromotionId is required");
    }
    validatePromotionDefinition(input.definition, path + ".definition", errors);
    return;
  }
}


function validateShippingServiceSelector(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_SHIPPING_SERVICE",path,"shipping service kind is required"); return;
  }
  if (["STANDARD","EXPRESS","OVERSIZED","WHITE_GLOVE","LOCAL_DELIVERY"].includes(String(input.kind))) return;
  if (input.kind === "CUSTOM") {
    if (!nonEmpty(input.serviceId)) add(errors,"INVALID_SHIPPING_SERVICE_ID",path+".serviceId","serviceId is required");
    return;
  }
  add(errors,"UNKNOWN_SHIPPING_SERVICE",path+".kind","unsupported shipping service");
}

function validateShippingServiceScope(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if (!record(input)) { add(errors,"INVALID_SHIPPING_SERVICE_SCOPE",path,"service scope is required"); return; }
  if (!Array.isArray(input.include) || input.include.length === 0) {
    add(errors,"SHIPPING_SERVICE_INCLUDE_REQUIRED",path+".include","at least one service is required");
  } else input.include.forEach((v:unknown,i:number)=>validateShippingServiceSelector(v,path+".include["+i+"]",errors));
  if (!Array.isArray(input.exclude)) add(errors,"INVALID_SHIPPING_SERVICE_EXCLUDE",path+".exclude","exclude must be an array");
  else input.exclude.forEach((v:unknown,i:number)=>validateShippingServiceSelector(v,path+".exclude["+i+"]",errors));
  if (input.exclusionPrecedence !== "EXCLUDE_OVERRIDES_INCLUDE") {
    add(errors,"INVALID_SHIPPING_SERVICE_PRECEDENCE",path+".exclusionPrecedence","EXCLUDE_OVERRIDES_INCLUDE is required");
  }
}

function validateShippingGeographySelector(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if (!record(input) || !nonEmpty(input.kind)) { add(errors,"INVALID_SHIPPING_GEOGRAPHY",path,"geography kind is required"); return; }
  switch(input.kind) {
    case "COUNTRY":
      if (!nonEmpty(input.countryCode)) add(errors,"INVALID_COUNTRY_CODE",path+".countryCode","required");
      return;
    case "PROVINCE_STATE":
      if (!nonEmpty(input.countryCode)) add(errors,"INVALID_COUNTRY_CODE",path+".countryCode","required");
      if (!nonEmpty(input.regionCode)) add(errors,"INVALID_REGION_CODE",path+".regionCode","required");
      return;
    case "SHIPPING_ZONE":
    case "MERCHANT_SHIPPING_ZONE":
      if (!nonEmpty(input.shippingZoneId)) add(errors,"INVALID_SHIPPING_ZONE",path+".shippingZoneId","required");
      return;
    case "POSTAL_REGION":
      if (!nonEmpty(input.countryCode)) add(errors,"INVALID_COUNTRY_CODE",path+".countryCode","required");
      if (!nonEmpty(input.postalRegionId)) add(errors,"INVALID_POSTAL_REGION",path+".postalRegionId","required");
      return;
    default:
      add(errors,"UNKNOWN_SHIPPING_GEOGRAPHY",path+".kind","unsupported geography selector");
  }
}

function validateShippingGeographyScope(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if (!record(input)) { add(errors,"INVALID_SHIPPING_GEOGRAPHY_SCOPE",path,"geography scope is required"); return; }
  if (!Array.isArray(input.include) || input.include.length === 0) {
    add(errors,"SHIPPING_GEOGRAPHY_INCLUDE_REQUIRED",path+".include","at least one geography include is required");
  } else input.include.forEach((v:unknown,i:number)=>validateShippingGeographySelector(v,path+".include["+i+"]",errors));
  if (!Array.isArray(input.exclude)) add(errors,"INVALID_SHIPPING_GEOGRAPHY_EXCLUDE",path+".exclude","exclude must be an array");
  else input.exclude.forEach((v:unknown,i:number)=>validateShippingGeographySelector(v,path+".exclude["+i+"]",errors));
  if (input.exclusionPrecedence !== "EXCLUDE_OVERRIDES_INCLUDE") add(errors,"INVALID_SHIPPING_GEOGRAPHY_PRECEDENCE",path+".exclusionPrecedence","EXCLUDE_OVERRIDES_INCLUDE is required");
}

function validateShippingProductSelector(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  validatePromotionEntitySelector(input,path,errors);
}

function validateShippingMembership(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  validatePromotionMembership(input,path,errors);
}

function validateShippingMixedCart(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if (!record(input) || !nonEmpty(input.kind)) { add(errors,"INVALID_SHIPPING_MIXED_CART",path,"mixed-cart semantics are required"); return; }
  if (["ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM","ENTIRE_ORDER_IF_ALL_ITEMS_ELIGIBLE","ELIGIBLE_ITEMS_ONLY"].includes(String(input.kind))) return;
  if (input.kind === "QUALIFYING_SUBTOTAL_THRESHOLD") {
    validateMoney(input.threshold,path+".threshold",errors);
    if (input.thresholdBasis !== "QUALIFYING_PRODUCT_SUBTOTAL") add(errors,"INVALID_SHIPPING_QUALIFYING_THRESHOLD_BASIS",path+".thresholdBasis","must be QUALIFYING_PRODUCT_SUBTOTAL");
    return;
  }
  add(errors,"UNKNOWN_SHIPPING_MIXED_CART",path+".kind","unsupported mixed-cart semantics");
}

function validateShippingProductScope(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if (!record(input)) { add(errors,"INVALID_SHIPPING_PRODUCT_SCOPE",path,"product scope is required"); return; }
  if (!Array.isArray(input.include) || input.include.length === 0) add(errors,"SHIPPING_PRODUCT_INCLUDE_REQUIRED",path+".include","at least one inclusion is required");
  else input.include.forEach((v:unknown,i:number)=>validateShippingProductSelector(v,path+".include["+i+"]",errors));
  if (!Array.isArray(input.exclude)) add(errors,"INVALID_SHIPPING_PRODUCT_EXCLUDE",path+".exclude","exclude must be an array");
  else input.exclude.forEach((v:unknown,i:number)=>validateShippingProductSelector(v,path+".exclude["+i+"]",errors));
  if (input.exclusionPrecedence !== "EXCLUDE_OVERRIDES_INCLUDE") add(errors,"INVALID_SHIPPING_PRODUCT_PRECEDENCE",path+".exclusionPrecedence","EXCLUDE_OVERRIDES_INCLUDE is required");
  validateShippingMixedCart(input.mixedCart,path+".mixedCart",errors);
  const mutable = [...(Array.isArray(input.include)?input.include:[]),...(Array.isArray(input.exclude)?input.exclude:[])].some((v:unknown)=>record(v)&&["category","collection","product_set","brand"].includes(String(v.kind)));
  if (mutable && input.membership===undefined) add(errors,"MISSING_SHIPPING_MEMBERSHIP_SEMANTICS",path+".membership","mutable shipping scope requires explicit membership boundary");
  if (input.membership!==undefined) validateShippingMembership(input.membership,path+".membership",errors);
  if (!Array.isArray(input.conditions)) add(errors,"INVALID_SHIPPING_PRODUCT_CONDITIONS",path+".conditions","conditions must be an array");
  else input.conditions.forEach((v:unknown,i:number)=>{
    const p=path+".conditions["+i+"]";
    if(!record(v)||!nonEmpty(v.kind)){add(errors,"INVALID_SHIPPING_PRODUCT_CONDITION",p,"kind required");return;}
    if(["NOT_OVERSIZED","NOT_FREIGHT_ONLY","NOT_WHITE_GLOVE_ONLY"].includes(String(v.kind))) return;
    if(v.kind==="SHIPPING_CLASS_IN"){
      if(!Array.isArray(v.shippingClassIds)||v.shippingClassIds.length===0||v.shippingClassIds.some((x:unknown)=>!nonEmpty(x))) add(errors,"INVALID_SHIPPING_CLASS_IDS",p+".shippingClassIds","non-empty shipping class IDs required");
      return;
    }
    add(errors,"UNKNOWN_SHIPPING_PRODUCT_CONDITION",p+".kind","unsupported shipping product condition");
  });
}

function validateShippingCustomerEligibility(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_SHIPPING_CUSTOMER_ELIGIBILITY",path,"kind required");return;}
  if(["ALL_CUSTOMERS","NEW_CUSTOMERS","RETURNING_CUSTOMERS"].includes(String(input.kind))) return;
  if(["CUSTOMER_SEGMENT","LOYALTY_SEGMENT"].includes(String(input.kind))){
    if(!nonEmpty(input.segmentId)) add(errors,"INVALID_SHIPPING_CUSTOMER_SEGMENT",path+".segmentId","segmentId required");
    validateShippingMembership(input.membership,path+".membership",errors); return;
  }
  add(errors,"UNKNOWN_SHIPPING_CUSTOMER_ELIGIBILITY",path+".kind","unsupported customer eligibility");
}

function validateShippingCartRequirement(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_SHIPPING_CART_REQUIREMENT",path,"kind required");return;}
  if(input.kind==="MIN_SUBTOTAL"){
    validateMoney(input.value,path+".value",errors);
    if(!["PRE_DISCOUNT_SUBTOTAL","POST_DISCOUNT_SUBTOTAL","QUALIFYING_PRODUCT_SUBTOTAL"].includes(String(input.basis))) add(errors,"INVALID_SHIPPING_THRESHOLD_BASIS",path+".basis","explicit threshold basis required");
    return;
  }
  if(input.kind==="MIN_QUANTITY"){
    validatePositiveInteger(input.quantity,path+".quantity",errors);
    if(input.target!==undefined) validateShippingProductSelector(input.target,path+".target",errors);
    return;
  }
  if(input.kind==="REQUIRED_TARGET"){
    validateShippingProductSelector(input.target,path+".target",errors);
    validatePositiveInteger(input.quantity,path+".quantity",errors); return;
  }
  add(errors,"UNKNOWN_SHIPPING_CART_REQUIREMENT",path+".kind","unsupported cart requirement");
}

function validateShippingBenefit(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_SHIPPING_BENEFIT",path,"benefit kind required");return;}
  if(input.kind==="FREE_SHIPPING") return;
  if(input.kind==="FLAT_RATE"){validateMoney(input.customerShippingCharge,path+".customerShippingCharge",errors);return;}
  if(input.kind==="SHIPPING_CREDIT"){validateMoney(input.customerShippingCredit,path+".customerShippingCredit",errors);return;}
  add(errors,"UNKNOWN_SHIPPING_BENEFIT",path+".kind","unsupported shipping benefit");
}

function validateShippingConflict(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_SHIPPING_CONFLICT",path,"conflict kind required");return;}
  if(["NONE","BEST_BENEFIT"].includes(String(input.kind))) return;
  if(input.kind==="PRECEDENCE"){validateNonNegativeInteger(input.precedence,path+".precedence",errors);return;}
  if(input.kind==="MUTUALLY_EXCLUSIVE_GROUP"){
    if(!nonEmpty(input.groupId)) add(errors,"INVALID_SHIPPING_CONFLICT_GROUP",path+".groupId","groupId required");
    if(input.precedence!==undefined) validateNonNegativeInteger(input.precedence,path+".precedence",errors);
    return;
  }
  add(errors,"UNKNOWN_SHIPPING_CONFLICT",path+".kind","unsupported conflict resolution");
}

function validateShippingOfferDefinition(input: unknown,path: string,errors: ActionValidationIssue[]): void {
  if(!record(input)){add(errors,"INVALID_SHIPPING_OFFER_DEFINITION",path,"definition required");return;}
  validateShippingBenefit(input.benefit,path+".benefit",errors);
  validateShippingServiceScope(input.services,path+".services",errors);
  validateShippingGeographyScope(input.geography,path+".geography",errors);
  if(input.products!==undefined) validateShippingProductScope(input.products,path+".products",errors);
  validateShippingCustomerEligibility(input.customerEligibility,path+".customerEligibility",errors);
  if(!Array.isArray(input.cartRequirements)) add(errors,"INVALID_SHIPPING_CART_REQUIREMENTS",path+".cartRequirements","must be an array");
  else input.cartRequirements.forEach((v:unknown,i:number)=>validateShippingCartRequirement(v,path+".cartRequirements["+i+"]",errors));
  if(!record(input.stacking)||!["COEXIST","NON_STACKABLE"].includes(String(input.stacking.kind))) add(errors,"INVALID_SHIPPING_STACKING",path+".stacking","must be COEXIST or NON_STACKABLE");
  validateShippingConflict(input.conflictResolution,path+".conflictResolution",errors);
  if(input.terminationBehavior!=="DEACTIVATE_SHIPPING_OFFER") add(errors,"INVALID_SHIPPING_TERMINATION_BEHAVIOR",path+".terminationBehavior","offer termination must deactivate the offer");
}

function validateShippingPolicyDefinition(input: unknown,path: string,errors: ActionValidationIssue[],decisionTime?: string): void {
  if(!record(input)||input.kind!=="FREE_SHIPPING_THRESHOLD"){add(errors,"INVALID_SHIPPING_POLICY_DEFINITION",path,"FREE_SHIPPING_THRESHOLD policy required");return;}
  validateShippingServiceSelector(input.service,path+".service",errors);
  if(!["PRE_DISCOUNT_SUBTOTAL","POST_DISCOUNT_SUBTOTAL","QUALIFYING_PRODUCT_SUBTOTAL"].includes(String(input.thresholdBasis))) add(errors,"INVALID_SHIPPING_THRESHOLD_BASIS",path+".thresholdBasis","explicit threshold basis required");
  validateOperation(input.operation,path+".operation",errors,"money",decisionTime);
  if(input.operation && record(input.operation) && input.operation.kind==="DELTA" && record(input.operation.amount) && record(input.operation.reference) && input.operation.reference.kind==="explicit_baseline" && record(input.operation.reference.value)){
    if(input.operation.amount.currency!==input.operation.reference.value.currency) add(errors,"SHIPPING_THRESHOLD_CURRENCY_MISMATCH",path+".operation","threshold DELTA amount and baseline currency must match");
    if(input.operation.direction==="decrease"&&Number(input.operation.amount.amountMinor)>Number(input.operation.reference.value.amountMinor)) add(errors,"SHIPPING_THRESHOLD_WOULD_BECOME_NEGATIVE",path+".operation","threshold decrease cannot exceed baseline");
  }
  validateShippingGeographyScope(input.geography,path+".geography",errors);
  if(input.products!==undefined) validateShippingProductScope(input.products,path+".products",errors);
  validateShippingCustomerEligibility(input.customerEligibility,path+".customerEligibility",errors);
}

function validateShippingRollbackStrategy(input: unknown,path: string,errors: ActionValidationIssue[],decisionTime?: string): void {
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_SHIPPING_ROLLBACK_STRATEGY",path,"strategy required");return;}
  if(input.kind==="RESTORE_PRE_ACTION_VALUE"){validateReference(input.preActionThreshold,path+".preActionThreshold",errors,decisionTime,"money");return;}
  if(input.kind==="SET_EXPLICIT_VALUE"){validateMoney(input.value,path+".value",errors);return;}
  add(errors,"UNKNOWN_SHIPPING_ROLLBACK_STRATEGY",path+".kind","unsupported rollback strategy");
}

function validateShippingRollbackGuard(input: unknown,path: string,errors: ActionValidationIssue[],originalActionId?:string): void {
  if(!record(input)||input.kind!=="REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT"){add(errors,"INVALID_SHIPPING_ROLLBACK_GUARD",path,"conflict guard required");return;}
  if(!nonEmpty(input.sourceActionId)) add(errors,"INVALID_SHIPPING_ROLLBACK_SOURCE",path+".sourceActionId","required");
  else if(originalActionId&&input.sourceActionId!==originalActionId) add(errors,"SHIPPING_ROLLBACK_SOURCE_MISMATCH",path+".sourceActionId","must reference original Action");
  validateMoney(input.expectedThreshold,path+".expectedThreshold",errors);
}

function validateShippingParameters(input: unknown,path: string,errors: ActionValidationIssue[],decisionTime?:string): void {
  if(!record(input)){add(errors,"INVALID_SHIPPING_PARAMETERS",path,"parameters required");return;}
  if(input.kind==="shipping_offer_set"){
    if(!nonEmpty(input.shippingOfferId)) add(errors,"INVALID_SHIPPING_OFFER_ID",path+".shippingOfferId","required");
    validateShippingOfferDefinition(input.definition,path+".definition",errors); return;
  }
  if(input.kind==="shipping_offer_modify"){
    if(!nonEmpty(input.targetShippingOfferId)) add(errors,"INVALID_SHIPPING_OFFER_ID",path+".targetShippingOfferId","required");
    validateShippingOfferDefinition(input.definition,path+".definition",errors); return;
  }
  if(input.kind==="shipping_offer_stop"){
    if(!nonEmpty(input.targetShippingOfferId)) add(errors,"INVALID_SHIPPING_OFFER_ID",path+".targetShippingOfferId","required"); return;
  }
  if(input.kind==="shipping_policy_adjustment"){validateShippingPolicyDefinition(input.definition,path+".definition",errors,decisionTime);return;}
  if(input.kind==="shipping_policy_rollback"){
    if(!nonEmpty(input.originalActionId)) add(errors,"INVALID_SHIPPING_ROLLBACK_ORIGINAL",path+".originalActionId","required");
    validateShippingRollbackStrategy(input.strategy,path+".strategy",errors,decisionTime);
    validateShippingRollbackGuard(input.conflictGuard,path+".conflictGuard",errors,typeof input.originalActionId==="string"?input.originalActionId:undefined);return;
  }
}

function validateMerchandisingEntityTarget(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  validateTarget(input, path, errors);
  if (
    record(input) &&
    !["sku", "product", "collection"].includes(String(input.kind))
  ) {
    add(
      errors,
      "INVALID_MERCHANDISING_ENTITY_TARGET",
      path + ".kind",
      "merchandising entity must be SKU, product or collection",
    );
  }
}

function validateMerchandisingSurface(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_MERCHANDISING_SURFACE", path, "surface kind is required");
    return;
  }
  switch (input.kind) {
    case "COLLECTION_PAGE":
      if (!nonEmpty(input.collectionId)) {
        add(errors, "INVALID_MERCHANDISING_SURFACE_ID", path + ".collectionId", "required");
      }
      return;
    case "CATEGORY_PAGE":
      if (!nonEmpty(input.categoryId)) {
        add(errors, "INVALID_MERCHANDISING_SURFACE_ID", path + ".categoryId", "required");
      }
      return;
    case "SEARCH_RESULTS":
      if (!nonEmpty(input.searchScopeId)) {
        add(errors, "INVALID_MERCHANDISING_SURFACE_ID", path + ".searchScopeId", "required");
      }
      return;
    case "HOMEPAGE":
    case "CART":
    case "CHECKOUT":
    case "POST_PURCHASE":
      if (input.areaId !== undefined && !nonEmpty(input.areaId)) {
        add(errors, "INVALID_MERCHANDISING_AREA_ID", path + ".areaId", "must be non-empty when supplied");
      }
      return;
    case "PRODUCT_PAGE":
      if (!nonEmpty(input.productId)) {
        add(errors, "INVALID_MERCHANDISING_SURFACE_ID", path + ".productId", "required");
      }
      return;
    case "RECOMMENDATION_SLOT":
      if (!nonEmpty(input.slotGroupId)) {
        add(errors, "INVALID_MERCHANDISING_SURFACE_ID", path + ".slotGroupId", "required");
      }
      return;
    case "CUSTOM":
      if (!nonEmpty(input.surfaceId)) {
        add(errors, "INVALID_MERCHANDISING_SURFACE_ID", path + ".surfaceId", "required");
      }
      return;
    default:
      add(errors, "UNKNOWN_MERCHANDISING_SURFACE", path + ".kind", "unsupported surface");
  }
}

function validateMerchandisingPlacement(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_MERCHANDISING_PLACEMENT", path, "placement kind is required");
    return;
  }
  if (input.kind === "POSITION") {
    validatePositiveInteger(input.position, path + ".position", errors);
    return;
  }
  if (input.kind === "NAMED_SLOT") {
    if (!nonEmpty(input.slotId)) {
      add(errors, "INVALID_MERCHANDISING_SLOT", path + ".slotId", "slotId is required");
    }
    return;
  }
  add(errors, "UNKNOWN_MERCHANDISING_PLACEMENT", path + ".kind", "unsupported placement");
}

function validateMerchandisingConflict(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_MERCHANDISING_CONFLICT", path, "conflict kind is required");
    return;
  }
  if (input.kind === "COEXIST") return;
  if (input.kind === "PRECEDENCE") {
    validateNonNegativeInteger(input.precedence, path + ".precedence", errors);
    return;
  }
  if (input.kind === "MUTUALLY_EXCLUSIVE_GROUP") {
    if (!nonEmpty(input.groupId)) {
      add(errors, "INVALID_MERCHANDISING_CONFLICT_GROUP", path + ".groupId", "groupId is required");
    }
    if (input.precedence !== undefined) {
      validateNonNegativeInteger(input.precedence, path + ".precedence", errors);
    }
    return;
  }
  add(errors, "UNKNOWN_MERCHANDISING_CONFLICT", path + ".kind", "unsupported conflict kind");
}

function validateMerchandisingSnapshotRef(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_MERCHANDISING_SNAPSHOT_REF", path, "snapshot reference is required");
    return;
  }
  if (!nonEmpty(input.bindingRef)) {
    add(errors, "INVALID_MERCHANDISING_SNAPSHOT_BINDING", path + ".bindingRef", "bindingRef is required");
  }
  if (
    !["decision_time", "translation_time", "effective_time"].includes(
      String(input.evaluateAt),
    )
  ) {
    add(
      errors,
      "INVALID_MERCHANDISING_SNAPSHOT_BOUNDARY",
      path + ".evaluateAt",
      "must be decision_time, translation_time or effective_time",
    );
  }
}

function validateMerchandisingRankOperation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_MERCHANDISING_RANK_OPERATION", path, "rank operation is required");
    return;
  }
  if (input.kind === "SET") {
    validatePositiveInteger(input.position, path + ".position", errors);
    return;
  }
  if (input.kind === "DELTA") {
    if (!["UP", "DOWN"].includes(String(input.direction))) {
      add(errors, "INVALID_MERCHANDISING_RANK_DIRECTION", path + ".direction", "must be UP or DOWN");
    }
    validatePositiveInteger(input.positions, path + ".positions", errors);
    validateMerchandisingSnapshotRef(input.snapshot, path + ".snapshot", errors);
    return;
  }
  if (input.kind === "MOVE_TO_TOP") {
    if (input.snapshot !== undefined) {
      validateMerchandisingSnapshotRef(input.snapshot, path + ".snapshot", errors);
    }
    return;
  }
  add(errors, "UNKNOWN_MERCHANDISING_RANK_OPERATION", path + ".kind", "unsupported rank operation");
}

function validateMerchandisingRelationshipTrigger(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_MERCHANDISING_RELATIONSHIP_TRIGGER", path, "trigger kind is required");
    return;
  }
  if (["ALWAYS", "SOURCE_OUT_OF_STOCK"].includes(String(input.kind))) return;
  if (input.kind === "SOURCE_INVENTORY_AT_MOST") {
    validateNonNegativeInteger(input.units, path + ".units", errors);
    return;
  }
  add(errors, "UNKNOWN_MERCHANDISING_RELATIONSHIP_TRIGGER", path + ".kind", "unsupported trigger");
}

function merchandisingTargetKey(input: unknown): string {
  if (!record(input)) return "";
  if (input.kind === "product") return "product:" + String(input.productId ?? "");
  if (input.kind === "sku") return "sku:" + String(input.skuId ?? "");
  if (input.kind === "collection") return "collection:" + String(input.collectionId ?? "");
  return "";
}

function validateMerchandisingRelationship(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_MERCHANDISING_RELATIONSHIP", path, "relationship parameters are required");
    return;
  }
  if (!["SUBSTITUTE", "CROSS_SELL", "UPSELL"].includes(String(input.relationshipType))) {
    add(errors, "INVALID_MERCHANDISING_RELATIONSHIP_TYPE", path + ".relationshipType", "unsupported relationship type");
  }
  validateTarget(input.source, path + ".source", errors);
  if (
    record(input.source) &&
    !["sku", "product"].includes(String(input.source.kind))
  ) {
    add(errors, "INVALID_MERCHANDISING_RELATIONSHIP_SOURCE", path + ".source.kind", "source must be SKU or product");
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    add(errors, "INVALID_MERCHANDISING_RELATIONSHIP_TARGETS", path + ".targets", "at least one ordered target is required");
  } else {
    const positions:number[] = [];
    const targetKeys = new Set<string>();
    input.targets.forEach((target:unknown,index:number)=>{
      const p=path+".targets["+index+"]";
      if(!record(target)){
        add(errors,"INVALID_MERCHANDISING_RELATIONSHIP_TARGET",p,"target object required");
        return;
      }
      validateTarget(target.entity,p+".entity",errors);
      if(record(target.entity)&&!["sku","product"].includes(String(target.entity.kind))){
        add(errors,"INVALID_MERCHANDISING_RELATIONSHIP_TARGET_KIND",p+".entity.kind","target must be SKU or product");
      }
      validatePositiveInteger(target.position,p+".position",errors);
      if(Number.isInteger(target.position)) positions.push(Number(target.position));
      const key=merchandisingTargetKey(target.entity);
      if(key&&targetKeys.has(key)) add(errors,"DUPLICATE_MERCHANDISING_RELATIONSHIP_TARGET",p+".entity","relationship targets must be unique");
      if(key) targetKeys.add(key);
      if(key&&key===merchandisingTargetKey(input.source)) add(errors,"MERCHANDISING_RELATIONSHIP_SELF_TARGET",p+".entity","source cannot recommend itself");
    });
    const sorted=[...positions].sort((a,b)=>a-b);
    if(sorted.some((value,index)=>value!==index+1)){
      add(errors,"MERCHANDISING_RELATIONSHIP_POSITIONS_NOT_CONTIGUOUS",path+".targets","ordered relationship positions must be contiguous starting at 1");
    }
  }
  validateMerchandisingSurface(input.surface,path+".surface",errors);
  validateMerchandisingRelationshipTrigger(input.trigger,path+".trigger",errors);
  validateMerchandisingConflict(input.conflictResolution,path+".conflictResolution",errors);
}

function validateMerchandisingRollbackStrategy(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_MERCHANDISING_ROLLBACK_STRATEGY", path, "strategy is required");
    return;
  }
  if (input.kind === "RESTORE_PRE_ACTION_VALUE") {
    if (!nonEmpty(input.rankingSnapshotRef)) {
      add(errors, "INVALID_MERCHANDISING_ROLLBACK_SNAPSHOT", path + ".rankingSnapshotRef", "snapshot ref is required");
    }
    return;
  }
  if (input.kind === "SET_EXPLICIT_VALUE") {
    validatePositiveInteger(input.position, path + ".position", errors);
    return;
  }
  add(errors, "UNKNOWN_MERCHANDISING_ROLLBACK_STRATEGY", path + ".kind", "unsupported rollback strategy");
}

function validateMerchandisingRollbackGuard(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  originalActionId?: string,
): void {
  if (!record(input) || input.kind !== "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT") {
    add(errors, "INVALID_MERCHANDISING_ROLLBACK_GUARD", path, "conflict guard is required");
    return;
  }
  if (!nonEmpty(input.sourceActionId)) {
    add(errors, "INVALID_MERCHANDISING_ROLLBACK_SOURCE", path + ".sourceActionId", "required");
  } else if (originalActionId && input.sourceActionId !== originalActionId) {
    add(errors, "MERCHANDISING_ROLLBACK_SOURCE_MISMATCH", path + ".sourceActionId", "must reference original Action");
  }
  validatePositiveInteger(input.expectedPosition, path + ".expectedPosition", errors);
}

function validateMerchandisingParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_MERCHANDISING_PARAMETERS", path, "parameters are required");
    return;
  }
  if (input.kind === "merchandising_visibility") {
    validateMerchandisingEntityTarget(input.entity,path+".entity",errors);
    validateMerchandisingSurface(input.surface,path+".surface",errors);
    if (input.placementId !== undefined) {
      if (!nonEmpty(input.placementId) || !MERCHANDISING_PLACEMENT_ID_PATTERN.test(input.placementId)) {
        add(errors,"INVALID_MERCHANDISING_PLACEMENT_ID",path+".placementId","placementId must begin with merchplace_");
      }
    }
    if (input.placement !== undefined) validateMerchandisingPlacement(input.placement,path+".placement",errors);
    if (!record(input.visibility) || !nonEmpty(input.visibility.kind)) {
      add(errors,"INVALID_MERCHANDISING_VISIBILITY",path+".visibility","visibility mode required");
    } else if (input.visibility.kind === "DEPRIORITIZE") {
      if (input.visibility.belowPosition !== undefined) {
        validatePositiveInteger(input.visibility.belowPosition,path+".visibility.belowPosition",errors);
      }
    } else if (!["FEATURE","REMOVE_PLACEMENT"].includes(String(input.visibility.kind))) {
      add(errors,"UNKNOWN_MERCHANDISING_VISIBILITY",path+".visibility.kind","unsupported visibility mode");
    }
    if (input.visibility.kind === "FEATURE" && input.placementId === undefined) {
      add(errors,"FEATURE_REQUIRES_PLACEMENT_ID",path+".placementId","feature placement requires stable merchplace_* identity");
    }
    validateMerchandisingConflict(input.conflictResolution,path+".conflictResolution",errors);
    return;
  }
  if (input.kind === "merchandising_rank") {
    validateMerchandisingEntityTarget(input.entity,path+".entity",errors);
    validateMerchandisingSurface(input.surface,path+".surface",errors);
    validateMerchandisingRankOperation(input.operation,path+".operation",errors);
    if (input.displacement !== "SHIFT_OTHERS") {
      add(errors,"INVALID_MERCHANDISING_DISPLACEMENT",path+".displacement","SHIFT_OTHERS is required");
    }
    validateMerchandisingConflict(input.conflictResolution,path+".conflictResolution",errors);
    return;
  }
  if (input.kind === "merchandising_relationship") {
    validateMerchandisingRelationship(input,path,errors);
    return;
  }
  if (input.kind === "merchandising_remove_placement") {
    if (!nonEmpty(input.placementId) || !MERCHANDISING_PLACEMENT_ID_PATTERN.test(input.placementId)) add(errors,"INVALID_MERCHANDISING_PLACEMENT_ID",path+".placementId","placementId must begin with merchplace_");
    validateMerchandisingSurface(input.surface,path+".surface",errors);
    return;
  }
  if (input.kind === "merchandising_remove_relationship") {
    if (!nonEmpty(input.relationshipId) || !MERCHANDISING_RELATIONSHIP_ID_PATTERN.test(input.relationshipId)) add(errors,"INVALID_MERCHANDISING_RELATIONSHIP_ID",path+".relationshipId","relationshipId must begin with merchrel_");
    if (!["SUBSTITUTE","CROSS_SELL","UPSELL"].includes(String(input.relationshipType))) {
      add(errors,"INVALID_MERCHANDISING_RELATIONSHIP_TYPE",path+".relationshipType","unsupported relationship type");
    }
    return;
  }
  if (input.kind === "merchandising_rank_rollback") {
    if (!nonEmpty(input.originalActionId)) add(errors,"INVALID_MERCHANDISING_ROLLBACK_ORIGINAL",path+".originalActionId","required");
    validateMerchandisingRollbackStrategy(input.strategy,path+".strategy",errors);
    validateMerchandisingRollbackGuard(input.conflictGuard,path+".conflictGuard",errors,typeof input.originalActionId==="string"?input.originalActionId:undefined);
    return;
  }
}


function validateInventoryUnitQuantity(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  requirePositive = false,
): void {
  if (!record(input) || input.kind !== "quantity") {
    add(errors, "INVALID_INVENTORY_QUANTITY", path, "inventory quantity value is required");
    return;
  }
  if (input.unit !== "units") {
    add(errors, "INVALID_INVENTORY_QUANTITY_UNIT", path + ".unit", "inventory quantities must use units");
  }
  if (
    !Number.isInteger(input.value) ||
    Number(input.value) < 0 ||
    (requirePositive && Number(input.value) <= 0)
  ) {
    add(
      errors,
      "INVALID_INVENTORY_UNIT_COUNT",
      path + ".value",
      requirePositive
        ? "inventory quantity must be a positive integer"
        : "inventory quantity must be a non-negative integer",
    );
  }
}

function validateInventoryQuantityOperation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  validateOperation(input, path, errors, "quantity", decisionTime);
  if (!record(input)) return;

  if (input.kind === "SET") {
    validateInventoryUnitQuantity(input.value, path + ".value", errors);
    return;
  }
  if (input.kind === "DELTA") {
    validateInventoryUnitQuantity(input.amount, path + ".amount", errors);
    if (
      record(input.reference) &&
      input.reference.kind === "explicit_baseline"
    ) {
      validateInventoryUnitQuantity(
        input.reference.value,
        path + ".reference.value",
        errors,
      );
      if (
        input.direction === "decrease" &&
        record(input.amount) &&
        record(input.reference.value) &&
        Number.isInteger(input.amount.value) &&
        Number.isInteger(input.reference.value.value) &&
        Number(input.amount.value) > Number(input.reference.value.value)
      ) {
        add(
          errors,
          "INVENTORY_QUANTITY_WOULD_BECOME_NEGATIVE",
          path,
          "inventory policy DELTA decrease cannot exceed explicit baseline",
        );
      }
    }
    return;
  }
  if (
    input.kind === "MULTIPLY" &&
    record(input.reference) &&
    input.reference.kind === "explicit_baseline"
  ) {
    validateInventoryUnitQuantity(
      input.reference.value,
      path + ".reference.value",
      errors,
    );
    if (
      record(input.reference.value) &&
      Number.isInteger(input.reference.value.value) &&
      finite(input.factor) &&
      !Number.isInteger(
        Number(input.reference.value.value) * Number(input.factor),
      )
    ) {
      add(
        errors,
        "INVENTORY_MULTIPLY_RESULT_NOT_WHOLE_UNITS",
        path,
        "inventory unit policy must resolve to whole units when explicit baseline is supplied",
      );
    }
  }
}

function validateInventoryMembership(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_INVENTORY_MEMBERSHIP", path, "membership semantics are required");
    return;
  }
  if (
    !["decision_time", "translation_time", "effective_time"].includes(
      String(input.evaluateAt),
    )
  ) {
    add(
      errors,
      "INVALID_INVENTORY_MEMBERSHIP_BOUNDARY",
      path + ".evaluateAt",
      "must be decision_time, translation_time or effective_time",
    );
  }
  if (input.bindingRef !== undefined && !nonEmpty(input.bindingRef)) {
    add(
      errors,
      "INVALID_INVENTORY_MEMBERSHIP_BINDING",
      path + ".bindingRef",
      "bindingRef must be non-empty when supplied",
    );
  }
}

function validateInventoryLeadTime(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_INVENTORY_LEAD_TIME", path, "lead-time assumption object is required");
    return;
  }
  validatePositiveInteger(
    input.durationSeconds,
    path + ".durationSeconds",
    errors,
  );
  if (!nonEmpty(input.sourceRef)) {
    add(errors, "INVALID_INVENTORY_LEAD_TIME_SOURCE", path + ".sourceRef", "sourceRef is required");
  }
}

function validateInventorySupplierConstraints(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_SUPPLIER_CONSTRAINTS", path, "supplier constraints must be an object");
    return;
  }
  for (const field of [
    "minimumOrderQuantity",
    "orderMultiple",
    "maximumSupplierQuantity",
  ]) {
    if (input[field] !== undefined) {
      validatePositiveInteger(input[field], path + "." + field, errors);
    }
  }
  if (
    Number.isInteger(input.minimumOrderQuantity) &&
    Number.isInteger(input.maximumSupplierQuantity) &&
    Number(input.minimumOrderQuantity) > Number(input.maximumSupplierQuantity)
  ) {
    add(
      errors,
      "SUPPLIER_MINIMUM_EXCEEDS_MAXIMUM",
      path,
      "minimum order quantity cannot exceed maximum supplier quantity",
    );
  }
}

function validateInventoryProcurementEconomics(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_PROCUREMENT_ECONOMICS", path, "procurement economics must be an object");
    return;
  }
  const monies: unknown[] = [];
  for (const field of [
    "unitProcurementCost",
    "freightCost",
    "fixedOrderCost",
    "minimumOrderValue",
  ]) {
    if (input[field] !== undefined) {
      validateMoney(input[field], path + "." + field, errors);
      monies.push(input[field]);
    }
  }
  const currencies = new Set(
    monies
      .filter(record)
      .map((value) => String(value.currency ?? "")),
  );
  if (currencies.size > 1) {
    add(
      errors,
      "PROCUREMENT_CURRENCY_MISMATCH",
      path,
      "known procurement costs must use one explicit currency",
    );
  }
}

function validateReorderQuantityAgainstSupplier(
  quantity: unknown,
  constraints: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!Number.isInteger(quantity) || !record(constraints)) return;
  const q = Number(quantity);

  if (
    Number.isInteger(constraints.minimumOrderQuantity) &&
    q < Number(constraints.minimumOrderQuantity)
  ) {
    add(
      errors,
      "REORDER_BELOW_MINIMUM_ORDER_QUANTITY",
      path,
      "reorder quantity is below supplier minimum",
    );
  }
  if (
    Number.isInteger(constraints.maximumSupplierQuantity) &&
    q > Number(constraints.maximumSupplierQuantity)
  ) {
    add(
      errors,
      "REORDER_EXCEEDS_SUPPLIER_MAXIMUM",
      path,
      "reorder quantity exceeds supplier maximum",
    );
  }
  if (
    Number.isInteger(constraints.orderMultiple) &&
    q % Number(constraints.orderMultiple) !== 0
  ) {
    add(
      errors,
      "REORDER_NOT_VALID_ORDER_MULTIPLE",
      path,
      "reorder quantity does not satisfy supplier order multiple; it is not silently rounded",
    );
  }
}

function validateInventoryReorder(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors, "INVALID_INVENTORY_REORDER", path, "reorder definition is required");
    return;
  }
  validateTarget(input.sku, path + ".sku", errors);
  if (record(input.sku) && input.sku.kind !== "sku") {
    add(errors, "REORDER_REQUIRES_SKU", path + ".sku.kind", "physical reorder must resolve to SKU");
  }
  validatePositiveInteger(input.quantity, path + ".quantity", errors);

  if (
    input.supplierRelationshipId !== undefined &&
    !nonEmpty(input.supplierRelationshipId)
  ) {
    add(errors, "INVALID_SUPPLIER_RELATIONSHIP_ID", path + ".supplierRelationshipId", "must be non-empty");
  }
  if (
    input.destinationLocationId !== undefined &&
    !nonEmpty(input.destinationLocationId)
  ) {
    add(errors, "INVALID_INVENTORY_LOCATION_ID", path + ".destinationLocationId", "must be non-empty");
  }

  validateTimestamp(
    input.orderPlacementTime,
    path + ".orderPlacementTime",
    errors,
  );
  if (input.requestedDeliveryDate !== undefined) {
    validateTimestamp(
      input.requestedDeliveryDate,
      path + ".requestedDeliveryDate",
      errors,
    );
    if (
      typeof input.orderPlacementTime === "string" &&
      typeof input.requestedDeliveryDate === "string" &&
      Number.isFinite(Date.parse(input.orderPlacementTime)) &&
      Number.isFinite(Date.parse(input.requestedDeliveryDate)) &&
      Date.parse(input.requestedDeliveryDate) <
        Date.parse(input.orderPlacementTime)
    ) {
      add(
        errors,
        "REQUESTED_DELIVERY_BEFORE_ORDER",
        path + ".requestedDeliveryDate",
        "requested delivery cannot precede order placement",
      );
    }
  }

  if (input.leadTimeAssumption !== undefined) {
    validateInventoryLeadTime(
      input.leadTimeAssumption,
      path + ".leadTimeAssumption",
      errors,
    );
  }

  if (input.expectedArrivalAt !== undefined) {
    validateTimestamp(
      input.expectedArrivalAt,
      path + ".expectedArrivalAt",
      errors,
    );
    if (
      typeof input.orderPlacementTime === "string" &&
      typeof input.expectedArrivalAt === "string" &&
      Number.isFinite(Date.parse(input.orderPlacementTime)) &&
      Number.isFinite(Date.parse(input.expectedArrivalAt)) &&
      Date.parse(input.expectedArrivalAt) <
        Date.parse(input.orderPlacementTime)
    ) {
      add(
        errors,
        "EXPECTED_ARRIVAL_BEFORE_ORDER",
        path + ".expectedArrivalAt",
        "expected arrival cannot precede order placement",
      );
    }
    if (input.leadTimeAssumption === undefined) {
      add(
        errors,
        "EXPECTED_ARRIVAL_REQUIRES_LEAD_TIME_ASSUMPTION",
        path + ".expectedArrivalAt",
        "expected arrival must be grounded in a known decision-time lead-time assumption",
      );
    } else if (
      record(input.leadTimeAssumption) &&
      Number.isInteger(input.leadTimeAssumption.durationSeconds) &&
      typeof input.orderPlacementTime === "string" &&
      typeof input.expectedArrivalAt === "string" &&
      Number.isFinite(Date.parse(input.orderPlacementTime)) &&
      Number.isFinite(Date.parse(input.expectedArrivalAt))
    ) {
      const assumed =
        Date.parse(input.orderPlacementTime) +
        Number(input.leadTimeAssumption.durationSeconds) * 1000;
      if (Date.parse(input.expectedArrivalAt) !== assumed) {
        add(
          errors,
          "EXPECTED_ARRIVAL_LEAD_TIME_MISMATCH",
          path + ".expectedArrivalAt",
          "expected arrival must equal order placement plus the stated known lead-time assumption",
        );
      }
    }
  }

  if (input.supplierConstraints !== undefined) {
    validateInventorySupplierConstraints(
      input.supplierConstraints,
      path + ".supplierConstraints",
      errors,
    );
    validateReorderQuantityAgainstSupplier(
      input.quantity,
      input.supplierConstraints,
      path + ".quantity",
      errors,
    );
  }
  if (input.procurementEconomics !== undefined) {
    validateInventoryProcurementEconomics(
      input.procurementEconomics,
      path + ".procurementEconomics",
      errors,
    );
    if (
      record(input.procurementEconomics) &&
      record(input.procurementEconomics.unitProcurementCost) &&
      record(input.procurementEconomics.minimumOrderValue) &&
      input.procurementEconomics.unitProcurementCost.currency ===
        input.procurementEconomics.minimumOrderValue.currency &&
      Number.isInteger(input.procurementEconomics.unitProcurementCost.amountMinor) &&
      Number.isInteger(input.procurementEconomics.minimumOrderValue.amountMinor) &&
      Number.isInteger(input.quantity) &&
      Number(input.quantity) *
          Number(input.procurementEconomics.unitProcurementCost.amountMinor) <
        Number(input.procurementEconomics.minimumOrderValue.amountMinor)
    ) {
      add(
        errors,
        "REORDER_BELOW_MINIMUM_ORDER_VALUE",
        path + ".procurementEconomics.minimumOrderValue",
        "known unit procurement value does not satisfy the supplier minimum order value",
      );
    }
  }
}

function validateInventoryTimingReference(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INVENTORY_TIMING_REFERENCE", path, "timing reference kind is required");
    return;
  }
  if (input.kind === "current_planned_reorder_at_decision") {
    validateTimestamp(input.decisionTime, path + ".decisionTime", errors);
    if (
      decisionTime &&
      typeof input.decisionTime === "string" &&
      input.decisionTime !== decisionTime
    ) {
      add(
        errors,
        "INVENTORY_TIMING_DECISION_TIME_MISMATCH",
        path + ".decisionTime",
        "current planned reorder reference must use Action decision time",
      );
    }
    return;
  }
  if (input.kind === "explicit_planned_reorder") {
    validateTimestamp(input.at, path + ".at", errors);
    return;
  }
  if (input.kind === "baseline_snapshot") {
    if (!nonEmpty(input.baselineId)) {
      add(errors, "INVALID_BASELINE_ID", path + ".baselineId", "required");
    }
    return;
  }
  add(errors, "UNKNOWN_INVENTORY_TIMING_REFERENCE", path + ".kind", "unsupported timing reference");
}

function validateInventoryTimingOperation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INVENTORY_TIMING_OPERATION", path, "timing operation is required");
    return;
  }
  if (input.kind === "SET_DATE") {
    validateTimestamp(input.at, path + ".at", errors);
    return;
  }
  if (input.kind === "DELTA_DAYS") {
    if (!["earlier", "later"].includes(String(input.direction))) {
      add(errors, "INVALID_REORDER_TIMING_DIRECTION", path + ".direction", "must be earlier or later");
    }
    validatePositiveInteger(input.days, path + ".days", errors);
    validateInventoryTimingReference(
      input.baseline,
      path + ".baseline",
      errors,
      decisionTime,
    );
    return;
  }
  if (input.kind === "INVENTORY_TRIGGER") {
    if (
      !["ON_HAND", "AVAILABLE_TO_SELL", "RESERVED", "SAFETY_STOCK"].includes(
        String(input.availabilityConcept),
      )
    ) {
      add(errors, "INVALID_INVENTORY_AVAILABILITY_CONCEPT", path + ".availabilityConcept", "unsupported concept");
    }
    if (!["LTE", "LT", "EQ"].includes(String(input.operator))) {
      add(errors, "INVALID_INVENTORY_TRIGGER_OPERATOR", path + ".operator", "must be LTE, LT or EQ");
    }
    validateNonNegativeInteger(input.units, path + ".units", errors);
    return;
  }
  add(errors, "UNKNOWN_INVENTORY_TIMING_OPERATION", path + ".kind", "unsupported timing operation");
}

function validateInventoryPolicyControl(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !["SAFETY_STOCK", "REORDER_POINT"].includes(String(input.kind))) {
    add(errors, "INVALID_INVENTORY_POLICY_CONTROL", path, "policy must be SAFETY_STOCK or REORDER_POINT");
    return;
  }
  validateInventoryQuantityOperation(
    input.operation,
    path + ".operation",
    errors,
    decisionTime,
  );
  if (
    input.inventoryLocationId !== undefined &&
    !nonEmpty(input.inventoryLocationId)
  ) {
    add(errors, "INVALID_INVENTORY_LOCATION_ID", path + ".inventoryLocationId", "must be non-empty");
  }
}

function validateInventoryProtection(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INVENTORY_PROTECTION", path, "protection mode is required");
    return;
  }
  if (input.kind === "RESERVE_QUANTITY") {
    validatePositiveInteger(input.quantity, path + ".quantity", errors);
    if (input.fromConcept !== "AVAILABLE_TO_SELL" || input.toConcept !== "RESERVED") {
      add(
        errors,
        "INVALID_INVENTORY_RESERVATION_CONCEPTS",
        path,
        "reservation must move availability from AVAILABLE_TO_SELL to RESERVED without changing ON_HAND",
      );
    }
    return;
  }
  if (input.kind === "PROTECT_UNTIL_CONDITION") {
    if (
      !["ON_HAND", "AVAILABLE_TO_SELL", "RESERVED", "SAFETY_STOCK"].includes(
        String(input.availabilityConcept),
      )
    ) {
      add(errors, "INVALID_INVENTORY_AVAILABILITY_CONCEPT", path + ".availabilityConcept", "unsupported concept");
    }
    validateNonNegativeInteger(input.minimumUnits, path + ".minimumUnits", errors);
    return;
  }
  add(errors, "UNKNOWN_INVENTORY_PROTECTION", path + ".kind", "unsupported protection mode");
}

function validateInventoryBackorderPolicy(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_BACKORDER_POLICY", path, "backorder policy is required");
    return;
  }
  if (["ALLOW", "DISALLOW"].includes(String(input.kind))) return;
  if (input.kind === "ALLOW_WITH_LIMIT") {
    validateNonNegativeInteger(
      input.maxBackorderedUnits,
      path + ".maxBackorderedUnits",
      errors,
    );
    return;
  }
  if (input.kind === "ALLOW_UNTIL_DATE") {
    validateTimestamp(input.until, path + ".until", errors);
    return;
  }
  add(errors, "UNKNOWN_BACKORDER_POLICY", path + ".kind", "unsupported backorder policy");
}

function validateInventoryStrategyTarget(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  validateTarget(input, path, errors);
  if (
    record(input) &&
    !["sku", "product", "category", "collection", "inventory_set"].includes(
      String(input.kind),
    )
  ) {
    add(errors, "INVALID_INVENTORY_STRATEGY_TARGET", path + ".kind", "strategy target must be SKU, product, category, collection or inventory_set");
  }
}

function validateInventoryCoordinatedActionIds(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (input === undefined) return;
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    input.some((value) => !nonEmpty(value)) ||
    new Set(input).size !== input.length
  ) {
    add(
      errors,
      "INVALID_INVENTORY_COORDINATED_ACTION_IDS",
      path,
      "coordinated Action IDs must be a non-empty unique array when supplied",
    );
  }
}

function validateInventoryRollbackValue(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (record(input) && input.kind === "backorder_policy") {
    validateInventoryBackorderPolicy(
      input.policy,
      path + ".policy",
      errors,
    );
    return;
  }
  validateScalar(input, path, errors);
}

function validateInventoryRollbackReference(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (record(input) && input.kind === "inventory_policy_snapshot") {
    if (!nonEmpty(input.baselineId)) {
      add(errors, "INVALID_INVENTORY_POLICY_SNAPSHOT", path + ".baselineId", "baselineId is required");
    }
    return;
  }
  validateReference(input,path,errors,decisionTime);
}

function validateInventoryRollbackStrategy(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors, "INVALID_INVENTORY_ROLLBACK_STRATEGY", path, "strategy is required");
    return;
  }
  if (input.kind === "RESTORE_PRE_ACTION_VALUE") {
    validateInventoryRollbackReference(
      input.preActionValue,
      path + ".preActionValue",
      errors,
      decisionTime,
    );
    return;
  }
  if (input.kind === "SET_EXPLICIT_VALUE") {
    validateInventoryRollbackValue(input.value, path + ".value", errors);
    return;
  }
  add(errors, "UNKNOWN_INVENTORY_ROLLBACK_STRATEGY", path + ".kind", "unsupported rollback strategy");
}

function validateInventoryRollbackGuard(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  originalActionId?: string,
): void {
  if (!record(input) || input.kind !== "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT") {
    add(errors, "INVALID_INVENTORY_ROLLBACK_GUARD", path, "conflict guard is required");
    return;
  }
  if (!nonEmpty(input.sourceActionId)) {
    add(errors, "INVALID_INVENTORY_ROLLBACK_SOURCE", path + ".sourceActionId", "required");
  } else if (originalActionId && input.sourceActionId !== originalActionId) {
    add(errors, "INVENTORY_ROLLBACK_SOURCE_MISMATCH", path + ".sourceActionId", "must reference original inventory policy Action");
  }
  validateInventoryRollbackValue(input.expectedValue, path + ".expectedValue", errors);
}

function validateInventoryParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input)) {
    add(errors, "INVALID_INVENTORY_PARAMETERS", path, "inventory parameters are required");
    return;
  }

  if (input.kind === "inventory_reorder") {
    validateInventoryReorder(input.reorder, path + ".reorder", errors);
    return;
  }

  if (input.kind === "inventory_reorder_quantity") {
    validateInventoryQuantityOperation(
      input.operation,
      path + ".operation",
      errors,
      decisionTime,
    );
    if (input.supplierConstraints !== undefined) {
      validateInventorySupplierConstraints(
        input.supplierConstraints,
        path + ".supplierConstraints",
        errors,
      );
      if (
        record(input.operation) &&
        input.operation.kind === "SET" &&
        record(input.operation.value)
      ) {
        validateReorderQuantityAgainstSupplier(
          input.operation.value.value,
          input.supplierConstraints,
          path + ".operation.value",
          errors,
        );
      }
    }
    return;
  }

  if (input.kind === "inventory_reorder_timing") {
    validateInventoryTimingOperation(
      input.operation,
      path + ".operation",
      errors,
      decisionTime,
    );
    if (input.leadTimeAssumption !== undefined) {
      validateInventoryLeadTime(
        input.leadTimeAssumption,
        path + ".leadTimeAssumption",
        errors,
      );
    }
    return;
  }

  if (input.kind === "inventory_policy_control") {
    validateInventoryPolicyControl(
      input.policy,
      path + ".policy",
      errors,
      decisionTime,
    );
    return;
  }

  if (input.kind === "inventory_protection") {
    validateInventoryProtection(input.mode, path + ".mode", errors);
    if (
      input.inventoryLocationId !== undefined &&
      !nonEmpty(input.inventoryLocationId)
    ) {
      add(errors, "INVALID_INVENTORY_LOCATION_ID", path + ".inventoryLocationId", "must be non-empty");
    }
    validateInventoryCoordinatedActionIds(
      input.coordinatedActionIds,
      path + ".coordinatedActionIds",
      errors,
    );
    return;
  }

  if (input.kind === "inventory_backorder_policy") {
    validateInventoryBackorderPolicy(
      input.policy,
      path + ".policy",
      errors,
    );
    if (
      input.customerPromiseRef !== undefined &&
      !nonEmpty(input.customerPromiseRef)
    ) {
      add(errors, "INVALID_BACKORDER_CUSTOMER_PROMISE_REF", path + ".customerPromiseRef", "must be non-empty");
    }
    if (
      input.geographicScopeRef !== undefined &&
      !nonEmpty(input.geographicScopeRef)
    ) {
      add(errors, "INVALID_BACKORDER_GEOGRAPHIC_SCOPE_REF", path + ".geographicScopeRef", "must be non-empty");
    }
    return;
  }

  if (input.kind === "inventory_clearance") {
    validateInventoryStrategyTarget(
      input.target,
      path + ".target",
      errors,
    );
    if (!nonEmpty(input.reasonCode)) {
      add(errors, "INVALID_CLEARANCE_REASON", path + ".reasonCode", "reasonCode is required");
    }
    if (
      record(input.target) &&
      ["category", "collection"].includes(String(input.target.kind)) &&
      input.membership === undefined
    ) {
      add(errors, "MISSING_INVENTORY_MEMBERSHIP_SEMANTICS", path + ".membership", "category/collection clearance requires explicit membership boundary");
    }
    if (input.membership !== undefined) {
      validateInventoryMembership(input.membership, path + ".membership", errors);
    }
    validateInventoryCoordinatedActionIds(
      input.coordinatedActionIds,
      path + ".coordinatedActionIds",
      errors,
    );
    return;
  }

  if (input.kind === "inventory_acceleration") {
    validateInventoryStrategyTarget(
      input.target,
      path + ".target",
      errors,
    );
    if (
      !["ON_HAND", "AVAILABLE_TO_SELL", "RESERVED", "SAFETY_STOCK"].includes(
        String(input.availabilityConcept),
      )
    ) {
      add(errors, "INVALID_INVENTORY_AVAILABILITY_CONCEPT", path + ".availabilityConcept", "unsupported concept");
    }
    if (!record(input.startingCondition)) {
      add(errors, "INVALID_INVENTORY_ACCELERATION_START", path + ".startingCondition", "starting condition is required");
    } else {
      if (!["GT", "GTE"].includes(String(input.startingCondition.operator))) {
        add(errors, "INVALID_INVENTORY_ACCELERATION_OPERATOR", path + ".startingCondition.operator", "must be GT or GTE");
      }
      validateNonNegativeInteger(
        input.startingCondition.units,
        path + ".startingCondition.units",
        errors,
      );
    }
    if (!record(input.termination) || !nonEmpty(input.termination.kind)) {
      add(errors, "INVALID_INVENTORY_ACCELERATION_TERMINATION", path + ".termination", "termination is required");
    } else if (input.termination.kind === "INVENTORY_AT_OR_BELOW") {
      if (
        !["ON_HAND", "AVAILABLE_TO_SELL", "RESERVED", "SAFETY_STOCK"].includes(
          String(input.termination.availabilityConcept),
        )
      ) {
        add(errors, "INVALID_INVENTORY_AVAILABILITY_CONCEPT", path + ".termination.availabilityConcept", "unsupported concept");
      }
      validateNonNegativeInteger(
        input.termination.units,
        path + ".termination.units",
        errors,
      );
    } else if (input.termination.kind === "AT_DATE") {
      validateTimestamp(
        input.termination.at,
        path + ".termination.at",
        errors,
      );
    } else if (input.termination.kind === "CONDITION_REF") {
      if (!nonEmpty(input.termination.conditionRef)) {
        add(errors, "INVALID_INVENTORY_ACCELERATION_CONDITION_REF", path + ".termination.conditionRef", "conditionRef is required");
      }
    } else {
      add(errors, "UNKNOWN_INVENTORY_ACCELERATION_TERMINATION", path + ".termination.kind", "unsupported termination");
    }

    if (
      record(input.target) &&
      ["category", "collection"].includes(String(input.target.kind)) &&
      input.membership === undefined
    ) {
      add(errors, "MISSING_INVENTORY_MEMBERSHIP_SEMANTICS", path + ".membership", "category/collection acceleration requires explicit membership boundary");
    }
    if (input.membership !== undefined) {
      validateInventoryMembership(input.membership, path + ".membership", errors);
    }
    validateInventoryCoordinatedActionIds(
      input.coordinatedActionIds,
      path + ".coordinatedActionIds",
      errors,
    );
    return;
  }

  if (input.kind === "inventory_policy_rollback") {
    if (!nonEmpty(input.originalActionId)) {
      add(errors, "INVALID_INVENTORY_ROLLBACK_ORIGINAL", path + ".originalActionId", "required");
    }
    validateInventoryRollbackStrategy(
      input.strategy,
      path + ".strategy",
      errors,
      decisionTime,
    );
    validateInventoryRollbackGuard(
      input.conflictGuard,
      path + ".conflictGuard",
      errors,
      typeof input.originalActionId === "string"
        ? input.originalActionId
        : undefined,
    );
    return;
  }
}


const CRO_COMPONENTS_BY_SURFACE: Readonly<Record<string, readonly string[]>> = {
  SITE_WIDE: ["NAVIGATION"],
  HOMEPAGE: [
    "PAGE_LAYOUT","HERO","VALUE_PROPOSITION","FEATURED_PRODUCTS","FEATURED_COLLECTIONS",
    "PROMOTIONAL_BANNER","NAVIGATION","SOCIAL_PROOF","CONTENT_SECTION","CTA",
  ],
  COLLECTION: [
    "PAGE_LAYOUT","PRODUCT_GRID","PRODUCT_CARD","FILTERS","SORTING","COLLECTION_HEADER",
    "COLLECTION_DESCRIPTION","MERCHANDISING_BLOCK","PAGINATION","NAVIGATION",
  ],
  PDP: [
    "PAGE_LAYOUT","PRODUCT_GALLERY","PRODUCT_TITLE","PRICE_DISPLAY","VARIANT_SELECTOR",
    "ADD_TO_CART","BUY_NOW","PRODUCT_DESCRIPTION","DELIVERY_INFORMATION",
    "RETURNS_INFORMATION","REVIEWS","SOCIAL_PROOF","RECOMMENDATIONS",
    "STOCK_INFORMATION","PAYMENT_INFORMATION","NAVIGATION",
  ],
  CART: [
    "PAGE_LAYOUT","CART_ITEMS","QUANTITY_CONTROL","ORDER_SUMMARY","SHIPPING_MESSAGE",
    "PROMOTION_ENTRY","CROSS_SELL","CHECKOUT_CTA","NAVIGATION",
  ],
  CHECKOUT: [
    "PAGE_LAYOUT","CONTACT_STEP","SHIPPING_STEP","PAYMENT_STEP","ORDER_SUMMARY","FORM","FIELD",
    "ERROR_HANDLING","PROGRESS_INDICATOR","EXPRESS_PAYMENT",
  ],
  SITE_SEARCH: [
    "PAGE_LAYOUT","SEARCH_INPUT","AUTOCOMPLETE","SEARCH_RESULTS","FILTERS","SORTING",
    "NO_RESULTS_STATE","NAVIGATION",
  ],
  LANDING_PAGE: [
    "PAGE_LAYOUT","HERO","CTA","PRODUCT_SECTION","CONTENT_SECTION","FORM","SOCIAL_PROOF","NAVIGATION",
  ],
};

const CRO_DIMENSIONS = new Set([
  "POSITION","PROMINENCE","CONTENT_STRUCTURE","INTERACTION","VISUAL_HIERARCHY",
  "LAYOUT","DENSITY","PERSISTENCE","REQUIRED_FIELDS","STEP_STRUCTURE",
  "ERROR_PRESENTATION","PAYMENT_PRESENTATION","PROGRESS_COMMUNICATION",
  "INFORMATION_HIERARCHY","LOAD_PERFORMANCE","INTERACTION_LATENCY","IMAGE_LOADING",
  "NAVIGATION_STRUCTURE","FILTER_CONFIGURATION","SORT_CONTROL_PRESENTATION",
  "NO_RESULTS_HANDLING","AUTOCOMPLETE","SHIPPING_MESSAGE_PRESENTATION",
  "PROMOTION_MESSAGE_PRESENTATION",
]);

const CRO_CAPABILITIES = new Set([
  "ADD_COMPONENT","REMOVE_COMPONENT","REORDER_COMPONENTS","MODIFY_PRESENTATION",
  "MODIFY_INTERACTION","MODIFY_NAVIGATION","MODIFY_SEARCH_EXPERIENCE",
  "MODIFY_CHECKOUT_EXPERIENCE","MODIFY_PERFORMANCE","AUTOCOMPLETE","FILTERS",
  "SORTING","NO_RESULTS_EXPERIENCE",
]);

function validateCroComponentTarget(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)||!nonEmpty(input.component)){
    add(errors,"INVALID_CRO_COMPONENT",path,"canonical component is required");return;
  }
  const all=new Set(Object.values(CRO_COMPONENTS_BY_SURFACE).flat());
  if(!all.has(String(input.component))){
    add(errors,"UNKNOWN_CRO_COMPONENT",path+".component","unsupported canonical CRO component");
  }
  if(input.instanceId!==undefined&&!nonEmpty(input.instanceId)){
    add(errors,"INVALID_CRO_COMPONENT_INSTANCE",path+".instanceId","must be non-empty when supplied");
  }
}

function validateCroSurface(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!["SITE_WIDE","HOMEPAGE","COLLECTION","PDP","CART","CHECKOUT","SITE_SEARCH","LANDING_PAGE"].includes(String(input))){
    add(errors,"INVALID_CRO_SURFACE",path,"unsupported CRO surface");
  }
}

function validateCroPageScope(input:unknown,path:string,errors:ActionValidationIssue[],surface?:string):void{
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_CRO_PAGE_SCOPE",path,"page scope is required");return;}
  switch(input.kind){
    case "ALL_SURFACE": break;
    case "ALL_PDP":
      if(surface!=="PDP") add(errors,"CRO_PAGE_SCOPE_SURFACE_MISMATCH",path,"ALL_PDP requires PDP surface");
      break;
    case "ALL_COLLECTIONS":
      if(surface!=="COLLECTION") add(errors,"CRO_PAGE_SCOPE_SURFACE_MISMATCH",path,"ALL_COLLECTIONS requires COLLECTION surface");
      break;
    case "PRODUCT_PDP":
      if(surface!=="PDP") add(errors,"CRO_PAGE_SCOPE_SURFACE_MISMATCH",path,"PRODUCT_PDP requires PDP surface");
      if(!nonEmpty(input.productId)) add(errors,"INVALID_CRO_PAGE_SCOPE_ID",path+".productId","required");
      break;
    case "CATEGORY_PDP_SET":
      if(surface!=="PDP") add(errors,"CRO_PAGE_SCOPE_SURFACE_MISMATCH",path,"CATEGORY_PDP_SET requires PDP surface");
      if(!nonEmpty(input.categoryId)) add(errors,"INVALID_CRO_PAGE_SCOPE_ID",path+".categoryId","required");
      break;
    case "PAGE_TEMPLATE":
      if(!nonEmpty(input.templateId)) add(errors,"INVALID_CRO_PAGE_SCOPE_ID",path+".templateId","required");
      break;
    case "SPECIFIC_PAGE":
      if(!nonEmpty(input.pageId)) add(errors,"INVALID_CRO_PAGE_SCOPE_ID",path+".pageId","required");
      break;
    case "LANDING_PAGE":
      if(surface!=="LANDING_PAGE") add(errors,"CRO_PAGE_SCOPE_SURFACE_MISMATCH",path,"LANDING_PAGE scope requires LANDING_PAGE surface");
      if(!nonEmpty(input.landingPageId)) add(errors,"INVALID_CRO_PAGE_SCOPE_ID",path+".landingPageId","required");
      break;
    default:
      add(errors,"UNKNOWN_CRO_PAGE_SCOPE",path+".kind","unsupported page scope");
  }
}

function validateCroAudience(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_CRO_AUDIENCE",path,"audience is required");return;}
  if(["ALL_VISITORS","NEW_VISITORS","RETURNING_VISITORS"].includes(String(input.kind)))return;
  if(input.kind==="CUSTOMER_SEGMENT"){
    if(!nonEmpty(input.segmentId)) add(errors,"INVALID_CRO_SEGMENT_ID",path+".segmentId","required");
    if(!record(input.membership)){
      add(errors,"INVALID_CRO_SEGMENT_MEMBERSHIP",path+".membership","segment membership semantics are required");
    } else {
      if(!["decision_time","translation_time","effective_time"].includes(String(input.membership.evaluateAt))){
        add(errors,"INVALID_CRO_MEMBERSHIP_BOUNDARY",path+".membership.evaluateAt","unsupported boundary");
      }
      if(input.membership.bindingRef!==undefined&&!nonEmpty(input.membership.bindingRef)){
        add(errors,"INVALID_CRO_MEMBERSHIP_BINDING",path+".membership.bindingRef","must be non-empty");
      }
    }
    return;
  }
  add(errors,"UNKNOWN_CRO_AUDIENCE",path+".kind","unsupported CRO audience");
}

function validateCroConflict(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_CRO_CONFLICT",path,"conflict semantics are required");return;}
  if(input.kind==="COEXIST")return;
  if(input.kind==="PRECEDENCE"){validateNonNegativeInteger(input.precedence,path+".precedence",errors);return;}
  if(input.kind==="MUTUALLY_EXCLUSIVE_GROUP"){
    if(!nonEmpty(input.groupId))add(errors,"INVALID_CRO_CONFLICT_GROUP",path+".groupId","groupId is required");
    if(input.precedence!==undefined)validateNonNegativeInteger(input.precedence,path+".precedence",errors);
    return;
  }
  add(errors,"UNKNOWN_CRO_CONFLICT",path+".kind","unsupported conflict semantics");
}

function validateCroOrderingSnapshot(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)||!nonEmpty(input.bindingRef)){
    add(errors,"INVALID_CRO_ORDERING_SNAPSHOT",path,"bindingRef is required");return;
  }
  if(!["decision_time","translation_time","effective_time"].includes(String(input.evaluateAt))){
    add(errors,"INVALID_CRO_ORDERING_BOUNDARY",path+".evaluateAt","unsupported boundary");
  }
}

function validateCroOrdering(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_CRO_ORDERING",path,"ordering semantics are required");return;}
  if(input.kind==="SET_POSITION"){validatePositiveInteger(input.position,path+".position",errors);return;}
  if(input.kind==="PLACE_BEFORE"||input.kind==="PLACE_AFTER"){
    validateCroComponentTarget(input.referenceComponent,path+".referenceComponent",errors);
    validateCroOrderingSnapshot(input.snapshot,path+".snapshot",errors);
    return;
  }
  add(errors,"UNKNOWN_CRO_ORDERING",path+".kind","unsupported ordering semantics");
}

function validateCroRollbackStrategy(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)||!nonEmpty(input.kind)){add(errors,"INVALID_CRO_ROLLBACK_STRATEGY",path,"rollback strategy is required");return;}
  if(input.kind==="RESTORE_PRE_ACTION_VALUE"){
    if(!nonEmpty(input.stateSnapshotRef))add(errors,"INVALID_CRO_ROLLBACK_SNAPSHOT",path+".stateSnapshotRef","required");
    return;
  }
  if(input.kind==="SET_EXPLICIT_VALUE"){
    if(!nonEmpty(input.stateRef))add(errors,"INVALID_CRO_ROLLBACK_STATE",path+".stateRef","required");
    return;
  }
  add(errors,"UNKNOWN_CRO_ROLLBACK_STRATEGY",path+".kind","unsupported rollback strategy");
}

function validateCroRollbackGuard(input:unknown,path:string,errors:ActionValidationIssue[],originalActionId?:string):void{
  if(!record(input)||input.kind!=="REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT"){
    add(errors,"INVALID_CRO_ROLLBACK_GUARD",path,"conflict guard is required");return;
  }
  if(!nonEmpty(input.sourceActionId))add(errors,"INVALID_CRO_ROLLBACK_SOURCE",path+".sourceActionId","required");
  else if(originalActionId&&input.sourceActionId!==originalActionId)add(errors,"CRO_ROLLBACK_SOURCE_MISMATCH",path+".sourceActionId","must reference original CRO Action");
  if(!nonEmpty(input.expectedStateRef))add(errors,"INVALID_CRO_ROLLBACK_EXPECTED_STATE",path+".expectedStateRef","required");
}

function validateCroIntervention(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)){add(errors,"INVALID_CRO_INTERVENTION",path,"CRO intervention parameters are required");return;}
  validateCroSurface(input.surface,path+".surface",errors);
  validateCroComponentTarget(input.component,path+".component",errors);
  const allowed=CRO_COMPONENTS_BY_SURFACE[String(input.surface)]??[];
  if(record(input.component)&&nonEmpty(input.component.component)&&!allowed.includes(String(input.component.component))){
    add(errors,"CRO_COMPONENT_SURFACE_MISMATCH",path+".component.component","component is not canonical for this surface");
  }
  if(!["ADD","REMOVE","REORDER","MODIFY_PRESENTATION","MODIFY_INTERACTION","MODIFY_NAVIGATION","MODIFY_SEARCH","MODIFY_CHECKOUT","MODIFY_PERFORMANCE"].includes(String(input.intervention))){
    add(errors,"INVALID_CRO_INTERVENTION_KIND",path+".intervention","unsupported intervention");
  }
  validateCroPageScope(input.pageScope,path+".pageScope",errors,typeof input.surface==="string"?input.surface:undefined);
  if(!["ALL_DEVICES","MOBILE","DESKTOP"].includes(String(input.device))){
    add(errors,"INVALID_CRO_DEVICE",path+".device","must be ALL_DEVICES, MOBILE or DESKTOP");
  }
  validateCroAudience(input.audience,path+".audience",errors);
  if(!Array.isArray(input.modifiableDimensions)||input.modifiableDimensions.length===0||
     input.modifiableDimensions.some((v:unknown)=>!CRO_DIMENSIONS.has(String(v)))||
     new Set(input.modifiableDimensions).size!==input.modifiableDimensions.length){
    add(errors,"INVALID_CRO_MODIFIABLE_DIMENSIONS",path+".modifiableDimensions","must be a non-empty unique canonical dimension list");
  }
  if(!Array.isArray(input.requiredCapabilities)||input.requiredCapabilities.some((v:unknown)=>!CRO_CAPABILITIES.has(String(v)))||
     new Set(input.requiredCapabilities).size!==input.requiredCapabilities.length){
    add(errors,"INVALID_CRO_REQUIRED_CAPABILITIES",path+".requiredCapabilities","must be a unique canonical capability list");
  }
  validateCroConflict(input.conflictResolution,path+".conflictResolution",errors);

  if(input.intervention==="REORDER"){
    if(input.ordering===undefined)add(errors,"CRO_REORDER_REQUIRES_ORDERING",path+".ordering","ordering semantics are required");
    else validateCroOrdering(input.ordering,path+".ordering",errors);
    if(!Array.isArray(input.modifiableDimensions)||!input.modifiableDimensions.includes("POSITION")){
      add(errors,"CRO_REORDER_REQUIRES_POSITION_DIMENSION",path+".modifiableDimensions","POSITION must be modifiable");
    }
  } else if(input.ordering!==undefined){
    add(errors,"CRO_NON_REORDER_HAS_ORDERING",path+".ordering","ordering belongs only to REORDER");
  }

  if(input.intervention==="ADD"){
    if(!record(input.addSemantics)||!["REQUIRE_ABSENT","ALLOW_ADDITIONAL_INSTANCE"].includes(String(input.addSemantics.kind))){
      add(errors,"CRO_ADD_REQUIRES_EXISTENCE_SEMANTICS",path+".addSemantics","ADD requires explicit coexistence/existence semantics");
    } else if(input.addSemantics.kind==="ALLOW_ADDITIONAL_INSTANCE"&&!nonEmpty(input.addSemantics.instanceId)){
      add(errors,"CRO_ADD_INSTANCE_ID_REQUIRED",path+".addSemantics.instanceId","additional instance requires stable instanceId");
    }
  } else if(input.addSemantics!==undefined){
    add(errors,"CRO_NON_ADD_HAS_ADD_SEMANTICS",path+".addSemantics","add semantics belong only to ADD");
  }
}

function validateCroParameters(input:unknown,path:string,errors:ActionValidationIssue[]):void{
  if(!record(input)){add(errors,"INVALID_CRO_PARAMETERS",path,"parameters are required");return;}
  if(input.kind==="cro_intervention"){validateCroIntervention(input,path,errors);return;}
  if(input.kind==="cro_rollback"){
    if(!nonEmpty(input.originalActionId))add(errors,"INVALID_CRO_ROLLBACK_ORIGINAL",path+".originalActionId","required");
    validateCroRollbackStrategy(input.strategy,path+".strategy",errors);
    validateCroRollbackGuard(input.conflictGuard,path+".conflictGuard",errors,typeof input.originalActionId==="string"?input.originalActionId:undefined);
    return;
  }
}

function validateLifecycleChannel(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_CHANNEL",path,"channel is required");
    return;
  }
  if (["EMAIL","SMS"].includes(String(input.kind))) return;
  if (input.kind === "CUSTOM") {
    if (!nonEmpty(input.channelId)) {
      add(errors,"INVALID_LIFECYCLE_CHANNEL_ID",path+".channelId","custom channelId is required");
    }
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_CHANNEL",path+".kind","unsupported lifecycle channel");
}

function lifecycleChannelKey(input: unknown): string {
  if (!record(input)) return "";
  return input.kind === "CUSTOM"
    ? "CUSTOM:" + String(input.channelId ?? "")
    : String(input.kind ?? "");
}

function validateLifecyclePurpose(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_PURPOSE",path,"purpose is required");
    return;
  }
  if ([
    "GENERAL_CAMPAIGN","WELCOME","WINBACK","POST_PURCHASE","REPLENISHMENT",
    "RETENTION","BROWSE_ABANDONMENT","CART_ABANDONMENT","BACK_IN_STOCK",
    "PRICE_DROP","LOYALTY",
  ].includes(String(input.kind))) return;
  if (input.kind === "CUSTOM") {
    if (!nonEmpty(input.purposeId)) {
      add(errors,"INVALID_LIFECYCLE_PURPOSE_ID",path+".purposeId","custom purposeId is required");
    }
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_PURPOSE",path+".kind","unsupported lifecycle purpose");
}

function validateLifecycleMembership(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_MEMBERSHIP",path,"membership semantics are required");
    return;
  }
  if (!["DECISION_TIME","SEND_TIME","TRIGGER_TIME"].includes(String(input.evaluateAt))) {
    add(errors,"INVALID_LIFECYCLE_MEMBERSHIP_BOUNDARY",path+".evaluateAt","must be DECISION_TIME, SEND_TIME or TRIGGER_TIME");
  }
  if (input.bindingRef !== undefined && !nonEmpty(input.bindingRef)) {
    add(errors,"INVALID_LIFECYCLE_MEMBERSHIP_BINDING",path+".bindingRef","must be non-empty when supplied");
  }
}

function validateLifecycleAudienceSelector(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_AUDIENCE_SELECTOR",path,"audience selector kind is required");
    return;
  }
  if (input.kind === "ALL_ELIGIBLE_CONTACTS") return;
  if (input.kind === "CUSTOMER_SEGMENT") {
    if (!nonEmpty(input.segmentId)) {
      add(errors,"INVALID_LIFECYCLE_SEGMENT_ID",path+".segmentId","segmentId is required");
    }
    validateLifecycleMembership(input.membership,path+".membership",errors);
    return;
  }
  if (input.kind === "PURCHASE_COUNT_EQUALS" || input.kind === "PURCHASE_COUNT_AT_LEAST") {
    validateNonNegativeInteger(input.count,path+".count",errors);
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_AUDIENCE_SELECTOR",path+".kind","unsupported audience selector");
}

function validateLifecycleSuppressionRule(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_SUPPRESSION",path,"suppression rule kind is required");
    return;
  }
  if (input.kind === "RECENT_PURCHASE_WITHIN") {
    validatePositiveInteger(input.days,path+".days",errors);
    return;
  }
  if (input.kind === "CURRENT_FLOW_MEMBERSHIP") {
    if (!nonEmpty(input.flowId) || !LIFECYCLE_FLOW_ID_PATTERN.test(String(input.flowId))) {
      add(errors,"INVALID_LIFECYCLE_FLOW_ID",path+".flowId","flowId must begin lifecycleflow_");
    }
    return;
  }
  if (input.kind === "CUSTOMER_SEGMENT") {
    if (!nonEmpty(input.segmentId)) {
      add(errors,"INVALID_LIFECYCLE_SEGMENT_ID",path+".segmentId","segmentId is required");
    }
    validateLifecycleMembership(input.membership,path+".membership",errors);
    return;
  }
  if (input.kind === "CHANNEL_SUPPRESSED") {
    validateLifecycleChannel(input.channel,path+".channel",errors);
    return;
  }
  if (input.kind === "CONTACT_POLICY_BLOCK") {
    if (!nonEmpty(input.contactPolicyId) || !LIFECYCLE_POLICY_ID_PATTERN.test(String(input.contactPolicyId))) {
      add(errors,"INVALID_LIFECYCLE_POLICY_ID",path+".contactPolicyId","contactPolicyId must begin lifecyclepolicy_");
    }
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_SUPPRESSION",path+".kind","unsupported suppression rule");
}

function validateLifecycleAudienceDefinition(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_AUDIENCE",path,"audience definition is required");
    return;
  }
  if (!Array.isArray(input.include) || input.include.length === 0) {
    add(errors,"LIFECYCLE_AUDIENCE_INCLUDE_REQUIRED",path+".include","at least one include selector is required");
  } else {
    input.include.forEach((selector: unknown,index: number)=>
      validateLifecycleAudienceSelector(selector,path+".include["+index+"]",errors),
    );
  }
  if (!Array.isArray(input.suppress)) {
    add(errors,"INVALID_LIFECYCLE_SUPPRESSION_LIST",path+".suppress","suppress must be an array");
  } else {
    input.suppress.forEach((rule: unknown,index: number)=>
      validateLifecycleSuppressionRule(rule,path+".suppress["+index+"]",errors),
    );
  }
  if (input.suppressionPrecedence !== "SUPPRESS_OVERRIDES_INCLUDE") {
    add(errors,"INVALID_LIFECYCLE_SUPPRESSION_PRECEDENCE",path+".suppressionPrecedence","SUPPRESS_OVERRIDES_INCLUDE is required");
  }
}

function validateLifecycleEligibilityRequirements(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_CHANNEL_ELIGIBILITY",path,"channel eligibility is required");
    return;
  }
  for (const field of [
    "requireConsent",
    "requireValidDestination",
    "requireNotChannelSuppressed",
  ]) {
    if (typeof input[field] !== "boolean") {
      add(errors,"INVALID_LIFECYCLE_CHANNEL_ELIGIBILITY",path+"."+field,"must be boolean");
    }
  }
}

function validateLifecycleEvent(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_EVENT",path,"event kind is required");
    return;
  }
  if (["ORDER_PLACED","ORDER_FULFILLED","ORDER_DELIVERED","CUSTOMER_CREATED"].includes(String(input.kind))) return;
  if (input.kind === "PRODUCT_PURCHASED") {
    if (!nonEmpty(input.productId)) {
      add(errors,"INVALID_LIFECYCLE_EVENT_PRODUCT",path+".productId","productId is required");
    }
    return;
  }
  if (input.kind === "CUSTOM") {
    if (!nonEmpty(input.eventId)) {
      add(errors,"INVALID_LIFECYCLE_EVENT_ID",path+".eventId","eventId is required");
    }
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_EVENT",path+".kind","unsupported lifecycle event");
}

function validateLifecycleSendTiming(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_SEND_TIMING",path,"send timing is required");
    return;
  }
  if (input.kind === "ABSOLUTE_TIME") {
    validateTimestamp(input.at,path+".at",errors);
    if (!nonEmpty(input.timezone)) {
      add(errors,"INVALID_LIFECYCLE_TIMEZONE",path+".timezone","timezone is required");
    }
    return;
  }
  if (input.kind === "RELATIVE_TO_EVENT") {
    validateLifecycleEvent(input.event,path+".event",errors);
    validateNonNegativeInteger(input.delaySeconds,path+".delaySeconds",errors);
    return;
  }
  if (input.kind === "RECURRING_CADENCE") {
    if (!record(input.cadence)) {
      add(errors,"INVALID_LIFECYCLE_CADENCE",path+".cadence","cadence is required");
    } else {
      validatePositiveInteger(input.cadence.count,path+".cadence.count",errors);
      validatePositiveInteger(input.cadence.windowSeconds,path+".cadence.windowSeconds",errors);
    }
    if (!nonEmpty(input.timezone)) {
      add(errors,"INVALID_LIFECYCLE_TIMEZONE",path+".timezone","timezone is required");
    }
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_SEND_TIMING",path+".kind","unsupported send timing");
}

function validateLifecycleFlowTrigger(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_FLOW_TRIGGER",path,"flow trigger is required");
    return;
  }
  if (input.kind === "METRIC_THRESHOLD") {
    if (!["DAYS_SINCE_LAST_PURCHASE","DAYS_SINCE_LAST_ENGAGEMENT"].includes(String(input.metric))) {
      add(errors,"INVALID_LIFECYCLE_TRIGGER_METRIC",path+".metric","unsupported lifecycle trigger metric");
    }
    if (!["GTE","GT","EQ"].includes(String(input.operator))) {
      add(errors,"INVALID_LIFECYCLE_TRIGGER_OPERATOR",path+".operator","must be GTE, GT or EQ");
    }
    validateNonNegativeInteger(input.value,path+".value",errors);
    return;
  }
  if (input.kind === "EVENT") {
    validateLifecycleEvent(input.event,path+".event",errors);
    return;
  }
  if (input.kind === "AUDIENCE_ENTRY") return;
  add(errors,"UNKNOWN_LIFECYCLE_FLOW_TRIGGER",path+".kind","unsupported flow trigger");
}

function validateLifecycleExitCondition(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_EXIT_CONDITION",path,"exit condition kind is required");
    return;
  }
  if (["PURCHASE_OCCURRED","CUSTOMER_INELIGIBLE"].includes(String(input.kind))) return;
  if (input.kind === "EVENT_OCCURRED") {
    validateLifecycleEvent(input.event,path+".event",errors);
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_EXIT_CONDITION",path+".kind","unsupported exit condition");
}

function validateLifecycleSequenceStep(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_SEQUENCE_STEP",path,"sequence step is required");
    return;
  }
  if (!nonEmpty(input.stepId)) {
    add(errors,"INVALID_LIFECYCLE_STEP_ID",path+".stepId","stepId is required");
  }
  validatePositiveInteger(input.position,path+".position",errors);
  validateLifecycleChannel(input.channel,path+".channel",errors);
  validateNonNegativeInteger(input.delaySeconds,path+".delaySeconds",errors);
  validateLifecycleEligibilityRequirements(input.eligibility,path+".eligibility",errors);
  if (!Array.isArray(input.suppress)) {
    add(errors,"INVALID_LIFECYCLE_STEP_SUPPRESSIONS",path+".suppress","suppress must be an array");
  } else {
    input.suppress.forEach((rule: unknown,index: number)=>
      validateLifecycleSuppressionRule(rule,path+".suppress["+index+"]",errors),
    );
  }
  if (!record(input.continuation) || !["CONTINUE_IF_ELIGIBLE","CONTINUE_IF_NO_PURCHASE"].includes(String(input.continuation.kind))) {
    add(errors,"INVALID_LIFECYCLE_STEP_CONTINUATION",path+".continuation","unsupported continuation rule");
  }
  if (!Array.isArray(input.exitConditions)) {
    add(errors,"INVALID_LIFECYCLE_STEP_EXIT_CONDITIONS",path+".exitConditions","exitConditions must be an array");
  } else {
    input.exitConditions.forEach((condition: unknown,index: number)=>
      validateLifecycleExitCondition(condition,path+".exitConditions["+index+"]",errors),
    );
  }
}

function validateLifecycleFlowConflict(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_FLOW_CONFLICT",path,"conflict semantics are required");
    return;
  }
  if (["COEXIST","SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS"].includes(String(input.kind))) return;
  if (input.kind === "PRECEDENCE") {
    validateNonNegativeInteger(input.precedence,path+".precedence",errors);
    return;
  }
  if (input.kind === "MUTUALLY_EXCLUSIVE_GROUP") {
    if (!nonEmpty(input.groupId)) {
      add(errors,"INVALID_LIFECYCLE_FLOW_CONFLICT_GROUP",path+".groupId","groupId is required");
    }
    if (input.precedence !== undefined) {
      validateNonNegativeInteger(input.precedence,path+".precedence",errors);
    }
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_FLOW_CONFLICT",path+".kind","unsupported conflict semantics");
}

function validateLifecycleFlowDefinition(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_FLOW_DEFINITION",path,"flow definition is required");
    return;
  }
  if (!nonEmpty(input.flowId) || !LIFECYCLE_FLOW_ID_PATTERN.test(String(input.flowId))) {
    add(errors,"INVALID_LIFECYCLE_FLOW_ID",path+".flowId","flowId must begin lifecycleflow_");
  }
  validateLifecyclePurpose(input.purpose,path+".purpose",errors);
  validateLifecycleAudienceDefinition(input.audience,path+".audience",errors);
  validateLifecycleFlowTrigger(input.trigger,path+".trigger",errors);
  if (!Array.isArray(input.sequence) || input.sequence.length === 0) {
    add(errors,"LIFECYCLE_FLOW_SEQUENCE_REQUIRED",path+".sequence","flow requires at least one sequence step");
  } else {
    input.sequence.forEach((step: unknown,index: number)=>
      validateLifecycleSequenceStep(step,path+".sequence["+index+"]",errors),
    );
    const positions=input.sequence
      .filter(record)
      .map((step: any)=>Number(step.position))
      .sort((a:number,b:number)=>a-b);
    if (positions.some((position:number,index:number)=>position!==index+1)) {
      add(errors,"LIFECYCLE_SEQUENCE_POSITIONS_NOT_CONTIGUOUS",path+".sequence","step positions must be contiguous starting at 1");
    }
    const stepIds=input.sequence.filter(record).map((step:any)=>String(step.stepId??""));
    if (new Set(stepIds).size !== stepIds.length) {
      add(errors,"DUPLICATE_LIFECYCLE_STEP_ID",path+".sequence","step IDs must be unique");
    }
  }
  if (!Array.isArray(input.exitConditions)) {
    add(errors,"INVALID_LIFECYCLE_FLOW_EXIT_CONDITIONS",path+".exitConditions","exitConditions must be an array");
  } else {
    input.exitConditions.forEach((condition: unknown,index: number)=>
      validateLifecycleExitCondition(condition,path+".exitConditions["+index+"]",errors),
    );
  }
  validateStringArray(input.contactPolicyRefs,path+".contactPolicyRefs",errors,true);
  validateLifecycleFlowConflict(input.conflictResolution,path+".conflictResolution",errors);
}

function validateLifecycleFrequencyValue(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_FREQUENCY_VALUE",path,"frequency value is required");
    return;
  }
  validateNonNegativeInteger(input.count,path+".count",errors);
  validatePositiveInteger(input.windowSeconds,path+".windowSeconds",errors);
}

function validateLifecycleFrequencyReference(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_FREQUENCY_REFERENCE",path,"frequency reference is required");
    return;
  }
  if (input.kind === "current_policy_at_decision") {
    validateTimestamp(input.decisionTime,path+".decisionTime",errors);
    if (decisionTime && input.decisionTime !== decisionTime) {
      add(errors,"LIFECYCLE_FREQUENCY_DECISION_TIME_MISMATCH",path+".decisionTime","must equal Action decision time");
    }
    return;
  }
  if (input.kind === "baseline_snapshot") {
    if (!nonEmpty(input.baselineId)) {
      add(errors,"INVALID_BASELINE_ID",path+".baselineId","baselineId is required");
    }
    return;
  }
  if (input.kind === "explicit_baseline") {
    validateLifecycleFrequencyValue(input.value,path+".value",errors);
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_FREQUENCY_REFERENCE",path+".kind","unsupported frequency reference");
}

function validateLifecycleFrequencyOperation(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_FREQUENCY_OPERATION",path,"frequency operation is required");
    return;
  }
  if (input.kind === "SET") {
    validateLifecycleFrequencyValue(input.value,path+".value",errors);
    return;
  }
  if (input.kind === "DELTA") {
    if (!["increase","decrease"].includes(String(input.direction))) {
      add(errors,"INVALID_LIFECYCLE_FREQUENCY_DIRECTION",path+".direction","must be increase or decrease");
    }
    validateLifecycleFrequencyValue(input.amount,path+".amount",errors);
    validateLifecycleFrequencyReference(input.reference,path+".reference",errors,decisionTime);
    if (
      record(input.amount) &&
      record(input.reference) &&
      input.reference.kind === "explicit_baseline" &&
      record(input.reference.value) &&
      Number.isInteger(input.amount.count) &&
      Number.isInteger(input.reference.value.count) &&
      input.amount.windowSeconds !== input.reference.value.windowSeconds
    ) {
      add(errors,"LIFECYCLE_FREQUENCY_WINDOW_MISMATCH",path,"DELTA amount and explicit baseline must use the same frequency window");
    }
    if (
      record(input.amount) &&
      record(input.reference) &&
      input.reference.kind === "explicit_baseline" &&
      record(input.reference.value) &&
      Number.isInteger(input.amount.count) &&
      Number.isInteger(input.reference.value.count) &&
      input.amount.windowSeconds === input.reference.value.windowSeconds &&
      input.direction === "decrease" &&
      Number(input.amount.count) > Number(input.reference.value.count)
    ) {
      add(errors,"LIFECYCLE_FREQUENCY_WOULD_BECOME_NEGATIVE",path,"frequency decrease cannot exceed explicit baseline");
    }
    return;
  }
  if (input.kind === "MULTIPLY") {
    if (!finite(input.factor) || Number(input.factor) <= 0) {
      add(errors,"INVALID_MULTIPLIER",path+".factor","must be > 0");
    }
    validateLifecycleFrequencyReference(input.reference,path+".reference",errors,decisionTime);
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_FREQUENCY_OPERATION",path+".kind","unsupported frequency operation");
}

function validateLifecycleFrequencyPolicy(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_FREQUENCY_POLICY",path,"frequency/contact policy is required");
    return;
  }
  if (input.kind === "PLANNED_CADENCE") {
    validateLifecycleChannel(input.channel,path+".channel",errors);
    if (input.purpose !== undefined) {
      validateLifecyclePurpose(input.purpose,path+".purpose",errors);
    }
    validateLifecycleFrequencyOperation(input.operation,path+".operation",errors,decisionTime);
    return;
  }
  if (input.kind === "CONTACT_CAP") {
    if (!Array.isArray(input.channels) || input.channels.length === 0) {
      add(errors,"LIFECYCLE_CONTACT_CAP_CHANNELS_REQUIRED",path+".channels","at least one channel is required");
    } else {
      input.channels.forEach((channel: unknown,index: number)=>
        validateLifecycleChannel(channel,path+".channels["+index+"]",errors),
      );
      const keys=input.channels.map(lifecycleChannelKey);
      if (new Set(keys).size !== keys.length) {
        add(errors,"DUPLICATE_LIFECYCLE_POLICY_CHANNEL",path+".channels","channels must be unique");
      }
    }
    validateNonNegativeInteger(input.maximumContacts,path+".maximumContacts",errors);
    validatePositiveInteger(input.windowSeconds,path+".windowSeconds",errors);
    return;
  }
  if (input.kind === "MINIMUM_INTERVAL") {
    if (!Array.isArray(input.channels) || input.channels.length === 0) {
      add(errors,"LIFECYCLE_INTERVAL_CHANNELS_REQUIRED",path+".channels","at least one channel is required");
    } else {
      input.channels.forEach((channel: unknown,index: number)=>
        validateLifecycleChannel(channel,path+".channels["+index+"]",errors),
      );
    }
    validatePositiveInteger(input.minimumIntervalSeconds,path+".minimumIntervalSeconds",errors);
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_FREQUENCY_POLICY",path+".kind","unsupported policy kind");
}

function validateLifecyclePolicyRollbackValue(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || input.kind !== "FREQUENCY_POLICY") {
    add(errors,"INVALID_LIFECYCLE_ROLLBACK_VALUE",path,"FREQUENCY_POLICY value is required");
    return;
  }
  validateLifecycleFrequencyPolicy(input.policy,path+".policy",errors,decisionTime);
}

function validateLifecycleRollbackStrategy(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_ROLLBACK_STRATEGY",path,"rollback strategy is required");
    return;
  }
  if (input.kind === "RESTORE_PRE_ACTION_VALUE") {
    if (!record(input.preActionValue) || !nonEmpty(input.preActionValue.kind)) {
      add(errors,"INVALID_LIFECYCLE_ROLLBACK_REFERENCE",path+".preActionValue","pre-action policy reference is required");
    } else if (input.preActionValue.kind === "lifecycle_policy_snapshot") {
      if (!nonEmpty(input.preActionValue.baselineId)) {
        add(errors,"INVALID_LIFECYCLE_POLICY_SNAPSHOT",path+".preActionValue.baselineId","baselineId is required");
      }
    } else if (input.preActionValue.kind === "explicit_policy") {
      validateLifecyclePolicyRollbackValue(input.preActionValue.value,path+".preActionValue.value",errors,decisionTime);
    } else {
      add(errors,"UNKNOWN_LIFECYCLE_ROLLBACK_REFERENCE",path+".preActionValue.kind","unsupported rollback reference");
    }
    return;
  }
  if (input.kind === "SET_EXPLICIT_VALUE") {
    validateLifecyclePolicyRollbackValue(input.value,path+".value",errors,decisionTime);
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_ROLLBACK_STRATEGY",path+".kind","unsupported rollback strategy");
}

function validateLifecycleRollbackGuard(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
  originalActionId?: string,
): void {
  if (!record(input) || input.kind !== "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT") {
    add(errors,"INVALID_LIFECYCLE_ROLLBACK_GUARD",path,"conflict guard is required");
    return;
  }
  if (!nonEmpty(input.sourceActionId)) {
    add(errors,"INVALID_LIFECYCLE_ROLLBACK_SOURCE",path+".sourceActionId","required");
  } else if (originalActionId && input.sourceActionId !== originalActionId) {
    add(errors,"LIFECYCLE_ROLLBACK_SOURCE_MISMATCH",path+".sourceActionId","must reference original lifecycle policy Action");
  }
  validateLifecyclePolicyRollbackValue(input.expectedValue,path+".expectedValue",errors,decisionTime);
}

function validateLifecycleSendParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input)) return;
  validateLifecycleChannel(input.channel,path+".channel",errors);
  validateLifecyclePurpose(input.purpose,path+".purpose",errors);
  validateLifecycleAudienceDefinition(input.audience,path+".audience",errors);
  validateLifecycleSendTiming(input.timing,path+".timing",errors);
  validateLifecycleEligibilityRequirements(input.eligibility,path+".eligibility",errors);
  validateStringArray(input.contactPolicyRefs,path+".contactPolicyRefs",errors,true);
  if (input.coordinatedActionIds !== undefined) {
    if (!Array.isArray(input.coordinatedActionIds) ||
        input.coordinatedActionIds.some((value: unknown)=>!nonEmpty(value)) ||
        new Set(input.coordinatedActionIds).size !== input.coordinatedActionIds.length) {
      add(errors,"INVALID_LIFECYCLE_COORDINATED_ACTION_IDS",path+".coordinatedActionIds","must be a unique string array when supplied");
    }
  }
}

function validateLifecycleFlowModification(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
): void {
  if (!record(input) || !nonEmpty(input.kind)) {
    add(errors,"INVALID_LIFECYCLE_FLOW_MODIFICATION",path,"flow modification kind is required");
    return;
  }
  if (input.kind === "SET_TRIGGER") {
    validateLifecycleFlowTrigger(input.trigger,path+".trigger",errors);
    return;
  }
  if (input.kind === "SET_STEP_DELAY") {
    if (!nonEmpty(input.stepId)) add(errors,"INVALID_LIFECYCLE_STEP_ID",path+".stepId","stepId is required");
    validateNonNegativeInteger(input.delaySeconds,path+".delaySeconds",errors);
    return;
  }
  if (input.kind === "ADD_STEP") {
    validateLifecycleSequenceStep(input.step,path+".step",errors);
    return;
  }
  if (input.kind === "REMOVE_STEP") {
    if (!nonEmpty(input.stepId)) add(errors,"INVALID_LIFECYCLE_STEP_ID",path+".stepId","stepId is required");
    return;
  }
  add(errors,"UNKNOWN_LIFECYCLE_FLOW_MODIFICATION",path+".kind","unsupported flow modification");
}

function validateLifecycleParameters(
  input: unknown,
  path: string,
  errors: ActionValidationIssue[],
  decisionTime?: string,
): void {
  if (!record(input)) {
    add(errors,"INVALID_LIFECYCLE_PARAMETERS",path,"lifecycle parameters are required");
    return;
  }
  if (input.kind === "lifecycle_send") {
    validateLifecycleSendParameters(input,path,errors);
    return;
  }
  if (input.kind === "lifecycle_flow_start") {
    validateLifecycleFlowDefinition(input.definition,path+".definition",errors);
    if (input.coordinatedActionIds !== undefined) {
      if (!Array.isArray(input.coordinatedActionIds) ||
          input.coordinatedActionIds.some((value: unknown)=>!nonEmpty(value)) ||
          new Set(input.coordinatedActionIds).size !== input.coordinatedActionIds.length) {
        add(errors,"INVALID_LIFECYCLE_COORDINATED_ACTION_IDS",path+".coordinatedActionIds","must be a unique string array");
      }
    }
    return;
  }
  if (input.kind === "lifecycle_flow_stop") {
    if (!nonEmpty(input.targetFlowId) || !LIFECYCLE_FLOW_ID_PATTERN.test(String(input.targetFlowId))) {
      add(errors,"INVALID_LIFECYCLE_FLOW_ID",path+".targetFlowId","flowId must begin lifecycleflow_");
    }
    if (input.stopSemantics !== "PREVENT_FUTURE_TRIGGERED_COMMUNICATIONS") {
      add(errors,"INVALID_LIFECYCLE_STOP_SEMANTICS",path+".stopSemantics","stop must prevent future flow-triggered communications");
    }
    return;
  }
  if (input.kind === "lifecycle_flow_modify") {
    if (!nonEmpty(input.targetFlowId) || !LIFECYCLE_FLOW_ID_PATTERN.test(String(input.targetFlowId))) {
      add(errors,"INVALID_LIFECYCLE_FLOW_ID",path+".targetFlowId","flowId must begin lifecycleflow_");
    }
    if (!Array.isArray(input.modifications) || input.modifications.length === 0) {
      add(errors,"LIFECYCLE_FLOW_MODIFICATION_REQUIRED",path+".modifications","at least one modification is required");
    } else {
      input.modifications.forEach((modification: unknown,index: number)=>
        validateLifecycleFlowModification(modification,path+".modifications["+index+"]",errors),
      );
    }
    return;
  }
  if (input.kind === "lifecycle_targeting") {
    validateLifecycleAudienceDefinition(input.audience,path+".audience",errors);
    return;
  }
  if (input.kind === "lifecycle_policy_rollback") {
    if (!nonEmpty(input.originalActionId)) {
      add(errors,"INVALID_LIFECYCLE_ROLLBACK_ORIGINAL",path+".originalActionId","required");
    }
    validateLifecycleRollbackStrategy(input.strategy,path+".strategy",errors,decisionTime);
    validateLifecycleRollbackGuard(
      input.conflictGuard,
      path+".conflictGuard",
      errors,
      decisionTime,
      typeof input.originalActionId === "string" ? input.originalActionId : undefined,
    );
    return;
  }
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
    case "promotion_start":
    case "promotion_stop":
    case "promotion_modify":
      validatePromotionParameters(input, path, errors);
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
    case "inventory_reorder":
    case "inventory_reorder_quantity":
    case "inventory_reorder_timing":
    case "inventory_policy_control":
    case "inventory_protection":
    case "inventory_backorder_policy":
    case "inventory_clearance":
    case "inventory_acceleration":
    case "inventory_policy_rollback":
      validateInventoryParameters(input,path,errors,decisionTime);
      return;
    case "frequency_adjustment":
      if (input.policy !== undefined) {
        if (input.operation !== undefined) {
          add(errors,"AMBIGUOUS_LIFECYCLE_FREQUENCY_PARAMETERS",path,"frequency adjustment cannot contain both legacy operation and structured policy");
        }
        validateLifecycleFrequencyPolicy(input.policy,path+".policy",errors,decisionTime);
      } else {
        validateOperation(
          input.operation,
          path + ".operation",
          errors,
          "frequency",
          decisionTime,
        );
      }
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
    case "merchandising_visibility":
    case "merchandising_rank":
    case "merchandising_relationship":
    case "merchandising_remove_placement":
    case "merchandising_remove_relationship":
    case "merchandising_rank_rollback":
      validateMerchandisingParameters(input,path,errors);
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
    case "shipping_offer_set":
    case "shipping_offer_modify":
    case "shipping_offer_stop":
    case "shipping_policy_adjustment":
    case "shipping_policy_rollback":
      validateShippingParameters(input, path, errors, decisionTime);
      return;
    case "page_change":
      if (!nonEmpty(input.changeId) || !nonEmpty(input.variantRef)) {
        add(errors, "INVALID_PAGE_CHANGE", path, "changeId and variantRef are required");
      }
      return;
    case "cro_intervention":
    case "cro_rollback":
      validateCroParameters(input,path,errors);
      return;
    case "lifecycle_send":
    case "lifecycle_flow_start":
    case "lifecycle_flow_stop":
    case "lifecycle_flow_modify":
    case "lifecycle_targeting":
    case "lifecycle_policy_rollback":
      validateLifecycleParameters(input,path,errors,decisionTime);
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
          "TRACKING_AUDIT",
          "DATA_QUALITY_CHECK",
          "MISSING_DATA_REQUEST",
          "ANOMALY_DIAGNOSIS",
          "METRIC_RECONCILIATION",
          "BUSINESS_PROCESS_CHECK",
          "MEASUREMENT_VALIDATION",
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
      for (const key of Object.keys(input)) {
        if (!["kind", "investigationType", "question", "requestedEvidenceRefs", "targetRef", "sourceRef", "metricRef", "suspectedIssueClass", "observationWindow", "comparisonWindow", "anomalyDirection", "successCriteria", "maximumInvestigationHorizonSeconds"].includes(key)) {
          add(errors, "UNKNOWN_INVESTIGATION_FIELD", path + "." + key, "unknown investigation field");
        }
      }
      for (const key of ["targetRef", "sourceRef", "metricRef", "suspectedIssueClass"] as const) {
        if (input[key] !== undefined && !nonEmpty(input[key])) add(errors, "INVALID_INVESTIGATION_REFERENCE", path + "." + key, "must be nonempty");
      }
      for (const key of ["observationWindow", "comparisonWindow"] as const) {
        const window = input[key];
        if (window === undefined) continue;
        if (!record(window)) { add(errors, "INVALID_INVESTIGATION_WINDOW", path + "." + key, "window is required"); continue; }
        validateTimestamp(window.start, path + "." + key + ".start", errors);
        validateTimestamp(window.end, path + "." + key + ".end", errors);
        if (typeof window.start === "string" && typeof window.end === "string" && Date.parse(window.start) >= Date.parse(window.end)) add(errors, "INVALID_INVESTIGATION_WINDOW", path + "." + key, "start must precede end");
        for (const field of Object.keys(window)) if (!["start", "end"].includes(field)) add(errors, "UNKNOWN_INVESTIGATION_FIELD", path + "." + key + "." + field, "unknown window field");
      }
      if (input.anomalyDirection !== undefined && !["increase", "decrease", "discrepancy"].includes(input.anomalyDirection)) add(errors, "INVALID_ANOMALY_DIRECTION", path + ".anomalyDirection", "unsupported");
      if (input.successCriteria !== undefined) validateStringArray(input.successCriteria, path + ".successCriteria", errors, true);
      if (input.maximumInvestigationHorizonSeconds !== undefined) validatePositiveInteger(input.maximumInvestigationHorizonSeconds, path + ".maximumInvestigationHorizonSeconds", errors);
      if (input.investigationType === "MISSING_DATA_REQUEST" && (!nonEmpty(input.targetRef) || !nonEmpty(input.metricRef))) add(errors, "MISSING_DATA_REQUIRES_FACT", path, "targetRef and metricRef are required");
      if (input.investigationType === "ANOMALY_DIAGNOSIS" && (!nonEmpty(input.metricRef) || input.observationWindow === undefined || input.comparisonWindow === undefined)) add(errors, "ANOMALY_REQUIRES_BASELINE", path, "metricRef and observation/comparison windows are required");
      if (input.investigationType === "TRACKING_AUDIT" && (!nonEmpty(input.sourceRef) || !nonEmpty(input.metricRef))) add(errors, "TRACKING_AUDIT_REQUIRES_SOURCE", path, "sourceRef and metricRef are required");
      return;
    case "no_op":
      if (!nonEmpty(input.reasonCode)) {
        add(errors, "INVALID_NO_OP_REASON", path + ".reasonCode", "required");
      }
      for (const key of Object.keys(input)) if (!["kind", "reasonCode"].includes(key)) add(errors, "UNKNOWN_NO_OP_FIELD", path + "." + key, "NO_OP has no operational effect");
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
  if (input.shippingRollback !== undefined) {
    if (!record(input.shippingRollback) || typeof input.shippingRollback.available !== "boolean") {
      add(errors,"INVALID_SHIPPING_ROLLBACK_CONTRACT",path+".shippingRollback","available must be explicit");
    } else if (input.shippingRollback.available === false) {
      if (!nonEmpty(input.shippingRollback.reason)) add(errors,"INVALID_SHIPPING_ROLLBACK_REASON",path+".shippingRollback.reason","reason required");
    } else {
      validateShippingRollbackStrategy(input.shippingRollback.strategy,path+".shippingRollback.strategy",errors);
      if (!record(input.shippingRollback.trigger) || !nonEmpty(input.shippingRollback.trigger.kind)) {
        add(errors,"INVALID_SHIPPING_ROLLBACK_TRIGGER",path+".shippingRollback.trigger","trigger required");
      } else if (input.shippingRollback.trigger.kind==="AT") {
        validateTimestamp(input.shippingRollback.trigger.at,path+".shippingRollback.trigger.at",errors);
      } else if (input.shippingRollback.trigger.kind!=="ON_TERMINATION") {
        add(errors,"INVALID_SHIPPING_ROLLBACK_TRIGGER",path+".shippingRollback.trigger.kind","unsupported trigger");
      }
      validateNonNegativeInteger(input.shippingRollback.delaySeconds,path+".shippingRollback.delaySeconds",errors);
      validateKnownOrUnknown(input.shippingRollback.cost,path+".shippingRollback.cost",errors,(v,p)=>validateMoney(v,p,errors));
      validateShippingRollbackGuard(input.shippingRollback.conflictGuard,path+".shippingRollback.conflictGuard",errors);
    }
  }

  if (input.merchandisingRollback !== undefined) {
    if (!record(input.merchandisingRollback) || typeof input.merchandisingRollback.available !== "boolean") {
      add(errors,"INVALID_MERCHANDISING_ROLLBACK_CONTRACT",path+".merchandisingRollback","available must be explicit");
    } else if (input.merchandisingRollback.available === false) {
      if (!nonEmpty(input.merchandisingRollback.reason)) {
        add(errors,"INVALID_MERCHANDISING_ROLLBACK_REASON",path+".merchandisingRollback.reason","reason is required");
      }
    } else {
      validateMerchandisingRollbackStrategy(input.merchandisingRollback.strategy,path+".merchandisingRollback.strategy",errors);
      if (!record(input.merchandisingRollback.trigger) || !nonEmpty(input.merchandisingRollback.trigger.kind)) {
        add(errors,"INVALID_MERCHANDISING_ROLLBACK_TRIGGER",path+".merchandisingRollback.trigger","trigger is required");
      } else if (input.merchandisingRollback.trigger.kind === "AT") {
        validateTimestamp(input.merchandisingRollback.trigger.at,path+".merchandisingRollback.trigger.at",errors);
      } else if (input.merchandisingRollback.trigger.kind !== "ON_TERMINATION") {
        add(errors,"INVALID_MERCHANDISING_ROLLBACK_TRIGGER",path+".merchandisingRollback.trigger.kind","unsupported trigger");
      }
      validateNonNegativeInteger(input.merchandisingRollback.delaySeconds,path+".merchandisingRollback.delaySeconds",errors);
      validateKnownOrUnknown(input.merchandisingRollback.cost,path+".merchandisingRollback.cost",errors,(v,p)=>validateMoney(v,p,errors));
      validateMerchandisingRollbackGuard(input.merchandisingRollback.conflictGuard,path+".merchandisingRollback.conflictGuard",errors);
    }
  }

  if (input.inventoryRollback !== undefined) {
    if (!record(input.inventoryRollback) || typeof input.inventoryRollback.available !== "boolean") {
      add(errors,"INVALID_INVENTORY_ROLLBACK_CONTRACT",path+".inventoryRollback","available must be explicit");
    } else if (input.inventoryRollback.available === false) {
      if (!nonEmpty(input.inventoryRollback.reason)) {
        add(errors,"INVALID_INVENTORY_ROLLBACK_REASON",path+".inventoryRollback.reason","reason is required");
      }
    } else {
      validateInventoryRollbackStrategy(input.inventoryRollback.strategy,path+".inventoryRollback.strategy",errors);
      if (!record(input.inventoryRollback.trigger) || !nonEmpty(input.inventoryRollback.trigger.kind)) {
        add(errors,"INVALID_INVENTORY_ROLLBACK_TRIGGER",path+".inventoryRollback.trigger","trigger is required");
      } else if (input.inventoryRollback.trigger.kind === "AT") {
        validateTimestamp(input.inventoryRollback.trigger.at,path+".inventoryRollback.trigger.at",errors);
      } else if (input.inventoryRollback.trigger.kind !== "ON_TERMINATION") {
        add(errors,"INVALID_INVENTORY_ROLLBACK_TRIGGER",path+".inventoryRollback.trigger.kind","unsupported trigger");
      }
      validateNonNegativeInteger(input.inventoryRollback.delaySeconds,path+".inventoryRollback.delaySeconds",errors);
      validateKnownOrUnknown(input.inventoryRollback.cost,path+".inventoryRollback.cost",errors,(v,p)=>validateMoney(v,p,errors));
      validateInventoryRollbackGuard(input.inventoryRollback.conflictGuard,path+".inventoryRollback.conflictGuard",errors);
    }
  }

  if (input.croRollback !== undefined) {
    if (!record(input.croRollback) || typeof input.croRollback.available !== "boolean") {
      add(errors,"INVALID_CRO_ROLLBACK_CONTRACT",path+".croRollback","available must be explicit");
    } else if (input.croRollback.available === false) {
      if (!nonEmpty(input.croRollback.reason)) {
        add(errors,"INVALID_CRO_ROLLBACK_REASON",path+".croRollback.reason","reason is required");
      }
    } else {
      validateCroRollbackStrategy(input.croRollback.strategy,path+".croRollback.strategy",errors);
      if (!record(input.croRollback.trigger) || !nonEmpty(input.croRollback.trigger.kind)) {
        add(errors,"INVALID_CRO_ROLLBACK_TRIGGER",path+".croRollback.trigger","trigger is required");
      } else if (input.croRollback.trigger.kind === "AT") {
        validateTimestamp(input.croRollback.trigger.at,path+".croRollback.trigger.at",errors);
      } else if (input.croRollback.trigger.kind !== "ON_TERMINATION") {
        add(errors,"INVALID_CRO_ROLLBACK_TRIGGER",path+".croRollback.trigger.kind","unsupported trigger");
      }
      validateNonNegativeInteger(input.croRollback.delaySeconds,path+".croRollback.delaySeconds",errors);
      validateKnownOrUnknown(input.croRollback.cost,path+".croRollback.cost",errors,(v,p)=>validateMoney(v,p,errors));
      validateCroRollbackGuard(input.croRollback.conflictGuard,path+".croRollback.conflictGuard",errors);
    }
  }

  if (input.lifecycleRollback !== undefined) {
    if (!record(input.lifecycleRollback) || typeof input.lifecycleRollback.available !== "boolean") {
      add(errors,"INVALID_LIFECYCLE_ROLLBACK_CONTRACT",path+".lifecycleRollback","available must be explicit");
    } else if (input.lifecycleRollback.available === false) {
      if (!nonEmpty(input.lifecycleRollback.reason)) {
        add(errors,"INVALID_LIFECYCLE_ROLLBACK_REASON",path+".lifecycleRollback.reason","reason is required");
      }
    } else {
      validateLifecycleRollbackStrategy(input.lifecycleRollback.strategy,path+".lifecycleRollback.strategy",errors);
      if (!record(input.lifecycleRollback.trigger) || !nonEmpty(input.lifecycleRollback.trigger.kind)) {
        add(errors,"INVALID_LIFECYCLE_ROLLBACK_TRIGGER",path+".lifecycleRollback.trigger","trigger is required");
      } else if (input.lifecycleRollback.trigger.kind === "AT") {
        validateTimestamp(input.lifecycleRollback.trigger.at,path+".lifecycleRollback.trigger.at",errors);
      } else if (input.lifecycleRollback.trigger.kind !== "ON_TERMINATION") {
        add(errors,"INVALID_LIFECYCLE_ROLLBACK_TRIGGER",path+".lifecycleRollback.trigger.kind","unsupported trigger");
      }
      validateNonNegativeInteger(input.lifecycleRollback.delaySeconds,path+".lifecycleRollback.delaySeconds",errors);
      validateKnownOrUnknown(input.lifecycleRollback.cost,path+".lifecycleRollback.cost",errors,(v,p)=>validateMoney(v,p,errors));
      validateLifecycleRollbackGuard(input.lifecycleRollback.conflictGuard,path+".lifecycleRollback.conflictGuard",errors);
    }
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


function validatePromotionActionSemantics(
  input: any,
  errors: ActionValidationIssue[],
): void {
  if (
    input.actionType !== "promotion.start" &&
    input.actionType !== "promotion.stop" &&
    input.actionType !== "promotion.modify"
  ) {
    return;
  }

  if (!record(input.target) || input.target.kind !== "promotion") {
    add(
      errors,
      "PROMOTION_ACTION_REQUIRES_PROMOTION_TARGET",
      "target.kind",
      "promotion.start/stop/modify must target stable promotion identity",
    );
    return;
  }

  if (
    !nonEmpty(input.target.promotionId) ||
    !PROMOTION_ID_PATTERN.test(input.target.promotionId)
  ) {
    add(
      errors,
      "INVALID_PROMOTION_ID",
      "target.promotionId",
      "promotionId must begin with promo_",
    );
  }

  if (!record(input.parameters)) return;

  const referencedId =
    input.parameters.kind === "promotion_start"
      ? input.parameters.promotionId
      : input.parameters.kind === "promotion_stop" ||
          input.parameters.kind === "promotion_modify"
        ? input.parameters.targetPromotionId
        : undefined;

  if (
    typeof referencedId === "string" &&
    referencedId !== input.target.promotionId
  ) {
    add(
      errors,
      "PROMOTION_ID_MISMATCH",
      "parameters",
      "parameter promotion identity must match Action target.promotionId",
    );
  }
  if (
    typeof referencedId === "string" &&
    !PROMOTION_ID_PATTERN.test(referencedId)
  ) {
    add(
      errors,
      "INVALID_PROMOTION_ID",
      "parameters",
      "promotion identity must begin with promo_",
    );
  }

  if (
    record(input.reversibility) &&
    input.reversibility.pricingRollback !== undefined
  ) {
    add(
      errors,
      "PROMOTION_CANNOT_USE_PRICING_ROLLBACK",
      "reversibility.pricingRollback",
      "promotion termination deactivates promotion state and must not restore regular prices",
    );
  }

  if (
    input.actionType === "promotion.stop" &&
    (!record(input.duration) || input.duration.kind !== "instantaneous")
  ) {
    add(
      errors,
      "PROMOTION_STOP_MUST_BE_INSTANTANEOUS",
      "duration",
      "promotion.stop represents an instantaneous ACTIVE to INACTIVE state transition",
    );
  }

  if (
    input.actionType === "promotion.modify" &&
    (!record(input.duration) || input.duration.kind !== "instantaneous")
  ) {
    add(
      errors,
      "PROMOTION_MODIFY_MUST_BE_INSTANTANEOUS",
      "duration",
      "promotion.modify represents an instantaneous promotion-definition change",
    );
  }
}


function validateShippingActionSemantics(input:any,errors:ActionValidationIssue[]):void{
  const offerTypes=["shipping.set_offer","shipping.modify_offer","shipping.stop_offer"];
  if(offerTypes.includes(String(input.actionType))){
    if(!record(input.target)||input.target.kind!=="shipping_offer"){
      add(errors,"SHIPPING_OFFER_ACTION_REQUIRES_OFFER_TARGET","target.kind","shipping offer Actions require shipping_offer target");return;
    }
    if(!nonEmpty(input.target.shippingOfferId)||!SHIPPING_OFFER_ID_PATTERN.test(input.target.shippingOfferId)){
      add(errors,"INVALID_SHIPPING_OFFER_ID","target.shippingOfferId","shipping offer ID must begin shipoffer_");
    }
    if(record(input.parameters)){
      const ref=input.parameters.kind==="shipping_offer_set"?input.parameters.shippingOfferId:
        input.parameters.kind==="shipping_offer_modify"||input.parameters.kind==="shipping_offer_stop"?input.parameters.targetShippingOfferId:undefined;
      if(typeof ref==="string"&&ref!==input.target.shippingOfferId) add(errors,"SHIPPING_OFFER_ID_MISMATCH","parameters","shipping offer reference must match target");
      if(typeof ref==="string"&&!SHIPPING_OFFER_ID_PATTERN.test(ref)) add(errors,"INVALID_SHIPPING_OFFER_ID","parameters","shipping offer ID must begin shipoffer_");
    }
    if(input.actionType!=="shipping.set_offer"&&(!record(input.duration)||input.duration.kind!=="instantaneous")){
      add(errors,"SHIPPING_LIFECYCLE_ACTION_MUST_BE_INSTANTANEOUS","duration","modify/stop offer must be instantaneous");
    }
    if(record(input.reversibility)&&input.reversibility.shippingRollback!==undefined){
      add(errors,"SHIPPING_OFFER_CANNOT_USE_POLICY_ROLLBACK","reversibility.shippingRollback","overlay offer termination deactivates the offer");
    }
  }

  if(input.actionType==="shipping.adjust_policy"){
    if(!record(input.target)||input.target.kind!=="shipping_policy") add(errors,"SHIPPING_POLICY_ACTION_REQUIRES_POLICY_TARGET","target.kind","shipping policy adjustment requires shipping_policy target");
    const temporary=record(input.duration)&&input.duration.kind==="temporary";
    if(temporary&&(!record(input.reversibility)||!record(input.reversibility.shippingRollback)||input.reversibility.shippingRollback.available!==true)){
      add(errors,"TEMPORARY_SHIPPING_POLICY_REQUIRES_SAFE_ROLLBACK","reversibility.shippingRollback","temporary policy change requires conflict-safe rollback");
    }
    if(record(input.reversibility)&&record(input.reversibility.shippingRollback)&&input.reversibility.shippingRollback.available===true&&
       record(input.reversibility.shippingRollback.conflictGuard)&&input.reversibility.shippingRollback.conflictGuard.sourceActionId!==input.actionId){
      add(errors,"SHIPPING_ROLLBACK_SOURCE_MISMATCH","reversibility.shippingRollback.conflictGuard.sourceActionId","must reference this policy Action");
    }
  }

  if(input.actionType==="shipping.rollback_policy"){
    if(!record(input.target)||input.target.kind!=="shipping_policy") add(errors,"SHIPPING_POLICY_ACTION_REQUIRES_POLICY_TARGET","target.kind","shipping rollback requires shipping_policy target");
    if(record(input.parameters)&&input.parameters.kind==="shipping_policy_rollback"){
      if(!nonEmpty(input.reversalOfActionId)) add(errors,"SHIPPING_ROLLBACK_REQUIRES_REVERSAL_REFERENCE","reversalOfActionId","required");
      else if(input.reversalOfActionId!==input.parameters.originalActionId) add(errors,"SHIPPING_ROLLBACK_ORIGINAL_ACTION_MISMATCH","reversalOfActionId","must match originalActionId");
    }
  }
}


function validateMerchandisingActionSemantics(
  input: any,
  errors: ActionValidationIssue[],
): void {
  const visibilityTypes = ["merchandising.feature", "merchandising.deprioritize"];
  if (visibilityTypes.includes(String(input.actionType))) {
    if (!record(input.parameters) || input.parameters.kind !== "merchandising_visibility") return;
    if (
      canonicalRuntimeKey(input.target) !==
      canonicalRuntimeKey(input.parameters.entity)
    ) {
      add(
        errors,
        "MERCHANDISING_ENTITY_TARGET_MISMATCH",
        "parameters.entity",
        "Action target and merchandising entity must match",
      );
    }
    const expected =
      input.actionType === "merchandising.feature"
        ? "FEATURE"
        : "DEPRIORITIZE";
    if (!record(input.parameters.visibility) || input.parameters.visibility.kind !== expected) {
      add(
        errors,
        "MERCHANDISING_VISIBILITY_ACTION_MISMATCH",
        "parameters.visibility.kind",
        "visibility mode does not match merchandising action type",
      );
    }
  }

  if (input.actionType === "merchandising.set_rank") {
    if (!record(input.parameters) || input.parameters.kind !== "merchandising_rank") return;
    if (
      canonicalRuntimeKey(input.target) !==
      canonicalRuntimeKey(input.parameters.entity)
    ) {
      add(
        errors,
        "MERCHANDISING_ENTITY_TARGET_MISMATCH",
        "parameters.entity",
        "Action target and ranked entity must match",
      );
    }
    const temporary =
      record(input.duration) && input.duration.kind === "temporary";
    if (
      temporary &&
      (!record(input.reversibility) ||
        !record(input.reversibility.merchandisingRollback) ||
        input.reversibility.merchandisingRollback.available !== true)
    ) {
      add(
        errors,
        "TEMPORARY_MERCHANDISING_RANK_REQUIRES_SAFE_ROLLBACK",
        "reversibility.merchandisingRollback",
        "temporary rank changes require conflict-protected rollback",
      );
    }
    if (
      record(input.reversibility) &&
      record(input.reversibility.merchandisingRollback) &&
      input.reversibility.merchandisingRollback.available === true &&
      record(input.reversibility.merchandisingRollback.conflictGuard) &&
      input.reversibility.merchandisingRollback.conflictGuard.sourceActionId !== input.actionId
    ) {
      add(
        errors,
        "MERCHANDISING_ROLLBACK_SOURCE_MISMATCH",
        "reversibility.merchandisingRollback.conflictGuard.sourceActionId",
        "rollback conflict guard must reference this rank Action",
      );
    }
  }

  const relationshipTypeByAction: Readonly<Record<string,string>> = {
    "merchandising.promote_substitute": "SUBSTITUTE",
    "merchandising.set_cross_sell": "CROSS_SELL",
    "merchandising.set_upsell": "UPSELL",
  };
  const expectedRelationshipType = relationshipTypeByAction[String(input.actionType)];
  if (expectedRelationshipType) {
    if (
      !record(input.target) ||
      input.target.kind !== "merchandising_relationship" ||
      !nonEmpty(input.target.relationshipId) ||
      !MERCHANDISING_RELATIONSHIP_ID_PATTERN.test(input.target.relationshipId)
    ) {
      add(
        errors,
        "MERCHANDISING_RELATIONSHIP_ACTION_REQUIRES_RELATIONSHIP_TARGET",
        "target",
        "relationship Action requires stable merchrel_* target",
      );
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "merchandising_relationship" &&
      input.parameters.relationshipType !== expectedRelationshipType
    ) {
      add(
        errors,
        "MERCHANDISING_RELATIONSHIP_TYPE_MISMATCH",
        "parameters.relationshipType",
        "relationship type does not match action type",
      );
    }
  }

  if (input.actionType === "merchandising.remove_placement") {
    if (
      !record(input.target) ||
      input.target.kind !== "merchandising_placement" ||
      !nonEmpty(input.target.placementId) ||
      !MERCHANDISING_PLACEMENT_ID_PATTERN.test(input.target.placementId)
    ) {
      add(
        errors,
        "MERCHANDISING_REMOVE_PLACEMENT_REQUIRES_PLACEMENT_TARGET",
        "target",
        "remove placement requires stable merchplace_* target",
      );
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "merchandising_remove_placement" &&
      input.parameters.placementId !== input.target.placementId
    ) {
      add(
        errors,
        "MERCHANDISING_PLACEMENT_ID_MISMATCH",
        "parameters.placementId",
        "placement ID must match Action target",
      );
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(
        errors,
        "MERCHANDISING_REMOVE_PLACEMENT_MUST_BE_INSTANTANEOUS",
        "duration",
        "placement removal is an instantaneous state change",
      );
    }
  }

  if (input.actionType === "merchandising.remove_relationship") {
    if (
      !record(input.target) ||
      input.target.kind !== "merchandising_relationship" ||
      !nonEmpty(input.target.relationshipId) ||
      !MERCHANDISING_RELATIONSHIP_ID_PATTERN.test(input.target.relationshipId)
    ) {
      add(
        errors,
        "MERCHANDISING_REMOVE_RELATIONSHIP_REQUIRES_RELATIONSHIP_TARGET",
        "target",
        "remove relationship requires stable merchrel_* target",
      );
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "merchandising_remove_relationship" &&
      input.parameters.relationshipId !== input.target.relationshipId
    ) {
      add(
        errors,
        "MERCHANDISING_RELATIONSHIP_ID_MISMATCH",
        "parameters.relationshipId",
        "relationship ID must match Action target",
      );
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(
        errors,
        "MERCHANDISING_REMOVE_RELATIONSHIP_MUST_BE_INSTANTANEOUS",
        "duration",
        "relationship removal is an instantaneous state change",
      );
    }
  }

  if (input.actionType === "merchandising.rollback_rank") {
    if (!record(input.parameters) || input.parameters.kind !== "merchandising_rank_rollback") return;
    if (!nonEmpty(input.reversalOfActionId)) {
      add(
        errors,
        "MERCHANDISING_ROLLBACK_REQUIRES_REVERSAL_REFERENCE",
        "reversalOfActionId",
        "rank rollback must reference original rank Action",
      );
    } else if (input.reversalOfActionId !== input.parameters.originalActionId) {
      add(
        errors,
        "MERCHANDISING_ROLLBACK_ORIGINAL_ACTION_MISMATCH",
        "reversalOfActionId",
        "rollback references must identify the same original Action",
      );
    }
  }
}


function validateInventoryActionSemantics(
  input: any,
  errors: ActionValidationIssue[],
): void {
  if (input.actionType === "inventory.reorder") {
    if (!record(input.target) || input.target.kind !== "sku") {
      add(errors,"INVENTORY_REORDER_REQUIRES_SKU_TARGET","target.kind","reorder must target a physical SKU");
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "inventory_reorder" &&
      record(input.parameters.reorder)
    ) {
      if (
        canonicalRuntimeKey(input.parameters.reorder.sku) !==
        canonicalRuntimeKey(input.target)
      ) {
        add(errors,"INVENTORY_REORDER_SKU_TARGET_MISMATCH","parameters.reorder.sku","reorder SKU must match Action target");
      }
      if (
        record(input.timing) &&
        record(input.timing.effectiveStart) &&
        input.timing.effectiveStart.kind === "known" &&
        typeof input.parameters.reorder.orderPlacementTime === "string" &&
        input.timing.effectiveStart.at !==
          input.parameters.reorder.orderPlacementTime
      ) {
        add(errors,"INVENTORY_ORDER_TIME_MISMATCH","parameters.reorder.orderPlacementTime","order placement time must match Action effective start");
      }
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(errors,"INVENTORY_REORDER_MUST_BE_INSTANTANEOUS_DECISION","duration","reorder Action represents order placement, not future receipt");
    }
  }

  if (input.actionType === "inventory.set_safety_stock") {
    if (
      !record(input.parameters) ||
      input.parameters.kind !== "inventory_policy_control" ||
      !record(input.parameters.policy) ||
      input.parameters.policy.kind !== "SAFETY_STOCK"
    ) {
      add(errors,"INVENTORY_POLICY_TYPE_MISMATCH","parameters.policy.kind","set_safety_stock requires SAFETY_STOCK policy");
    }
  }

  if (input.actionType === "inventory.set_reorder_point") {
    if (
      !record(input.parameters) ||
      input.parameters.kind !== "inventory_policy_control" ||
      !record(input.parameters.policy) ||
      input.parameters.policy.kind !== "REORDER_POINT"
    ) {
      add(errors,"INVENTORY_POLICY_TYPE_MISMATCH","parameters.policy.kind","set_reorder_point requires REORDER_POINT policy");
    }
  }

  const rollbackPolicyActions = [
    "inventory.set_safety_stock",
    "inventory.set_reorder_point",
    "inventory.set_backorder_policy",
  ];
  if (rollbackPolicyActions.includes(String(input.actionType))) {
    const temporary =
      record(input.duration) && input.duration.kind === "temporary";
    if (
      temporary &&
      (!record(input.reversibility) ||
        !record(input.reversibility.inventoryRollback) ||
        input.reversibility.inventoryRollback.available !== true)
    ) {
      add(
        errors,
        "TEMPORARY_INVENTORY_POLICY_REQUIRES_SAFE_ROLLBACK",
        "reversibility.inventoryRollback",
        "temporary inventory policy change requires conflict-safe rollback",
      );
    }
    if (
      record(input.reversibility) &&
      record(input.reversibility.inventoryRollback) &&
      input.reversibility.inventoryRollback.available === true &&
      record(input.reversibility.inventoryRollback.conflictGuard) &&
      input.reversibility.inventoryRollback.conflictGuard.sourceActionId !==
        input.actionId
    ) {
      add(
        errors,
        "INVENTORY_ROLLBACK_SOURCE_MISMATCH",
        "reversibility.inventoryRollback.conflictGuard.sourceActionId",
        "inventory rollback must reference this policy Action",
      );
    }
  }

  if (
    (input.actionType === "inventory.clearance" ||
      input.actionType === "inventory.accelerate_excess_stock") &&
    record(input.parameters) &&
    canonicalRuntimeKey(input.parameters.target) !==
      canonicalRuntimeKey(input.target)
  ) {
    add(
      errors,
      "INVENTORY_STRATEGY_TARGET_MISMATCH",
      "parameters.target",
      "inventory strategy target must match Action target",
    );
  }

  if (
    input.actionType === "inventory.protect_inventory" &&
    record(input.parameters) &&
    input.parameters.kind === "inventory_protection" &&
    Array.isArray(input.parameters.coordinatedActionIds) &&
    input.parameters.coordinatedActionIds.includes(input.actionId)
  ) {
    add(
      errors,
      "INVENTORY_COORDINATION_SELF_REFERENCE",
      "parameters.coordinatedActionIds",
      "inventory strategy cannot coordinate itself",
    );
  }

  if (
    (input.actionType === "inventory.clearance" ||
      input.actionType === "inventory.accelerate_excess_stock") &&
    record(input.parameters) &&
    Array.isArray(input.parameters.coordinatedActionIds) &&
    input.parameters.coordinatedActionIds.includes(input.actionId)
  ) {
    add(
      errors,
      "INVENTORY_COORDINATION_SELF_REFERENCE",
      "parameters.coordinatedActionIds",
      "inventory strategy cannot coordinate itself",
    );
  }

  if (input.actionType === "inventory.rollback_policy") {
    if (
      !record(input.parameters) ||
      input.parameters.kind !== "inventory_policy_rollback"
    ) return;

    if (!nonEmpty(input.reversalOfActionId)) {
      add(
        errors,
        "INVENTORY_ROLLBACK_REQUIRES_REVERSAL_REFERENCE",
        "reversalOfActionId",
        "rollback Action must reference original inventory policy Action",
      );
    } else if (
      input.reversalOfActionId !== input.parameters.originalActionId
    ) {
      add(
        errors,
        "INVENTORY_ROLLBACK_ORIGINAL_ACTION_MISMATCH",
        "reversalOfActionId",
        "rollback references must identify the same original inventory Action",
      );
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(
        errors,
        "INVENTORY_ROLLBACK_MUST_BE_INSTANTANEOUS",
        "duration",
        "inventory rollback is an instantaneous policy state change",
      );
    }
  }
}


function validateCroActionSemantics(
  input: any,
  errors: ActionValidationIssue[],
): void {
  const croTypes = new Set([
    "cro.modify_experience",
    "cro.add_element",
    "cro.remove_element",
    "cro.reorder_elements",
    "cro.modify_interaction",
    "cro.modify_navigation",
    "cro.modify_search",
    "cro.modify_checkout",
    "cro.rollback_experience",
  ]);
  if (!croTypes.has(String(input.actionType))) return;

  if (
    !record(input.target) ||
    input.target.kind !== "cro_experience" ||
    !nonEmpty(input.target.experienceId) ||
    !CRO_EXPERIENCE_ID_PATTERN.test(input.target.experienceId)
  ) {
    add(
      errors,
      "CRO_ACTION_REQUIRES_EXPERIENCE_TARGET",
      "target",
      "CRO Actions require stable croexp_* experience target",
    );
  }

  if (input.actionType === "cro.rollback_experience") {
    if (!record(input.parameters) || input.parameters.kind !== "cro_rollback") return;
    if (!nonEmpty(input.reversalOfActionId)) {
      add(errors,"CRO_ROLLBACK_REQUIRES_REVERSAL_REFERENCE","reversalOfActionId","rollback must reference original CRO Action");
    } else if (input.reversalOfActionId !== input.parameters.originalActionId) {
      add(errors,"CRO_ROLLBACK_ORIGINAL_ACTION_MISMATCH","reversalOfActionId","rollback references must identify the same original CRO Action");
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(errors,"CRO_ROLLBACK_MUST_BE_INSTANTANEOUS","duration","CRO rollback is an instantaneous experience-state change");
    }
    return;
  }

  if (!record(input.parameters) || input.parameters.kind !== "cro_intervention") return;

  const deviceDimension =
    record(input.scope) && Array.isArray(input.scope.dimensions)
      ? input.scope.dimensions.find(
          (dimension: unknown) =>
            record(dimension) && dimension.kind === "device",
        )
      : undefined;
  if (input.parameters.device === "MOBILE") {
    if (
      !record(deviceDimension) ||
      !Array.isArray(deviceDimension.devices) ||
      deviceDimension.devices.length !== 1 ||
      deviceDimension.devices[0] !== "mobile"
    ) {
      add(
        errors,
        "CRO_DEVICE_SCOPE_MISMATCH",
        "scope",
        "MOBILE CRO Action requires mobile-only device scope",
      );
    }
  } else if (input.parameters.device === "DESKTOP") {
    if (
      !record(deviceDimension) ||
      !Array.isArray(deviceDimension.devices) ||
      deviceDimension.devices.length !== 1 ||
      deviceDimension.devices[0] !== "desktop"
    ) {
      add(
        errors,
        "CRO_DEVICE_SCOPE_MISMATCH",
        "scope",
        "DESKTOP CRO Action requires desktop-only device scope",
      );
    }
  } else if (deviceDimension !== undefined) {
    add(
      errors,
      "CRO_DEVICE_SCOPE_MISMATCH",
      "scope",
      "ALL_DEVICES CRO Action must not silently restrict canonical device scope",
    );
  }

  const expected: Readonly<Record<string, readonly string[]>> = {
    "cro.modify_experience": ["MODIFY_PRESENTATION","MODIFY_PERFORMANCE"],
    "cro.add_element": ["ADD"],
    "cro.remove_element": ["REMOVE"],
    "cro.reorder_elements": ["REORDER"],
    "cro.modify_interaction": ["MODIFY_INTERACTION"],
    "cro.modify_navigation": ["MODIFY_NAVIGATION"],
    "cro.modify_search": ["MODIFY_SEARCH"],
    "cro.modify_checkout": ["MODIFY_CHECKOUT"],
  };
  if (!expected[String(input.actionType)]?.includes(String(input.parameters.intervention))) {
    add(
      errors,
      "CRO_ACTION_INTERVENTION_MISMATCH",
      "parameters.intervention",
      "intervention kind does not match CRO action type",
    );
  }

  if (
    input.actionType === "cro.modify_navigation" &&
    record(input.parameters.component) &&
    input.parameters.component.component !== "NAVIGATION"
  ) {
    add(errors,"CRO_NAVIGATION_COMPONENT_MISMATCH","parameters.component","navigation Action must target NAVIGATION");
  }
  if (
    input.actionType === "cro.modify_search" &&
    input.parameters.surface !== "SITE_SEARCH"
  ) {
    add(errors,"CRO_SEARCH_SURFACE_MISMATCH","parameters.surface","search CRO Action requires SITE_SEARCH surface");
  }
  if (
    input.actionType === "cro.modify_checkout" &&
    input.parameters.surface !== "CHECKOUT"
  ) {
    add(errors,"CRO_CHECKOUT_SURFACE_MISMATCH","parameters.surface","checkout CRO Action requires CHECKOUT surface");
  }

  if (
    input.parameters.intervention === "MODIFY_PERFORMANCE" &&
    (!Array.isArray(input.parameters.modifiableDimensions) ||
      !input.parameters.modifiableDimensions.some((dimension: unknown) =>
        ["LOAD_PERFORMANCE","INTERACTION_LATENCY","IMAGE_LOADING"].includes(String(dimension)),
      ))
  ) {
    add(
      errors,
      "CRO_PERFORMANCE_DIMENSION_REQUIRED",
      "parameters.modifiableDimensions",
      "performance intervention requires a technical performance dimension",
    );
  }

  const temporary =
    record(input.duration) && input.duration.kind === "temporary";
  if (
    temporary &&
    (!record(input.reversibility) ||
      !record(input.reversibility.croRollback) ||
      input.reversibility.croRollback.available !== true)
  ) {
    add(
      errors,
      "TEMPORARY_CRO_REQUIRES_SAFE_ROLLBACK",
      "reversibility.croRollback",
      "temporary CRO intervention requires conflict-protected rollback",
    );
  }
  if (
    record(input.reversibility) &&
    record(input.reversibility.croRollback) &&
    input.reversibility.croRollback.available === true &&
    record(input.reversibility.croRollback.conflictGuard) &&
    input.reversibility.croRollback.conflictGuard.sourceActionId !==
      input.actionId
  ) {
    add(
      errors,
      "CRO_ROLLBACK_SOURCE_MISMATCH",
      "reversibility.croRollback.conflictGuard.sourceActionId",
      "CRO rollback must reference this intervention Action",
    );
  }

  if (
    record(input.reversibility) &&
    (
      input.reversibility.pricingRollback !== undefined ||
      input.reversibility.shippingRollback !== undefined ||
      input.reversibility.merchandisingRollback !== undefined ||
      input.reversibility.inventoryRollback !== undefined
    )
  ) {
    add(
      errors,
      "CRO_CANNOT_USE_OTHER_FAMILY_ROLLBACK",
      "reversibility",
      "CRO Actions must use CRO rollback semantics only",
    );
  }
}


function validateLifecycleActionSemantics(
  input: any,
  errors: ActionValidationIssue[],
): void {
  const lifecycleTypes = new Set([
    "lifecycle.send",
    "lifecycle.start_flow",
    "lifecycle.stop_flow",
    "lifecycle.modify_flow",
    "lifecycle.adjust_frequency",
    "lifecycle.target_segment",
    "lifecycle.rollback_policy",
  ]);
  if (!lifecycleTypes.has(String(input.actionType))) return;

  if (input.schemaVersion === "1.8.0") {
    if (
      record(input.target) &&
      input.target.kind === "lifecycle_flow" &&
      (!nonEmpty(input.target.flowId) ||
        !LIFECYCLE_FLOW_ID_PATTERN.test(String(input.target.flowId)))
    ) {
      add(errors,"INVALID_LIFECYCLE_FLOW_ID","target.flowId","flowId must begin lifecycleflow_");
    }
    if (
      record(input.target) &&
      input.target.kind === "lifecycle_contact_policy" &&
      (!nonEmpty(input.target.contactPolicyId) ||
        !LIFECYCLE_POLICY_ID_PATTERN.test(String(input.target.contactPolicyId)))
    ) {
      add(errors,"INVALID_LIFECYCLE_POLICY_ID","target.contactPolicyId","contactPolicyId must begin lifecyclepolicy_");
    }
  }

  if (input.actionType === "lifecycle.send") {
    if (!record(input.parameters) || input.parameters.kind !== "lifecycle_send") return;
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(errors,"LIFECYCLE_SEND_MUST_BE_INSTANTANEOUS","duration","one-time send is an explicit communication event");
    }
    if (
      record(input.parameters.timing) &&
      input.parameters.timing.kind === "ABSOLUTE_TIME" &&
      record(input.timing) &&
      record(input.timing.effectiveStart) &&
      input.timing.effectiveStart.kind === "known" &&
      input.timing.effectiveStart.at !== input.parameters.timing.at
    ) {
      add(errors,"LIFECYCLE_SEND_TIME_MISMATCH","timing.effectiveStart","Action effective time must match absolute send time");
    }
    if (
      record(input.parameters.timing) &&
      input.parameters.timing.kind === "RELATIVE_TO_EVENT" &&
      record(input.timing) &&
      record(input.timing.effectiveStart) &&
      input.timing.effectiveStart.kind === "known"
    ) {
      add(errors,"LIFECYCLE_RELATIVE_SEND_CANNOT_PRETEND_RESOLVED_TIME","timing.effectiveStart","event-relative send must remain unresolved until its legitimate event boundary");
    }
  }

  if (input.actionType === "lifecycle.start_flow") {
    if (!record(input.target) || input.target.kind !== "lifecycle_flow") {
      add(errors,"LIFECYCLE_FLOW_ACTION_REQUIRES_FLOW_TARGET","target.kind","start_flow requires lifecycle_flow target");
      return;
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "lifecycle_flow_start" &&
      record(input.parameters.definition) &&
      input.parameters.definition.flowId !== input.target.flowId
    ) {
      add(errors,"LIFECYCLE_FLOW_ID_MISMATCH","parameters.definition.flowId","flow definition ID must match Action target");
    }
    if (record(input.duration) && input.duration.kind === "instantaneous") {
      add(errors,"LIFECYCLE_FLOW_START_CANNOT_BE_INSTANTANEOUS","duration","flow is an ongoing communication policy");
    }
  }

  if (input.actionType === "lifecycle.stop_flow") {
    if (!record(input.target) || input.target.kind !== "lifecycle_flow") {
      add(errors,"LIFECYCLE_FLOW_ACTION_REQUIRES_FLOW_TARGET","target.kind","stop_flow requires lifecycle_flow target");
      return;
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "lifecycle_flow_stop" &&
      input.parameters.targetFlowId !== input.target.flowId
    ) {
      add(errors,"LIFECYCLE_FLOW_ID_MISMATCH","parameters.targetFlowId","target flow ID must match Action target");
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(errors,"LIFECYCLE_FLOW_STOP_MUST_BE_INSTANTANEOUS","duration","stopping a flow is an instantaneous policy-state change");
    }
  }

  if (input.actionType === "lifecycle.modify_flow") {
    if (!record(input.target) || input.target.kind !== "lifecycle_flow") {
      add(errors,"LIFECYCLE_FLOW_ACTION_REQUIRES_FLOW_TARGET","target.kind","modify_flow requires lifecycle_flow target");
      return;
    }
    if (
      record(input.parameters) &&
      input.parameters.kind === "lifecycle_flow_modify" &&
      input.parameters.targetFlowId !== input.target.flowId
    ) {
      add(errors,"LIFECYCLE_FLOW_ID_MISMATCH","parameters.targetFlowId","target flow ID must match Action target");
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(errors,"LIFECYCLE_FLOW_MODIFY_MUST_BE_INSTANTANEOUS","duration","modifying an existing flow is an instantaneous policy-state change");
    }
  }

  if (
    input.actionType === "lifecycle.adjust_frequency" &&
    input.schemaVersion === "1.8.0"
  ) {
    if (
      !record(input.parameters) ||
      input.parameters.kind !== "frequency_adjustment" ||
      input.parameters.policy === undefined
    ) {
      add(errors,"LIFECYCLE_STRUCTURED_FREQUENCY_POLICY_REQUIRED","parameters.policy","schema 1.8 lifecycle frequency Action requires structured policy semantics");
      return;
    }
    const temporary = record(input.duration) && input.duration.kind === "temporary";
    if (
      temporary &&
      (!record(input.reversibility) ||
        !record(input.reversibility.lifecycleRollback) ||
        input.reversibility.lifecycleRollback.available !== true)
    ) {
      add(errors,"TEMPORARY_LIFECYCLE_POLICY_REQUIRES_SAFE_ROLLBACK","reversibility.lifecycleRollback","temporary lifecycle frequency/contact policy requires conflict-safe rollback");
    }
    if (
      record(input.reversibility) &&
      record(input.reversibility.lifecycleRollback) &&
      input.reversibility.lifecycleRollback.available === true &&
      record(input.reversibility.lifecycleRollback.conflictGuard) &&
      input.reversibility.lifecycleRollback.conflictGuard.sourceActionId !== input.actionId
    ) {
      add(errors,"LIFECYCLE_ROLLBACK_SOURCE_MISMATCH","reversibility.lifecycleRollback.conflictGuard.sourceActionId","lifecycle rollback must reference this policy Action");
    }
  }

  if (input.actionType === "lifecycle.rollback_policy") {
    if (!record(input.target) || input.target.kind !== "lifecycle_contact_policy") {
      add(errors,"LIFECYCLE_ROLLBACK_REQUIRES_POLICY_TARGET","target.kind","rollback_policy requires lifecycle_contact_policy target");
    }
    if (!record(input.parameters) || input.parameters.kind !== "lifecycle_policy_rollback") return;
    if (!nonEmpty(input.reversalOfActionId)) {
      add(errors,"LIFECYCLE_ROLLBACK_REQUIRES_REVERSAL_REFERENCE","reversalOfActionId","rollback must reference original lifecycle policy Action");
    } else if (input.reversalOfActionId !== input.parameters.originalActionId) {
      add(errors,"LIFECYCLE_ROLLBACK_ORIGINAL_ACTION_MISMATCH","reversalOfActionId","rollback references must identify the same original lifecycle Action");
    }
    if (!record(input.duration) || input.duration.kind !== "instantaneous") {
      add(errors,"LIFECYCLE_ROLLBACK_MUST_BE_INSTANTANEOUS","duration","lifecycle rollback is an instantaneous policy-state change");
    }
  }

  if (
    record(input.parameters) &&
    (input.parameters.kind === "lifecycle_send" ||
      input.parameters.kind === "lifecycle_flow_start") &&
    Array.isArray(input.parameters.coordinatedActionIds) &&
    input.parameters.coordinatedActionIds.includes(input.actionId)
  ) {
    add(errors,"LIFECYCLE_COORDINATION_SELF_REFERENCE","parameters.coordinatedActionIds","lifecycle Action cannot coordinate itself");
  }

  if (
    record(input.reversibility) &&
    (
      input.reversibility.pricingRollback !== undefined ||
      input.reversibility.shippingRollback !== undefined ||
      input.reversibility.merchandisingRollback !== undefined ||
      input.reversibility.inventoryRollback !== undefined ||
      input.reversibility.croRollback !== undefined
    )
  ) {
    add(errors,"LIFECYCLE_CANNOT_USE_OTHER_FAMILY_ROLLBACK","reversibility","lifecycle Actions must use lifecycle rollback semantics only");
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
  validatePromotionActionSemantics(input, errors);
  validateShippingActionSemantics(input, errors);
  validateMerchandisingActionSemantics(input, errors);
  validateInventoryActionSemantics(input, errors);
  validateCroActionSemantics(input, errors);
  validateLifecycleActionSemantics(input, errors);

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
