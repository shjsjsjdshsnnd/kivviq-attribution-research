import type { Action } from "../action_ontology/types.js";
import type { ShippingConflictAssessment } from "./types.js";

function ref(action:Action){
  if(action.parameters.kind!=="shipping_offer_set"&&action.parameters.kind!=="shipping_offer_modify")return undefined;
  return {
    id: action.parameters.kind==="shipping_offer_set"?action.parameters.shippingOfferId:action.parameters.targetShippingOfferId,
    def: action.parameters.definition
  };
}

export function assessShippingOfferConflict(leftAction:Action,rightAction:Action):ShippingConflictAssessment{
  const left=ref(leftAction),right=ref(rightAction);
  if(!left||!right)return {status:"AMBIGUOUS",code:"NON_STACKABLE_SHIPPING_OVERLAP_WITHOUT_RESOLUTION"};
  if(left.def.stacking.kind==="COEXIST"&&right.def.stacking.kind==="COEXIST")return {status:"COEXIST"};
  const a=left.def.conflictResolution,b=right.def.conflictResolution;
  if(a.kind==="MUTUALLY_EXCLUSIVE_GROUP"&&b.kind==="MUTUALLY_EXCLUSIVE_GROUP"&&a.groupId===b.groupId){
    if(a.precedence!==undefined&&b.precedence!==undefined&&a.precedence!==b.precedence)return {status:"RESOLVABLE",strategy:"MUTUALLY_EXCLUSIVE_GROUP",groupId:a.groupId,winnerShippingOfferId:a.precedence>b.precedence?left.id:right.id};
    return {status:"RESOLVABLE",strategy:"MUTUALLY_EXCLUSIVE_GROUP",groupId:a.groupId};
  }
  if(a.kind==="PRECEDENCE"&&b.kind==="PRECEDENCE"&&a.precedence!==b.precedence)return {status:"RESOLVABLE",strategy:"PRECEDENCE",winnerShippingOfferId:a.precedence>b.precedence?left.id:right.id};
  if(a.kind==="BEST_BENEFIT"&&b.kind==="BEST_BENEFIT")return {status:"RESOLVABLE",strategy:"BEST_BENEFIT"};
  return {status:"AMBIGUOUS",code:"NON_STACKABLE_SHIPPING_OVERLAP_WITHOUT_RESOLUTION"};
}
