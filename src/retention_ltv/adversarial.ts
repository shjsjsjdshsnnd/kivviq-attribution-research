import {
  generateCustomerPopulation,
} from "../customer_population/generator.js";
import type {
  LatentCustomerPopulation,
} from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import {
  generateMerchantWorldRecord,
} from "../generation/generator.js";
import {
  validateGroundTruthManifest,
} from "../ground_truth/manifest.js";
import {
  isPaidMarketingChannel,
  type PaidMarketingChannel,
} from "../advertising_economics/types.js";
import {
  RETENTION_LTV_VERSION,
  type RetentionLtvScenario,
} from "./runtime-types.js";
import type {
  RetentionLtvEvaluationRequest,
} from "./types.js";

function syntheticPopulation(
  world: GeneratedMerchantWorld,
  seed: number,
  maxExplicitAgents = 110,
): LatentCustomerPopulation {
  return generateCustomerPopulation({
    merchantWorld: world,
    populationSeed: seed,
    populationConfig: {
      maxExplicitAgents,
      complexity: world.summary.complexity,
    },
  });
}

function paidChannels(
  world: GeneratedMerchantWorld,
): readonly PaidMarketingChannel[] {
  return world.summary.activeChannels.filter(
    isPaidMarketingChannel,
  );
}

function setChannelEffect(
  world: GeneratedMerchantWorld,
  channel: MarketingChannel,
  effect: number,
): void {
  const mechanisms =
    world.manifest.channelIncrementality as unknown as Array<{
      channelId: string;
      effect: {
        scale: string;
        value: number;
        unit: string;
      };
    }>;
  const mechanism = mechanisms.find(
    (candidate) =>
      candidate.channelId === channel,
  );
  if (!mechanism) {
    throw new RangeError(
      "Step 11 fixture requires channel incrementality for " +
        channel,
    );
  }
  mechanism.effect.value = effect;
}

function baseScenario(
  channelA?: PaidMarketingChannel,
  channelB?: PaidMarketingChannel,
): RetentionLtvScenario {
  return {
    version: RETENTION_LTV_VERSION,
    source: "step11_explicit_synthetic",
    merchantRepeatHazardMultiplier: 1.25,
    loyalPurchaseThreshold: 4,
    lapseAfterExpectedIntervals: 2.4,
    dormantAfterExpectedIntervals: 4.8,
    latentChurnAfterExpectedIntervals: 8.5,
    permanentChurnAfterExpectedIntervals: null,
    reactivationHazardMultiplier: 0.55,
    experience: {
      successfulPurchaseAffinityDelta: 0.01,
      returnedPurchaseAffinityDelta: -0.01,
      stockoutMerchantExitAffinityDelta: -0.025,
    },
    promotionDependencePerPromotedPurchase: 0.04,
    acquisitionQualityEffectsByChannel:
      channelA === undefined ||
      channelB === undefined
        ? {}
        : {
            [channelA]: {
              repeatHazardMultiplier: 0.15,
              brandAffinityDelta: -0.15,
              promotionDependenceDelta: 0.9,
            },
            [channelB]: {
              repeatHazardMultiplier: 5.5,
              brandAffinityDelta: 0.25,
              promotionDependenceDelta: -0.15,
            },
          },
    lifecycleMarketing: [
      {
        campaignId: "step11-post-purchase-email",
        kind: "post_purchase",
        channel: "email",
        eligibleLifecycleStates: [
          "first_time_buyer",
          "active_customer",
          "repeat_customer",
          "loyal_customer",
          "lapsing",
        ],
        minimumDaysSincePurchase: 3,
        maximumDaysSincePurchase: 180,
        opportunityMultiplier: 1.2,
        causalResponseMultiplier: 1.05,
      },
      {
        campaignId: "step11-winback-email",
        kind: "winback",
        channel: "email",
        eligibleLifecycleStates: [
          "lapsing",
          "dormant",
          "churned",
        ],
        minimumDaysSincePurchase: 45,
        opportunityMultiplier: 1.4,
        causalResponseMultiplier: 1.12,
      },
    ],
  };
}

function spendInterventions(
  channels: readonly PaidMarketingChannel[],
  values: Readonly<
    Partial<Record<PaidMarketingChannel, number>>
  >,
) {
  return channels.map((channel) => ({
    variable: `marketing.${channel}.spend`,
    operation: "set" as const,
    value: {
      kind: "number" as const,
      value: values[channel] ?? 0,
      unit: "money_minor" as const,
    },
  }));
}

function request(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
  simulationSeed: number,
  scenario: RetentionLtvScenario,
  interventions: RetentionLtvEvaluationRequest["interventions"],
): RetentionLtvEvaluationRequest {
  return {
    merchantWorld: world,
    latentPopulation: population,
    simulationSeed,
    periodStart: "2026-01-01T00:00:00.000Z",
    asOf: "2026-03-15T00:00:00.000Z",
    simulationEnd: "2027-03-15T00:00:00.000Z",
    retentionScenario: scenario,
    clvHorizonsDays: [30, 60, 90, 180, 365],
    expectedLifetimeHorizonDays: 730,
    discounting: {
      annualDiscountRate: 0.08,
      method: "continuous",
      timeUnit: "year",
    },
    ...(interventions === undefined
      ? {}
      : { interventions }),
    simulationConfig: {
      maxEvents: 600_000,
      maxSessionsPerCustomer: 80,
      maxStepsPerSession: 18,
      opportunityCadenceHours: 12,
      lifecycleCheckDays: 21,
    },
    enableInventoryDynamics: true,
  };
}

export interface CheapCustomerTrapFixture {
  readonly id: "cheap_customer_high_ltv_reversal";
  readonly channelA: PaidMarketingChannel;
  readonly channelB: PaidMarketingChannel;
  readonly evaluation: RetentionLtvEvaluationRequest;
}

export function createCheapCustomerTrapFixture(): CheapCustomerTrapFixture {
  const world = generateMerchantWorldRecord({
    seed: 211001,
    archetype: "beauty_cosmetics",
    scale: "growth",
    complexity: "complex",
    purchaseFrequency: "replenishment",
    marketingDependence: "paid_media_heavy",
    promotionProfile: "promotion_sensitive",
    catalogProfile: "tiny_curated",
    inventoryProfile: "replenishment_friendly",
    customerEconomics: "retention_driven",
  });
  const channels = paidChannels(world);
  if (channels.length < 2) {
    throw new RangeError(
      "Step 11 cheap-customer fixture requires two paid channels",
    );
  }
  const channelA = channels[0]!;
  const channelB = channels[1]!;

  const mechanisms =
    world.manifest.channelIncrementality as unknown as Array<{
      channelId: string;
      effect: {
        value: number;
      };
    }>;
  const aBase =
    mechanisms.find(
      (mechanism) =>
        mechanism.channelId === channelA,
    )?.effect.value ?? 0;
  const bBase =
    mechanisms.find(
      (mechanism) =>
        mechanism.channelId === channelB,
    )?.effect.value ?? 0;

  // A is deliberately efficient at creating the first transaction. B has a
  // weaker first-order response but can causally improve post-acquisition
  // customer quality through the explicit Step 11 treatment contract.
  setChannelEffect(
    world,
    channelA,
    Math.max(
      Math.abs(aBase) * 2.6,
      Math.abs(bBase) * 2.1,
      world.summary.expectedAnnualOrders / 140,
    ),
  );
  setChannelEffect(
    world,
    channelB,
    Math.max(
      Math.abs(bBase) * 0.45,
      world.summary.expectedAnnualOrders / 420,
    ),
  );
  validateGroundTruthManifest(world.manifest);

  const population = syntheticPopulation(
    world,
    211101,
    110,
  );
  const scenario = baseScenario(
    channelA,
    channelB,
  );
  const interventions = spendInterventions(
    channels,
    {
      [channelA]: 40_000,
      [channelB]: 200_000,
    },
  );

  return {
    id: "cheap_customer_high_ltv_reversal",
    channelA,
    channelB,
    evaluation: request(
      world,
      population,
      211201,
      scenario,
      interventions,
    ),
  };
}

export interface ObservedLtvSelectionTrapFixture {
  readonly id: "observed_ltv_selection";
  readonly selectedChannel: PaidMarketingChannel;
  readonly comparisonChannel: PaidMarketingChannel;
  readonly evaluation: RetentionLtvEvaluationRequest;
}

export function createObservedLtvSelectionTrapFixture(): ObservedLtvSelectionTrapFixture {
  const world = generateMerchantWorldRecord({
    seed: 211002,
    archetype: "beauty_cosmetics",
    scale: "growth",
    complexity: "adversarial",
    purchaseFrequency: "repeat",
    marketingDependence: "balanced",
    promotionProfile: "light_promotion",
    catalogProfile: "tiny_curated",
    inventoryProfile: "replenishment_friendly",
    customerEconomics: "high_ltv",
  });
  const channels = paidChannels(world);
  const naturalPaid = channels.filter(
    (channel) =>
      channel === "google_search" ||
      channel === "google_shopping" ||
      channel === "pinterest" ||
      channel === "affiliate",
  );
  if (naturalPaid.length < 2) {
    throw new RangeError(
      "Step 11 selection fixture requires two naturally selectable paid channels",
    );
  }
  const selectedChannel = naturalPaid[0]!;
  const comparisonChannel = naturalPaid[1]!;

  // The selected channel has exactly zero merchant-level causal effect. Any
  // observed LTV difference must therefore arise from selection/composition.
  setChannelEffect(
    world,
    selectedChannel,
    0,
  );
  validateGroundTruthManifest(world.manifest);

  const generated = syntheticPopulation(
    world,
    211102,
    140,
  );
  const mutable = structuredClone(
    generated,
  ) as LatentCustomerPopulation & {
    customers: Array<
      LatentCustomerPopulation["customers"][number] & {
        channelTraits: Array<{
          channelId: MarketingChannel;
          merchantMechanismId: string;
          causalEffectMultiplier: number;
          naturalUseProbability: number;
        }>;
      }
    >;
  };

  // Preserve each customer’s latent value/retention traits. Only selection
  // into the zero-effect channel changes. Rank on pre-existing latent value;
  // the selected channel attracts the high-value tail while the comparison
  // channel attracts the lower-value tail.
  const latentScores = mutable.customers
    .filter(
      (customer) =>
        customer.lifecycle
          .preSimulationHistory === "none",
    )
    .map((customer) => ({
      customerId: customer.customerId,
      score:
        customer.repeatPropensity * 0.3 +
        customer.brandAffinity * 0.1 +
        Math.min(
          1,
          customer.expectedFuturePurchases /
            5,
        ) *
          0.14 +
        Math.min(
          1,
          customer.expectedOrderValueMinor /
            Math.max(
              1,
              world.summary.expectedAovMinor * 1.6,
            ),
        ) *
          0.08 +
        customer.purchaseIntent * 0.18 +
        customer.currentPurchaseNeed * 0.15 +
        Math.min(
          1,
          customer.annualPurchaseHazard /
            4,
        ) *
          0.05,
    }))
    .sort(
      (left, right) =>
        right.score - left.score,
    );
  const highValueIds = new Set(
    latentScores
      .slice(
        0,
        Math.max(
          1,
          Math.floor(
            latentScores.length * 0.4,
          ),
        ),
      )
      .map((item) => item.customerId),
  );

  for (const customer of mutable.customers) {
    const highValue =
      highValueIds.has(customer.customerId);
    for (const trait of customer.channelTraits) {
      if (trait.channelId === selectedChannel) {
        trait.naturalUseProbability =
          highValue ? 0.98 : 0.005;
      } else if (
        trait.channelId === comparisonChannel
      ) {
        trait.naturalUseProbability =
          highValue ? 0.005 : 0.96;
      } else {
        trait.naturalUseProbability = 0.005;
      }
    }

    // Keep the trap about channel selection, not treatment. Competing natural
    // routes are intentionally rare so the selected/comparison source remains
    // observable at the first purchase.
    const naturalSelection =
      customer.naturalSelection as unknown as {
        brandedDirectProbability: number;
        organicDiscoveryProbability: number;
      };
    naturalSelection.brandedDirectProbability = 0.005;
    naturalSelection.organicDiscoveryProbability = 0.005;
  }

  const scenario: RetentionLtvScenario = {
    ...baseScenario(),
    merchantRepeatHazardMultiplier: 1.08,
    acquisitionQualityEffectsByChannel: {},
    promotionDependencePerPromotedPurchase: 0,
  };
  const interventions = spendInterventions(
    channels,
    {
      [selectedChannel]: 0,
      [comparisonChannel]: 0,
    },
  );

  return {
    id: "observed_ltv_selection",
    selectedChannel,
    comparisonChannel,
    evaluation: {
      ...request(
        world,
        mutable,
        211202,
        scenario,
        interventions,
      ),
      asOf:
        "2026-06-15T00:00:00.000Z",
      simulationEnd:
        "2027-06-15T00:00:00.000Z",
    },
  };
}
