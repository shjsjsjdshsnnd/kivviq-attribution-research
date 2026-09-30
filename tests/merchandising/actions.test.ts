import { describe, expect, it } from "vitest";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { serializeAction } from "../../src/action_ontology/serialization.js";
import { assertValidAction, validateAction } from "../../src/action_ontology/validation.js";
import { increaseSkuAAdvertising20 } from "../../src/paid_media/fixtures.js";
import { reduceSkuA10Percent } from "../../src/pricing/fixtures.js";
import { startProductA100CadOff } from "../../src/promotion/fixtures.js";
import {
  crossSellCushionBForSofaA,
  deprioritizeProductBCollectionY,
  featureCollectionXHomepageSlot1,
  featureProductAContribution100,
  featureProductAHomepage,
  featureProductAInventory20,
  moveProductEUpFive,
  orderedCrossSellSetForSofaA,
  promoteProductBSubstituteForA,
  removeProductAHomepagePlacement,
  removeSofaACrossSell,
  setProductCPosition1CollectionX,
  temporaryProductAPosition1FourDays,
  upsellPremiumSofaBFromSofaA,
} from "../../src/merchandising/fixtures.js";

const clone=<T>(v:T):any=>JSON.parse(JSON.stringify(v));

describe("Step 7 canonical merchandising Actions",()=>{
  it("keeps merchandising distinct from paid media, pricing and promotions",()=>{
    const fp=actionFingerprint(featureProductAHomepage);
    expect(fp).not.toBe(actionFingerprint(increaseSkuAAdvertising20));
    expect(fp).not.toBe(actionFingerprint(reduceSkuA10Percent));
    expect(fp).not.toBe(actionFingerprint(startProductA100CadOff));
  });

  it("keeps product and collection featuring distinct",()=>{
    expect(featureProductAHomepage.target.kind).toBe("product");
    expect(featureCollectionXHomepageSlot1.target.kind).toBe("collection");
    expect(actionFingerprint(featureProductAHomepage)).not.toBe(actionFingerprint(featureCollectionXHomepageSlot1));
  });

  it("keeps deprioritization distinct from deletion or availability semantics",()=>{
    expect(deprioritizeProductBCollectionY.actionType).toBe("merchandising.deprioritize");
    expect(deprioritizeProductBCollectionY.parameters.kind).toBe("merchandising_visibility");
    expect(JSON.stringify(deprioritizeProductBCollectionY)).not.toMatch(/available|deleted|inventory_policy/);
  });

  it("uses one-based positive ranks and rejects zero",()=>{
    const invalid=clone(setProductCPosition1CollectionX);
    invalid.actionId="action_merch_invalid_rank_zero";
    invalid.parameters.operation.position=0;
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.errors.some(e=>e.code==="INVALID_POSITIVE_INTEGER")).toBe(true);
  });

  it("keeps SET, DELTA and MOVE_TO_TOP semantically distinct",()=>{
    const moveTop=clone(setProductCPosition1CollectionX);
    moveTop.actionId="action_merch_move_top_product_c";
    moveTop.parameters.operation={
      kind:"MOVE_TO_TOP",
      snapshot:{bindingRef:"ranking:collection-x:top",evaluateAt:"decision_time"}
    };
    const validated=assertValidAction(moveTop);
    const fps=new Set([
      actionFingerprint(setProductCPosition1CollectionX),
      actionFingerprint(moveProductEUpFive),
      actionFingerprint(validated),
    ]);
    expect(fps.size).toBe(3);
  });

  it("preserves relationship directionality and relationship type",()=>{
    if(promoteProductBSubstituteForA.parameters.kind==="merchandising_relationship"){
      expect(promoteProductBSubstituteForA.parameters.source).toEqual({kind:"product",productId:"product:A"});
      expect(promoteProductBSubstituteForA.parameters.targets[0]?.entity).toEqual({kind:"product",productId:"product:B"});
    }
    expect(actionFingerprint(crossSellCushionBForSofaA)).not.toBe(actionFingerprint(upsellPremiumSofaBFromSofaA));
  });

  it("preserves one-to-many recommendation ordering",()=>{
    if(orderedCrossSellSetForSofaA.parameters.kind!=="merchandising_relationship") return;
    expect(orderedCrossSellSetForSofaA.parameters.targets.map(t=>t.position)).toEqual([1,2,3]);
    expect(orderedCrossSellSetForSofaA.parameters.targets.map(t=>t.entity)).toEqual([
      {kind:"product",productId:"product:side-table-c"},
      {kind:"product",productId:"product:cushion-b"},
      {kind:"product",productId:"product:throw-d"},
    ]);
  });

  it("uses precise inventory and contribution constraints",()=>{
    expect(featureProductAInventory20.constraints[0]).toMatchObject({
      expression:{kind:"property_comparison",propertyId:"inventory.available_units",operator:"GTE",value:{kind:"quantity",value:20,unit:"units"}}
    });
    expect(featureProductAContribution100.constraints[0]).toMatchObject({
      expression:{kind:"property_comparison",propertyId:"finance.contribution_per_unit_minor",operator:"GTE"}
    });
  });

  it("requires safe rollback for temporary rank changes",()=>{
    expect(temporaryProductAPosition1FourDays.reversibility.merchandisingRollback).toMatchObject({
      available:true,
      strategy:{kind:"RESTORE_PRE_ACTION_VALUE"},
      conflictGuard:{kind:"REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",expectedPosition:1}
    });
    const invalid=clone(temporaryProductAPosition1FourDays);
    delete invalid.reversibility.merchandisingRollback;
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.errors.some(e=>e.code==="TEMPORARY_MERCHANDISING_RANK_REQUIRES_SAFE_ROLLBACK")).toBe(true);
  });

  it("keeps explicit removal Actions distinct from creation Actions",()=>{
    expect(removeProductAHomepagePlacement.actionType).toBe("merchandising.remove_placement");
    expect(removeSofaACrossSell.actionType).toBe("merchandising.remove_relationship");
    expect(actionFingerprint(removeProductAHomepagePlacement)).not.toBe(actionFingerprint(featureProductAHomepage));
    expect(actionFingerprint(removeSofaACrossSell)).not.toBe(actionFingerprint(crossSellCushionBForSofaA));
  });

  it("preserves canonical serialization differences",()=>{
    expect(serializeAction(featureProductAHomepage)).not.toBe(serializeAction(setProductCPosition1CollectionX));
  });

  it("rejects 1.5 semantics mislabeled as 1.4",()=>{
    const invalid=clone(featureProductAHomepage);
    invalid.schemaVersion="1.4.0";
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.errors.some(e=>e.code==="SCHEMA_FEATURE_REQUIRES_1_5")).toBe(true);
  });

  it("rejects merchandising prediction leakage",()=>{
    for(const key of ["expectedCTR","expectedConversionLift","expectedRevenue","expectedProfit","expectedUnitsSold","predictedDemand","predictedPurchaseProbability","predictedCrossSellRate","predictedUpsellRate","futureDemand","counterfactualRevenue","recommendationScore","confidenceScore"]){
      const invalid=clone(featureProductAHomepage);invalid[key]=123;
      const result=validateAction(invalid);expect(result.ok).toBe(false);
      if(!result.ok) expect(result.errors.some(e=>e.code==="FORBIDDEN_ACTION_INFORMATION")).toBe(true);
    }
  });
});
