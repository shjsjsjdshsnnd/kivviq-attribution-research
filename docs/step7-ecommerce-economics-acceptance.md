# Step 7 — Ecommerce Economics Acceptance Report

## Frozen foundations

Step 7 starts from the exact frozen Step 6 head:

`04e92f05364578c9b92358c887c9f316e5419a42`

Frozen references:

- Step 1 — GroundTruth: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — merchant/world generation: `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — latent customer population: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- Step 4 — customer journey simulation: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`
- Step 5 — advertising economics: `23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`
- Step 6 — cross-channel interactions: `04e92f05364578c9b92358c887c9f316e5419a42`

Steps 1–6 remain authoritative and unchanged.

## Canonical economic waterfall

Step 7 implements one authoritative ecommerce waterfall aligned with the frozen Step 1 contribution-profit semantics:

```
Gross merchandise revenue
- discounts
= revenue after discounts

- returns / refunds
= net revenue

- COGS
= gross profit

- payment fees
- shipping subsidy
- fulfillment cost
- variable operating costs
- promotional costs
- advertising cost

= contribution profit
```

Advertising cost is authoritative at the period level only.

Order-level advertising allocation is deliberately `null`, preventing advertising from being subtracted both per order and again at period level.

## Integer money and reconciliation

Economic money amounts are represented in integer minor currency units wherever practical.

Order/period calculations use explicit rounding and safe-integer checks.

The test suite requires exact period reconciliation under the declared accounting identity.

## Order-level economics

Every realized purchase can be transformed into a complete order ledger containing:

- gross merchandise revenue;
- discounts;
- revenue after discounts;
- realized returns/refunds;
- net revenue;
- COGS;
- gross profit;
- payment fees;
- customer shipping revenue;
- merchant shipping cost;
- shipping subsidy;
- fulfillment cost;
- variable operating costs;
- promotional costs;
- contribution profit before advertising.

Advertising is reconciled later at the period level.

## Product-level economics

Each synthetic product receives an economic profile containing:

- list price;
- COGS per unit;
- gross margin;
- shipping cost;
- fulfillment cost;
- return probability;
- return shipping/handling/restocking costs;
- non-recoverable inventory-value rate;
- oversized-item status;
- promotion sensitivity;
- substitution products;
- complementary products.

COGS is derived coherently from generated margin economics rather than independently contradicting margin.

The test suite verifies substantial product-margin heterogeneity.

## Discounts and promotion costs

Price discount is represented above the revenue line.

Separate promotion costs can include:

- gift-with-purchase cost;
- loyalty credit;
- coupon operational cost.

Price discount is not counted again as promotional cost.

## Shipping economics

Step 7 explicitly distinguishes:

- customer shipping revenue;
- merchant shipping cost;
- shipping subsidy.

```
shipping subsidy =
merchant shipping cost
- customer shipping revenue
```

Negative shipping subsidy is supported when customer shipping revenue exceeds merchant cost.

Free-shipping thresholds affect behavioral conversion/basket mechanics before purchase and are not applied as final-revenue edits.

## Payment / fulfillment / variable operating costs

Payment economics support:

- percentage fee;
- fixed per-transaction fee.

Fulfillment economics vary through order/product economics.

Variable operating costs can include:

- per-order component;
- revenue-rate component.

Fixed corporate overhead is not included.

## Returns / refunds

Returns are simulated as delayed post-purchase economic events.

Return probability can vary by product and customer context through the synthetic economic profiles.

Supported outcomes include:

- return + refund;
- partial refund;
- non-return refund.

Multi-item orders can have partial line returns.

Return economics explicitly track:

- refunded revenue;
- recovered COGS;
- return shipping cost;
- handling cost;
- restocking cost;
- non-recoverable inventory cost;
- contribution-profit impact.

Returns occurring after the report-period cutoff are not prematurely recognized.

## Product relationships and baskets

Step 7 enables enhanced basket economics in the Step 4 simulation.

Orders can contain:

- multiple products;
- multiple units;
- complementary products;
- substitution products.

Step 2 complement/substitution relationships affect basket construction rather than random extra-line injection.

## Inventory lifecycle

Step 7 extends inventory execution to support:

- on-hand stock;
- stockout;
- lost demand;
- substitution;
- explicit backorder;
- supplier lead time;
- recurring replenishment.

Sales beyond on-hand inventory are only allowed for products explicitly configured for backorder behavior.

A frozen Step 1 `inventory.available` intervention is authoritative over both replenishment and backorder behavior.

## Inventory opportunity cost

Evaluator-only inventory opportunity analysis keeps two concepts separate:

- accounting contribution;
- counterfactual economic opportunity cost.

Opportunity cost is never inserted as an accounting ledger expense.

## Pricing economics

Price interventions propagate through existing Step 2/4 elasticity and product-choice mechanisms.

Deterministic fixtures demonstrate both possible outcomes:

- low-elasticity price increase: orders fall while revenue and contribution profit increase;
- high-elasticity price increase: orders collapse and contribution economics deteriorate.

## Discount trap

The deterministic promotion fixture produces:

```
promotion represented orders:       1,930.4
no-promotion represented orders:      558.8

promotion net revenue:            22,845,548 minor units
no-promotion net revenue:          6,270,524 minor units

promotion contribution profit:    -6,280,081 minor units
no-promotion contribution profit:   -75,012 minor units
```

Promotion materially raises orders and revenue while making contribution profit materially worse.

Revenue maximization and profit maximization therefore disagree.

## Promotion pull-forward

A shared-randomness replenishment fixture requires:

- higher revenue during the promotion window;
- lower post-promotion revenue than control.

The later dip arises through customer need/purchase timing rather than a manually subtracted revenue adjustment.

## Promotion × advertising trap

The synthetic discount world contains a typed state-dependent promotion × Meta channel-response interaction through the frozen Step 1 causal graph.

Observed acceptance diagnostics:

```
Meta revenue iROAS with promotion:       53.4622x
Meta revenue iROAS without promotion:    18.2186x

Meta incremental contribution
with promotion:                      -1,473,259 minor units

Meta incremental contribution
without promotion:                     +284,371 minor units
```

Promotion makes advertising revenue iROAS look dramatically better while reversing contribution economics.

## Best-seller trap

Deterministic fixture:

```
Revenue-leading product
revenue opportunity:       2,438,617
contribution opportunity: -1,002,109

Alternative product
revenue opportunity:         570,565
contribution opportunity:    571,706
```

The best seller is therefore not the best product to promote economically.

## High-AOV trap

Deterministic fixture:

```
High-AOV product price:                120,000
expected contribution/unit:            -18,226

Lower-AOV product price:                 6,902
expected contribution/unit:              3,533
```

High AOV does not imply high economic value.

## CAC vs future customer value

The deterministic acquisition fixture produces:

### Pinterest

- CAC: ~26,794.82 minor units;
- expected future contribution/customer: ~-495.93 minor units.

### Google Shopping

- CAC: ~40,371.03 minor units;
- expected future contribution/customer: ~5,650.29 minor units.

The lowest-CAC source therefore has materially worse future customer economics.

## Short-term vs long-term customer value

The same synthetic acquisition world produces a source-ranking reversal when economics are compared per represented acquired customer.

Short-term first-order contribution leader:

- Direct;
- ~7,342.98 minor units/customer.

Long-term expected total economic-value leader:

- Organic Search;
- ~10,684.77 minor units/customer.

Realized short-term economics and expected future value remain distinct.

## New vs repeat economics

Step 7 separately reports:

### New customer economics

- represented new customers;
- first-order revenue;
- first-order gross profit;
- first-order contribution before advertising;
- acquisition cost;
- expected future contribution;
- expected total economic value.

### Repeat customer economics

- represented repeat orders;
- repeat revenue;
- repeat gross profit;
- repeat contribution before advertising.

## Expected future value

Expected future contribution remains separate from realized contribution.

Customer expected future value uses Step 3 latent lifetime economics, reduced as future purchases become realized.

The valuation horizon comes from the frozen CLV mechanism.

Expected value is not reported as already-realized profit.

## Economic decomposition

Evaluator-only reports decompose economics by:

- product;
- category;
- customer type;
- promotion/full-price state.

These are accounting/economic decompositions, not observational causal channel-profit claims.

## Channel contribution economics

Shared-randomness counterfactuals support channel economic outcomes including:

- incremental gross revenue;
- incremental net revenue;
- incremental gross profit;
- incremental contribution profit;
- marginal incremental contribution profit.

These quantities are not inferred from platform attribution.

## Economic counterfactuals

For an intervention, Step 7 shared-randomness evaluation reports:

- Δ gross revenue;
- Δ net revenue;
- Δ gross profit;
- Δ contribution profit;
- Δ new-customer contribution;
- Δ repeat contribution;
- Δ expected future value.

The causal target is therefore explicit.

## Low-inventory advertising trap

The deterministic fixture produces:

```
platform ROAS:                         54.9737x
marginal contribution-profit effect:  -25,000 minor units
```

A campaign can look extremely successful while scarce inventory makes scaling it economically harmful.

## Revenue-vs-profit principle

Step 7 now contains multiple structural cases where rankings differ:

- revenue vs contribution profit;
- ROAS vs contribution profit;
- AOV vs contribution profit;
- bestseller revenue vs contribution opportunity;
- CAC vs future value;
- short-term vs long-term customer value.

The simulator can therefore punish revenue-maximizing decisions that destroy business value.

## Information boundary

Step 7 ecommerce economics remains God-mode/evaluator infrastructure.

The Operator-safe root API explicitly does not expose:

- `evaluateEcommerceEconomics`;
- `evaluateEconomicCounterfactual`;
- `evaluateChannelContributionEconomics`;
- `productOpportunityRows`;
- `acquisitionEconomicsBySource`;
- Step 7 adversarial fixtures.

## Final implementation code head

The fully passing implementation head before acceptance-report packaging is:

`a345ef4d17c2d3867a1795c853c541d5efe2bf2c`

On that exact code head:

- Architecture boundary: PASS
- Typecheck: PASS
- Full inherited + Step 7 tests: PASS
- Build: PASS

## Source limitation

The supplied Step 7 specification ends mid-definition in Section 47 after:

```
incremental contribution profit =
ContributionProfit(intervention world)
-
ContributionProfit(counterfactual/control world
```

All complete requirements through Section 46 were audited/implemented.

The Section 47 subtraction semantics are implemented by the shared-randomness economic counterfactual evaluator, but no unseen continuation beyond the supplied text was invented.

## Research isolation

Step 7 remains PUBLIC and synthetic-only.

No private Kivviq code, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details are used.

PR #18 remains draft and unmerged.
