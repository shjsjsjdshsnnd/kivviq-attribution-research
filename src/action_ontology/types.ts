import type {
  Brand,
  CurrencyCode,
  UtcTimestamp,
} from "../core/units.js";

export const ACTION_SCHEMA_VERSION = "1.8.0" as const;
export const SUPPORTED_ACTION_SCHEMA_VERSIONS = [
  "1.0.0",
  "1.1.0",
  "1.2.0",
  "1.3.0",
  "1.4.0",
  "1.5.0",
  "1.6.0",
  "1.7.0",
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
  | { readonly kind: "lifecycle_flow"; readonly flowId: string }
  | { readonly kind: "lifecycle_contact_policy"; readonly contactPolicyId: string }
  | { readonly kind: "shipping_policy"; readonly shippingPolicyId: string }
  | { readonly kind: "shipping_offer"; readonly shippingOfferId: string }
  | { readonly kind: "inventory_policy"; readonly inventoryPolicyId: string }
  | { readonly kind: "inventory_location"; readonly inventoryLocationId: string }
  | { readonly kind: "supplier_relationship"; readonly supplierRelationshipId: string }
  | { readonly kind: "inventory_set"; readonly inventorySetId: string }
  | { readonly kind: "cro_experience"; readonly experienceId: string }
  | { readonly kind: "experiment"; readonly experimentId: string }
  | { readonly kind: "promotion"; readonly promotionId: string }
  | { readonly kind: "merchandising_placement"; readonly placementId: string }
  | { readonly kind: "merchandising_relationship"; readonly relationshipId: string }
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
  | {
      readonly kind: "CUSTOMER_SEGMENT";
      readonly segmentId: string;
      readonly membership: PromotionMembershipSemantics;
    }
  | { readonly kind: "EMAIL_SUBSCRIBERS" }
  | {
      readonly kind: "LOYALTY_SEGMENT";
      readonly segmentId: string;
      readonly membership: PromotionMembershipSemantics;
    };

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
  | { readonly kind: "PRIORITY"; readonly precedence: number }
  | { readonly kind: "BEST_DISCOUNT" }
  | {
      readonly kind: "MUTUALLY_EXCLUSIVE_GROUP";
      readonly groupId: string;
      readonly precedence?: number;
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


export type ShippingMembershipSemantics = {
  readonly evaluateAt: MembershipEvaluationBoundary;
  readonly bindingRef?: string;
};

export type ShippingProductSelector = PromotionEntitySelector;

export type ShippingThresholdBasis =
  | "PRE_DISCOUNT_SUBTOTAL"
  | "POST_DISCOUNT_SUBTOTAL"
  | "QUALIFYING_PRODUCT_SUBTOTAL";

export type ShippingServiceSelector =
  | { readonly kind: "STANDARD" }
  | { readonly kind: "EXPRESS" }
  | { readonly kind: "OVERSIZED" }
  | { readonly kind: "WHITE_GLOVE" }
  | { readonly kind: "LOCAL_DELIVERY" }
  | { readonly kind: "CUSTOM"; readonly serviceId: string };

export interface ShippingServiceScope {
  readonly include: readonly ShippingServiceSelector[];
  readonly exclude: readonly ShippingServiceSelector[];
  readonly exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE";
}

export type ShippingGeographySelector =
  | { readonly kind: "COUNTRY"; readonly countryCode: string }
  | {
      readonly kind: "PROVINCE_STATE";
      readonly countryCode: string;
      readonly regionCode: string;
    }
  | { readonly kind: "SHIPPING_ZONE"; readonly shippingZoneId: string }
  | {
      readonly kind: "POSTAL_REGION";
      readonly countryCode: string;
      readonly postalRegionId: string;
    }
  | {
      readonly kind: "MERCHANT_SHIPPING_ZONE";
      readonly shippingZoneId: string;
    };

export interface ShippingGeographyScope {
  readonly include: readonly ShippingGeographySelector[];
  readonly exclude: readonly ShippingGeographySelector[];
  readonly exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE";
}

export type ShippingMixedCartSemantics =
  | { readonly kind: "ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM" }
  | { readonly kind: "ENTIRE_ORDER_IF_ALL_ITEMS_ELIGIBLE" }
  | { readonly kind: "ELIGIBLE_ITEMS_ONLY" }
  | {
      readonly kind: "QUALIFYING_SUBTOTAL_THRESHOLD";
      readonly threshold: MonetaryValue;
      readonly thresholdBasis: "QUALIFYING_PRODUCT_SUBTOTAL";
    };

export type ShippingProductEligibilityRule =
  | { readonly kind: "NOT_OVERSIZED" }
  | { readonly kind: "NOT_FREIGHT_ONLY" }
  | { readonly kind: "NOT_WHITE_GLOVE_ONLY" }
  | {
      readonly kind: "SHIPPING_CLASS_IN";
      readonly shippingClassIds: readonly string[];
    };

export interface ShippingProductScope {
  readonly include: readonly ShippingProductSelector[];
  readonly exclude: readonly ShippingProductSelector[];
  readonly exclusionPrecedence: "EXCLUDE_OVERRIDES_INCLUDE";
  readonly conditions: readonly ShippingProductEligibilityRule[];
  readonly mixedCart: ShippingMixedCartSemantics;
  readonly membership?: ShippingMembershipSemantics;
}

export type ShippingCustomerEligibility =
  | { readonly kind: "ALL_CUSTOMERS" }
  | { readonly kind: "NEW_CUSTOMERS" }
  | { readonly kind: "RETURNING_CUSTOMERS" }
  | {
      readonly kind: "CUSTOMER_SEGMENT";
      readonly segmentId: string;
      readonly membership: ShippingMembershipSemantics;
    }
  | {
      readonly kind: "LOYALTY_SEGMENT";
      readonly segmentId: string;
      readonly membership: ShippingMembershipSemantics;
    };

export type ShippingCartRequirement =
  | {
      readonly kind: "MIN_SUBTOTAL";
      readonly value: MonetaryValue;
      readonly basis: ShippingThresholdBasis;
    }
  | {
      readonly kind: "MIN_QUANTITY";
      readonly quantity: number;
      readonly target?: ShippingProductSelector;
    }
  | {
      readonly kind: "REQUIRED_TARGET";
      readonly target: ShippingProductSelector;
      readonly quantity: number;
    };

export type ShippingBenefit =
  | { readonly kind: "FREE_SHIPPING" }
  | {
      readonly kind: "FLAT_RATE";
      readonly customerShippingCharge: MonetaryValue;
    }
  | {
      readonly kind: "SHIPPING_CREDIT";
      readonly customerShippingCredit: MonetaryValue;
    };

export type ShippingOfferStacking =
  | { readonly kind: "COEXIST" }
  | { readonly kind: "NON_STACKABLE" };

export type ShippingConflictResolution =
  | { readonly kind: "NONE" }
  | { readonly kind: "PRECEDENCE"; readonly precedence: number }
  | { readonly kind: "BEST_BENEFIT" }
  | {
      readonly kind: "MUTUALLY_EXCLUSIVE_GROUP";
      readonly groupId: string;
      readonly precedence?: number;
    };

export interface ShippingOfferDefinition {
  readonly benefit: ShippingBenefit;
  readonly services: ShippingServiceScope;
  readonly geography: ShippingGeographyScope;
  readonly products?: ShippingProductScope;
  readonly customerEligibility: ShippingCustomerEligibility;
  readonly cartRequirements: readonly ShippingCartRequirement[];
  readonly stacking: ShippingOfferStacking;
  readonly conflictResolution: ShippingConflictResolution;
  readonly terminationBehavior: "DEACTIVATE_SHIPPING_OFFER";
}

export interface ShippingThresholdPolicyDefinition {
  readonly kind: "FREE_SHIPPING_THRESHOLD";
  readonly service: ShippingServiceSelector;
  readonly thresholdBasis: ShippingThresholdBasis;
  readonly operation: ValueOperation<MonetaryValue>;
  readonly geography: ShippingGeographyScope;
  readonly products?: ShippingProductScope;
  readonly customerEligibility: ShippingCustomerEligibility;
}

export type ShippingRollbackStrategy =
  | {
      readonly kind: "RESTORE_PRE_ACTION_VALUE";
      readonly preActionThreshold: ReferenceValue;
    }
  | {
      readonly kind: "SET_EXPLICIT_VALUE";
      readonly value: MonetaryValue;
    };

export interface ShippingRollbackConflictGuard {
  readonly kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT";
  readonly sourceActionId: ActionId;
  readonly expectedThreshold: MonetaryValue;
}

export type ShippingRollbackTrigger =
  | { readonly kind: "ON_TERMINATION" }
  | { readonly kind: "AT"; readonly at: UtcTimestamp };

export type ShippingRollbackContract =
  | {
      readonly available: false;
      readonly reason: string;
    }
  | {
      readonly available: true;
      readonly strategy: ShippingRollbackStrategy;
      readonly trigger: ShippingRollbackTrigger;
      readonly delaySeconds: number;
      readonly cost: KnownOrUnknown<MonetaryValue>;
      readonly conflictGuard: ShippingRollbackConflictGuard;
    };


export type MerchandisingEntityTarget =
  | Extract<ActionTarget, { readonly kind: "sku" }>
  | Extract<ActionTarget, { readonly kind: "product" }>
  | Extract<ActionTarget, { readonly kind: "collection" }>;

export type MerchandisingSurface =
  | { readonly kind: "COLLECTION_PAGE"; readonly collectionId: string }
  | { readonly kind: "CATEGORY_PAGE"; readonly categoryId: string }
  | { readonly kind: "SEARCH_RESULTS"; readonly searchScopeId: string }
  | { readonly kind: "HOMEPAGE"; readonly areaId?: string }
  | { readonly kind: "PRODUCT_PAGE"; readonly productId: string }
  | { readonly kind: "CART"; readonly areaId?: string }
  | { readonly kind: "CHECKOUT"; readonly areaId?: string }
  | { readonly kind: "POST_PURCHASE"; readonly areaId?: string }
  | { readonly kind: "RECOMMENDATION_SLOT"; readonly slotGroupId: string }
  | { readonly kind: "CUSTOM"; readonly surfaceId: string };

export type MerchandisingPlacement =
  | { readonly kind: "POSITION"; readonly position: number }
  | { readonly kind: "NAMED_SLOT"; readonly slotId: string };

export type MerchandisingDisplacementSemantics = "SHIFT_OTHERS";

export interface MerchandisingRankingSnapshotRef {
  readonly bindingRef: string;
  readonly evaluateAt: MembershipEvaluationBoundary;
}

export type MerchandisingRankOperation =
  | {
      readonly kind: "SET";
      readonly position: number;
    }
  | {
      readonly kind: "DELTA";
      readonly direction: "UP" | "DOWN";
      readonly positions: number;
      readonly snapshot: MerchandisingRankingSnapshotRef;
    }
  | {
      readonly kind: "MOVE_TO_TOP";
      readonly snapshot?: MerchandisingRankingSnapshotRef;
    };

export type MerchandisingVisibilityMode =
  | { readonly kind: "FEATURE" }
  | {
      readonly kind: "DEPRIORITIZE";
      readonly belowPosition?: number;
    }
  | { readonly kind: "REMOVE_PLACEMENT" };

export type MerchandisingRelationshipType =
  | "SUBSTITUTE"
  | "CROSS_SELL"
  | "UPSELL";

export interface MerchandisingRelationshipTarget {
  readonly entity: Extract<
    ActionTarget,
    { readonly kind: "sku" | "product" }
  >;
  readonly position: number;
}

export type MerchandisingRelationshipTrigger =
  | { readonly kind: "ALWAYS" }
  | {
      readonly kind: "SOURCE_INVENTORY_AT_MOST";
      readonly units: number;
    }
  | {
      readonly kind: "SOURCE_OUT_OF_STOCK";
    };

export type MerchandisingConflictResolution =
  | { readonly kind: "COEXIST" }
  | { readonly kind: "PRECEDENCE"; readonly precedence: number }
  | {
      readonly kind: "MUTUALLY_EXCLUSIVE_GROUP";
      readonly groupId: string;
      readonly precedence?: number;
    };

export type MerchandisingRollbackStrategy =
  | {
      readonly kind: "RESTORE_PRE_ACTION_VALUE";
      readonly rankingSnapshotRef: string;
    }
  | {
      readonly kind: "SET_EXPLICIT_VALUE";
      readonly position: number;
    };

export interface MerchandisingRollbackConflictGuard {
  readonly kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT";
  readonly sourceActionId: ActionId;
  readonly expectedPosition: number;
}

export type MerchandisingRollbackContract =
  | {
      readonly available: false;
      readonly reason: string;
    }
  | {
      readonly available: true;
      readonly strategy: MerchandisingRollbackStrategy;
      readonly trigger:
        | { readonly kind: "ON_TERMINATION" }
        | { readonly kind: "AT"; readonly at: UtcTimestamp };
      readonly delaySeconds: number;
      readonly cost: KnownOrUnknown<MonetaryValue>;
      readonly conflictGuard: MerchandisingRollbackConflictGuard;
    };


export type InventoryAvailabilityConcept =
  | "ON_HAND"
  | "AVAILABLE_TO_SELL"
  | "RESERVED"
  | "SAFETY_STOCK";

export type InventoryMembershipSemantics = {
  readonly evaluateAt: MembershipEvaluationBoundary;
  readonly bindingRef?: string;
};

export interface InventoryLeadTimeAssumption {
  readonly durationSeconds: number;
  readonly sourceRef: string;
}

export interface InventorySupplierConstraints {
  readonly minimumOrderQuantity?: number;
  readonly orderMultiple?: number;
  readonly maximumSupplierQuantity?: number;
}

export interface InventoryProcurementEconomics {
  readonly unitProcurementCost?: MonetaryValue;
  readonly freightCost?: MonetaryValue;
  readonly fixedOrderCost?: MonetaryValue;
  readonly minimumOrderValue?: MonetaryValue;
}

export interface InventoryReorderDefinition {
  readonly sku: Extract<ActionTarget,{readonly kind:"sku"}>;
  readonly quantity: number;
  readonly supplierRelationshipId?: string;
  readonly destinationLocationId?: string;
  readonly orderPlacementTime: UtcTimestamp;
  readonly requestedDeliveryDate?: UtcTimestamp;
  readonly leadTimeAssumption?: InventoryLeadTimeAssumption;
  readonly expectedArrivalAt?: UtcTimestamp;
  readonly supplierConstraints?: InventorySupplierConstraints;
  readonly procurementEconomics?: InventoryProcurementEconomics;
}

export type InventoryTimingReference =
  | {
      readonly kind:"current_planned_reorder_at_decision";
      readonly decisionTime:UtcTimestamp;
    }
  | {
      readonly kind:"explicit_planned_reorder";
      readonly at:UtcTimestamp;
    }
  | {
      readonly kind:"baseline_snapshot";
      readonly baselineId:string;
    };

export type InventoryTimingOperation =
  | { readonly kind:"SET_DATE"; readonly at: UtcTimestamp }
  | {
      readonly kind:"DELTA_DAYS";
      readonly direction:"earlier"|"later";
      readonly days:number;
      readonly baseline: InventoryTimingReference;
    }
  | {
      readonly kind:"INVENTORY_TRIGGER";
      readonly availabilityConcept: InventoryAvailabilityConcept;
      readonly operator:"LTE"|"LT"|"EQ";
      readonly units:number;
    };

export type InventoryProtectionMode =
  | {
      readonly kind:"RESERVE_QUANTITY";
      readonly quantity:number;
      readonly fromConcept:"AVAILABLE_TO_SELL";
      readonly toConcept:"RESERVED";
    }
  | {
      readonly kind:"PROTECT_UNTIL_CONDITION";
      readonly availabilityConcept: InventoryAvailabilityConcept;
      readonly minimumUnits:number;
    };

export type InventoryBackorderPolicy =
  | { readonly kind:"ALLOW" }
  | { readonly kind:"DISALLOW" }
  | { readonly kind:"ALLOW_WITH_LIMIT"; readonly maxBackorderedUnits:number }
  | { readonly kind:"ALLOW_UNTIL_DATE"; readonly until:UtcTimestamp };

export type InventoryStrategyTarget =
  | Extract<ActionTarget,{readonly kind:"sku"}>
  | Extract<ActionTarget,{readonly kind:"product"}>
  | Extract<ActionTarget,{readonly kind:"category"}>
  | Extract<ActionTarget,{readonly kind:"collection"}>
  | Extract<ActionTarget,{readonly kind:"inventory_set"}>;

export type InventoryAccelerationTermination =
  | {
      readonly kind:"INVENTORY_AT_OR_BELOW";
      readonly availabilityConcept: InventoryAvailabilityConcept;
      readonly units:number;
    }
  | { readonly kind:"AT_DATE"; readonly at:UtcTimestamp }
  | { readonly kind:"CONDITION_REF"; readonly conditionRef:string };

export type InventoryPolicyValue =
  | {
      readonly kind:"SAFETY_STOCK";
      readonly operation:ValueOperation<QuantityValue>;
      readonly inventoryLocationId?:string;
    }
  | {
      readonly kind:"REORDER_POINT";
      readonly operation:ValueOperation<QuantityValue>;
      readonly inventoryLocationId?:string;
    };

export type InventoryRollbackValue =
  | ScalarValue
  | {
      readonly kind:"backorder_policy";
      readonly policy:InventoryBackorderPolicy;
    };

export type InventoryRollbackReference =
  | ReferenceValue
  | {
      readonly kind:"inventory_policy_snapshot";
      readonly baselineId:string;
    };

export type InventoryRollbackStrategy =
  | {
      readonly kind:"RESTORE_PRE_ACTION_VALUE";
      readonly preActionValue:InventoryRollbackReference;
    }
  | {
      readonly kind:"SET_EXPLICIT_VALUE";
      readonly value:InventoryRollbackValue;
    };

export interface InventoryRollbackConflictGuard {
  readonly kind:"REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT";
  readonly sourceActionId:ActionId;
  readonly expectedValue:InventoryRollbackValue;
}

export type InventoryRollbackContract =
  | { readonly available:false; readonly reason:string }
  | {
      readonly available:true;
      readonly strategy:InventoryRollbackStrategy;
      readonly trigger:
        | {readonly kind:"ON_TERMINATION"}
        | {readonly kind:"AT";readonly at:UtcTimestamp};
      readonly delaySeconds:number;
      readonly cost:KnownOrUnknown<MonetaryValue>;
      readonly conflictGuard:InventoryRollbackConflictGuard;
    };


export type CroSurface =
  | "SITE_WIDE"
  | "HOMEPAGE"
  | "COLLECTION"
  | "PDP"
  | "CART"
  | "CHECKOUT"
  | "SITE_SEARCH"
  | "LANDING_PAGE";

export type CroDevice = "ALL_DEVICES" | "MOBILE" | "DESKTOP";

export type CroComponent =
  | "PAGE_LAYOUT"
  | "HERO"
  | "VALUE_PROPOSITION"
  | "FEATURED_PRODUCTS"
  | "FEATURED_COLLECTIONS"
  | "PROMOTIONAL_BANNER"
  | "NAVIGATION"
  | "SOCIAL_PROOF"
  | "CONTENT_SECTION"
  | "PRODUCT_GRID"
  | "PRODUCT_CARD"
  | "FILTERS"
  | "SORTING"
  | "COLLECTION_HEADER"
  | "COLLECTION_DESCRIPTION"
  | "MERCHANDISING_BLOCK"
  | "PAGINATION"
  | "PRODUCT_GALLERY"
  | "PRODUCT_TITLE"
  | "PRICE_DISPLAY"
  | "VARIANT_SELECTOR"
  | "ADD_TO_CART"
  | "BUY_NOW"
  | "PRODUCT_DESCRIPTION"
  | "DELIVERY_INFORMATION"
  | "RETURNS_INFORMATION"
  | "REVIEWS"
  | "RECOMMENDATIONS"
  | "STOCK_INFORMATION"
  | "PAYMENT_INFORMATION"
  | "CART_ITEMS"
  | "QUANTITY_CONTROL"
  | "ORDER_SUMMARY"
  | "SHIPPING_MESSAGE"
  | "PROMOTION_ENTRY"
  | "CROSS_SELL"
  | "CHECKOUT_CTA"
  | "CONTACT_STEP"
  | "SHIPPING_STEP"
  | "PAYMENT_STEP"
  | "FORM"
  | "FIELD"
  | "ERROR_HANDLING"
  | "PROGRESS_INDICATOR"
  | "EXPRESS_PAYMENT"
  | "SEARCH_INPUT"
  | "AUTOCOMPLETE"
  | "SEARCH_RESULTS"
  | "NO_RESULTS_STATE"
  | "CTA"
  | "PRODUCT_SECTION";

export interface CroComponentTarget {
  readonly component: CroComponent;
  readonly instanceId?: string;
}

export type CroPageScope =
  | { readonly kind: "ALL_SURFACE" }
  | { readonly kind: "ALL_PDP" }
  | { readonly kind: "ALL_COLLECTIONS" }
  | { readonly kind: "PRODUCT_PDP"; readonly productId: string }
  | { readonly kind: "CATEGORY_PDP_SET"; readonly categoryId: string }
  | { readonly kind: "PAGE_TEMPLATE"; readonly templateId: string }
  | { readonly kind: "SPECIFIC_PAGE"; readonly pageId: string }
  | { readonly kind: "LANDING_PAGE"; readonly landingPageId: string };

export type CroAudience =
  | { readonly kind: "ALL_VISITORS" }
  | { readonly kind: "NEW_VISITORS" }
  | { readonly kind: "RETURNING_VISITORS" }
  | {
      readonly kind: "CUSTOMER_SEGMENT";
      readonly segmentId: string;
      readonly membership: {
        readonly evaluateAt: MembershipEvaluationBoundary;
        readonly bindingRef?: string;
      };
    };

export type CroModifiableDimension =
  | "POSITION"
  | "PROMINENCE"
  | "CONTENT_STRUCTURE"
  | "INTERACTION"
  | "VISUAL_HIERARCHY"
  | "LAYOUT"
  | "DENSITY"
  | "PERSISTENCE"
  | "REQUIRED_FIELDS"
  | "STEP_STRUCTURE"
  | "ERROR_PRESENTATION"
  | "PAYMENT_PRESENTATION"
  | "PROGRESS_COMMUNICATION"
  | "INFORMATION_HIERARCHY"
  | "LOAD_PERFORMANCE"
  | "INTERACTION_LATENCY"
  | "IMAGE_LOADING"
  | "NAVIGATION_STRUCTURE"
  | "FILTER_CONFIGURATION"
  | "SORT_CONTROL_PRESENTATION"
  | "NO_RESULTS_HANDLING"
  | "AUTOCOMPLETE"
  | "SHIPPING_MESSAGE_PRESENTATION"
  | "PROMOTION_MESSAGE_PRESENTATION";

export type CroInterventionKind =
  | "ADD"
  | "REMOVE"
  | "REORDER"
  | "MODIFY_PRESENTATION"
  | "MODIFY_INTERACTION"
  | "MODIFY_NAVIGATION"
  | "MODIFY_SEARCH"
  | "MODIFY_CHECKOUT"
  | "MODIFY_PERFORMANCE";

export interface CroOrderingSnapshotRef {
  readonly bindingRef: string;
  readonly evaluateAt: MembershipEvaluationBoundary;
}

export type CroOrderingOperation =
  | {
      readonly kind: "SET_POSITION";
      readonly position: number;
    }
  | {
      readonly kind: "PLACE_BEFORE";
      readonly referenceComponent: CroComponentTarget;
      readonly snapshot: CroOrderingSnapshotRef;
    }
  | {
      readonly kind: "PLACE_AFTER";
      readonly referenceComponent: CroComponentTarget;
      readonly snapshot: CroOrderingSnapshotRef;
    };

export type CroAddSemantics =
  | { readonly kind: "REQUIRE_ABSENT" }
  | { readonly kind: "ALLOW_ADDITIONAL_INSTANCE"; readonly instanceId: string };

export type CroConflictResolution =
  | { readonly kind: "COEXIST" }
  | { readonly kind: "PRECEDENCE"; readonly precedence: number }
  | {
      readonly kind: "MUTUALLY_EXCLUSIVE_GROUP";
      readonly groupId: string;
      readonly precedence?: number;
    };

export type CroCapability =
  | "ADD_COMPONENT"
  | "REMOVE_COMPONENT"
  | "REORDER_COMPONENTS"
  | "MODIFY_PRESENTATION"
  | "MODIFY_INTERACTION"
  | "MODIFY_NAVIGATION"
  | "MODIFY_SEARCH_EXPERIENCE"
  | "MODIFY_CHECKOUT_EXPERIENCE"
  | "MODIFY_PERFORMANCE"
  | "AUTOCOMPLETE"
  | "FILTERS"
  | "SORTING"
  | "NO_RESULTS_EXPERIENCE";

export type CroRollbackStrategy =
  | {
      readonly kind: "RESTORE_PRE_ACTION_VALUE";
      readonly stateSnapshotRef: string;
    }
  | {
      readonly kind: "SET_EXPLICIT_VALUE";
      readonly stateRef: string;
    };

export interface CroRollbackConflictGuard {
  readonly kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT";
  readonly sourceActionId: ActionId;
  readonly expectedStateRef: string;
}

export type CroRollbackContract =
  | {
      readonly available: false;
      readonly reason: string;
    }
  | {
      readonly available: true;
      readonly strategy: CroRollbackStrategy;
      readonly trigger:
        | { readonly kind: "ON_TERMINATION" }
        | { readonly kind: "AT"; readonly at: UtcTimestamp };
      readonly delaySeconds: number;
      readonly cost: KnownOrUnknown<MonetaryValue>;
      readonly conflictGuard: CroRollbackConflictGuard;
    };


export type LifecycleChannel =
  | { readonly kind: "EMAIL" }
  | { readonly kind: "SMS" }
  | { readonly kind: "CUSTOM"; readonly channelId: string };

export type LifecyclePurpose =
  | { readonly kind: "GENERAL_CAMPAIGN" }
  | { readonly kind: "WELCOME" }
  | { readonly kind: "WINBACK" }
  | { readonly kind: "POST_PURCHASE" }
  | { readonly kind: "REPLENISHMENT" }
  | { readonly kind: "RETENTION" }
  | { readonly kind: "BROWSE_ABANDONMENT" }
  | { readonly kind: "CART_ABANDONMENT" }
  | { readonly kind: "BACK_IN_STOCK" }
  | { readonly kind: "PRICE_DROP" }
  | { readonly kind: "LOYALTY" }
  | { readonly kind: "CUSTOM"; readonly purposeId: string };

export type LifecycleMembershipBoundary =
  | "DECISION_TIME"
  | "SEND_TIME"
  | "TRIGGER_TIME";

export interface LifecycleMembershipSemantics {
  readonly evaluateAt: LifecycleMembershipBoundary;
  readonly bindingRef?: string;
}

export type LifecycleAudienceSelector =
  | {
      readonly kind: "CUSTOMER_SEGMENT";
      readonly segmentId: string;
      readonly membership: LifecycleMembershipSemantics;
    }
  | {
      readonly kind: "PURCHASE_COUNT_EQUALS";
      readonly count: number;
    }
  | {
      readonly kind: "PURCHASE_COUNT_AT_LEAST";
      readonly count: number;
    }
  | {
      readonly kind: "ALL_ELIGIBLE_CONTACTS";
    };

export type LifecycleSuppressionRule =
  | {
      readonly kind: "RECENT_PURCHASE_WITHIN";
      readonly days: number;
    }
  | {
      readonly kind: "CURRENT_FLOW_MEMBERSHIP";
      readonly flowId: string;
    }
  | {
      readonly kind: "CUSTOMER_SEGMENT";
      readonly segmentId: string;
      readonly membership: LifecycleMembershipSemantics;
    }
  | {
      readonly kind: "CHANNEL_SUPPRESSED";
      readonly channel: LifecycleChannel;
    }
  | {
      readonly kind: "CONTACT_POLICY_BLOCK";
      readonly contactPolicyId: string;
    };

export interface LifecycleAudienceDefinition {
  readonly include: readonly LifecycleAudienceSelector[];
  readonly suppress: readonly LifecycleSuppressionRule[];
  readonly suppressionPrecedence: "SUPPRESS_OVERRIDES_INCLUDE";
}

export interface LifecycleChannelEligibility {
  readonly requireConsent: boolean;
  readonly requireValidDestination: boolean;
  readonly requireNotChannelSuppressed: boolean;
}

export type LifecycleEvent =
  | { readonly kind: "ORDER_PLACED" }
  | { readonly kind: "ORDER_FULFILLED" }
  | { readonly kind: "ORDER_DELIVERED" }
  | { readonly kind: "CUSTOMER_CREATED" }
  | {
      readonly kind: "PRODUCT_PURCHASED";
      readonly productId: string;
    }
  | {
      readonly kind: "CUSTOM";
      readonly eventId: string;
    };

export type LifecycleSendTiming =
  | {
      readonly kind: "ABSOLUTE_TIME";
      readonly at: UtcTimestamp;
      readonly timezone: string;
    }
  | {
      readonly kind: "RELATIVE_TO_EVENT";
      readonly event: LifecycleEvent;
      readonly delaySeconds: number;
    }
  | {
      readonly kind: "RECURRING_CADENCE";
      readonly cadence: {
        readonly count: number;
        readonly windowSeconds: number;
      };
      readonly timezone: string;
    };

export type LifecycleFlowTrigger =
  | {
      readonly kind: "METRIC_THRESHOLD";
      readonly metric:
        | "DAYS_SINCE_LAST_PURCHASE"
        | "DAYS_SINCE_LAST_ENGAGEMENT";
      readonly operator: "GTE" | "GT" | "EQ";
      readonly value: number;
    }
  | {
      readonly kind: "EVENT";
      readonly event: LifecycleEvent;
    }
  | {
      readonly kind: "AUDIENCE_ENTRY";
    };

export type LifecycleStepContinuation =
  | { readonly kind: "CONTINUE_IF_ELIGIBLE" }
  | { readonly kind: "CONTINUE_IF_NO_PURCHASE" };

export type LifecycleExitCondition =
  | { readonly kind: "PURCHASE_OCCURRED" }
  | { readonly kind: "CUSTOMER_INELIGIBLE" }
  | {
      readonly kind: "EVENT_OCCURRED";
      readonly event: LifecycleEvent;
    };

export interface LifecycleSequenceStep {
  readonly stepId: string;
  readonly position: number;
  readonly channel: LifecycleChannel;
  readonly delaySeconds: number;
  readonly eligibility: LifecycleChannelEligibility;
  readonly suppress: readonly LifecycleSuppressionRule[];
  readonly continuation: LifecycleStepContinuation;
  readonly exitConditions: readonly LifecycleExitCondition[];
}

export type LifecycleFlowConflictResolution =
  | { readonly kind: "COEXIST" }
  | { readonly kind: "PRECEDENCE"; readonly precedence: number }
  | {
      readonly kind: "MUTUALLY_EXCLUSIVE_GROUP";
      readonly groupId: string;
      readonly precedence?: number;
    }
  | {
      readonly kind: "SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS";
    };

export interface LifecycleFlowDefinition {
  readonly flowId: string;
  readonly purpose: LifecyclePurpose;
  readonly audience: LifecycleAudienceDefinition;
  readonly trigger: LifecycleFlowTrigger;
  readonly sequence: readonly LifecycleSequenceStep[];
  readonly exitConditions: readonly LifecycleExitCondition[];
  readonly contactPolicyRefs: readonly string[];
  readonly conflictResolution: LifecycleFlowConflictResolution;
}

export type LifecycleFlowModification =
  | {
      readonly kind: "SET_TRIGGER";
      readonly trigger: LifecycleFlowTrigger;
    }
  | {
      readonly kind: "SET_STEP_DELAY";
      readonly stepId: string;
      readonly delaySeconds: number;
    }
  | {
      readonly kind: "ADD_STEP";
      readonly step: LifecycleSequenceStep;
    }
  | {
      readonly kind: "REMOVE_STEP";
      readonly stepId: string;
    };

export interface LifecycleFrequencyValue {
  readonly count: number;
  readonly windowSeconds: number;
}

export type LifecycleFrequencyReference =
  | {
      readonly kind: "current_policy_at_decision";
      readonly decisionTime: UtcTimestamp;
    }
  | {
      readonly kind: "baseline_snapshot";
      readonly baselineId: string;
    }
  | {
      readonly kind: "explicit_baseline";
      readonly value: LifecycleFrequencyValue;
    };

export type LifecycleFrequencyOperation =
  | {
      readonly kind: "SET";
      readonly value: LifecycleFrequencyValue;
    }
  | {
      readonly kind: "DELTA";
      readonly direction: "increase" | "decrease";
      readonly amount: LifecycleFrequencyValue;
      readonly reference: LifecycleFrequencyReference;
    }
  | {
      readonly kind: "MULTIPLY";
      readonly factor: number;
      readonly reference: LifecycleFrequencyReference;
    };

export type LifecycleFrequencyPolicy =
  | {
      readonly kind: "PLANNED_CADENCE";
      readonly channel: LifecycleChannel;
      readonly purpose?: LifecyclePurpose;
      readonly operation: LifecycleFrequencyOperation;
    }
  | {
      readonly kind: "CONTACT_CAP";
      readonly channels: readonly LifecycleChannel[];
      readonly maximumContacts: number;
      readonly windowSeconds: number;
    }
  | {
      readonly kind: "MINIMUM_INTERVAL";
      readonly channels: readonly LifecycleChannel[];
      readonly minimumIntervalSeconds: number;
    };

export type LifecyclePolicyRollbackValue =
  | {
      readonly kind: "FREQUENCY_POLICY";
      readonly policy: LifecycleFrequencyPolicy;
    };

export type LifecyclePolicyRollbackReference =
  | {
      readonly kind: "lifecycle_policy_snapshot";
      readonly baselineId: string;
    }
  | {
      readonly kind: "explicit_policy";
      readonly value: LifecyclePolicyRollbackValue;
    };

export type LifecycleRollbackStrategy =
  | {
      readonly kind: "RESTORE_PRE_ACTION_VALUE";
      readonly preActionValue: LifecyclePolicyRollbackReference;
    }
  | {
      readonly kind: "SET_EXPLICIT_VALUE";
      readonly value: LifecyclePolicyRollbackValue;
    };

export interface LifecycleRollbackConflictGuard {
  readonly kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT";
  readonly sourceActionId: ActionId;
  readonly expectedValue: LifecyclePolicyRollbackValue;
}

export type LifecycleRollbackContract =
  | {
      readonly available: false;
      readonly reason: string;
    }
  | {
      readonly available: true;
      readonly strategy: LifecycleRollbackStrategy;
      readonly trigger:
        | { readonly kind: "ON_TERMINATION" }
        | { readonly kind: "AT"; readonly at: UtcTimestamp };
      readonly delaySeconds: number;
      readonly cost: KnownOrUnknown<MonetaryValue>;
      readonly conflictGuard: LifecycleRollbackConflictGuard;
    };

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
      readonly kind:"inventory_reorder";
      readonly reorder:InventoryReorderDefinition;
    }
  | {
      readonly kind:"inventory_reorder_quantity";
      readonly operation:ValueOperation<QuantityValue>;
      readonly supplierConstraints?:InventorySupplierConstraints;
    }
  | {
      readonly kind:"inventory_reorder_timing";
      readonly operation:InventoryTimingOperation;
      readonly leadTimeAssumption?:InventoryLeadTimeAssumption;
    }
  | {
      readonly kind:"inventory_policy_control";
      readonly policy:InventoryPolicyValue;
    }
  | {
      readonly kind:"inventory_protection";
      readonly mode:InventoryProtectionMode;
      readonly inventoryLocationId?:string;
      readonly coordinatedActionIds?:readonly ActionId[];
    }
  | {
      readonly kind:"inventory_backorder_policy";
      readonly policy:InventoryBackorderPolicy;
      readonly customerPromiseRef?:string;
      readonly geographicScopeRef?:string;
    }
  | {
      readonly kind:"inventory_clearance";
      readonly target:InventoryStrategyTarget;
      readonly reasonCode:string;
      readonly membership?:InventoryMembershipSemantics;
      readonly coordinatedActionIds?:readonly ActionId[];
    }
  | {
      readonly kind:"inventory_acceleration";
      readonly target:InventoryStrategyTarget;
      readonly availabilityConcept:InventoryAvailabilityConcept;
      readonly startingCondition:{
        readonly operator:"GT"|"GTE";
        readonly units:number;
      };
      readonly termination:InventoryAccelerationTermination;
      readonly membership?:InventoryMembershipSemantics;
      readonly coordinatedActionIds?:readonly ActionId[];
    }
  | {
      readonly kind:"inventory_policy_rollback";
      readonly originalActionId:ActionId;
      readonly strategy:InventoryRollbackStrategy;
      readonly conflictGuard:InventoryRollbackConflictGuard;
    }
  | {
      readonly kind: "frequency_adjustment";
      readonly operation: ValueOperation<FrequencyValue>;
      readonly policy?: never;
    }
  | {
      readonly kind: "frequency_adjustment";
      readonly policy: LifecycleFrequencyPolicy;
      readonly operation?: never;
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
      readonly kind: "merchandising_visibility";
      readonly entity: MerchandisingEntityTarget;
      readonly surface: MerchandisingSurface;
      readonly placementId?: string;
      readonly placement?: MerchandisingPlacement;
      readonly visibility: MerchandisingVisibilityMode;
      readonly conflictResolution: MerchandisingConflictResolution;
    }
  | {
      readonly kind: "merchandising_rank";
      readonly entity: MerchandisingEntityTarget;
      readonly surface: MerchandisingSurface;
      readonly operation: MerchandisingRankOperation;
      readonly displacement: MerchandisingDisplacementSemantics;
      readonly conflictResolution: MerchandisingConflictResolution;
    }
  | {
      readonly kind: "merchandising_relationship";
      readonly relationshipType: MerchandisingRelationshipType;
      readonly source: Extract<ActionTarget, { readonly kind: "sku" | "product" }>;
      readonly targets: readonly MerchandisingRelationshipTarget[];
      readonly surface: MerchandisingSurface;
      readonly trigger: MerchandisingRelationshipTrigger;
      readonly conflictResolution: MerchandisingConflictResolution;
    }
  | {
      readonly kind: "merchandising_remove_placement";
      readonly placementId: string;
      readonly surface: MerchandisingSurface;
    }
  | {
      readonly kind: "merchandising_remove_relationship";
      readonly relationshipId: string;
      readonly relationshipType: MerchandisingRelationshipType;
    }
  | {
      readonly kind: "merchandising_rank_rollback";
      readonly originalActionId: ActionId;
      readonly strategy: MerchandisingRollbackStrategy;
      readonly conflictGuard: MerchandisingRollbackConflictGuard;
    }
  | {
      readonly kind: "shipping_policy";
      readonly setting: string;
      readonly operation: ValueOperation<ScalarValue>;
    }
  | {
      readonly kind: "shipping_offer_set";
      readonly shippingOfferId: string;
      readonly definition: ShippingOfferDefinition;
    }
  | {
      readonly kind: "shipping_offer_modify";
      readonly targetShippingOfferId: string;
      readonly definition: ShippingOfferDefinition;
    }
  | {
      readonly kind: "shipping_offer_stop";
      readonly targetShippingOfferId: string;
    }
  | {
      readonly kind: "shipping_policy_adjustment";
      readonly definition: ShippingThresholdPolicyDefinition;
    }
  | {
      readonly kind: "shipping_policy_rollback";
      readonly originalActionId: ActionId;
      readonly strategy: ShippingRollbackStrategy;
      readonly conflictGuard: ShippingRollbackConflictGuard;
    }
  | {
      readonly kind: "page_change";
      readonly changeId: string;
      readonly variantRef: string;
    }
  | {
      readonly kind: "cro_intervention";
      readonly surface: CroSurface;
      readonly component: CroComponentTarget;
      readonly intervention: CroInterventionKind;
      readonly pageScope: CroPageScope;
      readonly device: CroDevice;
      readonly audience: CroAudience;
      readonly modifiableDimensions: readonly CroModifiableDimension[];
      readonly ordering?: CroOrderingOperation;
      readonly addSemantics?: CroAddSemantics;
      readonly requiredCapabilities: readonly CroCapability[];
      readonly conflictResolution: CroConflictResolution;
    }
  | {
      readonly kind: "cro_rollback";
      readonly originalActionId: ActionId;
      readonly strategy: CroRollbackStrategy;
      readonly conflictGuard: CroRollbackConflictGuard;
    }
  | {
      readonly kind: "lifecycle_send";
      readonly channel: LifecycleChannel;
      readonly purpose: LifecyclePurpose;
      readonly audience: LifecycleAudienceDefinition;
      readonly timing: LifecycleSendTiming;
      readonly eligibility: LifecycleChannelEligibility;
      readonly contactPolicyRefs: readonly string[];
      readonly coordinatedActionIds?: readonly ActionId[];
    }
  | {
      readonly kind: "lifecycle_flow_start";
      readonly definition: LifecycleFlowDefinition;
      readonly coordinatedActionIds?: readonly ActionId[];
    }
  | {
      readonly kind: "lifecycle_flow_stop";
      readonly targetFlowId: string;
      readonly stopSemantics: "PREVENT_FUTURE_TRIGGERED_COMMUNICATIONS";
    }
  | {
      readonly kind: "lifecycle_flow_modify";
      readonly targetFlowId: string;
      readonly modifications: readonly LifecycleFlowModification[];
    }
  | {
      readonly kind: "lifecycle_targeting";
      readonly audience: LifecycleAudienceDefinition;
    }
  | {
      readonly kind: "lifecycle_policy_rollback";
      readonly originalActionId: ActionId;
      readonly strategy: LifecycleRollbackStrategy;
      readonly conflictGuard: LifecycleRollbackConflictGuard;
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
        | "TRACKING_AUDIT"
        | "DATA_QUALITY_CHECK"
        | "MISSING_DATA_REQUEST"
        | "ANOMALY_DIAGNOSIS"
        | "METRIC_RECONCILIATION"
        | "BUSINESS_PROCESS_CHECK"
        | "MEASUREMENT_VALIDATION"
        | "custom";
      readonly question: string;
      readonly requestedEvidenceRefs: readonly string[];
      readonly targetRef?: string;
      readonly sourceRef?: string;
      readonly metricRef?: string;
      readonly suspectedIssueClass?: string;
      readonly observationWindow?: { readonly start: UtcTimestamp; readonly end: UtcTimestamp };
      readonly comparisonWindow?: { readonly start: UtcTimestamp; readonly end: UtcTimestamp };
      readonly anomalyDirection?: "increase" | "decrease" | "discrepancy";
      readonly successCriteria?: readonly string[];
      readonly maximumInvestigationHorizonSeconds?: number;
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
  readonly shippingRollback?: ShippingRollbackContract;
  readonly merchandisingRollback?: MerchandisingRollbackContract;
  readonly inventoryRollback?: InventoryRollbackContract;
  readonly croRollback?: CroRollbackContract;
  readonly lifecycleRollback?: LifecycleRollbackContract;
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
  "engagement",
  "experience_performance",
  "messaging_delivery",
  "subscription_status",
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
 * Legacy Step 1 readiness contract.
 *
 * @deprecated Step 13's canonical composition model is exported from
 * `./compound-action`. This minimal ID-list shape remains only so historical
 * Step 1–10 artifacts and translators retain their original schema meaning.
 * New coordinated decisions must use the Step 13 CompoundAction contract.
 */
export interface CompoundAction {
  readonly kind: "compound_action";
  readonly compoundActionId: ActionId;
  readonly schemaVersion: ActionSchemaVersion;
  readonly description: string;
  readonly componentActionIds: readonly ActionId[];
}

export type LegacyCompoundActionReadinessContract = CompoundAction;

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
