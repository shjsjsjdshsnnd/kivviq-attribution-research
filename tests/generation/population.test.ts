import { describe, expect, it } from "vitest";
import {
  COMPLEXITY_LEVELS,
  MERCHANT_ARCHETYPES,
  MERCHANT_SCALES,
  type MerchantGenerationConfig,
} from "../../src/generation/config.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";

function generatedPopulation(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const config: MerchantGenerationConfig = {
      seed: index + 10_000,
      archetype:
        MERCHANT_ARCHETYPES[index % MERCHANT_ARCHETYPES.length]!,
      scale: MERCHANT_SCALES[
        Math.floor(index / MERCHANT_ARCHETYPES.length) %
          MERCHANT_SCALES.length
      ]!,
      complexity:
        COMPLEXITY_LEVELS[
          Math.floor(
            index /
              (MERCHANT_ARCHETYPES.length * MERCHANT_SCALES.length),
          ) % COMPLEXITY_LEVELS.length
        ]!,
    };
    return generateMerchantWorldRecord(config);
  });
}

describe("merchant generator population properties", () => {
  it("generates 1,000 valid worlds with no invalid causal/accounting structures", () => {
    const worlds = generatedPopulation(1_000);

    for (const world of worlds) {
      expect(() =>
        validateGroundTruthManifest(world.manifest),
      ).not.toThrow();
      expect(Number.isFinite(world.summary.expectedAovMinor)).toBe(true);
      expect(Number.isFinite(world.summary.repeatProbability)).toBe(true);
      expect(world.summary.skuCount).toBeGreaterThanOrEqual(4);
      expect(world.summary.grossMarginRate).toBeGreaterThan(0);
      expect(world.summary.grossMarginRate).toBeLessThan(1);
      expect(world.summary.repeatProbability).toBeGreaterThanOrEqual(0);
      expect(world.summary.repeatProbability).toBeLessThanOrEqual(1);
      expect(world.summary.mobileTrafficShare).toBeGreaterThan(0);
      expect(world.summary.mobileTrafficShare).toBeLessThan(1);
      expect(world.manifest.inventoryMechanisms.every(
        (inventory) =>
          inventory.initialAvailableUnits >= 0 &&
          inventory.initialReservedUnits >= 0 &&
          inventory.initialReservedUnits <= inventory.initialAvailableUnits,
      )).toBe(true);
    }
  }, 30_000);

  it("does not collapse into a single disguised merchant template", () => {
    const worlds = generatedPopulation(1_000);
    const signature = (index: number) => {
      const summary = worlds[index]!.summary;
      return [
        summary.archetype,
        summary.scale,
        summary.aovProfile,
        summary.catalogProfile,
        summary.promotionProfile,
        summary.inventoryProfile,
        summary.seasonalityProfile,
        Math.round(summary.expectedAovMinor / 500),
        summary.skuCount,
        Math.round(summary.repeatProbability * 20),
        summary.activeChannels.join(","),
      ].join("|");
    };

    const signatures = new Set(worlds.map((_, index) => signature(index)));
    expect(signatures.size / worlds.length).toBeGreaterThan(0.97);

    expect(
      new Set(worlds.map((world) => world.summary.activeChannels.length)).size,
    ).toBeGreaterThanOrEqual(4);
    expect(
      new Set(worlds.map((world) => world.summary.catalogProfile)).size,
    ).toBeGreaterThanOrEqual(5);
    expect(
      new Set(worlds.map((world) => world.summary.seasonalityProfile)).size,
    ).toBeGreaterThanOrEqual(6);
    expect(
      new Set(
        worlds.map((world) =>
          Math.round(world.summary.productConcentrationTop5 * 100),
        ),
      ).size,
    ).toBeGreaterThan(20);
  });

  it("preserves meaningful seed-driven variation within one archetype", () => {
    const furniture = Array.from({ length: 120 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 50_000 + index,
        archetype: "furniture",
        scale: "growth",
        complexity: "normal",
      }),
    );

    expect(
      new Set(furniture.map((world) => world.summary.expectedAovMinor)).size,
    ).toBeGreaterThan(100);
    expect(
      new Set(furniture.map((world) => world.summary.skuCount)).size,
    ).toBeGreaterThan(30);
    expect(
      new Set(furniture.map((world) => world.summary.promotionProfile)).size,
    ).toBeGreaterThanOrEqual(4);
    expect(
      new Set(furniture.map((world) => world.summary.activeChannels.join(",")))
        .size,
    ).toBeGreaterThan(20);
  });
});
