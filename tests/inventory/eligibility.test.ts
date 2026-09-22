import { describe, expect, it } from "vitest";
import { evaluateInventoryEligibility } from "../../src/inventory/eligibility.js";
import {
  accelerateCollectionXUntil100,
  accelerateSkuAExcessUntil50,
  clearanceCollectionX,
  protectSkuAAt20,
  reorderSkuA100,
  reserveSkuB10,
} from "../../src/inventory/fixtures.js";

describe("Step 8 deterministic inventory eligibility",()=>{
  it("handles supplier and warehouse eligible/ineligible/unknown without guessing",()=>{
    expect(evaluateInventoryEligibility(reorderSkuA100,{
      state:{supplierAvailableUnits:150,warehouseAvailableCapacityUnits:120}
    }).status).toBe("eligible");

    expect(evaluateInventoryEligibility(reorderSkuA100,{
      state:{supplierAvailableUnits:80,warehouseAvailableCapacityUnits:120}
    })).toMatchObject({status:"ineligible",reasonCodes:["SUPPLIER_QUANTITY_INSUFFICIENT"]});

    expect(evaluateInventoryEligibility(reorderSkuA100,{
      state:{supplierAvailableUnits:150}
    })).toMatchObject({status:"unknown",reasonCodes:["WAREHOUSE_CAPACITY_UNKNOWN"]});
  });

  it("protects reservation against current AVAILABLE_TO_SELL, not physical ON_HAND",()=>{
    expect(evaluateInventoryEligibility(reserveSkuB10,{
      state:{availableToSellUnits:20,onHandUnits:100}
    }).status).toBe("eligible");
    expect(evaluateInventoryEligibility(reserveSkuB10,{
      state:{availableToSellUnits:5,onHandUnits:100}
    }).status).toBe("ineligible");
    expect(evaluateInventoryEligibility(reserveSkuB10,{
      state:{onHandUnits:100}
    }).status).toBe("unknown");
  });

  it("preserves hard protection constraint tri-state",()=>{
    expect(evaluateInventoryEligibility(protectSkuAAt20,{
      hardConstraintResults:{inventory_protection_trigger_sku_a_20:"satisfied"}
    }).status).toBe("eligible");
    expect(evaluateInventoryEligibility(protectSkuAAt20,{
      hardConstraintResults:{inventory_protection_trigger_sku_a_20:"violated"}
    }).status).toBe("ineligible");
    expect(evaluateInventoryEligibility(protectSkuAAt20,{
      hardConstraintResults:{inventory_protection_trigger_sku_a_20:"unknown"}
    }).status).toBe("unknown");
  });

  it("requires frozen membership for collection inventory strategies",()=>{
    expect(evaluateInventoryEligibility(clearanceCollectionX,{})).toMatchObject({
      status:"unknown",reasonCodes:["INVENTORY_MEMBERSHIP_SNAPSHOT_UNAVAILABLE"]
    });
    expect(evaluateInventoryEligibility(clearanceCollectionX,{
      availableMembershipBindingRefs:["inventory-membership:collection-x:decision"]
    }).status).toBe("eligible");
  });

  it("evaluates current excess-stock condition without forecasting",()=>{
    expect(evaluateInventoryEligibility(accelerateSkuAExcessUntil50,{
      state:{availableToSellUnits:250},
      hardConstraintResults:{inventory_sku_a_excess_over_200:"satisfied"}
    }).status).toBe("eligible");
    expect(evaluateInventoryEligibility(accelerateSkuAExcessUntil50,{
      state:{availableToSellUnits:150},
      hardConstraintResults:{inventory_sku_a_excess_over_200:"satisfied"}
    }).status).toBe("ineligible");
    expect(evaluateInventoryEligibility(accelerateSkuAExcessUntil50,{
      hardConstraintResults:{inventory_sku_a_excess_over_200:"unknown"}
    }).status).toBe("unknown");
  });

  it("supports collection acceleration membership and present inventory state",()=>{
    expect(evaluateInventoryEligibility(accelerateCollectionXUntil100,{
      availableMembershipBindingRefs:["inventory-membership:collection-x:decision"],
      state:{onHandUnits:600}
    }).status).toBe("eligible");
  });
});
