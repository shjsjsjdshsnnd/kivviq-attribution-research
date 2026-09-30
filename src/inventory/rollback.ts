import type {
  InventoryRollbackValue,
  ScalarValue,
} from "../action_ontology/types.js";
import { validateAction } from "../action_ontology/validation.js";
import type {
  InventoryRollbackReadiness,
  InventoryRollbackStateContext,
} from "./types.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return (
    "{" +
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => JSON.stringify(key) + ":" + stable(entry))
      .join(",") +
    "}"
  );
}

function sameValue(
  left: InventoryRollbackValue,
  right: InventoryRollbackValue,
): boolean {
  return stable(left) === stable(right);
}

export function evaluateInventoryRollbackReadiness(
  input: unknown,
  context: InventoryRollbackStateContext,
): InventoryRollbackReadiness {
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
    action.actionType !== "inventory.rollback_policy" ||
    action.parameters.kind !== "inventory_policy_rollback"
  ) {
    return {
      status: "INVALID_ACTION",
      code: "NOT_AN_INVENTORY_ROLLBACK_ACTION",
      message: "Action must use inventory.rollback_policy.",
    };
  }

  const parameters = action.parameters;
  if (!context.currentValue) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_CURRENT_POLICY_VALUE",
      message: "Current inventory policy value is required.",
    };
  }
  if (!sameValue(context.currentValue, parameters.conflictGuard.expectedValue)) {
    return {
      status: "CONFLICT",
      rollbackActionId: action.actionId,
      code: "CURRENT_POLICY_CHANGED_AFTER_ORIGINAL_ACTION",
      message:
        "Current inventory policy no longer matches the state produced by the original temporary Action.",
    };
  }

  if (parameters.strategy.kind === "SET_EXPLICIT_VALUE") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      value: parameters.strategy.value,
      sourceRef: "action:explicit-inventory-rollback-value",
    };
  }

  const reference = parameters.strategy.preActionValue;
  if (reference.kind === "explicit_baseline") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      value: reference.value as ScalarValue,
      sourceRef: "action:explicit-pre-action-inventory-policy",
    };
  }

  if (
    reference.kind === "baseline_snapshot" ||
    reference.kind === "inventory_policy_snapshot"
  ) {
    const snapshot = context.policySnapshots?.find(
      (candidate) => candidate.baselineId === reference.baselineId,
    );
    if (!snapshot) {
      return {
        status: "MISSING_CONTEXT",
        rollbackActionId: action.actionId,
        code: "MISSING_INVENTORY_POLICY_SNAPSHOT",
        message: "Required inventory policy snapshot is unavailable.",
      };
    }
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      value: snapshot.value,
      sourceRef: snapshot.sourceRef,
    };
  }

  if (!context.preActionValue || !context.preActionValueSourceRef) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_PRE_ACTION_POLICY_VALUE",
      message: "Pre-action inventory policy value is required.",
    };
  }

  return {
    status: "READY",
    rollbackActionId: action.actionId,
    originalActionId: parameters.originalActionId,
    value: context.preActionValue,
    sourceRef: context.preActionValueSourceRef,
  };
}
