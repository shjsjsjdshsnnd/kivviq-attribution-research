import type {
  LatentCustomerPopulation,
} from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import type {
  Intervention,
} from "../ground_truth/interventions.js";
import type {
  EcommerceEconomicReport,
  EcommercePolicy,
  ProductEconomicProfile,
} from "../ecommerce_economics/types.js";
import type {
  PricingPromotionScenario,
} from "../pricing_promotions/runtime-types.js";
import type {
  ObservableSource,
  SimulationConfig,
} from "../simulation/types.js";
import type {
  PaidMarketingChannel,
} from "../advertising_economics/types.js";
import {
  RETENTION_LTV_VERSION,
  type RetentionLtvScenario,
  type TrueChurnState,
} from "./runtime-types.js";

export interface FutureValueDiscounting {
  readonly annualDiscountRate: number;
  readonly method: "continuous" | "simple";
  readonly timeUnit: "year";
}

export interface RetentionLtvEvaluationRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly simulationSeed: number;
  readonly periodStart: string;
  /**
   * Everything up to this timestamp is realized history.
   */
  readonly asOf: string;
  /**
   * God mode simulates through this timestamp for retention curves and
   * counterfactual validation. It is never treated as realized at asOf.
   */
  readonly simulationEnd: string;
  readonly retentionScenario?: RetentionLtvScenario;
  readonly clvHorizonsDays?: readonly number[];
  readonly expectedLifetimeHorizonDays?: number;
  readonly discounting?: FutureValueDiscounting;
  readonly interventions?: readonly Intervention[];
  readonly simulationConfig?: SimulationConfig;
  readonly ecommercePolicy?: Partial<EcommercePolicy>;
  readonly productEconomicsOverrides?: Readonly<
    Record<string, Partial<ProductEconomicProfile>>
  >;
  readonly advertisingSpendMinor?: number;
  readonly enableInventoryDynamics?: boolean;
  readonly pricingPromotionScenario?: PricingPromotionScenario;
}

export interface CustomerPurchaseLedgerEntry {
  readonly orderId: string;
  readonly occurredAt: string;
  readonly source: ObservableSource;
  readonly products: readonly string[];
  readonly categories: readonly string[];
  readonly grossRevenueMinor: number;
  readonly netRevenueMinor: number;
  readonly grossProfitMinor: number;
  readonly contributionProfitBeforeAdvertisingMinor: number;
  readonly returnsRefundsMinor: number;
  readonly repeatPurchase: boolean;
}

export interface ExpectedValueUncertainty {
  readonly method:
    "step11_poisson_hazard_product_mix_approximation";
  readonly expectedFutureOrders: number;
  readonly standardDeviationContributionMinor: number;
  readonly p10ContributionMinor: number;
  readonly p90ContributionMinor: number;
}

export interface CustomerClvHorizon {
  readonly horizonDays: number;
  readonly eligibleForFullFollowup: boolean;
  readonly realizedRevenueMinor: number;
  readonly realizedContributionMinor: number;
  readonly realizedRepeatContributionMinor: number;
}

export interface CustomerValueForecast {
  readonly horizonDays: number;
  readonly annualRepeatHazard: number;
  readonly expectedFutureOrders: number;
  readonly expectedFutureRevenueMinor: number;
  readonly expectedFutureContributionMinor: number;
  readonly discountedExpectedFutureContributionMinor: number;
  readonly expectedTotalLifetimeContributionMinor: number;
  readonly expectedRevenueLtvMinor: number;
  readonly uncertainty: ExpectedValueUncertainty;
}

export interface CustomerEconomicLedger {
  readonly customerId: string;
  readonly populationWeight: number;
  readonly origin:
    | "acquired_in_simulation"
    | "preexisting"
    | "never_purchased";
  readonly acquisitionTimestamp: string | null;
  readonly acquisitionSource: ObservableSource | null;
  readonly acquisitionPath: readonly ObservableSource[];
  readonly causalAcquisitionChannels: readonly MarketingChannel[];
  readonly firstPurchase: CustomerPurchaseLedgerEntry | null;
  readonly subsequentPurchases: readonly CustomerPurchaseLedgerEntry[];
  readonly realizedGrossRevenueMinor: number;
  readonly realizedNetRevenueMinor: number;
  readonly realizedCogsMinor: number;
  readonly realizedGrossProfitMinor: number;
  readonly realizedContributionProfitBeforeAdvertisingMinor: number;
  readonly realizedReturnsRefundsMinor: number;
  readonly repeatContributionMinor: number;
  /**
   * Cohort-average observed acquisition cost. Null when attribution of spend
   * to this acquisition source is not economically valid.
   */
  readonly observedAcquisitionCostMinor: number | null;
  readonly cumulativeRealizedContributionAfterObservedAcquisitionCostMinor:
    number;
  readonly lifecycleState: string;
  readonly trueChurnState: TrueChurnState | null;
  readonly estimatedLapseRisk: number;
  readonly clvByHorizon: readonly CustomerClvHorizon[];
  readonly expectedValue: CustomerValueForecast;
  /**
   * Future outcome realized in the synthetic God-mode path after asOf. This
   * is validation truth, not expected or realized-at-asOf value.
   */
  readonly oracleFutureRealizedContributionMinor: number;
}

export interface RetentionCurvePoint {
  readonly day: number;
  readonly eligibleCustomerWeight: number;
  readonly repeatPurchaseProbability: number | null;
  readonly activeCustomerProbability: number | null;
  readonly cumulativeRepeatOrders: number;
  readonly cumulativeRepeatRevenueMinor: number;
  readonly cumulativeContributionMinor: number;
}

export interface TimeToSecondPurchaseSummary {
  readonly representedCustomersWithSecondPurchase: number;
  readonly meanDays: number | null;
  readonly medianDays: number | null;
  readonly p90Days: number | null;
}

export type CohortDimension =
  | "acquisition_month"
  | "acquisition_channel"
  | "first_product"
  | "first_category"
  | "promotion_status"
  | "customer_segment"
  | "first_order_contribution_band";

export interface CustomerCohortSummary {
  readonly dimension: CohortDimension;
  readonly key: string;
  readonly representedCustomers: number;
  readonly repeatPurchaseProbability90d: number | null;
  readonly repeatPurchaseProbability365d: number | null;
  readonly averageFirstOrderContributionMinor: number;
  readonly averageRealized365dContributionMinor: number;
  readonly averageExpectedRemainingContributionMinor: number;
}

export interface AcquisitionChannelEconomics {
  readonly channel: ObservableSource;
  readonly paidChannel: boolean;
  readonly spendMinor: number | null;
  readonly representedAcquiredCustomers: number;
  readonly observedFirstOrderCacMinor: number | null;
  readonly firstOrderPlatformRoas: number | null;
  readonly firstOrderRevenueMinor: number;
  readonly firstOrderContributionMinor: number;
  readonly repeatContribution30dMinor: number;
  readonly repeatContribution90dMinor: number;
  readonly repeatContribution180dMinor: number;
  readonly repeatContribution365dMinor: number;
  readonly expectedRemainingContributionMinor: number;
  readonly expectedTotalContributionAfterObservedAcquisitionCostMinor: number;
  readonly causalTreatmentCustomerWeight: number;
}

export interface AcquisitionCounterfactualCustomerOutcome {
  readonly customerId: string;
  readonly populationWeight: number;
  readonly factualFirstPurchaseAt: string | null;
  readonly counterfactualFirstPurchaseAt: string | null;
  readonly wouldNeverHavePurchasedOtherwise: boolean;
  readonly wouldHavePurchasedLater: boolean;
  readonly wouldHavePurchasedThroughAnotherChannel: boolean;
  readonly wouldHavePurchasedSameProductAnyway: boolean;
  readonly interventionChangedOnlyTiming: boolean;
  readonly interventionChangedLongTermRelationship: boolean;
}

export interface AcquisitionChannelCounterfactual {
  readonly channel: PaidMarketingChannel;
  readonly factualSpendMinor: number;
  readonly counterfactualSpendMinor: number;
  readonly incrementalSpendMinor: number;
  readonly incrementalFirstOrders: number;
  readonly incrementalFirstOrderContributionMinor: number;
  readonly incrementalLongTermContributionBeforeAcquisitionCostMinor: number;
  readonly incrementalLongTermContributionAfterAcquisitionCostMinor: number;
  readonly incrementalExpectedRemainingContributionMinor: number;
  readonly trueIncrementalCustomerValueMinor: number;
  readonly outcomes: readonly AcquisitionCounterfactualCustomerOutcome[];
  readonly factual: RetentionLtvReport;
  readonly counterfactual: RetentionLtvReport;
  readonly godModeOnly: true;
}

export interface RetentionLtvReport {
  readonly version: typeof RETENTION_LTV_VERSION;
  readonly merchantWorldId: string;
  readonly periodStart: string;
  readonly asOf: string;
  readonly simulationEnd: string;
  readonly scenario: RetentionLtvScenario;
  readonly discounting: FutureValueDiscounting;
  readonly observedReport: EcommerceEconomicReport;
  readonly fullHorizonReport: EcommerceEconomicReport;
  readonly customerLedger: readonly CustomerEconomicLedger[];
  readonly retentionCurve: readonly RetentionCurvePoint[];
  readonly timeToSecondPurchase: TimeToSecondPurchaseSummary;
  readonly cohorts: readonly CustomerCohortSummary[];
  readonly acquisitionChannels: readonly AcquisitionChannelEconomics[];
  readonly godModeOnly: true;
}
