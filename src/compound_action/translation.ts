import { translateBusinessAction } from "../action_translation/translate.js";
import type { TranslationContext, TranslationResult } from "../action_translation/types.js";
import type { SimulatorIntervention } from "../simulator_intervention/types.js";
import type { CompoundAction } from "./types.js";
import { flattenCompoundAction } from "./semantics.js";
import { validateCompoundAction } from "./validation.js";

export interface CompoundComponentTranslation {
  readonly componentId:string;
  readonly actionId:string;
  readonly result:TranslationResult;
  readonly interventions:readonly SimulatorIntervention[];
}
export interface CompoundTranslationResult {
  readonly compoundActionId:string;
  readonly status:"TRANSLATED"|"PARTIALLY_TRANSLATED"|"NOT_TRANSLATABLE"|"INVALID_COMPOUND";
  readonly components:readonly CompoundComponentTranslation[];
  readonly interventions:readonly SimulatorIntervention[];
  readonly omittedComponentIds:readonly string[];
}
export function translateCompoundAction(c:CompoundAction,context:TranslationContext):CompoundTranslationResult{
  const validation=validateCompoundAction(c);
  if(!validation.ok)return{compoundActionId:c.compoundActionId,status:"INVALID_COMPOUND",components:[],interventions:[],omittedComponentIds:c.components.map(x=>x.componentId)};
  const components=flattenCompoundAction(c).map(component=>{
    const result=translateBusinessAction(component.action,context);
    return{componentId:component.componentId,actionId:component.action.actionId,result,interventions:result.status==="TRANSLATED"?result.interventions:[]};
  });
  const failed=components.filter(x=>x.result.status!=="TRANSLATED");
  const interventions=components.flatMap(x=>x.interventions);
  if(!failed.length)return{compoundActionId:c.compoundActionId,status:"TRANSLATED",components,interventions,omittedComponentIds:[]};
  if(c.atomicity==="ALL_OR_NOTHING")return{compoundActionId:c.compoundActionId,status:"NOT_TRANSLATABLE",components,interventions:[],omittedComponentIds:failed.map(x=>x.componentId)};
  if(interventions.length)return{compoundActionId:c.compoundActionId,status:"PARTIALLY_TRANSLATED",components,interventions,omittedComponentIds:failed.map(x=>x.componentId)};
  return{compoundActionId:c.compoundActionId,status:"NOT_TRANSLATABLE",components,interventions:[],omittedComponentIds:failed.map(x=>x.componentId)};
}
