import { describe, expect, it } from "vitest";
import {
  generateMerchantWorldRecord,
} from "../../src/generation/generator.js";
import type { MerchantGenerationConfig } from "../../src/generation/config.js";
import { serializeGroundTruthManifest } from "../../src/ground_truth/manifest.js";

const baseConfig: MerchantGenerationConfig = {
  seed: 42,
  archetype: "furniture",
  scale: "mid_market",
  complexity: "complex",
};

describe("merchant generation determinism", () => {
  it("reproduces the identical world for identical version/seed/config", () => {
    const left = generateMerchantWorldRecord(baseConfig);
    const right = generateMerchantWorldRecord(baseConfig);

    expect(serializeGroundTruthManifest(left.manifest)).toBe(
      serializeGroundTruthManifest(right.manifest),
    );
    expect(left.provenance).toEqual(right.provenance);
    expect(left.summary).toEqual(right.summary);
  });

  it("produces meaningfully different worlds for different seeds", () => {
    const worlds = Array.from({ length: 25 }, (_, index) =>
      generateMerchantWorldRecord({
        ...baseConfig,
        seed: index + 1,
      }),
    );

    expect(new Set(worlds.map((world) => world.manifest.worldId)).size).toBe(25);
    expect(
      new Set(worlds.map((world) => world.summary.expectedAovMinor)).size,
    ).toBeGreaterThan(15);
    expect(
      new Set(worlds.map((world) => world.summary.skuCount)).size,
    ).toBeGreaterThan(10);
  });

  it("applies a forced zero-incrementality channel explicitly", () => {
    const world = generateMerchantWorldRecord({
      ...baseConfig,
      overrides: {
        forceZeroIncrementalityChannels: ["meta"],
      },
    });

    expect(world.summary.activeChannels).toContain("meta");
    const meta = world.manifest.channelIncrementality.find(
      (mechanism) => mechanism.channelId === "meta",
    );
    expect(meta).toBeDefined();
    expect(meta!.effect.value).toBe(0);
    expect(world.provenance.appliedOverrides).toContainEqual({
      field: "forceZeroIncrementalityChannels",
      value: ["meta"],
    });
  });

  it("honors mobile and seasonality overrides without mutating GroundTruth schema", () => {
    const world = generateMerchantWorldRecord({
      ...baseConfig,
      overrides: {
        mobileTrafficShare: 0.8,
        seasonalityProfile: "q4_heavy",
      },
    });

    expect(world.summary.mobileTrafficShare).toBe(0.8);
    expect(world.summary.seasonalityProfile).toBe("q4_heavy");
    expect(world.manifest).not.toHaveProperty("generationConfig");
    expect(world.manifest).not.toHaveProperty("mobileTrafficShare");
  });
});
