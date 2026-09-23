import { resolveActionTiming } from "../action_timing/resolution.js";
import type { ActionTimingResolutionContext,TimingResolution } from "../action_timing/types.js";
import type { CompoundAction,CompoundPopulationResolution,CompoundTimingResolution } from "./types.js";
import { flattenCompoundAction } from "./semantics.js";

export function resolveCompoundPopulations(c:CompoundAction):CompoundPopulationResolution{
  return{
    compoundActionId:c.compoundActionId,
    components:c.components.map(component=>{
      const binding=component.population;
      if(binding.kind==="NOT_APPLICABLE")return{componentId:component.componentId,status:"NOT_APPLICABLE" as const,source:"NOT_APPLICABLE" as const,reason:binding.reason};
      if(binding.kind==="OVERRIDE")return{componentId:component.componentId,status:"REFERENCE_BOUND" as const,populationRef:binding.populationRef,...(binding.bindingTime?{bindingTime:binding.bindingTime}:{}),source:"COMPONENT_OVERRIDE" as const};
      if(c.defaultPopulation)return{componentId:component.componentId,status:"REFERENCE_BOUND" as const,populationRef:c.defaultPopulation,source:"COMPOUND_DEFAULT" as const};
      return{componentId:component.componentId,status:"UNKNOWN" as const,source:"UNRESOLVED" as const,reason:"Compound default population is unavailable."};
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
