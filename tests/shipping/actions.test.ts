import { describe,expect,it } from "vitest";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { serializeAction } from "../../src/action_ontology/serialization.js";
import { validateAction } from "../../src/action_ontology/validation.js";
import { startAutomaticCollectionX15FourDays } from "../../src/promotion/fixtures.js";
import {
 freeStandardShippingAllOrders,freeStandardOver150,permanentThreshold150To125,
 temporaryThreshold150To75,freeShippingRugs,freeExpressShipping,invalidNegativeThreshold,
 temporarySitewideFreeFridayMonday,flatRateOutdoor10,shippingCreditProductC20,
 modifyFreeStandardThresholdOffer,stopFreeStandardThresholdOffer
} from "../../src/shipping/fixtures.js";

const clone=<T>(v:T):any=>JSON.parse(JSON.stringify(v));

describe("Step 6 canonical shipping Actions",()=>{
 it("distinguishes persistent free shipping, temporary offer, threshold offer and category offer",()=>{
  const fps=new Set([
   actionFingerprint(freeStandardShippingAllOrders),
   actionFingerprint(temporarySitewideFreeFridayMonday),
   actionFingerprint(freeStandardOver150),
   actionFingerprint(freeShippingRugs),
  ]);
  expect(fps.size).toBe(4);
 });

 it("keeps underlying policy adjustment distinct from overlay shipping offer",()=>{
  expect(permanentThreshold150To125.actionType).toBe("shipping.adjust_policy");
  expect(freeStandardOver150.actionType).toBe("shipping.set_offer");
  expect(actionFingerprint(permanentThreshold150To125)).not.toBe(actionFingerprint(freeStandardOver150));
 });

 it("keeps shipping separate from Step 5 promotion",()=>{
  expect(actionFingerprint(freeStandardShippingAllOrders)).not.toBe(actionFingerprint(startAutomaticCollectionX15FourDays));
  expect(serializeAction(freeStandardShippingAllOrders)).not.toBe(serializeAction(startAutomaticCollectionX15FourDays));
 });

 it("preserves threshold basis and DELTA semantics",()=>{
  expect(permanentThreshold150To125.parameters.kind).toBe("shipping_policy_adjustment");
  if(permanentThreshold150To125.parameters.kind!=="shipping_policy_adjustment")return;
  expect(permanentThreshold150To125.parameters.definition.thresholdBasis).toBe("POST_DISCOUNT_SUBTOTAL");
  expect(permanentThreshold150To125.parameters.definition.operation).toMatchObject({
   kind:"DELTA",direction:"decrease",amount:{kind:"money",amountMinor:2500,currency:"CAD"},
   reference:{kind:"explicit_baseline",value:{kind:"money",amountMinor:15000,currency:"CAD"}}
  });
 });

 it("distinguishes SET threshold from DELTA threshold",()=>{
  expect(temporaryThreshold150To75.parameters.kind).toBe("shipping_policy_adjustment");
  if(temporaryThreshold150To75.parameters.kind!=="shipping_policy_adjustment")return;
  expect(temporaryThreshold150To75.parameters.definition.operation.kind).toBe("SET");
  expect(actionFingerprint(temporaryThreshold150To75)).not.toBe(actionFingerprint(permanentThreshold150To125));
 });

 it("distinguishes free standard from free express shipping",()=>{
  expect(actionFingerprint(freeStandardShippingAllOrders)).not.toBe(actionFingerprint(freeExpressShipping));
 });

 it("supports flat-rate and shipping-credit benefits with explicit customer charge semantics",()=>{
  if(flatRateOutdoor10.parameters.kind==="shipping_offer_set"){
   expect(flatRateOutdoor10.parameters.definition.benefit).toEqual({
    kind:"FLAT_RATE",customerShippingCharge:{kind:"money",amountMinor:1000,currency:"CAD"}
   });
  }
  if(shippingCreditProductC20.parameters.kind==="shipping_offer_set"){
   expect(shippingCreditProductC20.parameters.definition.benefit).toEqual({
    kind:"SHIPPING_CREDIT",customerShippingCredit:{kind:"money",amountMinor:2000,currency:"CAD"}
   });
  }
 });

 it("keeps SET/MODIFY/STOP offer identity distinct",()=>{
  const fps=new Set([
   actionFingerprint(freeStandardOver150),
   actionFingerprint(modifyFreeStandardThresholdOffer),
   actionFingerprint(stopFreeStandardThresholdOffer)
  ]);
  expect(fps.size).toBe(3);
 });

 it("rejects negative threshold",()=>{
  const r=validateAction(invalidNegativeThreshold);
  expect(r.ok).toBe(false);
  if(!r.ok)expect(r.errors.some(e=>e.code==="INVALID_MONEY_MINOR")).toBe(true);
 });

 it("rejects 1.4 shipping semantics mislabeled as 1.3",()=>{
  const invalid=clone(freeStandardShippingAllOrders);
  invalid.schemaVersion="1.3.0";
  const r=validateAction(invalid);
  expect(r.ok).toBe(false);
  if(!r.ok)expect(r.errors.some(e=>e.code==="SCHEMA_FEATURE_REQUIRES_1_4")).toBe(true);
 });

 it("rejects embedded shipping predictions/evaluations",()=>{
  for(const key of ["expectedConversionLift","expectedAOV","expectedRevenue","expectedProfit","expectedOrders","expectedShippingCost","predictedDemand","predictedAbandonmentReduction","futureCartValue","futureShippingCost","counterfactualRevenue","recommendationScore","confidenceScore"]){
   const invalid=clone(freeStandardShippingAllOrders);invalid[key]=1;
   const r=validateAction(invalid);expect(r.ok).toBe(false);
   if(!r.ok)expect(r.errors.some(e=>e.code==="FORBIDDEN_ACTION_INFORMATION")).toBe(true);
  }
 });
});
