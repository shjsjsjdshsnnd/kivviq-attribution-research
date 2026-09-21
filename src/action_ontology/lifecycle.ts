import type { Action, ActionState } from "./types.js";

const ALLOWED_TRANSITIONS: Readonly<Record<ActionState, readonly ActionState[]>> = {
  PROPOSED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["SCHEDULED", "IMPLEMENTED", "CANCELLED"],
  REJECTED: [],
  SCHEDULED: ["IMPLEMENTED", "CANCELLED", "FAILED"],
  IMPLEMENTED: ["ACTIVE", "COMPLETED", "REVERSED", "FAILED"],
  ACTIVE: ["COMPLETED", "REVERSED", "FAILED"],
  COMPLETED: [],
  REVERSED: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransitionActionState(
  from: ActionState,
  to: ActionState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertActionStateTransition(
  from: ActionState,
  to: ActionState,
): void {
  if (!canTransitionActionState(from, to)) {
    throw new Error(`Invalid Action lifecycle transition: ${from} -> ${to}`);
  }
}

export function transitionActionState(
  action: Action,
  to: ActionState,
): Action {
  assertActionStateTransition(action.state, to);
  return {
    ...action,
    state: to,
  };
}
