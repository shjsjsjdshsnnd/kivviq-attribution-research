# Step 9 — Inventory Dynamics Acceptance Report

## Frozen foundation

Step 9 starts from the exact frozen Step 8 head:

`058152b4bacc887063fa8fe5da9018d7a94694dc`

Branch:

`step9/inventory-dynamics`

Draft PR:

`#22`

Steps 1–8 remain frozen and unchanged. Step 9 is opt-in through `enableInventoryDynamics`; when that flag is absent/false, the inherited Step 1–8 execution path remains unchanged.

## Research boundary

Step 9 is PUBLIC and synthetic-only.

It does not access or use:

- private Kivviq implementation;
- Maison Olive data;
- real merchant/customer data;
- production systems;
- credentials;
- production APIs;
- private implementation details.

No optimizer, recommendation policy or autonomous decision agent is introduced.

## Objective

Step 9 makes inventory a dynamic, time-dependent causal economic constraint.

The governing distinction is:

```
latent unconstrained demand
!= inventory-feasible demand
!= fulfilled demand
!= observed booked sales
```

Observed sales are therefore not allowed to overwrite latent product demand merely because stock is unavailable.

## Authoritative inventory state

Every Step 9 SKU/location position has explicit state for:

- physical on-hand units;
- available-to-sell units;
- reserved units;
- committed units;
- damaged/non-sellable units;
- quarantined returned units;
- inbound units;
- explicit backordered obligations;
- safety stock;
- reorder point;
- reorder policy/state;
- expected arrival;
- realized arrival;
- oldest inventory age;
- carrying-cost rate;
- obsolescence rate.

Authoritative physical inventory never becomes negative.

Backorders are explicit obligations rather than negative stock.

The legacy scalar `runtime.inventory` projection is retained only for inherited simulator compatibility and, under Step 9, mirrors non-negative available-to-sell units.

## Reservation semantics

Checkout inventory is reserved through the existing Step 4 event queue.

The declared default reservation timeout is 20 minutes and may be overridden by Step 9 commerce policy.

Reservation behavior is explicit:

1. reservation reduces ATS;
2. another checkout cannot consume the reserved unit;
3. abandonment does not instantly return the unit to ATS;
4. timeout releases the reservation;
5. successful checkout moves reservation → commitment → sale.

The acceptance suite includes a last-unit reservation trap proving that two customers cannot consume the same physical unit.

## Demand truth and stockouts

Step 9 records latent desired-product demand before availability changes the outcome.

A latent request can become:

- immediately available;
- substituted;
- delayed;
- accepted as a backorder;
- permanently lost;
- merchant exit.

God mode preserves requested SKU, fulfilled SKU/substitute, represented weight, commerce outcome and physical fulfillment separately.

This prevents a stockout from being interpreted as a collapse in structural product demand.

## Substitution and complements

Substitution is not a blind redirect.

It uses the frozen product relationship structure plus:

- customer preference;
- category relationship;
- price gap;
- availability;
- urgency;
- merchant/brand affinity.

Substitute economics can differ from the unavailable SKU, so revenue and contribution can move in different directions.

Complement behavior is also explicit: a stockout can abandon complementary items already in cart, so stockout cost can exceed the unavailable SKU's direct lost sale.

## Backorders

Backorders are represented as explicit customer obligations.

A backorder requires the SKU to permit backordering.

Acceptance depends on delay/urgency/customer affinity.

Step 9 distinguishes:

- order booked;
- physical unit not yet fulfilled;
- later supplier fulfillment;
- cancellation before fulfillment.

A later supplier receipt can fulfill the backorder without ever creating negative stock.

A cancelled backorder reduces the obligation but does not manufacture or release nonexistent physical stock.

### Backorder economic-recognition policy

Step 9 declares the research policy:

`book_at_checkout_reverse_cancelled_units_within_horizon`

The order and merchandise revenue are booked at accepted checkout.

If a still-unfulfilled backordered unit cancels during the simulation horizon:

- cancelled merchandise revenue is reversed;
- product COGS is avoided;
- merchant shipping cost is avoided;
- product fulfillment cost is avoided;
- already-incurred payment fees, order-level variable costs and promotion costs remain sunk.

This keeps inventory truth and Step 9 economics aligned without changing frozen Step 7 accounting when Step 9 is disabled.

## Replenishment and reorder policies

Replenishment is endogenous rather than manually injected after a stockout.

Supported policy forms are:

- reorder point;
- order-up-to;
- fixed quantity;
- safety stock;
- minimum order quantity.

The existing Step 4 clock drives:

- reorder checks;
- reorder placement;
- supplier dispatch;
- delay events;
- supplier receipt.

Expected arrival and realized arrival are distinct.

Realized lead time is deterministic conditional on the simulation seed/shared-randomness key and can vary due to:

- merchant inventory profile;
- SKU frozen lead time;
- supplier layer;
- stochastic lead-time variation;
- supplier disruption shocks.

### Supplier provenance

Steps 1–8 do not contain an authoritative supplier entity.

Step 9 therefore adds a deterministic category-derived synthetic supplier layer and labels it:

`supplierSource = "step9_synthetic_supplier_assignment"`

The supplier-specific multiplier operates on top of the frozen per-SKU lead time.

Supplier identity is not promoted into frozen GroundTruth.

## Returns and physical inventory

Step 9 uses the same Step 7 product-return probabilities to drive physical return truth.

A returned unit flows through:

1. customer physical possession;
2. return receipt;
3. quarantine;
4. inspection;
5. damaged/non-sellable classification where applicable;
6. delayed restock;
7. renewed sellability or backorder fulfillment.

Return sampling at checkout is limited to units physically fulfilled at checkout.

An accepted but still-unfulfilled backorder cannot generate a fictional merchandise return.

If a backordered unit is later physically fulfilled, it becomes return-eligible from the actual fulfillment timestamp under the same return model.

Step 7 refund/recovered-COGS economics consume the same physical-return truth when Step 9 is enabled.

## Exact inventory reconciliation

Per SKU, the authoritative physical identity is:

```
opening on-hand
+ supplier receipts
+ physical returns received
+ explicit inventory adjustments/interventions
- physically sold/fulfilled units
- write-offs
= closing on-hand
```

Reservations, commitments, quarantine, damage and backorders are state transfers/obligations; they do not create physical units.

Every inventory movement records:

- movement ID;
- SKU/product;
- timestamp;
- movement type;
- quantity;
- causal/source event;
- before snapshot;
- after snapshot.

Finalization fails loudly if:

- any physical state becomes negative;
- reserved + committed + damaged + quarantined exceeds on-hand;
- per-SKU physical reconciliation does not close exactly.

## Carrying cost, aging and obsolescence

Step 9 models inventory holding economics separately from realized sales accounting.

The evaluator includes:

- inventory book-value-like COGS basis;
- average on-hand carrying cost;
- age of oldest inventory;
- archetype-dependent obsolescence;
- markdown-risk probability;
- expected markdown value drag;
- expected recoverable contribution.

The report keeps separate:

```
realized contribution
!= contribution after inventory carrying cost
!= obsolescence/recoverable-inventory value
```

Obsolescence is not silently mixed into realized sales accounting.

## Days of cover

Step 9 does not emit an ambiguous single cover number.

Each SKU reports named demand denominators:

- `baseline_unconstrained_latent`;
- `observed_fulfilled`;
- `forecast_blend`.

This prevents fulfilled sales during a stockout from mechanically producing a misleading high/low cover signal.

## Low stock and excess stock

Low-stock state uses ATS/safety-stock and lead-time-aware cover.

Excess stock uses declared cover thresholds.

These diagnostics are evaluator/God-mode outputs, not operator-visible future truth.

## Inventory × advertising

Advertising acts through the existing causal channel-delivery/response machinery.

Higher spend can:

- increase exposure;
- accelerate demand;
- accelerate stockout;
- increase substitution/loss;
- consume units baseline/organic demand might otherwise buy later.

The evaluator compares:

- actual inventory-constrained response;
- an evaluator-only unconstrained-inventory counterfactual.

The capacity-relaxed counterfactual is diagnostic only; it is not treated as owned physical inventory.

## Inventory × promotions and pricing

Promotion and price interventions flow through existing Step 7/Step 8 commerce economics.

They can change:

- conversion;
- timing;
- margin;
- inventory depletion;
- later full-price opportunity;
- substitution;
- contribution over the full horizon.

No arbitrary "stockout penalty" is subtracted manually.

Economic effects emerge from the simulated commerce path.

## Opportunity cost

Step 9 separates accounting contribution from intervention opportunity cost.

A transaction can have positive immediate accounting contribution while still destroying value if it consumes scarce inventory that a later higher-value customer would have purchased.

The evaluator provides explicit shared-randomness counterfactual opportunity-cost analysis instead of rewriting transaction accounting.

## Counterfactual contracts

Step 9 provides evaluator-only counterfactuals for:

- unconstrained inventory / lost sales;
- replenishment delay;
- promotion vs full-price horizon;
- inventory-constrained advertising response;
- scarce-inventory opportunity cost.

Factual and counterfactual worlds preserve the same merchant/population and shared-randomness semantics, with only declared descendants of the intervention allowed to diverge.

## Evaluator-only diagnostics

The Step 9 evaluator reports, where defined by the supplied specification and existing frozen contracts:

### Per SKU

- opening inventory;
- closing on-hand;
- closing ATS;
- reserved;
- committed;
- damaged;
- quarantined returns;
- inbound;
- backorders;
- safety stock;
- reorder point/state;
- expected arrival;
- realized arrival;
- synthetic supplier provenance;
- latent demand;
- fulfilled demand;
- substituted demand;
- delayed demand;
- backordered demand;
- permanently lost demand;
- merchant-exit demand;
- named days-of-cover bases;
- low/excess stock;
- stockout occurrence;
- inventory age;
- carrying cost;
- obsolescence loss;
- markdown risk/value drag;
- inventory book value;
- expected recoverable contribution.

### Period / evaluator

- inventory movement ledger;
- physical-return dispositions;
- exact reconciliation;
- booked revenue before backorder cancellations;
- cancellation economics;
- represented revenue after cancellations;
- base contribution;
- carrying-cost-adjusted contribution;
- obsolescence economic loss;
- true simulated stockout probability;
- lost-sales counterfactual;
- replenishment-delay counterfactual;
- promotion-stockout counterfactual;
- inventory-constrained advertising response;
- scarce-inventory opportunity cost.

The user's supplied Step 9 specification ended mid evaluator-report section after “SKU / opening inventory.” This report therefore does not invent unspecified trailing report fields; it documents only fields supported by the explicit earlier requirements and implemented contracts.

## Collection health provenance

Steps 1–8 do not contain authoritative merchant collection membership.

Step 9 therefore aggregates category membership as an explicit synthetic collection proxy:

`collectionSource = "step9_category_proxy"`

Collection health is derived from underlying SKU positions.

The evaluator does not pretend this category proxy is frozen merchant collection truth.

## Schema evolution

The current simulator executes one physical location:

`primary`

The inventory state contract already includes:

- location ID;
- SKU/product identity;
- optional variant ID.

That allows future multi-location/variant work to extend the model without replacing the core inventory state representation.

Step 9 does **not** claim to simulate a full multi-location allocation network yet.

## Information boundary

Inventory truth is God-mode/evaluator infrastructure.

The Operator-safe root API does not export:

- inventory state constructors;
- inventory truth finalizers;
- Step 9 evaluators;
- stockout probability;
- response curves;
- lost-sales counterfactuals;
- replenishment counterfactuals;
- promotion counterfactuals;
- opportunity-cost evaluators;
- adversarial fixtures.

Future realized stockouts, supplier delays, returns, latent demand and counterfactual outcomes therefore cannot enter OperatorInput through the root public surface.

## Deterministic hard traps

### 1. Stockout → observed-demand trap

Deterministic acceptance output:

```
Product A latent demand:                 37,067.09 represented units
Product A fulfilled demand:                 50.99 represented units
Product A substituted demand:           14,888.02 represented units
Product B fulfilled demand:                254.93 represented units
```

Product A's observed fulfillment collapses because supply binds.

Its latent demand remains visible.

The system therefore does not interpret low sales as low product desirability.

### 2. Advertising-scale trap

Historical platform product performance remains attractive:

```
platform product ROAS: 35.7273x
```

The accepted marginal spend block is:

```
Meta spend: 130,000 → 205,000 minor units

unconstrained marginal contribution: +46,545
inventory-constrained marginal contribution: -75,000
```

The exact same spend increase therefore changes sign once scarce inventory is respected.

This is the required adversarial case where “scale the high-ROAS campaign” is wrong because inventory is the binding economic constraint.

### 3. Promotion-stockout trap

Short window:

```
promoted revenue:    10,240,848
full-price revenue:   4,804,994
revenue lift:         5,435,854
```

Full horizon:

```
promoted contribution:   -3,940,810
full-price contribution:   -630,936
contribution delta:       -3,309,874
```

The promotion looks strong on short-window revenue while destroying full-horizon contribution by consuming scarce stock earlier at worse economics.

## Validation

Validated implementation head before acceptance-report packaging:

`642e32ab67e98d293c66a82adcde01757c65f6cc`

GitHub Actions run:

`35549536680`

On that exact head:

- Architecture boundary: PASS
- Strict TypeScript typecheck: PASS
- Full inherited + Step 9 tests: PASS
- Test files: 48 / 48
- Tests: 179 / 179
- Build: PASS

The test workflow runs the full inherited suite plus Step 9 tests with one Vitest worker. No tests are skipped or downgraded; worker serialization prevents Vitest RPC starvation on the hosted runner.

## Research isolation and status

PR #22 remains:

- open;
- draft;
- mergeable;
- unmerged.

No deployment or production change is part of Step 9.
