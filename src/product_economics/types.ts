import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { PaidMarketingChannel } from "../advertising_economics/types.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { EcommerceEconomicReport, ProductEconomicProfile } from "../ecommerce_economics/types.js";

export const PRODUCT_ECONOMICS_VERSION =
  "product-economics-8.0.0" as const;

export interface ProductSeasonalityProfile {
  readonly mechanismId: string;
  readonly kind: string;
  readonly multipliers: readonly {
    readonly key: string;
    readonly multiplier: number;
  }[];
}

export interface SkuEconomicIntelligence {
  readonly productId: string;
  readonly categoryId: string;

  /**
   * Synthetic deterministic brand assignment created in Step 8 because the
   * frozen Step 1/2 GroundTruth does not contain authoritative product brand.
   * This is evaluator metadata, not merchant-observed or causal truth.
   */
  readonly brandId: string;
  readonly brandSource: "step8_synthetic_assignment";

  readonly priceMinor: number;
  readonly cogsPerUnitMinor: number;
  readonly grossMarginRate: number;
  readonly expectedContributionPerUnitMinor: number;

  readonly initialAvailableUnits: number;
  readonly initialReservedUnits: number;
  readonly initialSellableUnits: number;
  readonly replenishmentUnits: number;
  readonly supplierLeadTimeSeconds: number;
  readonly allowBackorders: boolean;
  readonly stockoutBehavior: "lost_demand" | "substitute" | "backorder";

  readonly structuralDemandUnitsPerDay: number;
  readonly structuralDemandShare: number;
  readonly structuralDesirabilityIndex: number;
  readonly conversionPropensity: number;

  readonly seasonality: readonly ProductSeasonalityProfile[];
  readonly substitutionProductIds: readonly string[];
  readonly complementaryProductIds: readonly string[];

  readonly returnRate: number;
  readonly shippingCostPerUnitMinor: number;
  readonly fulfillmentCostPerUnitMinor: number;
  readonly discountSensitivity: number;
}

export interface ObservedProductPerformance {
  readonly productId: string;
  readonly representedOrders: number;
  readonly representedUnits: number;
  readonly netRevenueMinor: number;
  readonly grossProfitMinor: number;
  readonly contributionProfitBeforeAdvertisingMinor: number;
  readonly productViews: number;
  readonly addsToCart: number;
  readonly observedViewToPurchaseRate: number | null;
}

export interface ProductCampaignPerformance {
  readonly productId: string;
  readonly channel: PaidMarketingChannel;
  readonly campaignSpendMinor: number;
  readonly platformClaimedProductRevenueMinor: number;
  readonly platformProductRoas: number | null;
  readonly claimedOrdersContainingProduct: number;
}

export interface InventoryScaleRisk {
  readonly productId: string;
  readonly channel: PaidMarketingChannel;
  readonly remainingUnits: number;
  readonly stockCoverageDays: number | null;
  readonly platformProductRoas: number | null;
  readonly expectedContributionPerUnitMinor: number;
  readonly optimisticRemainingInventoryContributionMinor: number;
  readonly proposedAdditionalSpendMinor: number;
  /**
   * Hard upper bound: even if every remaining unit were sold solely because
   * of the next spend block, this is the maximum contribution after that
   * incremental advertising cost.
   */
  readonly optimisticMarginalContributionUpperBoundMinor: number;
  readonly scalingEconomicallyImpossibleAtThisSpendBlock: boolean;
}

export interface ProductChoiceShift {
  readonly productId: string;
  readonly baselineWeightedSelections: number;
  readonly constrainedWeightedSelections: number;
  readonly selectionDelta: number;
  readonly structuralDemandUnitsPerDayBefore: number;
  readonly structuralDemandUnitsPerDayAfter: number;
  readonly structuralDemandDelta: number;
  readonly meanLatentPreferenceBefore: number;
  readonly meanLatentPreferenceAfter: number;
  readonly latentPreferenceDelta: number;
}

export interface SelloutSubstitutionDiagnostic {
  readonly soldOutProductId: string;
  readonly substituteProductId: string;
  readonly knownSubstitutionRelationship: boolean;
  readonly soldOutProduct: ProductChoiceShift;
  readonly substituteProduct: ProductChoiceShift;
  readonly observedSubstituteLiftWithNoStructuralDemandChange: boolean;
  readonly observedSubstituteLiftWithNoLatentPreferenceChange: boolean;
}

export interface ProductEconomicsReport {
  readonly version: typeof PRODUCT_ECONOMICS_VERSION;
  readonly merchantWorldId: string;
  readonly products: readonly SkuEconomicIntelligence[];
  readonly observed: readonly ObservedProductPerformance[];
}

export interface ProductEconomicsRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly ecommerceReport?: EcommerceEconomicReport;
  readonly productProfiles?: readonly ProductEconomicProfile[];
}
