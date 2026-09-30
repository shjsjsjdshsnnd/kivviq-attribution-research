import type {
  Action,
  CompoundAction,
  MonetaryRateValue,
} from "../action_ontology/types.js";

export type PaidMediaFundingPolicy =
  | { readonly kind: "pure_reallocation" }
  | {
      readonly kind: "incremental_funding";
      readonly amount: MonetaryRateValue;
    }
  | {
      readonly kind: "budget_removal";
      readonly amount: MonetaryRateValue;
    };

export interface PaidMediaReallocationBundle {
  readonly kind: "paid_media_reallocation_bundle";
  readonly compoundAction: CompoundAction;
  readonly components: readonly Action[];
  readonly fundingPolicy: PaidMediaFundingPolicy;
}
