import { canonicalizeForSerialization } from "../action_ontology/semantics.js";
import type { CompoundAction } from "./types.js";
import { validateCompoundAction } from "./validation.js";

function stable(v:unknown):string{return JSON.stringify(canonicalizeForSerialization(v))}
function canonicalEnvelope(c:CompoundAction):unknown{
  const components=c.ordering.kind==="ORDERED"?c.components:[...c.components].sort((a,b)=>stable(a).localeCompare(stable(b)));
  return canonicalizeForSerialization({...c,components,dependencies:[...c.dependencies].sort((a,b)=>stable(a).localeCompare(stable(b))),constraints:[...c.constraints].sort((a,b)=>stable(a).localeCompare(stable(b)))});
}
export function serializeCompoundAction(c:CompoundAction):string{
  const v=validateCompoundAction(c);if(!v.ok)throw new TypeError("Invalid CompoundAction: "+v.issues.map(x=>x.code).join(", "));
  return JSON.stringify(canonicalEnvelope(v.compound));
}
export function deserializeCompoundAction(serialized:string):CompoundAction{
  let parsed:unknown;try{parsed=JSON.parse(serialized)}catch{throw new TypeError("Serialized CompoundAction must be valid JSON")}
  const v=validateCompoundAction(parsed);if(!v.ok)throw new TypeError("Invalid CompoundAction: "+v.issues.map(x=>x.code).join(", "));
  return v.compound;
}
