import { describe, expect, it } from "vitest";
import { simulateWorld } from "../../src/simulation/simulator.js";
import {
  EXTERNAL_REALITY_MODEL_VERSION,
  type ExternalEnvironment,
} from "../../src/external_reality/index.js";
import {
  baseAdversarialWorld,
  populationFor,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-03-01T00:00:00.000Z";

function confoundedEnvironment(): ExternalEnvironment {
  return {
    version: EXTERNAL_REALITY_MODEL_VERSION,
    environmentId: "confounded-step14",
    seed: 1401,
    events: [
      {
        id: "macro-slowdown",
        domain: "economy",
        kind: "economic_slowdown",
        startsAt: START,
        endsAt: END,
        effects: [
          {
            target: "demand",
            logMultiplier: Math.log(1.8),
          },
          {
            target: "price_sensitivity",
            logMultiplier: Math.log(1.15),
          },
        ],
        observations: [
          {
            kind: "lagged_report",
            availableAt: "2026-01-15T00:00:00.000Z",
            signal: "macro demand conditions changed",
          },
        ],
      },
      {
        id: "shipping-event",
        domain: "logistics",
        kind: "shipping_disruption",
        startsAt: START,
        endsAt: END,
        effects: [
          {
            target: "shipping_cost",
            logMultiplier: Math.log(1.5),
          },
          {
            target: "delivery_time",
            logMultiplier: Math.log(1.6),
          },
          {
            target: "purchase_propensity",
            logMultiplier: Math.log(1.5),
          },
          {
            target: "return_propensity",
            logMultiplier: Math.log(1.2),
          },
        ],
      },
      {
        id: "supplier-event",
        domain: "supplier",
        kind: "supplier_problem",
        startsAt: START,
        endsAt: END,
        effects: [
          {
            target: "inventory_availability",
            logMultiplier: Math.log(0.9),
          },
          {
            target: "supplier_lead_time",
            logMultiplier: Math.log(1.4),
          },
          {
            target: "landed_cost",
            logMultiplier: Math.log(1.25),
          },
        ],
      },
      {
        id: "trend",
        domain: "consumer",
        kind: "consumer_trend",
        startsAt: START,
        endsAt: END,
        effects: [
          {
            target: "category_preference",
            logMultiplier: Math.log(1.2),
          },
        ],
      },
      {
        id: "platform",
        domain: "platform",
        kind: "platform_algorithm_change",
        startsAt: START,
        endsAt: END,
        effects: [
          {
            target: "reported_attribution",
            logMultiplier: Math.log(0.8),
          },
        ],
      },
    ],
  };
}

describe("Step 14 simulator integration", () => {
  it(
    "keeps merchant interventions and external causes separate in one confounded run",
    () => {
      const world = baseAdversarialWorld(64101);
      const population = populationFor(
        world,
        74101,
        50,
      );
      const result = simulateWorld({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 141,
        startTime: START,
        endTime: END,
        interventions: [
          {
            variable: "pricing.product_price",
            operation: "set",
            value: {
              kind: "number",
              value: Math.max(
                100,
                Math.round(
                  world.summary.catalogMedianPriceMinor *
                    0.9,
                ),
              ),
              unit: "money_minor",
            },
          },
        ],
        commercePolicy: {
          customerShippingChargeMinor: 1_200,
          externalRealityEnvironment:
            confoundedEnvironment(),
        },
        config: {
          maxEvents: 120_000,
          maxSessionsPerCustomer: 16,
        },
      });

      expect(result.provenance.interventions).toHaveLength(1);
      expect(
        result.godMode.externalReality?.environmentId,
      ).toBe("confounded-step14");
      expect(
        result.godMode.externalReality?.applications.length,
      ).toBeGreaterThan(0);

      const appliedTargets = new Set(
        result.godMode.externalReality?.applications.map(
          (entry) => entry.target,
        ) ?? [],
      );
      expect(appliedTargets.has("demand")).toBe(true);
      expect(
        appliedTargets.has("category_preference"),
      ).toBe(true);
      expect(
        appliedTargets.has("inventory_availability"),
      ).toBe(true);

      expect(result.externalSignals).toEqual([
        {
          eventId: "macro-slowdown",
          domain: "economy",
          eventKind: "economic_slowdown",
          observationKind: "lagged_report",
          availableAt:
            "2026-01-15T00:00:00.000Z",
          signal: "macro demand conditions changed",
        },
      ]);

      expect(
        JSON.stringify(result.externalSignals),
      ).not.toContain("logMultiplier");

      if (result.purchases.length > 0) {
        expect(
          result.purchases.every(
            (purchase) =>
              purchase.realizedCustomerShippingChargeMinor !==
                undefined &&
              purchase.estimatedDeliveryDays !== undefined,
          ),
        ).toBe(true);
      }
    },
    45_000,
  );
});
