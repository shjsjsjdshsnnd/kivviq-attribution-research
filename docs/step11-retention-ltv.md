# Step 11 — Retention, Repeat Purchase & Lifetime Value

Step 11 extends the public synthetic Growth Operator simulator from frozen Step 10 head `e5c9027522916f65669e350843bb4bea969e559e`.

It builds a longitudinal customer-economics layer. It does not implement a retention optimizer, lifecycle-marketing optimizer, acquisition optimizer, production integration, or merchant-facing decision policy.

## Core causal model

Step 11 does not model:

```
purchase -> fixed CLV multiplier
```

The implemented causal path is:

```
customer state
    ↓
purchase
    ↓
post-purchase state transition
    ↓
future need / repeat hazard
    ↓
normal Step 4 channel + commerce path
    ↓
repeat purchase / lapse / dormancy / churn / reactivation
    ↓
realized repeat economics
    ↓
expected remaining contribution
    ↓
explicit-horizon CLV
```

Repeat orders are never manufactured directly from a retention percentage.

## Realized versus expected versus oracle truth

The evaluator keeps three distinct concepts:

1. **realized customer value** — commerce that actually occurred at or before `asOf`;
2. **expected future value** — modeled expectation after `asOf`, with an explicit horizon and optional discounting;
3. **oracle future realized outcome** — what actually happens later in the synthetic God-mode path, used only for validation.

Expected future contribution is never represented as realized profit.

## Customer economic ledger

Each synthetic customer can carry:

- acquisition timestamp;
- observed acquisition source and path;
- channels with a true causal acquisition effect;
- first purchase;
- subsequent purchases;
- realized gross/net revenue;
- COGS;
- gross profit;
- contribution before observed acquisition cost;
- returns/refunds;
- repeat contribution;
- observed acquisition cost where economically valid;
- cumulative realized contribution after observed acquisition cost;
- lifecycle state;
- true churn state in God mode;
- estimated lapse risk;
- horizon-specific CLV rows;
- expected remaining value;
- future oracle validation outcome.

Preexisting customers and never-purchased customers remain distinguishable from customers acquired inside the simulation.

## Repeat-purchase hazard

Repeat purchase is time-dependent and heterogeneous.

The runtime combines:

- frozen Step 3 repeat propensity;
- merchant business model/frequency;
- brand affinity;
- lifecycle state;
- causal acquisition-quality treatment;
- latent churn/reactivation state;
- product ownership/category familiarity;
- current need and normal Step 4 need formation;
- Step 10 promotion dependence where explicitly changed;
- lifecycle-marketing effects where configured.

The hazard multiplier changes opportunity/need dynamics; it does not create an order by itself.

## Merchant-aware lifecycle states

Lifecycle timing is expressed in expected-purchase intervals rather than a universal fixed-day rule.

The runtime can move customers through states including:

- prospect;
- first-time/active customer;
- repeat customer;
- loyal customer;
- lapsing;
- dormant;
- churned.

For ordinary ecommerce, churn may remain latent and reversible. Permanent churn is only used when explicitly configured. Furniture/one-off merchants therefore have materially longer lapse/churn thresholds than subscription/replenishment merchants.

## Reactivation

Latent-churned and dormant customers can return through ordinary future need and channel behavior.

Reactivation does not bypass the normal simulator.

## Product-dependent retention

Post-purchase state tracks owned product quantities and category familiarity.

This supports:

- lower same-product repeat for one-off durable goods;
- stronger replenishment behavior for replenishment/subscription merchants;
- complementary-product opportunity from existing product relationships;
- cross-category repeat behavior.

## Replenishment and stockpiling

Step 11 uses the existing future-need clock and Step 10 promotion behavior.

Extra units actually purchased in replenishment/subscription contexts extend future need deferral. Merely being eligible for a promotion does not suppress future demand.

## Marketing after purchase

Existing customers remain eligible for normal marketing channels.

Step 11 adds explicit lifecycle-marketing mechanisms such as:

- welcome;
- post-purchase;
- replenishment;
- cross-sell;
- winback;
- loyalty;
- promotion.

Campaign rules alter opportunity/causal response only when lifecycle and elapsed-time criteria are satisfied. No optimizer decides when to send them.

Selection bias from email, retargeting and natural channel propensity remains preserved.

## Acquisition quality: selection versus treatment

Step 11 distinguishes:

**selection**
— high-value customers may naturally prefer a channel;

from:

**treatment**
— a channel may causally alter future customer quality.

A channel-specific acquisition-quality treatment can alter repeat hazard, brand affinity or promotion dependence only when that channel had a non-zero causal marketing effect before the first simulated purchase.

Observed source alone cannot create the treatment.

## Acquisition economics

Channel rows separate:

- represented acquired customers;
- observed first-order CAC;
- first-order platform ROAS;
- first-order revenue;
- first-order contribution;
- realized repeat contribution at 30/90/180/365 days;
- expected remaining contribution;
- expected total contribution after observed acquisition cost;
- represented customer weight for which the channel had a true causal acquisition treatment.

This makes cheap acquisition and valuable acquisition different concepts.

## Retention curves

Evaluator-only retention curves can report declared horizons including 30, 60, 90, 180 and 365 days.

Each point supports:

- eligible customer weight;
- repeat-purchase probability;
- active-customer probability;
- cumulative repeat orders;
- cumulative repeat revenue;
- cumulative contribution.

The curve shape emerges from the merchant/customer simulation rather than a universal template.

## Time to second purchase and third+ purchases

The evaluator reports represented customers with a second purchase and mean/median/p90 time to second purchase.

Tests validate that second and third purchases are ordinary commerce-path purchases. Retention is not truncated to one repeat order.

## CLV semantics

CLV is explicit and decomposed.

Horizon rows expose realized revenue, realized contribution and realized repeat contribution.

Expected value exposes:

- expected future orders;
- expected future revenue;
- expected future contribution;
- discounted expected future contribution;
- expected total lifetime contribution;
- revenue LTV.

Every expected value has a declared horizon.

Optional discounting supports an annual discount rate with declared time-unit/method semantics.

## Uncertainty

Expected-value records include uncertainty about future orders/contribution. This remains evaluator/God-mode infrastructure; it is not injected into Operator observations as perfect truth.

## Cohorts

Evaluator-only cohorts support:

- acquisition month;
- acquisition channel;
- first product;
- first category;
- promotion status;
- customer segment;
- first-order contribution band.

Cohort rows measure repeat behavior and value over consistent horizons.

Observed cohort differences are explicitly not interpreted as causal treatment effects.

## Shared-randomness acquisition counterfactuals

For a paid acquisition channel, the evaluator can replay a same-seed counterfactual with that channel spend removed and report:

- incremental first orders;
- incremental first-order contribution;
- incremental long-term contribution before/after acquisition cost;
- incremental expected remaining contribution;
- true incremental customer value.

Per-customer oracle outcomes distinguish:

- would never have purchased otherwise;
- would have purchased later;
- would have purchased through another channel;
- would have purchased the same product anyway;
- intervention changed only timing;
- intervention changed the long-term relationship.

These labels are God-mode truth only.

## Information boundary

Step 11 is available only through the explicit retention/LTV evaluator subpath.

The Operator-safe root does not export the Step 11 evaluator, acquisition counterfactuals, true churn state, customer oracle future outcomes or cohort causal truth.

## Source-spec boundary

The supplied Step 11 specification ends mid-section 50 after the line `This demonstrates:`.

The implementation and acceptance criteria intentionally stop at the supplied boundary rather than inventing unseen requirements.
