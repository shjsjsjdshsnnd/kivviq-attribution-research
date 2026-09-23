import type { Action } from "../action_ontology/types.js";
import type { CompoundAction, CompoundActionReadiness, CompoundComponentReadiness, CompoundRollbackReadiness } from "./types.js";

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
  if(!e.structuralValid)return"INVALID";if(e.eligibility==="INELIGIBLE")return"INELIGIBLE";if(e.eligibility==="UNKNOWN")return"UNKNOWN";
  if(!e.contextAvailable)return"MISSING_CONTEXT";if(!e.populationResolved)return"UNRESOLVED_POPULATION";if(!e.timingResolved)return"UNRESOLVED_TIMING";if(!e.simulatorCapability)return"UNSUPPORTED_SIMULATOR_CAPABILITY";if(e.executionCapability===false)return"UNSUPPORTED_EXECUTION_CAPABILITY";return"READY";
}
export function evaluateCompoundReadiness(c:CompoundAction,evidence:readonly CompoundReadinessEvidence[]):CompoundActionReadiness{
  const by=new Map(evidence.map(x=>[x.componentId,x]));
  const components=c.components.map(x=>{const e=by.get(x.componentId);const state=e?componentState(e):"UNKNOWN";return{componentId:x.componentId,actionId:x.action.actionId,state,reasons:e?[]:["READINESS_EVIDENCE_MISSING"]}});
  const ready=components.filter(x=>x.state==="READY").length;
  const unknown=components.some(x=>x.state==="UNKNOWN");
  let state:CompoundActionReadiness["state"];
  if(ready===components.length)state="READY";
  else if(c.atomicity==="ALL_OR_NOTHING")state=unknown?"UNKNOWN":"BLOCKED";
  else if(ready>0)state="PARTIALLY_READY";
  else state=unknown?"UNKNOWN":"BLOCKED";
  return{compoundActionId:c.compoundActionId,state,components,unresolvedDependencies:[],constraintFailures:[]};
}
function reversible(a:Action):boolean{return a.reversibility.classification!=="effectively_irreversible"}
export function deriveCompoundRollbackReadiness(c:CompoundAction,conflicts:readonly string[]=[]):CompoundRollbackReadiness{
  const reverse=[...c.components].reverse();
  const components=reverse.map(x=>({componentId:x.componentId,actionId:x.action.actionId,state:(conflicts.includes(x.componentId)?"CONFLICT":reversible(x.action)?"ROLLBACKABLE":"IRREVERSIBLE") as "CONFLICT"|"ROLLBACKABLE"|"IRREVERSIBLE",reasons:[]}));
  const irreversible=components.filter(x=>x.state==="IRREVERSIBLE").length;
  const conflictCount=components.filter(x=>x.state==="CONFLICT").length;
  return{compoundActionId:c.compoundActionId,overall:conflictCount?"PARTIAL":irreversible&&irreversible<components.length?"PARTIAL":irreversible===components.length?"BLOCKED":"READY",reversibility:irreversible===0?"FULLY_REVERSIBLE":irreversible===components.length?"IRREVERSIBLE":"PARTIALLY_REVERSIBLE",components,requiredRollbackOrder:c.rollback.order==="REVERSE_DEPENDENCY_ORDER"?reverse.map(x=>x.componentId):c.rollback.explicitComponentOrder??[],compensationRequired:irreversible>0,missingContext:[],conflicts:[...conflicts]};
}
