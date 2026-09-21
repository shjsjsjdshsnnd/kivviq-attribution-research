# Step 9 — Inventory Dynamics

Step 9 turns inventory from a static product attribute into a causal, time-dependent economic constraint.

The governing distinction is:

```
latent unconstrained demand
!= inventory-feasible demand
!= fulfilled demand
!= observed booked sales
```

This module is public, synthetic-only, evaluator/God-mode research. It does not expose future realized inventory, demand, supplier delays, returns or stockouts to an Operator-facing API.

## Frozen boundary

Step 9 is based exactly on frozen Step 8 head:

`058152b4bacc887063fa8fe5da9018d7a94694dc`

The Step 9 feature flag is explicit. When `enableInventoryDynamics` is omitted/false, the frozen Step 1–8 simulation path and legacy scalar inventory projection remain unchanged.

## Authoritative SKU inventory state

For each SKU/location, Step 9 maintains:

- **on-hand** — physical units in merchant possession;
- **reserved** — temporary checkout holds;
- **committed** — physical units allocated between reservation and sale;
- **damaged** — physical non-sellable units;
- **quarantined returns** — returned physical units awaiting inspection/restock;
- **available to sell** — `on-hand - reserved - committed - damaged - quarantined returns`;
- **inbound** — supplier units ordered but not received;
- **backordered** — customer obligations not yet physically fulfilled;
- safety stock;
- reorder point;
- reorder policy/state;
- expected supplier arrival;
- realized supplier arrival.

Backorders are never represented as negative authoritative inventory.

The old `runtime.inventory` map is retained only as a compatibility projection for the frozen inherited simulation path. Under Step 9 it mirrors non-negative available-to-sell units; explicit backorder obligations never make this projection negative.

## Clock and event semantics

All Step 9 lifecycle changes run through the existing Step 4 discrete-event queue. There is no parallel inventory clock.

Events include:

- reservation and reservation expiry;
- commitment and sale;
- reorder check / reorder placement;
- supplier shipment dispatch;
- supplier shipment delay;
- supplier receipt;
- physical return receipt;
- return restock;
- backorder cancellation;
- stockout start/end.

Supplier receipt events can satisfy open backorders before restoring free sellable capacity.

## Reservations

At checkout, currently sellable units can be temporarily reserved.

A reservation:

1. reduces available-to-sell inventory;
2. blocks another customer from consuming the same unit;
3. expires after a declared timeout if checkout does not convert;
4. becomes committed/sold if purchase succeeds.

Abandonment does not magically release inventory immediately; the declared reservation timeout controls release. The simulator default is **20 minutes**, and research callers may override it through the Step 9 commerce policy.

## Demand truth

Product choice under Step 9 is evaluated in two stages.

First the simulator chooses latent desired product using customer preference, structural demand, price/promotion utility, complements and memory **without using availability as the deciding signal**.

Then inventory can transform that demand into:

- immediate availability;
- substitution;
- delayed demand;
- accepted backorder;
- permanent loss;
- merchant exit.

God mode records the requested SKU separately from any fulfilled substitute.

A stockout therefore cannot be interpreted as zero demand merely because observed sales are zero.

## Substitution and complements

Substitution is not an unconditional redirect.

It depends on:

- declared substitute relationships;
- customer product preference;
- category similarity;
- price gap;
- availability;
- urgency;
- merchant/brand affinity.

A substitute can have different price, COGS, shipping and contribution economics, so substitution may lower revenue while raising contribution, or vice versa.

A stockout can also cause abandonment of complementary products already in cart through an explicit mechanism. This makes stockout cost capable of exceeding the unavailable SKU's direct lost revenue.

## Backorders

Backorders are explicit obligations.

A product must permit backordering. Acceptance depends on expected delay, urgency and customer affinity.

Semantics in Step 9:

- the checkout/order can be booked when a customer accepts a backorder;
- the unit is **not** counted as physically fulfilled;
- no negative stock is created;
- the obligation can be fulfilled only by later available stock;
- the obligation can be cancelled before fulfillment.

Step 9 uses a declared accrual-style research policy: the order and merchandise revenue are booked at accepted checkout while physical fulfillment remains separately governed by inventory truth. If a backordered unit cancels before fulfillment within the simulation horizon, its merchandise revenue is reversed and its product-level COGS, merchant shipping and fulfillment costs are avoided. Payment fees, order-level variable costs and promotional costs already incurred at booking remain sunk. A later step may add working-capital/cash-recognition timing without changing the inventory identity.

## Replenishment

Replenishment is endogenous.

Supported policy forms:

- reorder point;
- order-up-to;
- fixed quantity;
- safety stock;
- minimum order quantity.

Expected supplier lead time is distinct from realized lead time. Steps 1–8 contain no authoritative supplier entity, so Step 9 deterministically assigns category-derived synthetic supplier IDs and labels them `supplierSource = "step9_synthetic_supplier_assignment"`. A supplier-specific multiplier is applied on top of the frozen per-SKU lead time; this creates merchant/SKU/category/supplier/inventory-profile variation without pretending the supplier identity is merchant truth.

Realized lead time is deterministic conditional on the simulation seed/shared-randomness key and may differ further by inventory profile and supplier disruption shock.

A delayed receipt propagates through the normal commerce system:

`delay -> longer stockout -> substitution/loss/backorder -> changed channel/promotion economics -> changed contribution`

There is no generic manually subtracted delay cost.

## Returns

When Step 9 is enabled, Step 7's product return probabilities feed the same physical return process used by inventory. Return sampling at checkout is limited to units that were physically fulfilled at checkout; an accepted but still-unfulfilled backorder cannot generate a fictional merchandise return.

A realized return:

1. enters physical on-hand inventory in a quarantine bucket;
2. can be classified as damaged/non-sellable;
3. becomes available only after a separate restock event;
4. can then satisfy an open backorder or future purchase.

Step 7 refund/recovered-COGS economics consume the same realized physical-return truth. This prevents economic returns and inventory returns from disagreeing about which units came back.

Rare Step 7 `non_return_refund` behavior remains part of frozen Step 7 when Step 9 is disabled; Step 9's shared physical-return path models returned merchandise only.

## Exact reconciliation

Per SKU, physical stock reconciles as:

```
opening on-hand
+ supplier receipts
+ physical returns received
+ explicit inventory adjustments/interventions
- physically sold/fulfilled units
- write-offs
= closing on-hand
```

Reservations, commitments, quarantine and damage move units between states but do not create stock.

Every movement records:

- movement id;
- SKU/product;
- timestamp;
- movement type;
- quantity;
- causal/source event;
- before snapshot;
- after snapshot.

Finalization throws if any SKU fails reconciliation or violates non-negativity/subset invariants.

## Carrying cost, aging and obsolescence

Carrying cost is modeled as a rate per COGS value per day and lowers Step 9 economic contribution.

Inventory age is retained where the merchant archetype makes it meaningful.

Obsolescence is reported separately as loss in expected recoverable inventory value. It is deliberately not silently mixed into realized sales accounting.

This keeps:

```
realized contribution
!= carrying-cost-adjusted contribution
!= recoverable inventory value
```

## Days of cover

Step 9 never emits one ambiguous days-of-cover metric.

The evaluator reports separate cover values based on:

- baseline unconstrained latent demand;
- observed fulfilled demand;
- a declared forecast blend.

The denominator is always named.

## Inventory × marketing

Advertising, promotions and pricing act through the existing commerce simulation.

They can accelerate stockout, change substitution and consume scarce units that baseline/organic demand might have purchased later.

The evaluator can compare:

- actual inventory-constrained response;
- an evaluator-only unconstrained-inventory counterfactual.

The unconstrained diagnostic does not treat the synthetic capacity relaxation as real owned inventory carrying cost. It exists to isolate the inventory constraint.

## Opportunity cost

Accounting profit from a scarce unit and intervention value are separate.

A discounted paid-acquisition sale can have positive order contribution while being economically inferior to the shared-randomness counterfactual where the same scarce stock remains available for later higher-margin demand.

Step 9 therefore exposes explicit counterfactual opportunity-cost evaluation rather than rewriting accounting profit.

## Evaluator-only diagnostics

The Step 9 package provides God-mode research diagnostics for:

- low stock;
- excess stock;
- safety stock / reorder state;
- inbound units;
- backorders;
- stockout occurrence;
- true simulated stockout probability across seeds;
- latent demand;
- fulfilled demand;
- substituted demand;
- delayed demand;
- permanently lost demand;
- merchant-exit demand;
- multiple days-of-cover bases;
- carrying cost;
- inventory age;
- obsolescence value loss;
- book-value-like COGS basis;
- expected recoverable contribution;
- collection-level inventory health;
- lost-sales counterfactual;
- replenishment-delay counterfactual;
- promotion-stockout counterfactual;
- inventory-constrained advertising response curve.

These are not exported from the Operator-safe root API.

## Schema evolution

The current simulator uses one location, `primary`, but inventory positions have a location id and SKU/optional variant identity so multi-location/variant expansion does not require replacing the inventory state model.

Collections do not own inventory. Steps 1–8 did not establish authoritative merchant collection membership, so Step 9 aggregates underlying SKU **category** membership as an explicitly labeled synthetic proxy: `collectionSource = "step9_category_proxy"`. It does not pretend category membership is frozen merchant collection truth.

## Acceptance traps

Step 9 includes deterministic acceptance worlds for:

1. **Stockout -> observed demand trap** — Product A sells out, A observed fulfillment collapses, substitute B gains fulfillment, while A latent demand remains visible.
2. **Advertising scale trap** — platform product ROAS can remain attractive while a spend increase has positive unconstrained marginal contribution but negative inventory-constrained marginal contribution.
3. **Promotion stockout trap** — a promotion can raise short-window revenue while lowering full-horizon contribution because it accelerates scarce inventory consumption that would otherwise sell later at better economics.

All counterfactuals use the same world/population and shared simulation randomness.
