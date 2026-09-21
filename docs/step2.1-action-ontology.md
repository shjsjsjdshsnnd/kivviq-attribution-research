# Step 2.1 — Action Ontology

## Purpose

This step defines the canonical language of possible ecommerce interventions before any Opportunity Engine, Digital Twin, optimizer, experiment planner, agent or execution system is allowed to choose among them.

**Every Kivviq module must speak the same action language.**

The ontology is model-agnostic and contains no recommendation policy.

## Architectural boundary

The canonical concepts are deliberately separate:

- `Action` — what intervention is possible.
- `ActionEvaluation` — predicted consequences if an action is performed.
- `Decision` — whether an action is accepted, rejected or deferred.

An `Action` carries intervention definition, constraints, costs, risk structure, reversibility and measurement requirements, but no conclusion that it is a good idea.

The module is Operator-safe. It does not import GroundTruth, simulator internals, latent customers or Step 8 product-economics evaluator state.

## Canonical Action

Every Action contains:

- identity: action ID, namespaced type, category, revision and description;
- typed target;
- structured intervention parameters;
- timing, scheduling requirements and dependencies;
- duration semantics;
- economic cost components with explicit uncertainty;
- machine-evaluable constraints;
- reversibility classification, mechanism, cost and delay;
- seven mandatory core risk dimensions;
- measurement horizon, metrics and baseline requirements;
- lifecycle state;
- optional compound-action and reversal links.

## Initial taxonomy

The core category registry covers:

1. paid media;
2. pricing;
3. promotions;
4. merchandising;
5. inventory;
6. product;
7. website/CRO;
8. email/SMS/CRM;
9. customer segmentation;
10. retention;
11. acquisition;
12. shipping/fulfillment.

The registry is extensible: new namespaced action types and additional constraint properties can be registered without changing the core `Action` shape.

## Targets and parameters

Initial typed targets cover channels, campaigns, ad sets, ads, audiences, products, SKUs, collections, landing pages, price targets, promotions, inventory, email campaigns, email flows, customer segments, merchandising placements and shipping policies.

Parameters support SET, INCREASE_BY, DECREASE_BY, INCREASE_BY_PERCENT, DECREASE_BY_PERCENT, PAUSE, RESUME, APPLY, REMOVE, MOVE_TO and REVERSE.

Percentages use integer basis points plus explicit semantics: relative change, absolute share, percentage points, discount rate or margin rate.

Money uses integer minor units plus an explicit three-letter currency. Periodic budget changes use a dedicated monetary-rate value with an explicit day, week or month denominator, so `CAD 1,000/week` cannot collapse into an unqualified `CAD 1,000`.

## Uncertainty

Knowledge-bearing fields support:

- known;
- estimated;
- bounded;
- unknown;
- not applicable.

Each carries provenance. Unknown implementation cost remains unknown rather than being silently turned into zero.

## Step 8 economics references

The constraint registry includes canonical references for:

- inventory available/sellable units and stock coverage;
- gross margin;
- expected contribution per unit;
- structural demand and desirability;
- substitutions and complements;
- return rate;
- shipping cost;
- fulfillment cost.

These are property references only. The ontology does not import Step 8 God-mode types.

## Atomic and compound actions

Atomic actions represent one intervention against one logical target.

Compound actions contain validated atomic components. Each component keeps its own action ID plus the parent action ID and shared intent ID. A required coordination contract declares an execution policy (`all_or_nothing`, `ordered` or `best_effort`) and machine-readable dependency edges between component actions.

The budget-reallocation fixture is `all_or_nothing`; the Google increase depends on the paired Meta decrease. The contract additionally requires one decrease, one increase and the same explicit monetary amount, currency and period, preventing downstream systems from treating a transfer as two unrelated spend changes.

## Lifecycle

Supported states:

`PROPOSED`
`ACCEPTED`
`REJECTED`
`SCHEDULED`
`IMPLEMENTED`
`ACTIVE`
`COMPLETED`
`REVERSED`
`CANCELLED`
`FAILED`

Acceptance is explicitly not implementation.

## Fixtures

The branch includes ten representative fixtures:

1. increase Google Shopping budget by 20%;
2. pause an underperforming Meta campaign;
3. reduce a product price by 10%;
4. run a 15% collection promotion for four days;
5. increase email frequency;
6. move a product higher in a collection;
7. move CAD 1,000/week from Meta prospecting to Google Shopping;
8. stop advertising a high-ROAS SKU once inventory reaches 17 units or fewer;
9. increase product advertising only while contribution, margin and inventory remain above floors;
10. reverse a previously implemented Google Shopping budget increase.

## Validation

Malformed actions fail explicitly. Validation covers target identity, action-type parameter requirements, duration/end-time coherence, currency, percentage semantics, registered constraints, reversibility, risk dimensions, measurement horizons, compound linkage, reallocation balance and ontology compatibility.

No silent coercion is performed.

## Versioning

Current ontology: `1.0.0`.

Readers accept compatible `1.x.y` documents and reject an unknown future major version. `Action.version` separately tracks revisions to a specific action definition.

## Non-scope

This step does not generate recommendations, rank actions, predict outcomes, optimize budgets, choose decisions, execute changes or learn a policy.
