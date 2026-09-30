import { validateAction } from "../action_ontology/validation.js";
import type {
  CroRollbackReadiness,
  CroRollbackStateContext,
} from "./types.js";

export function evaluateCroRollbackReadiness(
  input: unknown,
  context: CroRollbackStateContext,
): CroRollbackReadiness {
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
    action.actionType !== "cro.rollback_experience" ||
    action.parameters.kind !== "cro_rollback"
  ) {
    return {
      status: "INVALID_ACTION",
      code: "NOT_A_CRO_ROLLBACK_ACTION",
      message: "Action must use cro.rollback_experience.",
    };
  }

  const parameters = action.parameters;
  if (!context.currentStateRef) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_CURRENT_EXPERIENCE_STATE",
      message: "Current CRO experience state is required.",
    };
  }
  if (context.currentStateRef !== parameters.conflictGuard.expectedStateRef) {
    return {
      status: "CONFLICT",
      rollbackActionId: action.actionId,
      code: "CURRENT_EXPERIENCE_CHANGED_AFTER_ORIGINAL_ACTION",
      message:
        "Current experience state no longer matches the temporary CRO Action output.",
    };
  }

  if (parameters.strategy.kind === "SET_EXPLICIT_VALUE") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      stateRef: parameters.strategy.stateRef,
      sourceRef: "action:explicit-cro-rollback-state",
    };
  }

  const strategy = parameters.strategy;
  const snapshot = context.stateSnapshots?.find(
    (candidate) =>
      candidate.stateSnapshotRef === strategy.stateSnapshotRef,
  );
  if (!snapshot) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_CRO_STATE_SNAPSHOT",
      message: "Pre-action CRO state snapshot is unavailable.",
    };
  }

  return {
    status: "READY",
    rollbackActionId: action.actionId,
    originalActionId: parameters.originalActionId,
    stateRef: snapshot.stateRef,
    sourceRef: snapshot.sourceRef,
  };
}
