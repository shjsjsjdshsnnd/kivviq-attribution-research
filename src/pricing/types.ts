import type {
  Action,
  MonetaryValue,
} from "../action_ontology/types.js";

export interface PricingRollbackStateContext {
  readonly currentPrice?: MonetaryValue;
  readonly currentPriceSourceRef?: string;
  readonly currentMembershipStateRef?: string;
  readonly preActionPrice?: MonetaryValue;
  readonly preActionPriceSourceRef?: string;
  readonly preActionMembershipBindingRef?: string;
}

export type PricingRollbackReadiness =
  | {
      readonly status: "READY";
      readonly rollbackActionId: string;
      readonly originalActionId: string;
      readonly resolution:
        | {
            readonly kind: "single_price";
            readonly rollbackPrice: MonetaryValue;
            readonly sourceRef: string;
          }
        | {
            readonly kind: "membership_snapshot";
            readonly bindingRef: string;
          };
    }
  | {
      readonly status: "CONFLICT";
      readonly rollbackActionId: string;
      readonly code: "CURRENT_STATE_CHANGED_AFTER_ORIGINAL_ACTION";
      readonly message: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly rollbackActionId: string;
      readonly code:
        | "MISSING_CURRENT_PRICE"
        | "MISSING_CURRENT_MEMBERSHIP_STATE"
        | "MISSING_PRE_ACTION_PRICE"
        | "MISSING_PRE_ACTION_MEMBERSHIP";
      readonly message: string;
    }
  | {
      readonly status: "INVALID_ACTION";
      readonly code: string;
      readonly message: string;
    };

export interface PricingMembershipReplay {
  readonly pricingAction: Action;
  readonly membershipBindingRef: string;
}
