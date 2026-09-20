import { describe, expect, it } from "vitest";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) /
      Math.max(1, values.length - 1),
  );
}

describe("latent customer heterogeneity", () => {
  it("does not collapse customers into identical segment templates", () => {
    const world = generateMerchantWorldRecord({
      seed: 53001,
      archetype: "home_furnishings_decor",
      scale: "growth",
      complexity: "complex",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 321,
      populationConfig: { maxExplicitAgents: 1_000 },
    });

    expect(
      standardDeviation(
        population.customers.map((customer) => customer.purchaseIntent),
      ),
    ).toBeGreaterThan(0.08);
    expect(
      standardDeviation(
        population.customers.map((customer) => customer.brandAffinity),
      ),
    ).toBeGreaterThan(0.05);
    expect(
      standardDeviation(
        population.customers.map(
          (customer) => customer.priceSensitivityMultiplier,
        ),
      ),
    ).toBeGreaterThan(0.12);
    expect(
      standardDeviation(
        population.customers.map(
          (customer) => customer.repeatPropensity,
        ),
      ),
    ).toBeGreaterThan(0.08);

    const signatures = new Set(
      population.customers.map((customer) =>
        [
          customer.purchaseIntent.toFixed(4),
          customer.brandAffinity.toFixed(4),
          customer.priceSensitivityMultiplier.toFixed(4),
          customer.repeatPropensity.toFixed(4),
          customer.categoryPreferences
            .map((preference) => preference.categoryId)
            .join(","),
          customer.derivedSegments.join(","),
        ].join("|"),
      ),
    );

    expect(signatures.size / population.customers.length).toBeGreaterThan(
      0.98,
    );
  });

  it("preserves treatment-effect heterogeneity while matching merchant averages", () => {
    const world = generateMerchantWorldRecord({
      seed: 53002,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "adversarial",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 322,
      populationConfig: { maxExplicitAgents: 1_500 },
    });

    const channel = world.summary.activeChannels[0]!;
    const values = population.customers.map(
      (customer) =>
        customer.channelTraits.find(
          (trait) => trait.channelId === channel,
        )!.causalEffectMultiplier,
    );

    expect(standardDeviation(values)).toBeGreaterThan(0.25);
    expect(values.some((value) => value < 0)).toBe(true);
    expect(values.some((value) => value > 1.5)).toBe(true);
  });

  it("keeps price and promotion sensitivity conceptually distinct", () => {
    const world = generateMerchantWorldRecord({
      seed: 53003,
      archetype: "luxury",
      scale: "small",
      complexity: "complex",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 323,
      populationConfig: { maxExplicitAgents: 900 },
    });

    const pairSignatures = new Set(
      population.customers.map((customer) =>
        [
          customer.priceSensitivityMultiplier.toFixed(3),
          customer.promotionSensitivityMultiplier.toFixed(3),
        ].join("|"),
      ),
    );
    expect(pairSignatures.size).toBeGreaterThan(750);

    expect(
      population.customers.some(
        (customer) =>
          customer.priceSensitivityMultiplier > 1 &&
          customer.promotionSensitivityMultiplier < 0.7,
      ),
    ).toBe(true);
  });

  it("merchant characteristics produce materially different customer populations", () => {
    const furnitureWorld = generateMerchantWorldRecord({
      seed: 53004,
      archetype: "furniture",
      scale: "growth",
      complexity: "normal",
    });
    const replenishWorld = generateMerchantWorldRecord({
      seed: 53005,
      archetype: "replenishment_heavy",
      scale: "growth",
      complexity: "normal",
    });

    const furniture = generateCustomerPopulation({
      merchantWorld: furnitureWorld,
      populationSeed: 42,
      populationConfig: { maxExplicitAgents: 800 },
    });
    const replenish = generateCustomerPopulation({
      merchantWorld: replenishWorld,
      populationSeed: 42,
      populationConfig: { maxExplicitAgents: 800 },
    });

    expect(
      mean(
        replenish.customers.map(
          (customer) => customer.repeatPropensity,
        ),
      ),
    ).toBeGreaterThan(
      mean(
        furniture.customers.map(
          (customer) => customer.repeatPropensity,
        ),
      ) + 0.15,
    );

    expect(
      mean(
        replenish.customers.map(
          (customer) => customer.expectedPurchaseIntervalDays,
        ),
      ),
    ).toBeLessThan(
      mean(
        furniture.customers.map(
          (customer) => customer.expectedPurchaseIntervalDays,
        ),
      ) * 0.5,
    );
  });
});
