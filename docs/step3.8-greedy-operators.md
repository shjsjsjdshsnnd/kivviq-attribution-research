# Step 3.8 — Canonical Greedy Baseline Operators

## Purpose

Step 3.8 establishes a stronger benchmark than the fixed/simple heuristics from Steps 3.4–3.7.

A greedy operator answers:

> Given the observable evidence available now, which finite legal candidate has the highest estimated immediate return?

The operator is deliberately myopic.

It does not reason about causality, uncertainty, delayed effects, substitution, retention, CLV or cross-domain second-order consequences.

Frozen lineage:

- Step 3.7 parent: `e23b336582b34b175524c82a802a8194ed1427e7`
- Step 3.1 contract: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`
- simulator: `customer-journey-simulator-4.0.0`

No prior baseline, contract, ontology, metric or simulator semantic is modified.

## Objective suite

Step 3.8 freezes three explicit objective configurations rather than allowing one operator to switch objectives:

1. `IMMEDIATE_REVENUE`
2. `IMMEDIATE_GROSS_PROFIT`
3. `IMMEDIATE_CONTRIBUTION`

Each objective receives its own operator ID and configuration fingerprint.

The common objective shape is:

`point estimate of immediate observable return in CAD minor units`

Population:

`legal action targets with permitted observable evidence`

Scope:

`one canonical action at the current decision opportunity`

The operator's internal score is not the evaluator's final benchmark outcome metric.

## Observation boundary

Frozen observation key:

`greedy.immediate_return_evidence.v1`

Schema:

`1.0.0`

Lookback:

`7 days`

The evidence window ends exactly at decision time.

Permitted evidence includes current/historical observable:

- channel spend;
- attributed channel revenue;
- attributed channel gross profit;
- attributed channel contribution;
- current advertising budgets;
- product/SKU price;
- recent realized product units;
- recent product revenue;
- recent product gross profit;
- recent product contribution;
- product views/conversions;
- current merchandising position;
- observable inventory/inbound/pending/supplier state.

GroundTruth, simulator latent state, future data, counterfactual outcomes, true causal effects, hidden response curves and evaluator-only metrics remain outside the Step 3.1 operator boundary.

## Candidate generation

Candidate enumeration is finite, deterministic and bounded.

Frozen action-type order:

1. no action
2. `advertising.adjust_budget`
3. `pricing.adjust_price`
4. `promotion.start`
5. `merchandising.move_product`
6. `inventory.reorder`

Frozen parameter grid:

### Advertising

- candidate: increase current weekly budget by CAD 1,000
- one candidate per legally eligible active channel

### Pricing

Two SET-price candidates per legally eligible SKU:

- -10%
- +5%

There is no continuous price search.

### Promotions

Two preregistered direct-SKU 10% promotion templates:

- `promo_greedy_product_a_10pct`
- `promo_greedy_product_b_10pct`

Each lasts seven days and uses the frozen canonical temporary `promotion.start` contract.

### Merchandising

- move legally eligible product to position 1
- one candidate per eligible product not already at position 1

### Inventory

- fixed 50-unit canonical `inventory.reorder` candidate

Inventory candidates are preserved in the audit but are not selectable in the cross-domain benchmark because the frozen simulator cannot execute inventory reorder semantics faithfully.

This is recorded as:

`FROZEN_SIMULATOR_INVENTORY_ACTIONS_UNSUPPORTED`

rather than approximating purchase orders as immediate stock.

Candidate bounds:

- maximum legal targets per action type: 8
- maximum total candidate count: 64

Targets are enumerated in stable canonical target-key order.

## No-action candidate

`Action[] = []`

is always present.

Frozen immediate-return value:

`0 CAD minor units`

A negative action is therefore never forced merely because a decision opportunity exists.

When a legal intervention has exactly the same score as no action, no action wins the frozen tie-break.

## Immediate-return estimators

The estimators are intentionally naïve.

### Advertising

`observed objective / observed spend × proposed spend increase`

For the revenue objective this is equivalent to:

`observed attributed ROAS × proposed spend increase`

The operator treats attributed performance as attractive without incrementality correction.

### Pricing

`recent observed units × immediate price delta`

The same price delta is used as the immediate gross-profit/contribution delta under the frozen assumption that unit variable costs do not change within the immediate calculation.

No price elasticity is modeled.

### Promotion

`recent observed units × negative configured discount value per unit`

The benchmark does not invent demand lift to rescue a discount.

### Merchandising

`observed trailing objective value of the moved product`

Examples:

- product revenue for the revenue objective;
- product gross profit for the gross-profit objective;
- product contribution for the contribution objective.

No position-bias or substitution correction is applied.

### Inventory

For audit only:

`observed revenue per recent unit × min(fixed reorder quantity, recent units)`

The candidate remains excluded from selection because the frozen simulator cannot execute rigorous reorder semantics.

## Missing evidence

Frozen rule:

`insufficient evidence → candidate excluded from greedy selection`

Examples:

- missing/zero advertising spend;
- missing channel objective value;
- missing product price;
- missing recent units;
- missing merchandising objective;
- incomplete inventory/supplier/inbound state.

The operator never invents an estimate.

Excluded candidates remain present in the decision audit with their exclusion reason.

## Constraints

Candidate Actions are generated only from the per-decision canonical legal Action space.

Before ranking/selectability, the implementation respects:

- eligible targets;
- required preconditions;
- numeric Action bounds;
- active/available state;
- promotion eligibility;
- merchandising eligibility;
- observable inventory/supplier constraints.

The selected Action then passes through the same generic Step 3.1 business-constraint system as every prior operator.

Accepted, rejected and explicitly modified Actions are recorded.

The greedy operator does not fall through to the second-best candidate after the selected candidate is rejected, and it does not silently repair it.

## Deterministic ranking

Selectable candidates are ordered by:

1. estimated immediate return descending;
2. no action first when the score is exactly tied;
3. frozen canonical action-type order;
4. canonical target key ascending;
5. canonical parameter key ascending;
6. candidate ID ascending.

Runtime map/object iteration order never decides the winner.

## Deliberate myopia

The operator explicitly ignores:

- causal incrementality;
- attribution bias corrections;
- confounding;
- uncertainty;
- confidence intervals;
- posterior distributions;
- evidence-size penalties beyond frozen missing-evidence requirements;
- delayed conversions;
- future stockouts;
- promotion pull-forward;
- future willingness to pay;
- substitution;
- cannibalization;
- retention;
- churn;
- CLV;
- cohort quality;
- downstream cross-domain consequences.

These omissions are benchmark features.

## Complete candidate audit

Every decision records:

- objective;
- observation window;
- legal Action-space fingerprint;
- full generated candidate set;
- canonical candidate Actions;
- immediate-return estimate for each candidate;
- estimator and evidence used;
- missing/unsupported exclusion reason;
- selectable candidate ranking;
- tie-break decisions;
- selected candidate;
- selected Action or no action;
- selected internal score;
- exact operator/configuration fingerprints;
- dependency versions;
- simulator qualification.

Constraint validation and executed Action are preserved by the generic evaluator decision record.

## Anti-causality / anti-uncertainty / myopia tests

The focused Step 3.8 suite explicitly tests:

- observed high ROAS winning despite incrementality concerns;
- Step 3.1 rejection of GroundTruth/simulator-latent observations;
- score 101 winning over score 100 despite much smaller evidence volume;
- delayed-effect concerns not altering the current winner;
- substitution/cannibalization concerns not altering the winner;
- retention/CLV concerns not altering the winner;
- broad adversarial concerns not rescuing greedy behavior.

## Paired comparisons

All greedy objectives use the exact Step 3.1 comparison binding.

Tests compare them against earlier baseline families under identical:

- world;
- initial conditions;
- shared environmental seeds;
- observations;
- decision cadence;
- legal Action space;
- constraints;
- horizon;
- evaluator metric definitions.

Only policy behavior and the operator-specific seed binding differ.

## Evaluation artifacts

Every greedy objective produces a deterministic 90-opportunity `EvaluationRunArtifact` and generic `OperatorEvaluationBundle`.

Artifacts preserve:

- evaluation-contract fingerprint;
- operator ID/version/fingerprint;
- configuration fingerprint;
- Action Ontology version;
- simulator version;
- world fingerprint;
- metric-set version;
- currency;
- seeds;
- observations;
- candidate set;
- immediate-return estimates;
- candidate ranking;
- selected candidate/action;
- validation/constraint disposition;
- executed Action;
- outcome summary;
- canonical evaluation metrics.

The artifact explicitly records that the operator's internal decision score is not the evaluator's final outcome score.

## Freeze discipline

Before benchmark outcome evaluation, Step 3.8 freezes:

- objective;
- immediate-return definition;
- 7-day lookback;
- candidate action domains/types;
- parameter grid;
- target cap;
- total candidate cap;
- no-action score;
- missing-evidence exclusion;
- simulator unsupported-action policy;
- tie-breaking;
- estimator formulas.

Future substantive changes require new explicit versions/fingerprints.
