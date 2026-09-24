export const WEBSITE_MODEL_VERSION = "website_model_v1" as const;
export const WEBSITE_SCHEMA_VERSION = 1 as const;

export type WebsiteModelVersion = typeof WEBSITE_MODEL_VERSION;
export type WebsiteDevice = "mobile" | "desktop" | "tablet";
export type CanonicalWebsiteDevice = "mobile" | "desktop";
export type WebsiteSurface =
  | "homepage"
  | "collections"
  | "pdp"
  | "cart"
  | "checkout"
  | "search"
  | "navigation";

export interface HomepageState {
  readonly loadTimeMs: number;
  readonly heroRelevance: number;
  readonly promotionalClarity: number;
  readonly valuePropositionClarity: number;
  readonly navigationClarity: number;
  readonly merchandisingQuality: number;
  readonly trustSignalStrength: number;
  readonly mobileUsability: number;
  readonly visualQuality: number;
}

export interface CollectionState {
  readonly loadTimeMs: number;
  readonly sortQuality: number;
  readonly filterQuality: number;
  readonly productRankingRelevance: number;
  readonly productCardInformationQuality: number;
  readonly imageryQuality: number;
  readonly promotionalVisibility: number;
  readonly stockVisibility: number;
  readonly priceVisibility: number;
  readonly mobileUsability: number;
}

export interface PDPState {
  readonly loadTimeMs: number;
  readonly imageQuality: number;
  readonly imageQuantity: number;
  readonly productDescriptionQuality: number;
  readonly priceClarity: number;
  readonly variantSelectionUsability: number;
  readonly stockClarity: number;
  readonly deliveryInformationClarity: number;
  readonly returnsInformationClarity: number;
  readonly trustStrength: number;
  readonly reviewsStrength: number;
  readonly recommendationQuality: number;
  readonly mobileUsability: number;
  readonly ctaVisibility: number;
}

export interface CartState {
  readonly loadTimeMs: number;
  readonly priceClarity: number;
  readonly shippingVisibility: number;
  readonly discountCodeUsability: number;
  readonly upsellQuality: number;
  readonly cartEditUsability: number;
  readonly checkoutCtaClarity: number;
  readonly trustSignals: number;
  readonly mobileUsability: number;
}

export interface CheckoutState {
  readonly loadTimeMs: number;
  readonly formComplexity: number;
  readonly paymentOptions: number;
  readonly shippingCostSurprise: number;
  readonly shippingSpeedClarity: number;
  readonly errorRate: number;
  readonly couponReliability: number;
  readonly trust: number;
  readonly mobileUsability: number;
  readonly numberOfSteps: number;
}

export interface SearchState {
  readonly searchSpeedMs: number;
  readonly resultRelevance: number;
  readonly typoTolerance: number;
  readonly synonymHandling: number;
  readonly zeroResultRate: number;
  readonly filteringQuality: number;
  readonly merchandisingQuality: number;
  readonly mobileUsability: number;
}

export interface NavigationState {
  readonly hierarchyClarity: number;
  readonly categoryDiscoverability: number;
  readonly depth: number;
  readonly mobileMenuQuality: number;
  readonly brokenLinkRate: number;
  readonly namingClarity: number;
}

export interface DeviceSurfaceExperience {
  readonly loadTimeMs: number;
  readonly usabilityScore: number;
  readonly layoutStability: number;
}

export interface DeviceExperienceState {
  readonly homepage: DeviceSurfaceExperience;
  readonly collections: DeviceSurfaceExperience;
  readonly pdp: DeviceSurfaceExperience;
  readonly cart: DeviceSurfaceExperience;
  readonly checkout: DeviceSurfaceExperience;
  readonly search: DeviceSurfaceExperience;
  readonly navigation: DeviceSurfaceExperience;
}

export interface WebsiteState {
  readonly version: WebsiteModelVersion;
  readonly schemaVersion: typeof WEBSITE_SCHEMA_VERSION;
  readonly homepage: HomepageState;
  readonly collections: CollectionState;
  readonly pdp: PDPState;
  readonly cart: CartState;
  readonly checkout: CheckoutState;
  readonly search: SearchState;
  readonly navigation: NavigationState;
  readonly deviceExperience: {
    readonly mobile: DeviceExperienceState;
    readonly desktop: DeviceExperienceState;
  };
}

export type WebsiteScenarioId =
  | "healthy_website"
  | "slow_mobile_pdp"
  | "poor_checkout"
  | "bad_search"
  | "weak_product_imagery"
  | "shipping_surprise"
  | "broken_coupon"
  | "poor_collection_sorting"
  | "multiple_cro_issues"
  | "subtle_mobile_checkout_drag";

export interface WebsiteBehaviorContext {
  readonly device: WebsiteDevice;
  readonly assortmentSize?: number;
  readonly highConsideration?: boolean;
  readonly promotionActive?: boolean;
  readonly paidTraffic?: boolean;
  readonly shippingCostMinor?: number;
  readonly expectedAovMinor?: number;
}

export interface HomepageBehaviorEffect {
  readonly collectionWeightMultiplier: number;
  readonly searchWeightMultiplier: number;
  readonly pdpWeightMultiplier: number;
  readonly exitWeightMultiplier: number;
  readonly measuredLoadTimeMs: number;
}

export interface CollectionBehaviorEffect {
  readonly toPdpMultiplier: number;
  readonly exitProbabilityMultiplier: number;
  readonly searchUsageMultiplier: number;
  readonly measuredLoadTimeMs: number;
}

export interface SearchBehaviorEffect {
  readonly toPdpMultiplier: number;
  readonly exitProbabilityMultiplier: number;
  readonly refinementMultiplier: number;
  readonly zeroResultProbability: number;
  readonly measuredLoadTimeMs: number;
}

export interface PDPBehaviorEffect {
  readonly addToCartMultiplier: number;
  readonly exitProbabilityMultiplier: number;
  readonly comparisonMultiplier: number;
  readonly measuredLoadTimeMs: number;
}

export interface CartBehaviorEffect {
  readonly checkoutMultiplier: number;
  readonly abandonmentProbabilityMultiplier: number;
  readonly measuredLoadTimeMs: number;
}

export interface CheckoutBehaviorEffect {
  readonly purchaseMultiplier: number;
  readonly abandonmentProbabilityMultiplier: number;
  readonly couponAttemptProbability: number;
  readonly couponFailureProbability: number;
  readonly paymentFailureProbability: number;
  readonly measuredLoadTimeMs: number;
}

export interface WebsiteGodModeTruth {
  readonly modelVersion: WebsiteModelVersion;
  readonly schemaVersion: typeof WEBSITE_SCHEMA_VERSION;
  readonly stateFingerprint: string;
  readonly websiteState: WebsiteState;
}

export interface WebsiteAnalytics {
  readonly sessions: number;
  readonly bounceRate: number;
  readonly collectionToPdpRate: number;
  readonly searchUsageRate: number;
  readonly searchExitRate: number;
  readonly zeroResultSearchRate: number;
  readonly pdpViews: number;
  readonly addToCartRate: number;
  readonly cartToCheckoutRate: number;
  readonly checkoutToPurchaseRate: number;
  readonly conversionRate: number;
  readonly deviceConversion: Readonly<Record<WebsiteDevice, number>>;
  readonly averagePageLoadMs: Readonly<Partial<Record<WebsiteSurface, number>>>;
  readonly couponAttempts: number;
  readonly couponFailures: number;
  readonly couponFailureRate: number;
  readonly paymentErrors: number;
}

export interface WebsiteObservableEvent {
  readonly eventType: string;
  readonly sessionId?: string;
  readonly device?: WebsiteDevice;
  readonly surface?: WebsiteSurface;
  readonly pageLoadTimeMs?: number;
  readonly searchZeroResults?: boolean;
}

export type WebsiteIntervention =
  | {
      readonly kind: "IMPROVE_PAGE_SPEED";
      readonly surface: Exclude<WebsiteSurface, "navigation">;
      readonly device?: CanonicalWebsiteDevice;
      readonly targetLoadTimeMs: number;
    }
  | {
      readonly kind: "CHANGE_COLLECTION_SORT";
      readonly sortQuality: number;
      readonly productRankingRelevance: number;
    }
  | {
      readonly kind: "FIX_SEARCH";
      readonly resultRelevance: number;
      readonly zeroResultRate: number;
      readonly typoTolerance: number;
      readonly synonymHandling: number;
    }
  | {
      readonly kind: "IMPROVE_PRODUCT_IMAGERY";
      readonly imageQuality: number;
      readonly imageQuantity: number;
    }
  | {
      readonly kind: "REDUCE_CHECKOUT_FRICTION";
      readonly formComplexity: number;
      readonly numberOfSteps: number;
      readonly errorRate: number;
    }
  | {
      readonly kind: "FIX_COUPON";
      readonly couponReliability: number;
      readonly discountCodeUsability: number;
    }
  | {
      readonly kind: "SURFACE_SHIPPING_EARLIER";
      readonly cartShippingVisibility: number;
      readonly checkoutShippingCostSurprise: number;
      readonly shippingSpeedClarity: number;
    };
