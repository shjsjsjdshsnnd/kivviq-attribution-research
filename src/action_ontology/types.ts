import type {
  Brand,
  CurrencyCode,
  UtcTimestamp,
} from "../core/units.js";

export const ACTION_SCHEMA_VERSION = "1.3.0" as const;
export const SUPPORTED_ACTION_SCHEMA_VERSIONS = [
  "1.0.0",
  "1.1.0",
  "1.2.0",
  ACTION_SCHEMA_VERSION,
] as const;
export type ActionSchemaVersion =
  (typeof SUPPORTED_ACTION_SCHEMA_VERSIONS)[number];

export type ActionId = Brand<string, "ActionId">;
export type ActionType = Brand<string, "ActionType">;
export type ActionCategoryId = Brand<string, "ActionCategoryId">;
export type ConstraintId = Brand<string, "ConstraintId">;

export const ACTION_CATEGORIES = [
  "advertising",
  "pricing",
  "promotion",
  "shipping",
  "merchandising",
  "inventory",
  "cro",
  "lifecycle",
  "customer_targeting",
  "experimentation",
  "investigation",
  "operational",
  "no_op",
] as const;

export type CoreActionCategory = (typeof ACTION_CATEGORIES)[number];
export type ActionCategory = CoreActionCategory | ActionCategoryId;

export type ActionTarget =
  | { readonly kind: "advertising_channel"; readonly channelId: string }
  | {
      readonly kind: "advertising_account";
      readonly channelId: string;
      readonly accountId: string;
    }
  | {
      readonly kind: "campaign";
      readonly channelId: string;
      readonly campaignId: string;
    }
  | {
      readonly kind: "campaign_group";
      readonly channelId: string;
      readonly campaignGroupId: string;
      readonly accountId?: string;
    }
  | {
      readonly kind: "ad_set";
      readonly channelId: string;
      readonly campaignId: string;
      readonly adSetId: string;
    }
  | {
      readonly kind: "ad_group";
      readonly channelId: string;
      readonly campaignId: string;
      readonly adGroupId: string;
    }
  | {
      readonly kind: "ad";
      readonly channelId: string;
      readonly campaignId: string;
      readonly adSetId?: string;
      readonly adGroupId?: string;
      readonly adId: string;
    }
  | {
      readonly kind: "creative";
      readonly channelId: string;
      readonly creativeId: string;
      readonly campaignId?: string;
    }
  | { readonly kind: "audience"; readonly audienceId: string }
  | { readonly kind: "product"; readonly productId: string }
  | {
      readonly kind: "sku";
      readonly productId?: string;
      readonly skuId: string;
    }
  | { readonly kind: "category"; readonly categoryId: string }
  | { readonly kind: "collection"; readonly collectionId: string }
  | { readonly kind: "brand"; readonly brandId: string }
  | { readonly kind: "product_set"; readonly productSetId: string }
  | {
      readonly kind: "product_group";
      readonly productGroupId: string;
      readonly collectionId?: string;
      readonly categoryId?: string;
    }
  | { readonly kind: "customer_segment"; readonly segmentId: string }
  | {
      readonly kind: "funnel_stage";
      readonly funnelId: string;
      readonly stageId: string;
    }
  | { readonly kind: "page"; readonly pageId: string }
  | { readonly kind: "lifecycle_program"; readonly programId: string }
  | { readonly kind: "shipping_policy"; readonly shippingPolicyId: string }
  | { readonly kind: "inventory_policy"; readonly inventoryPolicyId: string }
  | { readonly kind: "experiment"; readonly experimentId: string }
  | { readonly kind: "promotion"; readonly promotionId: string }
  | { readonly kind: "merchant"; readonly merchantId: string };

export type ScopeDimension =
  | {
      readonly kind: "geography";
      readonly include: readonly string[];
      readonly exclude?: readonly string[];
    }
  | {
      readonly kind: "device";
      readonly devices: readonly ("desktop" | "mobile" | "tablet" | "other")[];
    }
  | {
      readonly kind: "customer_population";
      readonly segmentIds: readonly string[];
    }
  | {
      readonly kind: "product_population";
      readonly productIds?: readonly string[];
      readonly skuIds?: readonly string[];
      readonly collectionIds?: readonly string[];
    }
  | {
      readonly kind: "channel_subset";
      readonly channelIds: readonly string[];
      readonly campaignIds?: readonly string[];
    }
  | {
      readonly kind: "paid_media_segment";
      readonly classification:
        | "prospecting"
        | "retargeting"
        | "brand"
        | "non_brand"
        | "custom";
      readonly segmentId?: string;
      readonly taxonomySource: "merchant_defined" | "kivviq_canonical";
    }
  | {
      readonly kind: "time_window";
      readonly start: UtcTimestamp;
      readonly end: UtcTimestamp;
    };

export interface ActionScope {
  readonly dimensions: readonly ScopeDimension[];
}

export interface MonetaryValue {
  readonly kind: "money";
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export interface MonetaryRateValue {
  readonly kind: "money_rate";
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly per: "day" | "week" | "month";
}

export interface PercentageValue {
  readonly kind: "percentage";
  readonly basisPoints: number;
}

export interface QuantityValue {
  readonly kind: "quantity";
  readonly value: number;
  readonly unit:
    | "units"
    | "hours"
    | "messages"
    | "sessions"
    | "customers"
    | "orders"
    | "days"
    | "seconds";
}

export interface FrequencyValue {
  readonly kind: "frequency";
  readonly count: number;
  readonly per: "day" | "week" | "month";
}

export interface BooleanValue {
  readonly kind: "boolean";
  readonly value: boolean;
}

export interface StringValue {
  readonly kind: "string";
  readonly value: string;
}

export type ScalarValue =
  | MonetaryValue
  | MonetaryRateValue
  | PercentageValue
  | QuantityValue
  | FrequencyValue
  | BooleanValue
  | StringValue;

export type ReferenceValue =
  | {
      readonly kind: "current_at_decision";
      readonly decisionTime: UtcTimestamp;
    }
  | {
      readonly kind: "baseline_snapshot";
      readonly baselineId: string;
    }
  | {
      readonly kind: "previous_period";
      readonly lookbackSeconds: number;
    }
  | {
      readonly kind: "explicit_baseline";
      readonly value: ScalarValue;
    };

export type ValueOperation<T extends ScalarValue> =
  | {
      readonly kind: "SET";
      readonly value: T;
    }
  | {
      readonly kind: "DELTA";
      readonly direction: "increase" | "decrease";
      readonly amount: T;
      readonly reference: ReferenceValue;
    }
  | {
      readonly kind: "MULTIPLY";
      readonly factor: number;
      readonly reference: ReferenceValue;
    };

export type PaidMediaControl = "budget" | "spend_cap";

export type PaidMediaAllocationMember =
  | {
      readonly kind: "strategy";
      readonly classification: "prospecting" | "retargeting";
      readonly segmentId?: string;
    }
  | {
      readonly kind: "traffic_classification";
      readonly classification: "brand" | "non_brand";
      readonly segmentId?: string;
    }
  | {
      readonly kind: "target";
      readonly target: ActionTarget;
      readonly scope?: ActionScope;
    };

export interface PaidMediaAllocationShare {
  readonly memberId: string;
  readonly member: PaidMediaAllocationMember;
  readonly shareBasisPoints: number;
}

export interface PaidMediaAllocationDenominator {
  readonly kind: "target_scope";
  readonly control: PaidMediaControl;
  readonly target: ActionTarget;
  readonly scope: ActionScope;
}

export type PaidMediaTransferAmount =
  | {
      readonly kind: "money_rate";
      readonly value: MonetaryRateValue;
    }
  | {
      readonly kind: "percentage_of_source";
      readonly basisPoints: number;
      readonly sourceTarget: ActionTarget;
      readonly sourceScope: ActionScope;
      readonly sourceReference: ReferenceValue;
    };


export type MembershipEvaluationBoundary =
  | "decision_time"
  | "translation_time"
  | "effective_time";

export type PricingMembershipBoundary = MembershipEvaluationBoundary;

export interface PricingMembershipSemantics {
  readonly evaluateAt: PricingMembershipBoundary;
  /**
   * Optional stable canonical snapshot/binding identifier. If supplied,
   * translation must resolve this exact binding rather than a later membership.
   */
  readonly bindingRef?: string;
}

export type PriceRollbackStrategy =
  | {
      readonly kind: "RESTORE_PRE_ACTION_VALUE";
      readonly source:
        | {
            readonly kind: "single_price";
            readonly preActionPrice: ReferenceValue;
          }
        | {
            readonly kind: "membership_snapshot";
            readonly bindingRef: string;
          };
    }
  | {
      readonly kind: "SET_EXPLICIT_VALUE";
      readonly value: MonetaryValue;
    };

export interface PriceRollbackConflictGuard {
  readonly kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT";
  readonly sourceActionId: ActionId;
  readonly expected:
    | {
        readonly kind: "single_price";
        readonly price: MonetaryValue;
      }
    | {
        readonly kind: "membership_state";
        readonly stateRef: string;
      };
}

export type PricingRollbackTrigger =
  | { readonly kind: "ON_TERMINATION" }
  | { readonly kind: "AT"; readonly at: UtcTimestamp };

export type PricingRollbackContract =
  | {
      readonly available: false;
      readonly reason: string;
    }
  | {
      readonly available: true;
      readonly target: ActionTarget;
      readonly strategy: PriceRollbackStrategy;
      readonly trigger: PricingRollbackTrigger;
      readonly delaySeconds: number;
      readonly cost: KnownOrUnknown<MonetaryValue>;
      readonly conflictGuard: PriceRollbackConflictGuard;
    };


export interface PromotionMembershipSemantics {
  readonly evaluateAt: MembershipEvaluationBoundary;
  readonly bindingRef?: string;
}

export type PromotionEntitySelector =
  | { readonly kind: "sku"; readonly skuId: string; readonly productId?: string }
  | { readonly kind: "product"; readonly productId: string }
  | { readonly kind: "category"; readonly categoryId: string }
  | { readonly kind: "collection"; readonly collectionId: string }
  | { readonly kind: "product_set"; readonly productSetId: string }
  | { readonly kind: "brand"; readonly brandId: string };

export type PromotionDiscount =
  | {
      readonly kind: "PERCENTAGE";
      readonly basisPoints: number;
    }
  | {
      readonly kind: "FIXED_AMOUNT";
      readonly value: MonetaryValue;
    }
  | {
      readonly kind: "FIXED_PROMOTIONAL_PRICE";
      readonly value: MonetaryValue;
    };

export interface PromotionBundleComponent {
  readonly componentId: string;
  readonly target:
    | Extract<ActionTarget, { readonly kind: "sku" }>
    | Extract<ActionTarget, { readonly kind: "product" }>;
  readonly quantity: number;
}

export type PromotionMechanism =
  | {
      readonly kind: "DISCOUNT";
      readonly discount: PromotionDiscount;
    }
  | {
      readonly kind: "BUNDLE_FIXED_PRICE";
      readonly components: readonly PromotionBundleComponent[];
      readonly bundlePrice: MonetaryValue;
    }
  | {
      readonly kind: "BUNDLE_PERCENTAGE_DISCOUNT";
      readonly components: readonly PromotionBundleComponent[];
      readonly basisPoints: number;
    }
  | {
      readonly kind: "CONDITIONAL_ITEM_DISCOUNT";
      readonly qualifyingComponents: readonly PromotionBundleComponent[];
      readonly rewardTarget:
        | Extract<ActionTarget, { readonly kind: "sku" }>
        | Extract<ActionTarget, { readonly kind: "product" }>;
      readonly rewardQuantity: number;
      readonly discount: PromotionDiscount;
    };

export type PromotionProductEligibilityRule =
  | {
      readonly kind: "INVENTORY_AT_LEAST";
      readonly target: PromotionEntitySelector;
      readonly units: number;
    }
  | {
      readonly kind: "NOT_CLEARANCE";
    }
  | {
      readonly kind: "BRAND_NOT";
      readonly brandId: string;
    };

export interface PromotionProductScope {
  readonly include: readonly PromotionEntitySelector[];
  readonly exclude: readonly PromotionEntitySelector[];
  readonly exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE";
  readonly conditions: readonly PromotionProductEligibilityRule[];
  readonly membership?: PromotionMembershipSemantics;
}

export type PromotionApplicationScope =
  | {
      readonly kind: "PRODUCT_SCOPE";
      readonly products: PromotionProductScope;
    }
  | {
      readonly kind: "ORDER_SCOPE";
    }
  | {
      readonly kind: "BUNDLE_SCOPE";
    };

export type PromotionCustomerEligibility =
  | { readonly kind: "ALL_CUSTOMERS" }
  | { readonly kind: "NEW_CUSTOMERS" }
  | { readonly kind: "RETURNING_CUSTOMERS" }
  | { readonly kind: "CUSTOMER_SEGMENT"; readonly segmentId: string }
  | { readonly kind: "EMAIL_SUBSCRIBERS" }
  | { readonly kind: "LOYALTY_SEGMENT"; readonly segmentId: string };

export type PromotionPurchaseRequirement =
  | {
      readonly kind: "MIN_ORDER_VALUE";
      readonly value: MonetaryValue;
    }
  | {
      readonly kind: "MIN_QUANTITY";
      readonly quantity: number;
      readonly target?: PromotionEntitySelector;
    }
  | {
      readonly kind: "REQUIRED_TARGET";
      readonly target: PromotionEntitySelector;
      readonly quantity: number;
    }
  | {
      readonly kind: "REQUIRED_BUNDLE_COMPOSITION";
      readonly components: readonly PromotionBundleComponent[];
    };

export type PromotionRedemption =
  | { readonly kind: "AUTOMATIC" }
  | {
      readonly kind: "COUPON";
      readonly code?: string;
      readonly codeFamilyRef?: string;
    };

export interface PromotionUsageLimits {
  readonly maxTotalRedemptions?: number;
  readonly maxRedemptionsPerCustomer?: number;
  readonly maxDiscountedUnitsPerOrder?: number;
  readonly maxPromotionalExposure?: MonetaryValue;
}

export type PromotionStackingType =
  | "AUTOMATIC"
  | "COUPON"
  | "PRODUCT"
  | "ORDER"
  | "BUNDLE"
  | "SHIPPING";

export type PromotionStacking =
  | { readonly kind: "STACKABLE" }
  | { readonly kind: "NON_STACKABLE" }
  | {
      readonly kind: "STACKABLE_WITH_TYPES";
      readonly types: readonly PromotionStackingType[];
    };

export type PromotionConflictResolution =
  | { readonly kind: "NONE" }
  | { readonly kind: "PRIORITY"; readonly priority: number }
  | { readonly kind: "BEST_DISCOUNT" }
  | {
      readonly kind: "MUTUALLY_EXCLUSIVE_GROUP";
      readonly groupId: string;
      readonly priority?: number;
    };

export interface PromotionDefinition {
  readonly mechanism: PromotionMechanism;
  readonly applicationScope: PromotionApplicationScope;
  readonly customerEligibility: PromotionCustomerEligibility;
  readonly purchaseRequirements: readonly PromotionPurchaseRequirement[];
  readonly redemption: PromotionRedemption;
  readonly usageLimits: PromotionUsageLimits;
  readonly stacking: PromotionStacking;
  readonly conflictResolution: PromotionConflictResolution;
  readonly terminationBehavior: "DEACTIVATE_PROMOTION";
}

export type ActionParameters =
  | {
      readonly kind: "budget_adjustment";
      readonly operation: ValueOperation<MonetaryRateValue>;
    }
  | {
      readonly kind: "spend_cap_adjustment";
      readonly operation: ValueOperation<MonetaryRateValue>;
    }
  | {
      readonly kind: "paid_media_delivery";
      readonly operation: "PAUSE" | "RESUME";
    }
  | {
      readonly kind: "paid_media_allocation";
      readonly control: PaidMediaControl;
      readonly operation: "SET";
      readonly denominator: PaidMediaAllocationDenominator;
      readonly shares: readonly PaidMediaAllocationShare[];
      readonly baselineShares?: readonly PaidMediaAllocationShare[];
    }
  | {
      readonly kind: "paid_media_transfer_leg";
      readonly transferId: string;
      readonly role: "source" | "destination";
      readonly control: PaidMediaControl;
      readonly operation: "DELTA";
      readonly direction: "decrease" | "increase";
      readonly amount: PaidMediaTransferAmount;
    }
  | {
      readonly kind: "price_adjustment";
      readonly operation: ValueOperation<MonetaryValue>;
      /**
       * Required for product/category/collection pricing because the business
       * action may later expand to multiple SKU interventions.
       */
      readonly membership?: PricingMembershipSemantics;
    }
  | {
      readonly kind: "price_rollback";
      readonly originalActionId: ActionId;
      readonly strategy: PriceRollbackStrategy;
      readonly conflictGuard: PriceRollbackConflictGuard;
    }
  | {
      readonly kind: "promotion";
      readonly discount: ValueOperation<PercentageValue>;
      readonly code?: string;
    }
  | {
      readonly kind: "promotion_start";
      readonly promotionId: string;
      readonly definition: PromotionDefinition;
    }
  | {
      readonly kind: "promotion_stop";
      readonly targetPromotionId: string;
    }
  | {
      readonly kind: "promotion_modify";
      readonly targetPromotionId: string;
      readonly definition: PromotionDefinition;
    }
  | {
      readonly kind: "inventory";
      readonly operation: ValueOperation<QuantityValue>;
    }
  | {
      readonly kind: "frequency_adjustment";
      readonly operation: ValueOperation<FrequencyValue>;
    }
  | {
      readonly kind: "toggle";
      readonly setting: string;
      readonly value: boolean;
    }
  | {
      readonly kind: "merchandising_position";
      readonly collectionId: string;
      readonly productId: string;
      readonly position: number;
    }
  | {
      readonly kind: "shipping_policy";
      readonly setting: string;
      readonly operation: ValueOperation<ScalarValue>;
    }
  | {
      readonly kind: "page_change";
      readonly changeId: string;
      readonly variantRef: string;
    }
  | {
      readonly kind: "segment_targeting";
      readonly segmentId: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "run_experiment";
      readonly hypothesisRef: string;
      readonly interventionActionId: ActionId;
      readonly controlActionId: ActionId;
      readonly targetPopulationRef: string;
      readonly durationSeconds: number;
      readonly primaryOutcomeMetricId: string;
    }
  | {
      readonly kind: "investigate";
      readonly investigationType:
        | "tracking_anomaly"
        | "checkout_decline"
        | "missing_margin_data"
        | "channel_shift"
        | "custom";
      readonly question: string;
      readonly requestedEvidenceRefs: readonly string[];
    }
  | {
      readonly kind: "no_op";
      readonly reasonCode: string;
    }
  | {
      readonly kind: "wait_observe";
      readonly observationUntil:
        | { readonly kind: "time"; readonly at: UtcTimestamp }
        | { readonly kind: "evidence_condition"; readonly conditionRef: string };
    };

export type TemporalPoint =
  | { readonly kind: "known"; readonly at: UtcTimestamp }
  | { readonly kind: "unknown"; readonly reason: string };

export interface ActionTiming {
  readonly decisionTime: UtcTimestamp;
  readonly requestedStart: TemporalPoint;
  readonly effectiveStart: TemporalPoint;
  readonly implementationDelaySeconds:
    | { readonly kind: "known"; readonly seconds: number }
    | { readonly kind: "unknown"; readonly reason: string };
}

export type Recurrence =
  | {
      readonly kind: "daily";
      readonly interval: number;
      readonly maxOccurrences?: number;
    }
  | {
      readonly kind: "weekly";
      readonly interval: number;
      readonly daysOfWeek?: readonly number[];
      readonly maxOccurrences?: number;
    }
  | {
      readonly kind: "monthly";
      readonly interval: number;
      readonly maxOccurrences?: number;
    };

export type ActionDuration =
  | { readonly kind: "instantaneous" }
  | { readonly kind: "temporary"; readonly durationSeconds: number }
  | { readonly kind: "persistent" }
  | { readonly kind: "recurring"; readonly recurrence: Recurrence }
  | { readonly kind: "until_reversed" };

export type ActionTermination =
  | { readonly kind: "fixed_end"; readonly at: UtcTimestamp }
  | { readonly kind: "fixed_duration"; readonly durationSeconds: number }
  | { readonly kind: "condition"; readonly conditionRef: string }
  | { readonly kind: "manual_reversal" }
  | { readonly kind: "persistent" };

export type KnownOrUnknown<T> =
  | {
      readonly kind: "known";
      readonly value: T;
      readonly sourceRef?: string;
    }
  | {
      readonly kind: "unknown";
      readonly reason: string;
    };

export interface ActionCost {
  readonly directFinancialCost: KnownOrUnknown<MonetaryValue>;
  readonly mediaSpend: KnownOrUnknown<MonetaryValue>;
  readonly implementationCost: KnownOrUnknown<MonetaryValue>;
  readonly engineeringCost: KnownOrUnknown<MonetaryValue>;
  readonly operationalCost: KnownOrUnknown<MonetaryValue>;
  readonly promotionalCost: KnownOrUnknown<MonetaryValue>;
  readonly inventoryCommitment: KnownOrUnknown<MonetaryValue>;
  /**
   * Opportunity cost is a reference for later evaluation, not a realized
   * accounting expense.
   */
  readonly opportunityCostReference?: string;
}

export type ResourceRequirement =
  | {
      readonly resourceType: "advertising_budget";
      readonly amount: KnownOrUnknown<MonetaryValue>;
    }
  | {
      readonly resourceType: "inventory";
      readonly amount: KnownOrUnknown<QuantityValue>;
    }
  | {
      readonly resourceType: "engineering_capacity";
      readonly amount: KnownOrUnknown<QuantityValue>;
    }
  | {
      readonly resourceType: "creative_capacity";
      readonly amount: KnownOrUnknown<QuantityValue>;
    }
  | {
      readonly resourceType: "email_audience";
      readonly amount: KnownOrUnknown<QuantityValue>;
    }
  | {
      readonly resourceType: "operational_capacity";
      readonly amount: KnownOrUnknown<QuantityValue>;
    }
  | {
      readonly resourceType: "testing_traffic";
      readonly amount: KnownOrUnknown<QuantityValue>;
    };

export type ComparisonOperator = "LT" | "LTE" | "EQ" | "NEQ" | "GTE" | "GT";

export type ConstraintExpression =
  | {
      readonly kind: "property_comparison";
      readonly propertyId: string;
      readonly operator: ComparisonOperator;
      readonly value: ScalarValue;
    }
  | {
      readonly kind: "entity_exists";
      readonly target: ActionTarget;
    }
  | {
      readonly kind: "capability_available";
      readonly capabilityId: string;
    }
  | {
      readonly kind: "evidence_available";
      readonly evidenceRef: string;
      readonly maximumAgeSeconds?: number;
    };

export interface ActionConstraint {
  readonly constraintId: ConstraintId;
  readonly constraintClass: "hard" | "soft";
  readonly expression: ConstraintExpression;
  readonly description?: string;
}

export interface ActionPrecondition {
  readonly preconditionId: string;
  readonly expression: ConstraintExpression;
  readonly whenUnknown: "unknown_eligibility" | "ineligible";
  readonly description?: string;
}

export type EligibilityStatus = "eligible" | "ineligible" | "unknown";

export interface EligibilityResult {
  readonly status: EligibilityStatus;
  readonly failedConstraintIds: readonly string[];
  readonly missingEvidenceRefs: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface EligibilityInformationRequirement {
  readonly requirementId: string;
  readonly kind:
    | "business_property"
    | "entity_presence"
    | "capability"
    | "evidence";
  readonly reference: string;
}

export type ReversibilityClass =
  | "immediately_reversible"
  | "reversible_with_delay"
  | "partially_reversible"
  | "effectively_irreversible";

export type ReversalActionReference =
  | {
      readonly kind: "restore_previous_value";
      readonly target: ActionTarget;
      readonly parameterKind: ActionParameters["kind"];
    }
  | {
      readonly kind: "explicit_action";
      readonly actionId: ActionId;
    }
  | {
      readonly kind: "none";
      readonly reason: string;
    };

export interface ActionReversibility {
  readonly classification: ReversibilityClass;
  readonly reversal: ReversalActionReference;
  readonly minimumDelaySeconds?: number;
  /**
   * Step 4 pricing-safe rollback semantics. This is metadata/readiness only;
   * it does not execute rollback.
   */
  readonly pricingRollback?: PricingRollbackContract;
}

export const RISK_DIMENSIONS = [
  "financial_downside",
  "inventory_exposure",
  "customer_experience",
  "implementation",
  "irreversibility",
  "measurement_uncertainty",
  "operational_complexity",
  "time_to_recovery",
  "brand_reputation",
] as const;

export type RiskDimension = (typeof RISK_DIMENSIONS)[number];

export interface ActionRiskDimension {
  readonly dimension: RiskDimension;
  readonly downsideDefinition: string;
}

export const UNCERTAINTY_DIMENSIONS = [
  "causal_effect",
  "measurement",
  "demand",
  "implementation",
  "timing",
] as const;

export type UncertaintyDimension = (typeof UNCERTAINTY_DIMENSIONS)[number];

export interface ActionUncertaintyDimension {
  readonly dimension: UncertaintyDimension;
  readonly informationGap: string;
  readonly evidenceRefs?: readonly string[];
}

export const OUTCOME_FAMILIES = [
  "incremental_contribution_profit",
  "revenue",
  "orders",
  "new_customers",
  "repeat_customers",
  "conversion",
  "inventory_position",
  "customer_value",
  "retention",
  "return_rate",
] as const;

export type OutcomeFamily = (typeof OUTCOME_FAMILIES)[number];

export interface TargetOutcome {
  readonly family: OutcomeFamily;
  readonly metricId?: string;
  readonly role: "primary" | "guardrail";
}

export interface ActionMeasurementHorizon {
  readonly earliestMeaningfulEvaluationSeconds: number;
  readonly primaryEvaluationSeconds: number;
  readonly longTermFollowUpSeconds?: number;
  readonly outcomes: readonly TargetOutcome[];
}

export interface ActionIntent {
  readonly statement: string;
  readonly intentRef?: string;
}

export type ActionProvenanceSource =
  | "human"
  | "rule_based_baseline"
  | "diagnosis_engine"
  | "opportunity_engine"
  | "optimizer"
  | "experiment_selector"
  | "imported_manual";

export interface ActionProvenance {
  readonly source: ActionProvenanceSource;
  readonly sourceId?: string;
  readonly createdAt: UtcTimestamp;
  readonly evidenceRefs: readonly string[];
}

export interface AtomicAction {
  readonly kind: "atomic_action";
  readonly actionId: ActionId;
  readonly actionType: ActionType;
  readonly actionCategory: ActionCategory;
  readonly schemaVersion: ActionSchemaVersion;
  readonly description: string;
  readonly target: ActionTarget;
  readonly scope: ActionScope;
  readonly parameters: ActionParameters;
  readonly timing: ActionTiming;
  readonly duration: ActionDuration;
  readonly termination: ActionTermination;
  readonly cost: ActionCost;
  readonly resourceRequirements: readonly ResourceRequirement[];
  readonly constraints: readonly ActionConstraint[];
  readonly preconditions: readonly ActionPrecondition[];
  readonly reversibility: ActionReversibility;
  readonly riskDimensions: readonly ActionRiskDimension[];
  readonly uncertaintyDimensions: readonly ActionUncertaintyDimension[];
  readonly measurement: ActionMeasurementHorizon;
  readonly intent: ActionIntent;
  readonly provenance: ActionProvenance;
  readonly reversalOfActionId?: ActionId;
}

/**
 * Step 1 deliberately keeps canonical Action atomic. This readiness contract
 * proves that a later phase can group atomic actions without changing their
 * meaning or embedding execution policy into them.
 */
export interface CompoundAction {
  readonly kind: "compound_action";
  readonly compoundActionId: ActionId;
  readonly schemaVersion: ActionSchemaVersion;
  readonly description: string;
  readonly componentActionIds: readonly ActionId[];
}

export type Action = AtomicAction;

/**
 * Lifecycle belongs outside Action. These records can reference the immutable
 * Action later without mutating its semantic definition.
 */
export type ActionLifecycleState =
  | "proposed"
  | "accepted"
  | "scheduled"
  | "started"
  | "committed"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

export interface ActionLifecycleRecord {
  readonly actionId: ActionId;
  readonly state: ActionLifecycleState;
  readonly recordedAt: UtcTimestamp;
  readonly actorRef?: string;
}

/**
 * Prediction and ranking deliberately live outside Action.
 */
export interface ActionEvaluationReference {
  readonly evaluationId: string;
  readonly actionId: ActionId;
  readonly evaluatorId: string;
  readonly createdAt: UtcTimestamp;
}
