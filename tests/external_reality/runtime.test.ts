import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../src/simulation/kernel.js";
import { EXTERNAL_REALITY_MODEL_VERSION, ExternalRealityRuntime, type ExternalEnvironment } from "../../src/external_reality/index.js";

const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}T00:00:00Z`;
const environment: ExternalEnvironment = {
  version: EXTERNAL_REALITY_MODEL_VERSION, seed: 42,
  events: [{ id: "competitor-sale", domain: "competition", kind: "promotion", startsAt: day(3), endsAt: day(6),
    effects: [{ target: "purchase_propensity", logMultiplier: Math.log(0.8), scope: { markets: ["QC"] } }],
    observation: { availableAt: day(5), signal: "competitor discount detected" } }],
};

describe("external reality foundation", () => {
  it("keeps effects scoped to their configured interval and market, with delayed observations", () => {
    const clock = new SimulationClock({ startTime: day(1), endTime: day(10) });
    const runtime = new ExternalRealityRuntime(environment, clock);
    expect(runtime.multiplier("purchase_propensity", { market: "QC" })).toBe(1);
    clock.advanceTo(Date.parse(day(4)));
    expect(runtime.multiplier("purchase_propensity", { market: "QC" })).toBeCloseTo(0.8);
    expect(runtime.multiplier("purchase_propensity", { market: "ON" })).toBe(1);
    expect(runtime.observations()).toEqual([]);
    clock.advanceTo(Date.parse(day(5)));
    expect(runtime.observations()).toEqual([{ eventId: "competitor-sale", availableAt: day(5), signal: "competitor discount detected" }]);
    clock.advanceTo(Date.parse(day(6)));
    expect(runtime.multiplier("purchase_propensity", { market: "QC" })).toBe(1);
  });
  it("replays domain streams identically without cross-domain draw coupling", () => {
    const clock = new SimulationClock({ startTime: day(1), endTime: day(10) });
    const a = new ExternalRealityRuntime(environment, clock);
    const b = new ExternalRealityRuntime(environment, clock);
    const value = a.draw("competition", "launch-1");
    a.draw("weather", "storm-1");
    expect(a.draw("competition", "launch-1")).toBe(value);
    expect(b.draw("competition", "launch-1")).toBe(value);
  });
});
