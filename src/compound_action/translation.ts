import { translateAtomicBusinessActionWithOrigin } from "../action_translation/translate.js";
import type { TranslationContext,TranslationResult } from "../action_translation/types.js";
import type { SimulatorIntervention } from "../simulator_intervention/types.js";
import type {
  ComponentDependency,
  ComponentTimingBinding,
  CompoundAction,
  CompoundComponentRole,
  CompoundProvenance,
  FlattenedCompoundComponent,
  PopulationBinding,
} from "./types.js";
import { flattenCompoundAction } from "./semantics.js";
import { validateCompoundAction } from "./validation.js";

export interface CompoundDependencyBlockedTranslation {
  readonly status:"BLOCKED_BY_DEPENDENCY";
  readonly code:"COMPOUND_DEPENDENCY_NOT_TRANSLATABLE";
  readonly message:string;
  readonly blockingComponentIds:readonly string[];
}
export type CompoundComponentTranslationResult=
  | TranslationResult
  | CompoundDependencyBlockedTranslation;

export interface CompoundComponentTranslation {
  readonly componentId:string;
  readonly componentIndex:number;
  readonly actionId:string;
  readonly role?:CompoundComponentRole;
  readonly dependencies:readonly ComponentDependency[];
  readonly population:PopulationBinding;
  readonly timing:ComponentTimingBinding;
  readonly result:CompoundComponentTranslationResult;
  readonly interventions:readonly SimulatorIntervention[];
}
export interface CompoundTranslationResult {
  readonly compoundActionId:string;
  readonly compoundProvenance:CompoundProvenance;
  readonly status:"TRANSLATED"|"PARTIALLY_TRANSLATED"|"NOT_TRANSLATABLE"|"INVALID_COMPOUND";
  readonly components:readonly CompoundComponentTranslation[];
  readonly interventions:readonly SimulatorIntervention[];
  readonly omittedComponentIds:readonly string[];
}
function translated(result:CompoundComponentTranslationResult|undefined):boolean{
  return result?.status==="TRANSLATED";
}
function topologicalComponents(c:CompoundAction,flat:readonly FlattenedCompoundComponent[]):readonly FlattenedCompoundComponent[]{
  const byId=new Map(flat.map(x=>[x.componentId,x]));
  const index=new Map(flat.map((x,i)=>[x.componentId,i]));
  const outgoing=new Map(flat.map(x=>[x.componentId,[] as string[]]));
  const indegree=new Map(flat.map(x=>[x.componentId,0]));
  for(const dependency of c.dependencies){
    outgoing.get(dependency.dependsOnComponentId)?.push(dependency.componentId);
    indegree.set(dependency.componentId,(indegree.get(dependency.componentId)??0)+1);
  }
  const queue=flat.filter(x=>(indegree.get(x.componentId)??0)===0).map(x=>x.componentId);
  queue.sort((a,b)=>(index.get(a)??0)-(index.get(b)??0));
  const result:FlattenedCompoundComponent[]=[];
  while(queue.length){
    const id=queue.shift()!;
    const component=byId.get(id);
    if(component)result.push(component);
    for(const next of outgoing.get(id)??[]){
      indegree.set(next,(indegree.get(next)??0)-1);
      if((indegree.get(next)??0)===0){
        queue.push(next);
        queue.sort((a,b)=>(index.get(a)??0)-(index.get(b)??0));
      }
    }
  }
  return result.length===flat.length?result:flat;
}
export function translateCompoundAction(c:CompoundAction,context:TranslationContext):CompoundTranslationResult{
  const validation=validateCompoundAction(c);
  if(!validation.ok)return{
    compoundActionId:c.compoundActionId,
    compoundProvenance:c.provenance,
    status:"INVALID_COMPOUND",
    components:[],
    interventions:[],
    omittedComponentIds:c.components.map(x=>x.componentId),
  };

  const flat=flattenCompoundAction(c);
  const rawByComponent=new Map<string,CompoundComponentTranslationResult>();
  for(const component of flat){
    rawByComponent.set(
      component.componentId,
      translateAtomicBusinessActionWithOrigin(
        component.action,
        context,
        {
          originatingBusinessActionId:c.compoundActionId,
          sourceActionId:component.action.actionId,
          componentIndex:component.componentIndex,
          componentCount:c.components.length,
        },
      ),
    );
  }

  const gateDependencies=c.atomicity==="DEPENDENCY_GATED"||c.failurePolicy==="PAUSE_DEPENDENTS";
  const finalByComponent=new Map<string,CompoundComponentTranslationResult>();
  for(const component of topologicalComponents(c,flat)){
    const blockingComponentIds=component.dependencies
      .map(dependency=>dependency.dependsOnComponentId)
      .filter(dependencyId=>!translated(finalByComponent.get(dependencyId)));
    const result:CompoundComponentTranslationResult=
      gateDependencies&&blockingComponentIds.length>0
        ? {
            status:"BLOCKED_BY_DEPENDENCY",
            code:"COMPOUND_DEPENDENCY_NOT_TRANSLATABLE",
            message:"Component translation is blocked because a required predecessor was not translatable.",
            blockingComponentIds:[...new Set(blockingComponentIds)].sort(),
          }
        : rawByComponent.get(component.componentId)!;
    finalByComponent.set(component.componentId,result);
  }

  const components:CompoundComponentTranslation[]=flat.map(component=>{
    const result=finalByComponent.get(component.componentId)!;
    return{
      componentId:component.componentId,
      componentIndex:component.componentIndex,
      actionId:component.action.actionId,
      ...(component.role?{role:component.role}:{}),
      dependencies:component.dependencies,
      population:component.population,
      timing:component.timing,
      result,
      interventions:result.status==="TRANSLATED"?result.interventions:[],
    };
  });

  const failed=components.filter(x=>x.result.status!=="TRANSLATED");
  const interventions=components.flatMap(x=>x.interventions);
  if(!failed.length)return{
    compoundActionId:c.compoundActionId,
    compoundProvenance:c.provenance,
    status:"TRANSLATED",
    components,
    interventions,
    omittedComponentIds:[],
  };

  const mustRemainWhole=
    c.atomicity==="ALL_OR_NOTHING" ||
    c.failurePolicy==="ABORT_COMPOUND" ||
    c.failurePolicy==="ROLLBACK_COMPLETED_COMPONENTS";

  if(mustRemainWhole)return{
    compoundActionId:c.compoundActionId,
    compoundProvenance:c.provenance,
    status:"NOT_TRANSLATABLE",
    components,
    interventions:[],
    omittedComponentIds:failed.map(x=>x.componentId),
  };

  if(interventions.length)return{
    compoundActionId:c.compoundActionId,
    compoundProvenance:c.provenance,
    status:"PARTIALLY_TRANSLATED",
    components,
    interventions,
    omittedComponentIds:failed.map(x=>x.componentId),
  };

  return{
    compoundActionId:c.compoundActionId,
    compoundProvenance:c.provenance,
    status:"NOT_TRANSLATABLE",
    components,
    interventions:[],
    omittedComponentIds:failed.map(x=>x.componentId),
  };
}
