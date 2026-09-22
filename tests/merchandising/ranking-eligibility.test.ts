import { describe, expect, it } from "vitest";
import {
  applyShiftOthers,
  resolveMerchandisingRank,
} from "../../src/merchandising/ranking.js";
import { evaluateMerchandisingEligibility } from "../../src/merchandising/eligibility.js";
import {
  beyondHomepageCapacity,
  featureProductAContribution100,
  featureProductAHomepage,
  moveProductDFrom12To3,
  moveProductEUpFive,
  merchandisingRankingSnapshots,
  merchandisingSurfaceDefinitions,
  promoteProductBSubstituteWhenAOutOfStock,
  relativeRankMissingSnapshot,
} from "../../src/merchandising/fixtures.js";

describe("Step 7 ranking snapshots, displacement and eligibility",()=>{
  it("applies SHIFT_OTHERS deterministically",()=>{
    const ordered=[
      {kind:"product",productId:"A"} as const,
      {kind:"product",productId:"B"} as const,
      {kind:"product",productId:"C"} as const,
      {kind:"product",productId:"D"} as const,
    ];
    expect(applyShiftOthers(ordered,{kind:"product",productId:"D"},2)).toEqual([
      {kind:"product",productId:"A"},
      {kind:"product",productId:"D"},
      {kind:"product",productId:"B"},
      {kind:"product",productId:"C"},
    ]);
  });

  it("resolves relative ranking against the frozen snapshot",()=>{
    const d=resolveMerchandisingRank(moveProductDFrom12To3,merchandisingRankingSnapshots);
    expect(d).toMatchObject({status:"RESOLVED",currentPosition:12,targetPosition:3,snapshotRef:"ranking:collection-x:d-at-12"});
    if(d.status==="RESOLVED") expect(d.resultingOrder?.[2]).toEqual({kind:"product",productId:"product:D"});

    expect(resolveMerchandisingRank(moveProductEUpFive,merchandisingRankingSnapshots)).toMatchObject({
      status:"RESOLVED",currentPosition:8,targetPosition:3
    });
  });

  it("returns missing context for unavailable relative-rank snapshot",()=>{
    expect(resolveMerchandisingRank(relativeRankMissingSnapshot,merchandisingRankingSnapshots)).toMatchObject({
      status:"MISSING_CONTEXT",code:"MISSING_RANKING_SNAPSHOT",missingRef:"ranking:missing"
    });
  });

  it("returns ineligible when requested placement exceeds known capacity",()=>{
    expect(evaluateMerchandisingEligibility(beyondHomepageCapacity,{surfaceDefinitions:merchandisingSurfaceDefinitions})).toMatchObject({
      status:"ineligible",reasonCodes:["MERCHANDISING_POSITION_EXCEEDS_CAPACITY"]
    });
  });

  it("returns unknown when required surface capacity is unavailable",()=>{
    expect(evaluateMerchandisingEligibility(featureProductAHomepage,{})).toMatchObject({
      status:"unknown",reasonCodes:["MERCHANDISING_SURFACE_DEFINITION_UNKNOWN"]
    });
  });

  it("preserves relationship trigger eligible/ineligible/unknown from current inventory",()=>{
    const key=JSON.stringify({kind:"product",productId:"product:A"});
    const surfaceDefinitions=merchandisingSurfaceDefinitions;
    expect(evaluateMerchandisingEligibility(promoteProductBSubstituteWhenAOutOfStock,{surfaceDefinitions,inventoryUnitsByEntity:{[key]:0}}).status).toBe("eligible");
    expect(evaluateMerchandisingEligibility(promoteProductBSubstituteWhenAOutOfStock,{surfaceDefinitions,inventoryUnitsByEntity:{[key]:2}}).status).toBe("ineligible");
    expect(evaluateMerchandisingEligibility(promoteProductBSubstituteWhenAOutOfStock,{surfaceDefinitions}).status).toBe("unknown");
  });

  it("preserves hard economic constraint satisfied/violated/unknown",()=>{
    const context={surfaceDefinitions:merchandisingSurfaceDefinitions};
    expect(evaluateMerchandisingEligibility(featureProductAContribution100,{...context,hardConstraintResults:{merch_product_a_contribution_100:"satisfied"}}).status).toBe("eligible");
    expect(evaluateMerchandisingEligibility(featureProductAContribution100,{...context,hardConstraintResults:{merch_product_a_contribution_100:"violated"}}).status).toBe("ineligible");
    expect(evaluateMerchandisingEligibility(featureProductAContribution100,{...context,hardConstraintResults:{merch_product_a_contribution_100:"unknown"}}).status).toBe("unknown");
  });
});
