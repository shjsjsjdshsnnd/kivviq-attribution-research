import type { MarketingChannel } from "../generation/config.js";

export const PRICING_PROMOTIONS_VERSION =
  "pricing-promotions-10.0.0" as const;

export type PricingCurrency = "CAD" | "USD" | "GBP" | "EUR";

export interface AuthoritativePriceState {
  readonly productId: string;
  readonly variantId?: string;
  readonly regularPriceMinor: number;
  readonly currentSellingPriceMinor: number;
  readonly discountAmountMinor: number;
  readonly discountPercentage: number;
  readonly effectivePriceMinor: number;
  readonly currency: PricingCurrency;
  readonly effectiveStart?: string;
  readonly effectiveEnd?: string;
}

export type PromotionMechanic =
  | "percentage_discount"
  | "fixed_discount"
  | "free_shipping"
  | "free_shipping_threshold"
  | "bundle"
  | "coupon"
  | "loyalty_percentage"
  | "loyalty_fixed_credit"
  | "member_price"
  | "clearance";

export type PromotionScopeKind =
  | "sitewide"
  | "category"
  | "collection"
  | "product_family"
  | "sku_set";

export interface PromotionScope {
  readonly kind: PromotionScopeKind;
  readonly categoryIds?: readonly string[];
  readonly collectionIds?: readonly string[];
  readonly productFamilyIds?: readonly string[];
  readonly productIds?: readonly string[];
}

export interface PromotionTargeting {
  /**
   * Eligibility is intentionally limited to state that can exist before the
   * offer is assigned. Hidden future CLV is not a valid targeting input.
   */
  readonly customerState?: "all" | "new" | "repeat" | "member";
  readonly minimumPriorPurchases?: number;
}

export interface BundleDefinition {
  readonly requiredProductIds: readonly string[];
  readonly percentageOff?: number;
  readonly fixedAmountMinor?: number;
  readonly discountedProductIds?: readonly string[];
}

export interface PromotionDefinition {
  readonly promotionId: string;
  readonly mechanic: PromotionMechanic;
  readonly scope: PromotionScope;
  readonly start: string;
  readonly end: string;
  readonly percentageOff?: number;
  readonly fixedAmountMinor?: number;
  /**
   * Fixed discounts are not assumed to equal percentage discounts. Order
   * allocation is the default for sitewide/coupon/loyalty credits.
   */
  readonly fixedDiscountAllocation?: "order" | "per_eligible_unit";
  readonly minimumSpendMinor?: number;
  readonly freeShippingThresholdMinor?: number;
  readonly bundle?: BundleDefinition;
  readonly targeting?: PromotionTargeting;
  readonly awarenessProbability?: number;
  readonly redemptionProbability?: number;
  readonly stacking?: "exclusive" | "stackable";
  /**
   * Optional causal modifier. 1 means no direct return-rate effect; omitted
   * means promotion affects returns only through customer/product mix.
   */
  readonly returnProbabilityMultiplier?: number;
  /**
   * Optional response modifier used only for explicitly specified
   * promotion-by-channel interactions. Omitted means zero direct interaction.
   */
  readonly channelResponseMultiplierByChannel?: Partial<
    Readonly<Record<MarketingChannel, number>>
  >;
  /**
   * Replenishment-category promotions may induce quantity stockpiling.
   */
  readonly stockpilingEligible?: boolean;
  /**
   * Sparse long-run mechanism. Zero/omitted means no habituation.
   */
  readonly habituationStrength?: number;
}

export interface MajorPromotionEvent {
  readonly eventId: string;
  readonly start: string;
  readonly end: string;
  /**
   * Exogenous market/event demand multiplier. It is separate from the
   * merchant promotion effect.
   */
  readonly baselineDemandMultiplier: number;
  readonly marketingCompetitionMultiplier?: number;
  readonly postEventNeedDeferralDays?: number;
}

export interface PricingPromotionScenario {
  readonly version: typeof PRICING_PROMOTIONS_VERSION;
  readonly currency: PricingCurrency;
  readonly priceStates: readonly AuthoritativePriceState[];
  readonly promotions: readonly PromotionDefinition[];
  readonly majorEvents?: readonly MajorPromotionEvent[];
  /**
   * Frozen Steps 1-9 have no authoritative collection or product-family
   * entity. Step 10 may receive explicit synthetic membership sidecars.
   */
  readonly collectionMembership?: Readonly<Record<string, readonly string[]>>;
  readonly productFamilyMembership?: Readonly<Record<string, readonly string[]>>;
  readonly collectionSource?: "step10_explicit_synthetic_membership";
  readonly productFamilySource?: "step10_explicit_synthetic_membership";
}

export interface PriceResponseTruth {
  readonly productId: string;
  readonly baselinePriceMinor: number;
  readonly effectivePriceMinor: number;
  readonly relativePriceChange: number;
  readonly merchantElasticity: number;
  readonly customerElasticityMultiplier: number;
  readonly nonlinearDemandMultiplier: number;
  readonly crossPriceDemandMultiplier: number;
  readonly reservationPriceMultiplier: number;
  readonly combinedDemandMultiplier: number;
}

export interface ResolvedPromotionEffect {
  readonly promotionIds: readonly string[];
  readonly priceDiscountMinorPerUnit: number;
  readonly freeShipping: boolean;
  readonly freeShippingThresholdMinor?: number;
  readonly promotionUtilityMultiplier: number;
  readonly channelResponseMultiplier: number;
  readonly returnProbabilityMultiplier: number;
  readonly stockpilingMultiplier: number;
  readonly habituationMultiplier: number;
}

export interface ResolvedProductOffer {
  readonly priceState: AuthoritativePriceState;
  readonly basePriceMinor: number;
  readonly listPriceMinor: number;
  readonly effectivePriceMinor: number;
  readonly discountMinor: number;
  readonly priceResponse: PriceResponseTruth;
  readonly promotion: ResolvedPromotionEffect;
}

export interface ResolvedCartShippingTerms {
  readonly customerShippingChargeOverrideMinor?: number;
  readonly freeShipping: boolean;
  readonly qualifyingPromotionIds: readonly string[];
}

export interface ResolvedCartLinePricing {
  readonly productId: string;
  readonly quantity: number;
  readonly listPriceMinor: number;
  readonly effectiveUnitPriceMinor: number;
  readonly discountMinor: number;
  readonly promotionIds: readonly string[];
  readonly returnProbabilityMultiplier: number;
}
