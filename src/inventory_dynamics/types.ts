import type { MarketingChannel } from "../generation/config.js";
import type { EcommerceEvaluationRequest } from "../ecommerce_economics/types.js";

export const INVENTORY_DYNAMICS_VERSION =
  "inventory-dynamics-9.0.0" as const;

export const DEFAULT_INVENTORY_LOCATION_ID = "primary" as const;

export type InventoryMovementType =
  | "opening_balance"
  | "reservation"
  | "reservation_released"
  | "commitment"
  | "sale"
  | "supplier_receipt"
  | "return_received"
  | "return_restocked"
  | "damage"
  | "write_off"
  | "explicit_adjustment"
  | "reorder_placed"
  | "shipment_dispatched"
  | "shipment_delayed"
  | "backorder_created"
  | "backorder_fulfilled"
  | "backorder_cancelled"
  | "stockout_started"
  | "stockout_ended";

export type ReorderPolicyKind =
  | "reorder_point"
  | "order_up_to"
  | "fixed_quantity";

export type ReorderState =
  | "idle"
  | "ordered"
  | "dispatched"
  | "delayed";

export type InventoryDemandDisposition =
  | "available"
  | "substituted"
  | "delayed"
  | "backordered"
  | "permanently_lost"
  | "merchant_exit";

export type InventoryCommerceOutcome =
  | "pending"
  | "purchased"
  | "abandoned";

export interface InventorySnapshot {
  readonly skuId: string;
  readonly productId: string;
  readonly variantId?: string;
  readonly locationId: string;
  readonly onHandUnits: number;
  readonly availableToSellUnits: number;
  readonly reservedUnits: number;
  readonly committedUnits: number;
  readonly damagedUnits: number;
  /**
   * Physical returned units awaiting inspection/restock. They are on-hand
   * but unavailable to sell and distinct from damaged stock.
   */
  readonly quarantinedReturnUnits: number;
  readonly inboundUnits: number;
  readonly backorderedUnits: number;
  readonly safetyStockUnits: number;
  readonly reorderPointUnits: number;
  readonly reorderState: ReorderState;
  readonly expectedArrivalAt?: string;
  readonly realizedArrivalAt?: string;
  readonly oldestInventoryReceivedAt: string;
  readonly carryingCostRatePerCogsValuePerDay: number;
  readonly obsolescenceRatePerDay: number;
}

export interface InventoryMovement {
  readonly movementId: string;
  readonly skuId: string;
  readonly productId: string;
  readonly occurredAt: string;
  readonly movementType: InventoryMovementType;
  readonly quantity: number;
  readonly sourceEventId: string;
  readonly before: InventorySnapshot;
  readonly after: InventorySnapshot;
}

export interface InventoryReservation {
  readonly reservationId: string;
  readonly skuId: string;
  readonly customerId: string;
  readonly sourceEventId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  quantity: number;
  active: boolean;
}

export interface BackorderObligation {
  readonly backorderId: string;
  readonly skuId: string;
  readonly customerId: string;
  readonly sourceEventId: string;
  readonly createdAt: string;
  readonly maximumAcceptableArrivalAt?: string;
  quantity: number;
  fulfilledUnits: number;
  cancelledUnits: number;
}

export interface InventoryReorder {
  readonly reorderId: string;
  readonly skuId: string;
  readonly placedAt: string;
  readonly quantity: number;
  readonly policyKind: ReorderPolicyKind;
  readonly expectedArrivalAt: string;
  realizedArrivalAt: string;
  dispatchedAt?: string;
  delayed: boolean;
  receivedUnits: number;
}

export interface InventoryReturnTruthRecord {
  readonly returnId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly skuId: string;
  readonly returnedUnits: number;
  readonly damagedUnits: number;
  readonly receivedAt: string;
  readonly restockAt?: string;
}

export interface InventoryDemandTruthRecord {
  readonly demandId: string;
  readonly customerId: string;
  readonly representedWeight: number;
  readonly occurredAt: string;
  readonly requestedSkuId: string;
  readonly requestedUnits: number;
  readonly inventoryDisposition: InventoryDemandDisposition;
  readonly fulfilledSkuId?: string;
  readonly substituteSkuId?: string;
  readonly expectedReplenishmentAt?: string;
  readonly sourceEventId: string;
  commerceOutcome: InventoryCommerceOutcome;
}

export interface MutableInventoryPosition {
  readonly skuId: string;
  readonly productId: string;
  readonly locationId: string;
  readonly variantId?: string;

  onHandUnits: number;
  reservedUnits: number;
  committedUnits: number;
  damagedUnits: number;
  quarantinedReturnUnits: number;
  inboundUnits: number;
  backorderedUnits: number;

  readonly openingOnHandUnits: number;
  readonly safetyStockUnits: number;
  readonly reorderPointUnits: number;
  readonly orderUpToLevelUnits: number;
  readonly fixedReorderQuantityUnits: number;
  readonly minimumOrderQuantityUnits: number;
  readonly reorderPolicyKind: ReorderPolicyKind;
  reorderState: ReorderState;

  readonly allowBackorders: boolean;
  readonly stockoutBehavior:
    | "lost_demand"
    | "substitute"
    | "backorder";
  readonly supplierLeadTimeDays: number;
  readonly maximumBackorderDelayDays?: number;

  expectedArrivalAt?: string;
  realizedArrivalAt?: string;

  readonly agingEnabled: boolean;
  oldestInventoryReceivedAtMs: number;
  readonly carryingCostRatePerCogsValuePerDay: number;
  readonly obsolescenceRatePerDay: number;

  cumulativeReceivedUnits: number;
  cumulativeReturnedUnits: number;
  cumulativeSoldUnits: number;
  cumulativeWriteOffUnits: number;
  cumulativeExplicitAdjustmentUnits: number;
  stockoutStartedAtMs?: number;
}

export interface InventoryEconomyRuntime {
  readonly version: typeof INVENTORY_DYNAMICS_VERSION;
  readonly positions: Map<string, MutableInventoryPosition>;
  readonly reservations: Map<string, InventoryReservation>;
  readonly backorders: Map<string, BackorderObligation>;
  readonly reorders: Map<string, InventoryReorder>;
  readonly ledger: InventoryMovement[];
  readonly demandTruth: InventoryDemandTruthRecord[];
  readonly returnTruth: InventoryReturnTruthRecord[];
  nextMovementOrdinal: number;
}

export interface InventoryReconciliation {
  readonly skuId: string;
  readonly openingOnHandUnits: number;
  readonly receivedUnits: number;
  readonly returnedUnits: number;
  readonly explicitAdjustmentUnits: number;
  readonly soldUnits: number;
  readonly writtenOffUnits: number;
  readonly expectedClosingOnHandUnits: number;
  readonly actualClosingOnHandUnits: number;
  readonly reconcilesExactly: boolean;
}

export interface InventoryGodModeTruth {
  readonly version: typeof INVENTORY_DYNAMICS_VERSION;
  readonly positions: readonly InventorySnapshot[];
  readonly ledger: readonly InventoryMovement[];
  readonly demandTruth: readonly InventoryDemandTruthRecord[];
  readonly returnTruth: readonly InventoryReturnTruthRecord[];
  readonly reservations: readonly InventoryReservation[];
  readonly backorders: readonly BackorderObligation[];
  readonly reorders: readonly InventoryReorder[];
  readonly reconciliation: readonly InventoryReconciliation[];
}

export type DaysOfCoverDemandBasis =
  | "baseline_unconstrained_latent"
  | "observed_fulfilled"
  | "forecast_blend";

export interface InventoryDaysOfCover {
  readonly demandBasis: DaysOfCoverDemandBasis;
  readonly demandUnitsPerDay: number;
  readonly daysOfCover: number | null;
}

export interface InventoryHealthRow {
  readonly skuId: string;
  readonly productId: string;
  readonly categoryId: string;
  readonly openingInventoryUnits: number;
  readonly closingOnHandUnits: number;
  readonly closingAvailableToSellUnits: number;
  readonly reservedUnits: number;
  readonly committedUnits: number;
  readonly damagedUnits: number;
  readonly quarantinedReturnUnits: number;
  readonly inboundUnits: number;
  readonly backorderedUnits: number;
  readonly safetyStockUnits: number;
  readonly reorderPointUnits: number;
  readonly reorderState: ReorderState;
  readonly expectedArrivalAt?: string;
  readonly realizedArrivalAt?: string;

  readonly latentDemandUnits: number;
  readonly fulfilledDemandUnits: number;
  readonly substitutedDemandUnits: number;
  readonly delayedDemandUnits: number;
  readonly backorderedDemandUnits: number;
  readonly permanentlyLostDemandUnits: number;
  readonly merchantExitDemandUnits: number;

  readonly daysOfCover: readonly InventoryDaysOfCover[];
  readonly lowStock: boolean;
  readonly excessStock: boolean;
  readonly experiencedStockout: boolean;
  readonly oldestInventoryAgeDays: number;
  readonly carryingCostMinor: number;
  readonly obsolescenceEconomicLossMinor: number;
  readonly markdownRiskProbability: number;
  readonly expectedMarkdownValueDragMinor: number;

  readonly inventoryBookValueMinor: number;
  readonly expectedRecoverableContributionMinor: number;
}

export interface CollectionInventoryHealth {
  readonly collectionId: string;
  readonly skuCount: number;
  readonly availableUnits: number;
  readonly inboundUnits: number;
  readonly backorderedUnits: number;
  readonly lowStockSkuCount: number;
  readonly excessStockSkuCount: number;
  readonly latentDemandUnits: number;
  readonly fulfilledDemandUnits: number;
  readonly lostDemandUnits: number;
  readonly expectedRecoverableContributionMinor: number;
}

export interface InventoryReturnDispositionSummary {
  readonly returnId: string;
  readonly skuId: string;
  readonly occurredAt: string;
  readonly returnedUnits: number;
  readonly sellableRestockUnits: number;
  readonly damagedUnits: number;
  readonly restockDelayDays: number;
}

export interface InventoryDynamicsReport {
  readonly version: typeof INVENTORY_DYNAMICS_VERSION;
  readonly merchantWorldId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly rows: readonly InventoryHealthRow[];
  readonly collectionHealth: readonly CollectionInventoryHealth[];
  readonly returnDispositions: readonly InventoryReturnDispositionSummary[];
  readonly ledger: readonly InventoryMovement[];
  readonly demandTruth: readonly InventoryDemandTruthRecord[];
  readonly reconciliation: readonly InventoryReconciliation[];
  readonly representedRevenueMinor: number;
  readonly baseContributionProfitMinor: number;
  readonly inventoryCarryingCostMinor: number;
  readonly contributionProfitAfterInventoryCarryingMinor: number;
  /**
   * Obsolescence is a change in recoverable inventory value, not realized
   * sales accounting, and is therefore reported separately.
   */
  readonly obsolescenceEconomicLossMinor: number;
  readonly godModeOnly: true;
}

export interface InventoryDynamicsEvaluationRequest
  extends EcommerceEvaluationRequest {
  readonly enableInventoryDynamics?: true;
}

export interface InventoryStockoutProbability {
  readonly skuId: string;
  readonly simulationCount: number;
  readonly stockoutCount: number;
  readonly trueSimulatedStockoutProbability: number;
}

export interface InventoryResponseCurvePoint {
  readonly spendMinor: number;
  readonly unconstrainedContributionProfitMinor: number;
  readonly inventoryConstrainedContributionProfitMinor: number;
  readonly unconstrainedRevenueMinor: number;
  readonly inventoryConstrainedRevenueMinor: number;
  readonly contributionConstraintCostMinor: number;
}

export interface InventoryResponseCurve {
  readonly channel: MarketingChannel;
  readonly points: readonly InventoryResponseCurvePoint[];
}

export interface LostSalesCounterfactual {
  readonly actual: InventoryDynamicsReport;
  readonly unconstrained: InventoryDynamicsReport;
  readonly latentLostUnits: number;
  readonly lostRevenueMinor: number;
  readonly lostContributionMinor: number;
  readonly substitutedUnits: number;
  readonly delayedUnits: number;
  readonly backorderedUnits: number;
}

export interface ReplenishmentCounterfactual {
  readonly skuId: string;
  readonly expectedLeadTimeDays: number;
  readonly delayedLeadTimeDays: number;
  readonly onTimeContributionProfitMinor: number;
  readonly delayedContributionProfitMinor: number;
  readonly delayContributionCostMinor: number;
  readonly onTimeLostUnits: number;
  readonly delayedLostUnits: number;
}

export interface PromotionStockoutCounterfactual {
  readonly shortWindowDays: number;
  readonly promotedShortWindowRevenueMinor: number;
  readonly fullPriceShortWindowRevenueMinor: number;
  readonly shortWindowRevenueLiftMinor: number;
  readonly promotedFullHorizonContributionMinor: number;
  readonly fullPriceFullHorizonContributionMinor: number;
  readonly fullHorizonContributionDeltaMinor: number;
}

export interface ScarceInventoryOpportunityCost {
  readonly skuId: string;
  readonly accountingContributionFromInterventionMinor: number;
  readonly counterfactualContributionWithoutInterventionMinor: number;
  readonly counterfactualOpportunityCostMinor: number;
}
