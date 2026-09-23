# Step 3.4 — Simple Advertising Heuristic Baselines

## Purpose

Step 3.4 adds five intentionally simple advertising benchmark operators:

1. `EQUAL_BUDGET_ALLOCATION`
2. `ROAS_THRESHOLD_INCREASE`
3. `ROAS_THRESHOLD_DECREASE`
4. `HIGHEST_OBSERVED_ROAS`
5. `FIXED_CHANNEL_ALLOCATION`

They are spreadsheet-level merchant rules. They are not optimizers.

The suite is stacked on the exact frozen Step 3.3 head:

`a2ab0b96451894a3cd5e8c62186b5c9faeaea289`

Frozen dependencies:

- Step 3.1 contract commit: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 contract fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`
- advertising economics: `advertising-economics-5.0.0`

Step 3.1, `DO_NOTHING` and `STATUS_QUO` are not modified.

## Canonical operator contract

All five operators use the same `CanonicalOperator` interface as the existing baselines and the same generic evaluator path.

Every operator has:

- a unique operator ID;
- version `1.0.0`;
- a frozen heuristic type;
- a serializable deterministic configuration;
- a configuration fingerprint;
- a distinct implementation fingerprint;
- exact evaluation-contract and Action Ontology dependencies;
- metric-set and advertising-economics dependencies.

No heuristic-specific evaluator path exists.

## Advertising-only action boundary

The suite emits only canonical:

`advertising.adjust_budget`

Actions against legally eligible `advertising_channel` targets.

The suite never emits pricing, promotion, merchandising, inventory, shipping, product, CRO, lifecycle or customer-targeting Actions.

Each proposed budget Action is still subject to the normal Step 3.1:

1. Action-space validation;
2. eligibility validation;
3. parameter bounds;
4. business-constraint assessment;
5. accepted/rejected/explicitly-modified disposition recording.

The heuristic layer does not silently repair illegal or infeasible Actions.

## Observable advertising input

The frozen operator observation key is:

`advertising.channel_metrics.v1`

Schema version: `1.0.0`.

Each channel record supplies only operator-observable information:

- channel ID;
- active state;
- currency;
- current weekly budget;
- observed spend;
- observed attributed revenue;
- available history days.

ROAS is deterministically derived as:

`observed attributed revenue / observed spend`

when spend is positive.

The attribution semantic is explicitly:

`operator_observed_attributed_revenue`

It is not true incremental revenue.

The heuristic never receives or derives:

- true incremental ROAS;
- latent response curves;
- GroundTruth channel effectiveness;
- future revenue/conversions;
- counterfactual outcomes.

Zero spend does not produce infinite or guessed ROAS. It produces unavailable ROAS.

Missing spend, missing attributed revenue, insufficient history, inactive channels and unavailable legal targets deterministically produce no discretionary change where the rule requires that evidence.

## Stable channel ordering

Frozen stable ordering:

1. `google_ads`
2. `meta_ads`
3. `pinterest_ads`
4. any other channel lexicographically after configured channels

This ordering is used for deterministic residual allocation and ROAS tie-breaking.

No database, map or runtime iteration order determines a benchmark decision.

## EQUAL_BUDGET_ALLOCATION

Operator ID:

`baseline.advertising.equal_budget_allocation`

Frozen semantics:

- budget semantics: `REALLOCATE_CURRENT_TOTAL`;
- ignore observed performance;
- sum current budgets for eligible active channels;
- split that same total equally across those channels;
- allocate indivisible minor-unit residuals in stable channel order;
- minimum channel budget: 0;
- maximum channel budget: CAD 20,000/week;
- infeasible allocation: no discretionary change.

Unavailable channels are excluded from the mutable allocation pool and are not created or modified.

No ROAS/CAC/revenue/profit signal can alter the equal-allocation rule.

## ROAS_THRESHOLD_INCREASE

Operator ID:

`baseline.advertising.roas_threshold_increase`

Frozen configuration:

- ROAS threshold: `3.0`;
- lookback: 7 days;
- minimum history: 7 days;
- increase: 10%;
- maximum increase per decision: CAD 1,000/week;
- maximum channel budget: CAD 15,000/week;
- budget semantics: `INCREASE_TOTAL_SPEND`.

Rule:

`observed ROAS > 3.0 → increase spend`

Exactly 3.0 does not trigger.

Missing/zero-spend/insufficient evidence does not trigger.

The rule does not offset the increase elsewhere; total advertising spend may increase.

## ROAS_THRESHOLD_DECREASE

Operator ID:

`baseline.advertising.roas_threshold_decrease`

Frozen configuration:

- ROAS threshold: `1.5`;
- lookback: 7 days;
- minimum history: 7 days;
- decrease: 10%;
- maximum decrease per decision: CAD 1,000/week;
- minimum channel budget: CAD 1,000/week;
- budget semantics: `DECREASE_TOTAL_SPEND`.

Rule:

`observed ROAS < 1.5 → decrease spend`

Exactly 1.5 does not trigger.

Missing/zero-spend/insufficient evidence does not trigger.

Total advertising spend may decrease.

## HIGHEST_OBSERVED_ROAS

Operator ID:

`baseline.advertising.highest_observed_roas`

Frozen configuration:

- lookback: 7 days;
- minimum history: 7 days;
- incremental reallocation: CAD 1,000/week;
- winner: highest observable ROAS;
- funding rule: lowest observable-ROAS eligible channel;
- winner/donor tie-break: stable channel ordering;
- minimum channel budget: CAD 1,000/week;
- maximum channel budget: CAD 15,000/week;
- budget semantics: `REALLOCATE_CURRENT_TOTAL`.

The same configured amount is added to the winner and removed from the donor, so the reallocation conserves total budget exactly.

If the winner lacks headroom or the donor lacks the frozen minimum budget after transfer, the rule makes no discretionary change.

This operator deliberately does not correct observed ROAS for:

- incrementality;
- attribution bias;
- cannibalization;
- customer quality;
- CLV;
- delayed effects;
- inventory constraints.

Those errors are part of the benchmark.

## FIXED_CHANNEL_ALLOCATION

Operator ID:

`baseline.advertising.fixed_channel_allocation`

Frozen channel weights:

- Google Ads: 50%;
- Meta Ads: 35%;
- Pinterest Ads: 15%.

Frozen semantics:

- budget semantics: `MAINTAIN_CURRENT_TOTAL`;
- recompute target budgets from the current total budget;
- preserve the 50/35/15 proportions;
- largest-remainder rounding, then stable channel order;
- minimum channel budget: 0;
- maximum channel budget: CAD 20,000/week;
- unavailable configured channel: no discretionary change;
- infeasible constrained allocation: no discretionary change.

Observed ROAS, CAC, revenue, conversion and profit cannot alter the frozen allocation.

## Constraint behavior

Legal Action-space eligibility is authoritative.

A channel is only considered eligible when:

- `advertising.adjust_budget` is available;
- the channel appears as an eligible `advertising_channel` target;
- the observable channel is active;
- the legal rule does not require preconditions the heuristic cannot materialize.

Frozen legal numeric bounds are checked before proposal.

The generic evaluator remains authoritative for final validation and business constraints.

Tests explicitly demonstrate:

- accepted proposals;
- rejected proposals;
- explicitly modified proposals;
- no silent repair.

## Decision rationale

Every invocation records deterministic rule-execution provenance including:

- heuristic type;
- operator/configuration/implementation identities;
- dependency versions;
- observation availability;
- lookback/attribution semantics;
- budget semantics;
- eligible channels;
- current budgets;
- observed spend;
- observed attributed revenue;
- derived observable ROAS;
- ROAS evidence status;
- target budgets;
- threshold where applicable;
- selected winner;
- funding channel;
- tie-break result;
- fallback reason;
- proposed Action IDs.

This is rule execution evidence, not a post-hoc narrative explanation.

## Missing-data policy

Frozen fallback:

`insufficient or incompatible evidence → no discretionary change`

No heuristic fills missing data with estimates.

Examples include:

- missing platform observation;
- invalid schema;
- missing spend;
- missing attributed revenue;
- zero spend for ROAS-based rules;
- insufficient history;
- lookback mismatch;
- no eligible active channels;
- required legal preconditions unavailable;
- infeasible fixed increment;
- legal parameter-bound violation.

## Anti-optimization boundary

The suite contains no:

- forecasting;
- causal inference;
- incrementality estimation;
- attribution correction;
- marginal-ROAS modeling;
- response curves;
- elasticity;
- Bayesian optimization;
- reinforcement learning;
- multi-armed bandits;
- customer-level optimization;
- CLV optimization;
- inventory-aware advertising optimization.

Adversarial tests supply information indicating that the simple ROAS rule may be economically wrong. The output remains unchanged because those facts are not part of the frozen heuristic rule.

## Paired comparisons

All five heuristic operators use the frozen Step 3.1 comparison binding.

Tests prove equivalent comparison-critical bindings against:

- `DO_NOTHING`;
- `STATUS_QUO`;
- every Step 3.4 heuristic.

The shared binding includes:

- evaluation contract;
- simulator version;
- world ID/fingerprint;
- currency;
- horizon;
- metric definitions;
- environmental seed namespaces.

Only the operator-specific seed binding and policy behavior differ.

## Evaluation artifacts

A deterministic 90-opportunity artifact fixture is constructed for every heuristic.

Each artifact preserves:

- evaluation contract;
- operator ID/version/fingerprint;
- configuration fingerprint/configuration;
- Action Ontology version;
- simulator version;
- world fingerprint;
- metric-set version;
- currency;
- seeds;
- horizon;
- observations;
- legal Action snapshots;
- heuristic decision audit;
- raw proposals;
- Action validation;
- constraint disposition;
- executed Action where applicable;
- outcome summary;
- every canonical metric slot.

Synthetic artifact fixtures prove the contract and provenance shape. They are not benchmark performance results.

## Freeze rule

All policy constants are preregistered in code before benchmark outcome evaluation.

If future research needs a different threshold, lookback, increment, channel weight, tie-break or fallback policy, it must receive a distinct configuration fingerprint and, where semantics change, a new operator version.

Step 3.4 does not choose the best parameterization after observing benchmark outcomes.
