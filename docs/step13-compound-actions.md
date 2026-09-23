# Step 13 — Canonical Compound Actions

## Governing invariant

A CompoundAction is one coordinated merchant decision composed of valid canonical atomic Actions plus explicit coordination relationships.

It answers **how several interventions belong to one decision**. It does not decide whether the decision is desirable.

No optimizer, recommendation engine, prediction layer, execution orchestrator, transaction manager, experiment assignment engine or provider execution API belongs in this layer.

## Canonical contract

The Step 13 `./compound-action` package is the canonical composition model.

It provides:

- stable `compoundActionId` distinct from component and atomic Action identity
- atomic Action components only; arbitrary recursive CompoundAction nesting is rejected
- optional typed component roles: SOURCE, DESTINATION, PRIMARY, SUPPORTING, TRIGGER, DEPENDENT and CONTROL
- explicit ORDERED / UNORDERED semantics
- START_TOGETHER / EFFECTIVE_TOGETHER / INDEPENDENT_TIMING concurrency
- typed START_AFTER / EFFECTIVE_AFTER / COMPLETE_AFTER / REQUIRES / END_WITH dependencies
- dependency identity, reference validation and cycle rejection
- generic cross-family composition rather than combination-specific schemas
- compound-level hard constraints, including deterministic monetary conservation and known incremental-media caps
- explicit population INHERIT / OVERRIDE / NOT_APPLICABLE semantics
- explicit timing INHERIT / OVERRIDE / DEPENDENT semantics using Step 12 ActionTiming
- ALL_OR_NOTHING / BEST_EFFORT / DEPENDENCY_GATED atomicity intent
- explicit failure and completion semantics
- compound rollback policy separate from each embedded Action's domain-specific rollback contract
- deterministic measurement horizon and provenance

The original Step 1 `action_ontology.CompoundAction` ID-list readiness shape is deprecated and retained only for historical schema compatibility. New compound decisions use `./compound-action`.

## Readiness, rollback and evidence

Runtime/evaluation state is kept outside the immutable CompoundAction.

Separate contracts provide:

- `CompoundActionReadiness`: READY / PARTIALLY_READY / BLOCKED / UNKNOWN plus per-component structural, eligibility, context, population, timing, simulator and execution-capability state
- `CompoundRollbackReadiness`: rollbackable, irreversible, conflicting, missing-context and unknown components
- reverse dependency rollback ordering
- compensation requirements for irreversible components without pretending compensation is rollback
- conflict preservation so a compound rollback cannot bypass later legitimate domain decisions
- compound cost summaries that aggregate only compatible additive monetary dimensions
- compound resource summaries that refuse incompatible-unit aggregation
- categorical compound risk summaries that retain component risks without inventing a numeric score

## Population boundary

Step 13 does not create a second population system.

The repository's `action-space/step11-customer-targeting` branch currently contains no implemented Step 11 population subsystem. Compound population handling therefore preserves explicit canonical references and binding times and fails closed when membership resolution is unavailable.

The Step 13 boundary is:

`CompoundAction population binding -> external canonical PopulationDefinition/PopulationEvaluation resolution`

No customer scoring, segmentation discovery, desirability or prediction is introduced.

## Timing

Compound timing reuses Step 12.

A component must explicitly declare:

- INHERIT
- OVERRIDE
- DEPENDENT

There is no hidden timing inheritance.

`resolveCompoundTiming` preserves the compound effective window, component timing resolutions, ordering and unresolved dependency relationships. Recurring coordinated initiatives remain one canonical CompoundAction; the composition layer does not expand them into unrelated merchant decisions or build a scheduler.

## Translation and causal identity

Compound translation reuses the existing atomic translators.

```text
CompoundAction
    -> deterministic component flattening
    -> canonical atomic Action
    -> existing atomic translator
    -> SimulatorIntervention[]
```

Every translated intervention preserves:

- compound ID as `originatingBusinessActionId`
- atomic Action ID as `sourceActionId`
- component index/count
- intervention index/count

One component may translate to multiple interventions.

Unsupported components are never silently removed:

- ALL_OR_NOTHING -> complete compound is NOT_TRANSLATABLE
- BEST_EFFORT -> PARTIALLY_TRANSLATED is explicit when supported components translate
- all per-component results remain present

WAIT/OBSERVE, INVESTIGATE and NO_OP preserve their zero-causal-intervention semantics. RUN_EXPERIMENT remains an experiment-engine boundary.

## Canonical fixtures

The required 25-fixture acceptance matrix covers:

1. conserved Meta -> Google CAD 2,000/week reallocation
2. promotion + email + Google Shopping campaign
3. promotion + email + paid media + homepage merchandising
4. SKU A inventory protection + ad pause + onsite deprioritization
5. SKU A clearance acceleration + price + merchandising + paid media
6. promotion effective before email
7. concurrent paid-media changes
8. different populations
9. inherited population with component override
10. inherited timing with dependent email
11. state-based termination
12. recurring weekend compound
13. unsupported simulator component
14. ALL_OR_NOTHING unsupported capability
15. BEST_EFFORT partial capability
16. mixed reversible/irreversible components
17. safe reversible rollback
18. rollback conflict preservation
19. rollback after irreversible email send
20. invalid dependency cycle
21. invalid budget conservation
22. invalid compound media budget limit
23. identical Actions with different order/dependency semantics
24. unknown component eligibility
25. explicit NO_OP control compatibility

Additional fixtures cover active Actions coordinated with INVESTIGATE and WAIT/OBSERVE.

## Semantic identity

Compound fingerprints incorporate:

- atomic Action IDs and atomic business semantics
- component IDs and roles
- ordering where semantic
- concurrency
- dependencies
- population binding
- timing binding
- atomicity
- failure/completion policy
- compound constraints
- rollback semantics
- compound measurement semantics

They exclude mutable runtime state, readiness/evaluation results and predictions.

Unordered component collections and dependency/constraint collections are canonically serialized. Full canonical serialization round-trips exactly.

## Freeze boundary

Step 13 is complete when Kivviq can answer:

> How do we represent one merchant decision that intentionally coordinates several independently identifiable interventions?

while preserving:

- atomic causal identity
- explicit coordination
- population and timing boundaries
- fail-closed capability handling
- domain rollback guards
- immutable definition vs runtime/evaluation separation

It must not answer whether the CompoundAction is a good idea, predict synergy, rank compounds, optimize component selection or execute them.
