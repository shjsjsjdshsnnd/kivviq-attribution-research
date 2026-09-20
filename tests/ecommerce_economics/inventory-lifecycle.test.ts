import { describe, expect, it } from "vitest";
import {
  durationSeconds,
  nonNegative,
} from "../../src/core/units.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import {
  createRuntimeWorldState,
} from "../../src/simulation/state.js";
import {
  buildSimulationInterventionState,
} from "../../src/simulation/interventions.js";
import { SharedRandomness } from "../../src/simulation/kernel.js";
import { completePurchase } from "../../src/simulation/commerce.js";
import { simulateWorld } from "../../src/simulation/simulator.js";

describe("Step 7 inventory lifecycle", () => {
  it("permits sales beyond on-hand stock only for explicit backorder products", () => {
    const base = generateMerchantWorldRecord({
      seed: 105001,
      archetype: "furniture",
      scale: "small",
      complexity: "normal",
    });
    const world = structuredClone(base);
    const inventory = (world.manifest.inventoryMechanisms as any[])[0]!;
    inventory.initialAvailableUnits = nonNegative(0);
    inventory.initialReservedUnits = nonNegative(0);
    inventory.allowBackorders = true;
    inventory.stockoutBehavior = "backorder";
    validateGroundTruthManifest(world.manifest);

    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 115001,
      populationConfig: { maxExplicitAgents: 20 },
    });
    const startMs = Date.parse("2026-01-01T00:00:00.000Z");
    const runtime = createRuntimeWorldState(
      world,
      population,
      startMs,
    );
    const customer = runtime.customers.values().next().value!;
    customer.cart = {
      lines: [{
        productId: inventory.productId,
        quantity: 2,
        unitPriceMinor: 10_000,
      }],
      updatedAtMs: startMs,
      expiresAtMs: startMs + 86_400_000,
    };

    const purchase = completePurchase(
      runtime,
      customer,
      "backorder-session",
      "direct",
      startMs,
      "backorder-order",
      buildSimulationInterventionState(world, []),
      new SharedRandomness(1, "backorder-test"),
    );

    expect(purchase).toBeDefined();
    expect(purchase!.lines[0]!.quantity).toBe(2);
    expect(runtime.inventory.get(inventory.productId)).toBe(-2);
  });

  it(
    "executes supplier lead time and recurring replenishment before allowing sales",
    () => {
      const base = generateMerchantWorldRecord({
        seed: 105002,
        archetype: "replenishment_heavy",
        scale: "small",
        complexity: "normal",
      });
      const world = structuredClone(base);

      for (const inventory of world.manifest.inventoryMechanisms as any[]) {
        inventory.initialAvailableUnits = nonNegative(0);
        inventory.initialReservedUnits = nonNegative(0);
        inventory.replenishmentUnits = nonNegative(40);
        inventory.supplierLeadTimeSeconds =
          durationSeconds(86_400);
        inventory.replenishmentEverySeconds =
          durationSeconds(7 * 86_400);
        inventory.allowBackorders = false;
        inventory.stockoutBehavior = "lost_demand";
        delete inventory.substituteProductIds;
      }
      validateGroundTruthManifest(world.manifest);

      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 115002,
        populationConfig: { maxExplicitAgents: 80 },
      });

      const early = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 125002,
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-01T12:00:00.000Z",
        config: { maxEvents: 80_000 },
      });

      const later = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 125002,
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-03-01T00:00:00.000Z",
        config: { maxEvents: 180_000 },
      });

      expect(early.totals.representedOrders).toBe(0);
      expect(later.totals.representedOrders).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "keeps inventory fixed when a Step 1 inventory intervention is active",
    () => {
      const base = generateMerchantWorldRecord({
        seed: 105003,
        archetype: "replenishment_heavy",
        scale: "small",
        complexity: "normal",
      });
      const world = structuredClone(base);
      for (const inventory of world.manifest.inventoryMechanisms as any[]) {
        inventory.initialAvailableUnits = nonNegative(0);
        inventory.initialReservedUnits = nonNegative(0);
        inventory.replenishmentUnits = nonNegative(100);
        inventory.supplierLeadTimeSeconds =
          durationSeconds(86_400);
        inventory.replenishmentEverySeconds =
          durationSeconds(7 * 86_400);
      }
      validateGroundTruthManifest(world.manifest);

      const population = generateCustomerPopulation({
        merchantWorld: world,
        populationSeed: 115003,
        populationConfig: { maxExplicitAgents: 60 },
      });

      const result = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 125003,
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-03-01T00:00:00.000Z",
        interventions: [{
          variable: "inventory.available",
          operation: "set",
          value: {
            kind: "number",
            value: 0,
            unit: "units",
          },
        }],
        config: { maxEvents: 180_000 },
      });

      expect(result.totals.representedOrders).toBe(0);
    },
    60_000,
  );
});
