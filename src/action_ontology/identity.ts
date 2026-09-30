import type {
  ActionCategoryId,
  ActionId,
  ActionType,
  ConstraintId,
} from "./types.js";

function requireMatch(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) {
    throw new RangeError(label + " is invalid: " + value);
  }
  return value;
}

export function actionId(value: string): ActionId {
  return requireMatch(
    value,
    /^action_[A-Za-z0-9._:-]+$/,
    "ActionId",
  ) as ActionId;
}

export function actionType(value: string): ActionType {
  return requireMatch(
    value,
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/,
    "ActionType",
  ) as ActionType;
}

export function actionCategoryId(value: string): ActionCategoryId {
  return requireMatch(
    value,
    /^[a-z][a-z0-9_]*$/,
    "ActionCategoryId",
  ) as ActionCategoryId;
}

export function constraintId(value: string): ConstraintId {
  return requireMatch(
    value,
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    "ConstraintId",
  ) as ConstraintId;
}
