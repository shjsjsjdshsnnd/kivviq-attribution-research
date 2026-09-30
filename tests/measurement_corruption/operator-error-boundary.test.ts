import { describe, expect, it } from "vitest";
import { InteractiveReplayWorld, type ObservedWorldHandle } from "../../src/evaluation/interactive-world.js";
import type { CorruptedObservation } from "../../src/observation/corrupted-world.js";

const safe: CorruptedObservation = {
  schemaVersion: "corrupted-observation/1.0.0",
  asOf: "2026-01-01T00:00:00.000Z", events: [], orders: [], platformReports: [],
};
function handleFor(backend: { observe(): unknown; step(id: string): unknown }): ObservedWorldHandle {
  // Test only the public transport facade with a hostile/failing evaluator backend.
  // No private world state or simulator fixtures are needed for this boundary test.
  return Reflect.apply(InteractiveReplayWorld.prototype.observedHandle, backend, []) as ObservedWorldHandle;
}
function caught(operation: () => unknown): Error {
  try { operation(); }
  catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error("expected the observed boundary to reject the operation");
}

describe("Operator-facing failure boundary", () => {
  it("replaces internal exceptions without forwarding their message, cause or hidden data", () => {
    const secret = "customer-982 latentIntent=0.82 oracleBest=mobile_checkout seed=88213";
    const backend = { observe: () => safe, step: () => { throw new Error(secret, { cause: { secret } }); } };
    const error = caught(() => handleFor(backend).step("set_price"));
    expect(error.message).toBe("OBSERVED_WORLD_OPERATION_FAILED");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(error.stack).not.toContain(secret);
  });
  it("revalidates results rather than trusting a backend claiming that truth is an observation", () => {
    const poisoned = { ...safe, latentTruth: { bestAction: "google", purchaseIntent: 0.82 } };
    const handle = handleFor({ observe: () => poisoned, step: () => poisoned });
    expect(caught(() => handle.observe()).message).toBe("OBSERVED_WORLD_OPERATION_FAILED");
    expect(caught(() => handle.step("no_op")).message).toBe("OBSERVED_WORLD_OPERATION_FAILED");
  });
  it("preserves only explicitly allowlisted public action errors", () => {
    for (const message of ["unregistered action", "world horizon exhausted"]) {
      const handle = handleFor({ observe: () => safe, step: () => { throw new RangeError(message); } });
      expect(caught(() => handle.step("bad")).message).toBe(message);
    }
    const internal = handleFor({ observe: () => safe, step: () => { throw new RangeError("hidden supplier coefficient 7"); } });
    expect(caught(() => internal.step("bad")).message).toBe("OBSERVED_WORLD_OPERATION_FAILED");
  });
});
