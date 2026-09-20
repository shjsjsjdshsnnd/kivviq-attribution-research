import { describe, expect, it } from "vitest";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { validateLatentCustomerPopulation } from "../../src/customer_population/validation.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { serializeGroundTruthManifest } from "../../src/ground_truth/manifest.js";

function merchant() {
  return generateMerchantWorldRecord({
    seed: 31001,
    archetype: "furniture",
    scale: "growth",
    complexity: "complex",
  });
}

describe("latent customer population determinism", () => {
  it("reproduces the identical population for the same merchant/seed/config", () => {
    const world = merchant();
    const request = {
      merchantWorld: world,
      populationSeed: 7001,
      populationConfig: {
        maxExplicitAgents: 600,
        maxCategoryPreferences: 4,
        maxProductPreferences: 6,
      },
    } as const;

    const left = generateCustomerPopulation(request);
    const right = generateCustomerPopulation(request);

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.provenance).toEqual(right.provenance);
    expect(left.calibration.converged).toBe(true);
  });

  it("different population seeds change individuals but preserve merchant calibration", () => {
    const world = merchant();
    const left = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 1,
      populationConfig: { maxExplicitAgents: 500 },
    });
    const right = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 2,
      populationConfig: { maxExplicitAgents: 500 },
    });

    expect(left.customers[0]).not.toEqual(right.customers[0]);
    expect(
      left.calibration.metrics.map((metric) => metric.target),
    ).toEqual(
      right.calibration.metrics.map((metric) => metric.target),
    );
    expect(left.calibration.converged).toBe(true);
    expect(right.calibration.converged).toBe(true);
  });

  it("does not mutate the frozen merchant GroundTruth", () => {
    const world = merchant();
    const before = serializeGroundTruthManifest(world.manifest);

    generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 99,
      populationConfig: { maxExplicitAgents: 450 },
    });

    expect(serializeGroundTruthManifest(world.manifest)).toBe(before);
  });

  it("uses stable synthetic identifiers only and no realized behavior", () => {
    const world = merchant();
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 44,
      populationConfig: { maxExplicitAgents: 300 },
    });

    expect(population.customers[0]!.customerId).toBe("customer_000000001");
    expect(population.customers.at(-1)!.customerId).toBe(
      `customer_${String(population.customers.length).padStart(9, "0")}`,
    );

    const serialized = JSON.stringify(population);
    for (const forbidden of [
      '"email"',
      '"phone"',
      '"address"',
      '"sessions"',
      '"impressions"',
      '"clicks"',
      '"orders"',
      '"events"',
      '"attributionRecords"',
      '"purchaseHistory"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(() =>
      validateLatentCustomerPopulation(population, world),
    ).not.toThrow();
  });

  it("represents large merchant populations with weighted agents", () => {
    const world = generateMerchantWorldRecord({
      seed: 31888,
      archetype: "commodity_value_retail",
      scale: "large",
      complexity: "normal",
    });

    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 222,
      populationConfig: { maxExplicitAgents: 500 },
    });

    expect(population.explicitAgentCount).toBeLessThanOrEqual(500);
    expect(population.representedCustomerCount).toBeGreaterThanOrEqual(
      population.explicitAgentCount,
    );
    expect(
      population.customers.reduce(
        (sum, customer) => sum + customer.populationWeight,
        0,
      ),
    ).toBeCloseTo(population.representedCustomerCount, 6);
    expect(population.weightedAgents).toBe(
      population.representedCustomerCount !== population.explicitAgentCount,
    );
  });
});
