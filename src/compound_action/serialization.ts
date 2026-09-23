import type { CompoundAction } from "./types.js";
import { validateCompoundAction } from "./validation.js";
import { compoundSemanticProjection } from "./semantics.js";
export function serializeCompoundAction(c:CompoundAction):string{
  const v=validateCompoundAction(c);if(!v.ok)throw new TypeError("Invalid CompoundAction: "+v.issues.map(x=>x.code).join(", "));
  return JSON.stringify(compoundSemanticProjection(v.compound));
}
export function deserializeCompoundActionDefinition(serialized:string):never{
  JSON.parse(serialized);
  throw new Error("Semantic projection is not a full CompoundAction definition; deserialize requires the full canonical envelope and is intentionally not implicit.");
}
