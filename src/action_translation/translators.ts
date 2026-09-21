import type { Action } from "../action_ontology/types.js";
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
