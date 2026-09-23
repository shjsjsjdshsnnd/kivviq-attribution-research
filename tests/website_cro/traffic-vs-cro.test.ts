import { describe, expect, it } from "vitest";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";
import {
  defaultAdvertisingAllocation,
} from "../../src/advertising_economics/evaluator.js";
import {
  FIX_CHECKOUT_DEFECT,
  healthyWebsiteScenario,
  poorCheckoutScenario,
} from "../../src/website_cro/adversarial.js";
import {
  compareTrafficToCro,
} from "../../src/website_cro/evaluator.js";
import {
  allPaidEffectsZero,
  baseAdversarialWorld,
  populationFor,
  withChannelEffects,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";

function trafficIncrease(
  world: ReturnType<typeof baseAdversarialWorld>,
  start = START,
  end = END,
  spendScale = 1.15,
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
      value: Math.max(reference * spendScale, 1),
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

describe("Step 12 traffic-vs-CRO sequencing trap", () => {
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
        0.001,
      );
      const population = populationFor(
        zeroBase,
        7333,
        100,
      );
      const traffic = trafficIncrease(
        world,
        START,
        END,
        2.5,
      );
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
          maxSessionsPerCustomer: 100,
          opportunityCadenceHours: 72,
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
          maxSessionsPerCustomer: 100,
          opportunityCadenceHours: 72,
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
});
