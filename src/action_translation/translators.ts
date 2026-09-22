import type {
  Action,
  ActionTarget,
  PromotionEntitySelector,
} from "../action_ontology/types.js";
import type {
  SimulatorOperation,
  SimulatorScalarValue,
} from "../simulator_intervention/types.js";
import {
  ACTION_TRANSLATION_VERSION,
  type ActionTranslator,
  type AtomicTranslatorResult,
  type TranslationContext,
  type TranslationOrigin,
} from "./types.js";
import {
  buildIntervention,
  prepareEffectiveTime,
  prepareTarget,
  translateOperation,
} from "./helpers.js";
import {
  resolvePricingMembership,
  resolvePromotionMembership,
  resolveSimulatorTarget,
} from "./context.js";

function translated(interventions: AtomicTranslatorResult extends infer _T ? any : never): AtomicTranslatorResult {
  return { status: "TRANSLATED", interventions };
}

function requireTarget(
  action: Action,
  context: TranslationContext,
): ReturnType<typeof prepareTarget> {
  return prepareTarget(action, context);
}

function requireTime(action: Action) {
  return prepareEffectiveTime(action);
}

const budgetTranslator: ActionTranslator = {
  actionType: "advertising.adjust_budget",
  translatorId: "translator.budget.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["advertising_channel", "campaign"],
  requiredCapability: "campaign_budget",
  translate(action, context, origin) {
    if (action.parameters.kind !== "budget_adjustment") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "BUDGET_PARAMETER_MISMATCH",
        message: "Budget translator requires budget_adjustment parameters.",
      };
    }

    const target = requireTarget(action, context);
    if (!target.ok) return target.failure;

    const time = requireTime(action);
    if (!time.ok) return time.failure;

    const operation = translateOperation(
      action,
      context,
      action.parameters.operation,
      "money_rate",
    );
    if (!operation.ok) return operation.failure;

    return {
      status: "TRANSLATED",
      interventions: [
        buildIntervention(
          action,
          origin,
          "translator.budget.v1",
          "budget",
          target.target,
          operation.operation,
        ),
      ],
    };
  },
};

const campaignStatusTranslator: ActionTranslator = {
  actionType: "advertising.pause_campaign",
  translatorId: "translator.campaign_status.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["campaign"],
  requiredCapability: "campaign_delivery",
  translate(action, context, origin) {
    if (action.parameters.kind !== "toggle") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "CAMPAIGN_STATUS_PARAMETER_MISMATCH",
        message: "Campaign status translator requires toggle parameters.",
      };
    }

    const target = requireTarget(action, context);
    if (!target.ok) return target.failure;
    const time = requireTime(action);
    if (!time.ok) return time.failure;

    const operation: SimulatorOperation = {
      kind: "SET",
      value: {
        kind: "boolean",
        value: action.parameters.value,
      },
    };

    return {
      status: "TRANSLATED",
      interventions: [
        buildIntervention(
          action,
          origin,
          "translator.campaign_status.v1",
          "campaign_delivery",
          target.target,
          operation,
        ),
      ],
    };
  },
};


const paidMediaDeliveryTranslator: ActionTranslator = {
  actionType: "advertising.set_delivery_state",
  translatorId: "translator.paid_media_delivery.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["campaign"],
  requiredCapability: "campaign_delivery",
  translate(action, context, origin) {
    if (action.parameters.kind !== "paid_media_delivery") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "PAID_MEDIA_DELIVERY_PARAMETER_MISMATCH",
        message:
          "Paid-media delivery translator requires paid_media_delivery parameters.",
      };
    }

    const target = requireTarget(action, context);
    if (!target.ok) return target.failure;
    const time = requireTime(action);
    if (!time.ok) return time.failure;

    const operation: SimulatorOperation = {
      kind: "SET",
      value: {
        kind: "boolean",
        value: action.parameters.operation === "RESUME",
      },
    };

    return {
      status: "TRANSLATED",
      interventions: [
        buildIntervention(
          action,
          origin,
          "translator.paid_media_delivery.v1",
          "campaign_delivery",
          target.target,
          operation,
        ),
      ],
    };
  },
};

function expandedPriceOperation(
  action: Action,
  member: {
    readonly priceAtBoundary: Extract<
      import("../action_ontology/types.js").MonetaryValue,
      { readonly kind: "money" }
    >;
    readonly priceSourceRef: string;
  },
): SimulatorOperation {
  if (action.parameters.kind !== "price_adjustment") {
    throw new TypeError("expanded pricing requires price_adjustment parameters");
  }

  const operation = action.parameters.operation;
  if (operation.kind === "SET") {
    return {
      kind: "SET",
      value: {
        kind: "money",
        amountMinor: operation.value.amountMinor,
        currency: operation.value.currency,
      },
    };
  }

  if (
    operation.kind === "DELTA" &&
    member.priceAtBoundary.currency !== operation.amount.currency
  ) {
    throw new TypeError("expanded pricing currency mismatch");
  }

  if (
    operation.reference.kind === "explicit_baseline" &&
    operation.reference.value.kind === "money" &&
    (operation.reference.value.currency !== member.priceAtBoundary.currency ||
      operation.reference.value.amountMinor !==
        member.priceAtBoundary.amountMinor)
  ) {
    throw new TypeError(
      "expanded pricing explicit baseline does not match the membership snapshot",
    );
  }

  const baseline = {
    value: {
      kind: "money" as const,
      amountMinor: member.priceAtBoundary.amountMinor,
      currency: member.priceAtBoundary.currency,
    },
    referenceKind: operation.reference.kind,
    source: "translation_context" as const,
    sourceRef: member.priceSourceRef,
  };

  if (operation.kind === "DELTA") {
    return {
      kind: "DELTA",
      direction: operation.direction,
      amount: {
        kind: "money",
        amountMinor: operation.amount.amountMinor,
        currency: operation.amount.currency,
      },
      baseline,
    };
  }

  return {
    kind: "MULTIPLY",
    factor: operation.factor,
    baseline,
  };
}

const priceTranslator: ActionTranslator = {
  actionType: "pricing.adjust_price",
  translatorId: "translator.price.v2",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["sku", "product", "category", "collection"],
  requiredCapability: "product_price",
  translate(action, context, origin) {
    if (action.parameters.kind !== "price_adjustment") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "PRICE_PARAMETER_MISMATCH",
        message: "Price translator requires price_adjustment parameters.",
      };
    }

    const time = requireTime(action);
    if (!time.ok) return time.failure;

    if (action.target.kind === "sku") {
      const target = requireTarget(action, context);
      if (!target.ok) return target.failure;
      if (target.target.kind !== "sku") {
        return {
          status: "UNSUPPORTED_TARGET",
          actionId: action.actionId,
          code: "PRICE_TARGET_MAPPING_MUST_BE_SKU",
          message: "SKU pricing must map to a simulator SKU target.",
        };
      }

      const operation = translateOperation(
        action,
        context,
        action.parameters.operation,
        "money",
      );
      if (!operation.ok) return operation.failure;

      return {
        status: "TRANSLATED",
        interventions: [
          buildIntervention(
            action,
            origin,
            "translator.price.v2",
            "price",
            target.target,
            operation.operation,
          ),
        ],
      };
    }

    const membership = resolvePricingMembership(context, action);
    if (membership.status === "missing") {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "MISSING_PRICING_MEMBERSHIP",
        message:
          "Product/category/collection pricing requires a deterministic membership snapshot.",
        missingContextRefs: [membership.ref],
      };
    }
    if (membership.status === "ambiguous") {
      return {
        status: "AMBIGUOUS_TRANSLATION",
        actionId: action.actionId,
        code: "AMBIGUOUS_PRICING_MEMBERSHIP",
        message:
          "More than one pricing membership binding matches the business Action.",
        missingContextRefs: [membership.ref],
      };
    }

    const binding = membership.binding;
    if (
      action.parameters.membership?.evaluateAt === "decision_time" &&
      binding.snapshotTime !== action.timing.decisionTime
    ) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PRICING_MEMBERSHIP_SNAPSHOT_TIME_MISMATCH",
        message:
          "Decision-time pricing membership must use a snapshot from the Action decision time.",
        missingContextRefs: [binding.sourceRef],
      };
    }
    if (
      action.parameters.membership?.evaluateAt === "translation_time" &&
      binding.snapshotTime !== context.simulatorClock
    ) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PRICING_MEMBERSHIP_SNAPSHOT_TIME_MISMATCH",
        message:
          "Translation-time pricing membership must use a snapshot from the translation clock.",
        missingContextRefs: [binding.sourceRef],
      };
    }
    if (
      action.parameters.membership?.evaluateAt === "effective_time" &&
      action.timing.effectiveStart.kind === "known" &&
      binding.snapshotTime !== action.timing.effectiveStart.at
    ) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PRICING_MEMBERSHIP_SNAPSHOT_TIME_MISMATCH",
        message:
          "Effective-time pricing membership must use a snapshot from the effective time.",
        missingContextRefs: [binding.sourceRef],
      };
    }

    try {
      const interventions = binding.members.map((member, index) =>
        buildIntervention(
          action,
          origin,
          "translator.price.v2",
          "price",
          member.simulatorTarget,
          expandedPriceOperation(action, member),
          index,
          binding.members.length,
          {
            membershipSourceRef: binding.sourceRef,
            membershipBindingRef: binding.bindingRef,
            membershipBoundary: binding.evaluateAt,
            membershipSnapshotTime: binding.snapshotTime,
          },
        ),
      );

      return {
        status: "TRANSLATED",
        interventions,
      };
    } catch (error) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PRICING_MEMBERSHIP_BASELINE_INVALID",
        message:
          error instanceof Error
            ? error.message
            : "Pricing membership baseline was invalid.",
        missingContextRefs: [binding.sourceRef],
      };
    }
  },
};

const promotionTranslator: ActionTranslator = {
  actionType: "promotion.apply_discount",
  translatorId: "translator.promotion.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["product", "sku", "category", "collection"],
  requiredCapability: "promotion_discount",
  translate(action, context, origin) {
    if (action.parameters.kind !== "promotion") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "PROMOTION_PARAMETER_MISMATCH",
        message: "Promotion translator requires promotion parameters.",
      };
    }

    const target = requireTarget(action, context);
    if (!target.ok) return target.failure;
    const time = requireTime(action);
    if (!time.ok) return time.failure;

    const operation = translateOperation(
      action,
      context,
      action.parameters.discount,
      "percentage",
    );
    if (!operation.ok) return operation.failure;

    return {
      status: "TRANSLATED",
      interventions: [
        buildIntervention(
          action,
          origin,
          "translator.promotion.v1",
          "promotion_discount",
          target.target,
          operation.operation,
        ),
      ],
    };
  },
};


function promotionSelectorTarget(
  selector: PromotionEntitySelector,
): ActionTarget {
  switch (selector.kind) {
    case "sku":
      return {
        kind: "sku",
        skuId: selector.skuId,
        ...(selector.productId ? { productId: selector.productId } : {}),
      };
    case "product":
      return { kind: "product", productId: selector.productId };
    case "category":
      return { kind: "category", categoryId: selector.categoryId };
    case "collection":
      return { kind: "collection", collectionId: selector.collectionId };
    case "product_set":
      return { kind: "product_set", productSetId: selector.productSetId };
    case "brand":
      return { kind: "brand", brandId: selector.brandId };
  }
}

function unsupportedPromotionCapability(
  action: Action,
  code: string,
  message: string,
): AtomicTranslatorResult {
  return {
    status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
    actionId: action.actionId,
    code,
    message,
  };
}

const promotionStartTranslator: ActionTranslator = {
  actionType: "promotion.start",
  translatorId: "translator.promotion_start.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["promotion"],
  requiredCapability: "promotion_discount",
  translate(action, context, origin) {
    if (action.parameters.kind !== "promotion_start") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "PROMOTION_START_PARAMETER_MISMATCH",
        message: "promotion.start requires promotion_start parameters.",
      };
    }

    const definition = action.parameters.definition;
    const mechanism = definition.mechanism;

    if (
      mechanism.kind !== "DISCOUNT" ||
      !["PERCENTAGE", "FIXED_AMOUNT"].includes(mechanism.discount.kind)
    ) {
      return unsupportedPromotionCapability(
        action,
        "PROMOTION_MECHANISM_UNSUPPORTED_BY_SIMULATOR",
        "Current simulator promotion capability supports only percentage and fixed-amount discounts.",
      );
    }

    if (
      definition.redemption.kind !== "AUTOMATIC" ||
      definition.customerEligibility.kind !== "ALL_CUSTOMERS" ||
      definition.purchaseRequirements.length !== 0 ||
      Object.keys(definition.usageLimits).length !== 0 ||
      definition.stacking.kind !== "STACKABLE" ||
      definition.conflictResolution.kind !== "NONE"
    ) {
      return unsupportedPromotionCapability(
        action,
        "PROMOTION_POLICY_UNSUPPORTED_BY_SIMULATOR",
        "Coupon, customer eligibility, purchase requirements, usage limits, stacking restrictions and conflict policies are not represented by the current simulator promotion capability.",
      );
    }

    if (definition.applicationScope.kind !== "PRODUCT_SCOPE") {
      return unsupportedPromotionCapability(
        action,
        "PROMOTION_SCOPE_UNSUPPORTED_BY_SIMULATOR",
        "Current simulator promotion capability requires a product-scoped promotion.",
      );
    }

    const productScope = definition.applicationScope.products;
    if (
      productScope.include.length !== 1 ||
      productScope.exclude.length !== 0 ||
      productScope.conditions.length !== 0
    ) {
      return unsupportedPromotionCapability(
        action,
        "PROMOTION_SCOPE_RULES_UNSUPPORTED_BY_SIMULATOR",
        "Current simulator promotion capability cannot preserve exclusions or product eligibility conditions.",
      );
    }

    const time = requireTime(action);
    if (!time.ok) return time.failure;

    const operation: SimulatorOperation =
      mechanism.discount.kind === "PERCENTAGE"
        ? {
            kind: "SET",
            value: {
              kind: "percentage",
              basisPoints: mechanism.discount.basisPoints,
            },
          }
        : {
            kind: "SET",
            value: {
              kind: "money",
              amountMinor: mechanism.discount.value.amountMinor,
              currency: mechanism.discount.value.currency,
            },
          };

    const selector = productScope.include[0]!;
    const promotionId = action.parameters.promotionId;

    if (selector.kind === "sku" || selector.kind === "product") {
      const targetResolution = resolveSimulatorTarget(
        context,
        promotionSelectorTarget(selector),
      );
      if (targetResolution.status === "missing") {
        return {
          status: "MISSING_CONTEXT",
          actionId: action.actionId,
          code: "MISSING_PROMOTION_TARGET_MAPPING",
          message: "No simulator target mapping exists for the promotion scope.",
          missingContextRefs: [targetResolution.ref],
        };
      }
      if (targetResolution.status === "ambiguous") {
        return {
          status: "AMBIGUOUS_TRANSLATION",
          actionId: action.actionId,
          code: "AMBIGUOUS_PROMOTION_TARGET_MAPPING",
          message: "Multiple simulator targets match the promotion scope.",
          missingContextRefs: [targetResolution.ref],
        };
      }

      return {
        status: "TRANSLATED",
        interventions: [
          buildIntervention(
            action,
            origin,
            "translator.promotion_start.v1",
            "promotion_discount",
            targetResolution.target,
            operation,
            0,
            1,
            undefined,
            { promotionId },
          ),
        ],
      };
    }

    const membership = productScope.membership;
    if (!membership) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "MISSING_PROMOTION_MEMBERSHIP_SEMANTICS",
        message:
          "Mutable promotion scope requires explicit membership semantics.",
        missingContextRefs: ["parameters.definition.applicationScope.products.membership"],
      };
    }

    const resolution = resolvePromotionMembership(
      context,
      promotionId,
      membership.evaluateAt,
      membership.bindingRef,
    );
    if (resolution.status === "missing") {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "MISSING_PROMOTION_MEMBERSHIP",
        message:
          "Promotion translation requires a deterministic membership snapshot.",
        missingContextRefs: [resolution.ref],
      };
    }
    if (resolution.status === "ambiguous") {
      return {
        status: "AMBIGUOUS_TRANSLATION",
        actionId: action.actionId,
        code: "AMBIGUOUS_PROMOTION_MEMBERSHIP",
        message:
          "More than one promotion membership snapshot matches the Action.",
        missingContextRefs: [resolution.ref],
      };
    }

    const binding = resolution.binding;
    if (
      membership.evaluateAt === "decision_time" &&
      binding.snapshotTime !== action.timing.decisionTime
    ) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PROMOTION_MEMBERSHIP_SNAPSHOT_TIME_MISMATCH",
        message:
          "Decision-time promotion membership must use the Action decision-time snapshot.",
        missingContextRefs: [binding.sourceRef],
      };
    }
    if (
      membership.evaluateAt === "translation_time" &&
      binding.snapshotTime !== context.simulatorClock
    ) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PROMOTION_MEMBERSHIP_SNAPSHOT_TIME_MISMATCH",
        message:
          "Translation-time promotion membership must use the translation clock snapshot.",
        missingContextRefs: [binding.sourceRef],
      };
    }
    if (
      membership.evaluateAt === "effective_time" &&
      action.timing.effectiveStart.kind === "known" &&
      binding.snapshotTime !== action.timing.effectiveStart.at
    ) {
      return {
        status: "MISSING_CONTEXT",
        actionId: action.actionId,
        code: "PROMOTION_MEMBERSHIP_SNAPSHOT_TIME_MISMATCH",
        message:
          "Effective-time promotion membership must use the effective-time snapshot.",
        missingContextRefs: [binding.sourceRef],
      };
    }

    return {
      status: "TRANSLATED",
      interventions: binding.members.map((member, index) =>
        buildIntervention(
          action,
          origin,
          "translator.promotion_start.v1",
          "promotion_discount",
          member.simulatorTarget,
          operation,
          index,
          binding.members.length,
          {
            membershipSourceRef: binding.sourceRef,
            membershipBindingRef: binding.bindingRef,
            membershipBoundary: binding.evaluateAt,
            membershipSnapshotTime: binding.snapshotTime,
          },
          { promotionId },
        ),
      ),
    };
  },
};

function unsupportedPromotionLifecycleTranslator(
  actionType: "promotion.stop" | "promotion.modify",
): ActionTranslator {
  return {
    actionType,
    translatorId:
      actionType === "promotion.stop"
        ? "translator.promotion_stop_boundary.v1"
        : "translator.promotion_modify_boundary.v1",
    translationVersion: ACTION_TRANSLATION_VERSION,
    supportedTargetKinds: ["promotion"],
    translate(action) {
      return unsupportedPromotionCapability(
        action,
        "PROMOTION_LIFECYCLE_UNSUPPORTED_BY_SIMULATOR",
        "Current simulator has no native promotion deactivation/modification intervention.",
      );
    },
  };
}


function unsupportedShippingTranslator(
  actionType:
    | "shipping.set_offer"
    | "shipping.modify_offer"
    | "shipping.stop_offer"
    | "shipping.adjust_policy"
    | "shipping.rollback_policy",
): ActionTranslator {
  return {
    actionType,
    translatorId: "translator." + actionType.replace(".", "_") + "_boundary.v1",
    translationVersion: ACTION_TRANSLATION_VERSION,
    supportedTargetKinds:
      actionType === "shipping.set_offer" ||
      actionType === "shipping.modify_offer" ||
      actionType === "shipping.stop_offer"
        ? ["shipping_offer"]
        : ["shipping_policy"],
    translate(action) {
      return {
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
        actionId: action.actionId,
        code: "SHIPPING_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
        message:
          "Current simulator has no native shipping offer, deactivation, threshold or rollback intervention. Shipping Actions are not translated into price or promotion discounts.",
      };
    },
  };
}


function unsupportedRigorousMerchandisingTranslator(
  actionType:
    | "merchandising.feature"
    | "merchandising.deprioritize"
    | "merchandising.set_rank"
    | "merchandising.promote_substitute"
    | "merchandising.set_cross_sell"
    | "merchandising.set_upsell"
    | "merchandising.remove_placement"
    | "merchandising.remove_relationship"
    | "merchandising.rollback_rank",
): ActionTranslator {
  const relationship =
    actionType === "merchandising.promote_substitute" ||
    actionType === "merchandising.set_cross_sell" ||
    actionType === "merchandising.set_upsell" ||
    actionType === "merchandising.remove_relationship";
  const placementRemoval = actionType === "merchandising.remove_placement";
  return {
    actionType,
    translatorId:
      "translator." +
      actionType.replace(".", "_") +
      "_boundary.v1",
    translationVersion: ACTION_TRANSLATION_VERSION,
    supportedTargetKinds: relationship
      ? ["merchandising_relationship"]
      : placementRemoval
        ? ["merchandising_placement"]
        : ["sku", "product", "collection"],
    translate(action) {
      return {
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
        actionId: action.actionId,
        code: "MERCHANDISING_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
        message:
          "Current simulator merchandising_position intervention does not preserve rigorous surface/container, displacement, relationship, removal or rollback semantics. The Action is not approximated through demand, conversion, advertising, availability or price mutations.",
      };
    },
  };
}


function unsupportedInventoryTranslator(
  actionType:
    | "inventory.reorder"
    | "inventory.adjust_reorder_quantity"
    | "inventory.adjust_reorder_timing"
    | "inventory.set_safety_stock"
    | "inventory.set_reorder_point"
    | "inventory.protect_inventory"
    | "inventory.set_backorder_policy"
    | "inventory.clearance"
    | "inventory.accelerate_excess_stock"
    | "inventory.rollback_policy",
): ActionTranslator {
  const strategy =
    actionType === "inventory.clearance" ||
    actionType === "inventory.accelerate_excess_stock";
  const protection = actionType === "inventory.protect_inventory";
  const policy =
    actionType === "inventory.adjust_reorder_quantity" ||
    actionType === "inventory.adjust_reorder_timing" ||
    actionType === "inventory.set_safety_stock" ||
    actionType === "inventory.set_reorder_point" ||
    actionType === "inventory.set_backorder_policy" ||
    actionType === "inventory.rollback_policy";

  return {
    actionType,
    translatorId:
      "translator." +
      actionType.replace(".", "_") +
      "_boundary.v1",
    translationVersion: ACTION_TRANSLATION_VERSION,
    supportedTargetKinds:
      actionType === "inventory.reorder"
        ? ["sku"]
        : strategy
          ? ["sku", "product", "category", "collection", "inventory_set"]
          : protection
            ? ["sku", "product", "category", "collection", "inventory_set", "inventory_location"]
            : policy
              ? ["sku", "product", "inventory_policy"]
              : ["sku"],
    translate(action) {
      return {
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
        actionId: action.actionId,
        code: "INVENTORY_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
        message:
          "Current simulator has no semantically correct outstanding-purchase-order/receipt, safety-stock, reservation, backorder, clearance or inventory-strategy intervention. Reorders are not translated into immediate on-hand inventory mutations.",
      };
    },
  };
}


function unsupportedCroTranslator(
  actionType:
    | "cro.modify_experience"
    | "cro.add_element"
    | "cro.remove_element"
    | "cro.reorder_elements"
    | "cro.modify_interaction"
    | "cro.modify_navigation"
    | "cro.modify_search"
    | "cro.modify_checkout"
    | "cro.rollback_experience",
): ActionTranslator {
  return {
    actionType,
    translatorId:
      "translator." + actionType.replace(".", "_") + "_boundary.v1",
    translationVersion: ACTION_TRANSLATION_VERSION,
    supportedTargetKinds: ["cro_experience"],
    translate(action) {
      return {
        status: "UNSUPPORTED_SIMULATOR_CAPABILITY",
        actionId: action.actionId,
        code: "CRO_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
        message:
          "Current simulator has no native page-component, page-ordering, interaction, performance, search-experience or checkout-experience intervention that preserves CRO semantics. CRO Actions are not translated into conversion propensity, purchase probability, revenue or demand mutations.",
      };
    },
  };
}

const merchandisingTranslator: ActionTranslator = {
  actionType: "merchandising.move_product",
  translatorId: "translator.merchandising_position.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["collection", "product"],
  requiredCapability: "merchandising_position",
  translate(action, context, origin) {
    if (action.parameters.kind !== "merchandising_position") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "MERCHANDISING_PARAMETER_MISMATCH",
        message: "Merchandising translator requires merchandising_position parameters.",
      };
    }

    const target = requireTarget(action, context);
    if (!target.ok) return target.failure;
    const time = requireTime(action);
    if (!time.ok) return time.failure;

    return {
      status: "TRANSLATED",
      interventions: [
        buildIntervention(
          action,
          origin,
          "translator.merchandising_position.v1",
          "merchandising_position",
          target.target,
          {
            kind: "SET",
            value: {
              kind: "integer",
              value: action.parameters.position,
            },
          },
        ),
      ],
    };
  },
};

function noCausalInterventionTranslator(
  actionType: string,
  translatorId: string,
  supportedTargetKinds: ActionTranslator["supportedTargetKinds"],
): ActionTranslator {
  return {
    actionType,
    translatorId,
    translationVersion: ACTION_TRANSLATION_VERSION,
    supportedTargetKinds,
    translate() {
      return { status: "TRANSLATED", interventions: [] };
    },
  };
}

const experimentTranslator: ActionTranslator = {
  actionType: "experimentation.run_experiment",
  translatorId: "translator.experiment_boundary.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["experiment"],
  translate(action) {
    if (action.parameters.kind !== "run_experiment") {
      return {
        status: "INVALID_ACTION",
        actionId: action.actionId,
        code: "EXPERIMENT_PARAMETER_MISMATCH",
        message: "Experiment boundary requires run_experiment parameters.",
      };
    }

    return {
      status: "EXPERIMENT_REQUIRES_ENGINE",
      originatingBusinessActionId: action.actionId,
      translationVersion: ACTION_TRANSLATION_VERSION,
      experiment: {
        actionId: action.actionId,
        hypothesisRef: action.parameters.hypothesisRef,
        interventionActionId: action.parameters.interventionActionId,
        controlActionId: action.parameters.controlActionId,
        targetPopulationRef: action.parameters.targetPopulationRef,
        durationSeconds: action.parameters.durationSeconds,
        primaryOutcomeMetricId: action.parameters.primaryOutcomeMetricId,
      },
    };
  },
};

export const CORE_ACTION_TRANSLATORS: readonly ActionTranslator[] = Object.freeze([
  budgetTranslator,
  campaignStatusTranslator,
  paidMediaDeliveryTranslator,
  priceTranslator,
  promotionTranslator,
  promotionStartTranslator,
  unsupportedPromotionLifecycleTranslator("promotion.stop"),
  unsupportedPromotionLifecycleTranslator("promotion.modify"),
  unsupportedShippingTranslator("shipping.set_offer"),
  unsupportedShippingTranslator("shipping.modify_offer"),
  unsupportedShippingTranslator("shipping.stop_offer"),
  unsupportedShippingTranslator("shipping.adjust_policy"),
  unsupportedShippingTranslator("shipping.rollback_policy"),
  unsupportedRigorousMerchandisingTranslator("merchandising.feature"),
  unsupportedRigorousMerchandisingTranslator("merchandising.deprioritize"),
  unsupportedRigorousMerchandisingTranslator("merchandising.set_rank"),
  unsupportedRigorousMerchandisingTranslator("merchandising.promote_substitute"),
  unsupportedRigorousMerchandisingTranslator("merchandising.set_cross_sell"),
  unsupportedRigorousMerchandisingTranslator("merchandising.set_upsell"),
  unsupportedRigorousMerchandisingTranslator("merchandising.remove_placement"),
  unsupportedRigorousMerchandisingTranslator("merchandising.remove_relationship"),
  unsupportedRigorousMerchandisingTranslator("merchandising.rollback_rank"),
  unsupportedInventoryTranslator("inventory.reorder"),
  unsupportedInventoryTranslator("inventory.adjust_reorder_quantity"),
  unsupportedInventoryTranslator("inventory.adjust_reorder_timing"),
  unsupportedInventoryTranslator("inventory.set_safety_stock"),
  unsupportedInventoryTranslator("inventory.set_reorder_point"),
  unsupportedInventoryTranslator("inventory.protect_inventory"),
  unsupportedInventoryTranslator("inventory.set_backorder_policy"),
  unsupportedInventoryTranslator("inventory.clearance"),
  unsupportedInventoryTranslator("inventory.accelerate_excess_stock"),
  unsupportedInventoryTranslator("inventory.rollback_policy"),
  unsupportedCroTranslator("cro.modify_experience"),
  unsupportedCroTranslator("cro.add_element"),
  unsupportedCroTranslator("cro.remove_element"),
  unsupportedCroTranslator("cro.reorder_elements"),
  unsupportedCroTranslator("cro.modify_interaction"),
  unsupportedCroTranslator("cro.modify_navigation"),
  unsupportedCroTranslator("cro.modify_search"),
  unsupportedCroTranslator("cro.modify_checkout"),
  unsupportedCroTranslator("cro.rollback_experience"),
  merchandisingTranslator,
  noCausalInterventionTranslator(
    "no_op.do_nothing",
    "translator.no_op.v1",
    ["merchant"],
  ),
  noCausalInterventionTranslator(
    "no_op.wait_observe",
    "translator.wait_observe.v1",
    ["merchant", "advertising_channel", "campaign", "product", "sku"],
  ),
  noCausalInterventionTranslator(
    "investigation.inspect",
    "translator.investigate.v1",
    ["merchant", "funnel_stage", "page", "advertising_channel"],
  ),
  experimentTranslator,
] as const);
