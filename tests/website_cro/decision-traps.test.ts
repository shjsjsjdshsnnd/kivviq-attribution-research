import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import type { LatentCustomerPopulation } from "../../src/customer_population/types.js";
import {
  defaultAdvertisingAllocation,
} from "../../src/advertising_economics/evaluator.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import type {
  PerfectObservableJourneyEvent,
  SimulationResult,
} from "../../src/simulation/types.js";
import {
  bottleneckSizeScenario,
  checkoutRegressionScenario,
  FIX_CHECKOUT_DEFECT,
  FIX_SEARCH_DEFECT,
  healthyWebsiteScenario,
  poorCheckoutScenario,
  slowMobilePdpScenario,
} from "../../src/website_cro/adversarial.js";
import {
  compareTrafficToCro,
  funnelDiagnostics,
  replayCroIntervention,
} from "../../src/website_cro/evaluator.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
  withChannelEffects,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";
const RELEASE = "2026-02-10T00:00:00.000Z";
const POST_END = "2026-04-01T00:00:00.000Z";

function trafficIncrease(
  world: ReturnType<typeof baseAdversarialWorld>,
  start = START,
  end = END,
) {
  const allocation = defaultAdvertisingAllocation(
    world,
    start,
    end,
  );
  const reference =
    allocation.spendMinorByChannel.meta ?? 1;
  return {
    variable: "marketing.meta.spend",
    operation: "set" as const,
    value: {
      kind: "number" as const,
      value: Math.max(reference * 1.15, 1),
      unit: "money_minor" as const,
    },
  };
}

function abundantInventory() {
  return {
    variable: "inventory.available",
    operation: "set" as const,
    value: {
      kind: "number" as const,
      value: 10_000,
      unit: "units" as const,
    },
  };
}

function withPaidSpendReferenceScale(
  world: ReturnType<typeof baseAdversarialWorld>,
  channel: "meta",
  factor: number,
): ReturnType<typeof baseAdversarialWorld> {
  const clone = structuredClone(world) as typeof world;
  const mechanism = clone.manifest.channelIncrementality.find(
    (candidate) => candidate.channelId === channel,
  );
  if (mechanism?.responseCurveId === undefined) {
    throw new RangeError("traffic sequencing fixture requires a response curve");
  }
  const curve = clone.manifest.responseCurves.find(
    (candidate) => candidate.id === mechanism.responseCurveId,
  );
  if (curve === undefined) {
    throw new RangeError("traffic sequencing response curve is missing");
  }

  const baselineReference =
    defaultAdvertisingAllocation(world, START, END)
      .spendMinorByChannel[channel] ?? 1;
  const mutable = curve as unknown as {
    kind: "linear" | "hill" | "threshold" | "piecewise";
    maxSpend?: number;
    halfSaturationSpend?: number;
    thresholdSpend?: number;
    points?: Array<{ spend: number; outcome: number }>;
  };

  if (mutable.kind === "linear") {
    mutable.maxSpend = Math.max(
      1,
      Math.round(baselineReference * factor),
    );
  } else if (mutable.kind === "hill") {
    mutable.halfSaturationSpend = Math.max(
      1,
      Math.round(
        (mutable.halfSaturationSpend ?? baselineReference) *
          factor,
      ),
    );
  } else if (mutable.kind === "threshold") {
    mutable.thresholdSpend = Math.max(
      1,
      Math.round(
        (mutable.thresholdSpend ?? baselineReference) *
          factor,
      ),
    );
  } else {
    mutable.points = (mutable.points ?? []).map((point) => ({
      ...point,
      spend:
        point.spend === 0
          ? 0
          : Math.max(1, Math.round(point.spend * factor)),
    }));
  }

  validateGroundTruthManifest(clone.manifest);
  return clone;
}

function checkoutCompletionInWindow(
  result: SimulationResult,
  start: string,
  end: string,
  device: "mobile" | "desktop",
): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  const started = new Set<string>();
  const purchased = new Set<string>();
  for (const event of result.observableEvents) {
    if (
      event.sessionId === undefined ||
      event.device !== device
    ) {
      continue;
    }
    const at = Date.parse(event.occurredAt);
    if (at < startMs || at >= endMs) continue;
    if (event.eventType === "checkout_start") {
      started.add(event.sessionId);
    }
    if (event.eventType === "purchase") {
      purchased.add(event.sessionId);
    }
  }
  let completed = 0;
  for (const sessionId of started) {
    if (purchased.has(sessionId)) completed += 1;
  }
  return completed / Math.max(1, started.size);
}

function checkoutFailureCountInWindow(
  result: SimulationResult,
  start: string,
  end: string,
  device: "mobile" | "desktop",
): number {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return result.observableEvents.filter((event) => {
    if (
      event.eventType !== "address_validation_failure" ||
      event.device !== device
    ) {
      return false;
    }
    const at = Date.parse(event.occurredAt);
    return at >= startMs && at < endMs;
  }).length;
}

function preReleaseObservableEvents(
  result: SimulationResult,
): readonly PerfectObservableJourneyEvent[] {
  const release = Date.parse(RELEASE);
  return result.observableEvents.filter(
    (event) => Date.parse(event.occurredAt) < release,
  );
}

function channelDeviceCorrelatedPopulation(
  population: LatentCustomerPopulation,
): LatentCustomerPopulation {
  const ordered = [...population.customers].sort(
    (left, right) =>
      left.purchaseIntent - right.purchaseIntent ||
      left.customerId.localeCompare(right.customerId),
  );
  const metaIds = new Set(
    ordered
      .filter((_customer, index) => index % 2 === 0)
      .map((customer) => customer.customerId),
  );

  return {
    ...population,
    customers: population.customers.map((customer) => {
      const metaCohort = metaIds.has(
        customer.customerId,
      );
      return {
        ...customer,
        devicePreference: metaCohort
          ? {
              mobileProbability: 0.995,
              desktopProbability: 0.004,
              tabletProbability: 0.001,
            }
          : {
              mobileProbability: 0.004,
              desktopProbability: 0.995,
              tabletProbability: 0.001,
            },
        channelTraits: customer.channelTraits.map(
          (trait) => {
            if (trait.channelId === "meta") {
              return {
                ...trait,
                naturalUseProbability: metaCohort
                  ? 0.95
                  : 0.02,
              };
            }
            if (
              trait.channelId === "google_search"
            ) {
              return {
                ...trait,
                naturalUseProbability: metaCohort
                  ? 0.02
                  : 0.95,
              };
            }
            return {
              ...trait,
              naturalUseProbability:
                trait.naturalUseProbability * 0.25,
            };
          },
        ),
      };
    }),
  };
}

describe("Step 12 causal decision traps", () => {
  it(
    "isolates a dated mobile checkout regression despite a simultaneous marketing-mix intervention",
    () => {
      const world = baseAdversarialWorld(64301);
      expect(world.summary.activeChannels).toContain(
        "meta",
      );
      const population = populationFor(world, 7331, 200);
      const marketingChange = {
        ...trafficIncrease(world, START, POST_END),
        effectiveAt: utcTimestamp(RELEASE),
      };
      const replay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 121,
        startTime: START,
        endTime: POST_END,
        websiteScenario: checkoutRegressionScenario(
          START,
          RELEASE,
        ),
        intervention: {
          ...FIX_CHECKOUT_DEFECT,
          effectiveAt: utcTimestamp(RELEASE),
        },
        interventions: [
          abundantInventory(),
          marketingChange,
        ],
        config: {
          maxEvents: 360_000,
          maxSessionsPerCustomer: 16,
        },
      });

      const factualPre =
        checkoutCompletionInWindow(
          replay.factual,
          START,
          RELEASE,
          "mobile",
        );
      const factualPost =
        checkoutCompletionInWindow(
          replay.factual,
          RELEASE,
          POST_END,
          "mobile",
        );
      const factualPostAddressFailures =
        checkoutFailureCountInWindow(
          replay.factual,
          RELEASE,
          POST_END,
          "mobile",
        );
      const fixedPostAddressFailures =
        checkoutFailureCountInWindow(
          replay.counterfactual,
          RELEASE,
          POST_END,
          "mobile",
        );

      expect(
        preReleaseObservableEvents(
          replay.counterfactual,
        ),
      ).toEqual(
        preReleaseObservableEvents(replay.factual),
      );
      expect(factualPost).toBeLessThan(factualPre);
      expect(factualPostAddressFailures).toBeGreaterThan(0);
      expect(fixedPostAddressFailures).toBeLessThan(
        factualPostAddressFailures,
      );
      expect(
        replay.delta.representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        replay.factual.godMode.website?.causalEvents.some(
          (event) =>
            Date.parse(event.occurredAt) >=
              Date.parse(RELEASE) &&
            event.device === "mobile" &&
            event.component === "checkout" &&
            event.friction ===
              "address_validation_failure",
        ),
      ).toBe(true);
    },
    90_000,
  );

  it(
    "separates the visually worst funnel metric from the economically highest-value CRO fix",
    () => {
      const world = allPaidEffectsZero(
        baseAdversarialWorld(64302),
      );
      const population = populationFor(world, 7332, 220);
      const scenario = bottleneckSizeScenario(START);

      const searchReplay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 122,
        startTime: START,
        endTime: END,
        websiteScenario: scenario,
        intervention: FIX_SEARCH_DEFECT,
        config: { maxEvents: 340_000 },
      });
      const checkoutReplay = replayCroIntervention({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 122,
        startTime: START,
        endTime: END,
        websiteScenario: scenario,
        intervention: FIX_CHECKOUT_DEFECT,
        config: { maxEvents: 340_000 },
      });

      expect(checkoutReplay.factual.totals).toEqual(
        searchReplay.factual.totals,
      );
      const diagnostics = funnelDiagnostics(
        searchReplay.factual,
        population,
      );
      expect(
        diagnostics.overall.searchSuccessRate,
      ).not.toBeNull();
      expect(
        diagnostics.overall.checkoutToPurchaseRate,
      ).not.toBeNull();
      expect(
        diagnostics.overall.searchSuccessRate!,
      ).toBeLessThan(
        diagnostics.overall.checkoutToPurchaseRate!,
      );
      expect(
        checkoutReplay.delta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(
        searchReplay.delta
          .representedContributionProfitMinor,
      );
    },
    120_000,
  );

  it(
    "makes fixing a website bottleneck more valuable than buying more traffic, then restores the marginal value of traffic after the fix",
    () => {
      const zeroBase = allPaidEffectsZero(
        baseAdversarialWorld(64303),
      );
      const scale =
        zeroBase.summary.expectedAnnualOrders / 12;
      const causalWorld = withChannelEffects(
        zeroBase,
        {
          meta: scale * 2.5,
          google_search: scale * 0.7,
          pinterest: scale * 0.45,
        },
        { zeroInteractions: true },
      );
      const world = withPaidSpendReferenceScale(
        causalWorld,
        "meta",
        0.005,
      );
      const population = populationFor(
        zeroBase,
        7333,
        100,
      );
      const traffic = trafficIncrease(world);
      const poor = compareTrafficToCro({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 123,
        startTime: START,
        endTime: END,
        websiteScenario: poorCheckoutScenario(START),
        croIntervention: FIX_CHECKOUT_DEFECT,
        trafficIntervention: traffic,
        interventions: [abundantInventory()],
        config: {
          maxEvents: 390_000,
          maxSessionsPerCustomer: 12,
        },
      });

      expect(
        poor.croDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(
        poor.trafficDelta
          .representedContributionProfitMinor,
      );

      expect(
        poor.incrementalTrafficSpendMinor,
      ).toBeGreaterThan(0);

      const fixed = compareTrafficToCro({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 123,
        startTime: START,
        endTime: END,
        websiteScenario:
          healthyWebsiteScenario(START),
        croIntervention: FIX_CHECKOUT_DEFECT,
        trafficIntervention: traffic,
        interventions: [abundantInventory()],
        config: {
          maxEvents: 390_000,
          maxSessionsPerCustomer: 12,
        },
      });

      expect(
        fixed.incrementalTrafficSpendMinor,
      ).toBe(
        poor.incrementalTrafficSpendMinor,
      );
      expect(
        fixed.trafficDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        fixed.trafficDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(
        poor.trafficDelta
          .representedContributionProfitMinor,
      );
    },
    120_000,
  );

  it(
    "can make Meta look weaker through a mobile-site defect while channel causal effects remain unchanged",
    () => {
      const zeroBase = allPaidEffectsZero(
        baseAdversarialWorld(64304),
      );
      expect(zeroBase.summary.activeChannels).toEqual(
        expect.arrayContaining([
          "meta",
          "google_search",
        ]),
      );
      const scale =
        zeroBase.summary.expectedAnnualOrders / 12;
      const world = withChannelEffects(
        zeroBase,
        {
          meta: scale * 0.8,
          google_search: scale * 0.8,
        },
        { zeroInteractions: true },
      );
      const rawPopulation = populationFor(
        zeroBase,
        7334,
        220,
      );
      const population =
        channelDeviceCorrelatedPopulation(
          rawPopulation,
        );
      const common = {
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 124,
        startTime: START,
        endTime: END,
        config: { maxEvents: 340_000 },
      } as const;
      const healthy = simulateWorld({
        ...common,
        commercePolicy: {
          websiteScenario:
            healthyWebsiteScenario(START),
        },
      });
      const broken = simulateWorld({
        ...common,
        commercePolicy: {
          websiteScenario:
            slowMobilePdpScenario(START),
        },
      });

      const healthyDiagnostics =
        funnelDiagnostics(healthy, population);
      const brokenDiagnostics =
        funnelDiagnostics(broken, population);
      const rate = (
        diagnostics: ReturnType<
          typeof funnelDiagnostics
        >,
        channel: "meta" | "google_search",
      ) => {
        const row = diagnostics.byChannel.find(
          (candidate) =>
            candidate.dimension === channel,
        );
        expect(row).toBeDefined();
        expect(row!.pdpToAtcRate).not.toBeNull();
        return row!.pdpToAtcRate!;
      };

      const metaDrop =
        rate(healthyDiagnostics, "meta") -
        rate(brokenDiagnostics, "meta");
      const googleDrop =
        rate(healthyDiagnostics, "google_search") -
        rate(brokenDiagnostics, "google_search");

      expect(metaDrop).toBeGreaterThan(0);
      expect(metaDrop).toBeGreaterThan(googleDrop);
      expect(
        healthy.provenance.merchantWorldId,
      ).toBe(world.manifest.worldId);
      expect(
        broken.provenance.merchantWorldId,
      ).toBe(world.manifest.worldId);
      expect(
        healthy.provenance.interventions,
      ).toEqual(broken.provenance.interventions);
      expect(
        broken.godMode.website?.causalEvents.some(
          (event) =>
            event.device === "mobile" &&
            event.component === "pdp" &&
            event.friction === "latency",
        ),
      ).toBe(true);
    },
    120_000,
  );
});
