# Step 3.7 — Simple Merchandising Heuristic Baselines

## Purpose

Step 3.7 adds three intentionally simple merchandising benchmark operators:

1. `RANK_BY_REVENUE`
2. `RANK_BY_CONVERSION_RATE`
3. `RANK_BY_UNITS_SOLD`

The governing rule is deliberately narrow:

`rank eligible products using one observable historical performance metric and nothing else`

Frozen lineage:

- Step 3.6 parent: `b8c1f16e37d8483948d5e607e9711f0daa027adc`
- Step 3.1 contract: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`
- ecommerce economics: `ecommerce-economics-7.0.0`
- product economics: `product-economics-8.0.0`
- simulator: `customer-journey-simulator-4.0.0`

No prior baseline, metric definition, simulator semantic, evaluation contract or Action Ontology definition is modified.

## Canonical operator contract

All three operators use the same `CanonicalOperator` interface and generic evaluation path as the earlier baselines.

Each freezes:

- operator ID/version;
- heuristic type;
- serializable configuration;
- configuration fingerprint;
- implementation fingerprint;
- exact evaluation-contract dependency;
- Action Ontology dependency;
- metric-set dependency;
- ecommerce/product-economics dependency;
- simulator dependency.

No merchandising-specific evaluator path exists.

## Target surface and eligible product population

The frozen representative target is:

`collection:X`

on the collection-page merchandising surface.

A product is eligible for ranking only when it is observably:

- a member of the target collection;
- active;
- available;
- merchandising-eligible;
- not excluded.

Movable products must also appear as legally eligible targets for canonical `merchandising.move_product` in the per-decision Action-space snapshot.

Pinned or mandatory-position products remain fixed and occupy their frozen positions. The metric sort fills only the remaining open positions.

Inventory is never used as a score. Availability may only remove a product from the eligible population.

## Observation contract

Frozen observation key:

`merchandising.product_performance.v1`

Schema version:

`1.0.0`

Every decision uses a trailing **30-day** historical window ending exactly at decision time.

The observation includes only permitted historical/current merchandising facts:

- target collection;
- product collection membership;
- active/available/eligible/excluded state;
- current position;
- pinned or mandatory position;
- newly launched indicator;
- observed net product revenue;
- observed product conversions;
- observed product views;
- observed units sold.

A lookback-window mismatch fails closed.

## Revenue metric

`RANK_BY_REVENUE`

Operator ID:

`baseline.merchandising.rank_by_revenue`

Metric ID:

`revenue`

Frozen product-level semantic:

`ecommerce_economic_report.byProduct.netRevenueMinor`

Definition:

`sum(product order-line net sales after discounts) - product refunded revenue`

Semantics:

- currency: CAD;
- net of discounts;
- product refunds subtract revenue;
- cancelled orders are absent because the metric uses realized orders;
- product attribution is order-line product attribution;
- trailing lookback: 30 days.

Revenue may be negative in a refund-heavy period. Negative revenue remains valid observed evidence rather than being treated as missing.

No profit, margin, contribution, price or predicted revenue enters the sort.

## Conversion-rate metric

`RANK_BY_CONVERSION_RATE`

Operator ID:

`baseline.merchandising.rank_by_conversion_rate`

Metric ID:

`conversion_rate`

Frozen semantic:

- numerator: represented realized orders containing product;
- denominator: observed product views;
- source binding: product-economics observed view-to-purchase inputs;
- minimum evidence: 20 product views;
- zero views: insufficient evidence;
- trailing lookback: 30 days.

Formula:

`conversion_rate = represented_orders_containing_product / product_views`

Products with fewer than 20 observed views do not receive shrinkage, Bayesian correction or predicted conversion. They enter the deterministic insufficient-evidence fallback.

The same denominator definition is used for every product.

## Units-sold metric

`RANK_BY_UNITS_SOLD`

Operator ID:

`baseline.merchandising.rank_by_units_sold`

Metric ID:

`units_sold`

Frozen semantic:

`ecommerce_economic_report.byProduct.units`

Definition:

`sum(realized order-line quantity)`

Semantics:

- cancelled orders are absent because they are not realized orders;
- returns and refunds do not subtract already realized units sold;
- trailing lookback: 30 days.

Revenue, price, margin and profitability do not alter this ranking.

## Tie-breaking

Frozen tie rule:

`primary metric descending → canonical product ID ascending`

No database order, insertion order, object iteration order or runtime-dependent ordering may decide ties.

Tie decisions are recorded in the deterministic decision audit.

## Missing-data fallback

Frozen fallback:

1. products with valid metric evidence rank normally;
2. products with missing or insufficient evidence follow afterward;
3. fallback products are ordered by product ID ascending.

Zero revenue, zero units and zero conversions with sufficient conversion denominator are valid metric values.

Examples of fallback cases:

- missing revenue;
- missing units sold;
- missing product views;
- conversion denominator below 20 views;
- newly launched product without enough history.

The heuristic does not predict missing product performance.

## Feedback loops

The benchmarks intentionally do not correct ranking feedback loops.

A higher-ranked product may get more exposure, produce more observed sales and remain highly ranked.

There is no:

- exploration;
- randomized ranking;
- exposure normalization;
- causal correction;
- position-bias correction.

The naïve feedback loop is part of the benchmark.

## Profitability and inventory

The ranking score never uses:

- COGS;
- gross margin;
- contribution margin;
- advertising cost;
- shipping cost;
- return cost;
- CLV;
- stock level.

Inventory affects the result only if it changes observable legal eligibility.

A low-margin bestseller still ranks highly when its chosen frozen metric is strong.

## Canonical Actions

The benchmark emits only canonical:

`merchandising.move_product`

Actions.

Each action sets one product to a deterministic position in `collection:X` using the existing `merchandising_position` parameter contract.

No heuristic-specific ranking Action type exists.

## Constraints

Before proposal, the heuristic respects:

- target collection membership;
- active/available/merchandising eligibility;
- explicit exclusions;
- pinned/mandatory positions;
- legal Action-space target eligibility;
- legal Action parameter bounds.

All proposed Actions still pass through the generic Step 3.1 validation and business-constraint path.

Accepted, rejected and explicitly modified Actions are recorded. The heuristic never silently repairs a constrained ranking.

## Simulator qualification

The frozen simulator supports the legacy canonical:

`merchandising.move_product → merchandising_position`

translation for a product-position intervention.

Step 3.7 deliberately uses that simple legacy contract instead of the richer Step 7 `merchandising.set_rank` contract, whose translator explicitly rejects unsupported rigorous surface/container/displacement semantics.

Qualification:

- Step 3.7 validates a single collection ranking benchmark;
- the legacy simulator intervention preserves product position;
- it does not preserve the richer multi-surface/container/displacement semantics of the later rigorous merchandising ontology.

The qualification is recorded in every decision/evaluation artifact rather than silently approximating the richer contract.

## Decision audit

Every merchandising invocation records:

- target collection/surface;
- frozen lookback;
- metric ID;
- eligible products;
- products excluded by eligibility and why;
- observed metric value by product;
- evidence sufficiency;
- fixed positions;
- tie-break results;
- ranked movable products;
- proposed final ranking;
- proposed Action IDs;
- deterministic fallback reason;
- exact operator/configuration/dependency identities;
- simulator qualification.

A reviewer can reconstruct the ranking from the recorded observation.

## Anti-optimization boundary

The suite contains no:

- predictive ranking;
- recommendation model;
- personalization;
- collaborative filtering;
- causal ranking;
- exploration/exploitation;
- reinforcement learning;
- Bayesian ranking;
- profitability optimization;
- CLV optimization;
- inventory optimization;
- position-bias correction;
- cross-product substitution model.

Future demand, future revenue, future conversion, latent attractiveness, counterfactual outcomes, GroundTruth and evaluator-only metrics are structurally excluded.

## Paired comparisons

All three operators use the frozen Step 3.1 comparison binding.

Tests verify comparison-critical equivalence against:

- DO_NOTHING;
- STATUS_QUO;
- Step 3.4 equal-budget allocation;
- Step 3.5 fixed reorder threshold;
- Step 3.6 fixed promotional calendar;
- all Step 3.7 merchandising operators.

World, initial merchandising, product population, shared environmental seeds, observations, decision cadence, Action space, constraints, horizon and metric definitions remain controlled.

## Evaluation artifacts

A deterministic 90-opportunity `EvaluationRunArtifact` and generic `OperatorEvaluationBundle` are produced for every Step 3.7 operator.

Artifacts preserve:

- evaluation contract identity/fingerprint;
- operator ID/version/fingerprint;
- configuration/fingerprint;
- Action Ontology;
- simulator;
- world fingerprint;
- metric-set version;
- currency;
- seeds;
- lookback;
- eligible products;
- metric observations;
- evidence sufficiency;
- tie-breaks;
- proposed rankings;
- Action validation;
- constraint disposition;
- executed ranking Actions;
- outcome summary;
- all canonical evaluation metric slots.

## Freeze discipline

Before benchmark outcome evaluation, Step 3.7 freezes:

- 30-day lookback;
- revenue semantics;
- conversion numerator/denominator;
- 20-view minimum conversion evidence;
- units-sold semantics;
- fallback ordering;
- tie-breaking;
- target collection;
- eligibility behavior;
- fixed-position behavior.

Future substantive changes require a new explicit version/fingerprint.
