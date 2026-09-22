import { describe,expect,it } from "vitest";
import { currencyCode } from "../../src/core/units.js";
import { evaluateShippingRollbackReadiness } from "../../src/shipping/rollback.js";
import { assessShippingOfferConflict } from "../../src/shipping/conflicts.js";
import { assertValidAction } from "../../src/action_ontology/validation.js";
import {
 rollbackTemporaryThreshold,freeStandardShippingAllOrders,freeStandardOver150
} from "../../src/shipping/fixtures.js";

const CAD=currencyCode("CAD");
const clone=<T>(v:T):any=>JSON.parse(JSON.stringify(v));

describe("Step 6 shipping rollback/conflicts",()=>{
 it("rolls back only when current threshold still matches original temporary output",()=>{
  expect(evaluateShippingRollbackReadiness(rollbackTemporaryThreshold,{currentThreshold:{kind:"money",amountMinor:7500,currency:CAD}})).toMatchObject({
   status:"READY",threshold:{kind:"money",amountMinor:15000,currency:"CAD"}
  });
  expect(evaluateShippingRollbackReadiness(rollbackTemporaryThreshold,{currentThreshold:{kind:"money",amountMinor:12500,currency:CAD}})).toMatchObject({
   status:"CONFLICT",code:"CURRENT_THRESHOLD_CHANGED_AFTER_ORIGINAL_ACTION"
  });
 });

 it("returns missing context rather than guessing current threshold",()=>{
  expect(evaluateShippingRollbackReadiness(rollbackTemporaryThreshold,{})).toMatchObject({status:"MISSING_CONTEXT",code:"MISSING_CURRENT_THRESHOLD"});
 });

 it("allows coexistence when both shipping offers explicitly coexist",()=>{
  expect(assessShippingOfferConflict(freeStandardShippingAllOrders,freeStandardOver150)).toEqual({status:"COEXIST"});
 });

 it("uses explicit business precedence for non-stackable conflicts",()=>{
  const left=clone(freeStandardShippingAllOrders);
  left.actionId="action_ship_precedence_left";left.target.shippingOfferId="shipoffer_precedence_left";left.parameters.shippingOfferId="shipoffer_precedence_left";
  left.parameters.definition.stacking={kind:"NON_STACKABLE"};left.parameters.definition.conflictResolution={kind:"PRECEDENCE",precedence:20};
  const right=clone(freeStandardOver150);
  right.actionId="action_ship_precedence_right";right.target.shippingOfferId="shipoffer_precedence_right";right.parameters.shippingOfferId="shipoffer_precedence_right";
  right.parameters.definition.stacking={kind:"NON_STACKABLE"};right.parameters.definition.conflictResolution={kind:"PRECEDENCE",precedence:10};
  expect(assessShippingOfferConflict(assertValidAction(left),assertValidAction(right))).toMatchObject({status:"RESOLVABLE",strategy:"PRECEDENCE",winnerShippingOfferId:"shipoffer_precedence_left"});
 });
});
