import { currencyCode, utcTimestamp } from "../core/units.js";
import { doNothingAction } from "../action_ontology/fixtures.js";
import {
  actionId,
  actionType,
  constraintId,
} from "../action_ontology/identity.js";
import type {
  Action,
  ActionParameters,
  ActionTarget,
  CompoundAction,
  InventoryRollbackContract,
  MonetaryValue,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-22T13:00:00Z");
const OCTOBER_3 = utcTimestamp("2026-10-03T13:00:00Z");
const OCTOBER_10 = utcTimestamp("2026-10-10T13:00:00Z");
const OCTOBER_13 = utcTimestamp("2026-10-13T13:00:00Z");
const OCTOBER_15 = utcTimestamp("2026-10-15T13:00:00Z");
const SEVEN_DAYS = 7 * 24 * 60 * 60;

function money(amountMinor: number): MonetaryValue {
  return { kind: "money", amountMinor, currency: CAD };
}

function units(value: number) {
  return { kind: "quantity" as const, value, unit: "units" as const };
}

function inventoryAction(input: {
  readonly actionIdValue: string;
  readonly actionTypeValue:
    | "inventory.reorder"
    | "inventory.adjust_reorder_quantity"
    | "inventory.adjust_reorder_timing"
    | "inventory.set_safety_stock"
    | "inventory.set_reorder_point"
    | "inventory.protect_inventory"
    | "inventory.set_backorder_policy"
    | "inventory.clearance"
    | "inventory.accelerate_excess_stock"
    | "inventory.rollback_policy";
  readonly target: ActionTarget;
  readonly description: string;
  readonly parameters: ActionParameters;
  readonly timing?: Action["timing"];
  readonly duration?: Action["duration"];
  readonly termination?: Action["termination"];
  readonly constraints?: Action["constraints"];
  readonly preconditions?: Action["preconditions"];
  readonly inventoryRollback?: InventoryRollbackContract;
  readonly reversalOfActionId?: Action["reversalOfActionId"];
  readonly inventoryCommitment?: MonetaryValue;
}): Action {
  const duration =
    input.duration ??
    (input.actionTypeValue === "inventory.reorder" ||
    input.actionTypeValue === "inventory.rollback_policy"
      ? ({ kind: "instantaneous" } as const)
      : ({ kind: "persistent" } as const));

  const timing =
    input.timing ??
    ({
      decisionTime: DECISION,
      requestedStart: { kind: "known", at: DECISION },
      effectiveStart: { kind: "known", at: DECISION },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    } as const);

  const termination =
    input.termination ??
    (duration.kind === "temporary"
      ? {
          kind: "fixed_duration" as const,
          durationSeconds: duration.durationSeconds,
        }
      : duration.kind === "instantaneous"
        ? {
            kind: "fixed_end" as const,
            at:
              timing.effectiveStart.kind === "known"
                ? timing.effectiveStart.at
                : DECISION,
          }
        : { kind: "persistent" as const });

  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue),
    actionCategory: "inventory",
    schemaVersion: "1.6.0",
    description: input.description,
    target: input.target,
    parameters: input.parameters,
    timing,
    duration,
    termination,
    cost: {
      ...doNothingAction.cost,
      ...(input.inventoryCommitment
        ? {
            inventoryCommitment: {
              kind: "known" as const,
              value: input.inventoryCommitment,
              sourceRef: "action:known-unit-cost-x-quantity",
            },
          }
        : {}),
    },
    constraints: input.constraints ?? [],
    preconditions: input.preconditions ?? [],
    reversibility: {
      ...doNothingAction.reversibility,
      reversal: {
        kind: "restore_previous_value",
        target: input.target,
        parameterKind: input.parameters.kind,
      },
      ...(input.inventoryRollback
        ? { inventoryRollback: input.inventoryRollback }
        : {}),
    },
    ...(input.reversalOfActionId
      ? { reversalOfActionId: input.reversalOfActionId }
      : {}),
    intent: {
      statement: "Represent an explicit inventory business decision.",
    },
  });
}

const skuA = { kind: "sku" as const, productId: "product:A", skuId: "sku:A" };
const skuB = { kind: "sku" as const, productId: "product:B", skuId: "sku:B" };

export const reorderSkuA100 = inventoryAction({
  actionIdValue: "action_inventory_reorder_sku_a_100",
  actionTypeValue: "inventory.reorder",
  target: skuA,
  description: "Place a purchase order for 100 units of SKU A to Montreal warehouse.",
  parameters: {
    kind: "inventory_reorder",
    reorder: {
      sku: skuA,
      quantity: 100,
      supplierRelationshipId: "supplier:vendor-x:sku-a",
      destinationLocationId: "warehouse:montreal",
      orderPlacementTime: DECISION,
      requestedDeliveryDate: OCTOBER_13,
      leadTimeAssumption: {
        durationSeconds: 21 * 24 * 60 * 60,
        sourceRef: "supplier_contract:vendor-x:21-days",
      },
      expectedArrivalAt: OCTOBER_13,
      supplierConstraints: {
        minimumOrderQuantity: 20,
        orderMultiple: 10,
        maximumSupplierQuantity: 500,
      },
      procurementEconomics: {
        unitProcurementCost: money(8_000),
        freightCost: money(5_000),
        fixedOrderCost: money(2_000),
      },
    },
  },
  inventoryCommitment: money(800_000),
});

export const reorderSkuB50SupplierX = inventoryAction({
  actionIdValue: "action_inventory_reorder_sku_b_50",
  actionTypeValue: "inventory.reorder",
  target: skuB,
  description: "Order 50 units of SKU B from Supplier X.",
  parameters: {
    kind: "inventory_reorder",
    reorder: {
      sku: skuB,
      quantity: 50,
      supplierRelationshipId: "supplier:vendor-x:sku-b",
      destinationLocationId: "warehouse:montreal",
      orderPlacementTime: DECISION,
      leadTimeAssumption: {
        durationSeconds: 14 * 24 * 60 * 60,
        sourceRef: "supplier_contract:vendor-x:sku-b:14-days",
      },
    },
  },
});

export const invalidReorder25Multiple6: unknown = {
  ...reorderSkuA100,
  actionId: "action_inventory_invalid_reorder_multiple",
  parameters: {
    kind: "inventory_reorder",
    reorder: {
      sku: skuA,
      quantity: 25,
      supplierRelationshipId: "supplier:vendor-y:sku-a",
      orderPlacementTime: DECISION,
      supplierConstraints: {
        minimumOrderQuantity: 12,
        orderMultiple: 6,
        maximumSupplierQuantity: 500,
      },
    },
  },
};

export const setSkuAReorderQuantity200 = inventoryAction({
  actionIdValue: "action_inventory_reorder_qty_sku_a_set_200",
  actionTypeValue: "inventory.adjust_reorder_quantity",
  target: skuA,
  description: "Set SKU A reorder quantity to 200 units.",
  parameters: {
    kind: "inventory_reorder_quantity",
    operation: {
      kind: "SET",
      value: units(200),
    },
    supplierConstraints: {
      minimumOrderQuantity: 20,
      orderMultiple: 10,
      maximumSupplierQuantity: 500,
    },
  },
});

export const increaseSkuAReorderQuantity50 = inventoryAction({
  actionIdValue: "action_inventory_reorder_qty_sku_a_plus_50",
  actionTypeValue: "inventory.adjust_reorder_quantity",
  target: skuA,
  description: "Increase SKU A next reorder quantity by 50 units.",
  parameters: {
    kind: "inventory_reorder_quantity",
    operation: {
      kind: "DELTA",
      direction: "increase",
      amount: units(50),
      reference: {
        kind: "explicit_baseline",
        value: units(100),
      },
    },
  },
});

export const increaseSkuAReorderQuantity25Percent = inventoryAction({
  actionIdValue: "action_inventory_reorder_qty_sku_a_multiply_125",
  actionTypeValue: "inventory.adjust_reorder_quantity",
  target: skuA,
  description: "Increase SKU A reorder quantity by 25%.",
  parameters: {
    kind: "inventory_reorder_quantity",
    operation: {
      kind: "MULTIPLY",
      factor: 1.25,
      reference: {
        kind: "explicit_baseline",
        value: units(100),
      },
    },
  },
});

export const reorderSkuAToday = inventoryAction({
  actionIdValue: "action_inventory_reorder_timing_sku_a_today",
  actionTypeValue: "inventory.adjust_reorder_timing",
  target: skuA,
  description: "Set planned reorder date for SKU A to today.",
  parameters: {
    kind: "inventory_reorder_timing",
    operation: {
      kind: "SET_DATE",
      at: DECISION,
    },
  },
});

export const moveSkuAReorderForwardSevenDays = inventoryAction({
  actionIdValue: "action_inventory_reorder_timing_sku_a_earlier_7d",
  actionTypeValue: "inventory.adjust_reorder_timing",
  target: skuA,
  description: "Move SKU A planned reorder forward by seven days.",
  parameters: {
    kind: "inventory_reorder_timing",
    operation: {
      kind: "DELTA_DAYS",
      direction: "earlier",
      days: 7,
      baseline: {
        kind: "explicit_planned_reorder",
        at: OCTOBER_10,
      },
    },
  },
});

export const delaySkuAReorderUntilOctober15 = inventoryAction({
  actionIdValue: "action_inventory_reorder_timing_sku_a_oct15",
  actionTypeValue: "inventory.adjust_reorder_timing",
  target: skuA,
  description: "Delay SKU A planned reorder until October 15.",
  parameters: {
    kind: "inventory_reorder_timing",
    operation: {
      kind: "SET_DATE",
      at: OCTOBER_15,
    },
  },
});

export const reorderSkuAAt30Units = inventoryAction({
  actionIdValue: "action_inventory_reorder_timing_sku_a_trigger_30",
  actionTypeValue: "inventory.adjust_reorder_timing",
  target: skuA,
  description: "Trigger SKU A reorder when available-to-sell inventory reaches 30 units.",
  parameters: {
    kind: "inventory_reorder_timing",
    operation: {
      kind: "INVENTORY_TRIGGER",
      availabilityConcept: "AVAILABLE_TO_SELL",
      operator: "LTE",
      units: 30,
    },
  },
});

export const setSkuASafetyStock40 = inventoryAction({
  actionIdValue: "action_inventory_safety_stock_sku_a_40",
  actionTypeValue: "inventory.set_safety_stock",
  target: skuA,
  description: "Set SKU A safety stock to 40 units.",
  parameters: {
    kind: "inventory_policy_control",
    policy: {
      kind: "SAFETY_STOCK",
      operation: { kind: "SET", value: units(40) },
      inventoryLocationId: "warehouse:montreal",
    },
  },
});

export const increaseSkuASafetyStock20 = inventoryAction({
  actionIdValue: "action_inventory_safety_stock_sku_a_plus_20",
  actionTypeValue: "inventory.set_safety_stock",
  target: skuA,
  description: "Increase SKU A safety stock by 20 units.",
  parameters: {
    kind: "inventory_policy_control",
    policy: {
      kind: "SAFETY_STOCK",
      operation: {
        kind: "DELTA",
        direction: "increase",
        amount: units(20),
        reference: { kind: "explicit_baseline", value: units(40) },
      },
    },
  },
});

export const increaseSkuASafetyStock25Percent = inventoryAction({
  actionIdValue: "action_inventory_safety_stock_sku_a_multiply_125",
  actionTypeValue: "inventory.set_safety_stock",
  target: skuA,
  description: "Increase SKU A safety stock by 25%.",
  parameters: {
    kind: "inventory_policy_control",
    policy: {
      kind: "SAFETY_STOCK",
      operation: {
        kind: "MULTIPLY",
        factor: 1.25,
        reference: { kind: "explicit_baseline", value: units(40) },
      },
    },
  },
});

export const setSkuAReorderPoint80 = inventoryAction({
  actionIdValue: "action_inventory_reorder_point_sku_a_80",
  actionTypeValue: "inventory.set_reorder_point",
  target: skuA,
  description: "Set SKU A reorder point to 80 units.",
  parameters: {
    kind: "inventory_policy_control",
    policy: {
      kind: "REORDER_POINT",
      operation: { kind: "SET", value: units(80) },
    },
  },
});

export const protectSkuAAt20 = inventoryAction({
  actionIdValue: "action_inventory_protect_sku_a_at_20",
  actionTypeValue: "inventory.protect_inventory",
  target: skuA,
  description: "Protect SKU A inventory once available-to-sell stock falls to 20 units.",
  parameters: {
    kind: "inventory_protection",
    mode: {
      kind: "PROTECT_UNTIL_CONDITION",
      availabilityConcept: "AVAILABLE_TO_SELL",
      minimumUnits: 20,
    },
    inventoryLocationId: "warehouse:montreal",
    coordinatedActionIds: [
      actionId("action_paid_media_pause_sku_a"),
      actionId("action_promotion_stop_sku_a"),
      actionId("action_merchandising_deprioritize_sku_a"),
    ],
  },
  constraints: [
    {
      constraintId: constraintId("inventory_protection_trigger_sku_a_20"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "inventory.available_to_sell_units",
        operator: "LTE",
        value: units(20),
      },
    },
  ],
});

export const reserveSkuB10 = inventoryAction({
  actionIdValue: "action_inventory_reserve_sku_b_10",
  actionTypeValue: "inventory.protect_inventory",
  target: skuB,
  description: "Reserve 10 units of SKU B from general available-to-sell demand.",
  parameters: {
    kind: "inventory_protection",
    mode: {
      kind: "RESERVE_QUANTITY",
      quantity: 10,
      fromConcept: "AVAILABLE_TO_SELL",
      toConcept: "RESERVED",
    },
    inventoryLocationId: "warehouse:montreal",
  },
  duration: { kind: "temporary", durationSeconds: SEVEN_DAYS },
});

export const allowBackordersSkuA = inventoryAction({
  actionIdValue: "action_inventory_backorder_sku_a_allow",
  actionTypeValue: "inventory.set_backorder_policy",
  target: skuA,
  description: "Allow backorders for SKU A.",
  parameters: {
    kind: "inventory_backorder_policy",
    policy: { kind: "ALLOW" },
  },
});

export const allowSkuB50Backorders = inventoryAction({
  actionIdValue: "action_inventory_backorder_sku_b_limit_50",
  actionTypeValue: "inventory.set_backorder_policy",
  target: skuB,
  description: "Allow up to 50 backordered units for SKU B.",
  parameters: {
    kind: "inventory_backorder_policy",
    policy: { kind: "ALLOW_WITH_LIMIT", maxBackorderedUnits: 50 },
  },
});

const backorderUntilDuration = Math.floor(
  (Date.parse(OCTOBER_15) - Date.parse(DECISION)) / 1000,
);

export const allowProductXBackordersUntilOctober15 = inventoryAction({
  actionIdValue: "action_inventory_backorder_product_x_until_oct15",
  actionTypeValue: "inventory.set_backorder_policy",
  target: { kind: "product", productId: "product:X" },
  description: "Allow Product X backorders until October 15.",
  parameters: {
    kind: "inventory_backorder_policy",
    policy: { kind: "ALLOW_UNTIL_DATE", until: OCTOBER_15 },
    customerPromiseRef: "fulfillment_promise:product-x:backorder",
  },
  duration: {
    kind: "temporary",
    durationSeconds: backorderUntilDuration,
  },
  inventoryRollback: {
    available: true,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      preActionValue: {
        kind: "inventory_policy_snapshot",
        baselineId: "inventory-policy:product-x:backorder:pre-action",
      },
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "known",
      value: money(0),
      sourceRef: "inventory:rollback:no-direct-cost",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId(
        "action_inventory_backorder_product_x_until_oct15",
      ),
      expectedValue: {
        kind: "backorder_policy",
        policy: { kind: "ALLOW_UNTIL_DATE", until: OCTOBER_15 },
      },
    },
  },
});

export const clearanceSkuA = inventoryAction({
  actionIdValue: "action_inventory_clearance_sku_a",
  actionTypeValue: "inventory.clearance",
  target: skuA,
  description: "Place SKU A into clearance inventory strategy.",
  parameters: {
    kind: "inventory_clearance",
    target: skuA,
    reasonCode: "EXCESS_STOCK",
    coordinatedActionIds: [
      actionId("action_pricing_reduce_sku_a_for_clearance"),
      actionId("action_merchandising_feature_sku_a_clearance"),
    ],
  },
});

export const clearanceCollectionX = inventoryAction({
  actionIdValue: "action_inventory_clearance_collection_x",
  actionTypeValue: "inventory.clearance",
  target: { kind: "collection", collectionId: "collection:X" },
  description: "Clear excess inventory for Collection X.",
  parameters: {
    kind: "inventory_clearance",
    target: { kind: "collection", collectionId: "collection:X" },
    reasonCode: "EXCESS_STOCK",
    membership: {
      evaluateAt: "decision_time",
      bindingRef: "inventory-membership:collection-x:decision",
    },
  },
});

export const accelerateSkuAExcessUntil50 = inventoryAction({
  actionIdValue: "action_inventory_accelerate_sku_a_until_50",
  actionTypeValue: "inventory.accelerate_excess_stock",
  target: skuA,
  description: "Accelerate SKU A sell-through while available stock exceeds 200, until it reaches 50 units.",
  parameters: {
    kind: "inventory_acceleration",
    target: skuA,
    availabilityConcept: "AVAILABLE_TO_SELL",
    startingCondition: { operator: "GT", units: 200 },
    termination: {
      kind: "INVENTORY_AT_OR_BELOW",
      availabilityConcept: "AVAILABLE_TO_SELL",
      units: 50,
    },
    coordinatedActionIds: [
      actionId("action_paid_media_increase_sku_a_clearance"),
      actionId("action_merchandising_feature_sku_a_clearance"),
    ],
  },
  termination: {
    kind: "condition",
    conditionRef: "inventory.available_to_sell_units<=50",
  },
  constraints: [
    {
      constraintId: constraintId("inventory_sku_a_excess_over_200"),
      constraintClass: "hard",
      expression: {
        kind: "property_comparison",
        propertyId: "inventory.available_to_sell_units",
        operator: "GT",
        value: units(200),
      },
    },
  ],
});

export const accelerateCollectionXUntil100 = inventoryAction({
  actionIdValue: "action_inventory_accelerate_collection_x_until_100",
  actionTypeValue: "inventory.accelerate_excess_stock",
  target: { kind: "collection", collectionId: "collection:X" },
  description: "Accelerate Collection X inventory until on-hand inventory reaches 100 units.",
  parameters: {
    kind: "inventory_acceleration",
    target: { kind: "collection", collectionId: "collection:X" },
    availabilityConcept: "ON_HAND",
    startingCondition: { operator: "GT", units: 500 },
    termination: {
      kind: "INVENTORY_AT_OR_BELOW",
      availabilityConcept: "ON_HAND",
      units: 100,
    },
    membership: {
      evaluateAt: "decision_time",
      bindingRef: "inventory-membership:collection-x:decision",
    },
  },
  termination: {
    kind: "condition",
    conditionRef: "inventory.collection_x.on_hand<=100",
  },
});

export const temporarySafetyStock50 = inventoryAction({
  actionIdValue: "action_inventory_safety_stock_sku_a_temp_50",
  actionTypeValue: "inventory.set_safety_stock",
  target: skuA,
  description: "Temporarily set SKU A safety stock to 50 units.",
  parameters: {
    kind: "inventory_policy_control",
    policy: {
      kind: "SAFETY_STOCK",
      operation: { kind: "SET", value: units(50) },
    },
  },
  duration: { kind: "temporary", durationSeconds: SEVEN_DAYS },
  inventoryRollback: {
    available: true,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      preActionValue: {
        kind: "explicit_baseline",
        value: units(20),
      },
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "known",
      value: money(0),
      sourceRef: "inventory:rollback:no-direct-cost",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: actionId(
        "action_inventory_safety_stock_sku_a_temp_50",
      ),
      expectedValue: units(50),
    },
  },
});

export const rollbackTemporarySafetyStock = inventoryAction({
  actionIdValue: "action_inventory_rollback_safety_stock_sku_a",
  actionTypeValue: "inventory.rollback_policy",
  target: skuA,
  description: "Rollback temporary SKU A safety stock only if current policy still equals 50 units.",
  parameters: {
    kind: "inventory_policy_rollback",
    originalActionId: temporarySafetyStock50.actionId,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      preActionValue: {
        kind: "explicit_baseline",
        value: units(20),
      },
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporarySafetyStock50.actionId,
      expectedValue: units(50),
    },
  },
  reversalOfActionId: temporarySafetyStock50.actionId,
});

export const protectSkuACompoundReadiness: CompoundAction = {
  kind: "compound_action",
  compoundActionId: actionId("action_inventory_protect_sku_a_compound"),
  schemaVersion: "1.6.0",
  description:
    "Inventory protection intent coordinated with distinct paid-media, promotion and merchandising Actions.",
  componentActionIds: [
    protectSkuAAt20.actionId,
    actionId("action_paid_media_pause_sku_a"),
    actionId("action_promotion_stop_sku_a"),
    actionId("action_merchandising_deprioritize_sku_a"),
  ],
};

export const reorderTimingExplicitResultDate = OCTOBER_3;
