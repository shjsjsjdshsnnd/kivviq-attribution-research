import { describe,expect,it } from "vitest";
import { actionId } from "../../src/action_ontology/identity.js";
import { runExperimentAction } from "../../src/action_ontology/fixtures.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { currencyCode,utcTimestamp } from "../../src/core/units.js";
import { TRANSLATION_CONTEXT_SCHEMA_VERSION,type TranslationContext } from "../../src/action_translation/types.js";
import {
  canonicalCompoundFixtures,
  requiredCompoundFixtures,
  fixture01BudgetReallocation,
  fixture02Campaign,
  fixture06PromotionBeforeEmail,
  fixture09InheritedPopulationOverride,
  fixture10InheritedTimingDelayedDependent,
  fixture12RecurringWeekend,
  fixture13UnsupportedSimulatorComponent,
  fixture14AllOrNothingUnsupported,
  fixture15BestEffortUnsupported,
  fixture16MixedReversibility,
  fixture18RollbackConflict,
  fixture20InvalidCircularDependency,
  fixture21InvalidConservation,
  fixture22MediaBudgetConstraintViolation,
  fixture23SameActionsDifferentOrder,
  fixture25NoOpControl,
  activeWithInvestigationCompound,
  activeWithWaitObserveCompound,
  googleBudgetPlus500PerDay,
} from "../../src/compound_action/fixture_matrix.js";
import { validateCompoundAction } from "../../src/compound_action/validation.js";
import { compoundFingerprint,compoundsSemanticallyEqual,flattenCompoundAction } from "../../src/compound_action/semantics.js";
import { serializeCompoundAction,deserializeCompoundAction } from "../../src/compound_action/serialization.js";
import { summarizeCompoundCosts,summarizeCompoundResources,summarizeCompoundRisk } from "../../src/compound_action/aggregates.js";
import { resolveCompoundPopulations,resolveCompoundTiming } from "../../src/compound_action/resolution.js";
import { deriveCompoundRollbackReadiness,evaluateCompoundReadiness } from "../../src/compound_action/readiness.js";
import { translateCompoundAction } from "../../src/compound_action/translation.js";
import { increaseMeta500PerDay } from "../../src/paid_media/fixtures.js";

const CAD=currencyCode("CAD");
const clock=utcTimestamp("2026-09-23T12:00:00.000Z");

const budgetContext:TranslationContext={
  schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock:clock,
  capabilities:["campaign_budget"],
  entityMappings:[
    {actionTarget:{kind:"advertising_channel",channelId:"meta_ads"},simulatorTarget:{kind:"channel",simulatorChannelId:"sim:meta"},sourceRef:"map:meta"},
    {actionTarget:{kind:"advertising_channel",channelId:"google_ads"},simulatorTarget:{kind:"channel",simulatorChannelId:"sim:google"},sourceRef:"map:google"},
  ],
  referenceBindings:[],
};

const promotionContext:TranslationContext={
  schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock:clock,
  capabilities:["promotion_discount"],
  entityMappings:[],
  referenceBindings:[],
  promotionMembershipBindings:[{
    promotionId:"promo_collection_x_auto_15",
    evaluateAt:"decision_time",
    bindingRef:"membership:promo:collection-x:2026-09-21T13:00:00Z",
    snapshotTime:utcTimestamp("2026-09-21T13:00:00Z"),
    sourceRef:"catalog:collection-x",
    members:[
      {businessTarget:{kind:"sku",productId:"product:C1",skuId:"sku:C1"},simulatorTarget:{kind:"sku",simulatorProductId:"sim:C1",simulatorSkuId:"sim:C1"},sourceRef:"member:C1"},
      {businessTarget:{kind:"sku",productId:"product:C2",skuId:"sku:C2"},simulatorTarget:{kind:"sku",simulatorProductId:"sim:C2",simulatorSkuId:"sim:C2"},sourceRef:"member:C2"},
    ],
  }],
};

describe("Step 13 full fixture and schema contract",()=>{
  it("keeps every canonical valid fixture structurally valid",()=>{
    expect(requiredCompoundFixtures).toHaveLength(25);
    expect(canonicalCompoundFixtures.length).toBeGreaterThanOrEqual(22);
    for(const fixture of canonicalCompoundFixtures)expect(validateCompoundAction(fixture)).toMatchObject({ok:true});
  });
  it("covers the required invalid cycle, conservation and hard media-cap fixtures",()=>{
    const cycle=validateCompoundAction(fixture20InvalidCircularDependency);
    const conservation=validateCompoundAction(fixture21InvalidConservation);
    const media=validateCompoundAction(fixture22MediaBudgetConstraintViolation);
    expect(cycle.ok).toBe(false);expect(conservation.ok).toBe(false);expect(media.ok).toBe(false);
    if(!cycle.ok)expect(cycle.issues.some(x=>x.code==="COMPOUND_DEPENDENCY_CYCLE")).toBe(true);
    if(!conservation.ok)expect(conservation.issues.some(x=>x.code==="COMPOUND_CONSERVATION_VIOLATION")).toBe(true);
    if(!media.ok)expect(media.issues.some(x=>x.code==="COMPOUND_MEDIA_BUDGET_LIMIT_EXCEEDED")).toBe(true);
  });
  it("rejects nested compounds rather than recursively interpreting them",()=>{
    const nested={...fixture02Campaign,compoundActionId:"compound_nested_invalid",components:[
      {...fixture02Campaign.components[0],action:fixture01BudgetReallocation as any},
      fixture02Campaign.components[1],
    ]};
    expect(validateCompoundAction(nested).ok).toBe(false);
  });
  it("rejects execution state and evaluation leakage",()=>{
    for(const extra of [{executionState:"EXECUTED"},{expectedSynergy:0.12},{recommendationScore:0.9}]){
      const result=validateCompoundAction({...fixture02Campaign,...extra});
      expect(result.ok).toBe(false);
    }
  });
  it("rejects unsupported compound schema versions",()=>{
    expect(validateCompoundAction({...fixture02Campaign,schemaVersion:"2.0.0"}).ok).toBe(false);
  });
  it("requires NO_OP inside active compounds to have explicit CONTROL role",()=>{
    expect(validateCompoundAction(fixture25NoOpControl).ok).toBe(true);
    const bad={...fixture25NoOpControl,components:fixture25NoOpControl.components.map(x=>x.componentId==="control"?{...x,role:"SUPPORTING" as const}:x)};
    expect(validateCompoundAction(bad).ok).toBe(false);
  });
});

describe("Step 13 semantic identity and serialization",()=>{
  it("distinguishes dependency/order semantics over the same atomic actions",()=>{
    expect(compoundsSemanticallyEqual(fixture01BudgetReallocation,fixture23SameActionsDifferentOrder)).toBe(false);
    expect(compoundFingerprint(fixture01BudgetReallocation)).not.toBe(compoundFingerprint(fixture23SameActionsDifferentOrder));
  });
  it("distinguishes ALL_OR_NOTHING from BEST_EFFORT",()=>{
    expect(compoundFingerprint(fixture14AllOrNothingUnsupported)).not.toBe(compoundFingerprint(fixture15BestEffortUnsupported));
  });
  it("keeps rollback policy in semantic identity",()=>{
    const changed={...fixture16MixedReversibility,compoundActionId:"compound_rollback_policy_variant" as any,rollback:{...fixture16MixedReversibility.rollback,policy:"NO_AUTOMATIC_ROLLBACK" as const}};
    expect(compoundFingerprint(changed)).not.toBe(compoundFingerprint(fixture16MixedReversibility));
  });
  it("round-trips the full canonical envelope deterministically",()=>{
    const serialized=serializeCompoundAction(fixture06PromotionBeforeEmail);
    const restored=deserializeCompoundAction(serialized);
    expect(serializeCompoundAction(restored)).toBe(serialized);
    expect(compoundsSemanticallyEqual(restored,fixture06PromotionBeforeEmail)).toBe(true);
  });
  it("flattens deterministically without losing compound, component or atomic identity",()=>{
    const flat=flattenCompoundAction(fixture06PromotionBeforeEmail);
    expect(flat.map(x=>x.componentId)).toEqual(["promotion","email"]);
    expect(flat.every(x=>x.compoundActionId===fixture06PromotionBeforeEmail.compoundActionId)).toBe(true);
    expect(flat.map(x=>String(x.action.actionId))).toEqual(["action_promo_collection_x_auto_15_4d","action_lifecycle_send_email_segment_a_friday_10"]);
  });
});

describe("Step 13 population and timing composition",()=>{
  it("resolves inherited and overridden population references without inventing membership",()=>{
    const result=resolveCompoundPopulations(fixture09InheritedPopulationOverride);
    expect(result.components).toMatchObject([
      {componentId:"vip_promotion",status:"REFERENCE_BOUND",populationRef:"population:vip-a",source:"COMPOUND_DEFAULT"},
      {componentId:"segment_email",status:"REFERENCE_BOUND",populationRef:"population:segment-a",source:"COMPONENT_OVERRIDE"},
    ]);
  });
  it("resolves inherited Step 12 timing and preserves dependent timing as relationally unresolved",()=>{
    const result=resolveCompoundTiming(fixture10InheritedTimingDelayedDependent,{approvedClock:clock});
    expect(result.components.find(x=>x.componentId==="promotion")?.status).toBe("RESOLVED");
    expect(result.components.find(x=>x.componentId==="email")?.status).toBe("UNRESOLVED");
    expect(result.unresolvedDependencies).toContain("promo_then_email");
  });
  it("keeps recurrence on one canonical CompoundAction rather than expanding merchant decisions",()=>{
    expect(fixture12RecurringWeekend.timing?.recurrence.state).toBe("SPECIFIED");
    expect(fixture12RecurringWeekend.components).toHaveLength(3);
    const result=resolveCompoundTiming(fixture12RecurringWeekend,{approvedClock:clock});
    expect(result.compound?.status).toBe("VALID");
  });
});

describe("Step 13 readiness and rollback",()=>{
  it("blocks ALL_OR_NOTHING on one unsupported component",()=>{
    const result=evaluateCompoundReadiness(fixture14AllOrNothingUnsupported,[
      {componentId:"promotion",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"email",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:false},
    ]);
    expect(result.state).toBe("BLOCKED");
  });
  it("reports partial readiness under BEST_EFFORT without dropping the unsupported component",()=>{
    const result=evaluateCompoundReadiness(fixture15BestEffortUnsupported,[
      {componentId:"promotion",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"email",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:false},
    ]);
    expect(result.state).toBe("PARTIALLY_READY");
    expect(result.components.find(x=>x.componentId==="email")?.state).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  });
  it("preserves UNKNOWN rather than collapsing it to INELIGIBLE",()=>{
    const result=evaluateCompoundReadiness(fixture14AllOrNothingUnsupported,[
      {componentId:"promotion",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"email",eligibility:"UNKNOWN",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
    ]);
    expect(result.state).toBe("UNKNOWN");
    expect(result.components.find(x=>x.componentId==="email")?.state).toBe("UNKNOWN");
  });
  it("blocks on known failed compound hard constraints and preserves unknown constraint state",()=>{
    const blocked=evaluateCompoundReadiness(fixture15BestEffortUnsupported,[
      {componentId:"promotion",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"email",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
    ],{constraintFailures:["compound_margin_floor"]});
    expect(blocked.state).toBe("BLOCKED");
    expect(blocked.constraintFailures).toEqual(["compound_margin_floor"]);
    const unknown=evaluateCompoundReadiness(fixture15BestEffortUnsupported,[
      {componentId:"promotion",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
      {componentId:"email",eligibility:"ELIGIBLE",structuralValid:true,contextAvailable:true,populationResolved:true,timingResolved:true,simulatorCapability:true},
    ],{unknownConstraintIds:["future_context_required"]});
    expect(unknown.state).toBe("PARTIALLY_READY");
  });
  it("uses reverse dependency order for rollback",()=>{
    const result=deriveCompoundRollbackReadiness(fixture06PromotionBeforeEmail);
    expect(result.requiredRollbackOrder).toEqual(["email","promotion"]);
  });
  it("keeps irreversible email and compensation separate from rollback",()=>{
    const result=deriveCompoundRollbackReadiness(fixture16MixedReversibility);
    expect(result.reversibility).toBe("PARTIALLY_REVERSIBLE");
    expect(result.compensationRequired).toBe(true);
    expect(result.components.find(x=>x.componentId==="email")?.state).toBe("IRREVERSIBLE");
    expect(result.compensationRequirements.find(x=>x.componentId==="email")?.required).toBe(true);
  });
  it("preserves domain rollback conflicts instead of forcing restoration",()=>{
    const result=deriveCompoundRollbackReadiness(fixture18RollbackConflict,["price"]);
    expect(result.overall).toBe("PARTIAL");
    expect(result.components.find(x=>x.componentId==="price")?.state).toBe("CONFLICT");
  });
});

describe("Step 13 cost resource and risk evidence",()=>{
  const meta=assertValidAction({
    ...increaseMeta500PerDay,
    actionId:actionId("action_compound_aggregate_meta"),
    cost:{...increaseMeta500PerDay.cost,directFinancialCost:{kind:"known",value:{kind:"money",amountMinor:1000,currency:CAD}}},
    resourceRequirements:[{resourceType:"advertising_budget",amount:{kind:"known",value:{kind:"money",amountMinor:50_000,currency:CAD}}}],
    riskDimensions:[{dimension:"financial_downside",downsideDefinition:"Known incremental spend can underperform."}],
  });
  const google=assertValidAction({
    ...googleBudgetPlus500PerDay,
    actionId:actionId("action_compound_aggregate_google"),
    cost:{...googleBudgetPlus500PerDay.cost,directFinancialCost:{kind:"known",value:{kind:"money",amountMinor:2000,currency:CAD}}},
    resourceRequirements:[{resourceType:"advertising_budget",amount:{kind:"known",value:{kind:"money",amountMinor:50_000,currency:CAD}}}],
    riskDimensions:[{dimension:"measurement_uncertainty",downsideDefinition:"Attribution may be incomplete."}],
  });
  const aggregateCompound={...fixture01BudgetReallocation,compoundActionId:"compound_aggregate_evidence" as any,components:[
    {...fixture01BudgetReallocation.components[0]!,componentId:"meta",action:meta},
    {...fixture01BudgetReallocation.components[1]!,componentId:"google",action:google},
  ],constraints:[]};
  it("aggregates only compatible known monetary costs",()=>{
    const summary=summarizeCompoundCosts(aggregateCompound);
    expect(summary.dimensions.find(x=>x.dimension==="directFinancialCost")).toMatchObject({status:"AGGREGATED",currency:"CAD",amountMinor:3000});
  });
  it("aggregates compatible resource requirements without optimization",()=>{
    expect(summarizeCompoundResources(aggregateCompound).aggregates).toContainEqual(expect.objectContaining({resourceType:"advertising_budget",status:"AGGREGATED",currency:"CAD",amount:100_000}));
  });
  it("preserves component risk and exposes only a categorical summary",()=>{
    const risk=summarizeCompoundRisk(aggregateCompound);
    expect(risk.dimensions).toEqual(["financial_downside","measurement_uncertainty"]);
    expect((risk as any).score).toBeUndefined();
  });
});

describe("Step 13 compound translation",()=>{
  it("preserves compound and atomic provenance through translated reallocation components",()=>{
    const result=translateCompoundAction(fixture01BudgetReallocation,budgetContext);
    expect(result.status).toBe("TRANSLATED");
    expect(result.interventions).toHaveLength(2);
    for(const intervention of result.interventions)expect(intervention.provenance.originatingBusinessActionId).toBe(fixture01BudgetReallocation.compoundActionId);
    expect(result.interventions.map(x=>x.provenance.sourceActionId).sort()).toEqual(["action_pm_google_up_2000_week","action_pm_meta_down_2000_week"].sort());
  });
  it("preserves one-to-many atomic translation provenance and explicit unsupported lifecycle component",()=>{
    const result=translateCompoundAction(fixture13UnsupportedSimulatorComponent,promotionContext);
    expect(result.status).toBe("PARTIALLY_TRANSLATED");
    expect(result.interventions).toHaveLength(2);
    expect(result.components.find(x=>x.componentId==="email")?.result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
    for(const intervention of result.interventions){
      expect(intervention.provenance.originatingBusinessActionId).toBe(fixture13UnsupportedSimulatorComponent.compoundActionId);
      expect(intervention.provenance.sourceActionId).toBe("action_promo_collection_x_auto_15_4d");
      expect(intervention.provenance.interventionCountWithinComponent).toBe(2);
    }
  });
  it("does not partially simulate an ALL_OR_NOTHING compound",()=>{
    const result=translateCompoundAction(fixture14AllOrNothingUnsupported,promotionContext);
    expect(result.status).toBe("NOT_TRANSLATABLE");
    expect(result.interventions).toEqual([]);
    expect(result.omittedComponentIds).toContain("email");
  });
  it("keeps INVESTIGATE as a zero-intervention component rather than faking a causal mutation",()=>{
    const result=translateCompoundAction(activeWithInvestigationCompound,budgetContext);
    expect(result.status).toBe("TRANSLATED");
    expect(result.components.find(x=>x.componentId==="investigate")?.interventions).toEqual([]);
    expect(result.interventions.length).toBeGreaterThan(0);
  });
  it("keeps WAIT/OBSERVE as a zero-intervention component",()=>{
    const result=translateCompoundAction(activeWithWaitObserveCompound,{
      ...budgetContext,
      entityMappings:[
        ...budgetContext.entityMappings,
        {actionTarget:{kind:"campaign",channelId:"google_ads",campaignId:"google_shopping"},simulatorTarget:{kind:"campaign",simulatorChannelId:"sim:google",simulatorCampaignId:"sim:shopping"},sourceRef:"map:shopping"},
      ],
    });
    expect(result.status).toBe("TRANSLATED");
    expect(result.components.find(x=>x.componentId==="wait")?.interventions).toEqual([]);
  });
  it("keeps RUN_EXPERIMENT as an engine boundary rather than embedding experiment design",()=>{
    const experimental={...fixture25NoOpControl,compoundActionId:"compound_experiment_boundary" as any,components:[
      {...fixture25NoOpControl.components[0]!,componentId:"experiment",action:runExperimentAction,role:"CONTROL" as const},
      fixture25NoOpControl.components[1]!,
    ]};
    const validation=validateCompoundAction(experimental);
    expect(validation.ok).toBe(true);
    const result=translateCompoundAction(experimental,promotionContext);
    expect(result.components.find(x=>x.componentId==="experiment")?.result.status).toBe("EXPERIMENT_REQUIRES_ENGINE");
    expect((experimental as any).trafficAllocation).toBeUndefined();
  });
  it("retains NO_OP control semantics without embedding experiment assignment",()=>{
    const result=translateCompoundAction(fixture25NoOpControl,promotionContext);
    expect(result.status).toBe("TRANSLATED");
    expect(result.components.find(x=>x.componentId==="control")?.interventions).toEqual([]);
    expect((fixture25NoOpControl as any).trafficAllocation).toBeUndefined();
  });
});
