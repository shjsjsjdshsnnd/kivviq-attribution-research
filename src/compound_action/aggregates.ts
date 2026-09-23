import type { CompoundAction,CompoundCostSummary,CompoundResourceSummary,CompoundRiskSummary } from "./types.js";

const COST_FIELDS=["directFinancialCost","mediaSpend","implementationCost","engineeringCost","operationalCost","promotionalCost","inventoryCommitment"] as const;

export function summarizeCompoundCosts(c:CompoundAction):CompoundCostSummary{
  return{
    compoundActionId:c.compoundActionId,
    dimensions:COST_FIELDS.map(dimension=>{
      const values=c.components.map(component=>{
        const value=component.action.cost[dimension];
        if(value.kind==="unknown")return{componentId:component.componentId,state:"UNKNOWN" as const,reason:value.reason};
        return{componentId:component.componentId,state:"KNOWN" as const,currency:value.value.currency,amountMinor:value.value.amountMinor};
      });
      if(values.some(v=>v.state==="UNKNOWN"))return{dimension,status:"UNKNOWN" as const,componentValues:values};
      const known=values.filter((v):v is Extract<typeof v,{state:"KNOWN"}>=>v.state==="KNOWN");
      const currencies=new Set(known.map(v=>String(v.currency)));
      if(currencies.size!==1)return{dimension,status:"MIXED_CURRENCY" as const,componentValues:values};
      return{dimension,status:"AGGREGATED" as const,currency:String(known[0]?.currency),amountMinor:known.reduce((n,v)=>n+Number(v.amountMinor),0),componentValues:values};
    }),
  };
}
function resourceScalar(amount:any):{kind:string;unit?:string;currency?:string;value:number}|undefined{
  if(!amount||amount.kind!=="known")return undefined;
  const v=amount.value;
  if(v.kind==="money")return{kind:"money",currency:String(v.currency),value:Number(v.amountMinor)};
  if(v.kind==="quantity")return{kind:"quantity",unit:String(v.unit),value:Number(v.value)};
  return undefined;
}
export function summarizeCompoundResources(c:CompoundAction):CompoundResourceSummary{
  const by=new Map<string,{componentId:string;amount:any}[]>();
  for(const component of c.components)for(const requirement of component.action.resourceRequirements){
    const current=by.get(requirement.resourceType)??[];current.push({componentId:component.componentId,amount:requirement.amount});by.set(requirement.resourceType,current);
  }
  return{
    compoundActionId:c.compoundActionId,
    aggregates:[...by.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([resourceType,entries])=>{
      if(entries.some(e=>e.amount.kind==="unknown"))return{resourceType,status:"UNKNOWN" as const,componentIds:entries.map(e=>e.componentId)};
      const scalars=entries.map(e=>resourceScalar(e.amount));
      if(scalars.some(x=>!x))return{resourceType,status:"INCOMPATIBLE_UNITS" as const,componentIds:entries.map(e=>e.componentId)};
      const concrete=scalars as NonNullable<(typeof scalars)[number]>[];
      const key=(x:typeof concrete[number])=>x.kind+"|"+(x.unit??"")+"|"+(x.currency??"");
      if(new Set(concrete.map(key)).size!==1)return{resourceType,status:"INCOMPATIBLE_UNITS" as const,componentIds:entries.map(e=>e.componentId)};
      const first=concrete[0]!;
      return{resourceType,status:"AGGREGATED" as const,kind:first.kind,...(first.unit?{unit:first.unit}:{}),...(first.currency?{currency:first.currency}:{}),amount:concrete.reduce((n,x)=>n+x.value,0),componentIds:entries.map(e=>e.componentId)};
    }),
  };
}
export function summarizeCompoundRisk(c:CompoundAction):CompoundRiskSummary{
  const components=c.components.map(x=>({componentId:x.componentId,risks:x.action.riskDimensions.map(r=>({dimension:r.dimension,downsideDefinition:r.downsideDefinition}))}));
  return{compoundActionId:c.compoundActionId,dimensions:[...new Set(components.flatMap(x=>x.risks.map(r=>r.dimension)))].sort(),components};
}
