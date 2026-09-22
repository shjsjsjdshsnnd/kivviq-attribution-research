import type {
  Action,
  CroComponentTarget,
  CroConflictResolution,
  CroOrderingOperation,
} from "../action_ontology/types.js";
import { croStableKey } from "./ordering.js";
import type { CroConflictAssessment } from "./types.js";

interface PlacementRef {
  readonly contextKey: string;
  readonly coordinate: string;
  readonly component: CroComponentTarget;
  readonly conflict: CroConflictResolution;
  readonly destructive: boolean;
}

function componentKey(component: CroComponentTarget): string {
  return croStableKey(component);
}

function coordinate(ordering: CroOrderingOperation): string {
  if (ordering.kind === "SET_POSITION") {
    return "position:" + ordering.position;
  }
  return (
    (ordering.kind === "PLACE_BEFORE" ? "before:" : "after:") +
    componentKey(ordering.referenceComponent)
  );
}

function placementRef(action: Action): PlacementRef | undefined {
  if (action.parameters.kind !== "cro_intervention") return undefined;
  const contextKey = croStableKey({
    surface: action.parameters.surface,
    pageScope: action.parameters.pageScope,
    device: action.parameters.device,
  });

  if (
    action.parameters.intervention === "REORDER" &&
    action.parameters.ordering
  ) {
    return {
      contextKey,
      coordinate: coordinate(action.parameters.ordering),
      component: action.parameters.component,
      conflict: action.parameters.conflictResolution,
      destructive: false,
    };
  }

  if (action.parameters.intervention === "REMOVE") {
    return {
      contextKey,
      coordinate: "component:" + componentKey(action.parameters.component),
      component: action.parameters.component,
      conflict: action.parameters.conflictResolution,
      destructive: true,
    };
  }

  if (action.parameters.intervention === "ADD") {
    return {
      contextKey,
      coordinate: "add:" + componentKey(action.parameters.component),
      component: action.parameters.component,
      conflict: action.parameters.conflictResolution,
      destructive: false,
    };
  }
}

function resolveConflict(
  leftAction: Action,
  rightAction: Action,
  left: CroConflictResolution,
  right: CroConflictResolution,
): CroConflictAssessment {
  if (
    left.kind === "PRECEDENCE" &&
    right.kind === "PRECEDENCE" &&
    left.precedence !== right.precedence
  ) {
    return {
      status: "RESOLVABLE",
      strategy: "PRECEDENCE",
      winnerActionId:
        left.precedence > right.precedence
          ? leftAction.actionId
          : rightAction.actionId,
    };
  }
  if (
    left.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    right.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    left.groupId === right.groupId
  ) {
    const winnerActionId =
      left.precedence !== undefined &&
      right.precedence !== undefined &&
      left.precedence !== right.precedence
        ? left.precedence > right.precedence
          ? leftAction.actionId
          : rightAction.actionId
        : undefined;
    return {
      status: "RESOLVABLE",
      strategy: "MUTUALLY_EXCLUSIVE_GROUP",
      groupId: left.groupId,
      ...(winnerActionId ? { winnerActionId } : {}),
    };
  }
  return { status: "AMBIGUOUS", code: "CRO_PAGE_STRUCTURE_CONFLICT" };
}

export function assessCroConflict(
  leftAction: Action,
  rightAction: Action,
): CroConflictAssessment {
  const left = placementRef(leftAction);
  const right = placementRef(rightAction);
  if (!left || !right || left.contextKey !== right.contextKey) {
    return { status: "COEXIST" };
  }

  const sameCoordinate = left.coordinate === right.coordinate;
  const sameComponent =
    componentKey(left.component) === componentKey(right.component);

  if (
    (sameCoordinate && !sameComponent) ||
    (sameComponent && (left.destructive || right.destructive)) ||
    (sameCoordinate && sameComponent && left.coordinate.startsWith("add:"))
  ) {
    return resolveConflict(
      leftAction,
      rightAction,
      left.conflict,
      right.conflict,
    );
  }

  return { status: "COEXIST" };
}
