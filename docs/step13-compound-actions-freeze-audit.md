# Step 13 — 63-Requirement Freeze Audit

This document is the explicit completion gate for **Step 13 — Canonical Compound Actions** on `action-space/step13-compound-actions`.

It does not introduce a new design. It maps the Step 13 contract to concrete implementation and test evidence. A requirement may be frozen only when its implementation exists, the cited focused coverage passes, the full inherited suite passes, and the architecture/typecheck/build gates pass.

| # | Requirement | Verification evidence | Status |
|---:|---|---|:---:|
| 1 | CompoundAction is a canonical typed and versioned contract. | `src/compound_action/types.ts`; schema-version rejection in `comprehensive.test.ts`. | PASS |
| 2 | Compound identity is stable and separate from component and atomic Action identity. | `CompoundActionId`; stable-ID edge case; flatten/provenance tests. | PASS |
| 3 | Every component has its own stable component identity. | component validation in `validation.ts`; duplicate component IDs rejected. | PASS |
| 4 | Every component preserves the canonical atomic Action identity. | duplicate atomic Action IDs rejected; atomic identity and translation provenance tests. | PASS |
| 5 | Compound components are canonical atomic Actions, not ad-hoc intervention records. | `validateAction` is required for every component. | PASS |
| 6 | Recursive/nested CompoundActions are rejected. | nested-compound adversarial case in `comprehensive.test.ts`. | PASS |
| 7 | A CompoundAction represents a genuine multi-component decision. | validation requires at least two atomic components. | PASS |
| 8 | Component roles are typed and closed. | SOURCE/DESTINATION/PRIMARY/SUPPORTING/TRIGGER/DEPENDENT/CONTROL in `types.ts`; invalid roles rejected. | PASS |
| 9 | Composition is generic across Action families rather than combination-specific. | cross-family campaign/inventory/clearance fixtures and cross-family coverage test. | PASS |
| 10 | Ordered compounds have explicit complete component order. | ORDERED validation and deterministic flattening tests. | PASS |
| 11 | Unordered compounds remain semantically unordered and canonically deterministic. | canonical component ordering, serialization, and unordered dependency audit. | PASS |
| 12 | START_TOGETHER concurrency is representable without building a scheduler. | typed concurrency contract and recurring-weekend fixture. | PASS |
| 13 | EFFECTIVE_TOGETHER concurrency is representable and validated. | budget reallocation/concurrent paid-media fixtures; timing contradiction edge case. | PASS |
| 14 | INDEPENDENT_TIMING concurrency is representable. | typed contract and dependency-gated unordered translation audit. | PASS |
| 15 | Component dependencies use a closed typed vocabulary. | START_AFTER/EFFECTIVE_AFTER/COMPLETE_AFTER/REQUIRES/END_WITH. | PASS |
| 16 | Dependencies have stable identity and must reference existing components. | dependency ID/reference validation in `validation.ts`. | PASS |
| 17 | Self, duplicate, unknown, and cyclic dependency structures fail closed. | circular dependency fixture plus dependency validation/adversarial tests. | PASS |
| 18 | Coordination semantics change semantic identity even when atomic Actions are the same. | fixture 23 and semantic-identity tests. | PASS |
| 19 | Completion semantics are explicit and closed. | ALL_COMPONENTS_COMPLETE / ALL_REQUIRED_COMPONENTS_COMPLETE; invalid completion audit. | PASS |
| 20 | Compound constraints are closed, typed, hard, and machine-evaluable rather than arbitrary expressions. | `CompoundConstraint`; arbitrary/soft constraint rejection audit. | PASS |
| 21 | Monetary reallocation conservation is enforceable. | SUM_MONETARY_DELTAS_EQUALS; valid CAD 2,000/week reallocation and invalid conservation fixture. | PASS |
| 22 | Compound incremental paid-media caps are enforceable when values are statically known. | TOTAL_INCREMENTAL_MEDIA_BUDGET_LTE and fixture 22. | PASS |
| 23 | Discount-exposure guardrails are representable as typed hard constraints. | TOTAL_DISCOUNT_EXPOSURE_LTE contract and strict constraint validation. | PASS |
| 24 | Minimum-contribution guardrails are representable without embedding prediction or optimizer logic. | MINIMUM_CONTRIBUTION_GTE contract; unresolved business-state constraints remain readiness evidence. | PASS |
| 25 | Typed resource caps are enforceable with unit compatibility. | TOTAL_RESOURCE_LTE and final-audit resource-cap test. | PASS |
| 26 | Unknown constraint kinds, soft constraints, duplicate IDs, malformed units, and incompatible units fail closed. | validation plus final-audit/edge-case coverage. | PASS |
| 27 | Known hard-constraint failures block readiness and unresolved hard constraints remain UNKNOWN. | readiness tests and unresolved-global-constraint final audit. | PASS |
| 28 | Population binding level is explicit on every CompoundAction. | COMPOUND_LEVEL / COMPONENT_LEVEL contract and final population audit. | PASS |
| 29 | COMPOUND_LEVEL population binding requires an explicit default population and binding time. | validation plus missing-binding-time final audit. | PASS |
| 30 | COMPONENT_LEVEL binding forbids hidden compound defaults and inheritance. | validation plus hidden-inheritance tests. | PASS |
| 31 | Component population inheritance is explicit rather than implicit. | INHERIT binding and inherited-population fixture. | PASS |
| 32 | Population override carries an explicit reference and binding time. | OVERRIDE contract; different-population and override fixtures. | PASS |
| 33 | Population NOT_APPLICABLE is explicit and requires a reason. | population-binding validation and paid-media fixtures. | PASS |
| 34 | Population membership resolution is external, snapshot-bindable, and fail-closed when missing or ambiguous. | `resolveCompoundPopulations`; snapshot and unavailable-binding tests. | PASS |
| 35 | Compound timing reuses the canonical Step 12 ActionTiming contract. | `ActionTiming` integration in `types.ts` / `resolution.ts`. | PASS |
| 36 | Timing INHERIT is explicit and requires compound-level timing. | timing-binding validation and inherited-timing fixture. | PASS |
| 37 | Timing OVERRIDE is explicit and must itself be a valid ActionTiming. | override validation and same-start/different-duration audit. | PASS |
| 38 | Timing DEPENDENT is explicit and must reference declared dependency IDs targeting that component. | dependency-ID validation and dependent-timing edge case. | PASS |
| 39 | Contradictory coordinated timing fails closed. | EFFECTIVE_TOGETHER contradiction edge case. | PASS |
| 40 | Shared starts do not force identical component durations. | final audit for same effective start with different durations. | PASS |
| 41 | State-based termination remains representable at compound timing level. | required fixture 11. | PASS |
| 42 | Recurring coordinated initiatives remain one CompoundAction rather than being expanded into unrelated decisions. | required fixture 12 and recurrence resolution test. | PASS |
| 43 | ALL_OR_NOTHING atomicity is explicit and prevents partial simulation. | fixtures/tests for unsupported component and no partial interventions. | PASS |
| 44 | BEST_EFFORT atomicity is explicit and preserves partial capability state. | fixtures 13/15 and partial readiness/translation tests. | PASS |
| 45 | DEPENDENCY_GATED atomicity is explicit. | inventory-protection/dependent-email fixtures and translation tests. | PASS |
| 46 | Failure policy is explicit and semantic. | ABORT_COMPOUND / CONTINUE_INDEPENDENT_COMPONENTS / ROLLBACK_COMPLETED_COMPONENTS / PAUSE_DEPENDENTS; edge-case identity test. | PASS |
| 47 | Per-component readiness preserves structural, eligibility, context, population, timing, simulator, and execution capability state. | `CompoundComponentReadiness` and readiness tests. | PASS |
| 48 | Compound readiness distinguishes READY, PARTIALLY_READY, BLOCKED, and UNKNOWN without collapsing unknown eligibility. | readiness implementation and UNKNOWN audit. | PASS |
| 49 | Unsupported simulator/execution capability is explicit; unsupported components are never silently dropped. | readiness + translation results, ALL_OR_NOTHING/BEST_EFFORT coverage. | PASS |
| 50 | Compound rollback policy is separate from each atomic Action's domain rollback contract. | rollback contract in `types.ts`; semantic identity and readiness tests. | PASS |
| 51 | Reverse dependency rollback order is derivable without executing rollback. | rollback readiness implementation and reverse-order test. | PASS |
| 52 | Explicit rollback order must cover components exactly once. | rollback-order edge case. | PASS |
| 53 | Rollback readiness explicitly reports rollbackable, irreversible, and unknown components. | `CompoundRollbackReadiness`; final rollback audit. | PASS |
| 54 | Later legitimate domain conflicts are preserved and block automatic rollback rather than being overwritten. | conflict fixture/tests. | PASS |
| 55 | Missing/unknown rollback context is explicit and automatic-rollback eligibility is reported separately. | rollback missing-context and automatic-allowed tests. | PASS |
| 56 | Irreversible effects use explicit compensation requirements without pretending compensation is causal rollback. | mixed reversible/irreversible fixtures and compensation tests. | PASS |
| 57 | The canonical acceptance matrix covers all 25 required scenarios plus active+INVESTIGATE and active+WAIT/OBSERVE. | `fixture_matrix.ts`; required-fixture count and validity tests. | PASS |
| 58 | Compound evidence summaries aggregate only compatible additive costs/resources and retain risk categorically without inventing a numeric score. | `aggregates.ts`; cost/resource/risk tests and incompatible-unit/currency edge cases. | PASS |
| 59 | Compound measurement horizon and provenance remain explicit while component measurement/provenance and causal identity are preserved. | typed measurement/provenance; component measurement edge case; flatten/translation provenance audits. | PASS |
| 60 | Semantic equality is based on business meaning, excluding record IDs/descriptions/intent/provenance/evaluation metadata while retaining coordination meaning. | `semantics.ts`; renamed-ID final audit and coordination-change audit. | PASS |
| 61 | Fingerprinting, canonical serialization, round-trip deserialization, and flattening are deterministic; unordered collections are canonicalized. | `semantics.ts`, `serialization.ts`; round-trip and deterministic flattening tests. | PASS |
| 62 | Translation reuses existing atomic translators, preserves compound+atomic provenance and one-to-many intervention indexes, resolves dependency gating topologically, and handles unsupported components conservatively. | `translation.ts`; comprehensive translation suite and unordered dependency final audit. | PASS |
| 63 | Architectural boundaries are preserved: NO_OP/WAIT/OBSERVE/INVESTIGATE do not invent causal interventions, RUN_EXPERIMENT remains an engine boundary, and CompoundAction rejects prediction/evaluation/runtime leakage and contains no optimizer, recommender, execution orchestrator, transaction manager, or experiment-assignment system. | zero-intervention/boundary tests, forbidden-field validation, dependency-cruiser rule, full architecture gate. | PASS |

## Freeze rule

Step 13 is frozen only after all 63 rows above are PASS **and** the final branch head passes:

- architecture boundary validation
- strict TypeScript typecheck
- the focused Step 13 CompoundAction suite
- the full inherited repository test suite
- production build

The pull request remains draft, open, mergeable, and unmerged. Freezing this step records a verified research contract; it does not merge, deploy, execute, optimize, rank, or recommend CompoundActions.
