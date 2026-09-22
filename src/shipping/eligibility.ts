import type {
  Action,
  ShippingGeographySelector,
  ShippingProductSelector,
  ShippingServiceSelector,
} from "../action_ontology/types.js";
import type {
  ShippingCartLine,
  ShippingEligibilityContext,
  ShippingEligibilityDecision,
  ShippingGeographyFacts,
  ShippingProductFacts,
} from "./types.js";

type Tri = true | false | "unknown";

function productMatch(selector: ShippingProductSelector, product: ShippingProductFacts | undefined): Tri {
  if (!product) return "unknown";
  switch(selector.kind){
    case "sku": return product.skuId===undefined?"unknown":product.skuId===selector.skuId;
    case "product": return product.productId===undefined?"unknown":product.productId===selector.productId;
    case "category": return product.categoryIds===undefined?"unknown":product.categoryIds.includes(selector.categoryId);
    case "collection": return product.collectionIds===undefined?"unknown":product.collectionIds.includes(selector.collectionId);
    case "product_set": return product.productSetIds===undefined?"unknown":product.productSetIds.includes(selector.productSetId);
    case "brand": return product.brandId===undefined?"unknown":product.brandId===selector.brandId;
  }
}

function geoMatch(selector:ShippingGeographySelector,facts:ShippingGeographyFacts|undefined):Tri{
  if(!facts) return "unknown";
  switch(selector.kind){
    case "COUNTRY": return facts.countryCode===undefined?"unknown":facts.countryCode===selector.countryCode;
    case "PROVINCE_STATE":
      if(facts.countryCode===undefined||facts.regionCode===undefined) return "unknown";
      return facts.countryCode===selector.countryCode&&facts.regionCode===selector.regionCode;
    case "SHIPPING_ZONE": return facts.shippingZoneIds===undefined?"unknown":facts.shippingZoneIds.includes(selector.shippingZoneId);
    case "MERCHANT_SHIPPING_ZONE": return facts.merchantShippingZoneIds===undefined?"unknown":facts.merchantShippingZoneIds.includes(selector.shippingZoneId);
    case "POSTAL_REGION": return facts.postalRegionIds===undefined||facts.countryCode===undefined?"unknown":facts.countryCode===selector.countryCode&&facts.postalRegionIds.includes(selector.postalRegionId);
  }
}

function serviceKey(s:ShippingServiceSelector):string{return s.kind==="CUSTOM"?"CUSTOM:"+s.serviceId:s.kind;}
function serviceMatch(a:ShippingServiceSelector,b:ShippingServiceSelector):boolean{return serviceKey(a)===serviceKey(b);}

function quantityFor(selector:ShippingProductSelector, lines:readonly ShippingCartLine[]):number|"unknown"{
  let q=0, unknown=false;
  for(const line of lines){const m=productMatch(selector,line);if(m===true)q+=line.quantity;else if(m==="unknown")unknown=true;}
  return q>0?q:(unknown?"unknown":0);
}

function evaluateProductScope(action:Action,ctx:ShippingEligibilityContext):ShippingEligibilityDecision|undefined{
  if(action.parameters.kind!=="shipping_offer_set"&&action.parameters.kind!=="shipping_offer_modify") return;
  const p=action.parameters.definition.products;
  if(!p) return;
  if(p.membership?.bindingRef && !ctx.availableMembershipBindingRefs?.includes(p.membership.bindingRef)){
    return {status:"unknown",reasonCodes:["SHIPPING_MEMBERSHIP_SNAPSHOT_UNAVAILABLE"],missingInformation:[p.membership.bindingRef]};
  }
  const inc=p.include.map(s=>productMatch(s,ctx.product));
  if(!inc.includes(true)) return inc.includes("unknown")
    ?{status:"unknown",reasonCodes:["SHIPPING_PRODUCT_MEMBERSHIP_UNKNOWN"],missingInformation:["product membership"]}
    :{status:"ineligible",reasonCodes:["PRODUCT_NOT_INCLUDED"],missingInformation:[]};
  const exc=p.exclude.map(s=>productMatch(s,ctx.product));
  if(exc.includes(true)) return {status:"ineligible",reasonCodes:["PRODUCT_EXCLUDED"],missingInformation:[]};
  if(exc.includes("unknown")) return {status:"unknown",reasonCodes:["SHIPPING_PRODUCT_EXCLUSION_UNKNOWN"],missingInformation:["product exclusion"]};
  for(const condition of p.conditions){
    if(condition.kind==="NOT_OVERSIZED"){
      if(ctx.product?.oversized===undefined)return {status:"unknown",reasonCodes:["OVERSIZED_CLASSIFICATION_UNKNOWN"],missingInformation:["oversized classification"]};
      if(ctx.product.oversized)return {status:"ineligible",reasonCodes:["OVERSIZED_PRODUCT"],missingInformation:[]};
    } else if(condition.kind==="NOT_FREIGHT_ONLY"){
      if(ctx.product?.freightOnly===undefined)return {status:"unknown",reasonCodes:["FREIGHT_CLASSIFICATION_UNKNOWN"],missingInformation:["freight classification"]};
      if(ctx.product.freightOnly)return {status:"ineligible",reasonCodes:["FREIGHT_ONLY_PRODUCT"],missingInformation:[]};
    } else if(condition.kind==="NOT_WHITE_GLOVE_ONLY"){
      if(ctx.product?.whiteGloveOnly===undefined)return {status:"unknown",reasonCodes:["WHITE_GLOVE_CLASSIFICATION_UNKNOWN"],missingInformation:["white-glove classification"]};
      if(ctx.product.whiteGloveOnly)return {status:"ineligible",reasonCodes:["WHITE_GLOVE_ONLY_PRODUCT"],missingInformation:[]};
    } else {
      if(ctx.product?.shippingClassIds===undefined)return {status:"unknown",reasonCodes:["SHIPPING_CLASS_UNKNOWN"],missingInformation:["shipping class"]};
      if(!ctx.product.shippingClassIds.some(id=>condition.shippingClassIds.includes(id))) return {status:"ineligible",reasonCodes:["SHIPPING_CLASS_NOT_ELIGIBLE"],missingInformation:[]};
    }
  }
}

function evaluateCustomer(action:Action,ctx:ShippingEligibilityContext):ShippingEligibilityDecision|undefined{
  if(action.parameters.kind!=="shipping_offer_set"&&action.parameters.kind!=="shipping_offer_modify") return;
  const rule=action.parameters.definition.customerEligibility;
  if(rule.kind==="ALL_CUSTOMERS") return;
  if(!ctx.customer)return {status:"unknown",reasonCodes:["CUSTOMER_CLASSIFICATION_UNKNOWN"],missingInformation:["customer classification"]};
  if(rule.kind==="NEW_CUSTOMERS"){
    if(ctx.customer.lifecycle===undefined)return {status:"unknown",reasonCodes:["CUSTOMER_LIFECYCLE_UNKNOWN"],missingInformation:["customer lifecycle"]};
    return ctx.customer.lifecycle==="new"?undefined:{status:"ineligible",reasonCodes:["NOT_NEW_CUSTOMER"],missingInformation:[]};
  }
  if(rule.kind==="RETURNING_CUSTOMERS"){
    if(ctx.customer.lifecycle===undefined)return {status:"unknown",reasonCodes:["CUSTOMER_LIFECYCLE_UNKNOWN"],missingInformation:["customer lifecycle"]};
    return ctx.customer.lifecycle==="returning"?undefined:{status:"ineligible",reasonCodes:["NOT_RETURNING_CUSTOMER"],missingInformation:[]};
  }
  const ids=rule.kind==="CUSTOMER_SEGMENT"?ctx.customer.segmentIds:ctx.customer.loyaltySegmentIds;
  if(ids===undefined)return {status:"unknown",reasonCodes:["CUSTOMER_SEGMENT_UNKNOWN"],missingInformation:[rule.segmentId]};
  return ids.includes(rule.segmentId)?undefined:{status:"ineligible",reasonCodes:["CUSTOMER_SEGMENT_NOT_ELIGIBLE"],missingInformation:[]};
}

function evaluateGeography(action:Action,ctx:ShippingEligibilityContext):ShippingEligibilityDecision|undefined{
  const def=action.parameters.kind==="shipping_offer_set"||action.parameters.kind==="shipping_offer_modify"?action.parameters.definition:
    action.parameters.kind==="shipping_policy_adjustment"?action.parameters.definition:undefined;
  if(!def)return;
  const inc=def.geography.include.map(s=>geoMatch(s,ctx.geography));
  if(!inc.includes(true))return inc.includes("unknown")?{status:"unknown",reasonCodes:["GEOGRAPHY_UNKNOWN"],missingInformation:["geography"]}:{status:"ineligible",reasonCodes:["GEOGRAPHY_NOT_INCLUDED"],missingInformation:[]};
  const exc=def.geography.exclude.map(s=>geoMatch(s,ctx.geography));
  if(exc.includes(true))return {status:"ineligible",reasonCodes:["GEOGRAPHY_EXCLUDED"],missingInformation:[]};
  if(exc.includes("unknown"))return {status:"unknown",reasonCodes:["GEOGRAPHY_EXCLUSION_UNKNOWN"],missingInformation:["geography exclusion"]};
}

export function evaluateShippingEligibility(action:Action,ctx:ShippingEligibilityContext):ShippingEligibilityDecision{
  if(!["shipping.set_offer","shipping.modify_offer"].includes(action.actionType)){
    return {status:"ineligible",reasonCodes:["NOT_SHIPPING_OFFER_ELIGIBILITY_ACTION"],missingInformation:[]};
  }
  if(action.parameters.kind!=="shipping_offer_set"&&action.parameters.kind!=="shipping_offer_modify"){
    return {status:"ineligible",reasonCodes:["INVALID_SHIPPING_PARAMETERS"],missingInformation:[]};
  }
  const geo=evaluateGeography(action,ctx); if(geo)return geo;
  const def=action.parameters.definition;
  if(!ctx.selectedService)return {status:"unknown",reasonCodes:["SHIPPING_SERVICE_UNKNOWN"],missingInformation:["shipping service"]};
  const included=def.services.include.some(s=>serviceMatch(s,ctx.selectedService!));
  if(!included)return {status:"ineligible",reasonCodes:["SHIPPING_SERVICE_NOT_INCLUDED"],missingInformation:[]};
  if(def.services.exclude.some(s=>serviceMatch(s,ctx.selectedService!)))return {status:"ineligible",reasonCodes:["SHIPPING_SERVICE_EXCLUDED"],missingInformation:[]};
  const prod=evaluateProductScope(action,ctx); if(prod)return prod;
  const customer=evaluateCustomer(action,ctx); if(customer)return customer;

  for(const req of def.cartRequirements){
    if(!ctx.cart)return {status:"unknown",reasonCodes:["CART_UNKNOWN"],missingInformation:["cart"]};
    if(req.kind==="MIN_SUBTOTAL"){
      const value=req.basis==="PRE_DISCOUNT_SUBTOTAL"?ctx.cart.preDiscountSubtotal:req.basis==="POST_DISCOUNT_SUBTOTAL"?ctx.cart.postDiscountSubtotal:ctx.cart.qualifyingProductSubtotal;
      if(!value)return {status:"unknown",reasonCodes:["QUALIFYING_SUBTOTAL_UNKNOWN"],missingInformation:[req.basis]};
      if(value.currency!==req.value.currency)return {status:"unknown",reasonCodes:["CART_CURRENCY_MISMATCH"],missingInformation:["approved currency conversion"]};
      if(value.amountMinor<req.value.amountMinor)return {status:"ineligible",reasonCodes:["SHIPPING_THRESHOLD_NOT_MET"],missingInformation:[]};
    } else if(req.kind==="MIN_QUANTITY"){
      const q=req.target?quantityFor(req.target,ctx.cart.lines):ctx.cart.lines.reduce((s,l)=>s+l.quantity,0);
      if(q==="unknown")return {status:"unknown",reasonCodes:["CART_TARGET_UNKNOWN"],missingInformation:["cart target membership"]};
      if(q<req.quantity)return {status:"ineligible",reasonCodes:["MIN_QUANTITY_NOT_MET"],missingInformation:[]};
    } else {
      const q=quantityFor(req.target,ctx.cart.lines);
      if(q==="unknown")return {status:"unknown",reasonCodes:["REQUIRED_TARGET_UNKNOWN"],missingInformation:["required target"]};
      if(q<req.quantity)return {status:"ineligible",reasonCodes:["REQUIRED_TARGET_NOT_PRESENT"],missingInformation:[]};
    }
  }

  if(def.products&&ctx.cart){
    const matches=ctx.cart.lines.map(l=>def.products!.include.some(s=>productMatch(s,l)===true)&&!def.products!.exclude.some(s=>productMatch(s,l)===true));
    const m=def.products.mixedCart;
    if(m.kind==="ENTIRE_ORDER_IF_ALL_ITEMS_ELIGIBLE"&&matches.some(v=>!v))return {status:"ineligible",reasonCodes:["MIXED_CART_HAS_INELIGIBLE_ITEM"],missingInformation:[]};
    if(m.kind==="ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM"&&!matches.some(Boolean))return {status:"ineligible",reasonCodes:["MIXED_CART_NO_ELIGIBLE_ITEM"],missingInformation:[]};
    if(m.kind==="QUALIFYING_SUBTOTAL_THRESHOLD"){
      const q=ctx.cart.qualifyingProductSubtotal;
      if(!q)return {status:"unknown",reasonCodes:["QUALIFYING_SUBTOTAL_UNKNOWN"],missingInformation:["qualifying product subtotal"]};
      if(q.currency!==m.threshold.currency)return {status:"unknown",reasonCodes:["CART_CURRENCY_MISMATCH"],missingInformation:["approved currency conversion"]};
      if(q.amountMinor<m.threshold.amountMinor)return {status:"ineligible",reasonCodes:["QUALIFYING_SUBTOTAL_NOT_MET"],missingInformation:[]};
    }
  }

  for(const constraint of action.constraints){
    if(constraint.constraintClass!=="hard")continue;
    const state=ctx.hardConstraintResults?.[constraint.constraintId];
    if(state==="violated")return {status:"ineligible",reasonCodes:["HARD_CONSTRAINT_VIOLATED:"+constraint.constraintId],missingInformation:[]};
    if(state===undefined||state==="unknown")return {status:"unknown",reasonCodes:["HARD_CONSTRAINT_UNKNOWN:"+constraint.constraintId],missingInformation:[constraint.constraintId]};
  }
  return {status:"eligible",reasonCodes:[],missingInformation:[]};
}
