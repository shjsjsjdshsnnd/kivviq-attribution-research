import { describe,expect,it } from "vitest";
import { currencyCode } from "../../src/core/units.js";
import { actionId } from "../../src/action_ontology/identity.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { delayedBudgetTiming,fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import { compoundActionId } from "../../src/compound_action/identity.js";
import { validateCompoundAction } from "../../src/compound_action/validation.js";
import { compoundFingerprint } from "../../src/compound_action/semantics.js";
import { summarizeCompoundCosts,summarizeCompoundResources } from "../../src/compound_action/aggregates.js";
import {
  fixture02Campaign,
  fixture03FullCampaign,
  fixture07ConcurrentPaidMedia,
  fixture09InheritedPopulationOverride,
  fixture17RollbackAllSafe,
  googleBudgetPlus500PerDay,
} from "../../src/compound_action/fixture_matrix.js";
import { increaseMeta500PerDay } from "../../src/paid_media/fixtures.js";

describe("Step 13 fail-closed composition edges",()=>{
  it("constructs only stable compound identities",()=>{
    expect(compoundActionId("compound_campaign_1")).toBe("compound_campaign_1");
    expect(()=>compoundActionId("action_wrong_level")).toThrow();
  });
  it("does not allow hidden population inheritance",()=>{
    const bad={...fixture09InheritedPopulationOverride,compoundActionId:"compound_missing_population_default" as any,defaultPopulation:undefined};
    const result=validateCompoundAction(bad);expect(result.ok).toBe(false);
    if(!result.ok)expect(result.issues.some(x=>x.code==="MISSING_DEFAULT_POPULATION")).toBe(true);
  });
  it("requires dependent timing to reference declared dependency IDs",()=>{
    const bad={...fixture02Campaign,compoundActionId:"compound_unknown_timing_dependency" as any,components:fixture02Campaign.components.map((x,i)=>i===0?{...x,timing:{kind:"DEPENDENT" as const,dependencyIds:["missing_dep"]}}:x)};
    const result=validateCompoundAction(bad);expect(result.ok).toBe(false);
    if(!result.ok)expect(result.issues.some(x=>x.code==="UNKNOWN_TIMING_DEPENDENCY_ID")).toBe(true);
  });
  it("rejects contradictory EFFECTIVE_TOGETHER timing overrides",()=>{
    const bad={...fixture07ConcurrentPaidMedia,compoundActionId:"compound_conflicting_effective_time" as any,components:[
      {...fixture07ConcurrentPaidMedia.components[0]!,timing:{kind:"OVERRIDE" as const,timing:fridaySevenDayBudgetTiming}},
      {...fixture07ConcurrentPaidMedia.components[1]!,timing:{kind:"OVERRIDE" as const,timing:delayedBudgetTiming}},
    ]};
    const result=validateCompoundAction(bad);expect(result.ok).toBe(false);
    if(!result.ok)expect(result.issues.some(x=>x.code==="EFFECTIVE_TOGETHER_TIMING_CONFLICT")).toBe(true);
  });
  it("requires explicit rollback order to cover every component exactly once",()=>{
    const bad={...fixture17RollbackAllSafe,compoundActionId:"compound_invalid_rollback_order" as any,rollback:{...fixture17RollbackAllSafe.rollback,order:"EXPLICIT" as const,explicitComponentOrder:["price"]}};
    const result=validateCompoundAction(bad);expect(result.ok).toBe(false);
    if(!result.ok)expect(result.issues.some(x=>x.code==="INVALID_EXPLICIT_ROLLBACK_ORDER")).toBe(true);
  });
  it("preserves all cross-family atomic categories in the coordinated campaign",()=>{
    expect(new Set(fixture03FullCampaign.components.map(x=>x.action.actionCategory))).toEqual(new Set(["promotion","lifecycle","advertising","merchandising"]));
  });
  it("preserves component measurement horizons separately from compound measurement",()=>{
    expect(fixture03FullCampaign.components.every(x=>x.action.measurement.primaryEvaluationSeconds>0)).toBe(true);
    expect(fixture03FullCampaign.measurement.primaryEvaluationSeconds).toBe(30*86400);
  });
  it("keeps failure policy as compound semantics",()=>{
    const abort={...fixture02Campaign,compoundActionId:"compound_abort_semantics" as any,failurePolicy:"ABORT_COMPOUND" as const};
    const cont={...fixture02Campaign,compoundActionId:"compound_continue_semantics" as any,failurePolicy:"CONTINUE_INDEPENDENT_COMPONENTS" as const};
    expect(compoundFingerprint(abort)).not.toBe(compoundFingerprint(cont));
  });
});

describe("Step 13 safe aggregation edges",()=>{
  const CAD=currencyCode("CAD");
  const USD=currencyCode("USD");
  const meta=assertValidAction({
    ...increaseMeta500PerDay,
    actionId:actionId("action_compound_edge_meta"),
    cost:{...increaseMeta500PerDay.cost,directFinancialCost:{kind:"known",value:{kind:"money",amountMinor:100,currency:CAD}}},
    resourceRequirements:[{resourceType:"operational_capacity",amount:{kind:"known",value:{kind:"quantity",value:2,unit:"hours"}}}],
  });
  const google=assertValidAction({
    ...googleBudgetPlus500PerDay,
    actionId:actionId("action_compound_edge_google"),
    cost:{...googleBudgetPlus500PerDay.cost,directFinancialCost:{kind:"known",value:{kind:"money",amountMinor:100,currency:USD}}},
    resourceRequirements:[{resourceType:"operational_capacity",amount:{kind:"known",value:{kind:"quantity",value:3,unit:"days"}}}],
  });
  const mixed={...fixture07ConcurrentPaidMedia,compoundActionId:"compound_mixed_aggregation" as any,components:[
    {...fixture07ConcurrentPaidMedia.components[0]!,action:meta},
    {...fixture07ConcurrentPaidMedia.components[1]!,action:google},
  ]};
  it("does not sum currencies without an approved conversion",()=>{
    expect(summarizeCompoundCosts(mixed).dimensions.find(x=>x.dimension==="directFinancialCost")?.status).toBe("MIXED_CURRENCY");
  });
  it("does not sum incompatible resource units",()=>{
    expect(summarizeCompoundResources(mixed).aggregates.find(x=>x.resourceType==="operational_capacity")?.status).toBe("INCOMPATIBLE_UNITS");
  });
});
