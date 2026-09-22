import type {
  Action,
  MonetaryValue,
  PromotionDefinition,
  PromotionStackingType,
} from "../action_ontology/types.js";

export interface PromotionProductFacts {
  readonly skuId?: string;
  readonly productId?: string;
  readonly categoryIds?: readonly string[];
  readonly collectionIds?: readonly string[];
  readonly productSetIds?: readonly string[];
  readonly brandId?: string;
  readonly isClearance?: boolean;
}

export interface PromotionCustomerFacts {
  readonly lifecycle?: "new" | "returning";
  readonly segmentIds?: readonly string[];
  readonly emailSubscriber?: boolean;
  readonly loyaltySegmentIds?: readonly string[];
}

export interface PromotionCartLine {
  readonly skuId?: string;
  readonly productId?: string;
  readonly categoryIds?: readonly string[];
  readonly collectionIds?: readonly string[];
  readonly productSetIds?: readonly string[];
  readonly brandId?: string;
  readonly quantity: number;
}

export interface PromotionCartFacts {
  readonly subtotal: MonetaryValue;
  readonly lines: readonly PromotionCartLine[];
}

export interface PromotionRedemptionFacts {
  readonly totalRedemptions?: number;
  readonly customerRedemptions?: number;
  readonly promotionalExposure?: MonetaryValue;
}

export interface PromotionEligibilityContext {
  readonly product?: PromotionProductFacts;
  readonly inventoryUnitsBySelector?: Readonly<Record<string, number>>;
  readonly customer?: PromotionCustomerFacts;
  readonly cart?: PromotionCartFacts;
  readonly redemption?: PromotionRedemptionFacts;
  readonly hardConstraintResults?: Readonly<
    Record<string, "satisfied" | "violated" | "unknown">
  >;
  readonly activePromotionTypes?: readonly PromotionStackingType[];
}

export interface PromotionEligibilityDecision {
  readonly status: "eligible" | "ineligible" | "unknown";
  readonly reasonCodes: readonly string[];
  readonly missingInformation: readonly string[];
}

export type PromotionConflictAssessment =
  | {
      readonly status: "STACKABLE";
    }
  | {
      readonly status: "RESOLVABLE";
      readonly strategy:
        | "PRIORITY"
        | "BEST_DISCOUNT"
        | "MUTUALLY_EXCLUSIVE_GROUP";
      readonly winnerPromotionId?: string;
      readonly groupId?: string;
    }
  | {
      readonly status: "AMBIGUOUS";
      readonly code: "NON_STACKABLE_OVERLAP_WITHOUT_RESOLUTION";
    };

export interface PromotionPair {
  readonly left: Action;
  readonly right: Action;
}

export interface PromotionDefinitionRef {
  readonly promotionId: string;
  readonly definition: PromotionDefinition;
}
