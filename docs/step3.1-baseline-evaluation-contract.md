# Step 3.1 — Baseline Evaluation Contract

## Status

This document defines the canonical evaluation contract that must be satisfied before any Phase 3 baseline operator is implemented.

The governing rule is:

> An operator may differ in how it makes decisions, but not in what information, opportunities, constraints, worlds, time horizons, or scoring rules it receives.

Step 3.1 defines the comparison environment only. It does not implement a baseline operator, recommendation engine, optimizer, decision policy, oracle-driven policy, or production execution system.

## Repository lineage

The Step 3.1 branch is stacked on the Action Space lineage so it can bind directly to the complete canonical Kivviq Action Ontology.

The ecommerce simulator research continued on a separate lineage after the common Step 8 product-economics foundation. Step 3.1 deliberately does not merge or silently reconcile those research histories. Instead, every evaluation run is required to bind an explicit:

- simulator version;
- world/scenario ID;
- world fingerprint;
- complete seed set;
- evaluation contract fingerprint;
- metric-definition fingerprint.

A later benchmark runner may consume the compatible simulator implementation, but the contract remains the authority for comparison conditions. A run without those bindings is invalid.

## Canonical contract

The evaluator-only module is:

`src/evaluation/baseline-contract.ts`

The frozen schema version introduced here is:

`baseline evaluation contract 1.0.0`

The contract includes:

- contract identity and semantic version;
- explicit observation boundary;
- decision cadence;
- canonical Action-space contract;
- business-constraint contract;
- simulation-world specification;
- common-random-number and seed policy;
- evaluation horizons;
- versioned canonical metric definitions;
- comparison-validity requirements;
- provenance and deterministic fingerprint.

The contract is recursively frozen after validation. Serialized copies are accepted only when their deterministic fingerprint matches their semantic body.

Any future semantic change requires a new explicit contract version. Existing benchmark results remain tied to the contract fingerprint and version under which they were generated.

## Operator observation boundary

The operator may receive only information explicitly classified as:

- observable merchant data;
- derived observable metrics;
- historical information inside the allowed history window;
- current-state information.

The contract forbids:

- simulator latent state;
- future information;
- evaluator-only metrics.

Each observation record carries:

- observation key;
- information class;
- `sourceMinOccurredAt`, the earliest event/snapshot time used to construct it;
- `sourceMaxOccurredAt`, the latest event/snapshot time used to construct it;
- `availableAt`, the time the completed observation became available;
- source reference;
- value.

The contract freezes an allowlist of observable source-reference families. New source families require an explicit contract change rather than silently becoming operator-visible.

The observation builder fails closed when:

- the information class is not permitted;
- the source time range is inverted;
- the latest source event occurs after the decision timestamp;
- the completed observation becomes available after the decision timestamp;
- an observation claims to be available before its latest source event;
- the earliest source event exceeds the allowed historical lookback;
- its source reference is not in the frozen observable-source allowlist;
- its source reference identifies simulator, GroundTruth, oracle, evaluator, benchmark, or holdout state;
- latent/God-mode keys are detected recursively;
- benchmark/world/run identity keys are detected recursively;
- unrestricted metadata is used as a covert channel.

Equivalent permitted observations are sorted canonically and receive a deterministic observation fingerprint.

## Decision cadence

Contract 1.0.0 uses a daily fixed decision cadence anchored to the intervention start.

Every decision opportunity has:

- deterministic opportunity ID;
- sequence number;
- timestamp;
- trigger provenance.

A decision opportunity is recorded even when the operator proposes no action.

The validator rejects actions whose declared decision time does not match the actual decision opportunity. Equivalent ISO-8601 renderings are compared by timestamp instant, not raw string formatting.

The contract also defines typed future-compatible cadence forms for:

- every N simulation ticks;
- event-triggered opportunities.

Those alternatives require a new contract instance/version when used for a benchmark.

## Canonical action space

The legal business action language is derived mechanically from the canonical Action Ontology registry.

The evaluation contract freezes, for every action type:

- action type;
- action category;
- allowed target kinds;
- required parameter kind;
- Action Ontology schema version.

At every decision opportunity, the evaluator additionally freezes an availability snapshot containing:

- action types legally available now;
- eligible targets;
- permitted numeric parameter bounds;
- required preconditions;
- explicit mutual-exclusion groups.

Every emitted Action is validated first by the canonical Action validator and then against the frozen per-decision availability snapshot.

Operators may select different legal Actions. They may not receive different legal action possibilities inside the same comparison.

## Business constraints

The contract binds the same merchant constraints to every operator, including canonical properties covering:

- advertising budget;
- pricing;
- promotions;
- inventory and availability;
- supplier constraints;
- warehouse capacity;
- campaign/channel existence and eligibility;
- gross/contribution economics;
- shipping economics;
- fulfillment capacity;
- measurement availability.

It also reserves explicit benchmark dimensions for available cash, reorder limits, price bounds, channel restrictions, campaign eligibility, and SKU availability.

Handling is deterministic:

| Situation | Contract behavior |
| --- | --- |
| invalid Action | reject |
| infeasible Action | reject |
| partially feasible Action | reject unless an explicit replacement Action is supplied and separately validated |
| conflicting Action | reject |
| silent evaluator modification | forbidden |

Rejected and modified decisions remain part of evaluation provenance.

## Simulation-world specification

Every comparison uses the same declared world specification, covering:

- merchant characteristics;
- products;
- customers;
- latent customer properties;
- customer journeys;
- demand;
- advertising economics;
- cross-channel interactions;
- inventory;
- pricing;
- retention;
- seasonality;
- external events.

Every run must provide a world ID, world fingerprint, and three-letter world currency. Metric money units are explicitly bound to that world currency.

Tests also exercise the existing deterministic merchant-world generator directly: the same generation version, seed, and configuration must reproduce the identical GroundTruth manifest, generation provenance, and merchant summary.

## Randomness and common random numbers

Shared stochastic namespaces are:

- world generation;
- customer generation;
- customer behavior;
- demand;
- advertising response;
- journey transitions;
- external events.

Those seeds are shared across operators.

`operator_internal` randomness is explicitly separate and operator-specific. Exactly one seed is required for every namespace, and the run artifact verifies that the operator-internal seed is bound to the operator being evaluated. Operator-internal randomness is excluded from the comparison binding used to prove equivalent environmental randomness.

Operator interventions may cause later trajectories to diverge. The contract does not require identical post-intervention state; it requires differences to arise from policy choices and their consequences rather than uncontrolled initialization.

All seeds are recorded in the evaluation artifact.

## Evaluation horizons

Contract 1.0.0 explicitly declares:

- 30-day warm-up period;
- 90-day historical observation window;
- 90-day intervention period;
- 90-day outcome-measurement period;
- 30-day delayed-effect window.

Given the intervention start, the evaluator deterministically derives and records warm-up start/end, history start/end, intervention start/end, outcome-measurement start/end, and delayed-effect end timestamps.

These values are benchmark-contract semantics, not operator choices. Changing them requires a new contract version or a separately versioned benchmark contract.

No operator may receive more history or a different scoring window inside the same comparison. Under the canonical daily cadence, the artifact validator also requires every scheduled decision opportunity across the intervention horizon; a missing no-op opportunity invalidates the run.

## Canonical metric set

Metric-set version `1.0.0` defines formulas, populations, windows, units, aggregation methods, currency semantics, and visibility for each metric.

Required merchant/business outcomes include:

- revenue;
- gross profit;
- contribution profit;
- orders;
- units sold;
- AOV;
- CAC;
- ROAS;
- advertising spend;
- new customers;
- repeat customers;
- retention;
- realized cohort CLV;
- inventory remaining;
- stockouts;
- lost demand;
- returns;
- discount cost;
- shipping/fulfillment cost;
- action/intervention cost.

Evaluator-only causal metrics are defined separately:

- true incremental contribution profit;
- causal lift;
- counterfactual regret.

A metric being used for evaluation does not make it operator-observable.

Every run artifact must contain exactly one result slot for every frozen metric definition. A value may be `null` when the metric is undefined under its declared formula, but an operator cannot choose which metrics are emitted or scored.

## Evaluator knowledge versus operator knowledge

The Step 3.1 contract is exported only from the explicit `./evaluation` package surface.

It is intentionally absent from the Operator-safe root API.

The existing dependency-cruiser architecture rule prevents Operator-facing modules from importing evaluator, oracle, GroundTruth, generation, latent-customer, simulation, or other God-mode modules.

The evaluator may use simulator truth to calculate evaluator-only outcomes. The observation boundary is the only path through which evaluation information can become operator-visible.

## Comparison binding

Before comparing two operators, the evaluator creates a deterministic comparison binding containing:

- contract fingerprint;
- simulator version;
- world ID;
- world fingerprint;
- world currency;
- horizon fingerprint;
- exact horizon timestamps;
- metric-set fingerprint;
- shared environmental seeds.

Two operators are comparable only if those bindings are exactly equal.

Operator-internal random seeds are recorded but do not have to match.

## Evaluation-run artifact

Each run produces a machine-readable artifact with:

```text
Evaluation Contract
        ↓
World + Seeds
        ↓
Permitted Observations
        ↓
Decision Opportunities
        ↓
Operator
        ↓
Proposed Actions
        ↓
Constraint Validation
        ↓
Executed / Rejected / Modified Actions
        ↓
Simulation Outcomes
        ↓
Canonical Metrics
```

The artifact records:

- deterministic evaluation-run ID;
- evaluation contract ID/version/fingerprint;
- operator ID/version/fingerprint;
- simulator version;
- world/scenario ID, fingerprint, and currency;
- complete seed set;
- the full derived horizon timeline;
- every decision opportunity, including explicit no-action opportunities;
- the actual permitted observation snapshot plus its fingerprint;
- the actual legal-action availability snapshot plus its fingerprint;
- every raw Action proposal plus its payload fingerprint;
- canonical Action-space validation result;
- accepted/rejected/modified constraint disposition;
- exact executed Action when one exists;
- outcome summary;
- metric set version;
- metric-definition fingerprint;
- one result slot per canonical metric;
- artifact fingerprint.

The artifact validator recomputes observation, availability, proposal, Action, and metric-definition fingerprints rather than trusting recorded hashes.

This is sufficient to distinguish a policy-driven outcome difference from a difference in evaluation conditions.

## Leakage and benchmark-integrity safeguards

The contract fails closed against:

- hidden simulator state entering observations;
- future source events entering backdated observations or derived metrics;
- future data entering observations;
- evaluator-only metrics entering observations;
- simulator/evaluator/oracle/benchmark source references entering observations;
- benchmark/world/run identity fields entering observations;
- unrestricted metadata covert channels;
- non-contract action types;
- ineligible targets;
- out-of-range parameters;
- missing required preconditions;
- acting at a non-permitted decision time;
- inconsistent shared world/seed/horizon/metric bindings;
- contract mutation without fingerprint change;
- omitted metric results.

The validity contract also explicitly prohibits:

- seed-specific hardcoding;
- benchmark-world identification followed by special-case behavior;
- direct operator access to evaluator-only metrics.

The benchmark runner built in a later step must enforce those declared prohibitions at its process/module boundary; Step 3.1 does not implement a decision operator.

## Test gate

Step 3.1 tests cover:

- deterministic contract fingerprint and deep immutability;
- mutation/fingerprint rejection;
- complete world and metric dimensions;
- same-seed world-generation reproduction;
- identical permitted observations independent of input ordering;
- future/latent/evaluator/covert-data rejection;
- identical decision cadence;
- identical legal Action availability;
- canonical Action validation at the decision boundary;
- delayed-decision rejection;
- deterministic mutual-exclusion handling;
- deterministic invalid/infeasible/partial/modified constraint handling;
- shared-randomness equality with separate operator-internal seeds;
- evaluator-only metric separation;
- deterministic self-auditing run artifacts;
- complete fixed-cadence opportunity recording, including no-action decisions;
- raw Action-attempt, validation, disposition, and executed-Action provenance;
- artifact tamper rejection;
- mandatory complete metric-result set;
- evaluator surface exclusion from the Operator-safe root API.

CI must pass:

1. dependency-cruiser architecture boundary;
2. strict TypeScript typecheck;
3. focused Step 3.1 tests;
4. the full inherited test suite;
5. TypeScript build.

## Freeze rule

Step 3.1 can be declared frozen only when:

- the exact predecessor commit is recorded;
- the exact Step 3.1 head is recorded;
- all CI gates pass at that head;
- the Action Ontology schema version is fixed in the contract;
- observation, cadence, action-space, constraint, seed, horizon, and metric semantics are fixed;
- the resulting contract and run artifacts are reproducible from their recorded fingerprints.

Do not implement baseline operators until that gate is satisfied.
