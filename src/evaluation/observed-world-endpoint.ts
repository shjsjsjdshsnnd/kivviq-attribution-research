import { parseOperatorObservation } from "../observation/corrupted-world.js";
import { MAX_OBSERVED_REQUEST_CHARACTERS, OBSERVED_WORLD_PROTOCOL_VERSION,
  parseObservedWorldRequest, parseObservedWorldResponse,
  type ObservedWorldError, type ObservedWorldRequest } from "../observation/world-protocol.js";
import type { ObservedWorldHandle } from "./interactive-world.js";

/**
 * Evaluator-side JSON boundary, suitable for binding to an isolated transport.
 * The caller receives strings only, never a world/handle, diagnostics, errors,
 * stack traces, seeds, action definitions, checkpoints or scenario labels.
 * This is a capability/data boundary, NOT an OS sandbox for untrusted code.
 */
export function createObservedWorldEndpoint(handle: ObservedWorldHandle): (request: unknown) => string {
  const failure = (error: ObservedWorldError): string => JSON.stringify({
    version: OBSERVED_WORLD_PROTOCOL_VERSION, ok: false, error,
  });
  return (request: unknown): string => {
    let parsed: ObservedWorldRequest;
    try {
      if (typeof request !== "string" || request.length > MAX_OBSERVED_REQUEST_CHARACTERS) {
        return failure("INVALID_REQUEST");
      }
      parsed = parseObservedWorldRequest(JSON.parse(request));
    } catch { return failure("INVALID_REQUEST"); }
    try {
      const observation = parseOperatorObservation(parsed.operation === "observe"
        ? handle.observe() : handle.step(parsed.actionId));
      return JSON.stringify(parseObservedWorldResponse({
        version: OBSERVED_WORLD_PROTOCOL_VERSION, ok: true, observation,
      }));
    } catch (error) {
      if (error instanceof RangeError && error.message === "unregistered action") return failure("UNKNOWN_ACTION");
      if (error instanceof RangeError && error.message === "world horizon exhausted") return failure("HORIZON_EXHAUSTED");
      return failure("OPERATION_FAILED");
    }
  };
}
