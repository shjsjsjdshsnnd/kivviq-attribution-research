import { translateAtomicBusinessActionWithOrigin } from "../action_translation/translate.js";
import type { TranslationContext,TranslationResult } from "../action_translation/types.js";
import type { SimulatorIntervention } from "../simulator_intervention/types.js";
import type {
  ComponentDependency,
  ComponentTimingBinding,
  CompoundAction,
  CompoundComponentRole,
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
  readonly status:"TRANSLATED"|"PARTIALLY_TRANSLATED"|"NOT_TRANSLATABLE"|"INVALID_COMPOUND";
  readonly components:readonly CompoundComponentTranslation[];
  readonly interventions:readonly SimulatorIntervention[];
  readonly omittedComponentIds:readonly string[];
}
function translated(result:CompoundComponentTranslationResult|undefined):boolean{
  return result?.status==="TRANSLATED";
}
export function translateCompoundAction(c:CompoundAction,context:TranslationContext):CompoundTranslationResult{
  const validation=validateCompoundAction(c);
  if(!validation.ok)return{
    compoundActionId:c.compoundActionId,
    status:"INVALID_COMPOUND",
    components:[],
    interventions:[],
    omittedComponentIds:c.components.map(x=>x.componentId),
  };

  const flat=flattenCompoundAction(c);
  const resultByComponent=new Map<string,CompoundComponentTranslationResult>();
  const components:CompoundComponentTranslation[]=[];

  for(const component of flat){
    const blockingComponentIds=component.dependencies
      .map(dependency=>dependency.dependsOnComponentId)
      .filter(dependencyId=>!translated(resultByComponent.get(dependencyId)));

    const gateDependencies=
      c.atomicity==="DEPENDENCY_GATED" ||
      c.failurePolicy==="PAUSE_DEPENDENTS";

    const result:CompoundComponentTranslationResult=
      gateDependencies&&blockingComponentIds.length>0
        ? {
            status:"BLOCKED_BY_DEPENDENCY",
            code:"COMPOUND_DEPENDENCY_NOT_TRANSLATABLE",
            message:"Component translation is blocked because a required predecessor was not translatable.",
            blockingComponentIds:[...new Set(blockingComponentIds)].sort(),
          }
        : translateAtomicBusinessActionWithOrigin(
            component.action,
            context,
            {
              originatingBusinessActionId:c.compoundActionId,
              sourceActionId:component.action.actionId,
              componentIndex:component.componentIndex,
              componentCount:c.components.length,
            },
          );

    resultByComponent.set(component.componentId,result);
    components.push({
      componentId:component.componentId,
      componentIndex:component.componentIndex,
      actionId:component.action.actionId,
      ...(component.role?{role:component.role}:{}),
      dependencies:component.dependencies,
      population:component.population,
      timing:component.timing,
      result,
      interventions:result.status==="TRANSLATED"?result.interventions:[],
    });
  }

  const failed=components.filter(x=>x.result.status!=="TRANSLATED");
  const interventions=components.flatMap(x=>x.interventions);
  if(!failed.length)return{
    compoundActionId:c.compoundActionId,
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
    status:"NOT_TRANSLATABLE",
    components,
    interventions:[],
    omittedComponentIds:failed.map(x=>x.componentId),
  };

  if(interventions.length)return{
    compoundActionId:c.compoundActionId,
    status:"PARTIALLY_TRANSLATED",
    components,
    interventions,
    omittedComponentIds:failed.map(x=>x.componentId),
  };

  return{
    compoundActionId:c.compoundActionId,
    status:"NOT_TRANSLATABLE",
    components,
    interventions:[],
    omittedComponentIds:failed.map(x=>x.componentId),
  };
}
