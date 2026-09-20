import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import { simulateWorld } from "../../src/simulation/simulator.js";
import {
  buildPlatformChannelReport,
  googleSearchPlatformSplit,
  platformClaims,
} from "../../src/advertising_economics/platform.js";
import { isPaidMarketingChannel } from "../../src/advertising_economics/types.js";
import { referenceSpendMinor } from "../../src/advertising_economics/evaluator.js";

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-06-01T00:00:00.000Z";

function fixture() {
  const world = generateMerchantWorldRecord({
    seed: 83001,
    archetype: "fashion_apparel",
    scale: "growth",
    complexity: "adversarial",
    marketingDependence: "paid_media_heavy",
    overrides: {
      forceZeroIncrementalityChannels: [
        "meta",
        "google_search",
        "pinterest",
      ],
    },
  });
  const population = generateCustomerPopulation({
    merchantWorld: world,
    populationSeed: 4501,
    populationConfig: {
      maxExplicitAgents: 180,
      complexity: "adversarial",
    },
  });

  const interventions = world.summary.activeChannels
    .filter(isPaidMarketingChannel)
    .map((channel) => ({
      variable: `marketing.${channel}.spend`,
      operation: "set" as const,
      value: {
        kind: "number" as const,
        value: referenceSpendMinor(world, channel),
        unit: "money_minor" as const,
      },
    }));

  const result = simulateWorld({
    merchantWorld: world,
    latentPopulation: population,
    simulationSeed: 5501,
    startTime: START,
    endTime: END,
    interventions,
    config: { maxEvents: 260_000 },
  });

  return { world, population, result };
}

describe("synthetic platform reporting", () => {
  it("allows independent platforms to claim the same purchase", () => {
    const { world, population, result } = fixture();
    const channels = world.summary.activeChannels.filter(
      isPaidMarketingChannel,
    );

    const reports = channels.map((channel) =>
      buildPlatformChannelReport(
        result,
        population,
        channel,
        referenceSpendMinor(world, channel),
      ),
    );

    const claimedByOrder = new Map<string, Set<string>>();
    for (const report of reports) {
      for (const claim of report.claims) {
        const set =
          claimedByOrder.get(claim.orderId) ??
          new Set<string>();
        set.add(report.channel);
        claimedByOrder.set(claim.orderId, set);
      }
    }

    expect(
      [...claimedByOrder.values()].some(
        (channelsForOrder) => channelsForOrder.size >= 2,
      ),
    ).toBe(true);

    const weights = new Map(
      population.customers.map(
        (customer) => [customer.customerId, customer.populationWeight] as const,
      ),
    );
    const merchantRevenue = result.purchases.reduce(
      (sum, purchase) =>
        sum +
        purchase.netRevenueMinor *
          (weights.get(purchase.customerId) ?? 1),
      0,
    );
    const claimedRevenue = reports.reduce(
      (sum, report) => sum + report.attributedRevenueMinor,
      0,
    );

    expect(claimedRevenue).toBeGreaterThan(merchantRevenue);
  }, 60_000);

  it("reports branded and non-brand Google Search claims separately when both occur", () => {
    const { world, population, result } = fixture();
    expect(world.summary.activeChannels).toContain("google_search");

    const report = buildPlatformChannelReport(
      result,
      population,
      "google_search",
      referenceSpendMinor(world, "google_search"),
    );
    const split = googleSearchPlatformSplit(
      report,
      population,
    );

    expect(
      split.brandClaims + split.nonbrandClaims,
    ).toBeGreaterThan(0);
    expect(
      split.brandAttributedRevenueMinor +
        split.nonbrandAttributedRevenueMinor,
    ).toBeLessThanOrEqual(report.attributedRevenueMinor + 1e-6);
  }, 60_000);

  it("platform claim rules remain causal-blind for a zero-effect channel", () => {
    const { result } = fixture();
    const metaClaims = platformClaims(result, "meta");

    expect(metaClaims.length).toBeGreaterThan(0);
    expect(
      metaClaims.some(
        (claim) => claim.touchKind === "view_through",
      ),
    ).toBe(true);
  }, 60_000);
});
