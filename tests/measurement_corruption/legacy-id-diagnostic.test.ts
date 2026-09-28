import { it, expect } from "vitest";
import { simulateWorld } from "../../src/simulation/simulator.js";
import { zeroPaidSpendInterventions } from "../../src/simulation/counterfactual.js";
import { perfectFactsFromSimulation } from "../../src/evaluation/measured-world.js";
import { baseAdversarialWorld, populationFor } from "../simulation/fixture.js";

it("preserves distinct occurrences when legacy cycles reuse an event ID", () => {
  const merchantWorld = baseAdversarialWorld(64111);
  const request = { merchantWorld, latentPopulation: populationFor(merchantWorld, 74111, 90),
    simulationSeed: 1410, startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-04-01T00:00:00.000Z",
    interventions: zeroPaidSpendInterventions(merchantWorld), config: { maxEvents: 180000, maxSessionsPerCustomer: 16 } };
  const result = simulateWorld(request);
  const original = JSON.stringify(result);
  const perfect = perfectFactsFromSimulation(request, result, []);
  const expectedRows = result.observableEvents.filter(e => Date.parse(e.occurredAt) < Date.parse(request.endTime)).length +
    result.purchases.filter(p => Date.parse(p.occurredAt) < Date.parse(request.endTime)).length;
  expect(perfect.events).toHaveLength(expectedRows);
  expect(new Set(perfect.events.map(e => e.eventId)).size).toBe(expectedRows);
  expect(JSON.stringify(result)).toBe(original);

  const template = result.observableEvents[0]!;
  const repeatA = { ...template, eventId: "deliberately-reused-id", occurredAt: "2026-01-02T12:00:00.000Z" };
  const repeatB = { ...repeatA, occurredAt: "2026-01-03T12:00:00.000Z" };
  const extended = perfectFactsFromSimulation(request, { ...result, observableEvents: [...result.observableEvents, repeatA, repeatB] }, []);
  expect(extended.events).toHaveLength(perfect.events.length + 2);
  // Exact repeated physical occurrence keys are not laundered into new events.
  expect(() => perfectFactsFromSimulation(request, { ...result, observableEvents: [...result.observableEvents, repeatA, repeatA] }, [])).toThrow("unique");
}, 45000);
