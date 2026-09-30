import type { Action } from "../action_ontology/types.js";
import {
  inventoryUnitsForConcept,
  type InventoryEligibilityContext,
  type InventoryEligibilityDecision,
} from "./types.js";

function hardConstraints(
  action: Action,
  context: InventoryEligibilityContext,
): InventoryEligibilityDecision | undefined {
  for (const constraint of action.constraints) {
    if (constraint.constraintClass !== "hard") continue;
    const status = context.hardConstraintResults?.[constraint.constraintId];
    if (status === "violated") {
      return {
        status: "ineligible",
        reasonCodes: ["HARD_CONSTRAINT_VIOLATED:" + constraint.constraintId],
        missingInformation: [],
      };
    }
    if (status === undefined || status === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["HARD_CONSTRAINT_UNKNOWN:" + constraint.constraintId],
        missingInformation: [constraint.constraintId],
      };
    }
  }
}

function membership(
  action: Action,
  context: InventoryEligibilityContext,
): InventoryEligibilityDecision | undefined {
  if (
    action.parameters.kind !== "inventory_clearance" &&
    action.parameters.kind !== "inventory_acceleration"
  ) {
    return undefined;
  }
  const ref = action.parameters.membership?.bindingRef;
  if (
    ref &&
    !context.availableMembershipBindingRefs?.includes(ref)
  ) {
    return {
      status: "unknown",
      reasonCodes: ["INVENTORY_MEMBERSHIP_SNAPSHOT_UNAVAILABLE"],
      missingInformation: [ref],
    };
  }
}

export function evaluateInventoryEligibility(
  action: Action,
  context: InventoryEligibilityContext,
): InventoryEligibilityDecision {
  const member = membership(action, context);
  if (member) return member;

  if (
    action.actionType === "inventory.reorder" &&
    action.parameters.kind === "inventory_reorder"
  ) {
    const reorder = action.parameters.reorder;
    if (reorder.supplierRelationshipId) {
      const available = context.state?.supplierAvailableUnits;
      if (available === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["SUPPLIER_AVAILABILITY_UNKNOWN"],
          missingInformation: [reorder.supplierRelationshipId],
        };
      }
      if (available < reorder.quantity) {
        return {
          status: "ineligible",
          reasonCodes: ["SUPPLIER_QUANTITY_INSUFFICIENT"],
          missingInformation: [],
        };
      }
    }
    if (reorder.destinationLocationId) {
      const capacity = context.state?.warehouseAvailableCapacityUnits;
      if (capacity === undefined) {
        return {
          status: "unknown",
          reasonCodes: ["WAREHOUSE_CAPACITY_UNKNOWN"],
          missingInformation: [reorder.destinationLocationId],
        };
      }
      if (capacity < reorder.quantity) {
        return {
          status: "ineligible",
          reasonCodes: ["WAREHOUSE_CAPACITY_INSUFFICIENT"],
          missingInformation: [],
        };
      }
    }
  }

  if (
    action.actionType === "inventory.protect_inventory" &&
    action.parameters.kind === "inventory_protection" &&
    action.parameters.mode.kind === "RESERVE_QUANTITY"
  ) {
    const available = context.state?.availableToSellUnits;
    if (available === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["AVAILABLE_TO_SELL_UNKNOWN"],
        missingInformation: ["inventory.available_to_sell_units"],
      };
    }
    if (available < action.parameters.mode.quantity) {
      return {
        status: "ineligible",
        reasonCodes: ["INSUFFICIENT_AVAILABLE_TO_SELL_FOR_RESERVATION"],
        missingInformation: [],
      };
    }
  }

  if (
    action.actionType === "inventory.accelerate_excess_stock" &&
    action.parameters.kind === "inventory_acceleration"
  ) {
    const units = inventoryUnitsForConcept(
      context.state,
      action.parameters.availabilityConcept,
    );
    if (units === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["INVENTORY_STATE_UNKNOWN"],
        missingInformation: [action.parameters.availabilityConcept],
      };
    }
    const start = action.parameters.startingCondition;
    const met =
      start.operator === "GT"
        ? units > start.units
        : units >= start.units;
    if (!met) {
      return {
        status: "ineligible",
        reasonCodes: ["EXCESS_STOCK_START_CONDITION_NOT_MET"],
        missingInformation: [],
      };
    }
  }

  const constraints = hardConstraints(action, context);
  if (constraints) return constraints;

  return {
    status: "eligible",
    reasonCodes: [],
    missingInformation: [],
  };
}
