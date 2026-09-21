import type { Action } from "./types.js";
import {
  assertValidAction,
  type ActionValidationOptions,
} from "./validation.js";

export function serializeAction(action: Action): string {
  assertValidAction(action);
  return JSON.stringify(action);
}

export function deserializeAction(
  serialized: string,
  options: ActionValidationOptions = {},
): Action {
  const parsed: unknown = JSON.parse(serialized);
  return assertValidAction(parsed, options);
}

export function isBackwardCompatibleOntologyVersion(version: string): boolean {
  return /^1\.\d+\.\d+$/.test(version);
}
