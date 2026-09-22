import type {
  MarketingChannel,
} from "../generation/config.js";

export const RETENTION_LTV_VERSION =
  "retention-ltv-11.0.0" as const;

export type RetentionLtvVersion =
  typeof RETENTION_LTV_VERSION;

export type TrueChurnState =
  | "active"
  | "latent_churned"
  | "permanent_churned";

export type LifecycleCampaignKind =
  | "welcome"
  | "post_purchase"
  | "replenishment"
  | "cross_sell"
  | "winback"
  | "loyalty"
  | "promotion";

export interface AcquisitionQualityEffect {
  /**
   * Multiplies future repeat-need hazard only when the acquisition channel had
   * a non-zero causal marketing effect before the first simulated purchase.
   * It is never applied from observed source alone.
   */
  readonly repeatHazardMultiplier: number;
  readonly brandAffinityDelta?: number;
  readonly promotionDependenceDelta?: number;
}

export interface LifecycleMarketingMechanism {
  readonly campaignId: string;
  readonly kind: LifecycleCampaignKind;
  readonly channel: MarketingChannel;
  readonly eligibleLifecycleStates?: readonly string[];
  readonly minimumDaysSincePurchase?: number;
  readonly maximumDaysSincePurchase?: number;
  readonly opportunityMultiplier: number;
  readonly causalResponseMultiplier?: number;
}

export interface RetentionExperienceMechanisms {
  /**
   * Explicit post-purchase affinity effect. Zero means a successful purchase
   * does not mechanically create loyalty.
   */
  readonly successfulPurchaseAffinityDelta?: number;
  /**
   * Applied only when a physical return is actually received.
   */
  readonly returnedPurchaseAffinityDelta?: number;
  /**
   * Applied only when an inventory stockout causes a merchant exit.
   */
  readonly stockoutMerchantExitAffinityDelta?: number;
}

export interface SubscriptionRetentionMechanism {
  readonly cancellationProbabilityPerRenewal: number;
  readonly skipProbabilityPerRenewal?: number;
  readonly failedRenewalProbability?: number;
  readonly failedRenewalRetryDays?: number;
}

export interface RetentionLtvScenario {
  readonly version: typeof RETENTION_LTV_VERSION;
  readonly source:
    | "step11_synthetic_default"
    | "step11_explicit_synthetic";
  readonly merchantRepeatHazardMultiplier?: number;
  readonly loyalPurchaseThreshold?: number;
  readonly lapseAfterExpectedIntervals?: number;
  readonly dormantAfterExpectedIntervals?: number;
  readonly latentChurnAfterExpectedIntervals?: number;
  /**
   * Null/undefined means non-subscription churn remains latent/reversible.
   */
  readonly permanentChurnAfterExpectedIntervals?: number | null;
  readonly reactivationHazardMultiplier?: number;
  readonly acquisitionQualityEffectsByChannel?: Readonly<
    Partial<Record<MarketingChannel, AcquisitionQualityEffect>>
  >;
  readonly lifecycleMarketing?: readonly LifecycleMarketingMechanism[];
  readonly experience?: RetentionExperienceMechanisms;
  readonly promotionDependencePerPromotedPurchase?: number;
  readonly subscription?: SubscriptionRetentionMechanism;
}

export interface RetentionRuntimeGodModeState {
  readonly finalBrandAffinity: number;
  readonly repeatHazardQualityMultiplier: number;
  readonly promotionDependenceShift: number;
  readonly trueChurnState: TrueChurnState;
  readonly reactivationCount: number;
  readonly ownedProductQuantities: Readonly<
    Record<string, number>
  >;
  readonly categoryFamiliarity: Readonly<
    Record<string, number>
  >;
  readonly causalAcquisitionChannels: readonly MarketingChannel[];
}
