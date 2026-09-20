import type {
  ComplexityLevel,
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";

export const CUSTOMER_POPULATION_GENERATOR_VERSION =
  "latent-customer-population-3.0.0" as const;

export type CustomerPopulationGeneratorVersion =
  typeof CUSTOMER_POPULATION_GENERATOR_VERSION;

export type LifecycleState =
  | "prospect"
  | "abstract_recent_buyer"
  | "abstract_active_repeat"
  | "abstract_lapsing"
  | "abstract_dormant"
  | "abstract_subscriber";

export type DerivedCustomerSegment =
  | "new_or_prospect"
  | "returning_oriented"
  | "high_value"
  | "discount_sensitive"
  | "brand_loyal"
  | "category_enthusiast"
  | "gift_oriented"
  | "replenishment_oriented"
  | "low_intent_browser"
  | "advertising_resistant"
  | "mobile_dominant";

export interface LatentFactorState {
  readonly purchaseUrgency: number;
  readonly brandAttachment: number;
  readonly dealOrientation: number;
  readonly categoryInvolvement: number;
  readonly marketingReceptivity: number;
  readonly loyaltyTendency: number;
  readonly digitalBehavior: number;
  readonly explorationTendency: number;
}

export interface SparseCategoryPreference {
  readonly categoryId: string;
  readonly affinity: number;
}

export interface SparseProductPreference {
  readonly productId: string;
  readonly categoryId: string;
  readonly affinity: number;
}

export interface ChannelLatentTrait {
  readonly channelId: MarketingChannel;
  readonly merchantMechanismId: string;
  /**
   * Relative causal multiplier applied to the merchant-level channel effect
   * under the Step 3 calibration reference condition. Population weighted
   * mean is calibrated to 1. A merchant-level zero effect therefore remains
   * zero for every customer regardless of this multiplier.
   */
  readonly causalEffectMultiplier: number;
  /**
   * Natural propensity to select/use the channel absent the modeled
   * intervention. This is not a causal effect and is intentionally separate.
   */
  readonly naturalUseProbability: number;
}

export interface NaturalSelectionPropensities {
  readonly searchUseProbability: number;
  readonly brandedDirectProbability: number;
  readonly emailSubscriptionProbability: number;
  readonly promotionWaitingProbability: number;
  readonly retargetingEligibilityProbability: number;
}

export interface DevicePreference {
  readonly mobileProbability: number;
  readonly desktopProbability: number;
  readonly tabletProbability: number;
}

export interface LatentLifecycle {
  readonly state: LifecycleState;
  /**
   * Abstract pre-simulation history classification only. No event/order
   * history is created in Step 3.
   */
  readonly preSimulationHistory:
    | "none"
    | "abstract_existing_customer"
    | "abstract_subscriber";
}

export interface LatentCustomer {
  readonly customerId: string;
  /**
   * Number of statistically represented potential customers. Weight is 1
   * when the entire merchant population is explicit.
   */
  readonly populationWeight: number;

  readonly latentFactors: LatentFactorState;
  readonly purchaseIntent: number;
  readonly currentPurchaseNeed: number;
  readonly priceSensitivityMultiplier: number;
  readonly promotionSensitivityMultiplier: number;
  readonly brandAffinity: number;

  readonly categoryPreferences: readonly SparseCategoryPreference[];
  readonly productPreferences: readonly SparseProductPreference[];

  readonly channelTraits: readonly ChannelLatentTrait[];
  readonly naturalSelection: NaturalSelectionPropensities;
  readonly devicePreference: DevicePreference;

  readonly repeatPropensity: number;
  readonly expectedPurchaseIntervalDays: number;
  readonly annualPurchaseHazard: number;
  readonly expectedFuturePurchases: number;
  readonly expectedOrderValueMinor: number;
  readonly expectedLifetimeValueMinor: number;

  readonly lifecycle: LatentLifecycle;
  readonly derivedSegments: readonly DerivedCustomerSegment[];
}

export interface CustomerPopulationConfig {
  readonly maxExplicitAgents?: number;
  readonly complexity?: ComplexityLevel | "inherit";
  readonly maxCategoryPreferences?: number;
  readonly maxProductPreferences?: number;
  readonly calibrationTolerance?: number;
}

export interface CalibrationMetric {
  readonly metric:
    | "purchase_intent_mean"
    | "brand_affinity_mean"
    | "repeat_propensity_mean"
    | "mobile_share"
    | "purchase_interval_mean"
    | "future_purchases_mean"
    | "purchase_weighted_aov"
    | "expected_clv_mean"
    | "price_sensitivity_multiplier_mean"
    | "promotion_sensitivity_multiplier_mean"
    | `channel_effect_multiplier_mean:${string}`;
  readonly target: number;
  readonly implied: number;
  readonly absoluteError: number;
  readonly tolerance: number;
  readonly converged: boolean;
}

export interface PopulationCalibrationReport {
  readonly converged: boolean;
  readonly metrics: readonly CalibrationMetric[];
}

export interface CustomerPopulationProvenance {
  readonly generatorVersion: CustomerPopulationGeneratorVersion;
  readonly merchantWorldId: string;
  readonly merchantGeneratorVersion: string;
  readonly merchantGroundTruthSchemaVersion: "1.0.0";
  readonly merchantWorldSeed: number;
  readonly populationSeed: number;
  readonly populationConfig: CustomerPopulationConfig;
  readonly inheritedComplexity: ComplexityLevel;
}

export interface LatentCustomerPopulation {
  readonly schemaVersion: "1.0.0";
  readonly generatorVersion: CustomerPopulationGeneratorVersion;
  readonly merchantWorldId: string;
  readonly populationSeed: number;
  readonly representedCustomerCount: number;
  readonly explicitAgentCount: number;
  readonly weightedAgents: boolean;
  readonly customers: readonly LatentCustomer[];
  readonly calibration: PopulationCalibrationReport;
  readonly provenance: CustomerPopulationProvenance;
}

export interface CustomerPopulationRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly populationSeed: number;
  readonly populationConfig?: CustomerPopulationConfig;
}
