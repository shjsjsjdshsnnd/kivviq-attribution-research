import { describe, expect, it } from "vitest";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

function correlation(
  left: readonly number[],
  right: readonly number[],
): number {
  expect(left.length).toBe(right.length);
  const n = left.length;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / n;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / n;

  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < n; index += 1) {
    const l = left[index]! - leftMean;
    const r = right[index]! - rightMean;
    covariance += l * r;
    leftVariance += l * l;
    rightVariance += r * r;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

describe("latent selection bias", () => {
  it("creates high-intent search selection even when Google true incrementality is zero", () => {
    const world = generateMerchantWorldRecord({
      seed: 52001,
      archetype: "consumer_electronics",
      scale: "growth",
      complexity: "adversarial",
      overrides: {
        forceZeroIncrementalityChannels: ["google_search"],
      },
    });
    const google = world.manifest.channelIncrementality.find(
      (mechanism) => mechanism.channelId === "google_search",
    );
    expect(google).toBeDefined();
    expect(google!.effect.value).toBe(0);

    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 809,
      populationConfig: { maxExplicitAgents: 1_200 },
    });

    const intent = population.customers.map(
      (customer) => customer.purchaseIntent,
    );
    const naturalSearch = population.customers.map(
      (customer) => customer.naturalSelection.searchUseProbability,
    );
    expect(correlation(intent, naturalSearch)).toBeGreaterThan(0.35);

    const susceptibility = population.customers.map((customer) =>
      customer.channelTraits.find(
        (trait) => trait.channelId === "google_search",
      )!.causalEffectMultiplier,
    );

    // High-intent customers select search more strongly, while their causal
    // susceptibility is deliberately not equated with that selection.
    expect(correlation(intent, susceptibility)).toBeLessThan(0.05);

    for (let index = 0; index < population.customers.length; index += 1) {
      expect(
        Math.abs(google!.effect.value * susceptibility[index]!),
      ).toBe(0);
    }
  });

  it("creates email selection among brand-loyal customers without treating selection as causality", () => {
    const world = generateMerchantWorldRecord({
      seed: 52002,
      archetype: "beauty_cosmetics",
      scale: "growth",
      complexity: "complex",
      overrides: {
        forceZeroIncrementalityChannels: ["email"],
      },
    });
    const email = world.manifest.channelIncrementality.find(
      (mechanism) => mechanism.channelId === "email",
    );
    expect(email).toBeDefined();
    expect(email!.effect.value).toBe(0);

    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 810,
      populationConfig: { maxExplicitAgents: 1_000 },
    });

    expect(
      correlation(
        population.customers.map((customer) => customer.brandAffinity),
        population.customers.map(
          (customer) =>
            customer.naturalSelection.emailSubscriptionProbability,
        ),
      ),
    ).toBeGreaterThan(0.35);

    expect(
      correlation(
        population.customers.map((customer) => customer.brandAffinity),
        population.customers.map(
          (customer) =>
            customer.channelTraits.find(
              (trait) => trait.channelId === "email",
            )!.causalEffectMultiplier,
        ),
      ),
    ).toBeLessThan(0.1);
  });

  it("creates promotion and retargeting selection from pre-existing traits", () => {
    const world = generateMerchantWorldRecord({
      seed: 52003,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "adversarial",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 811,
      populationConfig: { maxExplicitAgents: 1_200 },
    });

    expect(
      correlation(
        population.customers.map(
          (customer) => customer.priceSensitivityMultiplier,
        ),
        population.customers.map(
          (customer) =>
            customer.naturalSelection.promotionWaitingProbability,
        ),
      ),
    ).toBeGreaterThan(0.15);

    expect(
      correlation(
        population.customers.map((customer) => customer.purchaseIntent),
        population.customers.map(
          (customer) =>
            customer.naturalSelection.retargetingEligibilityProbability,
        ),
      ),
    ).toBeGreaterThan(0.4);
  });
});
