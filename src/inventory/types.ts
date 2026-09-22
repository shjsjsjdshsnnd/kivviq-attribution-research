import type {
  Action,
  InventoryAvailabilityConcept,
  InventoryRollbackValue,
  MonetaryValue,
} from "../action_ontology/types.js";

export interface InventoryStateFacts {
  readonly onHandUnits?: number;
  readonly availableToSellUnits?: number;
  readonly reservedUnits?: number;
  readonly safetyStockUnits?: number;
  readonly reorderPointUnits?: number;
  readonly openPurchaseOrderUnits?: number;
  readonly supplierAvailableUnits?: number;
  readonly warehouseAvailableCapacityUnits?: number;
  readonly currentReorderQuantity?: number;
  readonly productActive?: boolean;
}

export interface InventoryEligibilityContext {
  readonly state?: InventoryStateFacts;
  readonly availableMembershipBindingRefs?: readonly string[];
  readonly hardConstraintResults?: Readonly<
    Record<string, "satisfied" | "violated" | "unknown">
  >;
}

export interface InventoryEligibilityDecision {
  readonly status: "eligible" | "ineligible" | "unknown";
  readonly reasonCodes: readonly string[];
  readonly missingInformation: readonly string[];
}

export interface InventoryPolicySnapshot {
  readonly baselineId: string;
  readonly value: InventoryRollbackValue;
  readonly sourceRef: string;
}

export interface InventoryRollbackStateContext {
  readonly currentValue?: InventoryRollbackValue;
  readonly preActionValue?: InventoryRollbackValue;
  readonly preActionValueSourceRef?: string;
  readonly policySnapshots?: readonly InventoryPolicySnapshot[];
}

export type InventoryRollbackReadiness =
  | {
      readonly status: "READY";
      readonly rollbackActionId: string;
      readonly originalActionId: string;
      readonly value: InventoryRollbackValue;
      readonly sourceRef: string;
    }
  | {
      readonly status: "CONFLICT";
      readonly rollbackActionId: string;
      readonly code: "CURRENT_POLICY_CHANGED_AFTER_ORIGINAL_ACTION";
      readonly message: string;
    }
  | {
      readonly status: "MISSING_CONTEXT";
      readonly rollbackActionId: string;
      readonly code:
        | "MISSING_CURRENT_POLICY_VALUE"
        | "MISSING_PRE_ACTION_POLICY_VALUE"
        | "MISSING_INVENTORY_POLICY_SNAPSHOT";
      readonly message: string;
    }
  | {
      readonly status: "INVALID_ACTION";
      readonly code: string;
      readonly message: string;
    };

export type InventoryProcurementCommitment =
  | {
      readonly status: "known";
      readonly value: MonetaryValue;
      readonly sourceRef: string;
    }
  | {
      readonly status: "unknown";
      readonly reason: string;
    };

export function inventoryUnitsForConcept(
  state: InventoryStateFacts | undefined,
  concept: InventoryAvailabilityConcept,
): number | undefined {
  if (!state) return undefined;
  switch (concept) {
    case "ON_HAND":
      return state.onHandUnits;
    case "AVAILABLE_TO_SELL":
      return state.availableToSellUnits;
    case "RESERVED":
      return state.reservedUnits;
    case "SAFETY_STOCK":
      return state.safetyStockUnits;
  }
}
