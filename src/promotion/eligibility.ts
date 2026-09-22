import type {
  Action,
  PromotionBundleComponent,
  PromotionDefinition,
  PromotionEntitySelector,
  PromotionPurchaseRequirement,
} from "../action_ontology/types.js";
import type {
  PromotionCartFacts,
  PromotionCartLine,
  PromotionEligibilityContext,
  PromotionEligibilityDecision,
  PromotionProductFacts,
} from "./types.js";

type Tri = true | false | "unknown";

function selectorKey(selector: PromotionEntitySelector): string {
  switch (selector.kind) {
    case "sku":
      return "sku:" + selector.skuId;
    case "product":
      return "product:" + selector.productId;
    case "category":
      return "category:" + selector.categoryId;
    case "collection":
      return "collection:" + selector.collectionId;
    case "product_set":
      return "product_set:" + selector.productSetId;
    case "brand":
      return "brand:" + selector.brandId;
  }
}

function matchSelectorToProduct(
  selector: PromotionEntitySelector,
  product: PromotionProductFacts | undefined,
): Tri {
  if (!product) return "unknown";
  switch (selector.kind) {
    case "sku":
      return product.skuId === undefined ? "unknown" : product.skuId === selector.skuId;
    case "product":
      return product.productId === undefined
        ? "unknown"
        : product.productId === selector.productId;
    case "category":
      return product.categoryIds === undefined
        ? "unknown"
        : product.categoryIds.includes(selector.categoryId);
    case "collection":
      return product.collectionIds === undefined
        ? "unknown"
        : product.collectionIds.includes(selector.collectionId);
    case "product_set":
      return product.productSetIds === undefined
        ? "unknown"
        : product.productSetIds.includes(selector.productSetId);
    case "brand":
      return product.brandId === undefined
        ? "unknown"
        : product.brandId === selector.brandId;
  }
}

function lineMatchesSelector(
  selector: PromotionEntitySelector,
  line: PromotionCartLine,
): Tri {
  return matchSelectorToProduct(selector, line);
}

function quantityForSelector(
  selector: PromotionEntitySelector,
  cart: PromotionCartFacts | undefined,
): number | "unknown" {
  if (!cart) return "unknown";
  let quantity = 0;
  let unknown = false;
  for (const line of cart.lines) {
    const match = lineMatchesSelector(selector, line);
    if (match === true) quantity += line.quantity;
    if (match === "unknown") unknown = true;
  }
  if (quantity > 0) return quantity;
  return unknown ? "unknown" : 0;
}

function bundleQualified(
  components: readonly PromotionBundleComponent[],
  cart: PromotionCartFacts | undefined,
): Tri {
  if (!cart) return "unknown";
  let hasUnknown = false;
  for (const component of components) {
    const selector: PromotionEntitySelector =
      component.target.kind === "sku"
        ? {
            kind: "sku",
            skuId: component.target.skuId,
            ...(component.target.productId
              ? { productId: component.target.productId }
              : {}),
          }
        : { kind: "product", productId: component.target.productId };
    const quantity = quantityForSelector(selector, cart);
    if (quantity === "unknown") {
      hasUnknown = true;
    } else if (quantity < component.quantity) {
      return false;
    }
  }
  return hasUnknown ? "unknown" : true;
}

function evaluateProductScope(
  definition: PromotionDefinition,
  context: PromotionEligibilityContext,
): PromotionEligibilityDecision | undefined {
  if (definition.applicationScope.kind !== "PRODUCT_SCOPE") return undefined;
  const scope = definition.applicationScope.products;

  const includeMatches = scope.include.map((selector) =>
    matchSelectorToProduct(selector, context.product),
  );
  if (!includeMatches.includes(true)) {
    if (includeMatches.includes("unknown")) {
      return {
        status: "unknown",
        reasonCodes: ["PROMOTION_INCLUDE_MEMBERSHIP_UNKNOWN"],
        missingInformation: ["product inclusion membership"],
      };
    }
    return {
      status: "ineligible",
      reasonCodes: ["PRODUCT_NOT_INCLUDED"],
      missingInformation: [],
    };
  }

  const excludeMatches = scope.exclude.map((selector) =>
    matchSelectorToProduct(selector, context.product),
  );
  if (excludeMatches.includes(true)) {
    return {
      status: "ineligible",
      reasonCodes: ["PRODUCT_EXCLUDED"],
      missingInformation: [],
    };
  }
  if (excludeMatches.includes("unknown")) {
    return {
      status: "unknown",
      reasonCodes: ["PROMOTION_EXCLUSION_MEMBERSHIP_UNKNOWN"],
      missingInformation: ["product exclusion membership"],
    };
  }

  for (const condition of scope.conditions) {
    if (condition.kind === "NOT_CLEARANCE") {
      if (context.product?.isClearance === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["CLEARANCE_STATUS_UNKNOWN"],
          missingInformation: ["clearance status"],
        };
      }
      if (context.product.isClearance) {
        return {
          status: "ineligible",
          reasonCodes: ["CLEARANCE_PRODUCT_EXCLUDED"],
          missingInformation: [],
        };
      }
    } else if (condition.kind === "BRAND_NOT") {
      if (context.product?.brandId === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["BRAND_STATUS_UNKNOWN"],
          missingInformation: ["brand"],
        };
      }
      if (context.product.brandId === condition.brandId) {
        return {
          status: "ineligible",
          reasonCodes: ["EXCLUDED_BRAND"],
          missingInformation: [],
        };
      }
    } else {
      const key = selectorKey(condition.target);
      const units = context.inventoryUnitsBySelector?.[key];
      if (units === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["INVENTORY_STATUS_UNKNOWN"],
          missingInformation: [key],
        };
      }
      if (units < condition.units) {
        return {
          status: "ineligible",
          reasonCodes: ["INSUFFICIENT_INVENTORY"],
          missingInformation: [],
        };
      }
    }
  }

  return undefined;
}

function evaluateCustomer(
  definition: PromotionDefinition,
  context: PromotionEligibilityContext,
): PromotionEligibilityDecision | undefined {
  const rule = definition.customerEligibility;
  if (rule.kind === "ALL_CUSTOMERS") return undefined;
  const customer = context.customer;
  if (!customer) {
    return {
      status: "unknown",
      reasonCodes: ["CUSTOMER_CLASSIFICATION_UNKNOWN"],
      missingInformation: ["customer classification"],
    };
  }

  if (rule.kind === "NEW_CUSTOMERS") {
    if (customer.lifecycle === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["CUSTOMER_LIFECYCLE_UNKNOWN"],
        missingInformation: ["customer lifecycle"],
      };
    }
    return customer.lifecycle === "new"
      ? undefined
      : { status: "ineligible", reasonCodes: ["NOT_NEW_CUSTOMER"], missingInformation: [] };
  }
  if (rule.kind === "RETURNING_CUSTOMERS") {
    if (customer.lifecycle === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["CUSTOMER_LIFECYCLE_UNKNOWN"],
        missingInformation: ["customer lifecycle"],
      };
    }
    return customer.lifecycle === "returning"
      ? undefined
      : { status: "ineligible", reasonCodes: ["NOT_RETURNING_CUSTOMER"], missingInformation: [] };
  }
  if (rule.kind === "EMAIL_SUBSCRIBERS") {
    if (customer.emailSubscriber === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["EMAIL_SUBSCRIBER_STATUS_UNKNOWN"],
        missingInformation: ["email subscriber status"],
      };
    }
    return customer.emailSubscriber
      ? undefined
      : { status: "ineligible", reasonCodes: ["NOT_EMAIL_SUBSCRIBER"], missingInformation: [] };
  }
  if (rule.kind === "CUSTOMER_SEGMENT") {
    if (customer.segmentIds === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["CUSTOMER_SEGMENT_UNKNOWN"],
        missingInformation: [rule.segmentId],
      };
    }
    return customer.segmentIds.includes(rule.segmentId)
      ? undefined
      : { status: "ineligible", reasonCodes: ["CUSTOMER_SEGMENT_NOT_ELIGIBLE"], missingInformation: [] };
  }
  if (customer.loyaltySegmentIds === undefined) {
    return {
      status: "unknown",
      reasonCodes: ["LOYALTY_SEGMENT_UNKNOWN"],
      missingInformation: [rule.segmentId],
    };
  }
  return customer.loyaltySegmentIds.includes(rule.segmentId)
    ? undefined
    : { status: "ineligible", reasonCodes: ["LOYALTY_SEGMENT_NOT_ELIGIBLE"], missingInformation: [] };
}

function evaluateRequirement(
  requirement: PromotionPurchaseRequirement,
  context: PromotionEligibilityContext,
): PromotionEligibilityDecision | undefined {
  const cart = context.cart;
  if (requirement.kind === "MIN_ORDER_VALUE") {
    if (!cart) {
      return {
        status: "unknown",
        reasonCodes: ["CART_VALUE_UNKNOWN"],
        missingInformation: ["cart subtotal"],
      };
    }
    if (cart.subtotal.currency !== requirement.value.currency) {
      return {
        status: "unknown",
        reasonCodes: ["CART_CURRENCY_MISMATCH"],
        missingInformation: ["approved currency conversion"],
      };
    }
    return cart.subtotal.amountMinor >= requirement.value.amountMinor
      ? undefined
      : { status: "ineligible", reasonCodes: ["MIN_ORDER_VALUE_NOT_MET"], missingInformation: [] };
  }

  if (requirement.kind === "MIN_QUANTITY") {
    if (!cart) {
      return {
        status: "unknown",
        reasonCodes: ["CART_QUANTITY_UNKNOWN"],
        missingInformation: ["cart lines"],
      };
    }
    if (!requirement.target) {
      const quantity = cart.lines.reduce((sum, line) => sum + line.quantity, 0);
      return quantity >= requirement.quantity
        ? undefined
        : { status: "ineligible", reasonCodes: ["MIN_QUANTITY_NOT_MET"], missingInformation: [] };
    }
    const quantity = quantityForSelector(requirement.target, cart);
    if (quantity === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["CART_TARGET_MEMBERSHIP_UNKNOWN"],
        missingInformation: [selectorKey(requirement.target)],
      };
    }
    return quantity >= requirement.quantity
      ? undefined
      : { status: "ineligible", reasonCodes: ["MIN_QUANTITY_NOT_MET"], missingInformation: [] };
  }

  if (requirement.kind === "REQUIRED_TARGET") {
    const quantity = quantityForSelector(requirement.target, cart);
    if (quantity === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["REQUIRED_TARGET_UNKNOWN"],
        missingInformation: [selectorKey(requirement.target)],
      };
    }
    return quantity >= requirement.quantity
      ? undefined
      : { status: "ineligible", reasonCodes: ["REQUIRED_TARGET_NOT_PRESENT"], missingInformation: [] };
  }

  const qualified = bundleQualified(requirement.components, cart);
  if (qualified === "unknown") {
    return {
      status: "unknown",
      reasonCodes: ["BUNDLE_QUALIFICATION_UNKNOWN"],
      missingInformation: ["bundle cart composition"],
    };
  }
  return qualified
    ? undefined
    : { status: "ineligible", reasonCodes: ["BUNDLE_NOT_QUALIFIED"], missingInformation: [] };
}

function evaluateUsage(
  definition: PromotionDefinition,
  context: PromotionEligibilityContext,
): PromotionEligibilityDecision | undefined {
  const limits = definition.usageLimits;
  const redemption = context.redemption;

  if (limits.maxTotalRedemptions !== undefined) {
    if (redemption?.totalRedemptions === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["TOTAL_REDEMPTIONS_UNKNOWN"],
        missingInformation: ["total redemptions"],
      };
    }
    if (redemption.totalRedemptions >= limits.maxTotalRedemptions) {
      return {
        status: "ineligible",
        reasonCodes: ["TOTAL_REDEMPTION_LIMIT_REACHED"],
        missingInformation: [],
      };
    }
  }

  if (limits.maxRedemptionsPerCustomer !== undefined) {
    if (redemption?.customerRedemptions === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["CUSTOMER_REDEMPTIONS_UNKNOWN"],
        missingInformation: ["customer redemptions"],
      };
    }
    if (redemption.customerRedemptions >= limits.maxRedemptionsPerCustomer) {
      return {
        status: "ineligible",
        reasonCodes: ["CUSTOMER_REDEMPTION_LIMIT_REACHED"],
        missingInformation: [],
      };
    }
  }

  if (limits.maxPromotionalExposure !== undefined) {
    if (!redemption?.promotionalExposure) {
      return {
        status: "unknown",
        reasonCodes: ["PROMOTIONAL_EXPOSURE_UNKNOWN"],
        missingInformation: ["promotional exposure"],
      };
    }
    if (
      redemption.promotionalExposure.currency !==
      limits.maxPromotionalExposure.currency
    ) {
      return {
        status: "unknown",
        reasonCodes: ["PROMOTIONAL_EXPOSURE_CURRENCY_MISMATCH"],
        missingInformation: ["approved currency conversion"],
      };
    }
    if (
      redemption.promotionalExposure.amountMinor >=
      limits.maxPromotionalExposure.amountMinor
    ) {
      return {
        status: "ineligible",
        reasonCodes: ["PROMOTIONAL_EXPOSURE_LIMIT_REACHED"],
        missingInformation: [],
      };
    }
  }

  return undefined;
}

function evaluateHardConstraints(
  action: Action,
  context: PromotionEligibilityContext,
): PromotionEligibilityDecision | undefined {
  for (const constraint of action.constraints) {
    if (constraint.constraintClass !== "hard") continue;
    const status = context.hardConstraintResults?.[constraint.constraintId];
    if (status === "violated") {
      return {
        status: "ineligible",
        reasonCodes: ["HARD_CONSTRAINT_VIOLATED:" + constraint.constraintId],
        missingInformation: [],
      };
    }
    if (status === undefined || status === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["HARD_CONSTRAINT_UNKNOWN:" + constraint.constraintId],
        missingInformation: [constraint.constraintId],
      };
    }
  }
  return undefined;
}

export function evaluatePromotionEligibility(
  action: Action,
  context: PromotionEligibilityContext,
): PromotionEligibilityDecision {
  if (
    action.actionType !== "promotion.start" &&
    action.actionType !== "promotion.modify"
  ) {
    return {
      status: "ineligible",
      reasonCodes: ["NOT_PROMOTION_ELIGIBILITY_ACTION"],
      missingInformation: [],
    };
  }
  if (
    action.parameters.kind !== "promotion_start" &&
    action.parameters.kind !== "promotion_modify"
  ) {
    return {
      status: "ineligible",
      reasonCodes: ["INVALID_PROMOTION_PARAMETERS"],
      missingInformation: [],
    };
  }

  const definition = action.parameters.definition;

  const product = evaluateProductScope(definition, context);
  if (product) return product;

  const customer = evaluateCustomer(definition, context);
  if (customer) return customer;

  for (const requirement of definition.purchaseRequirements) {
    const result = evaluateRequirement(requirement, context);
    if (result) return result;
  }

  if (
    definition.mechanism.kind === "BUNDLE_FIXED_PRICE" ||
    definition.mechanism.kind === "BUNDLE_PERCENTAGE_DISCOUNT"
  ) {
    const bundle = bundleQualified(definition.mechanism.components, context.cart);
    if (bundle === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["BUNDLE_QUALIFICATION_UNKNOWN"],
        missingInformation: ["bundle cart composition"],
      };
    }
    if (!bundle) {
      return {
        status: "ineligible",
        reasonCodes: ["BUNDLE_NOT_QUALIFIED"],
        missingInformation: [],
      };
    }
  }
  if (definition.mechanism.kind === "CONDITIONAL_ITEM_DISCOUNT") {
    const bundle = bundleQualified(
      definition.mechanism.qualifyingComponents,
      context.cart,
    );
    if (bundle === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["BUNDLE_QUALIFICATION_UNKNOWN"],
        missingInformation: ["qualifying cart composition"],
      };
    }
    if (!bundle) {
      return {
        status: "ineligible",
        reasonCodes: ["BUNDLE_NOT_QUALIFIED"],
        missingInformation: [],
      };
    }
  }

  const usage = evaluateUsage(definition, context);
  if (usage) return usage;

  const constraints = evaluateHardConstraints(action, context);
  if (constraints) return constraints;

  const active = context.activePromotionTypes ?? [];
  if (definition.stacking.kind === "NON_STACKABLE" && active.length > 0) {
    return {
      status: "ineligible",
      reasonCodes: ["NON_STACKABLE_PROMOTION_CONFLICT"],
      missingInformation: [],
    };
  }
  if (definition.stacking.kind === "STACKABLE_WITH_TYPES") {
    const allowedTypes = definition.stacking.types;
    const disallowed = active.filter(
      (type) => !allowedTypes.includes(type),
    );
    if (disallowed.length > 0) {
      return {
        status: "ineligible",
        reasonCodes: ["STACKING_TYPE_NOT_ALLOWED"],
        missingInformation: [],
      };
    }
  }

  return {
    status: "eligible",
    reasonCodes: [],
    missingInformation: [],
  };
}
