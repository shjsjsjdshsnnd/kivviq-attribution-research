import { resolveActionTiming } from "../action_timing/resolution.js";
import type { ActionTimingResolutionContext,TimingResolution } from "../action_timing/types.js";
import type { CompoundAction,CompoundPopulationResolution,CompoundPopulationResolutionContext,CompoundTimingResolution } from "./types.js";
import { flattenCompoundAction } from "./semantics.js";

export function resolveCompoundPopulations(c:CompoundAction,context?:CompoundPopulationResolutionContext):CompoundPopulationResolution{
  return{
    compoundActionId:c.compoundActionId,
    components:c.components.map(component=>{
      const binding=component.population;
      if(binding.kind==="NOT_APPLICABLE")return{componentId:component.componentId,status:"NOT_APPLICABLE" as const,source:"NOT_APPLICABLE" as const,reason:binding.reason};
      const populationRef=binding.kind==="OVERRIDE"?binding.populationRef:c.defaultPopulation;
      const bindingTime=binding.kind==="OVERRIDE"?binding.bindingTime:c.defaultPopulationBindingTime;
      const source=binding.kind==="OVERRIDE"?"COMPONENT_OVERRIDE" as const:"COMPOUND_DEFAULT" as const;
      if(!populationRef)return{componentId:component.componentId,status:"UNKNOWN" as const,source:"UNRESOLVED" as const,reason:"Population reference is unavailable."};
      if(!context)return{componentId:component.componentId,status:"REFERENCE_BOUND" as const,populationRef,...(bindingTime?{bindingTime}:{}),source};
      const matches=context.bindings.filter(x=>x.populationRef===populationRef&&x.bindingTime===bindingTime);
      if(matches.length===1){
        const resolved=matches[0]!;
        return{componentId:component.componentId,status:"SNAPSHOT_RESOLVED" as const,populationRef,...(bindingTime?{bindingTime}:{}),source,snapshotRef:resolved.snapshotRef,definitionRef:resolved.definitionRef};
      }
      return{componentId:component.componentId,status:"UNKNOWN" as const,populationRef,...(bindingTime?{bindingTime}:{}),source:"UNRESOLVED" as const,reason:matches.length===0?"Population snapshot binding is unavailable.":"Population snapshot binding is ambiguous."};
    }),
  };
}

function resolutionStatus(r:TimingResolution):"RESOLVED"|"UNRESOLVED"|"INVALID"{
  return r.status==="VALID"?"RESOLVED":r.status==="INVALID"?"INVALID":"UNRESOLVED";
}
export function resolveCompoundTiming(c:CompoundAction,context:ActionTimingResolutionContext):CompoundTimingResolution{
  const compound=c.timing?resolveActionTiming(c.timing,context):undefined;
  const componentMap=new Map<string,TimingResolution>();
  const components=c.components.map(component=>{
    if(component.timing.kind==="INHERIT"){
      if(!compound)return{componentId:component.componentId,status:"UNRESOLVED" as const,inherited:true,dependencyIds:[],reasons:["COMPOUND_TIMING_NOT_AVAILABLE"]};
      componentMap.set(component.componentId,compound);
      return{componentId:component.componentId,status:resolutionStatus(compound),inherited:true,resolution:compound,dependencyIds:[],reasons:compound.status==="VALID"?[]:[...compound.missingContext,...compound.unresolvedDependencies]};
    }
    if(component.timing.kind==="OVERRIDE"){
      const resolution=resolveActionTiming(component.timing.timing,context);componentMap.set(component.componentId,resolution);
      return{componentId:component.componentId,status:resolutionStatus(resolution),inherited:false,resolution,dependencyIds:[],reasons:resolution.status==="VALID"?[]:[...resolution.missingContext,...resolution.unresolvedDependencies]};
    }
    return{componentId:component.componentId,status:"UNRESOLVED" as const,inherited:false,dependencyIds:[...component.timing.dependencyIds],reasons:["RELATIONAL_COMPONENT_TIMING_REQUIRES_DEPENDENCY_RESOLUTION"]};
  });
  const unresolvedDependencies:string[]=[];
  for(const component of components)if(component.status!=="RESOLVED")unresolvedDependencies.push(...component.dependencyIds);
  for(const dependency of c.dependencies){
    const dependent=components.find(x=>x.componentId===dependency.componentId);
    const source=components.find(x=>x.componentId===dependency.dependsOnComponentId);
    if(!dependent||!source||source.status!=="RESOLVED"||dependent.status!=="RESOLVED")unresolvedDependencies.push(dependency.dependencyId);
  }
  return{
    compoundActionId:c.compoundActionId,
    ...(compound?{compound}:{}),
    components,
    unresolvedDependencies:[...new Set(unresolvedDependencies)].sort(),
    ordering:flattenCompoundAction(c).map(x=>x.componentId),
  };
}
