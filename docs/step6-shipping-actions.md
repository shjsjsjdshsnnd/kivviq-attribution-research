# Phase 2 — Action Space
## Step 6 — Shipping Actions

## Governing principle

Shipping is a canonical business intervention with explicit customer-facing economics, scope, geography, service eligibility, timing and rollback semantics. It is not prose saying to offer free shipping.

Step 6 advances Action schema to 1.4.0 while preserving genuine 1.0/1.1/1.2/1.3 Actions.

## Offer versus policy

`shipping.set_offer`, `shipping.modify_offer` and `shipping.stop_offer` operate on stable `shipoffer_*` overlay identities. Offer termination means DEACTIVATE_SHIPPING_OFFER and does not mutate regular price or underlying shipping policy.

`shipping.adjust_policy` changes the underlying free-shipping threshold policy. Temporary underlying policy changes require conflict-safe rollback. `shipping.rollback_policy` is first-class readiness language and must reference the original Action.

## Benefits and service scope

Structured benefits include FREE_SHIPPING, FLAT_RATE customer shipping charge and SHIPPING_CREDIT. Service scope explicitly distinguishes STANDARD, EXPRESS, OVERSIZED, WHITE_GLOVE, LOCAL_DELIVERY and custom service identities. Free standard shipping never implies premium services are free.

## Thresholds

Underlying threshold policy uses canonical SET / DELTA / MULTIPLY money operations with explicit currency and baseline. Threshold basis is explicit: PRE_DISCOUNT_SUBTOTAL, POST_DISCOUNT_SUBTOTAL or QUALIFYING_PRODUCT_SUBTOTAL. Missing relative baseline is never guessed.

## Product and mixed-cart scope

Shipping product scope reuses canonical SKU/product/category/collection/product-set/brand selectors with INCLUDE/EXCLUDE precedence. Mutable taxonomy scopes require decision/translation/effective membership semantics. Mixed-cart behavior is explicit: ENTIRE_ORDER_IF_ANY_ELIGIBLE_ITEM, ENTIRE_ORDER_IF_ALL_ITEMS_ELIGIBLE, ELIGIBLE_ITEMS_ONLY, or QUALIFYING_SUBTOTAL_THRESHOLD.

## Geography and customer eligibility

Geography supports country, province/state, shipping zone, postal region and merchant-defined shipping zone, with deterministic exclusions. Customer rules support ALL, NEW, RETURNING, CUSTOMER_SEGMENT and LOYALTY_SEGMENT with tri-state eligibility.

## Product shipping classification

Conditions support NOT_OVERSIZED, NOT_FREIGHT_ONLY, NOT_WHITE_GLOVE_ONLY and SHIPPING_CLASS_IN. Missing classification produces unknown, not guessed eligibility.

## Cart/order requirements

Structured cart requirements include minimum subtotal with explicit basis/currency, minimum quantity and required product/category selectors.

## Economics

Customer shipping charge and merchant shipping cost remain separate concepts. Shipping safeguards use precise metrics such as finance.contribution_per_order_after_shipping_minor and finance.contribution_margin_rate_after_shipping. Missing fulfillment/shipping evidence remains unknown eligibility.

## Rollback

Temporary policy changes support RESTORE_PRE_ACTION_VALUE and SET_EXPLICIT_VALUE with REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT. A later legitimate threshold decision causes CONFLICT rather than being overwritten by an expired earlier temporary Action.

## Conflicts

Offers declare COEXIST or NON_STACKABLE and conflict resolution NONE, PRECEDENCE, BEST_BENEFIT or MUTUALLY_EXCLUSIVE_GROUP. The shipping module assesses structured conflict semantics but does not implement checkout.

## Step 2 translation

The current simulator has no native shipping offer, shipping deactivation or threshold intervention. All Step 6 shipping Actions therefore return explicit UNSUPPORTED_SIMULATOR_CAPABILITY. They are never translated into product price, promotion discount or negative price interventions.

## Information boundary

Shipping rejects embedded expected conversion/AOV/revenue/profit/orders/shipping-cost fields, predicted demand/abandonment reduction, future cart/shipping cost, counterfactual revenue, recommendation score and confidence score. Approved current facts enter only through eligibility/constraint/translation contexts.

## Representative fixtures

Fixtures cover sitewide free standard shipping; CAD 150 threshold; permanent 150→125 threshold; temporary 150→75 threshold; rugs/collection/product offers; Canada excluding remote zones; standard excluding white glove; VIP customers; two dining chairs; post-shipping contribution safeguard; Friday–Monday free shipping; safe rollback/conflict; mixed cart; missing membership; unknown shipping class; express; flat-rate; shipping credit; invalid negative threshold; MODIFY and STOP.

## Non-scope

No shipping optimization, carrier selection, fulfillment routing, rate shopping, demand forecast, recommendation ranking, Shopify execution or Growth Operator decision policy is built.