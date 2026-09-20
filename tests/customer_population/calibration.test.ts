import { describe, expect, it } from "vitest";
import {
  purchaseWeightedMean,
  weightedMean,
} from "../../src/customer_population/calibration.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

describe("customer micro-macro calibration", () => {
  const merchantConfigs = [
    {
      seed: 41001,
      archetype: "furniture" as const,
      scale: "growth" as const,
      complexity: "complex" as const,
    },
    {
      seed: 41002,
      archetype: "replenishment_heavy" as const,
      scale: "mid_market" as const,
      complexity: "normal" as const,
    },
    {
      seed: 41003,
      archetype: "luxury" as const,
      scale: "small" as const,
      complexity: "adversarial" as const,
    },
  ];

  for (const config of merchantConfigs) {
    it(`reconciles customer population to merchant ${config.archetype}`, () => {
      const world = generateMerchantWorldRecord(config);
      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 991,
        populationConfig: {
          maxExplicitAgents: 800,
          calibrationTolerance: 1e-6,
        },
      });

      expect(population.calibration.converged).toBe(true);
      for (const metric of population.calibration.metrics) {
        expect(metric.converged).toBe(true);
        expect(metric.absoluteError).toBeLessThanOrEqual(
          metric.tolerance + 1e-9,
        );
      }

      const weights = population.customers.map(
        (customer) => customer.populationWeight,
      );

      expect(
        weightedMean(
          population.customers.map(
            (customer) => customer.repeatPropensity,
          ),
          weights,
        ),
      ).toBeCloseTo(world.summary.repeatProbability, 5);

      expect(
        weightedMean(
          population.customers.map(
            (customer) => customer.devicePreference.mobileProbability,
          ),
          weights,
        ),
      ).toBeCloseTo(world.summary.mobileTrafficShare, 5);

      expect(
        weightedMean(
          population.customers.map(
            (customer) =>
              customer.naturalSelection.organicDiscoveryProbability,
          ),
          weights,
        ),
      ).toBeCloseTo(world.summary.organicDemandShare, 5);

      expect(
        purchaseWeightedMean(
          population.customers.map(
            (customer) => customer.expectedOrderValueMinor,
          ),
          population.customers.map(
            (customer) => customer.expectedFuturePurchases,
          ),
          weights,
        ),
      ).toBeCloseTo(world.summary.expectedAovMinor, 2);

      const clv = world.manifest.clvMechanisms[0]!;
      const targetClv =
        Number(clv.expectedGrossMarginMinor) -
        Number(clv.expectedDiscountsMinor) -
        Number(clv.expectedReturnsMinor) -
        Number(clv.expectedFulfillmentCostsMinor) -
        Number(clv.expectedAcquisitionCostsMinor ?? 0);

      expect(
        weightedMean(
          population.customers.map(
            (customer) => customer.expectedLifetimeValueMinor,
          ),
          weights,
        ),
      ).toBeCloseTo(targetClv, 2);

      expect(
        weightedMean(
          population.customers.map(
            (customer) => customer.priceSensitivityMultiplier,
          ),
          weights,
        ),
      ).toBeCloseTo(1, 5);

      expect(
        weightedMean(
          population.customers.map(
            (customer) => customer.promotionSensitivityMultiplier,
          ),
          weights,
        ),
      ).toBeCloseTo(1, 5);

      for (const merchantMechanism of world.manifest.channelIncrementality) {
        const customerMultipliers = population.customers.map((customer) => {
          const trait = customer.channelTraits.find(
            (candidate) =>
              candidate.channelId === merchantMechanism.channelId,
          );
          expect(trait).toBeDefined();
          expect(trait!.merchantMechanismId).toBe(merchantMechanism.id);
          return trait!.causalEffectMultiplier;
        });

        const multiplierMean = weightedMean(
          customerMultipliers,
          weights,
        );
        expect(multiplierMean).toBeCloseTo(1, 5);

        const impliedAggregateEffect =
          merchantMechanism.effect.value * multiplierMean;
        expect(
          Math.abs(
            impliedAggregateEffect - merchantMechanism.effect.value,
          ),
        ).toBeLessThanOrEqual(
          Math.abs(merchantMechanism.effect.value) * 2e-6 + 1e-9,
        );
      }
    });
  }

  it("reconciles lifecycle mix to the merchant existing-customer share", () => {
    const world = generateMerchantWorldRecord({
      seed: 41999,
      archetype: "beauty_cosmetics",
      scale: "growth",
      complexity: "normal",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 17,
      populationConfig: { maxExplicitAgents: 1_000 },
    });

    const existingWeight = population.customers
      .filter(
        (customer) =>
          customer.lifecycle.preSimulationHistory !== "none",
      )
      .reduce((sum, customer) => sum + customer.populationWeight, 0);

    const implied =
      existingWeight / population.representedCustomerCount;
    const target = Number(
      world.manifest.customers.existingCustomerShare,
    );

    expect(Math.abs(implied - target)).toBeLessThanOrEqual(
      1 / population.explicitAgentCount + 1e-9,
    );
  });
});
