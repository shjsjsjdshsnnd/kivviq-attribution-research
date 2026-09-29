import { z } from "zod";
import { operatorObservationSchema, parseOperatorObservation } from "./corrupted-world.js";

/** Operator-safe wire types. No evaluator, simulator, seed or reset capability. */
export const OBSERVED_WORLD_PROTOCOL_VERSION = "observed-world-protocol/1.0.0" as const;
export const MAX_OBSERVED_REQUEST_CHARACTERS = 4096;
const version = z.literal(OBSERVED_WORLD_PROTOCOL_VERSION);
export const observedWorldRequestSchema = z.discriminatedUnion("operation", [
  z.object({ version, operation: z.literal("observe") }).strict(),
  z.object({ version, operation: z.literal("step"), actionId: z.string().min(1).max(256) }).strict(),
]);
export type ObservedWorldRequest = z.infer<typeof observedWorldRequestSchema>;
export const observedWorldErrorSchema = z.enum([
  "INVALID_REQUEST", "UNKNOWN_ACTION", "HORIZON_EXHAUSTED", "OPERATION_FAILED",
]);
export type ObservedWorldError = z.infer<typeof observedWorldErrorSchema>;
export const observedWorldResponseSchema = z.discriminatedUnion("ok", [
  z.object({ version, ok: z.literal(true), observation: operatorObservationSchema }).strict(),
  z.object({ version, ok: z.literal(false), error: observedWorldErrorSchema }).strict(),
]);
export type ObservedWorldResponse = z.infer<typeof observedWorldResponseSchema>;

export function parseObservedWorldRequest(value: unknown): ObservedWorldRequest {
  return observedWorldRequestSchema.parse(value);
}

/** Recheck temporal invariants as well as the recursively strict field allowlist. */
export function parseObservedWorldResponse(value: unknown): ObservedWorldResponse {
  const parsed = observedWorldResponseSchema.parse(value);
  return parsed.ok ? { ...parsed, observation: parseOperatorObservation(parsed.observation) } : parsed;
}
