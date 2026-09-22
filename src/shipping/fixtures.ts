import { currencyCode, utcTimestamp } from "../core/units.js";
import { doNothingAction } from "../action_ontology/fixtures.js";
import { actionId, actionType, constraintId } from "../action_ontology/identity.js";
import type {
  Action, ActionParameters, MonetaryValue, ShippingOfferDefinition,
  ShippingProductScope, ShippingRollbackContract
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";

const CAD=currencyCode("CAD");
const DECISION=utcTimestamp("2026-09-22T13:00:00Z");
const FRIDAY=utcTimestamp("2026-09-25T04:00:00Z");
const FOUR_DAYS=4*24*60*60;

const money=(amountMinor:number):MonetaryValue=>({kind:"money",amountMinor,currency:CAD});
const allCanada={include:[{kind:"COUNTRY",countryCode:"CA"}] as const,exclude:[] as const,exclusionPrecedence:"EXCLUDE_OVERRIDES_INCLUDE" as const};
const standardServices={include:[{kind:"STANDARD"}] as const,exclude:[] as const,exclusionPrecedence:"EXCLUDE_OVERRIDES_INCLUDE" as const};
const allCustomers={kind:"ALL_CUSTOMERS"} as const;

function offerDefinition(overrides:Partial<ShippingOfferDefinition>):ShippingOfferDefinition{
  return {
    benefit:{kind:"FREE_SHIPPING"},
    services:standardServices,
    geography:allCanada,
    customerEligibility:allCustomers,
    cartRequirements:[],
    stacking:{kind:"COEXIST"},
    conflictResolution:{kind:"NONE"},
    terminationBehavior:"DEACTIVATE_SHIPPING_OFFER",
    ...overrides,
  };
}

function shippingAction(input:{
  actionIdValue:string;
  actionTypeValue:"shipping.set_offer"|"shipping.modify_offer"|"shipping.stop_offer"|"shipping.adjust_policy"|"shipping.rollback_policy";
  target:{kind:"shipping_offer";shippingOfferId:string}|{kind:"shipping_policy";shippingPolicyId:string};
  description:string;
  parameters:ActionParameters;
  duration?:Action["duration"];
  termination?:Action["termination"];
  timing?:Action["timing"];
  constraints?:Action["constraints"];
  preconditions?:Action["preconditions"];
  shippingRollback?:ShippingRollbackContract;
  reversalOfActionId?:Action["reversalOfActionId"];
}):Action{
  const duration=input.duration??(
    input.actionTypeValue==="shipping.stop_offer"||input.actionTypeValue==="shipping.modify_offer"||input.actionTypeValue==="shipping.rollback_policy"
      ? {kind:"instantaneous" as const}:{kind:"persistent" as const}
  );
  const timing=input.timing??{
    decisionTime:DECISION,
    requestedStart:{kind:"known" as const,at:DECISION},
    effectiveStart:{kind:"known" as const,at:DECISION},
    implementationDelaySeconds:{kind:"known" as const,seconds:0},
  };
  const termination=input.termination??(
    duration.kind==="temporary"?{kind:"fixed_duration" as const,durationSeconds:duration.durationSeconds}:
    duration.kind==="instantaneous"?{kind:"fixed_end" as const,at: timing.effectiveStart.kind==="known"?timing.effectiveStart.at:DECISION}:
    {kind:"persistent" as const}
  );
  return assertValidAction({
    ...doNothingAction,
    actionId:actionId(input.actionIdValue),
    actionType:actionType(input.actionTypeValue),
    actionCategory:"shipping",
    schemaVersion:"1.4.0",
    description:input.description,
    target:input.target,
    parameters:input.parameters,
    timing,duration,termination,
    constraints:input.constraints??[],
    preconditions:input.preconditions??[],
    reversibility:{
      classification:"immediately_reversible",
      reversal:{kind:"restore_previous_value",target:input.target,parameterKind:input.parameters.kind},
      minimumDelaySeconds:0,
      ...(input.shippingRollback?{shippingRollback:input.shippingRollback}:{}),
    },
    ...(input.reversalOfActionId?{reversalOfActionId:input.reversalOfActionId}:{}),
    intent:{statement:"Represent an explicit customer-facing shipping business decision."},
  });
}

function setOffer(id:string,actionIdValue:string,description:string,definition:ShippingOfferDefinition,opts:Partial<Parameters<typeof shippingAction>[0]>={}):Action{
  return shippingAction({
    actionIdValue,actionTypeValue:"shipping.set_offer",
    target:{kind:"shipping_offer",shippingOfferId:id},
    description,
    parameters:{kind:"shipping_offer_set",shippingOfferId:id,definition},
    ...opts,
  } as any);
}

export const freeStandardShippingAllOrders=setOffer(
  "shipoffer_free_standard_all","action_ship_free_standard_all",
  "Free standard shipping on all eligible Canadian orders.",
  offerDefinition({})
);

export const freeStandardOver150=setOffer(
  "shipoffer_free_standard_150","action_ship_free_standard_150",
  "Free standard shipping on orders at least CAD 150 after discounts.",
  offerDefinition({cartRequirements:[{kind:"MIN_SUBTOTAL",value:money(15000),basis:"POST_DISCOUNT_SUBTOTAL"}]})
);

export const permanentThreshold150To125=shippingAction({
  actionIdValue:"action_ship_policy_threshold_150_to_125",
  actionTypeValue:"shipping.adjust_policy",
  target:{kind:"shipping_policy",shippingPolicyId:"shipping_policy:standard_free_threshold"},
  description:"Change permanent standard free-shipping threshold from CAD 150 to CAD 125.",
  parameters:{
    kind:"shipping_policy_adjustment",
    definition:{
      kind:"FREE_SHIPPING_THRESHOLD",
      service:{kind:"STANDARD"},
      thresholdBasis:"POST_DISCOUNT_SUBTOTAL",
      operation:{kind:"DELTA",direction:"decrease",amount:money(2500),reference:{kind:"explicit_baseline",value:money(15000)}},
      geography:allCanada,
      customerEligibility:allCustomers,
    },
  },
});

export const temporaryThreshold150To75=shippingAction({
  actionIdValue:"action_ship_policy_threshold_150_to_75_temp",
  actionTypeValue:"shipping.adjust_policy",
  target:{kind:"shipping_policy",shippingPolicyId:"shipping_policy:standard_free_threshold"},
  description:"Temporarily lower free-shipping threshold from CAD 150 to CAD 75 for four days.",
  parameters:{
    kind:"shipping_policy_adjustment",
    definition:{
      kind:"FREE_SHIPPING_THRESHOLD",
      service:{kind:"STANDARD"},
      thresholdBasis:"POST_DISCOUNT_SUBTOTAL",
      operation:{kind:"SET",value:money(7500)},
      geography:allCanada,
      customerEligibility:allCustomers,
    },
  },
  duration:{kind:"temporary",durationSeconds:FOUR_DAYS},
  shippingRollback:{
    available:true,
    strategy:{kind:"RESTORE_PRE_ACTION_VALUE",preActionThreshold:{kind:"explicit_baseline",value:money(15000)}},
    trigger:{kind:"ON_TERMINATION"},
    delaySeconds:0,
    cost:{kind:"known",value:money(0),sourceRef:"shipping:rollback:no-direct-cost"},
    conflictGuard:{
      kind:"REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId:actionId("action_ship_policy_threshold_150_to_75_temp"),
      expectedThreshold:money(7500),
    },
  },
});

const productScope=(include:ShippingProductScope["include"],mixedCart:ShippingProductScope["mixedCart"],bindingRef?:string,conditions:ShippingProductScope["conditions"]=[]):ShippingProductScope=>({
  include,exclude:[],exclusionPrecedence:"EXCLUDE_OVERRIDES_INCLUDE",conditions,mixedCart,
  ...(bindingRef?{membership:{evaluateAt:"decision_time",bindingRef}}:{}),
});

export const freeShippingRugs=setOffer(
  "shipoffer_rugs_free","action_ship_rugs_free",
  "Free standard shipping on rugs.",
  offerDefinition({products:productScope([{kind:"category",categoryId:"category:rugs"}],{kind:"ELIGIBLE_ITEMS_ONLY"},"membership:shipping:rugs:decision")})
);

export const freeShippingCollectionX=setOffer(
  "shipoffer_collection_x_free","action_ship_collection_x_free",
  "Free standard shipping on Collection X.",
  offerDefinition({products:productScope([{kind:"collection",collectionId:"collection:X"}],{kind:"ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM"},"membership:shipping:collection-x:decision")})
);

export const freeShippingProductA=setOffer(
  "shipoffer_product_a_free","action_ship_product_a_free",
  "Free standard shipping on Product A.",
  offerDefinition({products:productScope([{kind:"product",productId:"product:A"}],{kind:"ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM"})})
);

export const freeShippingCanadaExcludingRemote=setOffer(
  "shipoffer_canada_no_remote","action_ship_canada_no_remote",
  "Free standard shipping in Canada excluding remote shipping zones.",
  offerDefinition({
    geography:{
      include:[{kind:"COUNTRY",countryCode:"CA"}],
      exclude:[{kind:"MERCHANT_SHIPPING_ZONE",shippingZoneId:"remote"}],
      exclusionPrecedence:"EXCLUDE_OVERRIDES_INCLUDE",
    },
  })
);

export const freeStandardExcludeWhiteGlove=setOffer(
  "shipoffer_standard_no_white_glove","action_ship_standard_no_white_glove",
  "Free standard shipping while white-glove service remains excluded.",
  offerDefinition({
    services:{
      include:[{kind:"STANDARD"}],
      exclude:[{kind:"WHITE_GLOVE"}],
      exclusionPrecedence:"EXCLUDE_OVERRIDES_INCLUDE",
    },
  })
);

export const freeShippingVip=setOffer(
  "shipoffer_vip_free","action_ship_vip_free",
  "Free standard shipping for VIP customers.",
  offerDefinition({
    customerEligibility:{kind:"LOYALTY_SEGMENT",segmentId:"vip:A",membership:{evaluateAt:"decision_time",bindingRef:"membership:shipping:vip-a:decision"}},
  })
);

export const freeShippingTwoDiningChairs=setOffer(
  "shipoffer_two_chairs_free","action_ship_two_chairs_free",
  "Free standard shipping when purchasing at least two dining chairs.",
  offerDefinition({
    cartRequirements:[{kind:"MIN_QUANTITY",quantity:2,target:{kind:"category",categoryId:"category:dining_chairs"}}],
  })
);

export const freeShippingContribution100=setOffer(
  "shipoffer_contribution_100","action_ship_contribution_100",
  "Free shipping only if post-shipping contribution per order remains at least CAD 100.",
  offerDefinition({}),
  {
    constraints:[{
      constraintId:constraintId("shipping_contribution_per_order_100"),
      constraintClass:"hard",
      expression:{kind:"property_comparison",propertyId:"finance.contribution_per_order_after_shipping_minor",operator:"GTE",value:money(10000)},
    }],
    preconditions:[{
      preconditionId:"shipping_cost_inputs_available",
      expression:{kind:"evidence_available",evidenceRef:"shipping_economics:merchant_cost_inputs"},
      whenUnknown:"unknown_eligibility",
    }],
  }
);

export const temporarySitewideFreeFridayMonday=setOffer(
  "shipoffer_weekend_free","action_ship_weekend_free",
  "Temporary sitewide free standard shipping Friday through Monday.",
  offerDefinition({}),
  {
    timing:{
      decisionTime:DECISION,
      requestedStart:{kind:"known",at:FRIDAY},
      effectiveStart:{kind:"known",at:FRIDAY},
      implementationDelaySeconds:{kind:"known",seconds:0},
    },
    duration:{kind:"temporary",durationSeconds:FOUR_DAYS},
  }
);

export const rollbackTemporaryThreshold=shippingAction({
  actionIdValue:"action_ship_rollback_temp_threshold",
  actionTypeValue:"shipping.rollback_policy",
  target:{kind:"shipping_policy",shippingPolicyId:"shipping_policy:standard_free_threshold"},
  description:"Restore the prior standard free-shipping threshold only if the temporary Action still owns current threshold state.",
  parameters:{
    kind:"shipping_policy_rollback",
    originalActionId:temporaryThreshold150To75.actionId,
    strategy:{kind:"RESTORE_PRE_ACTION_VALUE",preActionThreshold:{kind:"explicit_baseline",value:money(15000)}},
    conflictGuard:{kind:"REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",sourceActionId:temporaryThreshold150To75.actionId,expectedThreshold:money(7500)},
  },
  reversalOfActionId:temporaryThreshold150To75.actionId,
});

export const categoryMixedCartAnyEligible=setOffer(
  "shipoffer_rugs_any_item","action_ship_rugs_any_item",
  "Free shipping for the whole order when any rug is eligible.",
  offerDefinition({products:productScope([{kind:"category",categoryId:"category:rugs"}],{kind:"ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM"},"membership:shipping:rugs:decision")})
);

export const categoryMissingMembership=setOffer(
  "shipoffer_missing_membership","action_ship_missing_membership",
  "Free shipping on a category whose decision-time membership snapshot is unavailable.",
  offerDefinition({products:productScope([{kind:"category",categoryId:"category:missing"}],{kind:"ELIGIBLE_ITEMS_ONLY"},"membership:shipping:missing:decision")})
);

export const shippingClassUnknownOffer=setOffer(
  "shipoffer_classified_free","action_ship_classified_free",
  "Free standard shipping only for products in eligible shipping classes.",
  offerDefinition({products:productScope([{kind:"product",productId:"product:C"}],{kind:"ELIGIBLE_ITEMS_ONLY"},undefined,[{kind:"SHIPPING_CLASS_IN",shippingClassIds:["parcel_standard"]}])})
);

export const freeExpressShipping=setOffer(
  "shipoffer_free_express","action_ship_free_express",
  "Free express shipping.",
  offerDefinition({services:{include:[{kind:"EXPRESS"}],exclude:[],exclusionPrecedence:"EXCLUDE_OVERRIDES_INCLUDE"}})
);

export const flatRateOutdoor10=setOffer(
  "shipoffer_outdoor_flat_10","action_ship_outdoor_flat_10",
  "CAD 10 flat-rate standard shipping on outdoor furniture.",
  offerDefinition({
    benefit:{kind:"FLAT_RATE",customerShippingCharge:money(1000)},
    products:productScope([{kind:"category",categoryId:"category:outdoor_furniture"}],{kind:"ENTIRE_ORDER_IF_ALL_ITEMS_ELIGIBLE"},"membership:shipping:outdoor:decision"),
  })
);

export const shippingCreditProductC20=setOffer(
  "shipoffer_product_c_credit_20","action_ship_product_c_credit_20",
  "CAD 20 shipping credit on Product C.",
  offerDefinition({
    benefit:{kind:"SHIPPING_CREDIT",customerShippingCredit:money(2000)},
    products:productScope([{kind:"product",productId:"product:C"}],{kind:"ELIGIBLE_ITEMS_ONLY"}),
  })
);

export const invalidNegativeThreshold:unknown={
  ...permanentThreshold150To125,
  actionId:"action_ship_invalid_negative_threshold",
  parameters:{
    kind:"shipping_policy_adjustment",
    definition:{
      kind:"FREE_SHIPPING_THRESHOLD",
      service:{kind:"STANDARD"},
      thresholdBasis:"POST_DISCOUNT_SUBTOTAL",
      operation:{kind:"SET",value:{kind:"money",amountMinor:-1,currency:"CAD"}},
      geography:allCanada,
      customerEligibility:allCustomers,
    },
  },
};

export const modifyFreeStandardThresholdOffer=shippingAction({
  actionIdValue:"action_ship_modify_offer",
  actionTypeValue:"shipping.modify_offer",
  target:{kind:"shipping_offer",shippingOfferId:"shipoffer_free_standard_150"},
  description:"Modify an existing shipping offer.",
  parameters:{kind:"shipping_offer_modify",targetShippingOfferId:"shipoffer_free_standard_150",definition:offerDefinition({cartRequirements:[{kind:"MIN_SUBTOTAL",value:money(12500),basis:"POST_DISCOUNT_SUBTOTAL"}]})},
});

export const stopFreeStandardThresholdOffer=shippingAction({
  actionIdValue:"action_ship_stop_offer",
  actionTypeValue:"shipping.stop_offer",
  target:{kind:"shipping_offer",shippingOfferId:"shipoffer_free_standard_150"},
  description:"Stop an existing shipping offer.",
  parameters:{kind:"shipping_offer_stop",targetShippingOfferId:"shipoffer_free_standard_150"},
});
