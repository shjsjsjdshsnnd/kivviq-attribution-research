import { describe,expect,it } from "vitest";
import { actionId } from "../../src/action_ontology/identity.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import { currencyCode,utcTimestamp } from "../../src/core/units.js";
import { fridaySevenDayBudgetTiming } from "../../src/action_timing/fixtures.js";
import { TRANSLATION_CONTEXT_SCHEMA_VERSION,type TranslationContext } from "../../src/action_translation/types.js";
import {
  fixture02Campaign,
  fixture06PromotionBeforeEmail,
  fixture07ConcurrentPaidMedia,
  fixture09InheritedPopulationOverride,
  fixture16MixedReversibility,
  fixture17RollbackAllSafe,
} from "../../src/compound_action/fixture_matrix.js";
import { validateCompoundAction } from "../../src/compound_action/validation.js";
import { compoundFingerprint,compoundsSemanticallyEqual,flattenCompoundAction } from "../../src/compound_action/semantics.js";
import { evaluateCompoundReadiness,deriveCompoundRollbackReadiness } from "../../src/compound_action/readiness.js";
import { translateCompoundAction } from "../../src/compound_action/translation.js";
import { COMPOUND_ACTION_EVALUATION_SCHEMA_VERSION,type CompoundActionEvaluation } from "../../src/compound_action/types.js";

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

function issueCodes(value:unknown):readonly string[]{
  const result=validateCompoundAction(value);
  return result.ok?[]:result.issues.map(x=>x.code);
}

describe("Step 13 final contract audit",()=>{
  it("makes population scope explicit and rejects hidden inheritance",()=>{
    expect(fixture02Campaign.populationBindingLevel).toBe("COMPONENT_LEVEL");
    expect(fixture09InheritedPopulationOverride.populationBindingLevel).toBe("COMPOUND_LEVEL");
    expect(validateCompoundAction(fixture02Campaign).ok).toBe(true);
    expect(validateCompoundAction(fixture09InheritedPopulationOverride).ok).toBe(true);

    const hidden={
      ...fixture02Campaign,
      compoundActionId:"compound_final_hidden_population" as any,
      components:fixture02Campaign.components.map((component,index)=>index===0?{...component,population:{kind:"INHERIT" as const}}:component),
    };
    expect(issueCodes(hidden)).toContain("INVALID_POPULATION_INHERITANCE");

    const missingBindingTime={
      ...fixture09InheritedPopulationOverride,
      compoundActionId:"compound_final_missing_population_binding_time" as any,
      defaultPopulationBindingTime:undefined,
    };
    expect(issueCodes(missingBindingTime)).toContain("MISSING_DEFAULT_POPULATION_BINDING_TIME");
  });

  it("keeps evaluation output in a separate versioned contract and rejects evaluation leakage from CompoundAction",()=>{
    const evaluation:CompoundActionEvaluation={
      kind:"compound_action_evaluation",
      schemaVersion:COMPOUND_ACTION_EVALUATION_SCHEMA_VERSION,
      evaluationId:"compound-evaluation:fixture-02",
      compoundActionId:fixture02Campaign.compoundActionId,
      evaluatedAt:clock,
      predictedOutcomes:[{
        metricId:"contribution_profit",
        horizonSeconds:604_800,
        estimate:125_000,
        unit:"CAD_minor",
        uncertainty:{kind:"INTERVAL",lower:100_000,upper:150_000,confidenceLevel:0.9},
      }],
      expectedRevenue:{kind:"money",amountMinor:250_000,currency:CAD},
      expectedProfit:{kind:"money",amountMinor:125_000,currency:CAD},
      expectedROAS:3.2,
      expectedLift:0.08,
      expectedSynergy:0.03,
      uncertainty:{kind:"QUALITATIVE",summary:"Synthetic evaluator-output example only."},
      interactionEffects:[{
        interactionId:"interaction:promotion-email",
        componentIds:["promotion","email"],
        metricId:"conversion_rate",
        estimate:0.02,
        unit:"absolute_rate",
        uncertainty:{kind:"UNKNOWN",reason:"No interaction estimator is implemented in Step 13."},
      }],
      risks:[{dimension:"measurement_uncertainty",assessment:"Attribution may be incomplete."}],
      recommendationRanking:{rank:2,score:0.62,rationale:"External evaluator-output example only."},
      evidenceRefs:["synthetic:evaluation-boundary"],
    };
    expect(evaluation.compoundActionId).toBe(fixture02Campaign.compoundActionId);

    const leakedFields:Record<string,unknown>={
      predictedOutcomes:evaluation.predictedOutcomes,
      expectedRevenue:evaluation.expectedRevenue,
      expectedProfit:evaluation.expectedProfit,
      interactionEffects:evaluation.interactionEffects,
      recommendationRanking:evaluation.recommendationRanking,
      counterfactualRevenue:{kind:"money",amountMinor:275_000,currency:CAD},
    };
    for(const [field,value] of Object.entries(leakedFields)){
      const leaked={...fixture02Campaign,[field]:value};
      expect(issueCodes(leaked)).toContain("FORBIDDEN_COMPOUND_INFORMATION");
    }
  });

  it("treats IDs and evaluation metadata as identity metadata, not business semantics",()=>{
    const componentNames=new Map([["promotion","promo_renamed"],["email","email_renamed"]]);
    const renamed={
      ...fixture06PromotionBeforeEmail,
      compoundActionId:"compound_final_semantic_renamed" as any,
      components:fixture06PromotionBeforeEmail.components.map((component,index)=>({
        ...component,
        componentId:componentNames.get(component.componentId)!,
        action:{...component.action,actionId:actionId("action_final_semantic_renamed_"+index)},
        timing:component.timing.kind==="DEPENDENT"
          ? {kind:"DEPENDENT" as const,dependencyIds:["renamed_dependency"]}
          : component.timing,
      })),
      ordering:{kind:"ORDERED" as const,componentIds:["promo_renamed","email_renamed"]},
      dependencies:[{dependencyId:"renamed_dependency",type:"EFFECTIVE_AFTER" as const,componentId:"email_renamed",dependsOnComponentId:"promo_renamed"}],
      description:"Renamed metadata only.",
      intent:"Same coordinated business manipulation.",
      measurement:{earliestMeaningfulEvaluationSeconds:60,primaryEvaluationSeconds:120,longTermFollowUpSeconds:180,metricIds:["different_evaluation_metric"]},
      provenance:{source:"human" as const,createdAt:"2026-09-23T13:00:00.000Z",evidenceRefs:["different:evidence"]},
    };
    expect(compoundsSemanticallyEqual(fixture06PromotionBeforeEmail,renamed as any)).toBe(true);
    expect(compoundFingerprint(fixture06PromotionBeforeEmail)).toBe(compoundFingerprint(renamed as any));
  });

  it("still changes semantic identity when coordination meaning changes",()=>{
    const changedPopulation={
      ...fixture06PromotionBeforeEmail,
      compoundActionId:"compound_final_population_semantics" as any,
      components:fixture06PromotionBeforeEmail.components.map(component=>component.componentId==="email"
        ? {...component,population:{kind:"OVERRIDE" as const,populationRef:"population:different",bindingTime:"SEND_TIME" as const}}
        : component),
    };
    expect(compoundsSemanticallyEqual(fixture06PromotionBeforeEmail,changedPopulation)).toBe(false);
  });

  it("normalizes constraint IDs while preserving the constraint itself as semantics",()=>{
    const original=fixture07ConcurrentPaidMedia;
    const a={...original,compoundActionId:"compound_final_constraint_a" as any,constraints:[{constraintId:"cap_a",kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE" as const,currency:"CAD",ratePeriod:"day" as const,amountMinor:1_000_000,hard:true as const}]};
    const b={...original,compoundActionId:"compound_final_constraint_b" as any,constraints:[{constraintId:"cap_b",kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE" as const,currency:"CAD",ratePeriod:"day" as const,amountMinor:1_000_000,hard:true as const}]};
    expect(compoundsSemanticallyEqual(a,b)).toBe(true);
  });

  it("rejects arbitrary, soft and duplicate compound constraints",()=>{
    const arbitrary={...fixture02Campaign,compoundActionId:"compound_final_arbitrary_constraint" as any,constraints:[{constraintId:"x",kind:"ARBITRARY_EXPRESSION",hard:true,expression:"profit > 0"}] as any};
    expect(issueCodes(arbitrary)).toContain("UNKNOWN_COMPOUND_CONSTRAINT_KIND");

    const soft={...fixture07ConcurrentPaidMedia,compoundActionId:"compound_final_soft_constraint" as any,constraints:[{constraintId:"soft",kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE",currency:"CAD",ratePeriod:"day",amountMinor:1_000_000,hard:false}] as any};
    expect(issueCodes(soft)).toContain("COMPOUND_CONSTRAINT_MUST_BE_HARD");

    const duplicate={...fixture07ConcurrentPaidMedia,compoundActionId:"compound_final_duplicate_constraint" as any,constraints:[
      {constraintId:"same",kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE",currency:"CAD",ratePeriod:"day",amountMinor:1_000_000,hard:true},
      {constraintId:"same",kind:"TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE",currency:"CAD",ratePeriod:"day",amountMinor:1_000_000,hard:true},
    ] as any};
    expect(issueCodes(duplicate)).toContain("DUPLICATE_COMPOUND_CONSTRAINT_ID");
  });

  it("enforces typed compound resource caps without an optimizer",()=>{
    const meta=assertValidAction({
      ...fixture07ConcurrentPaidMedia.components[0]!.action,
      actionId:actionId("action_final_resource_meta"),
      resourceRequirements:[{resourceType:"advertising_budget",amount:{kind:"known",value:{kind:"money",amountMinor:10_000,currency:CAD}}}],
    });
    const google=assertValidAction({
      ...fixture07ConcurrentPaidMedia.components[1]!.action,
      actionId:actionId("action_final_resource_google"),
      resourceRequirements:[{resourceType:"advertising_budget",amount:{kind:"known",value:{kind:"money",amountMinor:10_000,currency:CAD}}}],
    });
    const capped={
      ...fixture07ConcurrentPaidMedia,
      compoundActionId:"compound_final_resource_cap" as any,
      components:[
        {...fixture07ConcurrentPaidMedia.components[0]!,action:meta},
        {...fixture07ConcurrentPaidMedia.components[1]!,action:google},
      ],
      constraints:[{constraintId:"budget_resource_cap",kind:"TOTAL_RESOURCE_LTE" as const,resourceType:"advertising_budget",limit:{kind:"money" as const,amountMinor:15_000,currency:CAD},hard:true as const}],
    };
    expect(issueCodes(capped)).toContain("COMPOUND_RESOURCE_LIMIT_EXCEEDED");
  });

  it("allows components to share effective start while keeping different durations",()=>{
    const shorterTiming={
      ...fridaySevenDayBudgetTiming,
      duration:{state:"SPECIFIED" as const,value:{kind:"ELAPSED" as const,amount:24,unit:"HOUR" as const,anchor:"EFFECTIVE_START" as const}},
    };
    const coordinated={
      ...fixture07ConcurrentPaidMedia,
      compoundActionId:"compound_final_same_start_different_duration" as any,
      components:[
        {...fixture07ConcurrentPaidMedia.components[0]!,timing:{kind:"OVERRIDE" as const,timing:fridaySevenDayBudgetTiming}},
        {...fixture07ConcurrentPaidMedia.components[1]!,timing:{kind:"OVERRIDE" as const,timing:shorterTiming}},
      ],
    };
    expect(validateCompoundAction(coordinated).ok).toBe(true);
  });

  it("treats an unresolved global hard constraint as UNKNOWN, not partially ready",()=>{
    const evidence=fixture02Campaign.components.map(component=>({
      componentId:component.componentId,
      eligibility:"ELIGIBLE" as const,
      structuralValid:true,
      contextAvailable:true,
      populationResolved:true,
      timingResolved:true,
      simulatorCapability:true,
    }));
    const result=evaluateCompoundReadiness(fixture02Campaign,evidence,{unknownConstraintIds:["future_margin_floor"]});
    expect(result.state).toBe("UNKNOWN");
    expect(result.unknownConstraintIds).toEqual(["future_margin_floor"]);
  });

  it("reports rollbackable, irreversible, conflict and automatic-rollback readiness explicitly",()=>{
    const mixed=deriveCompoundRollbackReadiness(fixture16MixedReversibility);
    expect(mixed.rollbackableComponentIds).toContain("promotion");
    expect(mixed.irreversibleComponentIds).toContain("email");
    expect(mixed.policy).toBe(fixture16MixedReversibility.rollback.policy);

    const conflict=deriveCompoundRollbackReadiness(fixture17RollbackAllSafe,[],{
      componentEvidence:[{componentId:"price",state:"CONFLICT",reasons:["LATER_LEGITIMATE_PRICE_CHANGE"]}],
    });
    expect(conflict.conflicts).toContain("price");
    expect(conflict.components.find(x=>x.componentId==="price")?.reasons).toEqual(["LATER_LEGITIMATE_PRICE_CHANGE"]);
    expect(conflict.automaticRollbackAllowed).toBe(false);

    const manualOnly={...fixture17RollbackAllSafe,compoundActionId:"compound_final_manual_rollback" as any,rollback:{...fixture17RollbackAllSafe.rollback,policy:"NO_AUTOMATIC_ROLLBACK" as const}};
    expect(deriveCompoundRollbackReadiness(manualOnly).automaticRollbackAllowed).toBe(false);
  });

  it("translates dependency-gated unordered components in dependency order, not lexical ID order",()=>{
    const source=fixture07ConcurrentPaidMedia.components[0]!;
    const dependent=fixture07ConcurrentPaidMedia.components[1]!;
    const compound={
      ...fixture07ConcurrentPaidMedia,
      compoundActionId:"compound_final_unordered_dependency" as any,
      concurrency:"INDEPENDENT_TIMING" as const,
      components:[
        {...source,componentId:"z_source"},
        {...dependent,componentId:"a_dependent",timing:{kind:"DEPENDENT" as const,dependencyIds:["source_required"]}},
      ],
      dependencies:[{dependencyId:"source_required",type:"REQUIRES" as const,componentId:"a_dependent",dependsOnComponentId:"z_source"}],
      atomicity:"DEPENDENCY_GATED" as const,
      failurePolicy:"PAUSE_DEPENDENTS" as const,
    };
    expect(flattenCompoundAction(compound).map(x=>x.componentId)).toEqual(["a_dependent","z_source"]);
    const result=translateCompoundAction(compound,budgetContext);
    expect(result.status).toBe("TRANSLATED");
    expect(result.components.find(x=>x.componentId==="z_source")?.result.status).toBe("TRANSLATED");
    expect(result.components.find(x=>x.componentId==="a_dependent")?.result.status).toBe("TRANSLATED");
  });

  it("preserves compound provenance when flattening and translating",()=>{
    const flattened=flattenCompoundAction(fixture02Campaign);
    expect(flattened.every(component=>component.compoundProvenance===fixture02Campaign.provenance)).toBe(true);
    const translated=translateCompoundAction(fixture07ConcurrentPaidMedia,budgetContext);
    expect(translated.compoundProvenance).toEqual(fixture07ConcurrentPaidMedia.provenance);
  });

  it("rejects invalid completion semantics",()=>{
    const invalid={...fixture02Campaign,compoundActionId:"compound_final_bad_completion" as any,completionRule:"SOME_COMPONENTS_COMPLETE"};
    expect(issueCodes(invalid)).toContain("INVALID_COMPLETION_RULE");
  });
});
