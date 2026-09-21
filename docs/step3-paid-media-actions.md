# Phase 2 — Action Space
## Step 3 — Paid-Media Actions

## Governing principle

**Kivviq represents real media-buying decisions at the business level without
encoding provider APIs or simulator implementation details into canonical
Actions.**

Step 3 extends the Step 1 Action schema from 1.0.0 to backward-compatible
1.1.0. Runtime readers accept both 1.0.0 and 1.1.0. Step 2 translation remains a
separate downstream adapter.

## Business-level paid-media targets

The canonical target vocabulary now supports provider-independent business
identities for:

- advertising channel;
- advertising account;
- campaign;
- campaign group;
- ad set;
- ad group;
- ad;
- creative;
- audience;
- product;
- SKU;
- category;
- collection;
- product group.

Provider identity belongs in canonical target IDs such as channelId. Provider API
payloads, resource paths and execution commands do not belong in Action.

Prospecting, retargeting, brand and non-brand are represented as
paid_media_segment scope taxonomy. This preserves Step 1's Target vs Scope
separation.

## Budget versus realized spend

advertising.adjust_budget changes a budget control. It does not assert that
future realized spend will equal the budget.

advertising.adjust_spend_cap is distinct and uses the separate
spend_cap_adjustment parameter kind.

No Action encodes guaranteed future delivery, spend, revenue or conversions.

## Spend controls

Budget changes reuse the Step 1 ValueOperation contract:

- SET
- DELTA
- MULTIPLY

Money rates retain currency and explicit day/week/month denominator.

Examples represented in fixtures:

- Google Shopping ×1.20;
- Meta prospecting -CAD 500/day;
- Pinterest SET CAD 300/day.

SET, DELTA and MULTIPLY remain semantically and fingerprint-distinct.

## Pause and resume

advertising.set_delivery_state carries an explicit PAUSE or RESUME operation.

PAUSE is not represented as SET budget = 0. The two decisions have different
Action types/parameters and different semantic fingerprints.

The legacy advertising.pause_campaign Action remains readable for backward
compatibility.

## Allocation policy

advertising.set_allocation defines an explicit SET allocation across business
members.

Allocation members may represent:

- prospecting / retargeting strategy;
- brand / non-brand traffic classification;
- another canonical target + optional scope.

Every allocation includes an explicit denominator:

- control: budget or spend_cap;
- denominator target;
- denominator scope.

Allocation shares are integer basis points and must sum exactly to 10,000.
Baseline shares may be supplied to express a shift such as 60/40 → 75/25.

Invalid or ambiguous allocations are rejected; they are never normalized.

## Reallocation

Fixed-dollar reallocations use existing canonical budget DELTA Actions grouped
under the Step 1 CompoundAction readiness contract.

Paid-media reallocation validation enforces:

- at least one source and destination;
- unique component IDs;
- source/destination target+scope distinction;
- shared timing, duration and termination semantics;
- same currency;
- same rate period;
- conservation for pure reallocations;
- explicit incremental funding or budget removal when net budget changes.

A pure -CAD 2,000 / +CAD 2,500 transfer is invalid. It becomes valid only when
the additional CAD 500 is explicitly declared as incremental funding.

## Percentage-of-source transfer

Some business reallocations are naturally defined as a share of the source
budget rather than a known dollar amount.

advertising.transfer_budget_leg supports a percentage_of_source transfer basis
with:

- basis points;
- explicit source target;
- explicit source scope;
- explicit source reference.

The source and destination legs preserve the same transferId and transfer basis.
No dollar baseline is invented.

Current simulator translation deliberately does not support this Action type;
the Action is valid business language but returns an explicit unsupported result
until a simulator capability is added.

## Prospecting / retargeting

The fixture Meta 60/40 → 75/25 uses advertising.set_allocation with an explicit
Meta-budget denominator.

The fixture Pinterest → Meta 10% uses percentage-of-source transfer legs.

## Brand / non-brand

Brand and non-brand are canonical business classifications, not classifications
invented by the Action object.

The Google 15/85 allocation fixture has a precondition requiring classification
evidence. Missing classification therefore belongs in tri-state eligibility as
unknown rather than being guessed.

The Google Brand → Non-Brand CAD 300/day fixture is a conserved compound budget
reallocation with distinct business scopes.

## Product and merchandising targets

Paid-media budget and delivery Actions can target canonical products, SKUs,
categories, collections and product groups without assuming that any provider
has one campaign per product.

Current simulator budget translation supports only channel/campaign targets.
Product/category/collection Actions therefore remain valid but explicitly
unsimulatable where no downstream capability exists.

## Constraints

Paid-media Actions use the existing hard/soft/precondition contracts.

Fixtures include:

- pause SKU B when inventory.available_units < 10;
- scale Product A only when finance.contribution_margin_rate >= 30%;
- classification evidence preconditions for Google Brand / Non-Brand.

No constraint uses future demand, true incremental ROAS or counterfactual
outcomes.

## Timing

Paid-media Actions retain decision time, requested start, effective start,
implementation delay, duration and termination.

The Black Friday prospecting fixture increases Meta budget by CAD 1,500/day for
four days with an explicit requested/effective start and fixed duration.

## Step 2 translation

Step 2 is extended only where the current simulator already has a corresponding
causal capability.

Supported:

- advertising.adjust_budget on channel/campaign targets → BudgetIntervention;
- advertising.set_delivery_state on campaign target → campaign-delivery
  intervention;
- fixed monetary compound reallocations whose component targets are supported →
  coordinated multiple BudgetInterventions.

Not added merely for Step 3:

- allocation-policy engine;
- product/SKU budget simulation;
- collection/category budget simulation;
- spend-cap simulation;
- percentage-transfer simulation.

These valid Actions return explicit unsupported Action/target/capability results.

## Provider independence

There are no META_*, GOOGLE_*, PINTEREST_* or TIKTOK_* core Action types.

All Step 3 Action types remain provider-neutral:

- advertising.adjust_budget;
- advertising.adjust_spend_cap;
- advertising.set_delivery_state;
- advertising.set_allocation;
- advertising.transfer_budget_leg.

Provider identity appears only in canonical targets/scopes.

## Information boundary

Paid-media business modules may depend on canonical Action contracts but are
forbidden by dependency-cruiser from importing action_translation,
simulator_intervention or simulator internals.

Paid-media Actions reject prediction/evaluation fields including:

- expectedROAS;
- expectedRevenue;
- expectedProfit;
- expectedConversions;
- predictedLift;
- trueIncrementalROAS;
- futureDemand;
- counterfactualRevenue;
- recommendationScore;
- confidence / confidenceScore.

## Canonical fixtures

The Step 3 fixture set includes:

1. Google Shopping budget +20%.
2. Meta prospecting budget -CAD 500/day.
3. Pinterest budget SET CAD 300/day.
4. Pause Meta Campaign A.
5. Resume Google Campaign B.
6. Meta → Google CAD 2,000/week.
7. Meta Campaign A → B CAD 500/day.
8. Meta prospecting/retargeting 60/40 → 75/25.
9. Google Brand → Non-Brand CAD 300/day.
10. Google Brand/Non-Brand SET 15/85.
11. SKU A advertising +20%.
12. Pause low-inventory SKU B.
13. Rugs → Lighting CAD 1,000/week.
14. Product A scaling with 30% contribution-margin floor.
15. Black Friday Meta prospecting +CAD 1,500/day for four days.
16. TikTok account spend-cap Action that is valid but not currently simulatable.
17. Pinterest → Meta 10% source-share reallocation.
18. Google Non-Brand Campaign X → Y 20% source-share reallocation.
19. Meta retargeting → prospecting CAD 1,000/week.

## Non-scope

Step 3 does not choose, rank or score paid-media Actions. It does not predict
ROAS, revenue, contribution or conversions. It does not implement bidding,
provider execution, Growth Operator policy, recommendation generation or real
advertising-account mutation.
