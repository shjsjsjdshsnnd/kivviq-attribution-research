import { validateAction } from "../action_ontology/validation.js";
import { validateActionTiming, validateTimingDependencyGraph } from "../action_timing/validation.js";
import { COMPOUND_ACTION_SCHEMA_VERSION, type CompoundAction, type CompoundConstraint } from "./types.js";

export interface CompoundValidationIssue {readonly code:string;readonly path:string;readonly message:string}
export type CompoundValidationResult={readonly ok:true;readonly compound:CompoundAction;readonly issues:readonly []}|{readonly ok:false;readonly issues:readonly CompoundValidationIssue[]};

const FORBIDDEN=new Set(["expectedRevenue","expectedProfit","expectedROAS","expectedLift","expectedSynergy","predictedInteractionEffect","predictedConversions","futureDemand","counterfactualRevenue","recommendationScore","confidenceScore","bestAction","evaluationResult","executionStatus","trafficAllocation","randomization","significanceThreshold","statisticalPower","experimentResult"]);
function record(v:unknown):v is any{return typeof v==="object"&&v!==null&&!Array.isArray(v)}
function add(a:CompoundValidationIssue[],code:string,path:string,message:string):void{a.push({code,path,message})}
function leakage(v:unknown,path:string,a:CompoundValidationIssue[]):void{
  if(Array.isArray(v)){v.forEach((x,i)=>leakage(x,path+"["+i+"]",a));return}
  if(!record(v))return;
  for(const [k,x] of Object.entries(v)){const p=path==="$"?k:path+"."+k;if(FORBIDDEN.has(k))add(a,"FORBIDDEN_COMPOUND_INFORMATION",p,"prediction, evaluation, experiment and runtime state do not belong in CompoundAction");leakage(x,p,a)}
}
function budgetDelta(action:any):{signed:number;currency:string;per:string}|undefined{
  if(action.actionType!=="advertising.adjust_budget"||action.parameters?.kind!=="budget_adjustment"||action.parameters.operation?.kind!=="DELTA"||action.parameters.operation.amount?.kind!=="money_rate")return undefined;
  const m=action.parameters.operation.amount;
  return{signed:(action.parameters.operation.direction==="decrease"?-1:1)*m.amountMinor,currency:m.currency,per:m.per};
}
function validateConstraint(c:CompoundConstraint,compound:CompoundAction,a:CompoundValidationIssue[],i:number):void{
  const p="constraints["+i+"]";
  if(!c.constraintId)add(a,"INVALID_COMPOUND_CONSTRAINT_ID",p+".constraintId","stable constraint identity is required");
  if(c.kind==="SUM_MONETARY_DELTAS_EQUALS"){
    const legs=compound.components.map(x=>budgetDelta(x.action)).filter((x):x is NonNullable<typeof x>=>!!x);
    if(!legs.length){add(a,"CONSERVATION_HAS_NO_MONETARY_LEGS",p,"conservation requires budget DELTA components");return}
    if(legs.some(x=>x.currency!==c.currency||x.per!==c.ratePeriod)){add(a,"CONSERVATION_UNIT_MISMATCH",p,"currency and rate period must match");return}
    if(legs.reduce((n,x)=>n+x.signed,0)!==c.amountMinor)add(a,"COMPOUND_CONSERVATION_VIOLATION",p,"signed monetary deltas violate conservation");
  }
  if(c.kind==="TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE"){
    const legs=compound.components.map(x=>budgetDelta(x.action)).filter((x):x is NonNullable<typeof x>=>!!x&&x.signed>0);
    if(legs.some(x=>x.currency!==c.currency||x.per!==c.ratePeriod)){add(a,"MEDIA_BUDGET_CONSTRAINT_UNIT_MISMATCH",p,"known incremental media legs must match constraint units");return}
    const total=legs.reduce((n,x)=>n+x.signed,0);
    if(total>c.amountMinor)add(a,"COMPOUND_MEDIA_BUDGET_LIMIT_EXCEEDED",p,"known incremental media budget exceeds the compound hard limit");
  }
}
export function validateCompoundAction(input:unknown):CompoundValidationResult{
  const a:CompoundValidationIssue[]=[];
  if(!record(input))return{ok:false,issues:[{code:"INVALID_COMPOUND_ACTION",path:"$",message:"CompoundAction must be an object"}]};
  leakage(input,"$",a);
  if(input.kind!=="compound_action")add(a,"INVALID_COMPOUND_KIND","kind","must be compound_action");
  if(input.schemaVersion!==COMPOUND_ACTION_SCHEMA_VERSION)add(a,"UNSUPPORTED_COMPOUND_SCHEMA","schemaVersion","unsupported CompoundAction schema");
  if(typeof input.compoundActionId!=="string"||!/^compound_[A-Za-z0-9._:-]+$/.test(input.compoundActionId))add(a,"INVALID_COMPOUND_ID","compoundActionId","must begin with compound_");
  if(typeof input.description!=="string"||!input.description.trim())add(a,"MISSING_COMPOUND_DESCRIPTION","description","description is required");
  if(typeof input.intent!=="string"||!input.intent.trim())add(a,"MISSING_COMPOUND_INTENT","intent","business intent is required");

  const ids=new Set<string>();
  if(!Array.isArray(input.components)||input.components.length<2)add(a,"INVALID_COMPOUND_COMPONENTS","components","at least two atomic components are required");
  else input.components.forEach((c:any,i:number)=>{
    const p="components["+i+"]";
    if(!record(c)||typeof c.componentId!=="string"||!c.componentId){add(a,"INVALID_COMPONENT_ID",p+".componentId","component identity is required");return}
    if(ids.has(c.componentId))add(a,"DUPLICATE_COMPONENT_ID",p+".componentId","component IDs must be unique");ids.add(c.componentId);
    const v=validateAction(c.action);if(!v.ok)add(a,"INVALID_ATOMIC_COMPONENT",p+".action","component must be a valid canonical atomic Action");
    else if(v.action.parameters.kind==="no_op"&&c.role!=="CONTROL")add(a,"NO_OP_COMPONENT_REQUIRES_CONTROL_ROLE",p+".role","NO_OP requires explicit CONTROL role");
    if(!record(c.population)||!["INHERIT","OVERRIDE","NOT_APPLICABLE"].includes(c.population.kind))add(a,"INVALID_POPULATION_BINDING",p+".population","explicit population binding is required");
    if(c.population?.kind==="INHERIT"&&!input.defaultPopulation)add(a,"MISSING_DEFAULT_POPULATION",p+".population","INHERIT requires defaultPopulation");
    if(!record(c.timing)||!["INHERIT","OVERRIDE","DEPENDENT"].includes(c.timing.kind))add(a,"INVALID_TIMING_BINDING",p+".timing","explicit timing binding is required");
    if(c.timing?.kind==="INHERIT"&&!input.timing)add(a,"MISSING_COMPOUND_TIMING",p+".timing","INHERIT requires compound timing");
    if(c.timing?.kind==="OVERRIDE"&&!validateActionTiming(c.timing.timing).ok)add(a,"INVALID_COMPONENT_TIMING",p+".timing","timing override is invalid");
  });

  if(!record(input.ordering)||!["UNORDERED","ORDERED"].includes(input.ordering.kind))add(a,"INVALID_COMPOUND_ORDERING","ordering","ordering semantics are required");
  else if(input.ordering.kind==="ORDERED"&&(!Array.isArray(input.ordering.componentIds)||input.ordering.componentIds.length!==ids.size||new Set(input.ordering.componentIds).size!==ids.size||input.ordering.componentIds.some((id:any)=>!ids.has(id))))add(a,"INVALID_COMPONENT_ORDER","ordering.componentIds","ordered compounds must contain every component exactly once");
  if(!["START_TOGETHER","EFFECTIVE_TOGETHER","INDEPENDENT_TIMING"].includes(input.concurrency))add(a,"INVALID_COMPOUND_CONCURRENCY","concurrency","concurrency semantics are required");
  if(!["ALL_OR_NOTHING","BEST_EFFORT","DEPENDENCY_GATED"].includes(input.atomicity))add(a,"INVALID_COMPOUND_ATOMICITY","atomicity","atomicity intent is required");
  if(!["ABORT_COMPOUND","CONTINUE_INDEPENDENT_COMPONENTS","ROLLBACK_COMPLETED_COMPONENTS","PAUSE_DEPENDENTS"].includes(input.failurePolicy))add(a,"INVALID_FAILURE_POLICY","failurePolicy","failure semantics are required");

  if(!Array.isArray(input.dependencies))add(a,"INVALID_COMPOUND_DEPENDENCIES","dependencies","dependencies must be an array");
  else{
    for(const [i,d] of input.dependencies.entries()){
      const p="dependencies["+i+"]";
      if(!record(d)||!["START_AFTER","EFFECTIVE_AFTER","COMPLETE_AFTER","REQUIRES","END_WITH"].includes(d.type))add(a,"INVALID_COMPONENT_DEPENDENCY",p,"invalid dependency");
      else{if(!ids.has(d.componentId)||!ids.has(d.dependsOnComponentId))add(a,"MISSING_DEPENDENCY_COMPONENT",p,"dependency must reference existing components");if(d.componentId===d.dependsOnComponentId)add(a,"SELF_COMPONENT_DEPENDENCY",p,"self-dependency is impossible")}
    }
    if(Array.isArray(input.components)){
      const graph=validateTimingDependencyGraph(input.components.map((c:any)=>({actionId:c.componentId,dependencies:input.dependencies.filter((d:any)=>d.componentId===c.componentId).map((d:any)=>({kind:"START_AFTER_ACTION_COMPLETED" as const,actionId:d.dependsOnComponentId}))})));
      if(!graph.ok)add(a,"COMPOUND_DEPENDENCY_CYCLE","dependencies","component dependency graph contains a cycle");
    }
  }
  if(input.timing!==undefined&&!validateActionTiming(input.timing).ok)add(a,"INVALID_COMPOUND_TIMING","timing","shared timing is invalid");
  if(!Array.isArray(input.constraints))add(a,"INVALID_COMPOUND_CONSTRAINTS","constraints","constraints must be an array");else input.constraints.forEach((c:any,i:number)=>validateConstraint(c,input as CompoundAction,a,i));
  if(!record(input.rollback)||!["ROLLBACK_ALL_REVERSIBLE_COMPONENTS","ROLLBACK_COMPLETED_COMPONENTS","ROLLBACK_DEPENDENT_COMPONENTS","NO_AUTOMATIC_ROLLBACK"].includes(input.rollback.policy))add(a,"INVALID_ROLLBACK_POLICY","rollback","rollback policy is required");
  if(!record(input.measurement)||!Number.isInteger(input.measurement.primaryEvaluationSeconds)||input.measurement.primaryEvaluationSeconds<=0)add(a,"INVALID_COMPOUND_MEASUREMENT","measurement","compound measurement horizon is required");
  if(!record(input.provenance)||typeof input.provenance.createdAt!=="string")add(a,"INVALID_COMPOUND_PROVENANCE","provenance","provenance is required");
  return a.length?{ok:false,issues:a}:{ok:true,compound:input as CompoundAction,issues:[]};
}
