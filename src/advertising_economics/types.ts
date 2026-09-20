import type { MarketingChannel } from "../generation/config.js";
import type { SimulationResult } from "../simulation/types.js";

export const ADVERTISING_ECONOMICS_VERSION =
  "advertising-economics-5.0.0" as const;

export type PaidMarketingChannel =
  | "meta"
  | "google_search"
  | "google_shopping"
  | "pinterest"
  | "affiliate";

export interface AdvertisingAllocation {
  readonly spendMinorByChannel: Readonly<
    Partial<Record<PaidMarketingChannel, number>>
  >;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface AdvertisingDeliveryProfile {
  readonly channel: PaidMarketingChannel;
  readonly billingModel: "cpm" | "cpc";
  readonly unitCostMinor: number;
  readonly clickThroughRate: number;
  readonly reachablePopulationShare: number;
  readonly qualityDecayStrength: number;
  readonly frequencyPressure: number;
  readonly viewabilityRate: number;
  readonly retargetingLike: boolean;
  readonly upperFunnelLike: boolean;
}

export interface DeliveryOutcome {
  readonly channel: PaidMarketingChannel;
  readonly spendMinor: number;
  readonly eligiblePopulation: number;
  readonly billableUnits: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly uniqueReach: number;
  readonly reachFraction: number;
  readonly averageFrequency: number;
  readonly qualityIndex: number;
  readonly saturationIndex: number;
}

export interface AudienceComposition {
  readonly channel: PaidMarketingChannel;
  readonly reachedPopulationWeight: number;
  readonly meanPurchaseIntent: number;
  readonly meanNaturalUseProbability: number;
  readonly meanCausalSusceptibility: number;
  readonly meanExpectedLifetimeValueMinor: number;
}

export interface ResponseEvaluation {
  readonly spendMinor: number;
  readonly totalOutcome: number;
  readonly averageOutcomePerSpendMinor: number | null;
  readonly marginalOutcomePerSpendMinor: number | null;
}

export interface ChannelEconomicCurvePoint {
  readonly spendMinor: number;
  readonly expectedIncrementalOrders: number;
  readonly expectedIncrementalRevenueMinor: number;
  readonly expectedIncrementalContributionProfitMinor: number;
  readonly averageIncrementalRoas: number | null;
  readonly marginalIncrementalRoas: number | null;
  readonly averageIncrementalCacMinor: number | null;
  readonly marginalIncrementalCacMinor: number | null;
}

export interface ChannelEconomicCurve {
  readonly channel: PaidMarketingChannel;
  readonly responseCurveId: string;
  readonly points: readonly ChannelEconomicCurvePoint[];
  readonly saturationSpendMinor: number | null;
  readonly breakEvenRevenueRoas: number | null;
  readonly contributionProfitMaximizingSpendMinor: number | null;
  readonly maximumEconomicallyRationalSpendMinor: number | null;
}

export type AttributionTouchKind =
  | "click_like"
  | "view_through"
  | "owned_open";

export interface SyntheticPlatformAttributionRule {
  readonly channel: PaidMarketingChannel;
  readonly clickWindowDays: number;
  readonly viewWindowDays: number;
  readonly allowViewThrough: boolean;
  readonly claimFullRevenue: boolean;
  readonly retargetingBias: number;
  readonly brandedSearchBias?: number;
}

export interface PlatformAttributedPurchaseClaim {
  readonly channel: PaidMarketingChannel;
  readonly orderId: string;
  readonly customerId: string;
  readonly attributedRevenueMinor: number;
  readonly touchKind: AttributionTouchKind;
  readonly touchOccurredAt: string;
  readonly purchaseOccurredAt: string;
  readonly searchClass?: "brand" | "nonbrand";
}

export interface PlatformChannelReport {
  readonly channel: PaidMarketingChannel;
  readonly spendMinor: number;
  readonly attributedOrders: number;
  readonly attributedRevenueMinor: number;
  readonly reportedRoas: number | null;
  readonly reportedCacMinor: number | null;
  readonly claims: readonly PlatformAttributedPurchaseClaim[];
}

export interface ObservedChannelPerformance {
  readonly channel: PaidMarketingChannel;
  readonly spendMinor: number;
  readonly touchAssociatedBuyers: number;
  readonly touchAssociatedRevenueMinor: number;
  readonly observedRoas: number | null;
  readonly observedCacMinor: number | null;
}

export interface TrueIncrementalPerformance {
  readonly channel: PaidMarketingChannel;
  readonly highSpendMinor: number;
  readonly lowSpendMinor: number;
  readonly incrementalSpendMinor: number;
  readonly incrementalOrders: number;
  readonly incrementalGrossRevenueMinor: number;
  readonly incrementalRevenueMinor: number;
  readonly incrementalGrossProfitMinor: number;
  readonly incrementalContributionProfitMinor: number;
  readonly trueIncrementalRoas: number | null;
  readonly incrementalCacMinor: number | null;
}

export interface MarginalIncrementalPerformance
  extends TrueIncrementalPerformance {
  readonly referenceSpendMinor: number;
  readonly evaluatedBlockMinor: number;
}

export interface AdvertisingPerformanceRow {
  readonly channel: PaidMarketingChannel;
  readonly spendMinor: number;
  readonly delivery: DeliveryOutcome;
  readonly audience: AudienceComposition;
  readonly platformAttributedRevenueMinor: number;
  readonly platformRoas: number | null;
  readonly platformReportedCacMinor: number | null;
  readonly observedTouchRevenueMinor: number;
  readonly observedRoas: number | null;
  readonly observedCacMinor: number | null;
  readonly trueIncrementalGrossRevenueMinor: number;
  readonly trueIncrementalRevenueMinor: number;
  readonly trueIncrementalGrossProfitMinor: number;
  readonly trueIncrementalRoas: number | null;
  readonly marginalIncrementalRoas: number | null;
  readonly averageIncrementalCacMinor: number | null;
  readonly marginalIncrementalCacMinor: number | null;
  readonly incrementalContributionProfitMinor: number;
}

export interface AdvertisingPerformanceReport {
  readonly version: typeof ADVERTISING_ECONOMICS_VERSION;
  readonly allocation: AdvertisingAllocation;
  readonly rows: readonly AdvertisingPerformanceRow[];
  readonly merchantRevenueMinor: number;
  readonly totalPlatformAttributedRevenueMinor: number;
  readonly duplicateClaimExcessRevenueMinor: number;
  readonly simulation: SimulationResult;
}

export interface AdvertisingEvaluationRequest {
  readonly merchantWorld: import("../generation/config.js").GeneratedMerchantWorld;
  readonly latentPopulation: import("../customer_population/types.js").LatentCustomerPopulation;
  readonly simulationSeed: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly spendMinorByChannel?: Readonly<
    Partial<Record<PaidMarketingChannel, number>>
  >;
  readonly marginalBlockMinor?: number;
  readonly simulationConfig?: import("../simulation/types.js").SimulationConfig;
  readonly contextInterventions?: readonly import("../ground_truth/interventions.js").Intervention[];
}

export interface ChannelSpendEvaluationRequest
  extends AdvertisingEvaluationRequest {
  readonly channel: PaidMarketingChannel;
  readonly highSpendMinor: number;
  readonly lowSpendMinor: number;
}

export interface SpendCounterfactualPair {
  readonly high: SimulationResult;
  readonly low: SimulationResult;
  readonly highSpendMinor: number;
  readonly lowSpendMinor: number;
  readonly totalHighAllocationSpendMinor: number;
  readonly totalLowAllocationSpendMinor: number;
}

export function isPaidMarketingChannel(
  channel: MarketingChannel | string,
): channel is PaidMarketingChannel {
  return (
    channel === "meta" ||
    channel === "google_search" ||
    channel === "google_shopping" ||
    channel === "pinterest" ||
    channel === "affiliate"
  );
}
