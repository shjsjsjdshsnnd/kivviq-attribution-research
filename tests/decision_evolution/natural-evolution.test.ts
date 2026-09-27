import { describe, expect, it } from "vitest";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import { immediatePersistentBudgetTiming } from "../../src/action_timing/fixtures.js";
import { durationSeconds, nonNegative, utcTimestamp } from "../../src/core/units.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import { populationFor } from "../simulation/fixture.js";

const start = "2026-09-22T14:00:00.000Z";
const noOp = {
  schemaVersion: "2.0.0",
  actionId: "action_natural_evolution",
  what: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
  timing: {
    ...immediatePersistentBudgetTiming,
    duration: { state: "SPECIFIED", value: {
      kind: "ELAPSED", amount: 336, unit: "HOUR", anchor: "EFFECTIVE_START",
    } },
    end: { state: "SPECIFIED", value: { kind: "DERIVE_FROM_DURATION" } },
  },
  provenance: ["evidence_fixture"],
};

function translatedNoNewInterventions(): [] {
  const result = translateBusinessAction(noOp, {
    timing: { approvedClock: utcTimestamp(start) },
  });
  expect(result.status).toBe("TRANSLATED");
  if (result.status !== "TRANSLATED") throw new Error(result.status);
  expect(result.interventions).toEqual([]);
  // The older runtime consumes ground_truth.Intervention, not the new
  // SimulatorIntervention contract. Only an asserted empty list is compatible;
  // this deliberately does not invent a bridge for nonempty interventions.
  return result.interventions as [];
}

function inventoryWorld() {
  const base = generateMerchantWorldRecord({
    seed: 105002, archetype: "replenishment_heavy", scale: "small", complexity: "normal",
  });
  const world = {
    ...base,
    manifest: {
      ...base.manifest,
      inventoryMechanisms: base.manifest.inventoryMechanisms.map((inventory) => ({
        ...inventory,
        initialAvailableUnits: nonNegative(0),
        initialReservedUnits: nonNegative(0),
        replenishmentUnits: nonNegative(400),
        supplierLeadTimeSeconds: durationSeconds(86_400),
        replenishmentEverySeconds: durationSeconds(30 * 86_400),
        allowBackorders: false,
        stockoutBehavior: "lost_demand" as const,
        substituteProductIds: [],
      })),
    },
  };
  validateGroundTruthManifest(world.manifest);
  return world;
}

describe("NO_OP preserves natural business evolution", () => {
  it("advances customer journeys and existing campaigns identically to no new intervention", () => {
    const interventions = translatedNoNewInterventions();
    const world = generateMerchantWorldRecord({
      seed: 105002, archetype: "replenishment_heavy", scale: "small", complexity: "normal",
    });
    const original = structuredClone(world);
    const request = {
      merchantWorld: world,
      latentPopulation: populationFor(world, 115002, 30),
      simulationSeed: 125002,
      startTime: start,
      endTime: "2026-10-06T14:00:00.000Z",
      config: { maxEvents: 80_000 },
    };
    const factual = simulateWorld(request);
    const unchanged = simulateWorld({ ...request, interventions });
    expect(unchanged).toEqual(factual);
    expect(unchanged.observableEvents.some((event) => event.eventType === "visit")).toBe(true);
    expect(unchanged.observableEvents.some((event) => event.eventType === "impression")).toBe(true);
    expect(unchanged.observableEvents.some((event) =>
      Date.parse(event.occurredAt) > Date.parse(start) + 86_400_000,
    )).toBe(true);
    expect(world).toEqual(original);
  });

  it("allows existing supplier replenishment to arrive after its lead time without a new inventory action", () => {
    const interventions = translatedNoNewInterventions();
    const world = inventoryWorld();
    const request = {
      merchantWorld: world,
      latentPopulation: populationFor(world, 115002, 80),
      simulationSeed: 125002,
      startTime: start,
      interventions,
      commercePolicy: { executeInventoryLifecycle: true },
      config: { maxEvents: 80_000 },
    };
    const beforeArrival = simulateWorld({ ...request, endTime: "2026-09-23T02:00:00.000Z" });
    const afterArrival = simulateWorld({ ...request, endTime: "2026-10-06T14:00:00.000Z" });
    expect(beforeArrival.totals.representedOrders).toBe(0);
    expect(afterArrival.totals.representedOrders).toBeGreaterThan(0);
    expect(afterArrival.purchases.every((purchase) =>
      Date.parse(purchase.occurredAt) >= Date.parse(start) + 86_400_000,
    )).toBe(true);
    expect(world.manifest.inventoryMechanisms.every((inventory) =>
      inventory.initialAvailableUnits === 0 && inventory.replenishmentUnits === 400,
    )).toBe(true);
  });
});

// Scheduled promotion execution is not implemented by simulateWorld. This
// fixture checks the existing canonical schedule boundary without pretending
// that the simulator executes promotion expiry.
describe("NO_OP preserves existing promotion schedules (fixture 17)", () => {
  it("leaves an already active promotion's resolved end unchanged", async () => {
    const { resolveActionTiming } = await import("../../src/action_timing/resolution.js");
    const { fridaySevenDayBudgetTiming } = await import("../../src/action_timing/fixtures.js");
    const existingPromotionTiming = structuredClone(fridaySevenDayBudgetTiming);
    const snapshot = structuredClone(existingPromotionTiming);
    const context = {
      approvedClock: utcTimestamp("2026-09-27T14:00:00.000Z"),
      actionId: "action_existing_promotion",
    };
    const before = resolveActionTiming(existingPromotionTiming, context);
    expect(before.resolvedEnd).toBe("2026-10-02T04:00:00.000Z");
    expect(Date.parse(before.resolvedEffectiveStart!)).toBeLessThan(Date.parse(context.approvedClock));
    expect(Date.parse(before.resolvedEnd!)).toBeGreaterThan(Date.parse(context.approvedClock));
    expect(translatedNoNewInterventions()).toEqual([]);
    expect(existingPromotionTiming).toEqual(snapshot);
    expect(resolveActionTiming(existingPromotionTiming, context)).toEqual(before);
  });
});
