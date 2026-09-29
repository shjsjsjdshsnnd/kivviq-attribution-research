import { actionConflictDefinitionSchema, type ActionConflictDefinition } from "./schema.js";

/** Accepts only a complete native-shaped registered projection; never infers targets from labels or prose. */
export function adaptLegacyConflict(input: unknown): ActionConflictDefinition | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input) || (input as Record<string, unknown>)["kind"] !== "EXACT_REGISTERED_CONFLICT") return undefined;
  const { kind: _marker, ...candidate } = input as Record<string, unknown>;
  const parsed = actionConflictDefinitionSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
