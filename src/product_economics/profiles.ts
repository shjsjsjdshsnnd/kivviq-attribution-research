import type { GeneratedMerchantWorld } from "../generation/config.js";
import {
  buildProductEconomicProfiles,
  resolveEcommercePolicy,
} from "../ecommerce_economics/products.js";
import {
  productOpportunityRows,
} from "../ecommerce_economics/opportunity.js";
import type {
  ProductEconomicProfile,
} from "../ecommerce_economics/types.js";
import type {
  ProductSeasonalityProfile,
  SkuEconomicIntelligence,
} from "./types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function syntheticBrandId(
  world: GeneratedMerchantWorld,
  productId: string,
  categoryId: string,
): string {
  const brandCount = Math.max(
    2,
    Math.min(
      8,
      Math.ceil(world.summary.categoryCount * 0.65),
    ),
  );
  const ordinal =
    fnv1a32(categoryId + "|" + productId) % brandCount;
  return (
    world.summary.merchantId +
    "_brand_" +
    String(ordinal + 1).padStart(2, "0")
  );
}

function cadenceToDaily(
  value: number,
  cadence: "hour" | "day" | "week",
): number {
  if (cadence === "hour") return value * 24;
  if (cadence === "week") return value / 7;
  return value;
}

function matchesSelector(
  selector: unknown,
  productId: string,
  categoryId: string,
): boolean {
  if (selector === undefined) return true;
  if (typeof selector !== "object" || selector === null) {
    return false;
  }

  const record = selector as {
    readonly productIds?: readonly string[];
    readonly categoryIds?: readonly string[];
  };

  if (
    record.productIds !== undefined &&
    record.productIds.length > 0 &&
    !record.productIds.includes(productId)
  ) {
    return false;
  }

  if (
    record.categoryIds !== undefined &&
    record.categoryIds.length > 0 &&
    !record.categoryIds.includes(categoryId)
  ) {
    return false;
  }

  return true;
}

function seasonalityForProduct(
  world: GeneratedMerchantWorld,
  productId: string,
  categoryId: string,
): readonly ProductSeasonalityProfile[] {
  return world.manifest.seasonality
    .filter((mechanism) =>
      matchesSelector(
        mechanism.selector,
        productId,
        categoryId,
      ),
    )
    .map((mechanism) => ({
      mechanismId: mechanism.id,
      kind: mechanism.kind,
      multipliers: mechanism.multipliers.map(
        (entry) => ({
          key: entry.key,
          multiplier: Number(entry.multiplier),
        }),
      ),
    }));
}

function baseConversionPropensity(
  world: GeneratedMerchantWorld,
): number {
  const pdpToCart =
    world.manifest.funnelMechanisms.find(
      (mechanism) =>
        mechanism.from === "pdp" &&
        mechanism.to === "add_to_cart",
    )?.baseProbability ?? 0.1;
  const cartToCheckout =
    world.manifest.funnelMechanisms.find(
      (mechanism) =>
        mechanism.from === "add_to_cart" &&
        mechanism.to === "checkout",
    )?.baseProbability ?? 0.5;
  const checkoutToPurchase =
    world.manifest.funnelMechanisms.find(
      (mechanism) =>
        mechanism.from === "checkout" &&
        mechanism.to === "purchase",
    )?.baseProbability ?? 0.6;

  return (
    Number(pdpToCart) *
    Number(cartToCheckout) *
    Number(checkoutToPurchase)
  );
}

export function buildSkuEconomicIntelligence(
  world: GeneratedMerchantWorld,
  productProfiles:
    | readonly ProductEconomicProfile[]
    | undefined = undefined,
): readonly SkuEconomicIntelligence[] {
  const profiles =
    productProfiles ??
    buildProductEconomicProfiles(world);
  const profileById = new Map(
    profiles.map(
      (profile) => [profile.productId, profile] as const,
    ),
  );
  const opportunityById = new Map(
    productOpportunityRows(world, {
      profiles,
      policy: resolveEcommercePolicy(world),
    }).map(
      (row) => [row.productId, row] as const,
    ),
  );

  const demandDaily = world.manifest.productDemandMechanisms.map(
    (mechanism) => ({
      productId: mechanism.productId,
      daily: cadenceToDaily(
        Number(mechanism.baseLatentDemandUnits),
        mechanism.cadence,
      ),
    }),
  );
  const totalDemand = demandDaily.reduce(
    (sum, item) => sum + item.daily,
    0,
  );
  const maxDemand = Math.max(
    1e-12,
    ...demandDaily.map((item) => item.daily),
  );
  const baseConversion = baseConversionPropensity(world);

  return world.manifest.productDemandMechanisms.map(
    (demand) => {
      const profile = profileById.get(demand.productId);
      if (!profile) {
        throw new RangeError(
          "missing Step 7 product profile for " + demand.productId,
        );
      }
      const inventory =
        world.manifest.inventoryMechanisms.find(
          (candidate) =>
            candidate.productId === demand.productId,
        );
      if (!inventory) {
        throw new RangeError(
          "missing inventory mechanism for " + demand.productId,
        );
      }
      const opportunity = opportunityById.get(
        demand.productId,
      );
      if (!opportunity) {
        throw new RangeError(
          "missing product opportunity row for " + demand.productId,
        );
      }

      const structuralDemandUnitsPerDay =
        cadenceToDaily(
          Number(demand.baseLatentDemandUnits),
          demand.cadence,
        );
      const structuralDemandShare =
        totalDemand > 0
          ? structuralDemandUnitsPerDay / totalDemand
          : 0;
      const structuralDesirabilityIndex = clamp(
        Math.sqrt(
          structuralDemandUnitsPerDay / maxDemand,
        ),
        0,
        1,
      );

      const relativePrice =
        profile.listPriceMinor /
        Math.max(
          1,
          world.summary.catalogMedianPriceMinor,
        );
      const priceFriction = clamp(
        1 / Math.sqrt(Math.max(0.2, relativePrice)),
        0.45,
        1.6,
      );
      const conversionPropensity = clamp(
        baseConversion *
          (0.45 +
            structuralDesirabilityIndex * 0.85) *
          priceFriction,
        0.001,
        0.98,
      );

      const initialAvailableUnits = Number(
        inventory.initialAvailableUnits,
      );
      const initialReservedUnits = Number(
        inventory.initialReservedUnits,
      );

      return {
        productId: demand.productId,
        categoryId: demand.categoryId,
        brandId: syntheticBrandId(
          world,
          demand.productId,
          demand.categoryId,
        ),
        brandSource: "step8_synthetic_assignment",

        priceMinor: profile.listPriceMinor,
        cogsPerUnitMinor: profile.cogsPerUnitMinor,
        grossMarginRate: profile.grossMarginRate,
        expectedContributionPerUnitMinor:
          opportunity.expectedContributionPerUnitMinor,

        initialAvailableUnits,
        initialReservedUnits,
        initialSellableUnits: Math.max(
          0,
          initialAvailableUnits -
            initialReservedUnits,
        ),
        replenishmentUnits: Number(
          inventory.replenishmentUnits,
        ),
        supplierLeadTimeSeconds: Number(
          inventory.supplierLeadTimeSeconds,
        ),
        allowBackorders: inventory.allowBackorders,
        stockoutBehavior: inventory.stockoutBehavior,

        structuralDemandUnitsPerDay,
        structuralDemandShare,
        structuralDesirabilityIndex,
        conversionPropensity,

        seasonality: seasonalityForProduct(
          world,
          demand.productId,
          demand.categoryId,
        ),
        substitutionProductIds: [
          ...new Set([
            ...(demand.substitutionProductIds ?? []),
            ...(inventory.substituteProductIds ?? []),
          ]),
        ],
        complementaryProductIds:
          demand.complementaryProductIds ?? [],

        returnRate: profile.returnProbability,
        shippingCostPerUnitMinor:
          profile.shippingCostPerUnitMinor,
        fulfillmentCostPerUnitMinor:
          profile.fulfillmentCostPerUnitMinor,
        discountSensitivity:
          profile.promotionSensitivity,
      };
    },
  );
}
