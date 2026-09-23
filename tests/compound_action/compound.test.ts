import { describe,expect,it } from "vitest";
import { metaToGoogleCompound,orderedMetaThenGoogleCompound } from "../../src/compound_action/fixtures.js";
import { validateCompoundAction } from "../../src/compound_action/validation.js";
import { compoundFingerprint,compoundsSemanticallyEqual,flattenCompoundAction } from "../../src/compound_action/semantics.js";
import { deriveCompoundRollbackReadiness,evaluateCompoundReadiness } from "../../src/compound_action/readiness.js";

describe("Step 13 canonical CompoundAction",()=>{
  it("validates conserved ALL_OR_NOTHING budget reallocation",()=>expect(validateCompoundAction(metaToGoogleCompound)).toMatchObject({ok:true}));
  it("preserves atomic Action identity",()=>expect(metaToGoogleCompound.components.map(x=>x.action.actionId)).toEqual(["action_pm_meta_down_2000_week","action_pm_google_up_2000_week"]));
  it("rejects violated conservation",()=>{
    const bad={...metaToGoogleCompound,constraints:[{...metaToGoogleCompound.constraints[0]!,amountMinor:1}]};
    const r=validateCompoundAction(bad);expect(r.ok).toBe(false);if(!r.ok)expect(r.issues.some(x=>x.code==="COMPOUND_CONSERVATION_VIOLATION")).toBe(true);
  });
  it("rejects circular component dependencies",()=>{
    const bad={...orderedMetaThenGoogleCompound,dependencies:[
      {dependencyId:"a",type:"REQUIRES" as const,componentId:"meta_source",dependsOnComponentId:"google_destination"},
      {dependencyId:"b",type:"REQUIRES" as const,componentId:"google_destination",dependsOnComponentId:"meta_source"},
    ]};
    const r=validateCompoundAction(bad);expect(r.ok).toBe(false);if(!r.ok)expect(r.issues.some(x=>x.code==="COMPOUND_DEPENDENCY_CYCLE")).toBe(true);
  });
  it("rejects prediction leakage",()=>{
    const bad={...metaToGoogleCompound,expectedRevenue:100000};
    const r=validateCompoundAction(bad);expect(r.ok).toBe(false);if(!r.ok)expect(r.issues.some(x=>x.code==="FORBIDDEN_COMPOUND_INFORMATION")).toBe(true);
  });
  it("keeps order/dependency/atomicity in semantic identity",()=>{
    expect(compoundsSemanticallyEqual(metaToGoogleCompound,orderedMetaThenGoogleCompound)).toBe(false);
    expect(compoundFingerprint(metaToGoogleCompound)).not.toBe(compoundFingerprint(orderedMetaThenGoogleCompound));
  });
  it("deterministically flattens while preserving compound provenance",()=>{
    const flat=flattenCompoundAction(metaToGoogleCompound);
    expect(flat).toHaveLength(2);expect(flat[0]?.compoundActionId).toBe(metaToGoogleCompound.compoundActionId);expect(flat[0]?.action.actionId).toBe("action_pm_google_up_2000_week");
  });
  it("blocks ALL_OR_NOTHING when one component is unsupported",()=>{
    const r=evaluateCompoundReadiness(metaToGoogleCompound,[
      {componentId:"meta_source",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"google_destination",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:false},
    ]);
    expect(r.state).toBe("BLOCKED");expect(r.components[1]?.state).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  });
  it("permits explicit partial readiness under BEST_EFFORT without dropping component state",()=>{
    const c={...metaToGoogleCompound,atomicity:"BEST_EFFORT" as const,failurePolicy:"CONTINUE_INDEPENDENT_COMPONENTS" as const};
    const r=evaluateCompoundReadiness(c,[
      {componentId:"meta_source",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"google_destination",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:false},
    ]);
    expect(r.state).toBe("PARTIALLY_READY");expect(r.components).toHaveLength(2);
  });
  it("does not collapse unknown eligibility into ineligible",()=>{
    const r=evaluateCompoundReadiness(metaToGoogleCompound,[
      {componentId:"meta_source",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"google_destination",eligibility:"UNKNOWN",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
    ]);
    expect(r.state).toBe("UNKNOWN");expect(r.components[1]?.state).toBe("UNKNOWN");
  });
  it("derives rollback readiness without bypassing component conflict",()=>{
    const r=deriveCompoundRollbackReadiness(metaToGoogleCompound,["google_destination"]);
    expect(r.overall).toBe("PARTIAL");expect(r.conflicts).toEqual(["google_destination"]);expect(r.components.some(x=>x.state==="CONFLICT")).toBe(true);
  });
});
