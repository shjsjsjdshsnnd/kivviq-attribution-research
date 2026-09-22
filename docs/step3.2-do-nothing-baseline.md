# Step 3.2 — Canonical `DO_NOTHING` Baseline

## Purpose

The canonical `DO_NOTHING` baseline establishes the absolute benchmark reference condition:

> What happens to the simulated business when the operator receives the same information and opportunities as every other participant but makes zero discretionary interventions?

The operator participates in the normal evaluation protocol. It does not freeze the business and does not bypass evaluator machinery.

## Frozen dependency

Step 3.2 is built from the exact frozen Step 3.1 head:

`c74e9a4ba32f16aa016f06782cbb60e07e765af6`

It supports:

- Baseline Evaluation Contract `1.0.0`
- Step 3.1 contract fingerprint `fnv1a64:b1cc22917a3e566b`
- Action Ontology `1.6.0`

Step 3.1 is not modified by this step.

## Canonical operator interface

Step 3.2 introduces a reusable Operator-safe interface under `src/operator`.

Every operator supplies typed metadata:

- operator ID;
- operator type;
- operator version;
- description;
- supported evaluation-contract ID/version/fingerprint/frozen commit;
- supported Action Ontology version;
- deterministic configuration;
- implementation fingerprint.

Every invocation receives only:

- decision opportunity ID and timestamp;
- the already-governed Step 3.1 observation records;
- the legal Action-space snapshot for that opportunity.

The interface does not expose:

- world identity;
- world fingerprint;
- seeds;
- GroundTruth;
- simulator latent state;
- evaluator-only metrics;
- future outcomes;
- benchmark identity.

The evaluator adapter performs the Step 3.1 compatibility and information-boundary checks before invoking an operator.

## `DO_NOTHING` identity

- Operator ID: `baseline.do_nothing`
- Operator type: `baseline`
- Operator version: `1.0.0`

The deterministic configuration is:

```text
policy = always_return_empty_action_array
discretionaryActionLimit = 0
usesPolicyRandomness = false
readsBusinessConditionsToChooseIntervention = false
discretionaryInterventionsEnabled = false
```

The implementation fingerprint is emitted by CI and frozen with the final accepted head.

## Decision semantics

At every valid decision opportunity:

1. Step 3.1 constructs the permitted observation.
2. Step 3.1 constructs the legal Action-space snapshot.
3. The normal evaluator adapter invokes `DO_NOTHING`.
4. The operator returns exactly:

```text
Action[] = []
```

5. The evaluator records a `NO_DISCRETIONARY_ACTIONS` invocation disposition.
6. The normal Step 3.1 decision record contains zero Action attempts.
7. The simulator continues.

The operator does not emit the canonical `no_op.do_nothing` business Action. That Action remains part of the Action Ontology, but this baseline represents absence of discretionary intervention by an empty Action proposal, not by fabricating an intervention.

## No intervention versus no business

`DO_NOTHING` means no new discretionary operator Action.

It does not mean:

- zero customer activity;
- zero journeys;
- zero purchases;
- zero existing paid-media effects;
- zero organic demand;
- zero seasonality;
- zero inventory consumption;
- zero costs;
- zero repeat behavior;
- zero exogenous events.

Existing world configuration and autonomous simulator dynamics remain world behavior.

A pre-existing mechanism in the frozen synthetic world remains a world mechanism unless it is explicitly represented as a new canonical Action proposed by the operator. Ambiguous ownership is not assigned to `DO_NOTHING`.

## Normal evaluation adapter

`src/evaluation/operator-evaluation.ts` is generic infrastructure, not a `DO_NOTHING` special path.

It:

- checks operator/contract compatibility;
- projects the Step 3.1 observation and legal Action snapshot into the Operator-safe interface;
- freezes the operator input;
- invokes the operator;
- validates the output shape;
- records the output fingerprint and proposal count;
- routes non-empty Action proposals through the Step 3.1 Action validator;
- requires the normal constraint assessor before any valid discretionary Action can be accepted;
- records the Step 3.1 decision record;
- records one operator invocation audit per opportunity.

For `DO_NOTHING`, the output contains no Actions, so no discretionary Action can reach constraint acceptance or execution.

## Self-auditing bundle

Step 3.2 adds a generic `OperatorEvaluationBundle` containing:

- the canonical Step 3.1 `EvaluationRunArtifact`;
- one operator invocation audit for every decision opportunity;
- a deterministic bundle fingerprint.

The bundle verifies:

- invocation count equals decision-opportunity count;
- operator identity matches the evaluation artifact;
- every invocation matches the recorded opportunity;
- observation fingerprints match;
- legal Action-space fingerprints match;
- proposal counts match Step 3.1 Action-attempt records;
- `NO_DISCRETIONARY_ACTIONS` implies exactly zero proposals and zero Action attempts.

This makes deliberate non-intervention auditable without modifying the frozen Step 3.1 artifact schema.

## Canonical metrics

`src/evaluation/canonical-metrics.ts` evaluates the frozen Step 3.1 metric slots from the simulator output where the frozen simulator exposes sufficient evidence.

Directly supported by `customer-journey-simulator-4.0.0` include:

- revenue;
- gross profit;
- contribution profit;
- represented orders;
- units sold;
- AOV;
- new customers;
- repeat customers;
- discount cost;
- shipping/fulfillment cost;
- Action cost.

For `DO_NOTHING`, Action cost is exactly zero.

Metric definitions that require evidence not exposed by the frozen simulator result remain explicit `null` slots rather than being guessed. This includes, where unavailable from the frozen simulator surface, exact total advertising spend/CAC/ROAS, retention denominator, realized cohort CLV, final inventory balance, stockout count, lost demand, returns, and evaluator-only counterfactual metrics.

Every frozen Step 3.1 metric still receives exactly one result slot.

## Simulator dependency and lineage

Validation uses the simulator present on the exact Step 3.1 lineage:

`customer-journey-simulator-4.0.0`

Step 3.2 does not import or merge the later Step 9 inventory-dynamics, Step 10 pricing/promotions, or Step 11 retention branches.

This is deliberate. The frozen Step 3.1 qualification remains in force: future benchmark runs must explicitly bind the simulator version, world fingerprint, Action Ontology version, evaluation-contract version/fingerprint, metric-set version, currency, and seeds.

If a later simulator lineage is adopted, it requires an explicit integration/versioning step rather than a silent upgrade of `DO_NOTHING`.

## Natural-business validation fixture

The structural simulator fixture:

- generates a synthetic adversarial merchant world;
- generates the matching latent customer population;
- simulates from the Step 3.1 warm-up start through delayed-effect end;
- passes `interventions: []`;
- invokes `DO_NOTHING` at every Step 3.1 daily opportunity;
- builds observations only from information available by each decision timestamp;
- records discretionary legal Action options at every opportunity;
- calculates the canonical metric result set;
- creates the Step 3.1 evaluation artifact;
- wraps it in the generic operator-evaluation bundle.

Acceptance requires simultaneously:

```text
operator discretionary Actions = 0
simulator interventions = 0
customer/business activity > 0
orders > 0
revenue > 0
fulfilled units > 0
realized business costs > 0
```

The frozen simulator does not expose a final inventory balance in `SimulationResult`. Fulfilled unit flow therefore proves inventory-consuming commerce occurred, while the canonical `inventory_remaining` metric remains `null` rather than inventing evaluator state.

## Adversarial invariance

Tests expose the operator, through the normal governed observation path, to conditions representing:

- extremely high ROAS;
- collapsed ROAS;
- critically low inventory;
- sold-out product;
- demand spike;
- conversion collapse;
- deteriorating margin;
- large promotional opportunity;
- a substantially more profitable alternative product.

Every condition must still produce:

```text
Action[] = []
```

There are no business thresholds, forecasting rules, causal estimators, recommendation logic, optimization objectives, or learned policies in the operator.

## Paired-comparison readiness

The Step 3.2 artifact preserves the same:

- evaluation contract;
- simulator version;
- world identity/fingerprint;
- world currency;
- environmental seeds;
- horizon;
- canonical metric definitions.

Step 3.1 comparison bindings exclude operator-internal randomness, so a future operator can be paired against `DO_NOTHING` under common random numbers without changing this baseline.

No ranking or candidate-vs-baseline verdict is implemented in Step 3.2.

## Freeze gate

Step 3.2 may be frozen only when the exact head passes:

1. architecture boundary;
2. strict typecheck;
3. focused Step 3.2 tests;
4. full inherited + Step 3.2 suite;
5. build;
6. fingerprint emission.

The freeze record must include:

- exact Step 3.1 dependency commit;
- operator ID/version;
- implementation fingerprint;
- deterministic configuration fingerprint;
- Action Ontology version;
- evaluation-contract fingerprint;
- simulator version used for validation;
- test counts and CI run.

Future substantive changes require a new operator version.
