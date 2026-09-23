import type { Action } from "../action_ontology/types.js";
import type {
  CompoundAction,
  CompoundActionReadiness,
  CompoundComponentReadiness,
  CompoundRollbackReadiness,
  CompoundRollbackComponentReadiness,
  CompoundRollbackComponentEvidence,
} from "./types.js";

export interface CompoundReadinessEvidence {
  readonly componentId:string;
  readonly eligibility:"ELIGIBLE"|"INELIGIBLE"|"UNKNOWN";
  readonly structuralValid:boolean;
  readonly contextAvailable:boolean;
  readonly populationResolved:boolean;
  readonly timingResolved:boolean;
  readonly simulatorCapability:boolean;
  readonly executionCapability?:boolean;
}
function componentState(e:CompoundReadinessEvidence):CompoundComponentReadiness["state"]{
  if(!e.structuralValid)return"INVALID";
  if(e.eligibility==="INELIGIBLE")return"INELIGIBLE";
  if(e.eligibility==="UNKNOWN")return"UNKNOWN";
  if(!e.contextAvailable)return"MISSING_CONTEXT";
  if(!e.populationResolved)return"UNRESOLVED_POPULATION";
  if(!e.timingResolved)return"UNRESOLVED_TIMING";
  if(!e.simulatorCapability)return"UNSUPPORTED_SIMULATOR_CAPABILITY";
  if(e.executionCapability===false)return"UNSUPPORTED_EXECUTION_CAPABILITY";
  return"READY";
}
function componentReasons(state:CompoundComponentReadiness["state"],missingEvidence:boolean):readonly string[]{
  if(missingEvidence)return["READINESS_EVIDENCE_MISSING"];
  switch(state){
    case"INVALID":return["COMPONENT_STRUCTURALLY_INVALID"];
    case"INELIGIBLE":return["COMPONENT_INELIGIBLE"];
    case"UNKNOWN":return["COMPONENT_ELIGIBILITY_UNKNOWN"];
    case"MISSING_CONTEXT":return["COMPONENT_CONTEXT_MISSING"];
    case"UNRESOLVED_POPULATION":return["COMPONENT_POPULATION_UNRESOLVED"];
    case"UNRESOLVED_TIMING":return["COMPONENT_TIMING_UNRESOLVED"];
    case"UNSUPPORTED_SIMULATOR_CAPABILITY":return["SIMULATOR_CAPABILITY_UNSUPPORTED"];
    case"UNSUPPORTED_EXECUTION_CAPABILITY":return["EXECUTION_CAPABILITY_UNSUPPORTED"];
    default:return[];
  }
}
export interface CompoundReadinessOptions { readonly constraintFailures?:readonly string[]; readonly unknownConstraintIds?:readonly string[]; }
export function evaluateCompoundReadiness(c:CompoundAction,evidence:readonly CompoundReadinessEvidence[],options:CompoundReadinessOptions={}):CompoundActionReadiness{
  const by=new Map(evidence.map(x=>[x.componentId,x]));
  const components=c.components.map(x=>{
    const e=by.get(x.componentId);const state=e?componentState(e):"UNKNOWN";
    return{componentId:x.componentId,actionId:x.action.actionId,state,reasons:componentReasons(state,!e)};
  });
  const ready=components.filter(x=>x.state==="READY").length;
  const unknown=components.some(x=>x.state==="UNKNOWN");
  const hardFailure=components.some(x=>["INVALID","INELIGIBLE","MISSING_CONTEXT","UNRESOLVED_POPULATION","UNRESOLVED_TIMING","UNSUPPORTED_SIMULATOR_CAPABILITY","UNSUPPORTED_EXECUTION_CAPABILITY"].includes(x.state));
  const constraintFailures=[...(options.constraintFailures??[])];
  const unknownConstraints=[...(options.unknownConstraintIds??[])];
  let state:CompoundActionReadiness["state"];
  if(constraintFailures.length>0)state="BLOCKED";
  else if(unknownConstraints.length>0)state="UNKNOWN";
  else if(ready===components.length)state="READY";
  else if(c.atomicity==="ALL_OR_NOTHING")state=unknown&&!hardFailure?"UNKNOWN":"BLOCKED";
  else if(c.atomicity==="DEPENDENCY_GATED"){
    const blockedIds=new Set(components.filter(x=>x.state!=="READY").map(x=>x.componentId));
    const dependentBlocked=c.dependencies.some(d=>blockedIds.has(d.dependsOnComponentId)&&components.find(x=>x.componentId===d.componentId)?.state==="READY");
    state=dependentBlocked?"PARTIALLY_READY":ready>0?"PARTIALLY_READY":unknown?"UNKNOWN":"BLOCKED";
  }else state=ready>0?"PARTIALLY_READY":unknown?"UNKNOWN":"BLOCKED";
  const unresolvedDependencies=c.dependencies.filter(d=>{
    const source=components.find(x=>x.componentId===d.dependsOnComponentId);
    const target=components.find(x=>x.componentId===d.componentId);
    return source?.state!=="READY"||target?.state!=="READY";
  }).map(d=>d.dependencyId);
  if(state==="PARTIALLY_READY"&&c.failurePolicy==="ABORT_COMPOUND")state="BLOCKED";
  return{compoundActionId:c.compoundActionId,state,components,unresolvedDependencies,constraintFailures,unknownConstraintIds:unknownConstraints};
}
function reversible(a:Action):boolean{return a.reversibility.classification!=="effectively_irreversible"}
function reverseDependencyOrder(c:CompoundAction):readonly string[]{
  const ids=c.components.map(x=>x.componentId);
  const outgoing=new Map(ids.map(id=>[id,[] as string[]]));
  const indegree=new Map(ids.map(id=>[id,0]));
  for(const d of c.dependencies){
    outgoing.get(d.dependsOnComponentId)?.push(d.componentId);
    indegree.set(d.componentId,(indegree.get(d.componentId)??0)+1);
  }
  const queue=ids.filter(id=>(indegree.get(id)??0)===0).sort();
  const topo:string[]=[];
  while(queue.length){
    const id=queue.shift()!;topo.push(id);
    for(const next of outgoing.get(id)??[]){
      indegree.set(next,(indegree.get(next)??0)-1);
      if((indegree.get(next)??0)===0){queue.push(next);queue.sort()}
    }
  }
  return topo.length===ids.length?topo.reverse():[...ids].reverse();
}
export interface CompoundRollbackReadinessOptions {
  readonly missingContextComponentIds?:readonly string[];
  readonly unknownComponentIds?:readonly string[];
  readonly componentEvidence?:readonly CompoundRollbackComponentEvidence[];
}
export function deriveCompoundRollbackReadiness(c:CompoundAction,conflicts:readonly string[]=[],options:CompoundRollbackReadinessOptions={}):CompoundRollbackReadiness{
  const order=c.rollback.order==="REVERSE_DEPENDENCY_ORDER"
    ? reverseDependencyOrder(c)
    : c.rollback.order==="EXPLICIT"
      ? c.rollback.explicitComponentOrder??[]
      : [];
  const orderedComponents=order.length?order.map(id=>c.components.find(x=>x.componentId===id)!).filter(Boolean):[...c.components];
  const missing=new Set(options.missingContextComponentIds??[]);
  const unknown=new Set(options.unknownComponentIds??[]);
  const conflictSet=new Set(conflicts);
  const evidence=new Map((options.componentEvidence??[]).map(x=>[x.componentId,x]));
  const components=orderedComponents.map(x=>{
    const supplied=evidence.get(x.componentId);
    const state:CompoundRollbackComponentReadiness["state"]=conflictSet.has(x.componentId)?"CONFLICT":missing.has(x.componentId)?"MISSING_CONTEXT":unknown.has(x.componentId)?"UNKNOWN":supplied?.state??(reversible(x.action)?"ROLLBACKABLE":"IRREVERSIBLE");
    const reasons=supplied?.state===state&&supplied.reasons?.length
      ? supplied.reasons
      : state==="CONFLICT"?["DOMAIN_ROLLBACK_CONFLICT"]
        :state==="MISSING_CONTEXT"?["ROLLBACK_CONTEXT_MISSING"]
          :state==="UNKNOWN"?["ROLLBACK_READINESS_UNKNOWN"]
            :state==="IRREVERSIBLE"?["ATOMIC_ACTION_IRREVERSIBLE"]:[];
    return{componentId:x.componentId,actionId:x.action.actionId,state,reasons};
  });
  const rollbackableComponentIds=components.filter(x=>x.state==="ROLLBACKABLE").map(x=>x.componentId);
  const irreversibleComponentIds=components.filter(x=>x.state==="IRREVERSIBLE").map(x=>x.componentId);
  const unknownComponentIds=components.filter(x=>x.state==="UNKNOWN").map(x=>x.componentId);
  const conflictsFound=components.filter(x=>x.state==="CONFLICT").map(x=>x.componentId);
  const missingContext=components.filter(x=>x.state==="MISSING_CONTEXT").map(x=>x.componentId);
  const irreversible=irreversibleComponentIds.length;
  const conflictCount=conflictsFound.length;
  const unresolvedCount=missingContext.length+unknownComponentIds.length;
  const compensationRequirements=components.filter(x=>x.state==="IRREVERSIBLE").map(x=>({
    componentId:x.componentId,
    actionId:x.actionId,
    required:c.rollback.irreversibleComponentPolicy==="REQUIRE_COMPENSATION",
    reason:"Atomic component cannot be causally reversed; any compensating Action is separate from rollback.",
  }));
  const blockedByIrreversible=c.rollback.irreversibleComponentPolicy==="BLOCK_AUTOMATIC_ROLLBACK"&&irreversible>0;
  const automaticRollbackAllowed=c.rollback.policy!=="NO_AUTOMATIC_ROLLBACK"&&!blockedByIrreversible&&conflictCount===0&&unresolvedCount===0;
  return{
    compoundActionId:c.compoundActionId,
    policy:c.rollback.policy,
    overall:blockedByIrreversible?"BLOCKED":conflictCount?"PARTIAL":unresolvedCount===components.length?"UNKNOWN":unresolvedCount?"PARTIAL":irreversible&&irreversible<components.length?"PARTIAL":irreversible===components.length?"BLOCKED":"READY",
    automaticRollbackAllowed,
    reversibility:irreversible===0?"FULLY_REVERSIBLE":irreversible===components.length?"IRREVERSIBLE":"PARTIALLY_REVERSIBLE",
    components,
    rollbackableComponentIds,
    irreversibleComponentIds,
    unknownComponentIds,
    requiredRollbackOrder:order,
    compensationRequired:compensationRequirements.some(x=>x.required),
    compensationRequirements,
    missingContext,
    conflicts:conflictsFound,
  };
}
