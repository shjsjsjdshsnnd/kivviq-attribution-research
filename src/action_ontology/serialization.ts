import {
  ACTION_SCHEMA_VERSION,
  SUPPORTED_ACTION_SCHEMA_VERSIONS,
  type Action,
} from "./types.js";
import {
  assertValidAction,
  type ActionValidationOptions,
} from "./validation.js";
import { canonicalizeForSerialization } from "./semantics.js";

export function serializeAction(action: Action): string {
  const validated = assertValidAction(action);
  return JSON.stringify(canonicalizeForSerialization(validated));
}

export function deserializeAction(
  serialized: string,
  options: ActionValidationOptions = {},
): Action {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError("Serialized Action must be valid JSON");
  }
  return assertValidAction(parsed, options);
}

export function isSupportedActionSchemaVersion(version: string): boolean {
  return SUPPORTED_ACTION_SCHEMA_VERSIONS.includes(version as never);
}

/**
 * Migrations must be explicit. Step 1 intentionally ships no implicit
 * reinterpretation path for unsupported Action schema versions.
 */
export function migrateSerializedAction(
  _serialized: string,
  fromVersion: string,
  toVersion: string,
): never {
  throw new Error(
    "No Action migration registered from " +
      fromVersion +
      " to " +
      toVersion,
  );
}
