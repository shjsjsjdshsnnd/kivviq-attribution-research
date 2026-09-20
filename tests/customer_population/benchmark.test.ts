import { describe, expect, it } from "vitest";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";

interface ProcessLike {
  memoryUsage(): { heapUsed: number };
}

describe("latent customer scalability benchmark", () => {
  it(
    "benchmarks generation time, heap delta and serialization size",
    () => {
      const world = generateMerchantWorldRecord({
        seed: 56001,
        archetype: "commodity_value_retail",
        scale: "large",
        complexity: "adversarial",
        catalogProfile: "long_tail",
      });

      const maybeProcess = (
        globalThis as unknown as { process?: ProcessLike }
      ).process;
      const heapBefore = maybeProcess?.memoryUsage().heapUsed ?? 0;
      const started = performance.now();

      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 818,
        populationConfig: {
          maxExplicitAgents: 3_000,
          maxCategoryPreferences: 4,
          maxProductPreferences: 6,
        },
      });

      const elapsedMs = performance.now() - started;
      const heapAfter = maybeProcess?.memoryUsage().heapUsed ?? 0;
      const serialized = JSON.stringify(population);
      const serializedBytes = new TextEncoder().encode(serialized).byteLength;
      const productPreferenceCount = population.customers.reduce(
        (sum, customer) => sum + customer.productPreferences.length,
        0,
      );
      const categoryPreferenceCount = population.customers.reduce(
        (sum, customer) => sum + customer.categoryPreferences.length,
        0,
      );

      const report = {
        merchantSkuCount: world.summary.skuCount,
        representedCustomers: population.representedCustomerCount,
        explicitAgents: population.explicitAgentCount,
        populationWeight:
          population.customers[0]?.populationWeight ?? 0,
        weightedAgents: population.weightedAgents,
        generationMs: elapsedMs,
        heapDeltaBytes:
          heapBefore > 0 && heapAfter > 0
            ? heapAfter - heapBefore
            : null,
        serializedBytes,
        bytesPerExplicitAgent:
          serializedBytes / population.explicitAgentCount,
        averageProductPreferences:
          productPreferenceCount / population.explicitAgentCount,
        averageCategoryPreferences:
          categoryPreferenceCount / population.explicitAgentCount,
      };

      console.info(
        "STEP3_CUSTOMER_BENCHMARK",
        JSON.stringify(report, null, 2),
      );

      expect(world.summary.skuCount).toBeGreaterThan(100);
      expect(population.explicitAgentCount).toBeLessThanOrEqual(3_000);
      expect(population.calibration.converged).toBe(true);
      expect(report.averageProductPreferences).toBeLessThanOrEqual(6);
      expect(report.averageCategoryPreferences).toBeLessThanOrEqual(4);
      expect(report.bytesPerExplicitAgent).toBeLessThan(12_000);
      expect(elapsedMs).toBeLessThan(30_000);
    },
    45_000,
  );
});
