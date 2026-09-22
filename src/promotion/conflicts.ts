import type {
  Action,
  PromotionDefinition,
} from "../action_ontology/types.js";
import type {
  PromotionConflictAssessment,
  PromotionDefinitionRef,
} from "./types.js";

function definitionFromAction(action: Action): PromotionDefinitionRef | undefined {
  if (
    action.parameters.kind !== "promotion_start" &&
    action.parameters.kind !== "promotion_modify"
  ) {
    return undefined;
  }
  return {
    promotionId:
      action.parameters.kind === "promotion_start"
        ? action.parameters.promotionId
        : action.parameters.targetPromotionId,
    definition: action.parameters.definition,
  };
}

function category(definition: PromotionDefinition):
  | "AUTOMATIC"
  | "COUPON"
  | "PRODUCT"
  | "ORDER"
  | "BUNDLE" {
  if (definition.redemption.kind === "COUPON") return "COUPON";
  if (definition.applicationScope.kind === "ORDER_SCOPE") return "ORDER";
  if (definition.applicationScope.kind === "BUNDLE_SCOPE") return "BUNDLE";
  if (definition.redemption.kind === "AUTOMATIC") return "AUTOMATIC";
  return "PRODUCT";
}

function explicitlyStackableWith(
  left: PromotionDefinition,
  right: PromotionDefinition,
): boolean {
  if (left.stacking.kind === "STACKABLE") return true;
  if (left.stacking.kind === "NON_STACKABLE") return false;
  return left.stacking.types.includes(category(right));
}

export function assessPromotionPairConflict(
  leftAction: Action,
  rightAction: Action,
): PromotionConflictAssessment {
  const left = definitionFromAction(leftAction);
  const right = definitionFromAction(rightAction);
  if (!left || !right) {
    return {
      status: "AMBIGUOUS",
      code: "NON_STACKABLE_OVERLAP_WITHOUT_RESOLUTION",
    };
  }

  if (
    explicitlyStackableWith(left.definition, right.definition) &&
    explicitlyStackableWith(right.definition, left.definition)
  ) {
    return { status: "STACKABLE" };
  }

  const leftConflict = left.definition.conflictResolution;
  const rightConflict = right.definition.conflictResolution;

  if (
    leftConflict.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    rightConflict.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    leftConflict.groupId === rightConflict.groupId
  ) {
    if (
      leftConflict.priority !== undefined &&
      rightConflict.priority !== undefined &&
      leftConflict.priority !== rightConflict.priority
    ) {
      return {
        status: "RESOLVABLE",
        strategy: "MUTUALLY_EXCLUSIVE_GROUP",
        groupId: leftConflict.groupId,
        winnerPromotionId:
          leftConflict.priority > rightConflict.priority
            ? left.promotionId
            : right.promotionId,
      };
    }
    return {
      status: "RESOLVABLE",
      strategy: "MUTUALLY_EXCLUSIVE_GROUP",
      groupId: leftConflict.groupId,
    };
  }

  if (
    leftConflict.kind === "PRIORITY" &&
    rightConflict.kind === "PRIORITY" &&
    leftConflict.priority !== rightConflict.priority
  ) {
    return {
      status: "RESOLVABLE",
      strategy: "PRIORITY",
      winnerPromotionId:
        leftConflict.priority > rightConflict.priority
          ? left.promotionId
          : right.promotionId,
    };
  }

  if (
    leftConflict.kind === "BEST_DISCOUNT" &&
    rightConflict.kind === "BEST_DISCOUNT"
  ) {
    return {
      status: "RESOLVABLE",
      strategy: "BEST_DISCOUNT",
    };
  }

  return {
    status: "AMBIGUOUS",
    code: "NON_STACKABLE_OVERLAP_WITHOUT_RESOLUTION",
  };
}
