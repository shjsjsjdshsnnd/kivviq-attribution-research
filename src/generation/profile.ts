import { ARCHETYPE_TENDENCIES, type NumericRange } from "./archetypes.js";
import {
  AOV_PROFILES,
  CATALOG_PROFILES,
  CUSTOMER_ECONOMICS_PROFILES,
  INVENTORY_PROFILES,
  MARKETING_CHANNELS,
  MARKETING_DEPENDENCE_PROFILES,
  PROMOTION_PROFILES,
  PURCHASE_FREQUENCY_PROFILES,
  SEASONALITY_PROFILES,
  type AovProfile,
  type CatalogProfile,
  type ComplexityLevel,
  type CustomerEconomicsProfile,
  type InventoryProfile,
  type MarketingChannel,
  type MarketingDependenceProfile,
  type MerchantGenerationConfig,
  type PromotionProfile,
  type PurchaseFrequencyProfile,
  type SeasonalityProfile,
} from "./config.js";
import { SeededRandom } from "./rng.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const sampleRange = (rng: SeededRandom, range: NumericRange): number =>
  rng.uniform(range.min, range.max);

const profileWeights = <T extends string>(
  values: readonly T[],
  bias: Readonly<Partial<Record<T, number>>>,
): readonly { readonly value: T; readonly weight: number }[] =>
  values.map((value) => ({ value, weight: bias[value] ?? 1 }));

const SCALE_ANNUAL_ORDER_RANGES: Readonly<
  Record<MerchantGenerationConfig["scale"], readonly [number, number]>
> = {
  micro: [350, 2_500],
  small: [1_800, 10_000],
  growth: [7_500, 42_000],
  mid_market: [30_000, 160_000],
  large: [120_000, 650_000],
};

const SCALE_CATALOG_MULTIPLIER: Readonly<
  Record<MerchantGenerationConfig["scale"], number>
> = {
  micro: 0.65,
  small: 0.85,
  growth: 1,
  mid_market: 1.15,
  large: 1.35,
};

const AOV_MULTIPLIER: Readonly<Record<AovProfile, number>> = {
  very_low: 0.45,
  low: 0.7,
  medium: 1,
  high: 1.65,
  extreme: 2.8,
};

const CATALOG_MULTIPLIER: Readonly<Record<CatalogProfile, number>> = {
  tiny_curated: 0.42,
  moderate: 0.75,
  large: 1,
  very_large: 1.28,
  long_tail: 1.45,
};

const FREQUENCY_ORDER_MULTIPLIER: Readonly<
  Record<PurchaseFrequencyProfile, number>
> = {
  one_off: 0.82,
  infrequent: 0.9,
  occasional: 1,
  repeat: 1.12,
  replenishment: 1.22,
  subscription: 1.18,
};

const FREQUENCY_REPEAT_TARGET: Readonly<
  Record<PurchaseFrequencyProfile, readonly [number, number]>
> = {
  one_off: [0.03, 0.16],
  infrequent: [0.08, 0.28],
  occasional: [0.16, 0.45],
  repeat: [0.32, 0.68],
  replenishment: [0.5, 0.86],
  subscription: [0.68, 0.95],
};

const FREQUENCY_INTERVAL_MULTIPLIER: Readonly<
  Record<PurchaseFrequencyProfile, number>
> = {
  one_off: 1.8,
  infrequent: 1.35,
  occasional: 1,
  repeat: 0.7,
  replenishment: 0.38,
  subscription: 0.28,
};

const PROMOTION_DISCOUNT_RATE: Readonly<
  Record<PromotionProfile, readonly [number, number]>
> = {
  full_price_dominant: [0.005, 0.035],
  light_promotion: [0.025, 0.08],
  promotion_sensitive: [0.06, 0.14],
  promotion_heavy: [0.11, 0.22],
  clearance_heavy: [0.15, 0.3],
};

const PROMOTION_ELASTICITY_MULTIPLIER: Readonly<
  Record<PromotionProfile, number>
> = {
  full_price_dominant: 0.55,
  light_promotion: 0.8,
  promotion_sensitive: 1.2,
  promotion_heavy: 1.45,
  clearance_heavy: 1.65,
};

const PAID_DEPENDENCE_RANGE: Readonly<
  Record<MarketingDependenceProfile, readonly [number, number]>
> = {
  organic_heavy: [0.15, 0.42],
  paid_media_heavy: [0.63, 0.9],
  retention_heavy: [0.3, 0.6],
  balanced: [0.4, 0.68],
};

const SEASONALITY_STRENGTH: Readonly<
  Record<SeasonalityProfile, readonly [number, number]>
> = {
  low: [0.02, 0.1],
  moderate: [0.1, 0.24],
  strong: [0.22, 0.45],
  holiday_heavy: [0.25, 0.55],
  summer_heavy: [0.22, 0.48],
  q4_heavy: [0.28, 0.62],
  event_driven: [0.22, 0.58],
};

const INVENTORY_DEPTH_MULTIPLIER: Readonly<Record<InventoryProfile, number>> = {
  shallow: 0.55,
  deep: 1.65,
  long_lead_time: 0.82,
  short_lead_time: 1.15,
  stockout_prone: 0.62,
  replenishment_friendly: 1.35,
};

const INVENTORY_LEAD_MULTIPLIER: Readonly<Record<InventoryProfile, number>> = {
  shallow: 1,
  deep: 0.95,
  long_lead_time: 1.65,
  short_lead_time: 0.52,
  stockout_prone: 1.2,
  replenishment_friendly: 0.62,
};

const CUSTOMER_REPEAT_MULTIPLIER: Readonly<
  Record<CustomerEconomicsProfile, number>
> = {
  acquisition_driven: 0.85,
  retention_driven: 1.18,
  high_ltv: 1.12,
  low_repeat: 0.58,
  subscription: 1.3,
  churn_sensitive: 0.82,
};

const COMPLEXITY_CHANNEL_TARGET: Readonly<
  Record<ComplexityLevel, readonly [number, number]>
> = {
  simple: [2, 3],
  normal: [3, 5],
  complex: [4, 6],
  adversarial: [4, 7],
};

export interface LatentBusinessProfile {
  readonly merchantId: string;
  readonly complexity: ComplexityLevel;
  readonly aovProfile: AovProfile;
  readonly purchaseFrequency: PurchaseFrequencyProfile;
  readonly marketingDependence: MarketingDependenceProfile;
  readonly promotionProfile: PromotionProfile;
  readonly catalogProfile: CatalogProfile;
  readonly inventoryProfile: InventoryProfile;
  readonly customerEconomics: CustomerEconomicsProfile;
  readonly seasonalityProfile: SeasonalityProfile;

  readonly expectedAovMinor: number;
  readonly expectedAnnualOrders: number;
  readonly annualRevenuePotentialMinor: number;
  readonly expectedUnitsPerOrder: number;
  readonly grossMarginRate: number;
  readonly expectedDiscountRate: number;
  readonly expectedReturnRate: number;
  readonly paymentFeeRate: number;
  readonly shippingSubsidyRate: number;
  readonly fulfillmentRate: number;
  readonly marketingSpendRate: number;
  readonly expectedContributionMarginRate: number;

  readonly repeatProbability: number;
  readonly expectedPurchaseIntervalDays: number;
  readonly baselineConversionRate: number;
  readonly considerationDays: number;
  readonly customerPopulation: number;

  readonly brandStrength: number;
  readonly organicStrength: number;
  readonly paidDependence: number;
  readonly organicDemandShare: number;
  readonly mobileTrafficShare: number;

  readonly skuCount: number;
  readonly categoryCount: number;
  readonly productConcentrationExponent: number;
  readonly productConcentrationTop5: number;

  readonly inventoryDepthOrders: number;
  readonly inventoryLeadDays: number;
  readonly stockoutRisk: number;
  readonly backorderProbability: number;

  readonly priceElasticity: number;
  readonly promotionElasticityMultiplier: number;
  readonly seasonalityStrength: number;

  readonly activeChannels: readonly MarketingChannel[];
  readonly outlierTag?: string;
}

function chooseProfile<T extends string>(
  rng: SeededRandom,
  requested: T | "auto" | undefined,
  values: readonly T[],
  bias: Readonly<Partial<Record<T, number>>>,
): T {
  if (requested && requested !== "auto") return requested;
  return rng.weightedPick(profileWeights(values, bias));
}

function syntheticMerchantId(
  config: MerchantGenerationConfig,
  rng: SeededRandom,
): string {
  const seedPart = Math.abs(config.seed).toString(36).padStart(5, "0").slice(-5);
  const suffix = rng.integer(0, 36 ** 4 - 1).toString(36).padStart(4, "0");
  return `merchant_${seedPart}_${suffix}`;
}

function chooseChannels(
  rng: SeededRandom,
  config: MerchantGenerationConfig,
  marketingDependence: MarketingDependenceProfile,
): readonly MarketingChannel[] {
  const tendencies = ARCHETYPE_TENDENCIES[config.archetype];
  const [minChannels, maxChannels] = COMPLEXITY_CHANNEL_TARGET[config.complexity];
  const target = rng.integer(minChannels, maxChannels);
  const scores = MARKETING_CHANNELS.map((channel) => {
    let score = tendencies.channelSuitability[channel];
    if (marketingDependence === "retention_heavy") {
      if (channel === "email" || channel === "sms") score *= 1.45;
    }
    if (marketingDependence === "paid_media_heavy") {
      if (
        channel === "meta" ||
        channel === "google_search" ||
        channel === "google_shopping" ||
        channel === "pinterest"
      ) {
        score *= 1.25;
      }
    }
    if (marketingDependence === "organic_heavy") {
      if (channel === "email" || channel === "affiliate") score *= 1.1;
    }
    score *= rng.uniform(0.72, 1.28);
    return { channel, score };
  });

  scores.sort((left, right) => right.score - left.score);
  const chosen = scores.slice(0, target).map((entry) => entry.channel);

  if (!chosen.includes("email") && rng.bool(tendencies.lifecycleAffinity * 0.45)) {
    chosen[chosen.length - 1] = "email";
  }

  for (const forced of config.overrides?.forceZeroIncrementalityChannels ?? []) {
    if (!chosen.includes(forced)) {
      if (chosen.length < maxChannels) {
        chosen.push(forced);
      } else {
        chosen[chosen.length - 1] = forced;
      }
    }
  }

  return [...new Set(chosen)];
}

function concentrationTop5(skuCount: number, exponent: number): number {
  const weights = Array.from({ length: skuCount }, (_, index) =>
    1 / Math.pow(index + 1, exponent),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.slice(0, Math.min(5, skuCount)).reduce((sum, value) => sum + value, 0) / total;
}

export function generateLatentBusinessProfile(
  config: MerchantGenerationConfig,
  rng: SeededRandom,
): LatentBusinessProfile {
  if (!Number.isSafeInteger(config.seed) || config.seed < 0) {
    throw new RangeError("generation seed must be a non-negative safe integer");
  }

  const tendencies = ARCHETYPE_TENDENCIES[config.archetype];
  const aovProfile =
    config.overrides?.aovProfile ??
    chooseProfile(rng, config.aovProfile, AOV_PROFILES, tendencies.aovBias);
  const purchaseFrequency = chooseProfile(
    rng,
    config.purchaseFrequency,
    PURCHASE_FREQUENCY_PROFILES,
    tendencies.frequencyBias,
  );
  const marketingDependence =
    config.overrides?.marketingDependence ??
    chooseProfile(
      rng,
      config.marketingDependence,
      MARKETING_DEPENDENCE_PROFILES,
      tendencies.marketingBias,
    );
  const promotionProfile =
    config.overrides?.promotionProfile ??
    chooseProfile(
      rng,
      config.promotionProfile,
      PROMOTION_PROFILES,
      tendencies.promotionBias,
    );
  const catalogProfile =
    config.overrides?.catalogProfile ??
    chooseProfile(
      rng,
      config.catalogProfile,
      CATALOG_PROFILES,
      tendencies.catalogBias,
    );
  const inventoryProfile = chooseProfile(
    rng,
    config.inventoryProfile,
    INVENTORY_PROFILES,
    tendencies.inventoryBias,
  );
  const customerEconomics = chooseProfile(
    rng,
    config.customerEconomics,
    CUSTOMER_ECONOMICS_PROFILES,
    tendencies.customerEconomicsBias,
  );
  const seasonalityProfile =
    config.overrides?.seasonalityProfile ??
    chooseProfile(
      rng,
      config.seasonalityProfile,
      SEASONALITY_PROFILES,
      tendencies.seasonalityBias,
    );

  const archetypeAov = Math.sqrt(
    tendencies.aovMinor.min * tendencies.aovMinor.max,
  );
  let expectedAovMinor = Math.round(
    rng.jitter(archetypeAov * AOV_MULTIPLIER[aovProfile], 0.28),
  );
  expectedAovMinor = Math.max(500, expectedAovMinor);

  const [orderMin, orderMax] = SCALE_ANNUAL_ORDER_RANGES[config.scale];
  const expectedAnnualOrders = Math.max(
    50,
    Math.round(
      rng.logNormal(
        Math.log(Math.sqrt(orderMin * orderMax)),
        0.38,
      ) * FREQUENCY_ORDER_MULTIPLIER[purchaseFrequency],
    ),
  );
  const annualRevenuePotentialMinor =
    expectedAnnualOrders * expectedAovMinor;

  const [repeatMin, repeatMax] = FREQUENCY_REPEAT_TARGET[purchaseFrequency];
  const archetypeRepeat = sampleRange(rng, tendencies.repeatProbability);
  let repeatProbability = clamp(
    (archetypeRepeat + rng.uniform(repeatMin, repeatMax)) / 2 *
      CUSTOMER_REPEAT_MULTIPLIER[customerEconomics],
    0.01,
    0.96,
  );

  let outlierTag: string | undefined;
  if (rng.bool(0.08)) {
    const outlier = rng.pick([
      "high_repeat",
      "low_retention",
      "strong_organic",
      "weak_paid_efficiency",
      "unusually_mobile",
    ] as const);
    outlierTag = outlier;
    if (outlier === "high_repeat") repeatProbability = clamp(repeatProbability * 1.45, 0.01, 0.96);
    if (outlier === "low_retention") repeatProbability = clamp(repeatProbability * 0.55, 0.01, 0.96);
  }

  const expectedPurchaseIntervalDays = clamp(
    sampleRange(rng, tendencies.purchaseIntervalDays) *
      FREQUENCY_INTERVAL_MULTIPLIER[purchaseFrequency],
    7,
    1_500,
  );

  let grossMarginRate = sampleRange(rng, tendencies.grossMarginRate);
  const expectedDiscountRate = sampleRange(
    rng,
    {
      min: PROMOTION_DISCOUNT_RATE[promotionProfile][0],
      max: PROMOTION_DISCOUNT_RATE[promotionProfile][1],
    },
  );
  if (promotionProfile === "promotion_heavy" || promotionProfile === "clearance_heavy") {
    grossMarginRate = clamp(grossMarginRate - rng.uniform(0.015, 0.06), 0.12, 0.9);
  }

  const expectedReturnRate = sampleRange(rng, tendencies.returnRate);
  const paymentFeeRate = sampleRange(rng, tendencies.paymentFeeRate);
  const shippingSubsidyRate = sampleRange(rng, tendencies.shippingSubsidyRate);
  const fulfillmentRate = sampleRange(rng, tendencies.fulfillmentRate);
  const [paidMin, paidMax] = PAID_DEPENDENCE_RANGE[marketingDependence];
  let paidDependence = rng.uniform(paidMin, paidMax);
  if (outlierTag === "strong_organic") paidDependence *= 0.55;
  paidDependence = clamp(paidDependence, 0.05, 0.95);

  const retentionBaselineBonus =
    marketingDependence === "retention_heavy" ? 0.16 : 0;
  const organicDemandShare = clamp(
    1 - paidDependence + retentionBaselineBonus,
    0.08,
    0.95,
  );

  const marketingSpendRate = clamp(
    0.055 + paidDependence * rng.uniform(0.09, 0.27),
    0.04,
    0.32,
  );

  const expectedContributionMarginRate =
    grossMarginRate -
    expectedDiscountRate -
    expectedReturnRate * grossMarginRate -
    paymentFeeRate -
    shippingSubsidyRate -
    fulfillmentRate -
    marketingSpendRate;

  const expectedUnitsPerOrder = sampleRange(rng, tendencies.unitsPerOrder);
  const baselineConversionRate = sampleRange(
    rng,
    tendencies.baselineConversionRate,
  );
  const considerationDays = sampleRange(rng, tendencies.considerationDays);
  const customerPopulation = Math.max(
    100,
    Math.round(
      expectedAnnualOrders /
        Math.max(1, 1 + repeatProbability * (365 / expectedPurchaseIntervalDays)),
    ),
  );

  let brandStrength = sampleRange(rng, tendencies.brandStrength);
  let organicStrength = sampleRange(rng, tendencies.organicStrength);
  if (marketingDependence === "organic_heavy") {
    brandStrength = clamp(brandStrength * 1.25, 0.01, 0.92);
    organicStrength = clamp(organicStrength * 1.35, 0.01, 0.95);
  }
  if (outlierTag === "strong_organic") {
    brandStrength = clamp(brandStrength * 1.45, 0.01, 0.92);
    organicStrength = clamp(organicStrength * 1.55, 0.01, 0.95);
  }

  let mobileTrafficShare = clamp(
    rng.normal(
      config.archetype === "fashion_apparel" ||
        config.archetype === "beauty_cosmetics"
        ? 0.72
        : 0.63,
      0.1,
    ),
    0.28,
    0.92,
  );
  if (outlierTag === "unusually_mobile") {
    mobileTrafficShare = clamp(mobileTrafficShare + 0.16, 0.28, 0.95);
  }
  if (config.overrides?.mobileTrafficShare !== undefined) {
    if (
      config.overrides.mobileTrafficShare < 0.05 ||
      config.overrides.mobileTrafficShare > 0.98
    ) {
      throw new RangeError("mobileTrafficShare override must be within [0.05,0.98]");
    }
    mobileTrafficShare = config.overrides.mobileTrafficShare;
  }

  const archetypeSkuMid =
    (tendencies.catalogSkuRange[0] + tendencies.catalogSkuRange[1]) / 2;
  const skuCount = Math.round(
    clamp(
      rng.jitter(
        archetypeSkuMid *
          CATALOG_MULTIPLIER[catalogProfile] *
          SCALE_CATALOG_MULTIPLIER[config.scale],
        0.32,
      ),
      4,
      1_500,
    ),
  );
  const categoryCount = Math.round(
    clamp(Math.sqrt(skuCount) * rng.uniform(0.7, 1.4), 2, 24),
  );

  const exponentBase: Record<CatalogProfile, number> = {
    tiny_curated: 1.2,
    moderate: 1,
    large: 0.88,
    very_large: 0.78,
    long_tail: 0.68,
  };
  const productConcentrationExponent = clamp(
    rng.normal(exponentBase[catalogProfile], 0.12),
    0.48,
    1.5,
  );

  const inventoryDepthOrders =
    sampleRange(rng, tendencies.inventoryDepthOrders) *
    INVENTORY_DEPTH_MULTIPLIER[inventoryProfile];
  const inventoryLeadDays =
    sampleRange(rng, tendencies.inventoryLeadDays) *
    INVENTORY_LEAD_MULTIPLIER[inventoryProfile];
  const stockoutRisk = clamp(
    0.2 +
      (inventoryProfile === "stockout_prone" ? 0.4 : 0) +
      (inventoryProfile === "shallow" ? 0.2 : 0) +
      (inventoryLeadDays > 90 ? 0.12 : 0) -
      Math.min(0.2, inventoryDepthOrders / 800),
    0.03,
    0.85,
  );
  const backorderProbability = clamp(
    config.archetype === "furniture" ? 0.35 : 0.08 + stockoutRisk * 0.25,
    0.02,
    0.6,
  );

  const priceElasticity =
    sampleRange(rng, tendencies.priceSensitivity) *
    PROMOTION_ELASTICITY_MULTIPLIER[promotionProfile];
  const seasonalityStrength = sampleRange(rng, {
    min: SEASONALITY_STRENGTH[seasonalityProfile][0],
    max: SEASONALITY_STRENGTH[seasonalityProfile][1],
  });

  const activeChannels = chooseChannels(
    rng,
    config,
    marketingDependence,
  );

  return {
    merchantId: syntheticMerchantId(config, rng),
    complexity: config.complexity,
    aovProfile,
    purchaseFrequency,
    marketingDependence,
    promotionProfile,
    catalogProfile,
    inventoryProfile,
    customerEconomics,
    seasonalityProfile,
    expectedAovMinor,
    expectedAnnualOrders,
    annualRevenuePotentialMinor,
    expectedUnitsPerOrder,
    grossMarginRate,
    expectedDiscountRate,
    expectedReturnRate,
    paymentFeeRate,
    shippingSubsidyRate,
    fulfillmentRate,
    marketingSpendRate,
    expectedContributionMarginRate,
    repeatProbability,
    expectedPurchaseIntervalDays,
    baselineConversionRate,
    considerationDays,
    customerPopulation,
    brandStrength,
    organicStrength,
    paidDependence,
    organicDemandShare,
    mobileTrafficShare,
    skuCount,
    categoryCount,
    productConcentrationExponent,
    productConcentrationTop5: concentrationTop5(
      skuCount,
      productConcentrationExponent,
    ),
    inventoryDepthOrders,
    inventoryLeadDays,
    stockoutRisk,
    backorderProbability,
    priceElasticity,
    promotionElasticityMultiplier:
      PROMOTION_ELASTICITY_MULTIPLIER[promotionProfile],
    seasonalityStrength,
    activeChannels,
    ...(outlierTag === undefined ? {} : { outlierTag }),
  };
}
