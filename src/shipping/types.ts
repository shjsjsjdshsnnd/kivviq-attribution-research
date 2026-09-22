import type { Action, MonetaryValue, ShippingServiceSelector } from "../action_ontology/types.js";

export interface ShippingGeographyFacts {
  readonly countryCode?: string;
  readonly regionCode?: string;
  readonly shippingZoneIds?: readonly string[];
  readonly postalRegionIds?: readonly string[];
  readonly merchantShippingZoneIds?: readonly string[];
}

export interface ShippingProductFacts {
  readonly skuId?: string;
  readonly productId?: string;
  readonly categoryIds?: readonly string[];
  readonly collectionIds?: readonly string[];
  readonly productSetIds?: readonly string[];
  readonly brandId?: string;
  readonly oversized?: boolean;
  readonly freightOnly?: boolean;
  readonly whiteGloveOnly?: boolean;
  readonly shippingClassIds?: readonly string[];
}

export interface ShippingCustomerFacts {
  readonly lifecycle?: "new" | "returning";
  readonly segmentIds?: readonly string[];
  readonly loyaltySegmentIds?: readonly string[];
}

export interface ShippingCartLine extends ShippingProductFacts {
  readonly quantity: number;
  readonly preDiscountLineSubtotal?: MonetaryValue;
  readonly postDiscountLineSubtotal?: MonetaryValue;
}

export interface ShippingCartFacts {
  readonly preDiscountSubtotal: MonetaryValue;
  readonly postDiscountSubtotal: MonetaryValue;
  readonly qualifyingProductSubtotal?: MonetaryValue;
  readonly lines: readonly ShippingCartLine[];
}

export interface ShippingEligibilityContext {
  readonly geography?: ShippingGeographyFacts;
  readonly product?: ShippingProductFacts;
  readonly selectedService?: ShippingServiceSelector;
  readonly customer?: ShippingCustomerFacts;
  readonly cart?: ShippingCartFacts;
  readonly hardConstraintResults?: Readonly<Record<string,"satisfied"|"violated"|"unknown">>;
  readonly availableMembershipBindingRefs?: readonly string[];
}

export interface ShippingEligibilityDecision {
  readonly status: "eligible" | "ineligible" | "unknown";
  readonly reasonCodes: readonly string[];
  readonly missingInformation: readonly string[];
}

export interface ShippingRollbackStateContext {
  readonly currentThreshold?: MonetaryValue;
  readonly preActionThreshold?: MonetaryValue;
  readonly preActionThresholdSourceRef?: string;
}

export type ShippingRollbackReadiness =
  | { readonly status:"READY"; readonly rollbackActionId:string; readonly originalActionId:string; readonly threshold:MonetaryValue; readonly sourceRef:string }
  | { readonly status:"CONFLICT"; readonly rollbackActionId:string; readonly code:"CURRENT_THRESHOLD_CHANGED_AFTER_ORIGINAL_ACTION"; readonly message:string }
  | { readonly status:"MISSING_CONTEXT"; readonly rollbackActionId:string; readonly code:"MISSING_CURRENT_THRESHOLD"|"MISSING_PRE_ACTION_THRESHOLD"; readonly message:string }
  | { readonly status:"INVALID_ACTION"; readonly code:string; readonly message:string };

export type ShippingConflictAssessment =
  | { readonly status:"COEXIST" }
  | { readonly status:"RESOLVABLE"; readonly strategy:"PRECEDENCE"|"BEST_BENEFIT"|"MUTUALLY_EXCLUSIVE_GROUP"; readonly winnerShippingOfferId?:string; readonly groupId?:string }
  | { readonly status:"AMBIGUOUS"; readonly code:"NON_STACKABLE_SHIPPING_OVERLAP_WITHOUT_RESOLUTION" };
