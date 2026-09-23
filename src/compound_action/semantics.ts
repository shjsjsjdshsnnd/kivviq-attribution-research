import { canonicalizeForSerialization,actionSemanticProjection } from "../action_ontology/semantics.js";
import type { CompoundAction, CompoundActionComponent, FlattenedCompoundComponent } from "./types.js";

function stable(v:unknown):string{return JSON.stringify(canonicalizeForSerialization(v))}
function sorted<T>(v:readonly T[]):readonly T[]{return[...v].sort((a,b)=>stable(a).localeCompare(stable(b)))}

function componentBase(component:CompoundActionComponent):unknown{
  return{
    action:actionSemanticProjection(component.action),
    role:component.role??null,
    population:component.population,
    timing:component.timing.kind==="DEPENDENT"?{kind:"DEPENDENT"}:component.timing,
  };
}

function canonicalComponentOrder(c:CompoundAction):readonly CompoundActionComponent[]{
  if(c.ordering.kind==="ORDERED"){
    return c.ordering.componentIds.map(id=>c.components.find(x=>x.componentId===id)!).filter(Boolean);
  }
  const byId=new Map(c.components.map(component=>[component.componentId,component]));
  let colors=new Map(c.components.map(component=>[component.componentId,stable(componentBase(component))]));
  for(let round=0;round<c.components.length;round++){
    const next=new Map<string,string>();
    for(const component of c.components){
      const incoming=c.dependencies
        .filter(d=>d.componentId===component.componentId)
        .map(d=>({type:d.type,neighbor:colors.get(d.dependsOnComponentId)??""}));
      const outgoing=c.dependencies
        .filter(d=>d.dependsOnComponentId===component.componentId)
        .map(d=>({type:d.type,neighbor:colors.get(d.componentId)??""}));
      next.set(component.componentId,stable({base:componentBase(component),incoming:sorted(incoming),outgoing:sorted(outgoing)}));
    }
    const unchanged=c.components.every(component=>next.get(component.componentId)===colors.get(component.componentId));
    colors=next;
    if(unchanged)break;
  }
  return [...byId.values()].sort((a,b)=>{
    const color=(colors.get(a.componentId)??"").localeCompare(colors.get(b.componentId)??"");
    if(color!==0)return color;
    const base=stable(componentBase(a)).localeCompare(stable(componentBase(b)));
    if(base!==0)return base;
    return a.componentId.localeCompare(b.componentId);
  });
}

function normalizedConstraint(constraint:any):unknown{
  const {constraintId:_,...semantic}=constraint;
  return semantic;
}

export function compoundSemanticProjection(c:CompoundAction):unknown{
  const orderedComponents=canonicalComponentOrder(c);
  const componentRef=new Map(orderedComponents.map((component,index)=>[component.componentId,"c"+index]));
  const normalizedDependencies=c.dependencies.map(dependency=>({
    type:dependency.type,
    componentRef:componentRef.get(dependency.componentId),
    dependsOnRef:componentRef.get(dependency.dependsOnComponentId),
  }));
  const dependencyOrder=[...normalizedDependencies].sort((a,b)=>stable(a).localeCompare(stable(b)));
  const dependencyRefBySemantic=new Map(dependencyOrder.map((dependency,index)=>[stable(dependency),"d"+index]));
  const dependencyIdToRef=new Map(c.dependencies.map(dependency=>[
    dependency.dependencyId,
    dependencyRefBySemantic.get(stable({
      type:dependency.type,
      componentRef:componentRef.get(dependency.componentId),
      dependsOnRef:componentRef.get(dependency.dependsOnComponentId),
    }))!,
  ]));
  const components=orderedComponents.map(component=>({
    componentRef:componentRef.get(component.componentId),
    action:actionSemanticProjection(component.action),
    role:component.role??null,
    population:component.population,
    timing:component.timing.kind==="DEPENDENT"
      ? {kind:"DEPENDENT",dependencyRefs:[...component.timing.dependencyIds].map(id=>dependencyIdToRef.get(id)??"UNRESOLVED").sort()}
      : component.timing,
  }));
  const rollback={
    policy:c.rollback.policy,
    order:c.rollback.order,
    ...(c.rollback.order==="EXPLICIT"&&c.rollback.explicitComponentOrder
      ? {explicitComponentOrder:c.rollback.explicitComponentOrder.map(id=>componentRef.get(id)??"UNRESOLVED")}
      : {}),
    irreversibleComponentPolicy:c.rollback.irreversibleComponentPolicy,
  };
  return{
    schemaVersion:c.schemaVersion,
    components,
    ordering:c.ordering.kind==="ORDERED"?{kind:"ORDERED",componentRefs:c.ordering.componentIds.map(id=>componentRef.get(id))}:{kind:"UNORDERED"},
    concurrency:c.concurrency,
    dependencies:dependencyOrder,
    atomicity:c.atomicity,
    failurePolicy:c.failurePolicy,
    completionRule:c.completionRule,
    populationBindingLevel:c.populationBindingLevel,
    defaultPopulation:c.defaultPopulation??null,
    defaultPopulationBindingTime:c.defaultPopulationBindingTime??null,
    timing:c.timing??null,
    constraints:sorted(c.constraints.map(normalizedConstraint)),
    rollback,
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
  return ordered.map((x,i)=>({
    compoundActionId:c.compoundActionId,
    compoundProvenance:c.provenance,
    componentId:x.componentId,
    componentIndex:i,
    ...(x.role?{role:x.role}:{}),
    action:x.action,
    dependencies:c.dependencies.filter(d=>d.componentId===x.componentId),
    population:x.population,
    timing:x.timing,
  }));
}
