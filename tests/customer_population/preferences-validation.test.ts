import { describe, expect, it } from "vitest";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import type { LatentCustomerPopulation } from "../../src/customer_population/types.js";
import {
  LatentCustomerValidationError,
  validateLatentCustomerPopulation,
} from "../../src/customer_population/validation.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

describe("latent customer product-market fit and validation", () => {
  it("uses only sparse preferences that reference the merchant catalog", () => {
    const world = generateMerchantWorldRecord({
      seed: 54001,
      archetype: "commodity_value_retail",
      scale: "large",
      complexity: "complex",
      catalogProfile: "long_tail",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 901,
      populationConfig: {
        maxExplicitAgents: 350,
        maxCategoryPreferences: 3,
        maxProductPreferences: 5,
      },
    });

    const productToCategory = new Map(
      world.manifest.productDemandMechanisms.map(
        (mechanism) => [mechanism.productId, mechanism.categoryId] as const,
      ),
    );
    const categories = new Set(productToCategory.values());

    expect(world.summary.skuCount).toBeGreaterThan(100);
    for (const customer of population.customers) {
      expect(customer.categoryPreferences.length).toBeLessThanOrEqual(3);
      expect(customer.productPreferences.length).toBeLessThanOrEqual(5);

      for (const preference of customer.categoryPreferences) {
        expect(categories.has(preference.categoryId)).toBe(true);
      }
      for (const preference of customer.productPreferences) {
        expect(productToCategory.has(preference.productId)).toBe(true);
        expect(productToCategory.get(preference.productId)).toBe(
          preference.categoryId,
        );
      }
    }

    const denseCellCount =
      population.explicitAgentCount * world.summary.skuCount;
    const storedProductPreferences = population.customers.reduce(
      (sum, customer) => sum + customer.productPreferences.length,
      0,
    );
    expect(storedProductPreferences).toBeLessThan(denseCellCount * 0.08);
  });

  it("supports overlapping derived labels rather than mutually exclusive segments", () => {
    const world = generateMerchantWorldRecord({
      seed: 54002,
      archetype: "beauty_cosmetics",
      scale: "growth",
      complexity: "adversarial",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 902,
      populationConfig: { maxExplicitAgents: 1_000 },
    });

    expect(
      population.customers.some(
        (customer) => customer.derivedSegments.length >= 3,
      ),
    ).toBe(true);
  });

  it("rejects a product preference outside the merchant catalog", () => {
    const world = generateMerchantWorldRecord({
      seed: 54003,
      archetype: "furniture",
      scale: "small",
      complexity: "normal",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 903,
      populationConfig: { maxExplicitAgents: 200 },
    });

    const corrupted = JSON.parse(
      JSON.stringify(population),
    ) as LatentCustomerPopulation;
    const first = corrupted.customers[0] as unknown as {
      productPreferences: Array<{
        productId: string;
        categoryId: string;
        affinity: number;
      }>;
    };
    first.productPreferences[0] = {
      productId: "synthetic_wrong_merchant_sku",
      categoryId: first.productPreferences[0]!.categoryId,
      affinity: 0.5,
    };

    expect(() =>
      validateLatentCustomerPopulation(corrupted, world),
    ).toThrow(LatentCustomerValidationError);
  });

  it("rejects realized journey/event fields and PII", () => {
    const world = generateMerchantWorldRecord({
      seed: 54004,
      archetype: "specialty_retail",
      scale: "small",
      complexity: "normal",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 904,
      populationConfig: { maxExplicitAgents: 150 },
    });

    const withOrders = JSON.parse(JSON.stringify(population)) as any;
    withOrders.customers[0].orders = [{ id: "order_1" }];
    expect(() =>
      validateLatentCustomerPopulation(withOrders, world),
    ).toThrow();

    const withEmail = JSON.parse(JSON.stringify(population)) as any;
    withEmail.customers[0].email = "fake@example.test";
    expect(() =>
      validateLatentCustomerPopulation(withEmail, world),
    ).toThrow();
  });

  it("rejects duplicate IDs, bad channel mechanism references, and fake calibration", () => {
    const world = generateMerchantWorldRecord({
      seed: 54005,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "complex",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 905,
      populationConfig: { maxExplicitAgents: 250 },
    });

    const duplicate = JSON.parse(JSON.stringify(population)) as any;
    duplicate.customers[1].customerId = duplicate.customers[0].customerId;
    expect(() =>
      validateLatentCustomerPopulation(duplicate, world),
    ).toThrow(/IDs must be unique/);

    const badChannel = JSON.parse(JSON.stringify(population)) as any;
    badChannel.customers[0].channelTraits[0].merchantMechanismId =
      "wrong-mechanism";
    expect(() =>
      validateLatentCustomerPopulation(badChannel, world),
    ).toThrow(/merchant mechanism/);

    const fakeCalibration = JSON.parse(JSON.stringify(population)) as any;
    fakeCalibration.calibration.converged = false;
    expect(() =>
      validateLatentCustomerPopulation(fakeCalibration, world),
    ).toThrow(/calibration report/);
  });
});
