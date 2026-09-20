import { describe, expect, it } from "vitest";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import {
  audienceCompositionAtSpend,
  deliveryAtSpend,
  deliveryProfileForChannel,
  stateResponseMultiplier,
} from "../../src/advertising_economics/delivery.js";
import { isPaidMarketingChannel } from "../../src/advertising_economics/types.js";

describe("advertising delivery economics", () => {
  it("moves from reach expansion toward frequency and saturation as spend rises", () => {
    const world = generateMerchantWorldRecord({
      seed: 82001,
      archetype: "fashion_apparel",
      scale: "growth",
      complexity: "complex",
      marketingDependence: "paid_media_heavy",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 4401,
      populationConfig: { maxExplicitAgents: 800 },
    });
    const channel = world.summary.activeChannels.find(isPaidMarketingChannel)!;
    const profile = deliveryProfileForChannel(world, channel);

    const low = deliveryAtSpend(world, population, profile, 50_000);
    const mid = deliveryAtSpend(world, population, profile, 250_000);
    const high = deliveryAtSpend(world, population, profile, 1_500_000);

    expect(low.uniqueReach).toBeLessThan(mid.uniqueReach);
    expect(mid.uniqueReach).toBeLessThanOrEqual(high.uniqueReach);
    expect(high.reachFraction).toBeGreaterThan(mid.reachFraction);
    expect(high.averageFrequency).toBeGreaterThan(mid.averageFrequency);
    expect(high.saturationIndex).toBeGreaterThan(mid.saturationIndex);
  });

  it("allows audience quality and susceptibility to deteriorate as reach expands", () => {
    const world = generateMerchantWorldRecord({
      seed: 82002,
      archetype: "consumer_electronics",
      scale: "growth",
      complexity: "adversarial",
      marketingDependence: "paid_media_heavy",
    });
    const population = generateCustomerPopulation({
      merchantWorld: world,
      populationSeed: 4402,
      populationConfig: {
        maxExplicitAgents: 1_200,
        complexity: "adversarial",
      },
    });
    const channel = world.summary.activeChannels.find(isPaidMarketingChannel)!;
    const profile = deliveryProfileForChannel(world, channel);

    const lowDelivery = deliveryAtSpend(world, population, profile, 40_000);
    const highDelivery = deliveryAtSpend(world, population, profile, 1_800_000);

    const low = audienceCompositionAtSpend(
      population,
      channel,
      lowDelivery,
    );
    const high = audienceCompositionAtSpend(
      population,
      channel,
      highDelivery,
    );

    expect(low.reachedPopulationWeight).toBeLessThan(
      high.reachedPopulationWeight,
    );
    expect(low.meanPurchaseIntent).toBeGreaterThanOrEqual(
      high.meanPurchaseIntent,
    );
    expect(low.meanCausalSusceptibility).toBeGreaterThanOrEqual(
      high.meanCausalSusceptibility,
    );
    expect(lowDelivery.qualityIndex).toBeGreaterThanOrEqual(
      highDelivery.qualityIndex,
    );
  });

  it("changes contextual response with seasonality promotion inventory and audience quality", () => {
    const world = generateMerchantWorldRecord({
      seed: 82003,
      archetype: "home_furnishings_decor",
      scale: "growth",
      complexity: "complex",
      seasonalityProfile: "q4_heavy",
    });

    const strong = stateResponseMultiplier(world, {
      timestamp: "2026-11-20T00:00:00.000Z",
      promotionActive: true,
      inventoryAvailabilityRatio: 1,
      audienceQualityIndex: 0.95,
    });
    const constrained = stateResponseMultiplier(world, {
      timestamp: "2026-02-10T00:00:00.000Z",
      promotionActive: false,
      inventoryAvailabilityRatio: 0.15,
      audienceQualityIndex: 0.35,
    });

    expect(strong).toBeGreaterThan(constrained);
  });
});
