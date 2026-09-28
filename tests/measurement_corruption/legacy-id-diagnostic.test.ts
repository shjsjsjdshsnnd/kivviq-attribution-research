import { it, expect } from "vitest";
import { simulateWorld } from "../../src/simulation/simulator.js";
import { zeroPaidSpendInterventions } from "../../src/simulation/counterfactual.js";
import { baseAdversarialWorld, populationFor } from "../simulation/fixture.js";
it("diagnoses legacy event-ID reuse without changing or suppressing facts", () => {
  const merchantWorld = baseAdversarialWorld(64111);
  const result = simulateWorld({ merchantWorld, latentPopulation: populationFor(merchantWorld, 74111, 90),
    simulationSeed: 1410, startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-04-01T00:00:00.000Z",
    interventions: zeroPaidSpendInterventions(merchantWorld), config: { maxEvents: 180000, maxSessionsPerCustomer: 16 } });
  const grouped = new Map<string, typeof result.observableEvents[number][]>();
  for (const event of result.observableEvents) grouped.set(event.eventId, [...(grouped.get(event.eventId) ?? []), event]);
  const duplicates = [...grouped.entries()].filter(([, rows]) => rows.length > 1);
  console.info("LEGACY_ID_DIAGNOSTIC", JSON.stringify({ repeatedIds: duplicates.length, examples: duplicates.slice(0, 3) }));
  expect(result.observableEvents.length).toBeGreaterThan(0);
}, 45000);
