import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type TranslationContext,
} from "../../src/action_translation/types.js";
import {
  resolveInventoryState,
  validateTranslationContext,
} from "../../src/action_translation/context.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  allowBackordersSkuA,
  clearanceSkuA,
  protectSkuAAt20,
  reorderSkuA100,
  setSkuASafetyStock40,
} from "../../src/inventory/fixtures.js";

const context:TranslationContext={
  schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock:utcTimestamp("2026-09-22T13:00:00Z"),
  capabilities:[],
  entityMappings:[],
  referenceBindings:[],
  inventoryStateBindings:[{
    target:{kind:"sku",productId:"product:A",skuId:"sku:A"},
    inventoryLocationId:"warehouse:montreal",
    supplierRelationshipId:"supplier:vendor-x:sku-a",
    onHandUnits:42,
    availableToSellUnits:32,
    reservedUnits:10,
    safetyStockUnits:20,
    reorderPointUnits:30,
    currentReorderQuantity:100,
    openPurchaseOrderUnits:0,
    supplierAvailableUnits:150,
    warehouseAvailableCapacityUnits:200,
    supplierConstraints:{minimumOrderQuantity:20,orderMultiple:10,maximumSupplierQuantity:500},
    leadTimeAssumption:{durationSeconds:21*24*60*60,sourceRef:"supplier_contract:vendor-x"},
    sourceRef:"inventory-state:sku-a:decision"
  }]
};

describe("Step 8 inventory translation boundary",()=>{
  it("validates current-only TranslationContext 1.4 inventory state",()=>{
    expect(validateTranslationContext(context).ok).toBe(true);
    expect(resolveInventoryState(
      context,
      {kind:"sku",productId:"product:A",skuId:"sku:A"},
      "warehouse:montreal",
      "supplier:vendor-x:sku-a"
    )).toMatchObject({status:"resolved"});
  });

  it("gates inventory state bindings to TranslationContext 1.4",()=>{
    const legacy={...context,schemaVersion:"1.3.0" as const};
    const result=validateTranslationContext(legacy);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.failure.code).toBe("TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_4");
  });

  it("rejects future supplier/inventory and counterfactual context",()=>{
    for(const key of ["futureDemand","futureInventory","futureSales","futureReturns","futureRealizedSupplierDelay","counterfactualInventory"]){
      const unsafe={...context,[key]:123};
      const result=validateTranslationContext(unsafe);
      expect(result.ok).toBe(false);
      if(!result.ok) expect(result.failure.code).toBe("FORBIDDEN_TRANSLATION_CONTEXT_INFORMATION");
    }
  });

  it("returns explicit unsupported capability rather than immediate receipt or shadow cross-family mutation",()=>{
    for(const action of [
      reorderSkuA100,
      setSkuASafetyStock40,
      protectSkuAAt20,
      allowBackordersSkuA,
      clearanceSkuA,
    ]){
      expect(translateBusinessAction(action,context)).toMatchObject({
        status:"UNSUPPORTED_SIMULATOR_CAPABILITY",
        code:"INVENTORY_CAPABILITY_UNSUPPORTED_BY_SIMULATOR"
      });
    }
  });

  it("never translates reorder into immediate inventory mutation",()=>{
    const result=translateBusinessAction(reorderSkuA100,context);
    expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  });
});
