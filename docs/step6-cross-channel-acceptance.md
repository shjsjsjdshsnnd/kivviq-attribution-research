# Step 6 — Cross-Channel Interactions Acceptance Report

## Frozen foundations

Step 6 is built from the exact frozen Step 5 head:

`23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`

Frozen references:

- Step 1 — GroundTruth: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — merchant/world generation: `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — latent customer population: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- Step 4 — customer journey simulation: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`
- Step 5 — advertising economics: `23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`

PRs #2, #5, #8, #11 and #14 remain frozen and unmodified.

## Core result

Channels are no longer evaluated as independent scalar response functions.

Step 6 makes portfolio state causal:

```
Effect(A | B active) != Effect(A | B inactive)
```

where the merchant interaction graph defines such a dependency.

The evaluator can therefore observe:

```
Value(A + B) != Value(A) + Value(B)
```

while still supporting exact zero-interaction controls where equality reconciles under shared randomness.

## GroundTruth integration

Step 6 does not introduce an incompatible interaction ontology.

Executable interaction rules are compiled from:

- frozen Step 1 `channelInteractions`;
- frozen causal-graph edges with the same mechanism ID;
- typed source variable IDs;
- typed target variable IDs;
- frozen effect scale/unit;
- lag semantics;
- mediator variable;
- population selector;
- provenance.

Each compiled rule records:

- mechanism ID;
- declared frozen interaction kind;
- executable semantic kind;
- participant channels;
- directed driver channels;
- conditioned-on channels;
- target channels;
- source variables;
- target variables;
- effect scale/value/unit;
- functional form;
- lag;
- decay half-life;
- selector/conditions;
- asymmetry;
- higher-order status;
- GroundTruth provenance.

## Interaction taxonomy

The runtime/evaluator supports:

- mediation;
- synergy/complementarity;
- cannibalization;
- substitution;
- audience creation;
- audience depletion/saturation;
- delayed interactions;
- state-dependent interactions;
- explicit zero interaction.

The frozen Step 1 kind remains preserved in provenance even when Step 6 maps it to a more specific executable semantic such as substitution or audience creation.

## Sparse interaction networks

The compiler calculates:

- maximum possible channel-pair count;
- realized nonzero interaction-rule count;
- zero-interaction mechanisms;
- network sparsity.

Merchant interaction graphs are sparse by construction in the deterministic fixtures and can differ materially across merchants.

No fully connected interaction graph is imposed.

## Directionality / asymmetry

Interactions are directional.

A rule records explicit driver and target channels.

Meta → Google mediation therefore does not imply Google → Meta.

Asymmetric structure is tested directly.

## Higher-order interactions

Sparse mechanisms with more than two participant channels are supported.

Higher-order interaction is explicit in the compiled rule and remains sparse.

No combinatorial enumeration of all channel combinations is performed.

## Customer heterogeneity

Interaction response uses Step 3 latent customer heterogeneity.

Customer interaction multipliers depend on:

- channel causal susceptibility;
- product/category affinity;
- purchase intent;
- lifecycle;
- optional population selectors.

The same interaction can therefore be strong for one customer and weak/irrelevant for another.

## Product/category heterogeneity

Frozen Step 1 selectors are applied to Step 3 sparse category/product preferences.

Tests verify product/category-selective interaction response.

## State and time dependence

Interactions can be gated by explicit causal state variables including:

- promotion state;
- inventory availability;
- calendar month;
- customer lifecycle.

Step 6 uses the existing Step 4 clock and memory/decay infrastructure.

No parallel time or adstock engine is introduced.

## Interaction memory / decay

Delayed interactions use Step 4-style decaying memory.

Interaction state stores:

- mechanism ID;
- participant channels;
- current value;
- last updated time;
- half-life.

Tests verify delayed interaction decay.

## Saturation interaction

Step 5 spend/intensity state feeds Step 6 interaction value.

Heavy driver-channel spend applies a saturation adjustment to per-exposure interaction value.

This prevents arbitrarily increasing cross-channel spillover merely by raising spend.

Tests verify interaction value per exposure declines under source-channel saturation.

## Audience overlap

Step 6 explicitly evaluates pairwise reachable-audience overlap from Step 3 channel propensities.

For each channel pair it reports:

- weighted overlap;
- joint reach potential.

The system does not assume independent audiences.

## Meta → branded Search mediation

A directed interaction can encode:

```
Meta exposure
→ brand awareness / readiness
→ branded Search probability
→ Google Search opportunity
→ observed Google performance
```

Branded-search readiness is stored in customer future-audience state and decays through the shared runtime.

The mediation acceptance test removes Meta and requires:

- branded-search readiness to fall;
- Google observed performance to fall.

God mode therefore retains the upstream Meta mechanism even when Google appears later in the observed path.

## Pinterest → Organic / Direct

Pinterest mediation can create delayed organic/direct opportunity through customer interaction memory.

Removing Pinterest in the deterministic fixture reduces later Organic/Direct opportunity.

No organic revenue is directly added.

## Email × promotion

State-dependent interaction supports Email × promotion effects on purchase/conversion response.

A shared-randomness four-world evaluation calculates:

```
Y(email + promotion)
- Y(email only)
- Y(promotion only)
+ Y(neither)
```

The deterministic test requires positive non-additive interaction value.

The runtime also supports zero/negative mechanisms through frozen effect values.

## Meta × Google synergy

Positive-synergy fixtures require:

```
Y(Meta + Google)
>
Y(Meta only)
+ Y(Google only)
- Y(neither)
```

God mode retains direct channel state and interaction value separately where the structural model permits.

## Retargeting audience creation

Future audience state includes:

- retargeting eligibility;
- email eligibility;
- branded-search readiness;
- recent-site-visit score;
- channels that created the audience state.

Prospecting exposure can increase future retargeting/email/search opportunity.

Removing prospecting reduces those future audience quantities.

## Retargeting demand capture

Step 6 preserves Step 5's retargeting-selection problem.

Future retargeting eligibility is not equivalent to causal ownership.

High-propensity customers can remain highly attributable while incremental value is smaller.

## Paid Search cannibalization / substitution

Paid Search can suppress or replace:

- Direct;
- Organic Search;
- another channel opportunity.

When the paid route disappears, latent demand can surface through alternative routes instead of being forced to disappear.

The cannibalization fixture verifies route/attribution movement can exceed the change in total merchant revenue.

## Cross-channel substitution

A channel-removal counterfactual can result in:

- another paid route;
- Organic;
- Direct;
- no purchase.

The simulator does not force removal of an observed paid channel to equal loss of the purchase.

## Complementarity

Conditional response multipliers allow a target channel to become more effective after another channel has created awareness/consideration.

This is distinct from pure mediation because the later channel's response itself changes.

## Portfolio response surface

Evaluator infrastructure supports:

```
Y(
  spend_Meta,
  spend_Google,
  spend_Pinterest,
  spend_Email,
  ...
)
```

through full joint simulation.

No Growth Operator optimizer is implemented.

## Joint interventions

Joint spend/context changes use the frozen Step 1 intervention system.

A joint evaluation runs the whole causal simulation with all requested changes active together.

Joint effects are not calculated by summing independently simulated channel effects.

## Pairwise interaction value

For channels A and B:

```
Interaction(A,B) =
Y(A+B)
- Y(A only)
- Y(B only)
+ Y(neither)
```

using the same merchant, population, time range, simulation seed and shared stochastic structure.

Supported exact outcomes include:

- represented revenue;
- represented orders;
- contribution profit;
- new customers.

## Interaction decomposition

Where the structural model supports it, evaluator diagnostics report:

- direct left-channel value;
- direct right-channel value;
- interaction value;
- total joint value;
- observed downstream channel revenue shift.

The observed downstream shift is explicitly documented as a counterfactual spillover quantity rather than forced causal attribution when unique structural decomposition is unavailable.

## Channel removal

For each active channel, removal evaluation can report changes in:

- merchant revenue;
- contribution profit;
- orders;
- new customers;
- platform-attributed revenue;
- per-source sessions;
- per-source purchases;
- per-source attributed revenue;
- future retargeting audience;
- future email audience;
- future branded-search readiness;
- future recent visitors.

## Reallocation

Controlled reallocation uses shared randomness.

Example:

```
Meta -X
Google +X
```

is evaluated as one portfolio counterfactual.

No optimizer selects the change.

## Multi-horizon effects

The same reallocation can be evaluated at multiple horizons.

The deterministic prospecting-cut fixture tests both:

- 7 days;
- 90 days.

## Zero-interaction control

The explicit control fixture requires exact reconciliation:

```
interaction revenue = 0
interaction orders = 0
interaction new customers = 0
interaction contribution profit = 0
```

This is the control proving the Step 6 runtime does not manufacture interaction where frozen GroundTruth says there is none.

## Positive-synergy fixture

The deterministic synergy fixture requires positive pairwise interaction value and joint revenue above the independent additive expectation.

## Cannibalization fixture

The deterministic Search-cannibalization fixture requires route/attribution movement into Direct/Organic while total merchant revenue changes less.

## Mediation fixture

The deterministic mediation fixture requires Meta removal to reduce:

- branded-search readiness;
- Google observed performance.

This is the hard acceptance case that one channel can causally improve another channel's dashboard.

## Interaction reversal

The deterministic reversal fixture measures Google marginal iROAS under two Meta portfolio states.

Observed acceptance diagnostics on the accepted code head:

```
Google marginal iROAS with Meta inactive: 0.4252639x
Google marginal iROAS with Meta active:   0.5876414x
absolute conditional difference:          0.1623775x
```

Channel value is therefore conditional on portfolio state.

## Hard portfolio reallocation trap

Deterministic fixture:

- Google platform ROAS > Meta platform ROAS;
- Google observed conversion > Meta observed conversion;
- the independent dashboard signals therefore point toward Google;
- moving 65% of Meta spend into Google lowers true contribution profit.

Observed diagnostics:

```
Meta platform ROAS:                 5.8659153x
Google platform ROAS:              26.2887449x

Meta observed conversion:           0
Google observed conversion:         0.0232766

Meta standalone iROAS:              0
Google standalone iROAS:           -3.4499178x

Transferred budget:                 400,298.60 minor units

True contribution-profit delta:     -257,644.80 minor units
True revenue delta:                 -497,952.00 minor units
```

The source requirement says the misleading channel may even have higher standalone average iROAS; that clause is optional. The fixture enforces the mandatory misleading independent signals—platform ROAS and observed conversion—and the exact negative joint portfolio outcome.

## Prospecting-cut trap

The deterministic prospecting fixture cuts Meta prospecting by 50%.

Observed shared-randomness diagnostics:

```
7-day contribution-profit delta:      +777.78 minor units

90-day contribution-profit delta:     -214,418.02 minor units
90-day revenue delta:                 -424,340.89 minor units

90-day branded-search audience delta: -0.11269
90-day retargeting audience delta:    -0.78928
90-day email audience delta:          -89.47714
```

The short-term conclusion and long-term conclusion disagree exactly as required.

## Final code-head validation

The implementation head before acceptance-report packaging is:

`0151184a8e1c67191bce7085f2a1ab0454dd14d9`

On that exact head:

- architecture boundary: PASS;
- typecheck: PASS;
- full inherited + Step 6 tests: PASS;
- build: PASS.

## Acceptance-test coverage

Step 6 tests explicitly cover:

- zero interactions;
- sparse/higher-order/asymmetric structure;
- causal-graph-derived mediation targets;
- audience overlap;
- customer heterogeneity;
- product/category selectors;
- promotion-state gating;
- calendar-month gating;
- merchant-specific networks;
- Step 4 interaction-memory decay;
- source-channel saturation;
- portfolio response;
- pairwise interaction value;
- zero-control additivity;
- positive synergy;
- Email × promotion;
- interaction reversal;
- Meta → Google mediation;
- Pinterest → Organic/Direct;
- Search → Direct/Organic cannibalization/substitution;
- future retargeting/email/search audiences;
- mediated observed Google revenue;
- channel removal;
- portfolio reallocation;
- portfolio reallocation trap;
- 7-day vs 90-day prospecting-cut trap;
- Operator/God-mode isolation.

All inherited Step 1–5 tests remain in the Step 6 CI suite.

## Source limitation

The supplied Step 6 source ends at the heading:

`40. RETARGETING-C`

No complete requirement text appears after that heading.

All complete requirements through Section 39 were audited/implemented.

No unseen continuation of Section 40 was invented.

## Research isolation

Step 6 remains PUBLIC and synthetic-only.

No private Kivviq code, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details are used.

PR #15 remains draft and unmerged.
