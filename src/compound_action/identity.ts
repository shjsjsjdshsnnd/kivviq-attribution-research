import type { CompoundActionId } from "./types.js";

export function compoundActionId(value:string):CompoundActionId{
  if(!/^compound_[A-Za-z0-9._:-]+$/.test(value))throw new RangeError("CompoundActionId must begin with compound_ and contain only stable identifier characters");
  return value as CompoundActionId;
}
export function compoundComponentId(value:string):string{
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))throw new RangeError("Compound component ID is invalid");
  return value;
}
export function compoundDependencyId(value:string):string{
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))throw new RangeError("Compound dependency ID is invalid");
  return value;
}
