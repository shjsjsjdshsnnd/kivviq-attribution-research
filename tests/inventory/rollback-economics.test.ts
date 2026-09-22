import { describe, expect, it } from "vitest";
import { currencyCode } from "../../src/core/units.js";
import { deriveKnownUnitProcurementCommitment } from "../../src/inventory/economics.js";
import { evaluateInventoryRollbackReadiness } from "../../src/inventory/rollback.js";
import {
  reorderSkuA100,
  rollbackProductXBackorder,
  rollbackTemporarySafetyStock,
} from "../../src/inventory/fixtures.js";

const CAD=currencyCode("CAD");
const units=(value:number)=>({kind:"quantity" as const,value,unit:"units" as const});

describe("Step 8 inventory economics and rollback",()=>{
  it("derives known unit procurement commitment without treating it as profit",()=>{
    expect(deriveKnownUnitProcurementCommitment(reorderSkuA100)).toEqual({
      status:"known",
      value:{kind:"money",amountMinor:800000,currency:CAD},
      sourceRef:"action:unit_procurement_cost_x_quantity"
    });
  });

  it("restores temporary safety stock only while current policy still matches original output",()=>{
    expect(evaluateInventoryRollbackReadiness(
      rollbackTemporarySafetyStock,
      {currentValue:units(50)}
    )).toMatchObject({
      status:"READY",
      value:units(20)
    });

    expect(evaluateInventoryRollbackReadiness(
      rollbackTemporarySafetyStock,
      {currentValue:units(35)}
    )).toMatchObject({
      status:"CONFLICT",
      code:"CURRENT_POLICY_CHANGED_AFTER_ORIGINAL_ACTION"
    });
  });

  it("returns missing context rather than guessing current policy value",()=>{
    expect(evaluateInventoryRollbackReadiness(
      rollbackTemporarySafetyStock,
      {}
    )).toMatchObject({
      status:"MISSING_CONTEXT",
      code:"MISSING_CURRENT_POLICY_VALUE"
    });
  });

  it("restores structured backorder policy from a frozen policy snapshot",()=>{
    const current={
      kind:"backorder_policy" as const,
      policy:{kind:"ALLOW_UNTIL_DATE" as const,until:"2026-10-15T13:00:00Z" as any}
    };
    const previous={
      kind:"backorder_policy" as const,
      policy:{kind:"DISALLOW" as const}
    };
    expect(evaluateInventoryRollbackReadiness(
      rollbackProductXBackorder,
      {
        currentValue:current,
        policySnapshots:[{
          baselineId:"inventory-policy:product-x:backorder:pre-action",
          value:previous,
          sourceRef:"inventory-policy-snapshot:product-x"
        }]
      }
    )).toMatchObject({
      status:"READY",
      value:previous,
      sourceRef:"inventory-policy-snapshot:product-x"
    });
  });
});
