import { validateAction } from "../action_ontology/validation.js";
import { canonicalizeForSerialization } from "../action_ontology/semantics.js";
import { validateActionTiming, validateTimingDependencyGraph } from "../action_timing/validation.js";
import {
  COMPOUND_ACTION_SCHEMA_VERSION,
  type CompoundAction,
  type CompoundConstraint,
  type PopulationBindingTime,
} from "./types.js";

export interface CompoundValidationIssue {readonly code:string;readonly path:string;readonly message:string}
export type CompoundValidationResult={readonly ok:true;readonly compound:CompoundAction;readonly issues:readonly []}|{readonly ok:false;readonly issues:readonly CompoundValidationIssue[]};

const TOP_LEVEL_FIELDS=new Set(["kind","compoundActionId","schemaVersion","description","intent","components","ordering","concurrency","dependencies","atomicity","failurePolicy","completionRule","populationBindingLevel","defaultPopulation","defaultPopulationBindingTime","timing","constraints","rollback","measurement","provenance"]);
const COMPONENT_FIELDS=new Set(["componentId","action","role","population","timing"]);
const DEPENDENCY_FIELDS=new Set(["dependencyId","type","componentId","dependsOnComponentId"]);
const ROLLBACK_FIELDS=new Set(["policy","order","explicitComponentOrder","irreversibleComponentPolicy"]);
const MEASUREMENT_FIELDS=new Set(["earliestMeaningfulEvaluationSeconds","primaryEvaluationSeconds","longTermFollowUpSeconds","metricIds"]);
const PROVENANCE_FIELDS=new Set(["source","sourceId","createdAt","evidenceRefs"]);
const COMPONENT_ROLES=new Set(["SOURCE","DESTINATION","PRIMARY","SUPPORTING","TRIGGER","DEPENDENT","CONTROL"]);
const BINDING_TIMES=new Set<PopulationBindingTime>(["DECISION_TIME","EFFECTIVE_TIME","SEND_TIME","TRIGGER_TIME"]);
const PROVENANCE_SOURCES=new Set(["human","rule_based_baseline","diagnosis_engine","opportunity_engine","optimizer","experiment_selector","imported_manual"]);
const CONSTRAINT_KINDS=new Set(["SUM_MONETARY_DELTAS_EQUALS","TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE","TOTAL_DISCOUNT_EXPOSURE_LTE","MINIMUM_CONTRIBUTION_GTE","TOTAL_RESOURCE_LTE"]);
const FORBIDDEN=new Set([
  "expectedRevenue","expectedProfit","expectedROAS","expectedLift","expectedSynergy",
  "predictedInteractionEffect","predictedConversions","predictedROAS","futureDemand",
  "futureDemandPeak","recommendationScore","confidenceScore","bestAction","bestCompound",
  "evaluationResult","executionStatus","executionState","lifecycleState","executedAt",
  "failedAt","rolledBackAt","partiallyExecuted","trafficAllocation","randomization",
  "significanceThreshold","statisticalPower","experimentResult","recommendedTreatment",
  "predictedBestStart","predictedOptimalDuration","expectedBestSendTime",\n  "counterfactualRevenue","predictedOutcomes","interactionEffects","predictedInteractionEffects","recommendationRanking",
]);

function record(v:unknown):v is any{return typeof v==="object"&&v!==null&&!Array.isArray(v)}
function nonEmpty(v:unknown):v is string{return typeof v==="string"&&v.trim().length>0}
function add(a:CompoundValidationIssue[],code:string,path:string,message:string):void{a.push({code,path,message})}
function unknownFields(v:unknown,allowed:Set<string>,path:string,a:CompoundValidationIssue[]):void{
  if(!record(v))return;
  for(const key of Object.keys(v))if(!allowed.has(key))add(a,"UNKNOWN_COMPOUND_FIELD",path?path+"."+key:key,"unknown compound fields are rejected rather than interpreted implicitly");
}
function leakage(v:unknown,path:string,a:CompoundValidationIssue[]):void{
  if(Array.isArray(v)){v.forEach((x,i)=>leakage(x,path+"["+i+"]",a));return}
  if(!record(v))return;
  for(const [k,x] of Object.entries(v)){
    const p=path==="$"?k:path+"."+k;
    if(FORBIDDEN.has(k))add(a,"FORBIDDEN_COMPOUND_INFORMATION",p,"prediction, evaluation, experiment-assignment and runtime state do not belong in CompoundAction");
    leakage(x,p,a);
  }
}
function budgetDelta(action:any):{signed:number;currency:string;per:string}|undefined{
  if(action.actionType!=="advertising.adjust_budget"||action.parameters?.kind!=="budget_adjustment"||action.parameters.operation?.kind!=="DELTA"||action.parameters.operation.amount?.kind!=="money_rate")return undefined;
  const m=action.parameters.operation.amount;
  return{signed:(action.parameters.operation.direction==="decrease"?-1:1)*m.amountMinor,currency:String(m.currency),per:m.per};
}
function scalarResource(value:any):{kind:"money"|"quantity";unitKey:string;amount:number}|undefined{
  if(!record(value))return undefined;
  if(value.kind==="money"&&Number.isFinite(value.amountMinor))return{kind:"money",unitKey:String(value.currency),amount:Number(value.amountMinor)};
  if(value.kind==="quantity"&&Number.isFinite(value.value))return{kind:"quantity",unitKey:String(value.unit),amount:Number(value.value)};
  return undefined;
}
function validatePopulationBinding(binding:any,path:string,a:CompoundValidationIssue[]):void{
  if(!record(binding)||!["INHERIT","OVERRIDE","NOT_APPLICABLE"].includes(String(binding.kind))){
    add(a,"INVALID_POPULATION_BINDING",path,"explicit population binding is required");return;
  }
  const allowed=binding.kind==="INHERIT"?new Set(["kind"]):binding.kind==="OVERRIDE"?new Set(["kind","populationRef","bindingTime"]):new Set(["kind","reason"]);
  unknownFields(binding,allowed,path,a);
  if(binding.kind==="OVERRIDE"){
    if(!nonEmpty(binding.populationRef))add(a,"INVALID_POPULATION_OVERRIDE",path+".populationRef","override requires a population reference");
    if(!BINDING_TIMES.has(binding.bindingTime))add(a,"INVALID_POPULATION_BINDING_TIME",path+".bindingTime","override requires an explicit supported binding time");
  }
  if(binding.kind==="NOT_APPLICABLE"&&!nonEmpty(binding.reason))add(a,"INVALID_POPULATION_NOT_APPLICABLE",path+".reason","NOT_APPLICABLE requires a reason");
}
function validateTimingBinding(binding:any,path:string,a:CompoundValidationIssue[]):void{
  if(!record(binding)||!["INHERIT","OVERRIDE","DEPENDENT"].includes(String(binding.kind))){
    add(a,"INVALID_TIMING_BINDING",path,"explicit timing binding is required");return;
  }
  const allowed=binding.kind==="INHERIT"?new Set(["kind"]):binding.kind==="OVERRIDE"?new Set(["kind","timing"]):new Set(["kind","dependencyIds"]);
  unknownFields(binding,allowed,path,a);
  if(binding.kind==="OVERRIDE"&&!validateActionTiming(binding.timing).ok)add(a,"INVALID_COMPONENT_TIMING",path+".timing","timing override is invalid");
  if(binding.kind==="DEPENDENT"){
    if(!Array.isArray(binding.dependencyIds)||binding.dependencyIds.length===0)add(a,"EMPTY_DEPENDENT_TIMING",path+".dependencyIds","DEPENDENT timing requires at least one dependency ID");
    else if(binding.dependencyIds.some((x:any)=>!nonEmpty(x))||new Set(binding.dependencyIds).size!==binding.dependencyIds.length)add(a,"INVALID_DEPENDENT_TIMING_IDS",path+".dependencyIds","dependency IDs must be non-empty and unique");
  }
}
function validateConstraint(c:any,compound:CompoundAction,a:CompoundValidationIssue[],i:number):void{
  const p="constraints["+i+"]";
  const components:any[]=Array.isArray((compound as any).components)?(compound as any).components:[];
  if(!record(c)){add(a,"INVALID_COMPOUND_CONSTRAINT",p,"constraint must be an object");return}
  if(!nonEmpty(c.constraintId))add(a,"INVALID_COMPOUND_CONSTRAINT_ID",p+".constraintId","stable constraint identity is required");
  if(!CONSTRAINT_KINDS.has(String(c.kind))){add(a,"UNKNOWN_COMPOUND_CONSTRAINT_KIND",p+".kind","constraint kind must be canonical and machine-evaluable");return}
  if(c.hard!==true)add(a,"COMPOUND_CONSTRAINT_MUST_BE_HARD",p+".hard","compound constraints in this contract are hard constraints");
  const base=["constraintId","kind","hard"];
  if(c.kind==="SUM_MONETARY_DELTAS_EQUALS"||c.kind==="TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE"){
    unknownFields(c,new Set([...base,"currency","ratePeriod","amountMinor"]),p,a);
    if(!nonEmpty(c.currency))add(a,"INVALID_CONSTRAINT_CURRENCY",p+".currency","currency is required");
    if(!["day","week","month"].includes(String(c.ratePeriod)))add(a,"INVALID_CONSTRAINT_RATE_PERIOD",p+".ratePeriod","rate period must be day, week or month");
    if(!Number.isInteger(c.amountMinor))add(a,"INVALID_CONSTRAINT_AMOUNT",p+".amountMinor","amountMinor must be an integer");
    if(c.kind==="TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE"&&Number(c.amountMinor)<0)add(a,"INVALID_CONSTRAINT_AMOUNT",p+".amountMinor","budget cap cannot be negative");
  }else if(c.kind==="TOTAL_DISCOUNT_EXPOSURE_LTE"||c.kind==="MINIMUM_CONTRIBUTION_GTE"){
    unknownFields(c,new Set([...base,"currency","amountMinor"]),p,a);
    if(!nonEmpty(c.currency))add(a,"INVALID_CONSTRAINT_CURRENCY",p+".currency","currency is required");
    if(!Number.isInteger(c.amountMinor))add(a,"INVALID_CONSTRAINT_AMOUNT",p+".amountMinor","amountMinor must be an integer");
    if(c.kind==="TOTAL_DISCOUNT_EXPOSURE_LTE"&&Number(c.amountMinor)<0)add(a,"INVALID_CONSTRAINT_AMOUNT",p+".amountMinor","discount exposure cap cannot be negative");
  }else if(c.kind==="TOTAL_RESOURCE_LTE"){
    unknownFields(c,new Set([...base,"resourceType","limit"]),p,a);
    if(!nonEmpty(c.resourceType))add(a,"INVALID_RESOURCE_CONSTRAINT_TYPE",p+".resourceType","resourceType is required");
    const limit=scalarResource(c.limit);
    if(!limit||limit.amount<0)add(a,"INVALID_RESOURCE_CONSTRAINT_LIMIT",p+".limit","resource cap requires a non-negative money or quantity limit");
  }

  if(c.kind==="SUM_MONETARY_DELTAS_EQUALS"){
    const legs=components.map((x:any)=>budgetDelta(x?.action)).filter((x:any):x is NonNullable<typeof x>=>!!x);
    if(!legs.length){add(a,"CONSERVATION_HAS_NO_MONETARY_LEGS",p,"conservation requires budget DELTA components");return}
    if(legs.some((x:any)=>x.currency!==c.currency||x.per!==c.ratePeriod)){add(a,"CONSERVATION_UNIT_MISMATCH",p,"currency and rate period must match");return}
    if(legs.reduce((n:number,x:any)=>n+x.signed,0)!==c.amountMinor)add(a,"COMPOUND_CONSERVATION_VIOLATION",p,"signed monetary deltas violate conservation");
  }
  if(c.kind==="TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE"){
    const legs=components.map((x:any)=>budgetDelta(x?.action)).filter((x:any):x is NonNullable<typeof x>=>!!x&&x.signed>0);
    if(legs.some((x:any)=>x.currency!==c.currency||x.per!==c.ratePeriod)){add(a,"MEDIA_BUDGET_CONSTRAINT_UNIT_MISMATCH",p,"known incremental media legs must match constraint units");return}
    const total=legs.reduce((n:number,x:any)=>n+x.signed,0);
    if(total>c.amountMinor)add(a,"COMPOUND_MEDIA_BUDGET_LIMIT_EXCEEDED",p,"known incremental media budget exceeds the compound hard limit");
  }
  if(c.kind==="TOTAL_RESOURCE_LTE"){
    const limit=scalarResource(c.limit);
    if(!limit)return;
    const requirements=components.flatMap((component:any)=>Array.isArray(component?.action?.resourceRequirements)?component.action.resourceRequirements.filter((x:any)=>x.resourceType===c.resourceType):[]);
    const known=requirements.filter((x:any)=>x.amount.kind==="known").map((x:any)=>scalarResource((x.amount as any).value));
    if(known.some((x:any)=>!x||x.kind!==limit.kind||x.unitKey!==limit.unitKey)){
      add(a,"RESOURCE_CONSTRAINT_UNIT_MISMATCH",p,"known resource requirements must use the same scalar kind and unit as the cap");return;
    }
    if(requirements.some((x:any)=>x.amount.kind==="unknown"))return;
    const total=(known as NonNullable<typeof known[number]>[]).reduce((n:number,x:any)=>n+x.amount,0);
    if(total>limit.amount)add(a,"COMPOUND_RESOURCE_LIMIT_EXCEEDED",p,"known resource requirements exceed the compound hard cap");
  }
}
function startCoordinationFingerprint(timing:any,kind:"START_TOGETHER"|"EFFECTIVE_TOGETHER"):string{
  const projection=kind==="START_TOGETHER"
    ? {requestedStart:timing.requestedStart,timezone:timing.timezone}
    : {requestedStart:timing.requestedStart,implementationDelay:timing.implementationDelay,effectiveStart:timing.effectiveStart,timezone:timing.timezone};
  return JSON.stringify(canonicalizeForSerialization(projection));
}

export function validateCompoundAction(input:unknown):CompoundValidationResult{
  const a:CompoundValidationIssue[]=[];
  if(!record(input))return{ok:false,issues:[{code:"INVALID_COMPOUND_ACTION",path:"$",message:"CompoundAction must be an object"}]};
  leakage(input,"$",a);
  unknownFields(input,TOP_LEVEL_FIELDS,"",a);
  if(input.kind!=="compound_action")add(a,"INVALID_COMPOUND_KIND","kind","must be compound_action");
  if(input.schemaVersion!==COMPOUND_ACTION_SCHEMA_VERSION)add(a,"UNSUPPORTED_COMPOUND_SCHEMA","schemaVersion","unsupported CompoundAction schema");
  if(typeof input.compoundActionId!=="string"||!/^compound_[A-Za-z0-9._:-]+$/.test(input.compoundActionId))add(a,"INVALID_COMPOUND_ID","compoundActionId","must begin with compound_");
  if(!nonEmpty(input.description))add(a,"MISSING_COMPOUND_DESCRIPTION","description","description is required");
  if(!nonEmpty(input.intent))add(a,"MISSING_COMPOUND_INTENT","intent","business intent is required");

  if(!["COMPOUND_LEVEL","COMPONENT_LEVEL"].includes(String(input.populationBindingLevel)))add(a,"INVALID_POPULATION_BINDING_LEVEL","populationBindingLevel","population binding level must be explicit");
  if(input.populationBindingLevel==="COMPOUND_LEVEL"){
    if(!nonEmpty(input.defaultPopulation))add(a,"MISSING_DEFAULT_POPULATION","defaultPopulation","COMPOUND_LEVEL binding requires a default population");
    if(!BINDING_TIMES.has(input.defaultPopulationBindingTime))add(a,"MISSING_DEFAULT_POPULATION_BINDING_TIME","defaultPopulationBindingTime","COMPOUND_LEVEL binding requires an explicit default binding time");
  }else if(input.populationBindingLevel==="COMPONENT_LEVEL"){
    if(input.defaultPopulation!==undefined||input.defaultPopulationBindingTime!==undefined)add(a,"COMPONENT_LEVEL_HAS_COMPOUND_DEFAULT","defaultPopulation","COMPONENT_LEVEL binding cannot declare a compound default");
  }
  if(input.defaultPopulationBindingTime!==undefined&&!BINDING_TIMES.has(input.defaultPopulationBindingTime))add(a,"INVALID_DEFAULT_POPULATION_BINDING_TIME","defaultPopulationBindingTime","unsupported population binding time");

  const ids=new Set<string>();
  const actionIds=new Set<string>();
  if(!Array.isArray(input.components)||input.components.length<2)add(a,"INVALID_COMPOUND_COMPONENTS","components","at least two atomic components are required");
  else input.components.forEach((c:any,i:number)=>{
    const p="components["+i+"]";
    if(!record(c)){add(a,"INVALID_COMPOUND_COMPONENT",p,"component must be an object");return}
    unknownFields(c,COMPONENT_FIELDS,p,a);
    if(!nonEmpty(c.componentId)){add(a,"INVALID_COMPONENT_ID",p+".componentId","component identity is required");return}
    if(ids.has(c.componentId))add(a,"DUPLICATE_COMPONENT_ID",p+".componentId","component IDs must be unique");ids.add(c.componentId);
    if(c.role!==undefined&&!COMPONENT_ROLES.has(c.role))add(a,"INVALID_COMPONENT_ROLE",p+".role","unsupported component role");
    const v=validateAction(c.action);
    if(!v.ok)add(a,"INVALID_ATOMIC_COMPONENT",p+".action","component must be a valid canonical atomic Action");
    else{
      if(actionIds.has(String(v.action.actionId)))add(a,"DUPLICATE_ATOMIC_ACTION_ID",p+".action.actionId","each component must preserve a distinct atomic Action identity");
      actionIds.add(String(v.action.actionId));
      if(v.action.parameters.kind==="no_op"&&c.role!=="CONTROL")add(a,"NO_OP_COMPONENT_REQUIRES_CONTROL_ROLE",p+".role","NO_OP requires explicit CONTROL role");
    }
    validatePopulationBinding(c.population,p+".population",a);
    if(c.population?.kind==="INHERIT"&&input.populationBindingLevel!=="COMPOUND_LEVEL")add(a,"INVALID_POPULATION_INHERITANCE",p+".population","INHERIT is only valid under explicit COMPOUND_LEVEL binding");
    validateTimingBinding(c.timing,p+".timing",a);
    if(c.timing?.kind==="INHERIT"&&!input.timing)add(a,"MISSING_COMPOUND_TIMING",p+".timing","INHERIT requires compound timing");
  });

  if(!record(input.ordering)||!["UNORDERED","ORDERED"].includes(String(input.ordering.kind)))add(a,"INVALID_COMPOUND_ORDERING","ordering","ordering semantics are required");
  else{
    unknownFields(input.ordering,input.ordering.kind==="ORDERED"?new Set(["kind","componentIds"]):new Set(["kind"]),"ordering",a);
    if(input.ordering.kind==="ORDERED"&&(!Array.isArray(input.ordering.componentIds)||input.ordering.componentIds.length!==ids.size||new Set(input.ordering.componentIds).size!==ids.size||input.ordering.componentIds.some((id:any)=>!ids.has(id))))add(a,"INVALID_COMPONENT_ORDER","ordering.componentIds","ordered compounds must contain every component exactly once");
  }
  if(!["START_TOGETHER","EFFECTIVE_TOGETHER","INDEPENDENT_TIMING"].includes(String(input.concurrency)))add(a,"INVALID_COMPOUND_CONCURRENCY","concurrency","concurrency semantics are required");
  if(!["ALL_OR_NOTHING","BEST_EFFORT","DEPENDENCY_GATED"].includes(String(input.atomicity)))add(a,"INVALID_COMPOUND_ATOMICITY","atomicity","atomicity intent is required");
  if(!["ABORT_COMPOUND","CONTINUE_INDEPENDENT_COMPONENTS","ROLLBACK_COMPLETED_COMPONENTS","PAUSE_DEPENDENTS"].includes(String(input.failurePolicy)))add(a,"INVALID_FAILURE_POLICY","failurePolicy","failure semantics are required");
  if(!["ALL_COMPONENTS_COMPLETE","ALL_REQUIRED_COMPONENTS_COMPLETE"].includes(String(input.completionRule)))add(a,"INVALID_COMPLETION_RULE","completionRule","completion semantics are required");

  const dependencyById=new Map<string,any>();
  if(!Array.isArray(input.dependencies))add(a,"INVALID_COMPOUND_DEPENDENCIES","dependencies","dependencies must be an array");
  else{
    const semanticDependencies=new Set<string>();
    for(const [i,d] of input.dependencies.entries()){
      const p="dependencies["+i+"]";
      if(!record(d)){add(a,"INVALID_COMPONENT_DEPENDENCY",p,"invalid dependency");continue}
      unknownFields(d,DEPENDENCY_FIELDS,p,a);
      if(!["START_AFTER","EFFECTIVE_AFTER","COMPLETE_AFTER","REQUIRES","END_WITH"].includes(String(d.type)))add(a,"INVALID_COMPONENT_DEPENDENCY",p+".type","invalid dependency type");
      if(!nonEmpty(d.dependencyId))add(a,"INVALID_DEPENDENCY_ID",p+".dependencyId","dependency identity is required");
      else if(dependencyById.has(d.dependencyId))add(a,"DUPLICATE_DEPENDENCY_ID",p+".dependencyId","dependency IDs must be unique");
      else dependencyById.set(d.dependencyId,d);
      if(!ids.has(d.componentId)||!ids.has(d.dependsOnComponentId))add(a,"MISSING_DEPENDENCY_COMPONENT",p,"dependency must reference existing components");
      if(d.componentId===d.dependsOnComponentId)add(a,"SELF_COMPONENT_DEPENDENCY",p,"self-dependency is impossible");
      const semanticKey=String(d.type)+"|"+String(d.componentId)+"|"+String(d.dependsOnComponentId);
      if(semanticDependencies.has(semanticKey))add(a,"DUPLICATE_COMPONENT_DEPENDENCY",p,"duplicate semantic dependencies are not allowed");
      semanticDependencies.add(semanticKey);
    }
    if(Array.isArray(input.components)){
      for(const [i,component] of input.components.entries()){
        if(component?.timing?.kind==="DEPENDENT"){
          for(const depId of component.timing.dependencyIds??[]){
            const dependency=dependencyById.get(depId);
            if(!dependency)add(a,"UNKNOWN_TIMING_DEPENDENCY_ID","components["+i+"].timing.dependencyIds","DEPENDENT timing must reference declared dependencies");
            else if(dependency.componentId!==component.componentId)add(a,"TIMING_DEPENDENCY_TARGET_MISMATCH","components["+i+"].timing.dependencyIds","timing dependency must target the component that declares it");
          }
        }
      }
      const graph=validateTimingDependencyGraph(input.components.map((c:any)=>({actionId:c.componentId,dependencies:input.dependencies.filter((d:any)=>d.componentId===c.componentId).map((d:any)=>({kind:"START_AFTER_ACTION_COMPLETED" as const,actionId:d.dependsOnComponentId}))})));
      if(!graph.ok)add(a,"COMPOUND_DEPENDENCY_CYCLE","dependencies","component dependency graph contains a cycle");
    }
  }

  if(input.timing!==undefined&&!validateActionTiming(input.timing).ok)add(a,"INVALID_COMPOUND_TIMING","timing","shared timing is invalid");
  if((input.concurrency==="EFFECTIVE_TOGETHER"||input.concurrency==="START_TOGETHER")&&Array.isArray(input.components)){
    const overrides=input.components.filter((x:any)=>x?.timing?.kind==="OVERRIDE").map((x:any)=>startCoordinationFingerprint(x.timing.timing,input.concurrency));
    if(new Set(overrides).size>1)add(a,input.concurrency==="EFFECTIVE_TOGETHER"?"EFFECTIVE_TOGETHER_TIMING_CONFLICT":"START_TOGETHER_TIMING_CONFLICT","components",input.concurrency+" components cannot declare conflicting start semantics");
  }

  if(!Array.isArray(input.constraints))add(a,"INVALID_COMPOUND_CONSTRAINTS","constraints","constraints must be an array");
  else{
    const constraintIds=new Set<string>();
    input.constraints.forEach((c:any,i:number)=>{
      if(nonEmpty(c?.constraintId)){
        if(constraintIds.has(c.constraintId))add(a,"DUPLICATE_COMPOUND_CONSTRAINT_ID","constraints["+i+"].constraintId","constraint IDs must be unique");
        constraintIds.add(c.constraintId);
      }
      validateConstraint(c,input as unknown as CompoundAction,a,i);
    });
  }

  if(!record(input.rollback)||!["ROLLBACK_ALL_REVERSIBLE_COMPONENTS","ROLLBACK_COMPLETED_COMPONENTS","ROLLBACK_DEPENDENT_COMPONENTS","NO_AUTOMATIC_ROLLBACK"].includes(String(input.rollback?.policy)))add(a,"INVALID_ROLLBACK_POLICY","rollback","rollback policy is required");
  else{
    unknownFields(input.rollback,ROLLBACK_FIELDS,"rollback",a);
    if(!["REVERSE_DEPENDENCY_ORDER","EXPLICIT","UNORDERED"].includes(String(input.rollback.order)))add(a,"INVALID_ROLLBACK_ORDER","rollback.order","rollback order semantics are required");
    if(!["REPORT_AND_CONTINUE","BLOCK_AUTOMATIC_ROLLBACK","REQUIRE_COMPENSATION"].includes(String(input.rollback.irreversibleComponentPolicy)))add(a,"INVALID_IRREVERSIBLE_COMPONENT_POLICY","rollback.irreversibleComponentPolicy","irreversible-component handling must be explicit");
    if(input.rollback.order==="EXPLICIT"){
      const order=input.rollback.explicitComponentOrder;
      if(!Array.isArray(order)||order.length!==ids.size||new Set(order).size!==ids.size||order.some((id:any)=>!ids.has(id)))add(a,"INVALID_EXPLICIT_ROLLBACK_ORDER","rollback.explicitComponentOrder","explicit rollback order must contain every component exactly once");
    }else if(input.rollback.explicitComponentOrder!==undefined)add(a,"UNEXPECTED_EXPLICIT_ROLLBACK_ORDER","rollback.explicitComponentOrder","explicitComponentOrder is only valid with EXPLICIT rollback ordering");
  }

  if(!record(input.measurement))add(a,"INVALID_COMPOUND_MEASUREMENT","measurement","compound measurement horizon is required");
  else{
    unknownFields(input.measurement,MEASUREMENT_FIELDS,"measurement",a);
    const earliest=input.measurement.earliestMeaningfulEvaluationSeconds;
    const primary=input.measurement.primaryEvaluationSeconds;
    const follow=input.measurement.longTermFollowUpSeconds;
    if(!Number.isInteger(earliest)||earliest<0)add(a,"INVALID_COMPOUND_MEASUREMENT","measurement.earliestMeaningfulEvaluationSeconds","must be an integer >= 0");
    if(!Number.isInteger(primary)||primary<=0)add(a,"INVALID_COMPOUND_MEASUREMENT","measurement.primaryEvaluationSeconds","must be an integer > 0");
    if(Number.isInteger(earliest)&&Number.isInteger(primary)&&earliest>primary)add(a,"INVALID_COMPOUND_MEASUREMENT_ORDER","measurement","earliest evaluation cannot be after primary evaluation");
    if(follow!==undefined&&(!Number.isInteger(follow)||follow<primary))add(a,"INVALID_COMPOUND_FOLLOWUP","measurement.longTermFollowUpSeconds","long-term follow-up must be an integer at or after primary evaluation");
    if(!Array.isArray(input.measurement.metricIds)||input.measurement.metricIds.length===0||input.measurement.metricIds.some((x:any)=>!nonEmpty(x))||new Set(input.measurement.metricIds).size!==input.measurement.metricIds.length)add(a,"INVALID_COMPOUND_METRICS","measurement.metricIds","metric IDs must be non-empty and unique");
  }

  if(!record(input.provenance))add(a,"INVALID_COMPOUND_PROVENANCE","provenance","provenance is required");
  else{
    unknownFields(input.provenance,PROVENANCE_FIELDS,"provenance",a);
    if(!PROVENANCE_SOURCES.has(String(input.provenance.source)))add(a,"INVALID_COMPOUND_PROVENANCE_SOURCE","provenance.source","unsupported provenance source");
    if(!nonEmpty(input.provenance.createdAt)||!Number.isFinite(Date.parse(input.provenance.createdAt)))add(a,"INVALID_COMPOUND_PROVENANCE_TIME","provenance.createdAt","createdAt must be a valid timestamp");
    if(input.provenance.sourceId!==undefined&&!nonEmpty(input.provenance.sourceId))add(a,"INVALID_COMPOUND_PROVENANCE_SOURCE_ID","provenance.sourceId","sourceId must be non-empty when supplied");
    if(!Array.isArray(input.provenance.evidenceRefs)||input.provenance.evidenceRefs.some((x:any)=>!nonEmpty(x)))add(a,"INVALID_COMPOUND_EVIDENCE_REFS","provenance.evidenceRefs","evidenceRefs must be an array of non-empty references");
  }

  return a.length?{ok:false,issues:a}:{ok:true,compound:input as unknown as CompoundAction,issues:[]};
}
