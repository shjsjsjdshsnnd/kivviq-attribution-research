import { validateAction } from "../action_ontology/validation.js";
import {
  merchandisingEntityKey,
} from "./ranking.js";
import type {
  MerchandisingRollbackReadiness,
  MerchandisingRollbackStateContext,
} from "./types.js";

export function evaluateMerchandisingRollbackReadiness(
  input: unknown,
  context: MerchandisingRollbackStateContext,
): MerchandisingRollbackReadiness {
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
    action.actionType !== "merchandising.rollback_rank" ||
    action.parameters.kind !== "merchandising_rank_rollback"
  ) {
    return {
      status: "INVALID_ACTION",
      code: "NOT_A_MERCHANDISING_ROLLBACK_ACTION",
      message: "Action must use merchandising.rollback_rank.",
    };
  }

  const parameters = action.parameters;

  if (context.currentPosition === undefined) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_CURRENT_POSITION",
      message: "Current rank is required for safe rollback.",
    };
  }

  if (
    context.currentPosition !==
    parameters.conflictGuard.expectedPosition
  ) {
    return {
      status: "CONFLICT",
      rollbackActionId: action.actionId,
      code: "CURRENT_RANK_CHANGED_AFTER_ORIGINAL_ACTION",
      message:
        "Current rank no longer matches the rank produced by the original temporary Action.",
    };
  }

  if (parameters.strategy.kind === "SET_EXPLICIT_VALUE") {
    return {
      status: "READY",
      rollbackActionId: action.actionId,
      originalActionId: parameters.originalActionId,
      position: parameters.strategy.position,
      sourceRef: "action:explicit-merchandising-rollback-position",
    };
  }

  const strategy = parameters.strategy;
  const snapshot = context.rankingSnapshots?.find(
    (candidate) =>
      candidate.bindingRef ===
      strategy.rankingSnapshotRef,
  );
  if (!snapshot) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "MISSING_RANKING_SNAPSHOT",
      message: "Pre-action ranking snapshot is required.",
    };
  }

  const key = merchandisingEntityKey(action.target as never);
  const index = snapshot.orderedEntities.findIndex(
    (entity) => merchandisingEntityKey(entity) === key,
  );
  if (index < 0) {
    return {
      status: "MISSING_CONTEXT",
      rollbackActionId: action.actionId,
      code: "RANKED_ENTITY_NOT_IN_SNAPSHOT",
      message: "Rollback target is absent from the pre-action ranking snapshot.",
    };
  }

  return {
    status: "READY",
    rollbackActionId: action.actionId,
    originalActionId: parameters.originalActionId,
    position: index + 1,
    sourceRef: snapshot.sourceRef,
  };
}
