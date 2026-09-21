import type { CurrencyCode, UtcTimestamp } from "../core/units.js";

export const ACTION_ONTOLOGY_VERSION = "1.0.0" as const;
export const ACTION_ONTOLOGY_MAJOR_VERSION = 1 as const;

export const ACTION_CATEGORIES = [
  "paid_media",
  "pricing",
  "promotions",
  "merchandising",
  "inventory",
  "product",
  "website_cro",
  "email_sms_crm",
  "customer_segmentation",
  "retention",
  "acquisition",
  "shipping_fulfillment",
] as const;

export type CoreActionCategory = (typeof ACTION_CATEGORIES)[number];
export type ActionCategory = CoreActionCategory | (string & {});

export const ACTION_STATES = [
  "PROPOSED",
  "ACCEPTED",
  "REJECTED",
  "SCHEDULED",
  "IMPLEMENTED",
  "ACTIVE",
  "COMPLETED",
  "REVERSED",
  "CANCELLED",
  "FAILED",
] as const;

export type ActionState = (typeof ACTION_STATES)[number];
export type ActionAtomicity = "ATOMIC" | "COMPOUND";

export type KnowledgeStatus =
  | "known"
  | "estimated"
  | "bounded"
  | "unknown"
  | "not_applicable";

export type ValueProvenance =
  | "merchant_fact"
  | "operator_input"
  | "modeled_estimate"
  | "assumption"
  | "derived"
  | "unknown"
  | "not_applicable";

export type KnowledgeValue<T> =
  | {
      readonly status: "known";
      readonly value: T;
      readonly provenance: ValueProvenance;
      readonly sourceRef?: string;
    }
  | {
      readonly status: "estimated";
      readonly value: T;
      readonly provenance: ValueProvenance;
      readonly sourceRef?: string;
      readonly confidence?: number;
    }
  | {
      readonly status: "bounded";
      readonly lower?: T;
      readonly upper?: T;
      readonly provenance: ValueProvenance;
      readonly sourceRef?: string;
    }
  | {
      readonly status: "unknown";
      readonly provenance: "unknown";
      readonly reason?: string;
    }
  | {
      readonly status: "not_applicable";
      readonly provenance: "not_applicable";
      readonly reason?: string;
    };

export interface MonetaryAmount {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export type PercentageSemantics =
  | "relative_change"
  | "absolute_share"
  | "percentage_points"
  | "discount_rate"
  | "margin_rate";

export interface PercentageValue {
  /** 100 basis points = 1 percentage point. Direction belongs to the operation. */
  readonly basisPoints: number;
  readonly semantics: PercentageSemantics;
}

export type AtomicActionTarget =
  | {
      readonly kind: "advertising_channel";
      readonly channelId: string;
    }
  | {
      readonly kind: "campaign";
      readonly campaignId: string;
      readonly channelId?: string;
    }
  | {
      readonly kind: "ad_set";
      readonly adSetId: string;
      readonly campaignId?: string;
    }
  | {
      readonly kind: "ad";
      readonly adId: string;
      readonly adSetId?: string;
    }
  | {
      readonly kind: "audience";
      readonly audienceId: string;
    }
  | {
      readonly kind: "product";
      readonly productId: string;
    }
  | {
      readonly kind: "sku";
      readonly skuId: string;
      readonly productId?: string;
    }
  | {
      readonly kind: "collection";
      readonly collectionId: string;
    }
  | {
      readonly kind: "landing_page";
      readonly landingPageId: string;
    }
  | {
      readonly kind: "price";
      readonly productId: string;
      readonly skuId?: string;
      readonly priceListId?: string;
    }
  | {
      readonly kind: "promotion";
      readonly promotionId: string;
    }
  | {
      readonly kind: "inventory";
      readonly skuId: string;
      readonly locationId?: string;
    }
  | {
      readonly kind: "email_campaign";
      readonly emailCampaignId: string;
    }
  | {
      readonly kind: "email_flow";
      readonly emailFlowId: string;
    }
  | {
      readonly kind: "customer_segment";
      readonly segmentId: string;
    }
  | {
      readonly kind: "merchandising_placement";
      readonly collectionId: string;
      readonly productId: string;
    }
  | {
      readonly kind: "shipping_policy";
      readonly shippingPolicyId: string;
    };

export interface CompoundActionTarget {
  readonly kind: "compound";
  readonly targets: readonly AtomicActionTarget[];
}

export type ActionTarget = AtomicActionTarget | CompoundActionTarget;

export type ParameterValue =
  | {
      readonly kind: "money";
      readonly amountMinor: number;
      readonly currency: CurrencyCode;
    }
  | {
      readonly kind: "money_rate";
      readonly amountMinor: number;
      readonly currency: CurrencyCode;
      readonly per: "day" | "week" | "month";
    }
  | {
      readonly kind: "percentage";
      readonly basisPoints: number;
      readonly semantics: PercentageSemantics;
    }
  | {
      readonly kind: "number";
      readonly value: number;
      readonly unit: string;
    }
  | {
      readonly kind: "boolean";
      readonly value: boolean;
    }
  | {
      readonly kind: "string";
      readonly value: string;
    }
  | {
      readonly kind: "frequency";
      readonly value: number;
      readonly per: "day" | "week" | "month";
    }
  | {
      readonly kind: "position";
      readonly value: number;
    }
  | {
      readonly kind: "target";
      readonly target: AtomicActionTarget;
    }
  | {
      readonly kind: "action_reference";
      readonly actionId: string;
    };

export type ParameterMode =
  | "SET"
  | "INCREASE_BY"
  | "DECREASE_BY"
  | "INCREASE_BY_PERCENT"
  | "DECREASE_BY_PERCENT"
  | "PAUSE"
  | "RESUME"
  | "APPLY"
  | "REMOVE"
  | "MOVE_TO"
  | "REVERSE";

export interface ActionParameter {
  readonly parameterId: string;
  readonly mode: ParameterMode;
  readonly value?: ParameterValue;
  readonly fromValue?: ParameterValue;
  readonly toValue?: ParameterValue;
}

export type ActionDependency =
  | {
      readonly kind: "action_state";
      readonly actionId: string;
      readonly requiredState: ActionState;
    }
  | {
      readonly kind: "event";
      readonly eventType: string;
      readonly eventId?: string;
    }
  | {
      readonly kind: "manual_approval";
      readonly approvalRole: string;
    };

export interface SchedulingRequirement {
  readonly requirementId: string;
  readonly kind:
    | "business_hours"
    | "blackout_window"
    | "manual_approval"
    | "event_gate"
    | "custom";
  readonly description: string;
  readonly machineCode?: string;
}

export interface ActionTiming {
  readonly proposedStart: KnowledgeValue<UtcTimestamp>;
  readonly earliestPossibleStart: KnowledgeValue<UtcTimestamp>;
  readonly latestUsefulStart: KnowledgeValue<UtcTimestamp>;
  readonly schedulingRequirements: readonly SchedulingRequirement[];
  readonly dependencies: readonly ActionDependency[];
}

export type ActionEndCondition =
  | {
      readonly kind: "time";
      readonly at: UtcTimestamp;
    }
  | {
      readonly kind: "event";
      readonly eventType: string;
      readonly eventId?: string;
    }
  | {
      readonly kind: "metric";
      readonly metricId: string;
      readonly operator: "LT" | "LTE" | "EQ" | "GTE" | "GT";
      readonly threshold: number;
    }
  | {
      readonly kind: "manual";
      readonly description: string;
    };

export interface Recurrence {
  readonly frequency: "daily" | "weekly" | "monthly";
  readonly interval: number;
  readonly maxOccurrences?: number;
}

export interface ActionDuration {
  readonly kind: "instantaneous" | "temporary" | "persistent" | "recurring";
  readonly durationSeconds: KnowledgeValue<number>;
  readonly endTime: KnowledgeValue<UtcTimestamp>;
  readonly endCondition?: ActionEndCondition;
  readonly recurrence?: Recurrence;
}

export interface ActionCost {
  readonly incrementalSpend: KnowledgeValue<MonetaryAmount>;
  readonly implementationCost: KnowledgeValue<MonetaryAmount>;
  readonly discountMarginCost: KnowledgeValue<MonetaryAmount>;
  readonly operationalCost: KnowledgeValue<MonetaryAmount>;
  readonly opportunityCost: KnowledgeValue<MonetaryAmount>;
  readonly totalEconomicExposure: KnowledgeValue<MonetaryAmount>;
}

export type ConstraintComparisonOperator =
  | "LT"
  | "LTE"
  | "EQ"
  | "NEQ"
  | "GTE"
  | "GT"
  | "CONTAINS"
  | "NOT_CONTAINS";

export type ActionConstraint =
  | {
      readonly constraintId: string;
      readonly kind: "property_comparison";
      readonly property: string;
      readonly operator: ConstraintComparisonOperator;
      readonly value: ParameterValue;
      readonly whenUnmet: "INVALID" | "BLOCKED";
      readonly description?: string;
    }
  | {
      readonly constraintId: string;
      readonly kind: "action_relation";
      readonly relation: "requires" | "mutually_exclusive_with";
      readonly actionIds: readonly string[];
      readonly whenUnmet: "INVALID" | "BLOCKED";
      readonly description?: string;
    }
  | {
      readonly constraintId: string;
      readonly kind: "data_available";
      readonly dataRef: string;
      readonly maximumAgeSeconds?: number;
      readonly whenUnmet: "INVALID" | "BLOCKED";
      readonly description?: string;
    };

export type ReversibilityClass =
  | "fully_reversible"
  | "partially_reversible"
  | "irreversible";

export interface ActionReversibility {
  readonly classification: ReversibilityClass;
  readonly reversalMechanism: KnowledgeValue<string>;
  readonly reversalCost: KnowledgeValue<MonetaryAmount>;
  readonly reversalDelaySeconds: KnowledgeValue<number>;
}

export const RISK_DIMENSIONS = [
  "financial",
  "margin",
  "inventory",
  "customer_experience",
  "brand",
  "operational",
  "measurement",
] as const;

export type CoreRiskDimension = (typeof RISK_DIMENSIONS)[number];
export type RiskDimension = CoreRiskDimension | (string & {});
export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskImpact {
  readonly severity: RiskSeverity;
  readonly economicExposure?: MonetaryAmount;
}

export interface ActionRisk {
  readonly dimension: RiskDimension;
  readonly probability: KnowledgeValue<number>;
  readonly impact: KnowledgeValue<RiskImpact>;
  readonly rationale?: string;
}

export interface MetricReference {
  readonly metricId: string;
  readonly unit?: string;
  readonly desiredDirection?: "increase" | "decrease" | "hold" | "context_only";
}

export interface BaselineRequirement {
  readonly strategy:
    | "same_length_prior"
    | "matched_period"
    | "holdout"
    | "synthetic_control"
    | "custom";
  readonly lookbackSeconds: number;
  readonly minimumObservations?: number;
  readonly notes?: string;
}

export interface ActionMeasurementHorizon {
  readonly earliestMeaningfulObservationSeconds: KnowledgeValue<number>;
  readonly primaryEvaluationSeconds: KnowledgeValue<number>;
  readonly longerTermEvaluationSeconds: KnowledgeValue<number>;
  readonly metrics: readonly MetricReference[];
  readonly baseline: BaselineRequirement;
}

export type CompoundExecutionPolicy =
  | "all_or_nothing"
  | "ordered"
  | "best_effort";

export interface CompoundComponentDependency {
  readonly componentActionId: string;
  readonly dependsOnActionIds: readonly string[];
}

export interface CompoundCoordination {
  readonly executionPolicy: CompoundExecutionPolicy;
  readonly dependencies: readonly CompoundComponentDependency[];
}

export interface Action {
  readonly ontologyVersion: string;
  readonly actionId: string;
  readonly actionType: string;
  readonly actionCategory: ActionCategory;
  /** Revision of this action definition, independent from ontologyVersion. */
  readonly version: number;
  readonly description: string;
  readonly atomicity: ActionAtomicity;
  readonly target: ActionTarget;
  readonly parameters: readonly ActionParameter[];
  readonly timing: ActionTiming;
  readonly duration: ActionDuration;
  readonly cost: ActionCost;
  readonly constraints: readonly ActionConstraint[];
  readonly reversibility: ActionReversibility;
  readonly risks: readonly ActionRisk[];
  readonly measurement: ActionMeasurementHorizon;
  readonly state: ActionState;

  /** Present on compound parents and their coordinated components. */
  readonly sharedIntentId?: string;
  /** Present on component actions so they cannot be detached from their parent decision. */
  readonly parentActionId?: string;
  /** Links a reversing intervention to the action whose effects it is intended to undo. */
  readonly reversalOfActionId?: string;
  readonly components?: readonly Action[];
  /**
   * Required for compound actions. Defines whether components form one
   * coordinated intervention and any dependency edges between them.
   */
  readonly coordination?: CompoundCoordination;
}

export interface ActionMetricPrediction {
  readonly metricId: string;
  readonly predictedDelta: KnowledgeValue<number>;
  readonly unit: string;
  readonly horizonSeconds: number;
}

export interface ActionEvaluation {
  readonly evaluationId: string;
  readonly actionId: string;
  readonly ontologyVersion: string;
  readonly generatedAt: UtcTimestamp;
  readonly predictions: readonly ActionMetricPrediction[];
  readonly assumptions: readonly string[];
}

export type DecisionDisposition = "ACCEPTED" | "REJECTED" | "DEFERRED";

export interface Decision {
  readonly decisionId: string;
  readonly actionId: string;
  readonly disposition: DecisionDisposition;
  readonly decidedAt: UtcTimestamp;
  readonly actor: {
    readonly kind: "human" | "system";
    readonly actorId: string;
  };
  readonly rationale?: string;
}
