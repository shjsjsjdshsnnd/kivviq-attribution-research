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

const priceTranslator: ActionTranslator = {
  actionType: "pricing.adjust_price",
  translatorId: "translator.price.v1",
  translationVersion: ACTION_TRANSLATION_VERSION,
  supportedTargetKinds: ["product", "sku"],
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

    const target = requireTarget(action, context);
    if (!target.ok) return target.failure;
    const time = requireTime(action);
    if (!time.ok) return time.failure;

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
          "translator.price.v1",
          "price",
          target.target,
          operation.operation,
        ),
      ],
    };
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

export const CORE_ACTION_TRANSLATORS: readonly ActionTranslator[] = [
  budgetTranslator,
  campaignStatusTranslator,
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
] as const;
