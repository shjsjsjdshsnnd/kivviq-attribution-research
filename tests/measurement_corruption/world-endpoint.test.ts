import { describe, expect, it, vi } from "vitest";
import { createObservedWorldEndpoint } from "../../src/evaluation/observed-world-endpoint.js";
import { OBSERVED_WORLD_PROTOCOL_VERSION as version, MAX_OBSERVED_REQUEST_CHARACTERS,
  parseObservedWorldResponse } from "../../src/observation/world-protocol.js";
import type { CorruptedObservation } from "../../src/observation/corrupted-world.js";

const observation: CorruptedObservation = { schemaVersion: "corrupted-observation/1.0.0",
  asOf: "2026-01-01T00:00:00.000Z", events: [], orders: [], platformReports: [] };
const request = (operation = "observe", fields = {}) => JSON.stringify({ version, operation, ...fields });
function setup() {
  const handle = { observe: vi.fn(() => structuredClone(observation)), step: vi.fn(() => structuredClone(observation)) };
  return { handle, endpoint: createObservedWorldEndpoint(handle) };
}

describe("observed-only JSON capability boundary", () => {
  it("exposes only validated observation JSON and passes the registered action ID", () => {
    const { handle, endpoint } = setup();
    expect(parseObservedWorldResponse(JSON.parse(endpoint(request())))).toEqual({ version, ok: true, observation });
    expect(parseObservedWorldResponse(JSON.parse(endpoint(request("step", { actionId: "a1" })))).ok).toBe(true);
    expect(handle.step).toHaveBeenCalledExactlyOnceWith("a1");
  });
  it.each(["reset", "evaluatorSnapshot", "evaluatorSpendSnapshot", "fork", "oracle"])("does not grant %s through the transport", operation => {
    const { handle, endpoint } = setup();
    expect(JSON.parse(endpoint(request(operation)))).toEqual({ version, ok: false, error: "INVALID_REQUEST" });
    expect(handle.observe).not.toHaveBeenCalled(); expect(handle.step).not.toHaveBeenCalled();
  });
  it.each(["seed", "truth", "groundTruth", "scenarioId", "checkpoint", "budgetAdjustments", "interventions", "__proto__"])("rejects extra request capability %s", field => {
    const { handle, endpoint } = setup();
    expect(JSON.parse(endpoint(request("step", { actionId: "a1", [field]: "not-an-allowed-input" })))).toEqual({ version, ok: false, error: "INVALID_REQUEST" });
    expect(handle.step).not.toHaveBeenCalled();
  });
  it("rejects malformed, non-string, oversized and unknown-version input without invoking the world", () => {
    const { handle, endpoint } = setup();
    for (const input of [null, {}, 1, "{", "null", "[]", " ".repeat(MAX_OBSERVED_REQUEST_CHARACTERS + 1),
      JSON.stringify({ version: "other", operation: "observe" }), request("step"), request("step", { actionId: 1 })]) {
      expect(JSON.parse(endpoint(input)).error).toBe("INVALID_REQUEST");
    }
    expect(handle.observe).not.toHaveBeenCalled(); expect(handle.step).not.toHaveBeenCalled();
  });
  it("never serializes an evaluator error, cause, stack, or seed", () => {
    const secret = "hidden-salt-and-seed-123456789";
    const error = new Error(secret, { cause: { latentTruth: secret } });
    const endpoint = createObservedWorldEndpoint({ observe() { throw error; }, step() { throw error; } });
    for (const input of [request(), request("step", { actionId: "a1" })]) {
      const wire = endpoint(input);
      expect(wire).not.toContain(secret);
      expect(JSON.parse(wire)).toEqual({ version, ok: false, error: "OPERATION_FAILED" });
    }
  });
  it.each([["unregistered action", "UNKNOWN_ACTION"], ["world horizon exhausted", "HORIZON_EXHAUSTED"]])("maps %s to a stable public code", (message, code) => {
    const endpoint = createObservedWorldEndpoint({ observe() { throw new RangeError(message); }, step() { throw new RangeError(message); } });
    expect(JSON.parse(endpoint(request())).error).toBe(code);
  });
  it("fails closed on evaluator fields smuggled into an otherwise valid observation", () => {
    const invalid = { ...observation, latentTruth: { seed: 999 } };
    const endpoint = createObservedWorldEndpoint({ observe: () => invalid, step: () => invalid });
    expect(JSON.parse(endpoint(request()))).toEqual({ version, ok: false, error: "OPERATION_FAILED" });
  });
  it("validates nested fields and event chronology on the response boundary", () => {
    const invalid = { ...observation, orders: [{ orderId: "o1", occurredAt: observation.asOf,
      receivedAt: "2026-01-02T00:00:00.000Z", netSalesMinor: 100 }] };
    const endpoint = createObservedWorldEndpoint({ observe: () => invalid, step: () => invalid });
    expect(JSON.parse(endpoint(request())).error).toBe("OPERATION_FAILED");
    expect(() => parseObservedWorldResponse({ version, ok: false, error: "OPERATION_FAILED", stack: "secret" })).toThrow();
  });
});
