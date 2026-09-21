import type {
  ActionAtomicity,
  ActionCategory,
  AtomicActionTarget,
} from "./types.js";

export interface ActionTypeContract {
  readonly actionType: string;
  readonly category: ActionCategory;
  readonly atomicity: ActionAtomicity;
  readonly allowedTargetKinds: readonly (
    | AtomicActionTarget["kind"]
    | "compound"
  )[];
  readonly requiredParameterIds: readonly string[];
}

/**
 * Initial ecommerce action vocabulary. The canonical Action contract does not
 * depend on this fixed list: new namespaced action types can be registered
 * without changing the Action shape.
 */
export const CORE_ACTION_TYPE_CONTRACTS: readonly ActionTypeContract[] = [
  {
    actionType: "paid_media.adjust_budget",
    category: "paid_media",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["campaign", "advertising_channel"],
    requiredParameterIds: ["budget_change"],
  },
  {
    actionType: "paid_media.pause_campaign",
    category: "paid_media",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["campaign"],
    requiredParameterIds: ["state_change"],
  },
  {
    actionType: "pricing.adjust_product_price",
    category: "pricing",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["price"],
    requiredParameterIds: ["price_change"],
  },
  {
    actionType: "promotions.collection_discount",
    category: "promotions",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["collection"],
    requiredParameterIds: ["discount_rate"],
  },
  {
    actionType: "crm.adjust_campaign_frequency",
    category: "email_sms_crm",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["email_campaign"],
    requiredParameterIds: ["frequency_change"],
  },
  {
    actionType: "merchandising.move_collection_position",
    category: "merchandising",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["merchandising_placement"],
    requiredParameterIds: ["position_change"],
  },
  {
    actionType: "paid_media.reallocate_budget",
    category: "paid_media",
    atomicity: "COMPOUND",
    allowedTargetKinds: ["compound"],
    requiredParameterIds: ["transfer_amount"],
  },
  {
    actionType: "paid_media.stop_product_advertising",
    category: "paid_media",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["product", "sku"],
    requiredParameterIds: ["state_change"],
  },
  {
    actionType: "paid_media.adjust_product_budget",
    category: "paid_media",
    atomicity: "ATOMIC",
    allowedTargetKinds: ["product", "sku"],
    requiredParameterIds: ["budget_change"],
  },
] as const;

export const CORE_CONSTRAINT_PROPERTIES = [
  "inventory.available_units",
  "inventory.sellable_units",
  "inventory.stock_coverage_days",
  "finance.maximum_budget_minor",
  "finance.minimum_margin_rate",
  "paid_media.channel_spend_minor",
  "paid_media.campaign_spend_minor",
  "paid_media.contract_allows_change",
  "audience.size",
  "promotion.product_excluded",
  "operations.fulfillment_capacity_units_per_day",
  "data.is_available",
  "product.gross_margin_rate",
  "product.expected_contribution_per_unit_minor",
  "product.structural_demand_units_per_day",
  "product.structural_desirability_index",
  "product.substitution_product_ids",
  "product.complementary_product_ids",
  "product.return_rate",
  "product.shipping_cost_per_unit_minor",
  "product.fulfillment_cost_per_unit_minor",
] as const;

export function getCoreActionTypeContract(
  actionType: string,
): ActionTypeContract | undefined {
  return CORE_ACTION_TYPE_CONTRACTS.find(
    (contract) => contract.actionType === actionType,
  );
}
