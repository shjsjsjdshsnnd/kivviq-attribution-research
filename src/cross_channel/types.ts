import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";
import type {
  CausalVariableId,
  PopulationSelector,
} from "../ground_truth/ontology.js";
import type { Intervention } from "../ground_truth/interventions.js";
import type { SimulationConfig, SimulationResult } from "../simulation/types.js";

export const CROSS_CHANNEL_VERSION =
  "cross-channel-interactions-6.0.0" as const;

export type ExecutableInteractionKind =
  | "mediation"
  | "synergy"
  | "cannibalization"
  | "substitution"
  | "audience_creation"
  | "audience_depletion"
  | "delayed"
  | "state_dependent"
  | "zero";

export type InteractionTargetSemantic =
  | "branded_search_probability"
  | "organic_visit_probability"
  | "direct_visit_probability"
  | "organic_direct_probability"
  | "channel_opportunity"
  | "channel_response"
  | "conversion_probability"
  | "retargeting_eligibility"
  | "email_eligibility"
  | "product_preference"
  | "future_customer_value";

export interface InteractionStateCondition {
  readonly promotionActive?: boolean;
  readonly minimumIntent?: number;
  readonly minimumAwareness?: number;
  readonly inventoryAvailabilityAtLeast?: number;
  readonly lifecycleStates?: readonly string[];
  readonly months?: readonly number[];
}

export interface CompiledInteractionRule {
  readonly mechanismId: string;
  readonly declaredKind:
    | "synergy"
    | "cannibalization"
    | "mediation"
    | "zero"
    | "delayed";
  readonly kind: ExecutableInteractionKind;
  readonly participantChannels: readonly MarketingChannel[];
  /**
   * Direction is explicit. The first channel is the causal driver for
   * asymmetric mechanisms; synergy/higher-order rules may require all
   * participant channels.
   */
  readonly driverChannels: readonly MarketingChannel[];
  readonly conditionedOnChannels: readonly MarketingChannel[];
  readonly targetChannels: readonly MarketingChannel[];
  readonly sourceVariableIds: readonly CausalVariableId[];
  readonly targetVariableIds: readonly CausalVariableId[];
  readonly targetSemantic: InteractionTargetSemantic;
  readonly mediatorVariable?: CausalVariableId;
  readonly effectScale:
    | "absolute"
    | "relative"
    | "multiplicative"
    | "log"
    | "probability_point"
    | "money_minor"
    | "units";
  readonly effectValue: number;
  readonly effectUnit: string;
  readonly functionalForm: "additive" | "multiplicative" | "nonlinear";
  readonly lagMs: number;
  readonly halfLifeMs: number;
  readonly selector?: PopulationSelector;
  readonly condition?: InteractionStateCondition;
  readonly higherOrder: boolean;
  readonly asymmetric: boolean;
  readonly provenance: {
    readonly groundTruthWorldId: string;
    readonly mechanismCollection: "channelInteractions";
    readonly mechanismId: string;
    readonly causalEdgeCount: number;
  };
}

export interface CrossChannelInteractionNetwork {
  readonly version: typeof CROSS_CHANNEL_VERSION;
  readonly merchantWorldId: string;
  readonly activeChannels: readonly MarketingChannel[];
  readonly rules: readonly CompiledInteractionRule[];
  readonly mechanismIds: readonly string[];
  readonly zeroInteractionMechanismIds: readonly string[];
  readonly maximumPossiblePairCount: number;
  readonly realizedNonZeroRuleCount: number;
  readonly sparsity: number;
}

export interface AudienceOverlapCell {
  readonly left: MarketingChannel;
  readonly right: MarketingChannel;
  readonly weightedOverlap: number;
  readonly jointReachPotential: number;
}

export interface AudienceOverlapMatrix {
  readonly merchantWorldId: string;
  readonly cells: readonly AudienceOverlapCell[];
}

export interface InteractionCausalTruth {
  readonly mechanismId: string;
  readonly customerId: string;
  readonly occurredAt: string;
  readonly kind: ExecutableInteractionKind;
  readonly participantChannels: readonly MarketingChannel[];
  readonly sourceVariableIds: readonly CausalVariableId[];
  readonly targetVariableIds: readonly CausalVariableId[];
  readonly targetSemantic: InteractionTargetSemantic;
  readonly baseEffect: number;
  readonly customerMultiplier: number;
  readonly stateMultiplier: number;
  readonly decayMultiplier: number;
  readonly appliedEffect: number;
  readonly lagMs: number;
}

export interface FutureAudienceSummary {
  readonly representedRetargetingEligible: number;
  readonly representedEmailEligible: number;
  readonly representedBrandedSearchReady: number;
  readonly representedRecentVisitors: number;
}

export interface SourceMetricDelta {
  readonly source: string;
  readonly sessionsDelta: number;
  readonly purchasesDelta: number;
  readonly attributedRevenueMinorDelta: number;
}

export interface PortfolioOutcome {
  readonly representedOrders: number;
  readonly representedRevenueMinor: number;
  readonly representedContributionProfitMinor: number;
  readonly representedNewCustomers: number;
  readonly platformAttributedRevenueMinor: number;
  readonly sourceMetrics: readonly SourceMetricDelta[];
  readonly futureAudience: FutureAudienceSummary;
}

export interface PortfolioEvaluationRequest {
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly simulationSeed: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly spendMinorByChannel: Readonly<
    Partial<Record<MarketingChannel, number>>
  >;
  readonly contextInterventions?: readonly Intervention[];
  readonly simulationConfig?: SimulationConfig;
}

export interface PortfolioEvaluation {
  readonly request: PortfolioEvaluationRequest;
  readonly simulation: SimulationResult;
  readonly outcome: PortfolioOutcome;
}

export interface PairwiseInteractionValue {
  readonly left: MarketingChannel;
  readonly right: MarketingChannel;
  readonly neither: PortfolioOutcome;
  readonly leftOnly: PortfolioOutcome;
  readonly rightOnly: PortfolioOutcome;
  readonly both: PortfolioOutcome;
  readonly interactionRevenueMinor: number;
  readonly interactionOrders: number;
  readonly interactionContributionProfitMinor: number;
  readonly interactionNewCustomers: number;
}

export interface ChannelRemovalEvaluation {
  readonly channel: MarketingChannel;
  readonly factual: PortfolioEvaluation;
  readonly removed: PortfolioEvaluation;
  readonly delta: PortfolioOutcome;
}

export interface ReallocationEvaluation {
  readonly factual: PortfolioEvaluation;
  readonly reallocated: PortfolioEvaluation;
  readonly delta: PortfolioOutcome;
  readonly spendDeltaByChannel: Readonly<
    Partial<Record<MarketingChannel, number>>
  >;
}

export interface HorizonEvaluation {
  readonly horizonDays: number;
  readonly evaluation: ReallocationEvaluation;
}

export interface InteractionDecomposition {
  readonly directLeftRevenueMinor: number;
  readonly directRightRevenueMinor: number;
  readonly interactionRevenueMinor: number;
  readonly totalJointRevenueMinor: number;
  /**
   * This is an exact observable-channel spillover counterfactual, not forced
   * causal attribution when structural decomposition is non-unique.
   */
  readonly observedMediatedRevenueShiftMinor: number;
}

export interface CrossChannelFixture {
  readonly id:
    | "zero_interaction_control"
    | "positive_synergy"
    | "cannibalization"
    | "mediation"
    | "interaction_reversal"
    | "portfolio_reallocation_trap"
    | "prospecting_cut_trap";
  readonly merchantWorld: GeneratedMerchantWorld;
  readonly latentPopulation: LatentCustomerPopulation;
  readonly simulationSeed: number;
}
