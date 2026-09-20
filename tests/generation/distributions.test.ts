import { describe, expect, it } from "vitest";
import type { MerchantArchetype } from "../../src/generation/config.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sample(archetype: MerchantArchetype, count = 120) {
  return Array.from({ length: count }, (_, index) =>
    generateMerchantWorldRecord({
      seed: 100_000 + index,
      archetype,
      scale: "growth",
      complexity: "normal",
    }),
  );
}

describe("merchant population distributions", () => {
  it("preserves broad archetype tendencies without fixed templates", () => {
    const furniture = sample("furniture");
    const beauty = sample("beauty_cosmetics");
    const supplements = sample("supplements_wellness");
    const luxury = sample("luxury");
    const commodity = sample("commodity_value_retail");
    const subscription = sample("subscription_heavy");

    const furnitureAov = mean(
      furniture.map((world) => world.summary.expectedAovMinor),
    );
    const beautyAov = mean(
      beauty.map((world) => world.summary.expectedAovMinor),
    );
    expect(furnitureAov).toBeGreaterThan(beautyAov * 2);

    const supplementRepeat = mean(
      supplements.map((world) => world.summary.repeatProbability),
    );
    const furnitureRepeat = mean(
      furniture.map((world) => world.summary.repeatProbability),
    );
    expect(supplementRepeat).toBeGreaterThan(furnitureRepeat + 0.18);

    const luxuryMargin = mean(
      luxury.map((world) => world.summary.grossMarginRate),
    );
    const commodityMargin = mean(
      commodity.map((world) => world.summary.grossMarginRate),
    );
    expect(luxuryMargin).toBeGreaterThan(commodityMargin + 0.15);

    const subscriptionInterval = mean(
      subscription.map(
        (world) => world.summary.expectedPurchaseIntervalDays,
      ),
    );
    const furnitureInterval = mean(
      furniture.map(
        (world) => world.summary.expectedPurchaseIntervalDays,
      ),
    );
    expect(subscriptionInterval).toBeLessThan(furnitureInterval * 0.35);
  });

  it("models correlated characteristics rather than independent random fields", () => {
    const replenishment = sample("replenishment_heavy", 180);
    const oneOffFurniture = Array.from({ length: 180 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 200_000 + index,
        archetype: "furniture",
        scale: "growth",
        complexity: "normal",
        purchaseFrequency: "one_off",
      }),
    );

    expect(
      mean(
        replenishment.map(
          (world) => world.summary.repeatProbability,
        ),
      ),
    ).toBeGreaterThan(
      mean(
        oneOffFurniture.map(
          (world) => world.summary.repeatProbability,
        ),
      ) + 0.3,
    );

    expect(
      mean(
        replenishment.map(
          (world) => world.summary.expectedPurchaseIntervalDays,
        ),
      ),
    ).toBeLessThan(
      mean(
        oneOffFurniture.map(
          (world) => world.summary.expectedPurchaseIntervalDays,
        ),
      ) * 0.3,
    );

    const promotionHeavy = Array.from({ length: 140 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 300_000 + index,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "normal",
        promotionProfile: "promotion_heavy",
      }),
    );
    const fullPrice = Array.from({ length: 140 }, (_, index) =>
      generateMerchantWorldRecord({
        seed: 400_000 + index,
        archetype: "fashion_apparel",
        scale: "growth",
        complexity: "normal",
        promotionProfile: "full_price_dominant",
      }),
    );

    expect(
      mean(
        promotionHeavy.map(
          (world) => world.summary.expectedDiscountRate,
        ),
      ),
    ).toBeGreaterThan(
      mean(
        fullPrice.map(
          (world) => world.summary.expectedDiscountRate,
        ),
      ) * 2,
    );
    expect(
      mean(
        promotionHeavy.map(
          (world) => world.summary.expectedContributionMarginRate,
        ),
      ),
    ).toBeLessThan(
      mean(
        fullPrice.map(
          (world) => world.summary.expectedContributionMarginRate,
        ),
      ),
    );
  });

  it("allows plausible outliers rather than forcing stereotypes", () => {
    const furniture = sample("furniture", 350);
    const beauty = sample("beauty_cosmetics", 350);
    const luxury = sample("luxury", 350);

    expect(
      furniture.some(
        (world) => world.summary.repeatProbability > 0.35,
      ),
    ).toBe(true);
    expect(
      beauty.some(
        (world) => world.summary.repeatProbability < 0.3,
      ),
    ).toBe(true);
    expect(
      luxury.some(
        (world) => world.summary.activeChannels.includes("email"),
      ),
    ).toBe(true);
  });
});
