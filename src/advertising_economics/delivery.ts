import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import { SharedRandomness } from "../simulation/kernel.js";
import type {
  AdvertisingDeliveryProfile,
  AudienceComposition,
  DeliveryOutcome,
  PaidMarketingChannel,
} from "./types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function profileSeed(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
): SharedRandomness {
  return new SharedRandomness(
    world.manifest.seed,
    `step5-delivery:${world.manifest.worldId}:${channel}`,
  );
}

export function deliveryProfileForChannel(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
): AdvertisingDeliveryProfile {
  const random = profileSeed(world, channel);

  const billingModel =
    channel === "meta" || channel === "pinterest"
      ? "cpm"
      : "cpc";

  const unitCostMinor =
    billingModel === "cpm"
      ? Math.round(
          random.uniform("cpm") *
            1_800 +
            (channel === "pinterest" ? 650 : 850),
        )
      : Math.round(
          random.uniform("cpc") *
            520 +
            (channel === "affiliate"
              ? 90
              : channel === "google_shopping"
                ? 110
                : 130),
        );

  const clickThroughRate =
    billingModel === "cpm"
      ? clamp(
          (channel === "pinterest" ? 0.009 : 0.012) *
            (0.65 + random.uniform("ctr") * 1.1),
          0.002,
          0.04,
        )
      : 1;

  let reachablePopulationShare =
    channel === "meta"
      ? 0.72
      : channel === "pinterest"
        ? 0.42
        : channel === "google_search"
          ? 0.46
          : channel === "google_shopping"
            ? 0.34
            : 0.28;

  reachablePopulationShare *=
    0.75 + random.uniform("reach") * 0.5;
  reachablePopulationShare = clamp(
    reachablePopulationShare,
    0.08,
    0.92,
  );

  const qualityDecayStrength = clamp(
    (world.summary.complexity === "adversarial"
      ? 0.48
      : world.summary.complexity === "complex"
        ? 0.36
        : 0.24) *
      (0.75 + random.uniform("quality") * 0.6),
    0.08,
    0.78,
  );

  const frequencyPressure = clamp(
    (channel === "meta" || channel === "pinterest"
      ? 1.25
      : 0.85) *
      (0.8 + random.uniform("frequency") * 0.5),
    0.55,
    1.8,
  );

  const viewabilityRate = clamp(
    0.55 + random.uniform("viewability") * 0.4,
    0.5,
    0.95,
  );

  return {
    channel,
    billingModel,
    unitCostMinor: Math.max(1, unitCostMinor),
    clickThroughRate,
    reachablePopulationShare,
    qualityDecayStrength,
    frequencyPressure,
    viewabilityRate,
    retargetingLike:
      channel === "meta" || channel === "google_shopping",
    upperFunnelLike:
      channel === "meta" || channel === "pinterest",
  };
}

export function deliveryAtSpend(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
  profile: AdvertisingDeliveryProfile,
  spendMinor: number,
): DeliveryOutcome {
  if (!Number.isFinite(spendMinor) || spendMinor < 0) {
    throw new RangeError("spend must be finite and non-negative");
  }

  const representedPopulation =
    population.representedCustomerCount;
  const eligiblePopulation = Math.max(
    1,
    representedPopulation *
      profile.reachablePopulationShare,
  );

  const billableUnits =
    spendMinor / profile.unitCostMinor;

  const impressions =
    profile.billingModel === "cpm"
      ? billableUnits * 1_000 * profile.viewabilityRate
      : billableUnits /
        Math.max(1e-6, profile.clickThroughRate);

  const clicks =
    profile.billingModel === "cpc"
      ? billableUnits
      : impressions * profile.clickThroughRate;

  const exposurePressure =
    impressions /
    Math.max(1, eligiblePopulation);

  const uniqueReach =
    eligiblePopulation *
    (1 -
      Math.exp(
        -exposurePressure /
          Math.max(0.1, profile.frequencyPressure),
      ));

  const reachFraction = clamp(
    uniqueReach / eligiblePopulation,
    0,
    1,
  );

  const averageFrequency =
    uniqueReach > 0 ? impressions / uniqueReach : 0;

  const qualityIndex = clamp(
    1 -
      profile.qualityDecayStrength *
        Math.pow(reachFraction, 1.35) -
      Math.max(0, averageFrequency - 2) * 0.018,
    0.15,
    1,
  );

  const saturationIndex = clamp(
    0.65 * reachFraction +
      0.35 *
        clamp(
          (averageFrequency - 1) / 6,
          0,
          1,
        ),
    0,
    1,
  );

  return {
    channel: profile.channel,
    spendMinor,
    eligiblePopulation,
    billableUnits,
    impressions,
    clicks,
    uniqueReach,
    reachFraction,
    averageFrequency,
    qualityIndex,
    saturationIndex,
  };
}

function channelTrait(
  population: LatentCustomerPopulation,
  customerId: string,
  channel: PaidMarketingChannel,
) {
  const customer = population.customers.find(
    (candidate) => candidate.customerId === customerId,
  );
  return customer?.channelTraits.find(
    (trait) => trait.channelId === channel,
  );
}

export function audienceCompositionAtSpend(
  population: LatentCustomerPopulation,
  channel: PaidMarketingChannel,
  delivery: DeliveryOutcome,
): AudienceComposition {
  if (delivery.uniqueReach <= 0) {
    return {
      channel,
      reachedPopulationWeight: 0,
      meanPurchaseIntent: 0,
      meanNaturalUseProbability: 0,
      meanCausalSusceptibility: 0,
      meanExpectedLifetimeValueMinor: 0,
    };
  }

  const scored = population.customers
    .map((customer) => {
      const trait = channelTrait(
        population,
        customer.customerId,
        channel,
      );
      if (!trait) return undefined;

      const score =
        trait.causalEffectMultiplier * 0.48 +
        trait.naturalUseProbability * 0.24 +
        customer.purchaseIntent * 0.18 +
        Math.log1p(
          Math.max(0, customer.expectedLifetimeValueMinor),
        ) *
          0.01;

      return { customer, trait, score };
    })
    .filter(
      (
        item,
      ): item is NonNullable<typeof item> =>
        item !== undefined,
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.customer.customerId.localeCompare(
          right.customer.customerId,
        ),
    );

  const targetWeight = Math.min(
    delivery.uniqueReach,
    population.representedCustomerCount,
  );

  let reached = 0;
  let intent = 0;
  let natural = 0;
  let susceptibility = 0;
  let clv = 0;

  for (const item of scored) {
    if (reached >= targetWeight) break;
    const remaining = targetWeight - reached;
    const weight = Math.min(
      item.customer.populationWeight,
      remaining,
    );
    reached += weight;
    intent += item.customer.purchaseIntent * weight;
    natural +=
      item.trait.naturalUseProbability * weight;
    susceptibility +=
      item.trait.causalEffectMultiplier * weight;
    clv +=
      item.customer.expectedLifetimeValueMinor * weight;
  }

  if (reached <= 0) {
    return {
      channel,
      reachedPopulationWeight: 0,
      meanPurchaseIntent: 0,
      meanNaturalUseProbability: 0,
      meanCausalSusceptibility: 0,
      meanExpectedLifetimeValueMinor: 0,
    };
  }

  return {
    channel,
    reachedPopulationWeight: reached,
    meanPurchaseIntent: intent / reached,
    meanNaturalUseProbability: natural / reached,
    meanCausalSusceptibility:
      susceptibility / reached,
    meanExpectedLifetimeValueMinor: clv / reached,
  };
}

function monthKey(timestamp: string): string {
  const date = new Date(timestamp);
  return [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ][date.getUTCMonth()]!;
}

export interface AdvertisingStateContext {
  readonly timestamp: string;
  readonly promotionActive: boolean;
  readonly inventoryAvailabilityRatio: number;
  readonly audienceQualityIndex: number;
}

export function stateResponseMultiplier(
  world: GeneratedMerchantWorld,
  context: AdvertisingStateContext,
): number {
  let multiplier = clamp(
    context.audienceQualityIndex,
    0.1,
    1.25,
  );

  for (const seasonality of world.manifest.seasonality) {
    if (seasonality.kind !== "month") continue;
    const entry = seasonality.multipliers.find(
      (candidate) =>
        candidate.key === monthKey(context.timestamp),
    );
    if (entry) multiplier *= Number(entry.multiplier);
  }

  if (context.promotionActive) {
    const promotion = world.manifest.promotionElasticities
      .flatMap((mechanism) => mechanism.effects)
      .find(
        (effect) =>
          effect.outcome === "channel_response" ||
          effect.outcome === "conversion_probability",
      );
    if (promotion) {
      if (
        promotion.effect.scale === "relative" ||
        promotion.effect.scale === "multiplicative"
      ) {
        multiplier *=
          1 + promotion.effect.value * 0.6;
      } else if (
        promotion.effect.scale ===
        "probability_point"
      ) {
        multiplier *=
          1 + promotion.effect.value * 3;
      }
    } else {
      multiplier *= 1.08;
    }
  }

  const inventoryRatio = clamp(
    context.inventoryAvailabilityRatio,
    0,
    1,
  );
  multiplier *= 0.25 + inventoryRatio * 0.75;

  return clamp(multiplier, 0.03, 4);
}
