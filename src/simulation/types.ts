import type { Intervention } from "../ground_truth/interventions.js";
import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { RuntimeLifecycleState } from "./state.js";
import type { InventoryGodModeTruth } from "../inventory_dynamics/types.js";
import type { PricingPromotionScenario } from "../pricing_promotions/runtime-types.js";

export type ObservableJourneyEventKind =
  | "impression"
  | "email_open"
  | "sms_open"
  | "search"
  | "visit"
  | "session_start"
  | "landing_page_view"
  | "collection_view"
  | "site_search"
  | "product_view"
  | "add_to_cart"
  | "remove_from_cart"
  | "checkout_start"
  | "checkout_abandon"
  | "purchase"
  | "session_end";

export type ObservableSource =
  | MarketingChannel
  | "organic_search"
  | "direct"
  | "referral";

export type SearchIntentType =
  | "branded"
  | "category"
  | "product";

export interface PerfectObservableJourneyEvent {
  readonly eventId: string;
  readonly eventType: ObservableJourneyEventKind;
  readonly occurredAt: string;
  readonly anonymousSubjectId: string;
  readonly sessionId?: string;
  readonly source?: ObservableSource;
  readonly channel?: MarketingChannel;
  readonly device?: "mobile" | "desktop" | "tablet";
  readonly landingType?:
    | "homepage"
    | "collection"
    | "pdp"
    | "campaign"
    | "search_results";
  readonly searchIntent?: SearchIntentType;
  readonly productId?: string;
  readonly orderId?: string;
  readonly quantity?: number;
  readonly amountMinor?: number;
  readonly discountMinor?: number;
}

export interface PurchaseLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly discountMinor: number;
  readonly revenueMinor: number;
  readonly estimatedCogsMinor: number;
  readonly fulfillmentMinor: number;
  /**
   * Step 10 promotion identity and explicitly causal return response.
   * Omitted on frozen Step 1-9 execution paths.
   */
  readonly promotionIds?: readonly string[];
  readonly returnProbabilityMultiplier?: number;
}

export interface RealizedPurchase {
  readonly orderId: string;
  readonly customerId: string;
  readonly sessionId: string;
  readonly occurredAt: string;
  readonly source: ObservableSource;
  readonly lines: readonly PurchaseLine[];
  readonly grossRevenueMinor: number;
  readonly discountMinor: number;
  readonly netRevenueMinor: number;
  readonly paymentFeeMinor: number;
  readonly shippingSubsidyMinor: number;
  readonly fulfillmentMinor: number;
  readonly estimatedCogsMinor: number;
  readonly allocatedMarketingSpendMinor: number;
  readonly contributionProfitMinor: number;
  readonly repeatPurchase: boolean;
  /**
   * Step 10 order-specific shipping terms. Absent means Step 7 policy applies.
   */
  readonly customerShippingChargeOverrideMinor?: number;
  readonly freeShippingPromotionIds?: readonly string[];
}

export type CausalEffectKind =
  | "awareness"
  | "consideration"
  | "purchase_probability"
  | "product_preference"
  | "timing"
  | "interaction";

export interface ExposureCausalTruth {
  readonly exposureEventId: string;
  readonly customerId: string;
  readonly channelId: MarketingChannel;
  readonly occurredAt: string;
  readonly merchantEffect: number;
  readonly customerMultiplier: number;
  readonly appliedEffect: number;
  readonly effectKinds: readonly CausalEffectKind[];
  readonly delayMs: number;
  readonly halfLifeMs: number;
  readonly zeroEffect: boolean;
}

export interface PurchaseCausalTruth {
  readonly orderId: string;
  readonly customerId: string;
  readonly observablePath: readonly ObservableSource[];
  readonly causalChannels: readonly MarketingChannel[];
  readonly zeroEffectExposures: readonly MarketingChannel[];
  readonly purchaseProbabilityLiftAtPurchase: number;
}

export interface CustomerFinalStateSummary {
  readonly customerId: string;
  readonly lifecycle: RuntimeLifecycleState;
  readonly purchaseCount: number;
  readonly finalNeed: number;
  readonly finalIntent: number;
  readonly finalAwareness: number;
  readonly finalConsideration: number;
  readonly finalRetargetingEligibility: number;
  readonly finalEmailEligibility: number;
  readonly finalBrandedSearchReadiness: number;
  readonly finalRecentSiteVisitScore: number;
  readonly interactionMemory: readonly {
    readonly mechanismId: string;
    readonly value: number;
  }[];
  readonly churned: boolean;
}

export interface InteractionCausalTruthRecord {
  readonly mechanismId: string;
  readonly customerId: string;
  readonly occurredAt: string;
  readonly kind:
    | "mediation"
    | "synergy"
    | "cannibalization"
    | "substitution"
    | "audience_creation"
    | "audience_depletion"
    | "delayed"
    | "state_dependent"
    | "zero";
  readonly participantChannels: readonly MarketingChannel[];
  readonly sourceVariableIds: readonly string[];
  readonly targetVariableIds: readonly string[];
  readonly targetSemantic: string;
  readonly baseEffect: number;
  readonly customerMultiplier: number;
  readonly stateMultiplier: number;
  readonly decayMultiplier: number;
  readonly appliedEffect: number;
  readonly lagMs: number;
}

export interface GodModeSimulationTruth {
  readonly exposureEffects: readonly ExposureCausalTruth[];
  readonly interactionEffects: readonly InteractionCausalTruthRecord[];
  readonly purchaseTruth: readonly PurchaseCausalTruth[];
  readonly customerFinalStates: readonly CustomerFinalStateSummary[];
  /**
   * Step 9 evaluator-only inventory truth. It is deliberately nested under
   * godMode and is never exported by the Operator-safe root API.
   */
  readonly inventory?: InventoryGodModeTruth;
}

export interface PlatformStyleChannelMetric {
  readonly channel: ObservableSource;
  readonly exposures: number;
  readonly sessions: number;
  readonly purchases: number;
  readonly attributedRevenueMinor: number;
  readonly observedPurchaseRateAfterTouch: number;
}

export interface SimulationTotals {
  readonly representedPurchases: number;
  readonly representedOrders: number;
  readonly representedRevenueMinor: number;
  readonly representedContributionProfitMinor: number;
  readonly observableEventCount: number;
}

export interface SimulationProvenance {
  readonly simulatorVersion: string;
  readonly merchantWorldId: string;
  readonly merchantWorldSeed: number;
  readonly customerPopulationSeed: number;
  readonly simulationSeed: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly interventions: readonly Intervention[];
  readonly sharedRandomness: true;
}

export interface SimulationResult {
  readonly observableEvents: readonly PerfectObservableJourneyEvent[];
  readonly purchases: readonly RealizedPurchase[];
  readonly platformMetrics: readonly PlatformStyleChannelMetric[];
  readonly totals: SimulationTotals;
  readonly godMode: GodModeSimulationTruth;
  readonly provenance: SimulationProvenance;
}

export interface SimulationCommercePolicy {
  readonly freeShippingThresholdMinor?: number | null;
  readonly customerShippingChargeMinor?: number;
  readonly enableProductRelationships?: boolean;
  readonly enableEnhancedBasketEconomics?: boolean;
  readonly executeInventoryLifecycle?: boolean;
  /**
   * Opt-in Step 9 semantics. Default false preserves frozen Step 1-8
   * deterministic behavior and acceptance outputs.
   */
  readonly enableInventoryDynamics?: boolean;
  readonly inventoryReservationTimeoutMinutes?: number;
  /**
   * Opt-in Step 10 causal pricing/promotion sidecar. It is not part of the
   * frozen GroundTruth schema and is never exposed through the Operator root.
   */
  readonly pricingPromotionScenario?: PricingPromotionScenario;
  /**
   * Step 9 physical-return parameters are supplied by the Step 7 economic
   * profiles so inventory and return accounting use the same product truth.
   */
  readonly inventoryReturnProfiles?: Readonly<
    Record<
      string,
      {
        readonly returnProbability: number;
        readonly nonRecoverableValueRate: number;
        readonly oversized: boolean;
      }
    >
  >;
}

export interface SimulateWorldRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly simulationSeed: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly interventions?: readonly Intervention[];
  readonly commercePolicy?: SimulationCommercePolicy;
  readonly config?: SimulationConfig;
}

export interface SimulationConfig {
  readonly maxEvents?: number;
  readonly maxSessionsPerCustomer?: number;
  readonly maxStepsPerSession?: number;
  readonly opportunityCadenceHours?: number;
  readonly lifecycleCheckDays?: number;
}

export interface CounterfactualReplayRequest
  extends Omit<SimulateWorldRequest, "interventions"> {
  readonly interventions: readonly Intervention[];
}

export interface CounterfactualReplayResult {
  readonly factual: SimulationResult;
  readonly counterfactual: SimulationResult;
  readonly delta: {
    readonly representedOrders: number;
    readonly representedRevenueMinor: number;
    readonly representedContributionProfitMinor: number;
  };
  readonly individualPurchaseChanges: readonly {
    readonly customerId: string;
    readonly factualPurchases: number;
    readonly counterfactualPurchases: number;
    readonly factualRevenueMinor: number;
    readonly counterfactualRevenueMinor: number;
  }[];
}
