import type { EcommerceEvaluationRequest, EcommerceEconomicReport } from "../ecommerce_economics/types.js";
import type { InventoryDynamicsReport } from "../inventory_dynamics/types.js";
import type {
  AuthoritativePriceState,
  PricingPromotionScenario,
} from "./runtime-types.js";

export interface PricingPromotionEvaluationRequest
  extends Omit<
    EcommerceEvaluationRequest,
    "pricingPromotionScenario" | "enableInventoryDynamics"
  > {
  readonly scenario: PricingPromotionScenario;
  readonly enableInventoryDynamics?: true;
}

export interface IncrementalPromotionEconomics {
  readonly incrementalUnits: number;
  readonly incrementalOrders: number;
  readonly incrementalGrossRevenueMinor: number;
  readonly incrementalNetRevenueMinor: number;
  readonly incrementalGrossProfitMinor: number;
  readonly incrementalContributionProfitMinor: number;
  readonly incrementalNewCustomers: number;
  readonly incrementalFutureContributionMinor: number;
}

export interface PromotionAttributionDiagnostics {
  readonly purchasesDuringPromotion: number;
  readonly promotionExposedPurchases: number;
  readonly promotionRedemptionPurchases: number;
  readonly trueIncrementalPromotionPurchases: number;
  readonly acceleratedPurchases: number;
  readonly wouldHavePurchasedAnyway: number;
  readonly switchedProductPurchases: number;
  readonly discountCostOnIncrementalPurchasesMinor: number;
  readonly discountCostOnAcceleratedPurchasesMinor: number;
  readonly discountCostOnWouldHavePurchasedAnywayMinor: number;
  readonly discountCostOnSwitchedPurchasesMinor: number;
}

export interface PromotionResponseCurvePoint {
  readonly discountDepth: number;
  readonly representedUnits: number;
  readonly representedOrders: number;
  readonly grossRevenueMinor: number;
  readonly netRevenueMinor: number;
  readonly grossProfitMinor: number;
  readonly contributionProfitMinor: number;
  readonly inventoryConsumptionUnits: number;
  readonly expectedFutureContributionMinor: number;
}

export interface PriceResponseCurvePoint {
  readonly relativePriceChange: number;
  readonly priceMinor: number;
  readonly representedUnits: number;
  readonly representedOrders: number;
  readonly grossRevenueMinor: number;
  readonly grossProfitMinor: number;
  readonly contributionProfitMinor: number;
}

export interface OracleGridAnswer<TPoint> {
  readonly godModeOnly: true;
  readonly objective: "contribution_profit";
  readonly horizonStart: string;
  readonly horizonEnd: string;
  readonly evaluatedPoints: readonly TPoint[];
  readonly maximizingPoint: TPoint;
}

export interface ClearanceCounterfactual {
  readonly productId: string;
  readonly clearance: InventoryDynamicsReport;
  readonly waitForFullPrice: InventoryDynamicsReport;
  readonly immediateContributionDeltaMinor: number;
  readonly carryingCostDeltaMinor: number;
  readonly obsolescenceLossDeltaMinor: number;
  readonly horizonEconomicValueDeltaMinor: number;
}

export interface EventPromotionDecomposition {
  readonly eventDemandAndPromotion: EcommerceEconomicReport;
  readonly eventDemandWithoutMerchantPromotion: EcommerceEconomicReport;
  readonly baselineWithoutEventOrPromotion: EcommerceEconomicReport;
  readonly eventDemandEffectRevenueMinor: number;
  readonly merchantPromotionEffectRevenueMinor: number;
  readonly eventDemandEffectContributionMinor: number;
  readonly merchantPromotionEffectContributionMinor: number;
}

export interface PricingPromotionReport {
  readonly version: "pricing-promotions-10.0.0";
  readonly merchantWorldId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly authoritativePriceStates: readonly AuthoritativePriceState[];
  readonly factual: EcommerceEconomicReport;
  readonly noPromotionCounterfactual: EcommerceEconomicReport;
  readonly incremental: IncrementalPromotionEconomics;
  readonly attribution: PromotionAttributionDiagnostics;
  readonly godModeOnly: true;
}
