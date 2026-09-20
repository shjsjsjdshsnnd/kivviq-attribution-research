# Step 5 — Advertising Economics Acceptance Report

## Frozen foundations

Step 5 was created from the exact frozen Step 4 head:

`0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`

The frozen references remain:

- Step 1 — GroundTruth: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — merchant/world generation: `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — latent customer population: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- Step 4 — customer journey simulation: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`

PRs #2, #5, #8 and #11 were not modified.

## Core separation

Step 5 implements four separate performance layers:

```
platform-reported performance
observed touch-associated performance
true incremental performance
marginal incremental performance
```

No layer is defined as an alias of another.

### Platform-reported

Derived from synthetic attribution rules over observable events only.

### Observed

Derived from merchant-observable channel touches and purchases.

### True incremental

Derived from shared-randomness spend counterfactuals.

### Marginal incremental

Derived from local shared-randomness spend changes around a reference spend.

## Frozen response-function integration

Step 5 does not create a competing causal response schema.

A shared deterministic evaluator was added for the frozen Step 1/2 response-curve families:

- linear;
- Hill / saturating;
- threshold;
- piecewise.

The Step 5 oracle and the Step 5 extension of the Step 4 simulator both consume this same frozen curve evaluator.

Supported evaluator operations include:

- total expected response;
- average response;
- local marginal response;
- saturation point;
- average incremental ROAS;
- marginal incremental ROAS;
- average incremental CAC;
- marginal incremental CAC;
- break-even revenue ROAS;
- maximum economically rational spend approximation;
- contribution-profit-maximizing spend approximation.

Negative marginal response is supported for piecewise curves without requiring total response to become negative.

## Spend → delivery → reach / frequency

Spend does not directly create revenue.

The synthetic delivery layer models:

- CPM-like or CPC-like billing;
- delivery unit cost;
- impression opportunity;
- click-through rate;
- viewability;
- reachable population;
- unique reach;
- frequency;
- saturation;
- audience-quality decay.

CPC billing is explicitly separate from click-through probability.

Increasing spend initially expands reach, then increasingly purchases frequency/repetition as reachable populations saturate.

## Audience quality decay

Step 3 customer-level channel susceptibility is used directly.

For each paid channel, reachable customers are ranked by a mixture of:

- causal susceptibility;
- natural channel propensity;
- purchase intent;
- expected lifetime value.

As reach expands, additional spend can include progressively lower-ranked customers.

The delivery tests verify that low-spend reached cohorts can have higher mean intent and causal susceptibility than high-spend reached cohorts.

This creates endogenous marginal-return deterioration without making quality decay universal.

## Context-dependent response

Advertising response can change with:

- seasonality;
- promotion state;
- inventory availability;
- audience quality;
- Step 4 customer state;
- Step 4 carryover;
- Step 4 external shocks;
- Step 4 cross-channel interactions.

Promotion and inventory interventions are passed into both sides of shared-randomness spend comparisons so they alter the causal environment rather than the definition of incrementality.

## True CAC

Step 5 distinguishes:

- platform-reported CAC;
- observed CAC;
- average incremental CAC;
- marginal incremental CAC.

Average and marginal true CAC are derived from spend and the frozen incremental-acquisition response curve where defined.

The response tests require average and marginal CAC to diverge in saturating worlds.

## Synthetic platform attribution

The platform layer is type-level causal blind.

It receives only:

- perfectly observable journey events;
- realized purchases.

Its type surface does not contain the God-mode causal ledger.

Transparent synthetic attribution rules support:

- click-like claims;
- view-through claims;
- attribution windows;
- full-revenue self-attribution;
- overlapping platform claims;
- retargeting-style claim-window expansion;
- branded vs non-brand Google Search claim classification.

Multiple platforms can claim the same purchase.

The duplicate-claim test reconciles those claims against **population-weighted merchant revenue** and requires total claimed revenue to exceed merchant revenue in the deterministic fixture.

## Over-attribution

A deterministic test world sets Meta true incrementality to zero and zeros cross-channel interactions.

Meta still receives observable touches and synthetic platform claims.

Acceptance requires:

```
true incremental Meta revenue = 0
true incremental Meta ROAS    = 0

platform-attributed Meta revenue > 0
platform-reported Meta ROAS    > 0
```

The platform does not read causal truth to create this disagreement.

## Under-attribution

A deterministic Pinterest fixture gives Pinterest a genuine delayed upper-funnel causal effect.

A transparent synthetic reporting rule with no eligible click/view claim window intentionally misses that delayed value.

Acceptance requires:

```
true incremental Pinterest revenue > 0
platform-attributed Pinterest revenue < true incremental revenue
```

Platforms are therefore not universally over-attributing.

## Duplicate claims

The platform tests require at least one realized purchase to be claimed by multiple paid platforms under their independent synthetic rules.

The same merchant revenue may therefore appear multiple times in platform-attributed revenue.

All three quantities remain separately available:

- merchant revenue;
- platform-attributed revenue;
- true incremental revenue.

## Retargeting economics

The synthetic platform rule can expand claim eligibility when a customer had prior observable high-intent behavior such as:

- product view;
- add to cart;
- checkout start.

That retargeting-like claim expansion is causal blind.

The customer's high purchase propensity exists through Step 3/4 state and observable behavior, not because the platform attribution system creates a causal effect.

The deterministic retargeting-trap fixture gives Meta weak/zero true incremental economics while allowing strong reported performance.

## Branded vs non-brand Search

Google Search platform reporting classifies observable searches as:

- branded;
- non-brand.

Brand and non-brand attributed orders/revenue are reported separately.

This does not assert that either class is universally more incremental.

The frozen merchant causal mechanisms and shared-randomness counterfactuals determine true economics.

## Upper-funnel / delayed effects

Step 5 inherits Step 4's:

- delayed treatment application;
- channel-specific memory/carryover;
- awareness/consideration effects;
- later search/direct behavior.

The under-attribution fixture explicitly uses a delayed Pinterest effect.

## Cross-channel mediation, synergy and cannibalization

Step 5 consumes Step 4's frozen causal-interaction machinery.

Observed revenue can move between channels even when total merchant revenue changes differently.

The platform-reporting layer remains observational and may credit the downstream channel even when upstream paid media caused part of the response.

No attribution total is manually subtracted to simulate cannibalization.

## Revenue and contribution economics

Shared-randomness spend comparisons calculate:

- incremental gross revenue;
- incremental net revenue;
- incremental gross profit;
- incremental contribution profit.

Advertising spend is explicitly included in contribution economics.

The test suite includes a deterministic world where revenue ROAS is positive while incremental contribution profit is negative.

## Break-even and economically rational spend

Evaluator-only diagnostics calculate or approximate:

- break-even revenue ROAS;
- maximum spend with marginal contribution economics at/above break-even;
- contribution-profit-maximizing spend on tractable frozen curves.

This is God-mode oracle functionality only.

No Growth Operator optimization algorithm is implemented.

## Budget constraints

The evaluator accepts finite advertising budgets and candidate allocations.

It validates that a candidate allocation does not exceed the budget and can score candidate allocations through the full Step 5 report.

It does not choose the allocation.

## Spend interventions

Step 5 uses the frozen Step 1 `set` intervention.

Convenience helpers for:

- spend + delta;
- spend × multiplier;

resolve into an explicit absolute `set` intervention.

No incompatible intervention type was added.

## Shared-randomness true incrementality

For channel spend:

```
incremental revenue =
Revenue(high spend)
- Revenue(low spend)

incremental spend =
high spend - low spend

true iROAS =
incremental revenue / incremental spend
```

The simulator uses the same:

- merchant;
- latent customers;
- simulation seed;
- time range;
- contextual interventions;
- semantic keyed stochastic structure.

Zero spend denominators return `null` rather than producing an invalid ROAS.

## Local / marginal evaluation

God-mode evaluation supports a reference-spend neighborhood:

```
below spend
reference spend
above spend
```

and reports:

- backward marginal economics;
- forward marginal economics.

This provides the evaluator equivalent of $9K / $10K / $11K comparisons without treating historical average ROAS as the marginal answer.

## Platform vs true performance report

Each paid-channel row reports:

- spend;
- delivery/reach/frequency;
- reached-audience composition;
- platform-attributed revenue;
- platform ROAS;
- platform-reported CAC;
- observed touch-associated revenue;
- observed ROAS;
- observed CAC;
- true incremental gross revenue;
- true incremental net revenue;
- true incremental gross profit;
- true incremental ROAS;
- marginal incremental ROAS;
- average incremental CAC;
- marginal incremental CAC;
- incremental contribution profit.

The report also exposes:

- merchant revenue;
- total platform-attributed revenue;
- duplicate-claim excess.

The report is evaluator/oracle truth and is not Operator input.

## Deterministic adversarial worlds

### A. Vanity ROAS trap

Deterministic fixture:

`createVanityRoasTrapFixture()`

Observed acceptance diagnostics:

```
dashboard leader: Meta
platform ROAS: 196.9173x
true incremental ROAS: 0x
marginal incremental ROAS: 0x
incremental contribution profit: -55,000 minor units
best alternative marginal iROAS: 4.36123x
```

The highest platform-ROAS channel is therefore the wrong channel for the next unit of spend.

The exact numbers are synthetic fixture outputs, not hard-coded universal channel values.

### B. Retargeting trap

Deterministic fixture:

`createRetargetingTrapFixture()`

Observed acceptance diagnostics:

```
channel: Meta
platform ROAS: 31.1691x
true incremental ROAS: 0x
platform-reported CAC: 383.10 minor units
true average incremental CAC: undefined because incremental customers = 0
platform-attributed revenue: 1,402,608.23 minor units
true incremental revenue: 0
```

The platform appears highly efficient while God-mode shared-randomness evaluation finds no incremental revenue in the fixture.

Again, these values are generated by the deterministic synthetic world and attribution rules, not embedded as generic Meta assumptions.

## Acceptance-test coverage

Step 5 adds tests for:

- response-curve total/marginal evaluation;
- diminishing marginal returns;
- negative marginal returns;
- average vs marginal incremental ROAS;
- average vs marginal incremental CAC;
- saturation;
- break-even and optimal-spend diagnostics;
- spend→delivery;
- reach/frequency saturation;
- audience-quality decay;
- state-dependent response;
- overlapping platform claims;
- branded/non-brand Search reporting;
- causal-blind retargeting claims;
- platform/observed/true/marginal separation;
- shared-randomness spend counterfactuals;
- zero denominator handling;
- finite budgets;
- relative spend helper semantics;
- local forward/backward marginal evaluation;
- platform over-attribution;
- platform under-attribution;
- inventory-constrained advertising value;
- promotion-dependent true response;
- positive revenue ROAS with negative contribution economics;
- vanity ROAS trap;
- retargeting trap;
- Operator/God-mode isolation.

All inherited Step 1–4 tests remain in the full CI suite.

## Code-head validation

The final Step 5 implementation code head before this acceptance-report packaging is:

`86c12d6ec3dbc59b37485b80d413e66539e4afed`

On that exact code head:

- architecture boundary: PASS;
- typecheck: PASS;
- full inherited + Step 5 tests: PASS;
- build: PASS.

## Source limitation

The supplied Step 5 specification ends at the beginning of required adversarial scenario B, after the line:

`Excellent platform ROAS.`

The complete requirements available before that truncation were implemented.

The retargeting-trap fixture follows the fully specified retargeting requirements earlier in the same source: high pre-existing propensity, high reported performance, and materially lower true incrementality.

No missing continuation beyond the supplied text was invented.

## Research isolation

Step 5 remains PUBLIC and synthetic-only.

No private Kivviq code, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details are used.

PR #14 remains draft and unmerged.
