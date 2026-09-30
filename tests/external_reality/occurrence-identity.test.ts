import { describe, expect, it, vi } from "vitest";
import { ExternalRealityRuntime, EXTERNAL_REALITY_MODEL_VERSION, EXTERNAL_APPLICATION_IDENTITY_VERSION,
  type ExternalEnvironment } from "../../src/external_reality/index.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import { buildExternalValidationPair } from "../../src/evaluation/domain-validation-suite.js";
import { SimulationClock } from "../../src/simulation/kernel.js";

const START = "2026-01-01T00:00:00.000Z", END = "2026-04-01T00:00:00.000Z";
function runtime() {
  const environment: ExternalEnvironment = { version: EXTERNAL_REALITY_MODEL_VERSION, environmentId: "recurring-needs", seed: 1441,
    events: [{ id: "demand", domain: "consumer", kind: "consumer_trend", startsAt: START, endsAt: END,
      effects: [{ target: "demand", logMultiplier: Math.log(2) }, { target: "purchase_propensity", logMultiplier: Math.log(1.2) }] }] };
  return new ExternalRealityRuntime(environment, new SimulationClock({ startTime: START, endTime: END }));
}
describe("external effect occurrence identity", () => {
  it("allows a recurring logical need on different dates without changing its multiplier", () => {
    const r = runtime();
    for (const time of [Date.parse(START), Date.parse(START) + 86400000]) {
      expect(r.applyOccurrenceAt("need:c1:10002:demand", "demand", time)).toBe(2);
    }
    expect(r.applications()).toHaveLength(2);
    expect(new Set(r.applications().map(e => e.applicationId)).size).toBe(2);
    expect(r.applications().every(e => e.applicationId.startsWith(EXTERNAL_APPLICATION_IDENTITY_VERSION))).toBe(true);
  });
  it("keeps idempotence for repeat evaluation of the same occurrence", () => {
    const r = runtime(), t = Date.parse(START);
    r.applyOccurrenceAt("same", "demand", t); r.applyOccurrenceAt("same", "demand", t);
    expect(r.applications()).toHaveLength(1);
  });
  it("still rejects conflicting target/context resolutions at the same occurrence", () => {
    const r = runtime(), t = Date.parse(START);
    r.applyOccurrenceAt("same", "demand", t, { market: "QC" });
    expect(() => r.applyOccurrenceAt("same", "purchase_propensity", t, { market: "QC" })).toThrow(/reused/);
    expect(() => r.applyOccurrenceAt("same", "demand", t, { market: "ON" })).toThrow(/reused/);
    expect(r.applications()).toHaveLength(1);
  });
  it("does not weaken strict legacy applyAt or alter its original IDs", () => {
    const r = runtime(), t = Date.parse(START);
    r.applyAt("globally-unique", "demand", t);
    expect(r.applications()[0]!.applicationId).toBe("globally-unique");
    expect(() => r.applyAt("globally-unique", "demand", t + 86400000)).toThrow(/reused/);
  });
  it("does not change random draws and preserves occurrence identity when future applications are added", () => {
    const a = runtime(), b = runtime(), t = Date.parse(START);
    const before = a.draw("consumer", "fixed");
    a.applyOccurrenceAt("need", "demand", t);
    b.applyOccurrenceAt("need", "demand", t);
    b.applyOccurrenceAt("need", "demand", t + 86400000);
    expect(a.draw("consumer", "fixed")).toBe(before);
    expect(b.draw("consumer", "fixed")).toBe(before);
    expect(b.applications()[0]).toEqual(a.applications()[0]);
  });
  it("rejects blank labels and invalid times, and does not invent inactive applications", () => {
    const r = runtime();
    for (const label of ["", "   "]) expect(() => r.applyOccurrenceAt(label, "demand", Date.parse(START))).toThrow();
    for (const time of [NaN, Infinity, -Infinity]) expect(() => r.applyOccurrenceAt("need", "demand", time)).toThrow();
    expect(r.applyOccurrenceAt("inactive", "demand", Date.parse(END))).toBe(1);
    expect(r.applications()).toHaveLength(0);
  });
});


describe("kernel occurrence repair preserves successful legacy behavior", () => {
  it("changes only diagnostic IDs, not purchases, events or platform totals in a previously executable world", () => {
    const request = buildExternalValidationPair(141).treatment;
    const repaired = simulateWorld(request);
    const spy = vi.spyOn(ExternalRealityRuntime.prototype, "applyOccurrenceAt").mockImplementation(function (this: ExternalRealityRuntime, label, target, time, context) {
      return this.applyAt(label, target, time, context);
    });
    try {
      const legacy = simulateWorld(request);
      expect(repaired.observableEvents).toEqual(legacy.observableEvents);
      expect(repaired.purchases).toEqual(legacy.purchases);
      expect(repaired.platformMetrics).toEqual(legacy.platformMetrics);
      expect(repaired.totals).toEqual(legacy.totals);
      expect(repaired.godMode.externalReality!.applications.map(({ applicationId: _id, ...effect }) => effect))
        .toEqual(legacy.godMode.externalReality!.applications.map(({ applicationId: _id, ...effect }) => effect));
    } finally { spy.mockRestore(); }
  }, 90000);
});
