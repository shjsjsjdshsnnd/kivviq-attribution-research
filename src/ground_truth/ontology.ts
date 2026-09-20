import type {
  CausalEffectValue,
  CausalUnit,
  CurrencyCode,
  DurationSeconds,
  MoneyMinor,
  NonNegativeNumber,
  PositiveNumber,
  Probability,
  UtcTimestamp,
} from "../core/units.js";

export type WorldId = string;
export type MechanismId = string;
export type ChannelId = string;
export type ProductId = string;
export type CategoryId = string;
export type SegmentId = string;
export type CausalVariableId = string;

export type CustomerType = "new" | "existing";
export type DeviceType = "mobile" | "desktop" | "tablet";

export interface PopulationSelector {
  readonly segmentIds?: readonly SegmentId[];
  readonly productIds?: readonly ProductId[];
  readonly categoryIds?: readonly CategoryId[];
  readonly customerTypes?: readonly CustomerType[];
  readonly devices?: readonly DeviceType[];
}

export interface HeterogeneousModifier {
  readonly selector: PopulationSelector;
  readonly multiplier?: number;
  readonly probabilityPointChange?: number;
  readonly absoluteChange?: number;
}

export interface MerchantLatentParameters {
  readonly currency: CurrencyCode;
  readonly marketSize: PositiveNumber;
  readonly timezone: string;
  readonly baselineBrandAwareness: Probability;
  readonly baselineBrandPreference: Probability;
}

export interface CustomerGenerationParameters {
  readonly populationSize: PositiveNumber;
  readonly segmentShares: readonly {
    readonly segmentId: SegmentId;
    readonly probability: Probability;
  }[];
  readonly latentIntentDistribution: {
    readonly kind: "beta";
    readonly alpha: PositiveNumber;
    readonly beta: PositiveNumber;
  };
  readonly existingCustomerShare: Probability;
}

export type DemandComponent =
  | "latent"
  | "organic"
  | "brand"
  | "category"
  | "existing_customer"
  | "new_customer"
  | "product";

export interface BaselineDemandMechanism {
  readonly id: MechanismId;
  readonly component: DemandComponent;
  readonly outcome: "units" | "orders";
  readonly cadence: "hour" | "day" | "week";
  readonly baseRate: NonNegativeNumber;
  readonly paidMarketingIncluded: false;
  readonly selector?: PopulationSelector;
  readonly heterogeneity?: readonly HeterogeneousModifier[];
  readonly timeVarying: boolean;
}

export type ResponseCurve =
  | {
      readonly id: MechanismId;
      readonly kind: "linear";
      readonly inputUnit: "money_minor";
      readonly outputUnit: CausalUnit;
      readonly slopePerMoneyMinor: number;
      readonly maxSpend?: MoneyMinor;
    }
  | {
      readonly id: MechanismId;
      readonly kind: "hill";
      readonly inputUnit: "money_minor";
      readonly outputUnit: CausalUnit;
      readonly maxIncrementalOutcome: PositiveNumber;
      readonly halfSaturationSpend: MoneyMinor;
      readonly hillCoefficient: PositiveNumber;
    }
  | {
      readonly id: MechanismId;
      readonly kind: "threshold";
      readonly inputUnit: "money_minor";
      readonly outputUnit: CausalUnit;
      readonly thresholdSpend: MoneyMinor;
      readonly belowThresholdSlope: number;
      readonly aboveThresholdSlope: number;
      readonly maximumOutcome?: NonNegativeNumber;
    }
  | {
      readonly id: MechanismId;
      readonly kind: "piecewise";
      readonly inputUnit: "money_minor";
      readonly outputUnit: CausalUnit;
      readonly points: readonly {
        readonly spend: MoneyMinor;
        readonly outcome: number;
      }[];
    };

export interface DelayDistribution {
  readonly kind: "fixed" | "discrete";
  readonly fixedSeconds?: DurationSeconds;
  readonly values?: readonly {
    readonly seconds: DurationSeconds;
    readonly probability: Probability;
  }[];
}

export interface ChannelIncrementalityMechanism {
  readonly id: MechanismId;
  readonly channelId: ChannelId;
  readonly outcomeVariable: CausalVariableId;
  readonly effect: CausalEffectValue;
  readonly responseCurveId?: MechanismId;
  readonly delay?: DelayDistribution;
  readonly selector?: PopulationSelector;
  readonly heterogeneity?: readonly HeterogeneousModifier[];
  readonly saturationMechanismId?: MechanismId;
  readonly timeDependent: boolean;
}

export interface CACMechanism {
  readonly id: MechanismId;
  readonly channelId: ChannelId;
  readonly averageIncrementalCAC: MoneyMinor;
  readonly marginalCACCurveId: MechanismId;
  readonly definition: "incremental_new_customers_only";
}

export interface ConversionModifier {
  readonly condition:
    | "intent"
    | "segment"
    | "product"
    | "price"
    | "device"
    | "channel_exposure"
    | "journey_state"
    | "promotion"
    | "website_state"
    | "inventory"
    | "time"
    | "previous_purchase";
  readonly selector?: PopulationSelector;
  readonly multiplier?: number;
  readonly probabilityPointChange?: number;
}

export interface ConversionMechanism {
  readonly id: MechanismId;
  readonly outcome: "purchase" | "checkout" | "add_to_cart" | "product_view";
  readonly baseProbability: Probability;
  readonly modifiers: readonly ConversionModifier[];
}

export interface PriceElasticityMechanism {
  readonly id: MechanismId;
  readonly kind: "own_price" | "cross_price";
  readonly sourceProductId: ProductId;
  readonly targetProductId: ProductId;
  readonly relationship: "self" | "substitute" | "complement";
  readonly form: "constant" | "piecewise";
  readonly elasticity?: number;
  readonly points?: readonly {
    readonly relativePriceChange: number;
    readonly relativeDemandChange: number;
  }[];
  readonly selector?: PopulationSelector;
}

export type PromotionType =
  | "percentage_discount"
  | "fixed_discount"
  | "free_shipping"
  | "threshold"
  | "bundle"
  | "coupon"
  | "sitewide"
  | "collection";

export type PromotionOutcome =
  | "units"
  | "conversion_probability"
  | "aov"
  | "margin"
  | "purchase_timing"
  | "repeat_probability"
  | "channel_response";

export interface PromotionElasticityMechanism {
  readonly id: MechanismId;
  readonly promotionType: PromotionType;
  readonly selector?: PopulationSelector;
  readonly effects: readonly {
    readonly outcome: PromotionOutcome;
    readonly effect: CausalEffectValue;
  }[];
}

export interface CLVMechanism {
  readonly id: MechanismId;
  readonly horizonDays: PositiveNumber;
  readonly expectedFuturePurchases: NonNegativeNumber;
  readonly expectedGrossMarginMinor: MoneyMinor;
  readonly expectedDiscountsMinor: MoneyMinor;
  readonly expectedReturnsMinor: MoneyMinor;
  readonly expectedFulfillmentCostsMinor: MoneyMinor;
  readonly expectedAcquisitionCostsMinor?: MoneyMinor;
  readonly retentionProbability: Probability;
  readonly annualDiscountRate?: Probability;
  readonly selector?: PopulationSelector;
  readonly valueKind: "expected_future_value";
}

export interface RepeatPurchaseMechanism {
  readonly id: MechanismId;
  readonly baseRepeatProbability: Probability;
  readonly dependsOn: readonly (
    | "previous_purchases"
    | "product"
    | "category"
    | "acquisition_source"
    | "customer_type"
    | "satisfaction_state"
    | "promotion_exposure"
    | "elapsed_time"
    | "lifecycle_state"
  )[];
  readonly modifiers?: readonly HeterogeneousModifier[];
}

export interface ProductDemandMechanism {
  readonly id: MechanismId;
  readonly productId: ProductId;
  readonly categoryId: CategoryId;
  readonly baseLatentDemandUnits: NonNegativeNumber;
  readonly cadence: "hour" | "day" | "week";
  readonly segmentModifiers?: readonly HeterogeneousModifier[];
  readonly substitutionProductIds?: readonly ProductId[];
  readonly complementaryProductIds?: readonly ProductId[];
  readonly timeVarying: boolean;
}

export interface InventoryMechanism {
  readonly id: MechanismId;
  readonly productId: ProductId;
  readonly initialAvailableUnits: NonNegativeNumber;
  readonly initialReservedUnits: NonNegativeNumber;
  readonly replenishmentUnits: NonNegativeNumber;
  readonly replenishmentEverySeconds?: DurationSeconds;
  readonly supplierLeadTimeSeconds: DurationSeconds;
  readonly allowBackorders: boolean;
  readonly stockoutBehavior: "lost_demand" | "substitute" | "backorder";
  readonly substituteProductIds?: readonly ProductId[];
}

export interface SeasonalityMechanism {
  readonly id: MechanismId;
  readonly kind:
    | "weekday"
    | "week"
    | "month"
    | "quarter"
    | "holiday"
    | "annual"
    | "merchant_specific"
    | "product_specific";
  readonly selector?: PopulationSelector;
  readonly multipliers: readonly {
    readonly key: string;
    readonly multiplier: NonNegativeNumber;
  }[];
}

export interface DeviceEffectMechanism {
  readonly id: MechanismId;
  readonly device: DeviceType;
  readonly outcome:
    | "traffic"
    | "funnel_progression"
    | "conversion_probability"
    | "aov"
    | "channel_response";
  readonly effect: CausalEffectValue;
  readonly populationAdjusted: true;
}

export type FunnelState =
  | "impression"
  | "click"
  | "session"
  | "landing_page"
  | "collection"
  | "pdp"
  | "add_to_cart"
  | "checkout"
  | "purchase"
  | "exit";

export interface FunnelTransitionMechanism {
  readonly id: MechanismId;
  readonly from: FunnelState;
  readonly to: FunnelState;
  readonly baseProbability: Probability;
  readonly allowsReentry: boolean;
  readonly allowsMultipleSessions: boolean;
  readonly selector?: PopulationSelector;
  readonly modifiers?: readonly HeterogeneousModifier[];
}

export interface ChannelInteractionMechanism {
  readonly id: MechanismId;
  readonly channelIds: readonly ChannelId[];
  readonly kind: "synergy" | "cannibalization" | "mediation" | "zero" | "delayed";
  readonly functionalForm: "additive" | "multiplicative" | "nonlinear";
  readonly effect: CausalEffectValue;
  readonly delaySeconds?: DurationSeconds;
  readonly mediatorVariable?: CausalVariableId;
  readonly selector?: PopulationSelector;
}

export interface SaturationMechanism {
  readonly id: MechanismId;
  readonly channelId: ChannelId;
  readonly responseCurveId: MechanismId;
  readonly selector?: PopulationSelector;
  readonly finiteOptimalSpendPossible: true;
}

export interface OrganicDemandMechanism {
  readonly id: MechanismId;
  readonly counterfactualDefinition: "demand_without_modeled_paid_intervention";
  readonly baselineDemandMechanismIds: readonly MechanismId[];
}

export interface MarginEconomics {
  readonly currency: CurrencyCode;
  readonly accountingIdentity: "contribution_profit_v1";
  readonly includeVariableOperatingCosts: boolean;
}

export interface ContributionProfitInputs {
  readonly grossRevenueMinor: MoneyMinor;
  readonly discountsMinor: MoneyMinor;
  readonly returnsMinor: MoneyMinor;
  readonly cogsMinor: MoneyMinor;
  readonly paymentFeesMinor: MoneyMinor;
  readonly shippingSubsidyMinor: MoneyMinor;
  readonly fulfillmentCostsMinor: MoneyMinor;
  readonly variableOperatingCostsMinor: MoneyMinor;
  readonly marketingSpendMinor: MoneyMinor;
}

export interface ExternalShock {
  readonly id: string;
  readonly kind:
    | "competitor_promotion"
    | "economic_demand"
    | "weather"
    | "viral"
    | "platform_change"
    | "supplier_disruption"
    | "shipping_disruption"
    | "market_trend";
  readonly start: UtcTimestamp;
  readonly durationSeconds: DurationSeconds;
  readonly selector?: PopulationSelector;
  readonly affectedVariables: readonly CausalVariableId[];
  readonly mechanism: {
    readonly functionalForm: "additive" | "multiplicative" | "nonlinear";
    readonly effect: CausalEffectValue;
  };
}
