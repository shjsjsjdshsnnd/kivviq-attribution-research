# Phase 2 — Action Space
## Step 8 — Inventory Actions

## Governing principle

Inventory is structured business language for procurement, inventory policy, protection/reservation and deliberate stock disposition. It is not prose saying to order more or clear stock, and it does not secretly mutate paid media, pricing, promotions or merchandising.

Step 8 advances Action schema to 1.6.0 while preserving genuine 1.0–1.5 Actions.

## Action family

New canonical Actions include inventory.reorder, inventory.adjust_reorder_quantity, inventory.adjust_reorder_timing, inventory.set_safety_stock, inventory.set_reorder_point, inventory.protect_inventory, inventory.set_backorder_policy, inventory.clearance, inventory.accelerate_excess_stock and inventory.rollback_policy.

## Physical procurement versus receipt

inventory.reorder is an instantaneous merchant purchase-order decision. It carries SKU, quantity, supplier relationship, destination location, placement time, requested delivery date, known lead-time assumption, expected arrival derived from that assumption, supplier constraints and known procurement economics where available.

Reorder never means stock is received immediately. Actual future receipt information is forbidden from the Action.

## Reorder quantity and timing

Reorder quantity preserves SET, DELTA and MULTIPLY quantity semantics. Relative changes require explicit baseline/reference. Supplier minimum quantity, order multiple and maximum quantity are machine validated; quantities are never silently rounded.

Reorder timing distinguishes SET_DATE, DELTA_DAYS and INVENTORY_TRIGGER. Relative date moves use a typed planned-reorder reference rather than abusing scalar ReferenceValue.

## Lead time and procurement economics

Lead-time assumptions require positive duration and decision-time sourceRef. Expected arrival, when supplied, must equal order placement plus the known lead-time assumption. Future realized supplier delay is forbidden.

Known unit procurement cost, freight/fixed order cost and minimum order value use explicit money/currency. Unit cost × quantity may produce deterministic inventory commitment; this is committed capital exposure, not expected profit.

## Inventory policy

Safety stock and reorder point remain separate policy types. Both use SET / DELTA / MULTIPLY unit operations and do not mutate ON_HAND.

Temporary safety-stock/reorder-point/backorder changes require conflict-safe inventory rollback metadata.

## Protection / reservation

Inventory protection is a business control, not an implicit demand-suppression tactic. RESERVE_QUANTITY explicitly moves availability from AVAILABLE_TO_SELL to RESERVED without changing ON_HAND. Protection can reference coordinated canonical Actions through action IDs, preserving cross-family causal identity.

## Backorders

Backorder policy supports ALLOW, DISALLOW, ALLOW_WITH_LIMIT and ALLOW_UNTIL_DATE. Customer promise and geographic scope are separate references. Missing limits remain distinct from zero.

## Clearance and excess-stock acceleration

Clearance and acceleration are inventory strategy Actions, not hidden price/promotion/media/merchandising mutations. Category/collection strategies require explicit membership binding. Acceleration carries present-state starting condition and explicit inventory/date/condition termination; predicted sell-through is forbidden.

## Locations and suppliers

Canonical inventory_location, supplier_relationship and inventory_set identities are available. Reorders preserve destination warehouse/location and supplier relationship; inventory is never assumed globally fungible.

## Eligibility

Operator-safe inventory eligibility uses current supplier availability, warehouse capacity, available-to-sell, membership snapshots, present inventory levels and hard constraints. Missing facts remain eligible/ineligible/unknown rather than being guessed.

## Rollback

Inventory rollback supports RESTORE_PRE_ACTION_VALUE and SET_EXPLICIT_VALUE for scalar policy values and structured backorder policy. REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT prevents expiry of an earlier temporary policy from overwriting a later legitimate policy change.

## TranslationContext

TranslationContext advances to 1.4.0 with optional current inventoryStateBindings: on-hand, available-to-sell, reserved, safety stock, reorder point, reorder quantity/date, backorder policy, open POs, supplier availability/constraints, location capacity and known lead time. Forecast/future realized/counterfactual fields are rejected.

## Conservative Step 2 translation

The current simulator has no semantically correct outstanding purchase-order/receipt, safety-stock, reservation, backorder, clearance or inventory-strategy intervention. Every new Step 8 inventory Action therefore returns UNSUPPORTED_SIMULATOR_CAPABILITY.

In particular, reorder 100 units is never translated to on_hand += 100. Inventory Actions are not approximated through future demand, conversion propensity, advertising spend, product price, merchandising or promotion changes.

## Fixtures

Fixtures cover delayed SKU reorder with supplier/location economics; invalid order multiple; reorder quantity SET/DELTA/MULTIPLY; reorder timing date/delta/inventory trigger; safety stock SET/DELTA/MULTIPLY; reorder point; protection/reservation; ALLOW/limited/date-bounded backorders; SKU/collection clearance; SKU/collection excess acceleration; temporary safety-stock and structured backorder rollback; and compound inventory-protection readiness.

## Information boundary

Inventory rejects expected/forecast demand, expected units sold, predicted stockout/sell-through/supplier delay, future inventory/sales/returns, expected revenue/profit/margin, counterfactual inventory/revenue, recommendation score and confidence score.

## Non-scope

No inventory optimizer, demand forecaster, dynamic safety-stock calculation, purchasing automation, supplier integration, fulfillment execution, recommendation ranking or Growth Operator decision policy is built.