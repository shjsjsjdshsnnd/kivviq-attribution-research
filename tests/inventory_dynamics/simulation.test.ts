import { describe, expect, it } from "vitest";
import {
  nonNegative,
} from "../../src/core/units.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { simulateWorld } from "../../src/simulation/simulator.js";

describe("Step 9 inventory dynamics integration", () => {
  it(
    "records latent demand separately from fulfilled sales and never makes authoritative stock negative",
    () => {
      const base = generateMerchantWorldRecord({
        seed: 191001,
        archetype: "specialty_retail",
        scale: "small",
        complexity: "adversarial",
        catalogProfile: "tiny_curated",
        inventoryProfile: "stockout_prone",
      });
      const world = structuredClone(base);

      for (const mechanism of world.manifest.inventoryMechanisms as unknown as Array<{
        initialAvailableUnits: number;
        initialReservedUnits: number;
        replenishmentUnits: number;
        allowBackorders: boolean;
        stockoutBehavior:
          | "lost_demand"
          | "substitute"
          | "backorder";
      }>) {
        mechanism.initialAvailableUnits =
          nonNegative(1);
        mechanism.initialReservedUnits =
          nonNegative(0);
        mechanism.replenishmentUnits =
          nonNegative(0);
        mechanism.allowBackorders = false;
        mechanism.stockoutBehavior = "lost_demand";
      }

      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 192001,
        populationConfig: {
          maxExplicitAgents: 90,
          complexity: "adversarial",
        },
      });

      const result = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 193001,
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-03-01T00:00:00.000Z",
        commercePolicy: {
          executeInventoryLifecycle: true,
          enableProductRelationships: true,
          enableInventoryDynamics: true,
        },
        config: {
          maxEvents: 160_000,
          maxSessionsPerCustomer: 18,
        },
      });

      const inventoryTruth =
        result.godMode.inventory;
      expect(inventoryTruth).toBeDefined();
      expect(
        inventoryTruth!.demandTruth.length,
      ).toBeGreaterThan(0);
      expect(
        inventoryTruth!.demandTruth.some(
          (demand) =>
            demand.inventoryDisposition ===
              "permanently_lost" ||
            demand.inventoryDisposition ===
              "merchant_exit" ||
            demand.inventoryDisposition ===
              "delayed",
        ),
      ).toBe(true);

      for (const position of inventoryTruth!.positions) {
        expect(position.onHandUnits).toBeGreaterThanOrEqual(0);
        expect(position.availableToSellUnits).toBeGreaterThanOrEqual(0);
        expect(position.backorderedUnits).toBeGreaterThanOrEqual(0);
      }
      expect(
        inventoryTruth!.reconciliation.every(
          (row) => row.reconcilesExactly,
        ),
      ).toBe(true);
    },
    60_000,
  );
});
