import { describe, expect, it } from "vitest";
import { simulateWorld } from "../../src/simulation/simulator.js";
import { replayCounterfactual } from "../../src/simulation/counterfactual.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
} from "./fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-10-01T00:00:00.000Z";

describe("Step 4 journey behavior", () => {
  it(
    "is deterministic under the same frozen inputs and simulation seed",
    () => {
      const world = baseAdversarialWorld(62001);
      const population = populationFor(world, 7101, 120);
      const request = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 91,
        startTime: START,
        endTime: END,
        config: {
          maxEvents: 180_000,
          maxSessionsPerCustomer: 18,
        },
      } as const;

      const left = simulateWorld(request);
      const right = simulateWorld(request);

      expect(JSON.stringify(left)).toBe(JSON.stringify(right));
      expect(left.observableEvents.length).toBeGreaterThan(0);
    },
    45_000,
  );

  it(
    "produces commerce without paid marketing when baseline demand exists",
    () => {
      const raw = baseAdversarialWorld(62002);
      const world = allPaidEffectsZero(raw);
      const population = populationFor(world, 7102, 160);
      const interventions = world.summary.activeChannels
        .filter((channel) =>
          [
            "meta",
            "google_search",
            "google_shopping",
            "pinterest",
            "affiliate",
          ].includes(channel),
        )
        .map((channel) => ({
          variable: `marketing.${channel}.spend`,
          operation: "set" as const,
          value: {
            kind: "number" as const,
            value: 0,
            unit: "money_minor" as const,
          },
        }));

      const result = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 92,
        startTime: START,
        endTime: END,
        interventions,
        config: { maxEvents: 220_000 },
      });

      expect(result.totals.representedOrders).toBeGreaterThan(0);
      expect(result.totals.representedRevenueMinor).toBeGreaterThan(0);

      const purchasePaths = result.godMode.purchaseTruth.map(
        (truth) => truth.observablePath,
      );
      expect(
        purchasePaths.some(
          (path) =>
            path.includes("direct") ||
            path.includes("organic_search"),
        ),
      ).toBe(true);
    },
    45_000,
  );

  it(
    "generates non-converting, looping and multi-session behavior rather than a deterministic funnel",
    () => {
      const world = baseAdversarialWorld(62003);
      const population = populationFor(world, 7103, 180);
      const result = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 93,
        startTime: START,
        endTime: END,
        config: { maxEvents: 240_000 },
      });

      const eventTypes = new Set(
        result.observableEvents.map((event) => event.eventType),
      );
      expect(eventTypes.has("product_view")).toBe(true);
      expect(eventTypes.has("add_to_cart")).toBe(true);
      expect(eventTypes.has("checkout_abandon")).toBe(true);
      expect(eventTypes.has("session_end")).toBe(true);

      const sessionsByCustomer = new Map<string, Set<string>>();
      for (const event of result.observableEvents) {
        if (!event.sessionId) continue;
        const set =
          sessionsByCustomer.get(event.anonymousSubjectId) ??
          new Set<string>();
        set.add(event.sessionId);
        sessionsByCustomer.set(event.anonymousSubjectId, set);
      }

      expect(
        [...sessionsByCustomer.values()].some(
          (sessions) => sessions.size >= 2,
        ),
      ).toBe(true);

      expect(
        result.observableEvents.filter(
          (event) => event.eventType === "session_start",
        ).length,
      ).toBeGreaterThan(result.purchases.length);
    },
    45_000,
  );

  it(
    "executes inventory intervention through causal state rather than editing final revenue",
    () => {
      const world = baseAdversarialWorld(62004);
      const population = populationFor(world, 7104, 120);
      const replay = replayCounterfactual({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 94,
        startTime: START,
        endTime: END,
        interventions: [
          {
            variable: "inventory.available",
            operation: "set",
            value: {
              kind: "number",
              value: 0,
              unit: "units",
            },
          },
        ],
        config: { maxEvents: 180_000 },
      });

      expect(replay.factual.totals.representedOrders).toBeGreaterThan(0);
      expect(replay.counterfactual.totals.representedOrders).toBe(0);
      expect(replay.counterfactual.totals.representedRevenueMinor).toBe(0);
    },
    45_000,
  );
});
