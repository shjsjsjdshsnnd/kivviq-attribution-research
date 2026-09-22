import type { Intervention } from "../ground_truth/interventions.js";
import type {
  ObservableSource,
  SimulationCommercePolicy,
  SimulationConfig,
  SimulationResult,
} from "../simulation/types.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { LatentCustomerPopulation } from "../customer_population/types.js";

export const WEBSITE_CRO_VERSION = "12.0.0" as const;

export type WebsiteDevice = "mobile" | "desktop" | "tablet";
export type WebsiteComponentName =
  | "homepage"
  | "navigation"
  | "collection"
  | "search"
  | "pdp"
  | "cart"
  | "checkout";

export type WebsiteFunnelTransition =
  | "landing_to_browse"
  | "browse_to_pdp"
  | "pdp_to_atc"
  | "atc_to_checkout"
  | "checkout_to_purchase";

export interface PagePerformance {
  readonly latencyMs: number;
  readonly loadSuccessProbability: number;
  readonly interactionDelayMs: number;
  readonly responsiveness: number;
  readonly assetWeightProxy: number;
}

export interface DevicePerformance {
  readonly mobile: PagePerformance;
  readonly desktop: PagePerformance;
  readonly tablet: PagePerformance;
}

export interface VersionedWebsiteComponent {
  readonly componentVersion: string;
  readonly performance: DevicePerformance;
}

export interface HomepageMechanism extends VersionedWebsiteComponent {
  readonly discoveryQuality: number;
  readonly merchandisingRelevance: number;
  readonly navigationClarity: number;
  readonly promotionalClarity: number;
  readonly visibility: number;
}

export interface NavigationMechanism extends VersionedWebsiteComponent {
  readonly categoryDiscoverability: number;
  readonly hierarchyClarity: number;
  readonly pathEfficiency: number;
  readonly mobileMenuUsability: number;
}

export interface CollectionMechanism extends VersionedWebsiteComponent {
  readonly rankingQuality: number;
  readonly filteringUsability: number;
  readonly sortingUsability: number;
  readonly productDensity: number;
  readonly relevance: number;
  readonly availabilityVisibility: number;
}

export interface SearchMechanism extends VersionedWebsiteComponent {
  /**
   * Availability/prominence of site-search entry points. This controls
   * search volume separately from what happens after a customer searches.
   */
  readonly entryPropensity: number;
  readonly relevance: number;
  readonly synonymCoverage: number;
  readonly zeroResultBaseProbability: number;
  readonly reformulationSupport: number;
  readonly alternativeDiscovery: number;
}

export interface PdpMechanism extends VersionedWebsiteComponent {
  readonly imageryQuality: number;
  readonly informationCompleteness: number;
  readonly priceClarity: number;
  readonly variantSelectionUsability: number;
  readonly inventoryClarity: number;
  readonly deliveryClarity: number;
  readonly trust: number;
  readonly socialProof: number;
  readonly ctaUsability: number;
  /**
   * Controls how much expensive purchases increase the need for information,
   * trust and delivery clarity. Zero means no price × PDP interaction.
   */
  readonly priceConfidenceSensitivity: number;
}

export interface CartMechanism extends VersionedWebsiteComponent {
  readonly clarity: number;
  readonly shippingVisibility: number;
  readonly promotionVisibility: number;
  readonly couponReliability: number;
  readonly couponExpectationProbability: number;
  readonly crossSellRelevance: number;
  readonly quantityEditingUsability: number;
  readonly persistenceProbability: number;
}

export interface CheckoutMechanism extends VersionedWebsiteComponent {
  readonly contactUsability: number;
  readonly shippingUsability: number;
  readonly paymentUsability: number;
  readonly reviewUsability: number;
  readonly formUsability: number;
  readonly mobileUsability: number;
  readonly accountRequirementFriction: number;
  readonly addressValidationReliability: number;
  readonly paymentReliability: number;
  readonly shippingCostVisibility:
    | "pdp"
    | "cart"
    | "checkout_shipping"
    | "checkout_review";
  readonly excessiveSteps: number;
  /**
   * Optional persistent affinity effect after a severe checkout experience.
   * Zero keeps website friction purely within-session.
   */
  readonly futureAffinityImpact: number;
}

export interface ProductPresentation {
  readonly productId: string;
  readonly collectionVisibility?: number;
  readonly searchability?: number;
  readonly imageryQuality?: number;
  readonly informationCompleteness?: number;
  readonly deliveryClarity?: number;
}

export interface CategoryWebsiteSensitivity {
  readonly categoryId: string;
  readonly imageryImportance: number;
  readonly informationImportance: number;
  readonly trustImportance: number;
  readonly deliveryImportance: number;
}

export interface WebsiteState {
  readonly versionId: string;
  readonly deployedAt: string;
  readonly homepage: HomepageMechanism;
  readonly navigation: NavigationMechanism;
  readonly collection: CollectionMechanism;
  readonly search: SearchMechanism;
  readonly pdp: PdpMechanism;
  readonly cart: CartMechanism;
  readonly checkout: CheckoutMechanism;
  readonly productPresentation?: readonly ProductPresentation[];
  readonly categorySensitivity?: readonly CategoryWebsiteSensitivity[];
}

export interface WebsiteScenario {
  readonly scenarioId: string;
  readonly states: readonly WebsiteState[];
  /**
   * Frozen Intervention contract reused for evaluator-only CRO interventions.
   * Website variables are validated by Step 12 because frozen earlier causal
   * graphs do not contain Step 12 nodes.
   */
  readonly interventions?: readonly Intervention[];
}

export type WebsiteFrictionKind =
  | "latency"
  | "load_failure"
  | "poor_navigation"
  | "poor_collection_ranking"
  | "search_relevance"
  | "zero_result_search"
  | "weak_imagery"
  | "missing_information"
  | "unclear_delivery"
  | "cart_friction"
  | "broken_coupon"
  | "checkout_friction"
  | "shipping_surprise"
  | "payment_failure"
  | "address_validation_failure";

export interface WebsiteCausalEvent {
  readonly eventId: string;
  readonly customerId: string;
  readonly sessionId: string;
  readonly occurredAt: string;
  readonly scenarioId: string;
  readonly websiteVersionId: string;
  readonly component: WebsiteComponentName;
  readonly componentVersion: string;
  readonly device: WebsiteDevice;
  readonly transition: WebsiteFunnelTransition;
  readonly friction: WebsiteFrictionKind;
  readonly probabilityMultiplier: number;
  readonly source?: ObservableSource;
  readonly productId?: string;
}

export interface WebsiteGodModeTruth {
  readonly version: typeof WEBSITE_CRO_VERSION;
  readonly godModeOnly: true;
  readonly scenarioId: string;
  readonly states: readonly WebsiteState[];
  readonly interventions: readonly Intervention[];
  readonly causalEvents: readonly WebsiteCausalEvent[];
}

export interface FunnelDiagnosticRow {
  readonly dimension: string;
  readonly visits: number;
  readonly landingContinuations: number;
  readonly collectionEngagements: number;
  readonly searchAttempts: number;
  readonly searchSuccesses: number;
  readonly pdpViews: number;
  readonly addToCarts: number;
  readonly checkoutStarts: number;
  readonly purchases: number;
  readonly landingContinuationRate: number | null;
  readonly searchSuccessRate: number | null;
  readonly pdpToAtcRate: number | null;
  readonly atcToCheckoutRate: number | null;
  readonly checkoutToPurchaseRate: number | null;
}

export interface FunnelAbandonmentByStage {
  readonly landing: number;
  readonly search: number;
  readonly pdp: number;
  readonly cart: number;
  readonly checkout: number;
}

export interface FunnelDiagnostics {
  readonly overall: FunnelDiagnosticRow;
  readonly byDevice: readonly FunnelDiagnosticRow[];
  readonly byChannel: readonly FunnelDiagnosticRow[];
  readonly byProduct: readonly FunnelDiagnosticRow[];
  readonly byCategory: readonly FunnelDiagnosticRow[];
  /**
   * Weighted observational drop-off counts. These describe where sessions
   * stopped; they are not causal bottleneck values.
   */
  readonly abandonmentByStage: FunnelAbandonmentByStage;
}

export interface CroCounterfactualDelta {
  readonly sessionsProgressing: number;
  readonly addToCarts: number;
  readonly checkoutStarts: number;
  readonly representedOrders: number;
  readonly representedRevenueMinor: number;
  readonly representedContributionProfitMinor: number;
}

export interface CroCounterfactualResult {
  readonly factual: SimulationResult;
  readonly counterfactual: SimulationResult;
  readonly delta: CroCounterfactualDelta;
}

export interface CroEvaluationRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly simulationSeed: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly websiteScenario: WebsiteScenario;
  readonly intervention: Intervention;
  /**
   * Non-CRO factual interventions (for example a promotion or a dated
   * marketing-mix change) are replayed identically in both arms.
   */
  readonly interventions?: readonly Intervention[];
  readonly commercePolicy?: Omit<
    SimulationCommercePolicy,
    "websiteScenario"
  >;
  readonly config?: SimulationConfig;
}

export interface CroOpportunityValue {
  readonly interventionVariable: string;
  readonly incrementalContributionProfitMinor: number;
  readonly incrementalRevenueMinor: number;
  readonly incrementalOrders: number;
}

export interface PageExperience {
  readonly component: WebsiteComponentName;
  readonly componentVersion: string;
  readonly websiteVersionId: string;
  readonly continuationMultiplier: number;
  readonly transitionMultiplier: number;
  readonly latencyMs: number;
  readonly interactionDelayMs: number;
  readonly loadFailureProbability: number;
  readonly frictions: readonly WebsiteFrictionKind[];
}

export interface CheckoutExperience {
  readonly componentVersion: string;
  readonly websiteVersionId: string;
  readonly completionMultiplier: number;
  readonly couponAttempted: boolean;
  readonly couponFailed: boolean;
  readonly paymentFailed: boolean;
  readonly addressValidationFailed: boolean;
  readonly shippingSurprise: boolean;
  readonly frictions: readonly WebsiteFrictionKind[];
  readonly futureAffinityImpact: number;
}

export interface WebsiteCustomerContext {
  readonly customerId: string;
  readonly intent: number;
  readonly need: number;
  readonly brandAffinity: number;
  readonly priceSensitivityMultiplier: number;
  readonly promotionSensitivityMultiplier: number;
  readonly purchaseCount: number;
}
