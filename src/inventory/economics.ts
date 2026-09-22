import type { Action } from "../action_ontology/types.js";
import type { InventoryProcurementCommitment } from "./types.js";

export function deriveKnownUnitProcurementCommitment(
  action: Action,
): InventoryProcurementCommitment {
  if (
    action.actionType !== "inventory.reorder" ||
    action.parameters.kind !== "inventory_reorder"
  ) {
    return {
      status: "unknown",
      reason: "Action is not an inventory reorder.",
    };
  }

  const economics = action.parameters.reorder.procurementEconomics;
  const unitCost = economics?.unitProcurementCost;
  if (!unitCost) {
    return {
      status: "unknown",
      reason: "Unit procurement cost is not known in the Action.",
    };
  }

  return {
    status: "known",
    value: {
      kind: "money",
      amountMinor:
        action.parameters.reorder.quantity * unitCost.amountMinor,
      currency: unitCost.currency,
    },
    sourceRef: "action:unit_procurement_cost_x_quantity",
  };
}
