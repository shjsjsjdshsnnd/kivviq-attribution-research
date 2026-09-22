import type { MonetaryValue } from "../action_ontology/types.js";
import { validateAction } from "../action_ontology/validation.js";
import type { ShippingRollbackReadiness, ShippingRollbackStateContext } from "./types.js";

function sameMoney(a:MonetaryValue,b:MonetaryValue){return a.amountMinor===b.amountMinor&&a.currency===b.currency;}

export function evaluateShippingRollbackReadiness(input:unknown,ctx:ShippingRollbackStateContext):ShippingRollbackReadiness{
  const v=validateAction(input);
  if(!v.ok)return {status:"INVALID_ACTION",code:"INVALID_CANONICAL_ACTION",message:v.errors.map(e=>e.code).join(", ")};
  const action=v.action;
  if(action.actionType!=="shipping.rollback_policy"||action.parameters.kind!=="shipping_policy_rollback"){
    return {status:"INVALID_ACTION",code:"NOT_A_SHIPPING_ROLLBACK_ACTION",message:"Action must use shipping.rollback_policy."};
  }
  const guard=action.parameters.conflictGuard;
  if(!ctx.currentThreshold)return {status:"MISSING_CONTEXT",rollbackActionId:action.actionId,code:"MISSING_CURRENT_THRESHOLD",message:"Current threshold is required for safe rollback."};
  if(!sameMoney(ctx.currentThreshold,guard.expectedThreshold))return {status:"CONFLICT",rollbackActionId:action.actionId,code:"CURRENT_THRESHOLD_CHANGED_AFTER_ORIGINAL_ACTION",message:"Current threshold no longer matches the output of the original temporary Action."};
  if(action.parameters.strategy.kind==="SET_EXPLICIT_VALUE"){
    return {status:"READY",rollbackActionId:action.actionId,originalActionId:action.parameters.originalActionId,threshold:action.parameters.strategy.value,sourceRef:"action:explicit-shipping-rollback-value"};
  }
  const ref=action.parameters.strategy.preActionThreshold;
  if(ref.kind==="explicit_baseline"&&ref.value.kind==="money"){
    return {status:"READY",rollbackActionId:action.actionId,originalActionId:action.parameters.originalActionId,threshold:ref.value,sourceRef:"action:explicit-pre-action-threshold"};
  }
  if(!ctx.preActionThreshold||!ctx.preActionThresholdSourceRef)return {status:"MISSING_CONTEXT",rollbackActionId:action.actionId,code:"MISSING_PRE_ACTION_THRESHOLD",message:"Pre-action threshold is required."};
  return {status:"READY",rollbackActionId:action.actionId,originalActionId:action.parameters.originalActionId,threshold:ctx.preActionThreshold,sourceRef:ctx.preActionThresholdSourceRef};
}
