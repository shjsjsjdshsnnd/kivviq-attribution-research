import { describe,expect,it } from "vitest";
import { currencyCode } from "../../src/core/units.js";
import { evaluateShippingEligibility } from "../../src/shipping/eligibility.js";
import {
 freeShippingCanadaExcludingRemote,freeStandardExcludeWhiteGlove,freeShippingVip,
 freeShippingTwoDiningChairs,freeShippingContribution100,categoryMixedCartAnyEligible,
 categoryMissingMembership,shippingClassUnknownOffer,freeStandardOver150
} from "../../src/shipping/fixtures.js";

const CAD=currencyCode("CAD");
const baseCart={
 preDiscountSubtotal:{kind:"money" as const,amountMinor:17000,currency:CAD},
 postDiscountSubtotal:{kind:"money" as const,amountMinor:16000,currency:CAD},
 lines:[] as any[]
};

describe("Step 6 deterministic shipping eligibility",()=>{
 it("handles included, excluded and unknown geography",()=>{
  expect(evaluateShippingEligibility(freeShippingCanadaExcludingRemote,{geography:{countryCode:"CA",merchantShippingZoneIds:["urban"]},selectedService:{kind:"STANDARD"},hardConstraintResults:{}}).status).toBe("eligible");
  expect(evaluateShippingEligibility(freeShippingCanadaExcludingRemote,{geography:{countryCode:"CA",merchantShippingZoneIds:["remote"]},selectedService:{kind:"STANDARD"},hardConstraintResults:{}}).status).toBe("ineligible");
  expect(evaluateShippingEligibility(freeShippingCanadaExcludingRemote,{selectedService:{kind:"STANDARD"},hardConstraintResults:{}}).status).toBe("unknown");
 });

 it("distinguishes standard service from excluded white-glove service",()=>{
  expect(evaluateShippingEligibility(freeStandardExcludeWhiteGlove,{geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"},hardConstraintResults:{}}).status).toBe("eligible");
  expect(evaluateShippingEligibility(freeStandardExcludeWhiteGlove,{geography:{countryCode:"CA"},selectedService:{kind:"WHITE_GLOVE"},hardConstraintResults:{}}).status).toBe("ineligible");
 });

 it("handles eligible/ineligible/unknown customer segment",()=>{
  const common={geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"} as const,hardConstraintResults:{}};
  expect(evaluateShippingEligibility(freeShippingVip,{...common,customer:{loyaltySegmentIds:["vip:A"]}}).status).toBe("eligible");
  expect(evaluateShippingEligibility(freeShippingVip,{...common,customer:{loyaltySegmentIds:["vip:B"]}}).status).toBe("ineligible");
  expect(evaluateShippingEligibility(freeShippingVip,{...common,customer:{}}).status).toBe("unknown");
 });

 it("evaluates pre/post threshold basis deterministically",()=>{
  const common={geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"} as const,hardConstraintResults:{}};
  expect(evaluateShippingEligibility(freeStandardOver150,{...common,cart:baseCart}).status).toBe("eligible");
  expect(evaluateShippingEligibility(freeStandardOver150,{...common,cart:{...baseCart,postDiscountSubtotal:{kind:"money",amountMinor:14000,currency:CAD}}}).status).toBe("ineligible");
 });

 it("evaluates quantity requirement",()=>{
  const ctx={geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"} as const,hardConstraintResults:{},cart:{...baseCart,lines:[{categoryIds:["category:dining_chairs"],quantity:2}]}};
  expect(evaluateShippingEligibility(freeShippingTwoDiningChairs,ctx).status).toBe("eligible");
  expect(evaluateShippingEligibility(freeShippingTwoDiningChairs,{...ctx,cart:{...ctx.cart,lines:[{categoryIds:["category:dining_chairs"],quantity:1}]}}).status).toBe("ineligible");
 });

 it("evaluates mixed cart any-eligible semantics",()=>{
  const common={geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"} as const,hardConstraintResults:{},availableMembershipBindingRefs:["membership:shipping:rugs:decision"]};
  expect(evaluateShippingEligibility(categoryMixedCartAnyEligible,{...common,product:{categoryIds:["category:rugs"]},cart:{...baseCart,lines:[{categoryIds:["category:rugs"],quantity:1},{categoryIds:["category:chairs"],quantity:1}]}}).status).toBe("eligible");
 });

 it("returns unknown when required membership snapshot is unavailable",()=>{
  expect(evaluateShippingEligibility(categoryMissingMembership,{geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"},product:{categoryIds:["category:missing"]},hardConstraintResults:{}})).toMatchObject({status:"unknown",reasonCodes:["SHIPPING_MEMBERSHIP_SNAPSHOT_UNAVAILABLE"]});
 });

 it("returns unknown for missing shipping classification",()=>{
  expect(evaluateShippingEligibility(shippingClassUnknownOffer,{geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"},product:{productId:"product:C"},hardConstraintResults:{}}).status).toBe("unknown");
 });

 it("preserves economic constraint satisfied/violated/unknown",()=>{
  const common={geography:{countryCode:"CA"},selectedService:{kind:"STANDARD"} as const};
  expect(evaluateShippingEligibility(freeShippingContribution100,{...common,hardConstraintResults:{shipping_contribution_per_order_100:"satisfied"}}).status).toBe("eligible");
  expect(evaluateShippingEligibility(freeShippingContribution100,{...common,hardConstraintResults:{shipping_contribution_per_order_100:"violated"}}).status).toBe("ineligible");
  expect(evaluateShippingEligibility(freeShippingContribution100,{...common,hardConstraintResults:{shipping_contribution_per_order_100:"unknown"}}).status).toBe("unknown");
 });
});
