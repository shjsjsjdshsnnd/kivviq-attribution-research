import type {
  Action,
  MerchandisingConflictResolution,
  MerchandisingSurface,
} from "../action_ontology/types.js";
import {
  merchandisingSurfaceKey,
} from "./ranking.js";
import type { MerchandisingConflictAssessment } from "./types.js";

interface PlacementRef {
  readonly surface: MerchandisingSurface;
  readonly coordinate: string;
  readonly conflict: MerchandisingConflictResolution;
}

function ref(action: Action): PlacementRef | undefined {
  const p = action.parameters;
  if (p.kind === "merchandising_visibility" && p.placement) {
    return {
      surface: p.surface,
      coordinate:
        p.placement.kind === "POSITION"
          ? "position:" + p.placement.position
          : "slot:" + p.placement.slotId,
      conflict: p.conflictResolution,
    };
  }
  if (p.kind === "merchandising_rank" && p.operation.kind === "SET") {
    return {
      surface: p.surface,
      coordinate: "position:" + p.operation.position,
      conflict: p.conflictResolution,
    };
  }
  return undefined;
}

export function assessMerchandisingConflict(
  leftAction: Action,
  rightAction: Action,
): MerchandisingConflictAssessment {
  const left = ref(leftAction);
  const right = ref(rightAction);
  if (!left || !right) return { status: "COEXIST" };
  if (
    merchandisingSurfaceKey(left.surface) !==
      merchandisingSurfaceKey(right.surface) ||
    left.coordinate !== right.coordinate
  ) {
    return { status: "COEXIST" };
  }

  if (
    left.conflict.kind === "PRECEDENCE" &&
    right.conflict.kind === "PRECEDENCE" &&
    left.conflict.precedence !== right.conflict.precedence
  ) {
    return {
      status: "RESOLVABLE",
      strategy: "PRECEDENCE",
      winnerActionId:
        left.conflict.precedence > right.conflict.precedence
          ? leftAction.actionId
          : rightAction.actionId,
    };
  }

  if (
    left.conflict.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    right.conflict.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    left.conflict.groupId === right.conflict.groupId
  ) {
    const winnerActionId =
      left.conflict.precedence !== undefined &&
      right.conflict.precedence !== undefined &&
      left.conflict.precedence !== right.conflict.precedence
        ? left.conflict.precedence > right.conflict.precedence
          ? leftAction.actionId
          : rightAction.actionId
        : undefined;
    return {
      status: "RESOLVABLE",
      strategy: "MUTUALLY_EXCLUSIVE_GROUP",
      groupId: left.conflict.groupId,
      ...(winnerActionId ? { winnerActionId } : {}),
    };
  }

  return {
    status: "AMBIGUOUS",
    code: "EXCLUSIVE_MERCHANDISING_PLACEMENT_CONFLICT",
  };
}
