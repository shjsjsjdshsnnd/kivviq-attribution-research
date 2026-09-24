import { describe, expect, it } from "vitest";
import type { LatentCustomerPopulation } from "../../src/customer_population/types.js";
import {
  defaultAdvertisingAllocation,
} from "../../src/advertising_economics/evaluator.js";
import {
  badSearchScenario,
  brokenCouponScenario,
  FIX_SEARCH_DEFECT,
  FIX_SLOW_MOBILE_PDP,
  IMPROVE_PDP_IMAGERY,
  shippingSurpriseScenario,
  slowMobilePdpScenario,
} from "../../src/website_cro/adversarial.js";
import {
  compareTrafficToCro,
} from "../../src/website_cro/evaluator.js";
import {
  resolveWebsiteState,
} from "../../src/website_cro/runtime.js";
import type {
  WebsiteScenario,
} from "../../src/website_cro/types.js";
import {
  baseAdversarialWorld,
  populationFor,
  withChannelEffects,
} from "../simulation/fixture.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";

function metaSpend(
  world: ReturnType<typeof baseAdversarialWorld>,
  factor: number,
) {
  const baseline =
    defaultAdvertisingAllocation(
      world,
      START,
      END,
    ).spendMinorByChannel.meta;
  if (baseline === undefined) {
    throw new RangeError(
      "specificity trap requires active Meta spend",
    );
  }
  return {
    variable: "marketing.meta.spend",
    operation: "set" as const,
    value: {
      kind: "number" as const,
      value: Math.max(
        0,
        Math.round(baseline * factor),
      ),
      unit: "money_minor" as const,
    },
  };
}

function highIntentPopulation(
  population: LatentCustomerPopulation,
): LatentCustomerPopulation {
  return {
    ...population,
    customers: population.customers.map(
      (customer) => ({
        ...customer,
        purchaseIntent: Math.max(
          customer.purchaseIntent,
          0.82,
        ),
        currentPurchaseNeed: Math.max(
          customer.currentPurchaseNeed,
          0.78,
        ),
      }),
    ),
  };
}

function channelDeviceCorrelatedPopulation(
  population: LatentCustomerPopulation,
): LatentCustomerPopulation {
  const ordered = [...population.customers].sort(
    (left, right) =>
      left.purchaseIntent - right.purchaseIntent ||
      left.customerId.localeCompare(
        right.customerId,
      ),
  );
  const metaIds = new Set(
    ordered
      .filter(
        (_customer, index) => index % 2 === 0,
      )
      .map((customer) => customer.customerId),
  );

  return {
    ...population,
    customers: population.customers.map(
      (customer) => {
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
          channelTraits:
            customer.channelTraits.map(
              (trait) => {
                if (
                  trait.channelId === "meta"
                ) {
                  return {
                    ...trait,
                    naturalUseProbability:
                      metaCohort ? 0.95 : 0.02,
                  };
                }
                if (
                  trait.channelId ===
                  "google_search"
                ) {
                  return {
                    ...trait,
                    naturalUseProbability:
                      metaCohort ? 0.02 : 0.95,
                  };
                }
                return {
                  ...trait,
                  naturalUseProbability:
                    trait.naturalUseProbability *
                    0.25,
                };
              },
            ),
        };
      },
    ),
  };
}

function withIntervention(
  scenario: WebsiteScenario,
  intervention: typeof IMPROVE_PDP_IMAGERY,
): WebsiteScenario {
  return {
    ...scenario,
    interventions: [
      ...(scenario.interventions ?? []),
      intervention,
    ],
  };
}

describe("Step 12 intervention specificity", () => {
  it(
    "makes fixing bad search economically superior to buying more traffic in the bad-search trap",
    () => {
      const base = baseAdversarialWorld(64601);
      const scale =
        base.summary.expectedAnnualOrders / 12;
      const world = withChannelEffects(
        base,
        {
          meta: scale * 0.75,
          google_search: scale * 0.55,
        },
        { zeroInteractions: true },
      );
      const population = highIntentPopulation(
        populationFor(world, 7361, 120),
      );
      const result = compareTrafficToCro({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 161,
        startTime: START,
        endTime: END,
        websiteScenario:
          badSearchScenario(START),
        croIntervention: FIX_SEARCH_DEFECT,
        trafficIntervention:
          metaSpend(world, 1.12),
        config: {
          maxEvents: 300_000,
          maxSessionsPerCustomer: 48,
          opportunityCadenceHours: 48,
        },
      });

      expect(
        result.baseline.totals.representedOrders,
      ).toBeGreaterThan(0);
      expect(
        result.croDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        result.incrementalTrafficSpendMinor,
      ).toBeGreaterThan(0);
      expect(
        result.croDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(
        result.trafficDelta
          .representedContributionProfitMinor,
      );
    },
    90_000,
  );

  it(
    "makes fixing the mobile PDP economically superior to cutting Meta in the channel-blame trap",
    () => {
      const base = baseAdversarialWorld(64602);
      const scale =
        base.summary.expectedAnnualOrders / 12;
      const world = withChannelEffects(
        base,
        {
          meta: scale * 0.8,
          google_search: scale * 0.8,
        },
        { zeroInteractions: true },
      );
      const population =
        channelDeviceCorrelatedPopulation(
          populationFor(world, 7362, 120),
        );
      const result = compareTrafficToCro({
        merchantWorld: world,
        latentPopulation: population,
        simulationSeed: 162,
        startTime: START,
        endTime: END,
        websiteScenario:
          slowMobilePdpScenario(START),
        croIntervention:
          FIX_SLOW_MOBILE_PDP,
        trafficIntervention:
          metaSpend(world, 0.98),
        config: {
          maxEvents: 300_000,
          maxSessionsPerCustomer: 48,
          opportunityCadenceHours: 48,
        },
      });

      expect(
        result.incrementalTrafficSpendMinor,
      ).toBeLessThan(0);
      expect(
        result.croDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(0);
      expect(
        result.croDelta
          .representedContributionProfitMinor,
      ).toBeGreaterThan(
        result.trafficDelta
          .representedContributionProfitMinor,
      );
    },
    90_000,
  );

  it("keeps unrelated PDP imagery changes from mutating coupon or shipping root-cause parameters", () => {
    const coupon = resolveWebsiteState(
      withIntervention(
        brokenCouponScenario(START),
        IMPROVE_PDP_IMAGERY,
      ),
      Date.parse(START),
      "mobile",
    );
    const shipping = resolveWebsiteState(
      withIntervention(
        shippingSurpriseScenario(START),
        IMPROVE_PDP_IMAGERY,
      ),
      Date.parse(START),
      "mobile",
    );

    expect(coupon.pdp.imageryQuality).toBe(
      0.96,
    );
    expect(coupon.cart.couponReliability).toBe(
      0.03,
    );
    expect(
      shipping.pdp.imageryQuality,
    ).toBe(0.96);
    expect(
      shipping.checkout
        .shippingCostVisibility,
    ).toBe("checkout_review");
    expect(
      shipping.cart.shippingVisibility,
    ).toBe(0.12);
  });
});
