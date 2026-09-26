Warning: truncated output (original token count: 65028)
Total output lines: 7305

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
    add(errors, "INVALID_PROMOTION_USAGE_LIMITS",…35028 tokens truncated…ust use reversal kind none",
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
