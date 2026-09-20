import type { GeneratedMerchantWorld } from "../generation/config.js";
import { SharedRandomness } from "../simulation/kernel.js";
import { baselineProductPriceMinor } from "../simulation/commerce.js";
import type {
  EcommercePolicy,
  ProductEconomicProfile,
} from "./types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const DEFAULT_ECOMMERCE_POLICY: EcommercePolicy = {
  freeShippingThresholdMinor: 10_000,
  customerShippingChargeMinor: 995,
  paymentFeeRate: 0.027,
  paymentFeeFixedMinor: 30,
  variableOperatingCostPerOrderMinor: 175,
  variableOperatingCostRate: 0.006,
  giftWithPurchaseCostMinor: 0,
  loyaltyCreditRate: 0,
  couponOperationalCostMinor: 0,
};

export function resolveEcommercePolicy(
  world: GeneratedMerchantWorld,
  partial: Partial<EcommercePolicy> = {},
): EcommercePolicy {
  const baselineThreshold =
    world.summary.expectedAovMinor < 5_000
      ? 7_500
      : world.summary.expectedAovMinor < 20_000
        ? 15_000
        : world.summary.expectedAovMinor < 75_000
          ? 30_000
          : 75_000;

  return {
    ...DEFAULT_ECOMMERCE_POLICY,
    freeShippingThresholdMinor: baselineThreshold,
    customerShippingChargeMinor:
      world.summary.expectedAovMinor >= 75_000 ? 2_495 : 995,
    paymentFeeRate: clamp(world.summary.paymentFeeRate, 0, 0.08),
    variableOperatingCostRate: clamp(
      world.summary.fulfillmentRate * 0.08,
      0.002,
      0.02,
    ),
    ...partial,
  };
}

function categoryMarginShift(
  world: GeneratedMerchantWorld,
  categoryId: string,
): number {
  const random = new SharedRandomness(
    world.manifest.seed,
    `step7-category-margin:${categoryId}`,
  );
  return random.normal("shift", 0, 0.075);
}

function profileForProduct(
  world: GeneratedMerchantWorld,
  productId: string,
  categoryId: string,
): ProductEconomicProfile {
  const random = new SharedRandomness(
    world.manifest.seed,
    `step7-product-economics:${productId}`,
  );

  const price = baselineProductPriceMinor(world, productId);
  const merchantMargin = world.summary.grossMarginRate;
  const grossMarginRate = clamp(
    merchantMargin +
      categoryMarginShift(world, categoryId) +
      random.normal("margin", 0, 0.08),
    0.08,
    0.88,
  );
  const cogsPerUnitMinor = Math.max(
    0,
    Math.round(price * (1 - grossMarginRate)),
  );

  const demand = world.manifest.productDemandMechanisms.find(
    (candidate) => candidate.productId === productId,
  );
  const inventory = world.manifest.inventoryMechanisms.find(
    (candidate) => candidate.productId === productId,
  );

  const oversizedProbability =
    world.summary.archetype === "furniture"
      ? 0.7
      : world.summary.archetype === "home_furnishings_decor"
        ? 0.3
        : 0.05;
  const oversized = random.bool("oversized", oversizedProbability);

  const baseShippingRate =
    world.summary.shippingSubsidyRate +
    world.summary.fulfillmentRate * 0.45;
  const shippingCostPerUnitMinor = Math.max(
    75,
    Math.round(
      price *
        clamp(
          baseShippingRate *
            (oversized ? random.uniform("ship-mult") * 1.4 + 1.6 : 0.55 + random.uniform("ship-mult") * 0.9),
          0.008,
          oversized ? 0.28 : 0.12,
        ),
    ),
  );

  const fulfillmentCostPerUnitMinor = Math.max(
    35,
    Math.round(
      price *
        clamp(
          world.summary.fulfillmentRate *
            (0.45 + random.uniform("fulfillment") * 0.9),
          0.006,
          0.15,
        ),
    ),
  );

  const returnProbability = clamp(
    world.summary.expectedReturnRate *
      (0.55 + random.uniform("return-rate") * 1.25) *
      (world.summary.archetype === "fashion_apparel" ? 1.35 : 1),
    0.003,
    0.42,
  );

  const returnShippingCostMinor = Math.max(
    0,
    Math.round(
      shippingCostPerUnitMinor *
        (0.45 + random.uniform("return-ship") * 0.9),
    ),
  );
  const returnHandlingCostMinor = Math.max(
    25,
    Math.round(
      fulfillmentCostPerUnitMinor *
        (0.35 + random.uniform("return-handling") * 0.8),
    ),
  );
  const restockingCostMinor = Math.max(
    0,
    Math.round(
      price *
        (0.002 + random.uniform("restock") * 0.018),
    ),
  );
  const nonRecoverableValueRate = clamp(
    random.uniform("nonrecoverable") *
      (world.summary.archetype === "beauty_cosmetics" ? 0.45 : 0.18),
    0,
    0.5,
  );

  return {
    productId,
    categoryId,
    listPriceMinor: price,
    cogsPerUnitMinor,
    grossMarginRate,
    shippingCostPerUnitMinor,
    fulfillmentCostPerUnitMinor,
    returnProbability,
    returnShippingCostMinor,
    returnHandlingCostMinor,
    restockingCostMinor,
    nonRecoverableValueRate,
    oversized,
    promotionSensitivity:
      0.35 + random.uniform("promo-sensitivity") * 1.4,
    substitutionProductIds:
      inventory?.substituteProductIds ??
      demand?.substitutionProductIds ??
      [],
    complementaryProductIds:
      demand?.complementaryProductIds ?? [],
  };
}

export function buildProductEconomicProfiles(
  world: GeneratedMerchantWorld,
): readonly ProductEconomicProfile[] {
  return world.manifest.productDemandMechanisms.map((mechanism) =>
    profileForProduct(
      world,
      mechanism.productId,
      mechanism.categoryId,
    ),
  );
}

export function productEconomicProfileMap(
  world: GeneratedMerchantWorld,
): ReadonlyMap<string, ProductEconomicProfile> {
  return new Map(
    buildProductEconomicProfiles(world).map(
      (profile) => [profile.productId, profile] as const,
    ),
  );
}
