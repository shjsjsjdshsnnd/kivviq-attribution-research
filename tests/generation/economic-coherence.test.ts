import { describe, expect, it } from "vitest";
import {
  generateMerchantWorldRecord,
} from "../../src/generation/generator.js";

describe("merchant economic coherence", () => {
  it("reconciles expected annual revenue to expected orders × expected AOV", () => {
    for (let seed = 1; seed <= 250; seed += 1) {
      const world = generateMerchantWorldRecord({
        seed,
        archetype: seed % 2 === 0 ? "beauty_cosmetics" : "furniture",
        scale: seed % 3 === 0 ? "mid_market" : "growth",
        complexity: "complex",
      });

      expect(world.summary.annualRevenuePotentialMinor).toBe(
        world.summary.expectedAnnualOrders *
          world.summary.expectedAovMinor,
      );
      expect(world.summary.expectedContributionMarginRate).toBeGreaterThan(-0.6);
      expect(world.summary.expectedContributionMarginRate).toBeLessThan(0.85);
    }
  });

  it("keeps product, inventory and elasticity references inside one merchant catalog", () => {
    for (let seed = 700; seed < 820; seed += 1) {
      const world = generateMerchantWorldRecord({
        seed,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "adversarial",
      });
      const manifest = world.manifest;
      const productIds = new Set(
        manifest.productDemandMechanisms.map(
          (mechanism) => mechanism.productId,
        ),
      );

      expect(productIds.size).toBe(world.summary.skuCount);

      for (const mechanism of manifest.productDemandMechanisms) {
        expect(mechanism.productId.startsWith(manifest.worldId)).toBe(true);
        expect(mechanism.categoryId.startsWith(manifest.worldId)).toBe(true);
        for (const productId of mechanism.substitutionProductIds ?? []) {
          expect(productIds.has(productId)).toBe(true);
        }
        for (const productId of mechanism.complementaryProductIds ?? []) {
          expect(productIds.has(productId)).toBe(true);
        }
      }

      for (const inventory of manifest.inventoryMechanisms) {
        expect(productIds.has(inventory.productId)).toBe(true);
        for (const productId of inventory.substituteProductIds ?? []) {
          expect(productIds.has(productId)).toBe(true);
        }
      }

      for (const elasticity of manifest.priceElasticities) {
        expect(productIds.has(elasticity.sourceProductId)).toBe(true);
        expect(productIds.has(elasticity.targetProductId)).toBe(true);
      }
    }
  });

  it("keeps channel mechanisms restricted to active channels", () => {
    for (let seed = 900; seed < 1_050; seed += 1) {
      const world = generateMerchantWorldRecord({
        seed,
        archetype: "specialty_retail",
        scale: "small",
        complexity: "complex",
      });
      const active = new Set(world.summary.activeChannels);

      for (const mechanism of world.manifest.channelIncrementality) {
        expect(active.has(mechanism.channelId as never)).toBe(true);
      }
      for (const mechanism of world.manifest.cacMechanisms) {
        expect(active.has(mechanism.channelId as never)).toBe(true);
      }
      for (const mechanism of world.manifest.saturationMechanisms) {
        expect(active.has(mechanism.channelId as never)).toBe(true);
      }
      for (const interaction of world.manifest.channelInteractions) {
        for (const channelId of interaction.channelIds) {
          expect(active.has(channelId as never)).toBe(true);
        }
      }
    }
  });

  it("keeps repeat assumptions directionally coherent with CLV", () => {
    const lowRepeat = generateMerchantWorldRecord({
      seed: 123,
      archetype: "furniture",
      scale: "growth",
      complexity: "normal",
      purchaseFrequency: "one_off",
    });
    const highRepeat = generateMerchantWorldRecord({
      seed: 123,
      archetype: "replenishment_heavy",
      scale: "growth",
      complexity: "normal",
      purchaseFrequency: "replenishment",
    });

    expect(highRepeat.summary.repeatProbability).toBeGreaterThan(
      lowRepeat.summary.repeatProbability,
    );
    expect(highRepeat.summary.expectedPurchaseIntervalDays).toBeLessThan(
      lowRepeat.summary.expectedPurchaseIntervalDays,
    );
    expect(
      highRepeat.manifest.clvMechanisms[0]!.expectedFuturePurchases,
    ).toBeGreaterThan(
      lowRepeat.manifest.clvMechanisms[0]!.expectedFuturePurchases,
    );
  });
});
