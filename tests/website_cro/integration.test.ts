import { describe, expect, it } from "vitest";
import type { LatentCustomerPopulation } from "../../src/customer_population/types.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import {
  deviceNeutralWebsiteScenario,
  FIX_SLOW_MOBILE_PDP,
  slowMobilePdpScenario,
} from "../../src/website_cro/adversarial.js";
import {
  funnelDiagnostics,
  replayCroIntervention,
} from "../../src/website_cro/evaluator.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";

function diagnosticByDevice(
  diagnostics: ReturnType<typeof funnelDiagnostics>,
  device: string,
) {
  const row = diagnostics.byDevice.find(
    (candidate) => candidate.dimension === device,
  );
  expect(row).toBeDefined();
  return row!;
}

function customerIntentByObservedDevice(
  population: LatentCustomerPopulation,
  result: ReturnType<typeof simulateWorld>,
  device: "mobile" | "desktop",
): number {
  const byId = new Map(
    population.customers.map((customer) => [
      customer.customerId,
      customer,
    ]),
  );
  const ids = new Set(
    result.observableEvents
      .filter(
        (event) =>
          event.eventType === "visit" &&
          event.device === device,
      )
      .map((event) => event.anonymousSubjectId),
  );
  const customers = [...ids]
    .map((id) => byId.get(id))
    .filter(
      (
        customer,
      ): customer is NonNullable<typeof customer> =>
        customer !== undefined,
    );
  return (
    customers.reduce(
      (sum, customer) =>
        sum + customer.purchaseIntent,
      0,
    ) / Math.max(1, customers.length)
  );
}

function compositionSkewedPopulation(
  population: LatentCustomerPopulation,
): LatentCustomerPopulation {
  const ordered = [...population.customers].sort(
    (left, right) =>
      left.purchaseIntent - right.purchaseIntent ||
      left.customerId.localeCompare(right.customerId),
  );
  const mobileIds = new Set(
    ordered
      .slice(0, Math.floor(ordered.length / 2))
      .map((customer) => customer.customerId),
  );

  return {
    ...population,
    customers: population.customers.map((customer) =>
      mobileIds.has(customer.customerId)
        ? {
            ...customer,
            devicePreference: {
              mobileProbability: 0.995,
              desktopProbability: 0.004,
              tabletProbability: 0.001,
            },
          }
        : {
            ...customer,
            devicePreference: {
              mobileProbability: 0.004,
              desktopProbability: 0.995,
              tabletProbability: 0.001,
            },
          },
    ),
  };
}

describe("Step 12 website integration", () => {
  it(
    "is fully opt-in and preserves the frozen simulation path when no website scenario is supplied",
    () => {
      const world = baseAdversarialWorld(64101);
      const population = populationFor(world, 7311, 100);
      const common = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 101,
        startTime: START,
        endTime: "2026-04-01T00:00:00.000Z",
        config: { maxEvents: 140_000 },
      } as const;

      const legacy = simulateWorld(common);
      const explicitEmptyPolicy = simulateWorld({
        ...common,
        commercePolicy: {},
      });

      expect(explicitEmptyPolicy).toEqual(legacy);
      expect(legacy.godMode.website).toBeUndefined();
    },
    45_000,
  );

  it(
    "makes slow mobile PDP a causal bottleneck even when observed mobile and desktop customer intent are comparable",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64102),
      );
      const population = populationFor(world, 7312, 180);
      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 102,
        startTime: START,
        endTime: END,
        websiteScenario: slowMobilePdpScenario(START),
        intervention: FIX_SLOW_MOBILE_PDP,
        config: {
          maxEvents: 280_000,
          maxSessionsPerCustomer: 18,
        },
      });

      const factual = funnelDiagnostics(
        replay.factual,
        population,
      );
      const fixed = funnelDiagnostics(
        replay.counterfactual,
        population,
      );
      const mobileFactual =
        diagnosticByDevice(factual, "mobile");
      const desktopFactual =
        diagnosticByDevice(factual, "desktop");
      const mobileFixed =
        diagnosticByDevice(fixed, "mobile");

      expect(
        Math.abs(
          customerIntentByObservedDevice(
            population,
            replay.factual,
            "mobile",
          ) -
            customerIntentByObservedDevice(
              population,
              replay.factual,
              "desktop",
            ),
        ),
      ).toBeLessThan(0.18);
      expect(mobileFactual.pdpToAtcRate).not.toBeNull();
      expect(desktopFactual.pdpToAtcRate).not.toBeNull();
      expect(mobileFixed.pdpToAtcRate).not.toBeNull();
      expect(mobileFactual.pdpToAtcRate!).toBeLessThan(
        desktopFactual.pdpToAtcRate!,
      );
      expect(mobileFixed.pdpToAtcRate!).toBeGreaterThan(
        mobileFactual.pdpToAtcRate!,
      );
      expect(replay.delta.addToCarts).toBeGreaterThan(0);
      expect(
        replay.delta.representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        replay.factual.godMode.website?.causalEvents.some(
          (event) =>
            event.device === "mobile" &&
            event.component === "pdp" &&
            event.friction === "latency",
        ),
      ).toBe(true);
    },
    90_000,
  );

  it(
    "keeps a traffic-quality control where the website is device-neutral and an identical CRO replay has zero causal effect",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64103),
      );
      const rawPopulation = populationFor(
        world,
        7313,
        180,
      );
      const population =
        compositionSkewedPopulation(rawPopulation);
      const scenario =
        deviceNeutralWebsiteScenario(START);
      const noOpMobileFix = {
        variable:
          "website.pdp.mobile.latency_seconds",
        operation: "set" as const,
        value: {
          kind: "number" as const,
          value: 0.7,
          unit: "seconds" as const,
        },
        population: {
          devices: ["mobile"] as const,
        },
      };

      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 103,
        startTime: START,
        endTime: END,
        websiteScenario: scenario,
        intervention: noOpMobileFix,
        config: {
          maxEvents: 260_000,
          maxSessionsPerCustomer: 16,
        },
      });
      const diagnostics = funnelDiagnostics(
        replay.factual,
        population,
      );
      const mobile = diagnosticByDevice(
        diagnostics,
        "mobile",
      );
      const desktop = diagnosticByDevice(
        diagnostics,
        "desktop",
      );

      expect(mobile.pdpToAtcRate).not.toBeNull();
      expect(desktop.pdpToAtcRate).not.toBeNull();
      expect(mobile.pdpToAtcRate!).toBeLessThan(
        desktop.pdpToAtcRate!,
      );
      expect(replay.delta.sessionsProgressing).toBe(0);
      expect(replay.delta.addToCarts).toBe(0);
      expect(replay.delta.checkoutStarts).toBe(0);
      expect(replay.delta.representedOrders).toBe(0);
      expect(replay.delta.representedRevenueMinor).toBe(0);
      expect(
        replay.delta.representedContributionProfitMinor,
      ).toBe(0);
    },
    90_000,
  );
});
