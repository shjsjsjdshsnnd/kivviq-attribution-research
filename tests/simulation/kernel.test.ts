import { describe, expect, it } from "vitest";
import {
  SharedRandomness,
  SimulationClock,
  SimulationEventQueue,
} from "../../src/simulation/kernel.js";

describe("Step 4 simulation kernel", () => {
  it("orders events by timestamp, priority, sequence and never moves time backward", () => {
    const queue = new SimulationEventQueue();
    queue.schedule({
      id: "later",
      kind: "need_formation",
      timestampMs: 2_000,
      priority: 10,
      payload: null,
    });
    queue.schedule({
      id: "same-low-priority",
      kind: "need_formation",
      timestampMs: 1_000,
      priority: 20,
      payload: null,
    });
    queue.schedule({
      id: "same-high-priority",
      kind: "need_formation",
      timestampMs: 1_000,
      priority: 5,
      payload: null,
    });

    expect(queue.pop()!.id).toBe("same-high-priority");
    expect(queue.pop()!.id).toBe("same-low-priority");
    expect(queue.pop()!.id).toBe("later");

    const clock = new SimulationClock({
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-02T00:00:00.000Z",
    });
    clock.advanceTo(Date.parse("2026-01-01T12:00:00.000Z"));
    expect(() =>
      clock.advanceTo(Date.parse("2026-01-01T11:00:00.000Z")),
    ).toThrow(/cannot move backward/);
  });

  it("uses semantic keyed randomness independent of call order", () => {
    const left = new SharedRandomness(123, "test");
    const a1 = left.uniform("customer-1/search");
    const b1 = left.uniform("customer-1/purchase");

    const right = new SharedRandomness(123, "test");
    const b2 = right.uniform("customer-1/purchase");
    const a2 = right.uniform("customer-1/search");

    expect(a2).toBe(a1);
    expect(b2).toBe(b1);
  });

  it("forks deterministic random namespaces", () => {
    const root = new SharedRandomness(456, "world");
    expect(root.fork("meta").uniform("x")).toBe(
      new SharedRandomness(456, "world/meta").uniform("x"),
    );
    expect(root.fork("meta").uniform("x")).not.toBe(
      root.fork("google").uniform("x"),
    );
  });
});
