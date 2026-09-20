import { describe, expect, it } from "vitest";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) /
      Math.max(1, values.length - 1),
  );
}

function correlation(left: readonly number[], right: readonly number[]) {
  const lm = mean(left);
  const rm = mean(right);
  let cov = 0;
  let lv = 0;
  let rv = 0;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i]! - lm;
    const r = right[i]! - rm;
    cov += l * r;
    lv += l * l;
    rv += r * r;
  }
  return cov / Math.sqrt(lv * rv);
}

describe("latent customer difficulty", () => {
  it("changes heterogeneity/confounding structure rather than merchant targets", () => {
    const world = generateMerchantWorldRecord({
      seed: 55001,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "adversarial",
    });

    const simple = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 700,
      populationConfig: {
        maxExplicitAgents: 1_000,
        complexity: "simple",
      },
    });
    const adversarial = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 700,
      populationConfig: {
        maxExplicitAgents: 1_000,
        complexity: "adversarial",
      },
    });

    for (const metric of simple.calibration.metrics) {
      const other = adversarial.calibration.metrics.find(
        (candidate) => candidate.metric === metric.metric,
      );
      expect(other?.target).toBe(metric.target);
    }

    expect(
      std(simple.customers.map((customer) => customer.purchaseIntent)),
    ).toBeLessThan(
      std(
        adversarial.customers.map(
          (customer) => customer.purchaseIntent,
        ),
      ),
    );

    const channel = world.summary.activeChannels[0]!;
    const simpleChannel = simple.customers.map(
      (customer) =>
        customer.channelTraits.find(
          (trait) => trait.channelId === channel,
        )!.causalEffectMultiplier,
    );
    const adversarialChannel = adversarial.customers.map(
      (customer) =>
        customer.channelTraits.find(
          (trait) => trait.channelId === channel,
        )!.causalEffectMultiplier,
    );

    expect(std(simpleChannel)).toBeLessThan(std(adversarialChannel));
    expect(simpleChannel.every((value) => value >= 0.15)).toBe(true);
    expect(adversarialChannel.some((value) => value < 0)).toBe(true);
  });

  it("strengthens high-intent channel selection in adversarial populations", () => {
    const world = generateMerchantWorldRecord({
      seed: 55002,
      archetype: "consumer_electronics",
      scale: "growth",
      complexity: "complex",
      overrides: {
        forceZeroIncrementalityChannels: ["google_search"],
      },
    });

    const simple = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 701,
      populationConfig: {
        maxExplicitAgents: 1_000,
        complexity: "simple",
      },
    });
    const adversarial = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 701,
      populationConfig: {
        maxExplicitAgents: 1_000,
        complexity: "adversarial",
      },
    });

    const simpleCorr = correlation(
      simple.customers.map((customer) => customer.purchaseIntent),
      simple.customers.map(
        (customer) => customer.naturalSelection.searchUseProbability,
      ),
    );
    const adversarialCorr = correlation(
      adversarial.customers.map(
        (customer) => customer.purchaseIntent,
      ),
      adversarial.customers.map(
        (customer) => customer.naturalSelection.searchUseProbability,
      ),
    );

    expect(adversarialCorr).toBeGreaterThan(simpleCorr + 0.08);
    expect(adversarialCorr).toBeGreaterThan(0.4);
  });
});
