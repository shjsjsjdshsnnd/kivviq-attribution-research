import type {
  ActionCategory,
  ActionParameters,
  ActionTarget,
} from "./types.js";

export interface ActionTypeContract {
  readonly actionType: string;
  readonly category: ActionCategory;
  readonly allowedTargetKinds: readonly ActionTarget["kind"][];
  readonly parameterKind: ActionParameters["kind"];
}

export const CORE_ACTION_TYPE_CONTRACTS: readonly ActionTypeContract[] = [
  {
    actionType: "advertising.adjust_budget",
    category: "advertising",
    allowedTargetKinds: ["advertising_channel", "campaign"],
    parameterKind: "budget_adjustment",
  },
  {
    actionType: "advertising.pause_campaign",
    category: "advertising",
    allowedTargetKinds: ["campaign"],
    parameterKind: "toggle",
  },
  {
    actionType: "pricing.adjust_price",
    category: "pricing",
    allowedTargetKinds: ["product", "sku"],
    parameterKind: "price_adjustment",
  },
  {
    actionType: "promotion.apply_discount",
    category: "promotion",
    allowedTargetKinds: ["product", "sku", "category", "collection"],
    parameterKind: "promotion",
  },
  {
    actionType: "shipping.change_policy",
    category: "shipping",
    allowedTargetKinds: ["shipping_policy", "merchant"],
    parameterKind: "shipping_policy",
  },
  {
    actionType: "merchandising.move_product",
    category: "merchandising",
    allowedTargetKinds: ["collection", "product"],
    parameterKind: "merchandising_position",
  },
  {
    actionType: "inventory.adjust_policy",
    category: "inventory",
    allowedTargetKinds: ["inventory_policy", "sku"],
    parameterKind: "inventory",
  },
  {
    actionType: "cro.change_page",
    category: "cro",
    allowedTargetKinds: ["page", "funnel_stage"],
    parameterKind: "page_change",
  },
  {
    actionType: "lifecycle.adjust_frequency",
    category: "lifecycle",
    allowedTargetKinds: ["lifecycle_program", "customer_segment"],
    parameterKind: "frequency_adjustment",
  },
  {
    actionType: "customer_targeting.set_segment",
    category: "customer_targeting",
    allowedTargetKinds: ["customer_segment", "audience"],
    parameterKind: "segment_targeting",
  },
  {
    actionType: "experimentation.run_experiment",
    category: "experimentation",
    allowedTargetKinds: ["experiment"],
    parameterKind: "run_experiment",
  },
  {
    actionType: "investigation.inspect",
    category: "investigation",
    allowedTargetKinds: ["merchant", "funnel_stage", "page", "advertising_channel"],
    parameterKind: "investigate",
  },
  {
    actionType: "operational.change_setting",
    category: "operational",
    allowedTargetKinds: ["merchant", "inventory_policy", "shipping_policy"],
    parameterKind: "toggle",
  },
  {
    actionType: "no_op.do_nothing",
    category: "no_op",
    allowedTargetKinds: ["merchant"],
    parameterKind: "no_op",
  },
  {
    actionType: "no_op.wait_observe",
    category: "no_op",
    allowedTargetKinds: ["merchant", "advertising_channel", "campaign", "product", "sku"],
    parameterKind: "wait_observe",
  },
] as const;

export const CORE_CONSTRAINT_PROPERTIES = [
  "budget.available_minor",
  "budget.channel_available_minor",
  "price.floor_minor",
  "promotion.maximum_discount_rate",
  "inventory.available_units",
  "inventory.sellable_units",
  "inventory.stock_coverage_days",
  "channel.exists",
  "campaign.exists",
  "product.exists",
  "product.active",
  "sku.exists",
  "experiment.eligible_traffic_sessions",
  "experiment.infrastructure_available",
  "lifecycle.audience_exists",
  "shipping.backorders_supported",
  "finance.gross_margin_rate",
  "finance.contribution_per_unit_minor",
  "operations.fulfillment_capacity_units_per_day",
  "data.measurement_available",
] as const;

export function getCoreActionTypeContract(
  actionType: string,
): ActionTypeContract | undefined {
  return CORE_ACTION_TYPE_CONTRACTS.find(
    (contract) => contract.actionType === actionType,
  );
}
