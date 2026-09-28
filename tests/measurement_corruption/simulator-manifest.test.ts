import { describe, expect, it } from "vitest";
import { runMeasuredWorld, operatorPayload, perfectFactsFromSimulation,
  type MeasurementRunOptions } from "../../src/evaluation/measured-world.js";
import { canonicalJson, sha256, createMeasuredManifest, replayMeasuredManifest,
  verifyManifest } from "../../src/evaluation/replay-manifest.js";
import { MEASUREMENT_VERSION } from "../../src/measurement_corruption/index.js";
import { zeroPaidSpendInterventions } from "../../src/simulation/counterfactual.js";
import { parseOperatorObservation } from "../../src/observation/corrupted-world.js";
import { baseAdversarialWorld, populationFor } from "../simulation/fixture.js";
import type { SimulateWorldRequest } from "../../src/simulation/types.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-04-01T00:00:00.000Z";
const REVISION = "0123456789abcdef0123456789abcdef01234567";
function inputs() {
  const merchantWorld = baseAdversarialWorld(64111);
  const request: SimulateWorldRequest = {
    merchantWorld, latentPopulation: populationFor(merchantWorld, 74111, 90),
    simulationSeed: 1410, startTime: START, endTime: END,
    interventions: zeroPaidSpendInterventions(merchantWorld),
    config: { maxEvents: 180000, maxSessionsPerCustomer: 16 },
  };
  const options: MeasurementRunOptions = {
    corruption: { version: MEASUREMENT_VERSION, seed: 88213,
      identitySalt: "private-synthetic-salt-for-replay", missingUtmRate: 0.2,
      cookieLossRate: 0.3, duplicateEventRate: 0.1 },
    asOf: END, platformSpend: [], scope: "explicit_simulated_agents",
  };
  return { request, options };
}

describe("real simulator measurement boundary", () => {
  it("reconciles observable server orders to actual agent purchases, not platform or weighted totals", () => {
    const { request, options } = inputs();
    const bundle = runMeasuredWorld(request, options);
    const purchases = bundle.latentTruth.simulation.purchases.filter(p => Date.parse(p.occurredAt) < Date.parse(END));
    expect(purchases.length).toBeGreaterThan(0);
    expect(bundle.corruptedObservation.orders).toHaveLength(purchases.length);
    expect(bundle.corruptedObservation.orders.reduce((n, p) => n + p.netSalesMinor, 0))
      .toBe(purchases.reduce((n, p) => n + p.netRevenueMinor, 0));
    expect(bundle.currency).toBe(request.merchantWorld.manifest.merchant.currency);
    expect(bundle.measurementScope).toBe("explicit_simulated_agents");
    for (const p of purchases) {
      expect(p.grossRevenueMinor - p.discountMinor).toBe(p.netRevenueMinor);
      expect(p.lines.reduce((n, line) => n + line.revenueMinor, 0)).toBe(p.netRevenueMinor);
      expect(p.netRevenueMinor - p.estimatedCogsMinor - p.paymentFeeMinor - p.shippingSubsidyMinor - p.fulfillmentMinor - p.allocatedMarketingSpendMinor)
        .toBe(p.contributionProfitMinor);
    }
  }, 45000);
  it("browser outages change observed events but not latent outcomes or server orders", () => {
    const { request, options } = inputs();
    const clean = runMeasuredWorld(request, options);
    const broken = runMeasuredWorld(request, { ...options,
      corruption: { ...options.corruption, blockedPixelRate: 1, consentExclusionRate: 1 } });
    expect(broken.latentTruth).toEqual(clean.latentTruth);
    expect(broken.perfectObservableTruth).toEqual(clean.perfectObservableTruth);
    expect(broken.corruptedObservation.events.every(e => e.origin !== "browser")).toBe(true);
    expect(broken.corruptedObservation.orders).toEqual(clean.corruptedObservation.orders);
    const wire = operatorPayload(broken);
    expect(() => parseOperatorObservation(JSON.parse(wire))).not.toThrow();
    for (const term of ["latentTruth", "godMode", "measurementDiagnostics", "simulationSeed", "purchaseIntent", "channelTraits", "private-synthetic-salt-for-replay"]) {
      expect(wire).not.toContain(term);
    }
  }, 45000);
  it("rejects a result from another seed rather than mislabelling its provenance", () => {
    const { request, options } = inputs();
    const bundle = runMeasuredWorld(request, options);
    expect(() => perfectFactsFromSimulation({ ...request, simulationSeed: 2 }, bundle.latentTruth.simulation, [])).toThrow();
  }, 45000);
});

describe("reproducibility manifests", () => {
  it("canonicalizes key order and rejects lossy or cyclic values", () => {
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    for (const value of [NaN, Infinity, () => 1, new Date(), new Map(), [undefined]]) {
      expect(() => canonicalJson(value)).toThrow();
    }
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
  });
  it("replays the full measured business and checks all three output hashes", () => {
    const { request, options } = inputs();
    const input = { scenarioId: "measurement-integration-control", scenarioVersion: "1", codeRevision: REVISION, request, options };
    const first = createMeasuredManifest(input);
    const second = createMeasuredManifest(input);
    expect(second.manifest).toEqual(first.manifest);
    const replayed = replayMeasuredManifest(JSON.parse(JSON.stringify(first.manifest)), REVISION);
    expect(operatorPayload(replayed)).toBe(operatorPayload(first.bundle));
    expect(replayed.latentTruth.simulation).toEqual(first.bundle.latentTruth.simulation);
    expect(first.manifest.payload.options.corruption.seed).toBe(88213);
    expect(first.manifest.payload.outputHashes.perfect).toBe(sha256(first.bundle.perfectObservableTruth));
    expect(operatorPayload(replayed)).not.toContain(first.manifest.sha256);
  }, 45000);
  it("rejects tampering, a wrong revision and self-rehashed but wrong output claims", () => {
    const { request, options } = inputs();
    const { manifest } = createMeasuredManifest({ scenarioId: "tamper-control", scenarioVersion: "1", codeRevision: REVISION, request, options });
    const changed = structuredClone(manifest);
    changed.payload.options.corruption.cookieLossRate = 1;
    expect(() => verifyManifest(changed, REVISION)).toThrow("integrity");
    expect(() => verifyManifest(manifest, "f".repeat(40))).toThrow("revision");
    const dishonest = structuredClone(manifest);
    dishonest.payload.outputHashes.corrupted = "0".repeat(64);
    dishonest.sha256 = sha256(dishonest.payload);
    expect(() => replayMeasuredManifest(dishonest, REVISION)).toThrow("does not match");
  }, 45000);
});
