import { describe, expect, it } from "vitest";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { validateAction } from "../../src/action_ontology/validation.js";
import { increaseSkuAAdvertising20 } from "../../src/paid_media/fixtures.js";
import { reduceSkuA10Percent } from "../../src/pricing/fixtures.js";
import { startProductA100CadOff } from "../../src/promotion/fixtures.js";
import { featureProductAHomepage } from "../../src/merchandising/fixtures.js";
import {
  accelerateSkuAExcessUntil50,
  allowBackordersSkuA,
  allowSkuB50Backorders,
  clearanceSkuA,
  increaseSkuAReorderQuantity25Percent,
  increaseSkuAReorderQuantity50,
  increaseSkuASafetyStock20,
  increaseSkuASafetyStock25Percent,
  invalidReorder25Multiple6,
  moveSkuAReorderForwardSevenDays,
  permanentThreshold150To125 as _notInventory,
  protectSkuAAt20,
  reorderSkuA100,
  reorderSkuAAt30Units,
  reorderSkuAToday,
  reserveSkuB10,
  setSkuAReorderPoint80,
  setSkuAReorderQuantity200,
  setSkuASafetyStock40,
  temporarySafetyStock50,
} from "../../src/inventory/fixtures.js";

const clone=<T>(v:T):any=>JSON.parse(JSON.stringify(v));

describe("Step 8 canonical inventory Actions",()=>{
  it("represents reorder as purchase-order decision, not inventory receipt",()=>{
    expect(reorderSkuA100.actionType).toBe("inventory.reorder");
    expect(reorderSkuA100.duration).toEqual({kind:"instantaneous"});
    if(reorderSkuA100.parameters.kind!=="inventory_reorder") return;
    expect(reorderSkuA100.parameters.reorder).toMatchObject({
      sku:{kind:"sku",skuId:"sku:A"},
      quantity:100,
      supplierRelationshipId:"supplier:vendor-x:sku-a",
      destinationLocationId:"warehouse:montreal",
      orderPlacementTime:"2026-09-22T13:00:00Z",
      expectedArrivalAt:"2026-10-13T13:00:00Z",
      leadTimeAssumption:{durationSeconds:21*24*60*60}
    });
    expect(JSON.stringify(reorderSkuA100)).not.toMatch(/actualReceiptAt|on_hand\s*\+=|receiptQuantity/);
  });

  it("rejects supplier order multiple violations without rounding",()=>{
    const result=validateAction(invalidReorder25Multiple6);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.errors.some(e=>e.code==="REORDER_NOT_VALID_ORDER_MULTIPLE")).toBe(true);
  });

  it("keeps reorder quantity SET, DELTA and MULTIPLY distinct",()=>{
    const fps=new Set([
      actionFingerprint(setSkuAReorderQuantity200),
      actionFingerprint(increaseSkuAReorderQuantity50),
      actionFingerprint(increaseSkuAReorderQuantity25Percent),
    ]);
    expect(fps.size).toBe(3);
  });

  it("keeps calendar, relative and inventory-triggered reorder timing distinct",()=>{
    const fps=new Set([
      actionFingerprint(reorderSkuAToday),
      actionFingerprint(moveSkuAReorderForwardSevenDays),
      actionFingerprint(reorderSkuAAt30Units),
    ]);
    expect(fps.size).toBe(3);
  });

  it("keeps safety stock and reorder point distinct",()=>{
    expect(setSkuASafetyStock40.actionType).toBe("inventory.set_safety_stock");
    expect(setSkuAReorderPoint80.actionType).toBe("inventory.set_reorder_point");
    expect(actionFingerprint(setSkuASafetyStock40)).not.toBe(actionFingerprint(setSkuAReorderPoint80));
  });

  it("preserves SET, DELTA and MULTIPLY safety-stock semantics",()=>{
    const fps=new Set([
      actionFingerprint(setSkuASafetyStock40),
      actionFingerprint(increaseSkuASafetyStock20),
      actionFingerprint(increaseSkuASafetyStock25Percent),
    ]);
    expect(fps.size).toBe(3);
  });

  it("reserves from AVAILABLE_TO_SELL into RESERVED without reducing ON_HAND",()=>{
    if(reserveSkuB10.parameters.kind!=="inventory_protection") return;
    expect(reserveSkuB10.parameters.mode).toEqual({
      kind:"RESERVE_QUANTITY",quantity:10,
      fromConcept:"AVAILABLE_TO_SELL",toConcept:"RESERVED"
    });
    expect(JSON.stringify(reserveSkuB10.parameters)).not.toMatch(/ON_HAND.*decrease|remove_on_hand/i);
  });

  it("keeps backorder policy structured and distinguishes absent limit from a zero limit",()=>{
    expect(allowBackordersSkuA.parameters.kind).toBe("inventory_backorder_policy");
    expect(allowSkuB50Backorders.parameters.kind).toBe("inventory_backorder_policy");
    if(allowSkuB50Backorders.parameters.kind!=="inventory_backorder_policy") return;
    expect(allowSkuB50Backorders.parameters.policy).toEqual({kind:"ALLOW_WITH_LIMIT",maxBackorderedUnits:50});

    const zero=clone(allowSkuB50Backorders);
    zero.actionId="action_inventory_backorder_sku_b_zero";
    zero.parameters.policy={kind:"ALLOW_WITH_LIMIT",maxBackorderedUnits:0};
    expect(validateAction(zero).ok).toBe(true);
  });

  it("keeps inventory strategy distinct from paid media, pricing, promotion and merchandising tactics",()=>{
    const fp=actionFingerprint(clearanceSkuA);
    expect(fp).not.toBe(actionFingerprint(increaseSkuAAdvertising20));
    expect(fp).not.toBe(actionFingerprint(reduceSkuA10Percent));
    expect(fp).not.toBe(actionFingerprint(startProductA100CadOff));
    expect(fp).not.toBe(actionFingerprint(featureProductAHomepage));
    expect(clearanceSkuA.actionType).toBe("inventory.clearance");
  });

  it("preserves coordinated demand-protection intent as Action references rather than shadow action types",()=>{
    if(protectSkuAAt20.parameters.kind!=="inventory_protection") return;
    expect(protectSkuAAt20.parameters.coordinatedActionIds).toEqual([
      "action_paid_media_pause_sku_a",
      "action_promotion_stop_sku_a",
      "action_merchandising_deprioritize_sku_a",
    ]);
    expect(JSON.stringify(protectSkuAAt20)).not.toMatch(/inventory\.pause_ads|inventory\.raise_price/);
  });

  it("represents acceleration start and termination without predicted sell-through",()=>{
    if(accelerateSkuAExcessUntil50.parameters.kind!=="inventory_acceleration") return;
    expect(accelerateSkuAExcessUntil50.parameters).toMatchObject({
      availabilityConcept:"AVAILABLE_TO_SELL",
      startingCondition:{operator:"GT",units:200},
      termination:{kind:"INVENTORY_AT_OR_BELOW",availabilityConcept:"AVAILABLE_TO_SELL",units:50}
    });
    expect(JSON.stringify(accelerateSkuAExcessUntil50)).not.toMatch(/predictedSellThrough|forecastDemand/);
  });

  it("requires conflict-safe rollback for temporary inventory policy",()=>{
    expect(temporarySafetyStock50.reversibility.inventoryRollback).toMatchObject({
      available:true,
      strategy:{kind:"RESTORE_PRE_ACTION_VALUE"},
      conflictGuard:{kind:"REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT"}
    });
    const invalid=clone(temporarySafetyStock50);
    delete invalid.reversibility.inventoryRollback;
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.errors.some(e=>e.code==="TEMPORARY_INVENTORY_POLICY_REQUIRES_SAFE_ROLLBACK")).toBe(true);
  });

  it("records deterministic inventory capital commitment separately from expected outcome",()=>{
    expect(reorderSkuA100.cost.inventoryCommitment).toMatchObject({
      kind:"known",
      value:{kind:"money",amountMinor:800000,currency:"CAD"}
    });
    expect(JSON.stringify(reorderSkuA100.cost)).not.toMatch(/expectedProfit|expectedMargin/);
  });

  it("rejects 1.6 semantics mislabeled as 1.5",()=>{
    const invalid=clone(reorderSkuA100);
    invalid.schemaVersion="1.5.0";
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.errors.some(e=>e.code==="SCHEMA_FEATURE_REQUIRES_1_6")).toBe(true);
  });

  it("rejects inventory forecast/evaluation leakage",()=>{
    for(const key of ["expectedDemand","forecastDemand","futureDemand","expectedUnitsSold","predictedStockoutDate","predictedSellThrough","expectedRevenue","expectedProfit","expectedMargin","predictedSupplierDelay","futureInventory","counterfactualInventory","counterfactualRevenue","recommendationScore","confidenceScore"]){
      const invalid=clone(reorderSkuA100);invalid[key]=123;
      const result=validateAction(invalid);expect(result.ok).toBe(false);
      if(!result.ok) expect(result.errors.some(e=>e.code==="FORBIDDEN_ACTION_INFORMATION")).toBe(true);
    }
  });
});
