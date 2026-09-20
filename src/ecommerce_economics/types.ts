import type { Intervention } from "../ground_truth/interventions.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type {
  RealizedPurchase,
  SimulationConfig,
  SimulationResult,
} from "../simulation/types.js";

export const ECOMMERCE_ECONOMICS_VERSION =
  "ecommerce-economics-7.0.0" as const;

export type DiscountKind =
  | "none"
  | "percentage"
  | "fixed"
  | "collection"
  | "sku"
  | "sitewide"
  | "coupon"
  | "bundle"
  | "customer_specific";

export interface ProductEconomicProfile {
  readonly productId: string;
  readonly categoryId: string;
  readonly listPriceMinor: number;
  readonly cogsPerUnitMinor: number;
  readonly grossMarginRate: number;
  readonly shippingCostPerUnitMinor: number;
  readonly fulfillmentCostPerUnitMinor: number;
  readonly returnProbability: number;
  readonly returnShippingCostMinor: number;
  readonly returnHandlingCostMinor: number;
  readonly restockingCostMinor: number;
  readonly nonRecoverableValueRate: number;
  readonly oversized: boolean;
  readonly promotionSensitivity: number;
  readonly substitutionProductIds: readonly string[];
  readonly complementaryProductIds: readonly string[];
}

export interface EcommercePolicy {
  readonly freeShippingThresholdMinor: number | null;
  readonly customerShippingChargeMinor: number;
  readonly paymentFeeRate: number;
  readonly paymentFeeFixedMinor: number;
  readonly variableOperatingCostPerOrderMinor: number;
  readonly variableOperatingCostRate: number;
  readonly giftWithPurchaseCostMinor: number;
  readonly loyaltyCreditRate: number;
  readonly couponOperationalCostMinor: number;
}

export interface OrderLineEconomics {
  readonly productId: string;
  readonly categoryId: string;
  readonly quantity: number;
  readonly listPriceMinor: number;
  readonly grossMerchandiseRevenueMinor: number;
  readonly discountMinor: number;
  readonly netSalesBeforeReturnsMinor: number;
  readonly cogsMinor: number;
  readonly grossProfitBeforeReturnsMinor: number;
  readonly shippingCostMinor: number;
  readonly fulfillmentCostMinor: number;
  readonly expectedReturnProbability: number;
}

export interface OrderEconomics {
  readonly orderId: string;
  readonly customerId: string;
  readonly occurredAt: string;
  readonly source: RealizedPurchase["source"];
  readonly repeatPurchase: boolean;
  readonly lines: readonly OrderLineEconomics[];

  readonly grossMerchandiseRevenueMinor: number;
  readonly discountsMinor: number;
  readonly revenueAfterDiscountsMinor: number;

  readonly realizedReturnsMinor: number;
  readonly realizedRefundsMinor: number;
  readonly netRevenueMinor: number;

  readonly cogsMinor: number;
  readonly grossProfitMinor: number;

  readonly paymentFeesMinor: number;
  readonly customerShippingRevenueMinor: number;
  readonly merchantShippingCostMinor: number;
  readonly shippingSubsidyMinor: number;
  readonly fulfillmentCostMinor: number;
  readonly variableOperatingCostsMinor: number;
  readonly promotionalCostsMinor: number;

  /**
   * Advertising is reconciled authoritatively at period level to avoid
   * double counting. This field is informational only and is always null.
   */
  readonly attributableAdvertisingCostMinor: null;

  readonly contributionProfitBeforeAdvertisingMinor: number;
}

export type ReturnDisposition =
  | "return_refund"
  | "partial_refund"
  | "non_return_refund";

export interface ReturnLineEconomics {
  readonly productId: string;
  readonly quantity: number;
  readonly refundedRevenueMinor: number;
  readonly recoveredCogsMinor: number;
  readonly returnShippingCostMinor: number;
  readonly returnHandlingCostMinor: number;
  readonly restockingCostMinor: number;
  readonly nonRecoverableInventoryCostMinor: number;
}

export interface ReturnEconomics {
  readonly returnId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly disposition: ReturnDisposition;
  readonly occurredAt: string;
  readonly lines: readonly ReturnLineEconomics[];
  readonly refundedRevenueMinor: number;
  readonly recoveredCogsMinor: number;
  readonly incrementalReturnCostsMinor: number;
  readonly contributionProfitImpactMinor: number;
}

export interface PeriodEconomicWaterfall {
  readonly currency: string;
  readonly grossMerchandiseRevenueMinor: number;
  readonly discountsMinor: number;
  readonly revenueAfterDiscountsMinor: number;
  readonly returnsRefundsMinor: number;
  readonly netRevenueMinor: number;
  readonly cogsMinor: number;
  readonly grossProfitMinor: number;
  readonly paymentFeesMinor: number;
  readonly customerShippingRevenueMinor: number;
  readonly merchantShippingCostMinor: number;
  readonly shippingSubsidyMinor: number;
  readonly fulfillmentCostMinor: number;
  readonly variableOperatingCostsMinor: number;
  readonly promotionalCostsMinor: number;
  readonly advertisingCostMinor: number;
  readonly contributionProfitMinor: number;
}

export interface CustomerEconomicSummary {
  readonly customerId: string;
  readonly customerType: "new" | "repeat";
  readonly realizedOrders: number;
  readonly realizedGrossRevenueMinor: number;
  readonly realizedNetRevenueMinor: number;
  readonly realizedGrossProfitMinor: number;
  readonly realizedContributionProfitBeforeAdvertisingMinor: number;
  readonly expectedFutureContributionMinor: number;
  readonly valuationHorizonDays: number;
  readonly expectedTotalEconomicValueMinor: number;
}

export interface NewCustomerEconomics {
  readonly representedNewCustomers: number;
  readonly firstOrderRevenueMinor: number;
  readonly firstOrderGrossProfitMinor: number;
  readonly firstOrderContributionProfitBeforeAdvertisingMinor: number;
  readonly acquisitionCostMinor: number;
  readonly expectedFutureContributionMinor: number;
  readonly expectedTotalEconomicValueMinor: number;
}

export interface RepeatCustomerEconomics {
  readonly representedRepeatOrders: number;
  readonly repeatRevenueMinor: number;
  readonly repeatGrossProfitMinor: number;
  readonly repeatContributionProfitBeforeAdvertisingMinor: number;
}

export interface EconomicDecompositionRow {
  readonly key: string;
  readonly orders: number;
  readonly units: number;
  readonly grossRevenueMinor: number;
  readonly netRevenueMinor: number;
  readonly grossProfitMinor: number;
  readonly contributionProfitBeforeAdvertisingMinor: number;
  readonly returnsRefundsMinor: number;
}

export interface EcommerceEconomicReport {
  readonly version: typeof ECOMMERCE_ECONOMICS_VERSION;
  readonly policy: EcommercePolicy;
  readonly productProfiles: readonly ProductEconomicProfile[];
  readonly orders: readonly OrderEconomics[];
  readonly returns: readonly ReturnEconomics[];
  readonly waterfall: PeriodEconomicWaterfall;
  readonly newCustomer: NewCustomerEconomics;
  readonly repeatCustomer: RepeatCustomerEconomics;
  readonly customerEconomics: readonly CustomerEconomicSummary[];
  readonly byProduct: readonly EconomicDecompositionRow[];
  readonly byCategory: readonly EconomicDecompositionRow[];
  readonly byCustomerType: readonly EconomicDecompositionRow[];
  readonly simulation: SimulationResult;
}

export interface EcommerceEvaluationRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly simulationSeed: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly interventions?: readonly Intervention[];
  readonly simulationConfig?: SimulationConfig;
  readonly policy?: Partial<EcommercePolicy>;
  readonly productEconomicsOverrides?: Readonly<
    Record<string, Partial<ProductEconomicProfile>>
  >;
  readonly advertisingSpendMinor?: number;
}

export interface EconomicCounterfactualDelta {
  readonly grossRevenueMinor: number;
  readonly netRevenueMinor: number;
  readonly grossProfitMinor: number;
  readonly contributionProfitMinor: number;
  readonly newCustomerContributionMinor: number;
  readonly repeatContributionMinor: number;
  readonly expectedFutureValueMinor: number;
}

export interface EconomicCounterfactualResult {
  readonly factual: EcommerceEconomicReport;
  readonly counterfactual: EcommerceEconomicReport;
  readonly delta: EconomicCounterfactualDelta;
}

export interface InventoryOpportunityCostResult {
  readonly productId: string;
  readonly scarceUnits: number;
  readonly immediateContributionMinor: number;
  readonly conservedInventoryContributionMinor: number;
  readonly counterfactualOpportunityCostMinor: number;
  readonly accountingAdjustmentMinor: 0;
}

export interface ChannelContributionEconomicResult {
  readonly channel: MarketingChannel;
  readonly incrementalGrossRevenueMinor: number;
  readonly incrementalNetRevenueMinor: number;
  readonly incrementalGrossProfitMinor: number;
  readonly incrementalContributionProfitMinor: number;
  readonly marginalIncrementalContributionProfitMinor: number | null;
}
