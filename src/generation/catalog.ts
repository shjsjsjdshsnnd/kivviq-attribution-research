import type { MerchantGenerationConfig } from "./config.js";
import type { LatentBusinessProfile } from "./profile.js";
import { SeededRandom } from "./rng.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export interface GeneratedProduct {
  readonly productId: string;
  readonly categoryId: string;
  readonly demandWeight: number;
  readonly dailyLatentDemandUnits: number;
  readonly priceMinor: number;
  readonly grossMarginRate: number;
  readonly returnRate: number;
  readonly priceElasticity: number;
  readonly promotionSensitivity: number;
  readonly initialAvailableUnits: number;
  readonly initialReservedUnits: number;
  readonly replenishmentUnits: number;
  readonly replenishmentEverySeconds?: number;
  readonly supplierLeadTimeSeconds: number;
  readonly allowBackorders: boolean;
  readonly stockoutBehavior: "lost_demand" | "substitute" | "backorder";
  readonly substituteProductIds?: readonly string[];
}

export interface GeneratedCatalog {
  readonly products: readonly GeneratedProduct[];
  readonly categoryIds: readonly string[];
  readonly top5DemandShare: number;
}

function zipfWeights(count: number, exponent: number): readonly number[] {
  const raw = Array.from(
    { length: count },
    (_, index) => 1 / Math.pow(index + 1, exponent),
  );
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / total);
}

export function generateCatalog(
  config: MerchantGenerationConfig,
  profile: LatentBusinessProfile,
  rng: SeededRandom,
): GeneratedCatalog {
  const categoryIds = Array.from(
    { length: profile.categoryCount },
    (_, index) => `${profile.merchantId}_category_${String(index + 1).padStart(2, "0")}`,
  );
  const weights = zipfWeights(
    profile.skuCount,
    profile.productConcentrationExponent,
  );
  const unitsPerDay =
    (profile.expectedAnnualOrders * profile.expectedUnitsPerOrder) / 365;
  const typicalItemPrice = Math.max(
    100,
    Math.round(profile.expectedAovMinor / profile.expectedUnitsPerOrder),
  );

  const productIds = Array.from(
    { length: profile.skuCount },
    (_, index) => `${profile.merchantId}_sku_${String(index + 1).padStart(3, "0")}`,
  );

  const products: GeneratedProduct[] = productIds.map(
    (productId, index) => {
      const rank = index + 1;
      const weight = weights[index]!;
      const priceRankAdjustment =
        1 + (index / Math.max(1, profile.skuCount - 1) - 0.5) * rng.uniform(-0.35, 0.35);
      const priceMinor = Math.max(
        100,
        Math.round(
          typicalItemPrice *
            priceRankAdjustment *
            Math.exp(rng.normal(0, 0.34)),
        ),
      );
      const grossMarginRate = clamp(
        profile.grossMarginRate + rng.normal(0, 0.055),
        0.1,
        0.92,
      );
      const returnRate = clamp(
        profile.expectedReturnRate * Math.exp(rng.normal(0, 0.25)),
        0,
        0.4,
      );
      const priceElasticity = clamp(
        profile.priceElasticity * Math.exp(rng.normal(0, 0.2)),
        -4.5,
        -0.05,
      );
      const promotionSensitivity = clamp(
        profile.promotionElasticityMultiplier * Math.exp(rng.normal(0, 0.18)),
        0.2,
        2.5,
      );
      const dailyLatentDemandUnits = Math.max(
        0.0001,
        unitsPerDay * weight * Math.exp(rng.normal(0, 0.08)),
      );

      const expectedProductOrdersPerLead =
        dailyLatentDemandUnits *
        Math.max(1, profile.inventoryLeadDays) *
        rng.uniform(0.8, 1.25);
      const depthMultiplier = clamp(
        profile.inventoryDepthOrders / 50,
        0.25,
        4,
      );
      const initialAvailableUnits = Math.max(
        0,
        Math.round(expectedProductOrdersPerLead * depthMultiplier),
      );
      const initialReservedUnits = Math.min(
        initialAvailableUnits,
        Math.max(0, Math.round(initialAvailableUnits * rng.uniform(0, 0.08))),
      );
      const replenishmentUnits = Math.max(
        0,
        Math.round(
          dailyLatentDemandUnits *
            rng.uniform(7, 35) *
            (profile.inventoryProfile === "replenishment_friendly" ? 1.4 : 1),
        ),
      );
      const supplierLeadTimeSeconds = Math.max(
        0,
        Math.round(profile.inventoryLeadDays * 86_400 * rng.uniform(0.75, 1.25)),
      );

      const canSubstitute = productIds.length > 1;
      let stockoutBehavior: GeneratedProduct["stockoutBehavior"] = "lost_demand";
      let allowBackorders = false;
      let substituteProductIds: readonly string[] | undefined;

      if (canSubstitute && rng.bool(0.32 + profile.stockoutRisk * 0.25)) {
        stockoutBehavior = "substitute";
        const alternateIndex =
          index === productIds.length - 1 ? Math.max(0, index - 1) : index + 1;
        substituteProductIds = [productIds[alternateIndex]!];
      } else if (rng.bool(profile.backorderProbability)) {
        stockoutBehavior = "backorder";
        allowBackorders = true;
      }

      const replenishmentEverySeconds =
        replenishmentUnits > 0
          ? Math.max(
              86_400,
              Math.round(
                rng.uniform(
                  profile.inventoryProfile === "replenishment_friendly" ? 5 : 10,
                  profile.inventoryProfile === "long_lead_time" ? 60 : 35,
                ) * 86_400,
              ),
            )
          : undefined;

      return {
        productId,
        categoryId: categoryIds[index % categoryIds.length]!,
        demandWeight: weight,
        dailyLatentDemandUnits,
        priceMinor,
        grossMarginRate,
        returnRate,
        priceElasticity,
        promotionSensitivity,
        initialAvailableUnits,
        initialReservedUnits,
        replenishmentUnits,
        ...(replenishmentEverySeconds === undefined
          ? {}
          : { replenishmentEverySeconds }),
        supplierLeadTimeSeconds,
        allowBackorders,
        stockoutBehavior,
        ...(substituteProductIds === undefined
          ? {}
          : { substituteProductIds }),
      };
    },
  );

  const top5DemandShare = products
    .slice(0, Math.min(5, products.length))
    .reduce((sum, product) => sum + product.demandWeight, 0);

  // Keep price/cost structure correlated with the requested archetype but do
  // not expose these generator internals as a competing GroundTruth schema.
  void config;

  return {
    products,
    categoryIds,
    top5DemandShare,
  };
}
