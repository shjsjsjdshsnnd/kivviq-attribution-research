import type {
  LifecyclePolicyRollbackValue,
} from "../action_ontology/types.js";
import { validateAction } from "../action_ontology/validation.js";
import type {
  LifecycleRollbackReadiness,
  LifecycleRollbackStateContext,
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

function samePolicy(
  left: LifecyclePolicyRollbackValue,
  right: LifecyclePolicyRollbackValue,
): boolean {
  return stable(left) === stable(right);
}

export function evaluateLifecycleRollbackReadiness(
  input: unknown,
  context: LifecycleRollbackStateContext,
): LifecycleRollbackReadiness {
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
    action.actionType !== "lifecycle.rollback_policy" ||
    action.parameters.kind !== "lifecycle_policy_rollback"
  ) {
    return {
      status: "INVALID_ACTION",
      code: "NOT_A_LIFECYCLE_ROLLBACK_ACTION",
      message: "Action must use lifecycle.rollback_policy.",
    };
  }

  const parameters = action.parameters;
  if (!context.currentValue) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_CURRENT_LIFECYCLE_POLICY",
      message: "Current lifecycle policy value is required.",
    };
  }
  if (
    !samePolicy(
      context.currentValue,
      parameters.conflictGuard.expectedValue,
    )
  ) {
    return {
      status: "CONFLICT",
      rollbackActionId: action.actionId,
      code: "CURRENT_LIFECYCLE_POLICY_CHANGED_AFTER_ORIGINAL_ACTION",
      message:
        "Current lifecycle policy no longer matches the output of the original temporary Action.",
    };
  }

  if (parameters.strategy.kind === "SET_EXPLICIT_VALUE") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      value: parameters.strategy.value,
      sourceRef: "action:explicit-lifecycle-rollback-policy",
    };
  }

  const reference = parameters.strategy.preActionValue;
  if (reference.kind === "explicit_policy") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      value: reference.value,
      sourceRef: "action:explicit-pre-action-lifecycle-policy",
    };
  }

  const snapshot = context.policySnapshots?.find(
    (candidate) => candidate.baselineId === reference.baselineId,
  );
  if (!snapshot) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_LIFECYCLE_POLICY_SNAPSHOT",
      message: "Required lifecycle policy snapshot is unavailable.",
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
