import type { LatentCustomerPopulation } from "../../src/customer_population/types.js";
import { generateCustomerPopulation } from "../../src/customer_population/generator.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../../src/generation/config.js";
import {
  MARKETING_CHANNELS,
} from "../../src/generation/config.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import { validateGroundTruthManifest } from "../../src/ground_truth/manifest.js";

export const PAID_CHANNELS: readonly MarketingChannel[] = [
  "meta",
  "google_search",
  "google_shopping",
  "pinterest",
  "affiliate",
];

export function baseAdversarialWorld(
  seed = 61001,
): GeneratedMerchantWorld {
  return generateMerchantWorldRecord({
    seed,
    archetype: "fashion_apparel",
    scale: "growth",
    complexity: "adversarial",
    overrides: {
      forceZeroIncrementalityChannels: MARKETING_CHANNELS,
    },
  });
}

export function populationFor(
  world: GeneratedMerchantWorld,
  populationSeed = 7001,
  maxExplicitAgents = 180,
): LatentCustomerPopulation {
  return generateCustomerPopulation({
    merchantWorld: world,
    populationSeed,
    populationConfig: {
      maxExplicitAgents,
      complexity: "adversarial",
      maxCategoryPreferences: 4,
      maxProductPreferences: 6,
    },
  });
}

export function withChannelEffects(
  world: GeneratedMerchantWorld,
  effects: Readonly<Partial<Record<MarketingChannel, number>>>,
  options: {
    readonly zeroInteractions?: boolean;
  } = {},
): GeneratedMerchantWorld {
  const clone = structuredClone(world) as unknown as {
    manifest: {
      channelIncrementality: Array<{
        channelId: MarketingChannel;
        effect: { value: number };
      }>;
      channelInteractions: Array<{
        effect: { value: number };
      }>;
    };
  } & GeneratedMerchantWorld;

  for (const mechanism of clone.manifest.channelIncrementality) {
    if (effects[mechanism.channelId] !== undefined) {
      mechanism.effect.value = effects[mechanism.channelId]!;
    }
  }

  if (options.zeroInteractions) {
    for (const interaction of clone.manifest.channelInteractions) {
      interaction.effect.value = 0;
    }
  }

  validateGroundTruthManifest(clone.manifest);
  return clone;
}

export function allPaidEffectsZero(
  world: GeneratedMerchantWorld,
): GeneratedMerchantWorld {
  return withChannelEffects(
    world,
    Object.fromEntries(
      PAID_CHANNELS.map((channel) => [channel, 0]),
    ) as Partial<Record<MarketingChannel, number>>,
    { zeroInteractions: true },
  );
}
