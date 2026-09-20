export const GENERATOR_VERSION = "merchant-world-generator-2.0.0" as const;

export const MERCHANT_ARCHETYPES = [
  "fashion_apparel",
  "beauty_cosmetics",
  "furniture",
  "home_furnishings_decor",
  "supplements_wellness",
  "consumer_electronics",
  "specialty_retail",
  "luxury",
  "commodity_value_retail",
  "replenishment_heavy",
  "subscription_heavy",
] as const;

export type MerchantArchetype = (typeof MERCHANT_ARCHETYPES)[number];

export const MERCHANT_SCALES = [
  "micro",
  "small",
  "growth",
  "mid_market",
  "large",
] as const;

export type MerchantScale = (typeof MERCHANT_SCALES)[number];

export const COMPLEXITY_LEVELS = [
  "simple",
  "normal",
  "complex",
  "adversarial",
] as const;

export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number];

export const AOV_PROFILES = [
  "very_low",
  "low",
  "medium",
  "high",
  "extreme",
] as const;
export type AovProfile = (typeof AOV_PROFILES)[number];

export const PURCHASE_FREQUENCY_PROFILES = [
  "one_off",
  "infrequent",
  "occasional",
  "repeat",
  "replenishment",
  "subscription",
] as const;
export type PurchaseFrequencyProfile =
  (typeof PURCHASE_FREQUENCY_PROFILES)[number];

export const MARKETING_DEPENDENCE_PROFILES = [
  "organic_heavy",
  "paid_media_heavy",
  "retention_heavy",
  "balanced",
] as const;
export type MarketingDependenceProfile =
  (typeof MARKETING_DEPENDENCE_PROFILES)[number];

export const PROMOTION_PROFILES = [
  "full_price_dominant",
  "light_promotion",
  "promotion_sensitive",
  "promotion_heavy",
  "clearance_heavy",
] as const;
export type PromotionProfile = (typeof PROMOTION_PROFILES)[number];

export const CATALOG_PROFILES = [
  "tiny_curated",
  "moderate",
  "large",
  "very_large",
  "long_tail",
] as const;
export type CatalogProfile = (typeof CATALOG_PROFILES)[number];

export const INVENTORY_PROFILES = [
  "shallow",
  "deep",
  "long_lead_time",
  "short_lead_time",
  "stockout_prone",
  "replenishment_friendly",
] as const;
export type InventoryProfile = (typeof INVENTORY_PROFILES)[number];

export const CUSTOMER_ECONOMICS_PROFILES = [
  "acquisition_driven",
  "retention_driven",
  "high_ltv",
  "low_repeat",
  "subscription",
  "churn_sensitive",
] as const;
export type CustomerEconomicsProfile =
  (typeof CUSTOMER_ECONOMICS_PROFILES)[number];

export const SEASONALITY_PROFILES = [
  "low",
  "moderate",
  "strong",
  "holiday_heavy",
  "summer_heavy",
  "q4_heavy",
  "event_driven",
] as const;
export type SeasonalityProfile = (typeof SEASONALITY_PROFILES)[number];

export const MARKETING_CHANNELS = [
  "meta",
  "google_search",
  "google_shopping",
  "pinterest",
  "email",
  "sms",
  "affiliate",
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export interface MerchantGenerationOverrides {
  readonly forceZeroIncrementalityChannels?: readonly MarketingChannel[];
  readonly mobileTrafficShare?: number;
  readonly seasonalityProfile?: SeasonalityProfile;
  readonly aovProfile?: AovProfile;
  readonly promotionProfile?: PromotionProfile;
  readonly marketingDependence?: MarketingDependenceProfile;
  readonly catalogProfile?: CatalogProfile;
}

export interface MerchantGenerationConfig {
  readonly seed: number;
  readonly archetype: MerchantArchetype;
  readonly scale: MerchantScale;
  readonly complexity: ComplexityLevel;

  readonly aovProfile?: AovProfile | "auto";
  readonly purchaseFrequency?: PurchaseFrequencyProfile | "auto";
  readonly marketingDependence?: MarketingDependenceProfile | "auto";
  readonly promotionProfile?: PromotionProfile | "auto";
  readonly catalogProfile?: CatalogProfile | "auto";
  readonly inventoryProfile?: InventoryProfile | "auto";
  readonly customerEconomics?: CustomerEconomicsProfile | "auto";
  readonly seasonalityProfile?: SeasonalityProfile | "auto";

  readonly currency?: "CAD" | "USD" | "GBP" | "EUR";
  readonly timezone?: string;
  readonly overrides?: MerchantGenerationOverrides;
}

export interface AppliedOverride {
  readonly field: string;
  readonly value: string | number | readonly string[];
}

export interface MerchantGenerationProvenance {
  readonly generatorVersion: typeof GENERATOR_VERSION;
  readonly groundTruthSchemaVersion: "1.0.0";
  readonly seed: number;
  readonly archetype: MerchantArchetype;
  readonly scale: MerchantScale;
  readonly difficulty: ComplexityLevel;
  readonly generationConfig: MerchantGenerationConfig;
  readonly appliedOverrides: readonly AppliedOverride[];
}

export interface MerchantResearchSummary {
  readonly merchantId: string;
  readonly archetype: MerchantArchetype;
  readonly scale: MerchantScale;
  readonly complexity: ComplexityLevel;
  readonly businessModel: PurchaseFrequencyProfile;
  readonly aovProfile: AovProfile;
  readonly expectedAovMinor: number;
  readonly expectedAnnualOrders: number;
  readonly annualRevenuePotentialMinor: number;
  readonly skuCount: number;
  readonly categoryCount: number;
  readonly catalogMinPriceMinor: number;
  readonly catalogMedianPriceMinor: number;
  readonly catalogMaxPriceMinor: number;
  readonly grossMarginRate: number;
  readonly expectedCogsRate: number;
  readonly repeatProbability: number;
  readonly expectedPurchaseIntervalDays: number;
  readonly mobileTrafficShare: number;
  readonly activeChannels: readonly MarketingChannel[];
  readonly paidDependence: number;
  readonly organicDemandShare: number;
  readonly promotionProfile: PromotionProfile;
  readonly catalogProfile: CatalogProfile;
  readonly inventoryProfile: InventoryProfile;
  readonly customerEconomics: CustomerEconomicsProfile;
  readonly seasonalityProfile: SeasonalityProfile;
  readonly seasonalityStrength: number;
  readonly productConcentrationTop5: number;
  readonly expectedDiscountRate: number;
  readonly expectedReturnRate: number;
  readonly expectedUnitsPerOrder: number;
  readonly paymentFeeRate: number;
  readonly shippingSubsidyRate: number;
  readonly fulfillmentRate: number;
  readonly marketingSpendRate: number;
  readonly expectedContributionMarginRate: number;
  readonly expectedContributionProfitMinor: number;
}

export interface GeneratedMerchantWorld {
  readonly manifest: import("../ground_truth/manifest.js").GroundTruthManifest;
  readonly provenance: MerchantGenerationProvenance;
  readonly summary: MerchantResearchSummary;
}
