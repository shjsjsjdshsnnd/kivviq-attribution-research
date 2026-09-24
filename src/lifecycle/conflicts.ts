import type { Action } from "../action_ontology/types.js";
import type { LifecycleFlowConflictAssessment } from "./types.js";

function flowDefinition(action: Action) {
  if (action.parameters.kind !== "lifecycle_flow_start") return undefined;
  return action.parameters.definition;
}

function firstContactCoordinate(action: Action): string | undefined {
  const definition = flowDefinition(action);
  if (!definition) return undefined;
  const step = definition.sequence[0];
  if (!step) return undefined;
  const channel =
    step.channel.kind === "CUSTOM"
      ? "CUSTOM:" + step.channel.channelId
      : step.channel.kind;
  return JSON.stringify({
    trigger: definition.trigger,
    delaySeconds: step.delaySeconds,
    channel,
  });
}

export function assessLifecycleFlowConflict(
  leftAction: Action,
  rightAction: Action,
): LifecycleFlowConflictAssessment {
  const left = flowDefinition(leftAction);
  const right = flowDefinition(rightAction);
  if (!left || !right) return { status: "COEXIST" };

  const sameCoordinate =
    firstContactCoordinate(leftAction) ===
    firstContactCoordinate(rightAction);
  if (!sameCoordinate) return { status: "COEXIST" };

  if (
    left.conflictResolution.kind === "COEXIST" &&
    right.conflictResolution.kind === "COEXIST"
  ) {
    return { status: "COEXIST" };
  }

  if (
    left.conflictResolution.kind === "PRECEDENCE" &&
    right.conflictResolution.kind === "PRECEDENCE" &&
    left.conflictResolution.precedence !==
      right.conflictResolution.precedence
  ) {
    return {
      status: "RESOLVABLE",
      strategy: "PRECEDENCE",
      winnerActionId:
        left.conflictResolution.precedence >
        right.conflictResolution.precedence
          ? leftAction.actionId
          : rightAction.actionId,
    };
  }

  if (
    left.conflictResolution.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    right.conflictResolution.kind === "MUTUALLY_EXCLUSIVE_GROUP" &&
    left.conflictResolution.groupId === right.conflictResolution.groupId
  ) {
    const winnerActionId =
      left.conflictResolution.precedence !== undefined &&
      right.conflictResolution.precedence !== undefined &&
      left.conflictResolution.precedence !==
        right.conflictResolution.precedence
        ? left.conflictResolution.precedence >
          right.conflictResolution.precedence
          ? leftAction.actionId
          : rightAction.actionId
        : undefined;
    return {
      status: "RESOLVABLE",
      strategy: "MUTUALLY_EXCLUSIVE_GROUP",
      groupId: left.conflictResolution.groupId,
      ...(winnerActionId ? { winnerActionId } : {}),
    };
  }

  if (
    left.conflictResolution.kind ===
      "SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS" ||
    right.conflictResolution.kind ===
      "SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS"
  ) {
    return {
      status: "RESOLVABLE",
      strategy: "CONTACT_POLICY",
    };
  }

  return {
    status: "AMBIGUOUS",
    code: "LIFECYCLE_FLOW_CONTACT_CONFLICT",
  };
}
