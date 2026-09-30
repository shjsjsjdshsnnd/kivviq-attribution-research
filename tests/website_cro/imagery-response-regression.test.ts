import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { healthyWebsiteState, healthyWebsiteScenario, weakProductImageryScenario, IMPROVE_PDP_IMAGERY } from "../../src/website_cro/adversarial.js";
import { websitePageExperience, resolveWebsiteState } from "../../src/website_cro/runtime.js";
import { websitePageExperience as legacyPage, resolveWebsiteState as legacyState } from "../../src/website_cro/runtime-v1.js";
import { WEBSITE_RUNTIME_REVISION, WEAK_PDP_IMAGERY_THRESHOLD, pdpImageryConfidenceFactor } from "../../src/website_cro/runtime-revision.js";
import { serializeWebsiteScenario, websiteScenarioFingerprint } from "../../src/website_cro/fingerprint.js";
import type { WebsiteScenario } from "../../src/website_cro/types.js";

const START = "2026-01-01T00:00:00.000Z";
const CUSTOMER = { customerId: "step12-contract-customer", intent: 0.72, need: 0.68, brandAffinity: 0.62,
  priceSensitivityMultiplier: 1, promotionSensitivityMultiplier: 1, purchaseCount: 0 };
type Input = Parameters<typeof websitePageExperience>[0];
function input(scenario: WebsiteScenario | undefined, overrides: Partial<Input> = {}): Input {
  return { scenario, timestampMs: Date.parse(START), component: "pdp", device: "mobile", customer: CUSTOMER,
    productPriceMinor: 25000, expectedAovMinor: 25000, ...overrides };
}
function configured(imagery: number, importance = 0.72): WebsiteScenario {
  const state = healthyWebsiteState(START);
  return { scenarioId: "synthetic-imagery-control", states: [{ ...state, pdp: { ...state.pdp, imageryQuality: imagery },
    categorySensitivity: [{ categoryId: "visual-category", imageryImportance: importance,
      informationImportance: 0.72, trustImportance: 0.62, deliveryImportance: 0.6 }] }] };
}

describe("PDP imagery runtime correction", () => {
  it("preserves the exact pre-correction runtime as the differential reference", () => {
    const bytes = readFileSync(new URL("../../src/website_cro/runtime-v1.ts", import.meta.url));
    const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    expect(blob).toBe("6ff2cc1d4810548ce70de7e435f4218b1df48028");
  });
  it("reproduces the inherited failure then satisfies its unchanged minimum-effect contract", () => {
    const weak = weakProductImageryScenario(START), fixed = { ...weak, interventions: [IMPROVE_PDP_IMAGERY] };
    const legacyGap = legacyPage(input(fixed))!.transitionMultiplier - legacyPage(input(weak))!.transitionMultiplier;
    expect(legacyGap).toBeCloseTo(0.027118619084284035, 12);
    const corrected = websitePageExperience(input(fixed))!.transitionMultiplier - websitePageExperience(input(weak))!.transitionMultiplier;
    expect(corrected).toBeGreaterThan(0.05);
    expect(corrected).toBeCloseTo(0.08824642254096582, 12);
  });
  it("makes no-website and every non-PDP component exactly match the pre-correction behavior", () => {
    expect(websitePageExperience(input(undefined))).toBeUndefined();
    for (const component of ["homepage", "navigation", "collection", "search", "cart", "checkout"] as const) {
      const request = input(weakProductImageryScenario(START), { component });
      expect(websitePageExperience(request)).toEqual(legacyPage(request));
    }
  });
  it("leaves acceptable imagery exactly unchanged across devices and price points", () => {
    for (const quality of [0.52, 0.6, 0.91, 0.96, 1]) {
      for (const device of ["mobile", "desktop", "tablet"] as const) {
        for (const price of [1000, 25000, 100000]) {
          const request = input(configured(quality), { device, productPriceMinor: price });
          expect(websitePageExperience(request)).toEqual(legacyPage(request));
        }
      }
    }
  });
  it("is identity at zero importance and increases the defect only with category sensitivity", () => {
    const zero = input(configured(0.24, 0), { categoryId: "visual-category" });
    expect(websitePageExperience(zero)).toEqual(legacyPage(zero));
    expect(pdpImageryConfidenceFactor(0.24, 0)).toBe(1);
    expect(pdpImageryConfidenceFactor(0.24, 1)).toBeLessThan(pdpImageryConfidenceFactor(0.24, 0.3));
  });
  it("uses effective product imagery, not only the site default", () => {
    const healthy = healthyWebsiteState(START);
    const hiddenDefect: WebsiteScenario = { scenarioId: "product-override", states: [{ ...healthy,
      productPresentation: [{ productId: "weak-sku", imageryQuality: 0.24 }] }] };
    const request = input(hiddenDefect, { productId: "weak-sku" });
    expect(websitePageExperience(request)!.transitionMultiplier).toBeLessThan(legacyPage(request)!.transitionMultiplier);
    const other = input(hiddenDefect, { productId: "other-sku" });
    expect(websitePageExperience(other)).toEqual(legacyPage(other));
    const weak = weakProductImageryScenario(START);
    const healthyOverride: WebsiteScenario = { ...weak, states: [{ ...weak.states[0]!,
      productPresentation: [{ productId: "healthy-sku", imageryQuality: 0.91 }] }] };
    const overridden = input(healthyOverride, { productId: "healthy-sku" });
    expect(websitePageExperience(overridden)).toEqual(legacyPage(overridden));
  });
  it("respects intervention activation and device targeting without changing resolved state", () => {
    const weak = weakProductImageryScenario(START);
    const scenario: WebsiteScenario = { ...weak, interventions: [{ ...IMPROVE_PDP_IMAGERY,
      effectiveAt: "2026-01-02T00:00:00.000Z", population: { devices: ["mobile"] } }] };
    const before = input(scenario);
    expect(websitePageExperience(before)).toEqual(websitePageExperience(input(weak)));
    const after = input(scenario, { timestampMs: Date.parse("2026-01-03T00:00:00.000Z") });
    expect(websitePageExperience(after)).toEqual(legacyPage(after));
    const desktop = { ...after, device: "desktop" as const };
    expect(websitePageExperience(desktop)!.transitionMultiplier).toBeLessThan(legacyPage(desktop)!.transitionMultiplier);
    expect(resolveWebsiteState(scenario, after.timestampMs, "mobile")).toEqual(legacyState(scenario, after.timestampMs, "mobile"));
  });
  it("is monotone and bounded over 1,001 imagery qualities in each of three categories", () => {
    for (const importance of [0, 0.3, 1]) {
      let previousFactor = 0, previousResponse = 0;
      for (let index = 0; index <= 1000; index++) {
        const quality = index / 1000, factor = pdpImageryConfidenceFactor(quality, importance);
        expect(factor).toBeGreaterThanOrEqual(1 - WEAK_PDP_IMAGERY_THRESHOLD ** 2);
        expect(factor).toBeLessThanOrEqual(1);
        expect(factor).toBeGreaterThanOrEqual(previousFactor);
        const page = websitePageExperience(input(configured(quality, importance), { categoryId: "visual-category" }))!;
        expect(page.transitionMultiplier).toBeGreaterThanOrEqual(previousResponse);
        expect(page.transitionMultiplier).toBeGreaterThanOrEqual(0.08);
        expect(page.transitionMultiplier).toBeLessThanOrEqual(1.18);
        expect(page.continuationMultiplier).toBeGreaterThanOrEqual(0.04);
        expect(page.continuationMultiplier).toBeLessThanOrEqual(1.18);
        previousFactor = factor; previousResponse = page.transitionMultiplier;
      }
    }
  });
  it("has no discontinuity or cliff at the existing diagnostic boundary", () => {
    const epsilon = 1e-6;
    expect(pdpImageryConfidenceFactor(0.52, 1)).toBe(1);
    expect(1 - pdpImageryConfidenceFactor(0.52 - epsilon, 1)).toBeLessThan(2e-12);
    expect(pdpImageryConfidenceFactor(0.52 + epsilon, 1)).toBe(1);
  });
  it("does not manufacture new frictions or modify timing/load-failure evidence", () => {
    const request = input(configured(0.24)), original = structuredClone(request);
    const legacy = legacyPage(request)!, corrected = websitePageExperience(request)!;
    expect({ ...corrected, continuationMultiplier: legacy.continuationMultiplier, transitionMultiplier: legacy.transitionMultiplier }).toEqual(legacy);
    expect(request).toEqual(original);
    expect(websitePageExperience(request)).toEqual(corrected);
  });
  it("versions the response change inside the serialized scenario and its fingerprint", () => {
    const scenario = healthyWebsiteScenario(START);
    const payload = JSON.parse(serializeWebsiteScenario(scenario)) as { runtimeRevision: string; modelVersion: string; schemaVersion: number };
    expect(payload.runtimeRevision).toBe(WEBSITE_RUNTIME_REVISION);
    expect(payload.modelVersion).toBe("website_model_v1");
    expect(payload.schemaVersion).toBe(1);
    const text = serializeWebsiteScenario(scenario).replace(`"runtimeRevision":"${WEBSITE_RUNTIME_REVISION}",`, "");
    let hash = 0x811c9dc5;
    for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
    const oldFingerprint = `website_model_v1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
    expect(websiteScenarioFingerprint(scenario)).not.toBe(oldFingerprint);
    expect(websiteScenarioFingerprint(scenario)).toBe(websiteScenarioFingerprint(structuredClone(scenario)));
  });
  it("rejects invalid synthetic quality parameters instead of silently creating NaN", () => {
    for (const value of [NaN, Infinity, -0.1, 1.1]) {
      expect(() => pdpImageryConfidenceFactor(value, 0.72)).toThrow(RangeError);
      expect(() => pdpImageryConfidenceFactor(0.24, value)).toThrow(RangeError);
    }
  });
});
