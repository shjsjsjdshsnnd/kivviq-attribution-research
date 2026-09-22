import type {
  LatentCustomer,
} from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import {
  RETENTION_LTV_VERSION,
  type RetentionLtvScenario,
} from "./runtime-types.js";

const clamp = (
  value: number,
  min: number,
  max: number,
): number => Math.min(max, Math.max(min, value));

export interface RetentionCustomerContext {
  readonly source: LatentCustomer;
  readonly purchaseCount: number;
  readonly lifecycle: string;
  readonly brandAffinity: number;
  readonly need: number;
  readonly lastPurchaseMs?: number;
  readonly repeatHazardQualityMultiplier: number;
  readonly promotionDependenceShift: number;
  readonly trueChurnState:
    | "active"
    | "latent_churned"
    | "permanent_churned";
  readonly ownedProductQuantities: ReadonlyMap<string, number>;
  readonly categoryFamiliarity: ReadonlyMap<string, number>;
}

export interface RetentionPurchaseLine {
  readonly productId: string;
  readonly quantity: number;
  readonly promotionIds?: readonly string[];
}

export interface RetentionPurchaseTransition {
  readonly brandAffinityDelta: number;
  readonly repeatHazardQualityMultiplier: number;
  readonly promotionDependenceDelta: number;
  readonly loyalPurchaseThreshold: number;
  readonly productQuantities: Readonly<Record<string, number>>;
  readonly productCategories: Readonly<Record<string, string>>;
  readonly causalAcquisitionChannels: readonly MarketingChannel[];
}

export interface RetentionLifecycleThresholds {
  readonly lapseAfterIntervals: number;
  readonly dormantAfterIntervals: number;
  readonly latentChurnAfterIntervals: number;
  readonly permanentChurnAfterIntervals: number | null;
}

export function defaultRetentionLtvScenario(
  world: GeneratedMerchantWorld,
): RetentionLtvScenario {
  const retentionDriven =
    world.summary.customerEconomics === "retention_driven" ||
    world.summary.customerEconomics === "high_ltv" ||
    world.summary.businessModel === "replenishment" ||
    world.summary.businessModel === "subscription";

  return {
    version: RETENTION_LTV_VERSION,
    source: "step11_synthetic_default",
    merchantRepeatHazardMultiplier:
      retentionDriven ? 1.08 : 1,
    loyalPurchaseThreshold:
      world.summary.businessModel === "subscription" ? 3 : 4,
    lapseAfterExpectedIntervals:
      world.summary.businessModel === "subscription"
        ? 1.8
        : world.summary.businessModel === "one_off" ||
            world.summary.archetype === "furniture" ||
            world.summary.archetype ===
              "home_furnishings_decor"
          ? 3.8
          : 2.4,
    dormantAfterExpectedIntervals:
      world.summary.businessModel === "subscription"
        ? 3.2
        : world.summary.businessModel === "one_off" ||
            world.summary.archetype === "furniture" ||
            world.summary.archetype ===
              "home_furnishings_decor"
          ? 7.5
          : 4.8,
    latentChurnAfterExpectedIntervals:
      world.summary.businessModel === "subscription"
        ? 5.5
        : world.summary.businessModel === "one_off" ||
            world.summary.archetype === "furniture" ||
            world.summary.archetype ===
              "home_furnishings_decor"
          ? 13
          : 8.5,
    permanentChurnAfterExpectedIntervals:
      world.summary.businessModel === "subscription" ? 8 : null,
    reactivationHazardMultiplier: 0.5,
    experience: {
      successfulPurchaseAffinityDelta:
        retentionDriven ? 0.012 : 0,
      returnedPurchaseAffinityDelta: 0,
      stockoutMerchantExitAffinityDelta: 0,
    },
    promotionDependencePerPromotedPurchase: 0,
  };
}

export function validateRetentionLtvScenario(
  scenario: RetentionLtvScenario,
): void {
  if (scenario.version !== RETENTION_LTV_VERSION) {
    throw new RangeError(
      "unsupported Step 11 retention scenario version",
    );
  }
  const positive = [
    ["merchantRepeatHazardMultiplier", scenario.merchantRepeatHazardMultiplier],
    ["lapseAfterExpectedIntervals", scenario.lapseAfterExpectedIntervals],
    ["dormantAfterExpectedIntervals", scenario.dormantAfterExpectedIntervals],
    ["latentChurnAfterExpectedIntervals", scenario.latentChurnAfterExpectedIntervals],
    ["reactivationHazardMultiplier", scenario.reactivationHazardMultiplier],
  ] as const;
  for (const [label, value] of positive) {
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value <= 0)
    ) {
      throw new RangeError(
        label + " must be finite and positive",
      );
    }
  }
  if (
    scenario.loyalPurchaseThreshold !== undefined &&
    (!Number.isInteger(scenario.loyalPurchaseThreshold) ||
      scenario.loyalPurchaseThreshold < 2)
  ) {
    throw new RangeError(
      "loyalPurchaseThreshold must be an integer >= 2",
    );
  }
  if (
    scenario.permanentChurnAfterExpectedIntervals !==
      undefined &&
    scenario.permanentChurnAfterExpectedIntervals !== null &&
    (!Number.isFinite(
      scenario.permanentChurnAfterExpectedIntervals,
    ) ||
      scenario.permanentChurnAfterExpectedIntervals <= 0)
  ) {
    throw new RangeError(
      "permanentChurnAfterExpectedIntervals must be null or positive",
    );
  }
  for (const effect of Object.values(
    scenario.acquisitionQualityEffectsByChannel ?? {},
  )) {
    if (
      effect !== undefined &&
      (!Number.isFinite(effect.repeatHazardMultiplier) ||
        effect.repeatHazardMultiplier <= 0)
    ) {
      throw new RangeError(
        "acquisition repeatHazardMultiplier must be positive",
      );
    }
  }
  for (const campaign of scenario.lifecycleMarketing ?? []) {
    if (
      !Number.isFinite(campaign.opportunityMultiplier) ||
      campaign.opportunityMultiplier < 0 ||
      (campaign.causalResponseMultiplier !== undefined &&
        (!Number.isFinite(campaign.causalResponseMultiplier) ||
          campaign.causalResponseMultiplier < 0))
    ) {
      throw new RangeError(
        "lifecycle marketing multipliers must be finite and non-negative",
      );
    }
  }
  if (scenario.subscription) {
    for (const value of [
      scenario.subscription.cancellationProbabilityPerRenewal,
      scenario.subscription.skipProbabilityPerRenewal ?? 0,
      scenario.subscription.failedRenewalProbability ?? 0,
    ]) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(
          "subscription probabilities must be in [0,1]",
        );
      }
    }
  }
}

function lifecycleMultiplier(
  lifecycle: string,
): number {
  switch (lifecycle) {
    case "loyal_customer":
      return 1.28;
    case "repeat_customer":
      return 1.14;
    case "first_time_buyer":
    case "active_customer":
    case "subscriber":
      return 1;
    case "lapsing":
      return 0.72;
    case "dormant":
      return 0.42;
    case "churned":
      return 0.18;
    default:
      return 1;
  }
}

function merchantFrequencyMultiplier(
  world: GeneratedMerchantWorld,
): number {
  switch (world.summary.businessModel) {
    case "subscription":
      return 1.6;
    case "replenishment":
      return 1.3;
    case "repeat":
      return 1.12;
    case "occasional":
      return 1;
    case "infrequent":
      return 0.78;
    case "one_off":
      return 0.5;
  }
}

export function repeatPurchaseHazardMultiplier(
  world: GeneratedMerchantWorld,
  scenario: RetentionLtvScenario,
  customer: RetentionCustomerContext,
): number {
  const latentRepeat =
    0.45 + customer.source.repeatPropensity * 1.1;
  const affinity =
    0.68 + clamp(customer.brandAffinity, 0, 1) * 0.7;
  const latentChurn =
    customer.trueChurnState === "latent_churned"
      ? scenario.reactivationHazardMultiplier ?? 0.5
      : customer.trueChurnState === "permanent_churned"
        ? 0
        : 1;

  return clamp(
    (scenario.merchantRepeatHazardMultiplier ?? 1) *
      merchantFrequencyMultiplier(world) *
      latentRepeat *
      affinity *
      customer.repeatHazardQualityMultiplier *
      lifecycleMultiplier(customer.lifecycle) *
      latentChurn,
    0,
    8,
  );
}

export function lifecycleThresholds(
  world: GeneratedMerchantWorld,
  scenario: RetentionLtvScenario,
): RetentionLifecycleThresholds {
  const defaults = defaultRetentionLtvScenario(world);
  const lapse =
    scenario.lapseAfterExpectedIntervals ??
    defaults.lapseAfterExpectedIntervals!;
  const dormant = Math.max(
    lapse,
    scenario.dormantAfterExpectedIntervals ??
      defaults.dormantAfterExpectedIntervals!,
  );
  const latent = Math.max(
    dormant,
    scenario.latentChurnAfterExpectedIntervals ??
      defaults.latentChurnAfterExpectedIntervals!,
  );
  const permanent =
    scenario.permanentChurnAfterExpectedIntervals ??
    defaults.permanentChurnAfterExpectedIntervals ??
    null;
  return {
    lapseAfterIntervals: lapse,
    dormantAfterIntervals: dormant,
    latentChurnAfterIntervals: latent,
    permanentChurnAfterIntervals:
      permanent === null
        ? null
        : Math.max(latent, permanent),
  };
}

function categoryForProduct(
  world: GeneratedMerchantWorld,
  productId: string,
): string | undefined {
  return world.manifest.productDemandMechanisms.find(
    (mechanism) => mechanism.productId === productId,
  )?.categoryId;
}

export function productRetentionChoiceMultiplier(
  world: GeneratedMerchantWorld,
  customer: RetentionCustomerContext,
  productId: string,
): number {
  const categoryId = categoryForProduct(
    world,
    productId,
  );
  const familiarity =
    categoryId === undefined
      ? 0
      : customer.categoryFamiliarity.get(categoryId) ?? 0;
  const owned =
    customer.ownedProductQuantities.get(productId) ?? 0;
  let multiplier =
    1 + Math.min(0.28, familiarity * 0.08);

  if (owned > 0) {
    if (
      world.summary.businessModel === "replenishment" ||
      world.summary.businessModel === "subscription"
    ) {
      multiplier *= 1.18;
    } else if (
      world.summary.businessModel === "one_off" ||
      world.summary.archetype === "furniture" ||
      world.summary.archetype === "consumer_electronics"
    ) {
      multiplier *= 0.38;
    }
  }

  const isComplementOfOwned =
    [...customer.ownedProductQuantities.keys()].some(
      (ownedProductId) =>
        world.manifest.productDemandMechanisms
          .find(
            (mechanism) =>
              mechanism.productId === ownedProductId,
          )
          ?.complementaryProductIds?.includes(productId) ===
        true,
    );
  if (isComplementOfOwned) {
    multiplier *= 1.7;
  }

  return clamp(multiplier, 0.15, 3);
}

export function retentionNeedDeferralMultiplier(
  world: GeneratedMerchantWorld,
  lines: readonly RetentionPurchaseLine[],
): number {
  if (
    world.summary.businessModel !== "replenishment" &&
    world.summary.businessModel !== "subscription"
  ) {
    return 1;
  }
  const units = lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity),
    0,
  );
  return clamp(
    1 + Math.max(0, units - 1) * 0.55,
    1,
    4,
  );
}

export function postPurchaseTransition(
  world: GeneratedMerchantWorld,
  scenario: RetentionLtvScenario,
  customer: RetentionCustomerContext,
  lines: readonly RetentionPurchaseLine[],
  causalAcquisitionChannels: readonly MarketingChannel[],
): RetentionPurchaseTransition {
  let qualityMultiplier =
    customer.repeatHazardQualityMultiplier;
  let affinityDelta =
    scenario.experience
      ?.successfulPurchaseAffinityDelta ?? 0;
  let promotionDependenceDelta = 0;

  const promoted = lines.some(
    (line) => (line.promotionIds?.length ?? 0) > 0,
  );
  if (promoted) {
    promotionDependenceDelta =
      scenario.promotionDependencePerPromotedPurchase ??
      0;
  }

  if (customer.purchaseCount === 0) {
    for (const channel of causalAcquisitionChannels) {
      const effect =
        scenario.acquisitionQualityEffectsByChannel?.[
          channel
        ];
      if (!effect) continue;
      qualityMultiplier *=
        effect.repeatHazardMultiplier;
      affinityDelta +=
        effect.brandAffinityDelta ?? 0;
      promotionDependenceDelta +=
        effect.promotionDependenceDelta ?? 0;
    }
  }

  const productQuantities: Record<string, number> = {};
  const productCategories: Record<string, string> = {};
  for (const line of lines) {
    productQuantities[line.productId] =
      (productQuantities[line.productId] ?? 0) +
      Math.max(0, line.quantity);
    const categoryId = categoryForProduct(
      world,
      line.productId,
    );
    if (categoryId !== undefined) {
      productCategories[line.productId] =
        categoryId;
    }
  }

  return {
    brandAffinityDelta: affinityDelta,
    repeatHazardQualityMultiplier:
      clamp(qualityMultiplier, 0.05, 8),
    promotionDependenceDelta:
      clamp(promotionDependenceDelta, -2, 3),
    loyalPurchaseThreshold:
      scenario.loyalPurchaseThreshold ??
      defaultRetentionLtvScenario(world)
        .loyalPurchaseThreshold!,
    productQuantities,
    productCategories,
    causalAcquisitionChannels,
  };
}

function campaignEligible(
  campaign: NonNullable<
    RetentionLtvScenario["lifecycleMarketing"]
  >[number],
  customer: RetentionCustomerContext,
  timestampMs: number,
): boolean {
  if (
    campaign.eligibleLifecycleStates !== undefined &&
    !campaign.eligibleLifecycleStates.includes(
      customer.lifecycle,
    )
  ) {
    return false;
  }
  if (customer.lastPurchaseMs === undefined) {
    return campaign.kind === "welcome";
  }
  const daysSince =
    (timestampMs - customer.lastPurchaseMs) /
    86_400_000;
  if (
    campaign.minimumDaysSincePurchase !== undefined &&
    daysSince < campaign.minimumDaysSincePurchase
  ) {
    return false;
  }
  if (
    campaign.maximumDaysSincePurchase !== undefined &&
    daysSince > campaign.maximumDaysSincePurchase
  ) {
    return false;
  }
  return true;
}

export function lifecycleMarketingMultipliers(
  scenario: RetentionLtvScenario,
  customer: RetentionCustomerContext,
  timestampMs: number,
  channel: MarketingChannel,
): {
  readonly opportunity: number;
  readonly causalResponse: number;
} {
  let opportunity = 1;
  let causalResponse = 1;
  for (const campaign of scenario.lifecycleMarketing ?? []) {
    if (
      campaign.channel !== channel ||
      !campaignEligible(
        campaign,
        customer,
        timestampMs,
      )
    ) {
      continue;
    }
    opportunity *= campaign.opportunityMultiplier;
    causalResponse *=
      campaign.causalResponseMultiplier ?? 1;
  }
  return {
    opportunity: clamp(opportunity, 0, 6),
    causalResponse: clamp(causalResponse, 0, 6),
  };
}

export function returnExperienceAffinityDelta(
  scenario: RetentionLtvScenario,
): number {
  return clamp(
    scenario.experience
      ?.returnedPurchaseAffinityDelta ?? 0,
    -1,
    1,
  );
}

export function stockoutMerchantExitAffinityDelta(
  scenario: RetentionLtvScenario,
): number {
  return clamp(
    scenario.experience
      ?.stockoutMerchantExitAffinityDelta ?? 0,
    -1,
    1,
  );
}
