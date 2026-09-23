import { canonicalizeForSerialization,actionSemanticProjection } from "../action_ontology/semantics.js";
import type { CompoundAction, FlattenedCompoundComponent } from "./types.js";

function stable(v:unknown):string{return JSON.stringify(canonicalizeForSerialization(v))}
function sorted<T>(v:readonly T[]):readonly T[]{return[...v].sort((a,b)=>stable(a).localeCompare(stable(b)))}
export function compoundSemanticProjection(c:CompoundAction):unknown{
  const components=c.ordering.kind==="ORDERED"?c.components:sorted(c.components);
  return{
    schemaVersion:c.schemaVersion,
    components:components.map(x=>({componentId:x.componentId,atomicActionId:x.action.actionId,action:actionSemanticProjection(x.action),role:x.role??null,population:x.population,timing:x.timing})),
    ordering:c.ordering,
    concurrency:c.concurrency,
    dependencies:sorted(c.dependencies),
    atomicity:c.atomicity,
    failurePolicy:c.failurePolicy,
    completionRule:c.completionRule,
    defaultPopulation:c.defaultPopulation??null,
    defaultPopulationBindingTime:c.defaultPopulationBindingTime??null,
    timing:c.timing??null,
    constraints:sorted(c.constraints),
    rollback:c.rollback,
    measurement:c.measurement,
  };
}
export function compoundSemanticKey(c:CompoundAction):string{return stable(compoundSemanticProjection(c))}
export function compoundsSemanticallyEqual(a:CompoundAction,b:CompoundAction):boolean{return compoundSemanticKey(a)===compoundSemanticKey(b)}
export function compoundFingerprint(c:CompoundAction):string{
  const input=compoundSemanticKey(c);let hash=0xcbf29ce484222325n;const prime=0x100000001b3n,mask=0xffffffffffffffffn;
  for(let i=0;i<input.length;i++){hash^=BigInt(input.charCodeAt(i));hash=(hash*prime)&mask}
  return"fnv1a64:"+hash.toString(16).padStart(16,"0");
}
export function flattenCompoundAction(c:CompoundAction):readonly FlattenedCompoundComponent[]{
  const ordered=c.ordering.kind==="ORDERED"?c.ordering.componentIds.map(id=>c.components.find(x=>x.componentId===id)!):[...c.components].sort((a,b)=>a.componentId.localeCompare(b.componentId));
  return ordered.map((x,i)=>({compoundActionId:c.compoundActionId,componentId:x.componentId,componentIndex:i,...(x.role?{role:x.role}:{}),action:x.action,dependencies:c.dependencies.filter(d=>d.componentId===x.componentId),population:x.population,timing:x.timing}));
}
