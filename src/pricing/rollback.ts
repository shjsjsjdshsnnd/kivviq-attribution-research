import type {
  MonetaryValue,
  PriceRollbackStrategy,
} from "../action_ontology/types.js";
import { validateAction } from "../action_ontology/validation.js";
import type {
  PricingRollbackReadiness,
  PricingRollbackStateContext,
} from "./types.js";

function sameMoney(left: MonetaryValue, right: MonetaryValue): boolean {
  return (
    left.amountMinor === right.amountMinor &&
    left.currency === right.currency
  );
}

function resolveRestorePrice(
  strategy: Extract<
    PriceRollbackStrategy,
    { readonly kind: "RESTORE_PRE_ACTION_VALUE" }
  >,
  context: PricingRollbackStateContext,
  rollbackActionId: string,
):
  | Extract<PricingRollbackReadiness, { readonly status: "READY" }>["resolution"]
  | Extract<PricingRollbackReadiness, { readonly status: "MISSING_CONTEXT" }> {
  if (strategy.source.kind === "membership_snapshot") {
    if (
      !context.preActionMembershipBindingRef ||
      context.preActionMembershipBindingRef !== strategy.source.bindingRef
    ) {
      return {
        status: "MISSING_CONTEXT",
        rollbackActionId,
        code: "MISSING_PRE_ACTION_MEMBERSHIP",
        message:
          "Rollback requires the exact pre-action membership snapshot binding.",
      };
    }
    return {
      kind: "membership_snapshot",
      bindingRef: strategy.source.bindingRef,
    };
  }

  const reference = strategy.source.preActionPrice;
  if (
    reference.kind === "explicit_baseline" &&
    reference.value.kind === "money"
  ) {
    return {
      kind: "single_price",
      rollbackPrice: reference.value,
      sourceRef: "action:explicit-pre-action-price",
    };
  }

  if (!context.preActionPrice || !context.preActionPriceSourceRef) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId,
      code: "MISSING_PRE_ACTION_PRICE",
      message:
        "Rollback requires the decision-time pre-action price; none was supplied.",
    };
  }

  return {
    kind: "single_price",
    rollbackPrice: context.preActionPrice,
    sourceRef: context.preActionPriceSourceRef,
  };
}

export function evaluatePricingRollbackReadiness(
  input: unknown,
  context: PricingRollbackStateContext,
): PricingRollbackReadiness {
  const validation = validateAction(input);
  if (!validation.ok) {
    return {
      status: "INVALID_ACTION",
      code: "INVALID_CANONICAL_ACTION",
      message: validation.errors.map((issue) => issue.code).join(", "),
    };
  }

  const action = validation.action;
  if (
    action.actionType !== "pricing.rollback_price" ||
    action.parameters.kind !== "price_rollback"
  ) {
    return {
      status: "INVALID_ACTION",
      code: "NOT_A_PRICING_ROLLBACK_ACTION",
      message: "Action must use pricing.rollback_price.",
    };
  }

  const guard = action.parameters.conflictGuard;
  if (guard.expected.kind === "single_price") {
    if (!context.currentPrice) {
      return {
        status: "MISSING_CONTEXT",
        rollbackActionId: action.actionId,
        code: "MISSING_CURRENT_PRICE",
        message:
          "Safe rollback requires the current decision-boundary price.",
      };
    }
    if (!sameMoney(context.currentPrice, guard.expected.price)) {
      return {
        status: "CONFLICT",
        rollbackActionId: action.actionId,
        code: "CURRENT_STATE_CHANGED_AFTER_ORIGINAL_ACTION",
        message:
          "Current price no longer matches the state produced by the original temporary price Action.",
      };
    }
  } else {
    if (!context.currentMembershipStateRef) {
      return {
        status: "MISSING_CONTEXT",
        rollbackActionId: action.actionId,
        code: "MISSING_CURRENT_MEMBERSHIP_STATE",
        message:
          "Safe expanded rollback requires the current membership pricing state reference.",
      };
    }
    if (context.currentMembershipStateRef !== guard.expected.stateRef) {
      return {
        status: "CONFLICT",
        rollbackActionId: action.actionId,
        code: "CURRENT_STATE_CHANGED_AFTER_ORIGINAL_ACTION",
        message:
          "Expanded pricing state no longer matches the state produced by the original Action.",
      };
    }
  }

  if (action.parameters.strategy.kind === "SET_EXPLICIT_VALUE") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: action.parameters.originalActionId,
      resolution: {
        kind: "single_price",
        rollbackPrice: action.parameters.strategy.value,
        sourceRef: "action:explicit-rollback-value",
      },
    };
  }

  const resolution = resolveRestorePrice(
    action.parameters.strategy,
    context,
    action.actionId,
  );
  if ("status" in resolution) return resolution;

  return {
    status: "READY",
    rollbackActionId: action.actionId,
    originalActionId: action.parameters.originalActionId,
    resolution,
  };
}
