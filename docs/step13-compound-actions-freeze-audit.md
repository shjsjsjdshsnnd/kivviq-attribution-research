# Step 13 — Exact 63-Requirement Freeze Audit

This document is the explicit completion gate for **Step 13 — Build Compound Actions** on `action-space/step13-compound-actions`.

The numbering below follows the original Step 13 specification. It is not a replacement specification: every row maps the original requirement to concrete implementation and verification evidence on this branch.

| # | Original requirement | Verification evidence | Status |
|---:|---|---|:---:|
| 1 | Define the canonical, versioned `CompoundAction` contract with identity, description, components, coordination/timing, constraints/dependencies, failure/rollback semantics, measurement horizon and provenance. | `src/compound_action/types.ts`; schema-version and structural validation tests. | PASS |
| 2 | Preserve every component as a fully valid canonical atomic `Action`, including its own identity and semantics. | Every component passes `validateAction`; atomic identity and translation tests. | PASS |
| 3 | Keep `compoundActionId` separate from component IDs and atomic `actionId` values. | Branded compound ID, component IDs, duplicate-ID validation, flatten/provenance tests. | PASS |
| 4 | Represent component ordering explicitly as `UNORDERED` or `ORDERED`. | `CompoundOrdering`; exhaustive ORDERED validation and deterministic flattening. | PASS |
| 5 | Represent concurrency explicitly as `START_TOGETHER`, `EFFECTIVE_TOGETHER` or `INDEPENDENT_TIMING`. | Closed concurrency type, timing/concurrency fixtures and edge cases. | PASS |
| 6 | Use typed inter-component dependencies: START_AFTER, EFFECTIVE_AFTER, COMPLETE_AFTER, REQUIRES and END_WITH. | `ComponentDependencyType` and canonical dependency fixtures. | PASS |
| 7 | Validate dependency references/types, reject self-dependencies/cycles, and preserve timing resolution relationships. | `validation.ts`, circular fixture 20, timing/dependency resolution tests. | PASS |
| 8 | Support generic cross-family coordination rather than combination-specific compound schemas. | Campaign, inventory-protection and clearance fixtures span paid media, promotion, lifecycle, merchandising, pricing and inventory. | PASS |
| 9 | Make Meta -$2,000/week + Google +$2,000/week a canonical conserved budget-reallocation CompoundAction, not unrelated recommendations. | Fixture 1, SOURCE/DESTINATION roles and conservation test. | PASS |
| 10 | Generalize conservation/guardrail constraints as typed machine-evaluable compound constraints, never arbitrary executable expressions. | Closed `CompoundConstraint` union; conservation, media-cap, resource-cap and arbitrary-expression rejection tests. | PASS |
| 11 | Support a coordinated campaign CompoundAction (promotion + lifecycle email + paid-media increase + merchandising feature) while preserving every atomic component. | Required fixtures 2 and 3 plus cross-family coverage test. | PASS |
| 12 | Permit shared human-readable intent but exclude predicted outcomes/rankings from the Action definition. | `intent` is descriptive; leakage validator rejects expected revenue/profit/ROAS/lift/synergy and recommendation fields. | PASS |
| 13 | Make population semantics explicit: components may target the same, different or no populations, with COMPOUND_LEVEL or COMPONENT_LEVEL binding. | Population-binding contract, fixtures 8/9 and final population audit. | PASS |
| 14 | If a compound has a default population, every component explicitly chooses INHERIT, OVERRIDE or NOT_APPLICABLE; no silent attachment. | Population validation, hidden-inheritance rejection and override tests. | PASS |
| 15 | Reuse Step 12 `ActionTiming` for shared compound timing; do not invent a parallel compound-only time model. | `ActionTiming` is imported directly into CompoundAction and timing resolution. | PASS |
| 16 | Make component timing inheritance explicit as INHERIT, OVERRIDE or DEPENDENT. | `ComponentTimingBinding`, validation and inherited/dependent timing fixtures. | PASS |
| 17 | Represent a compound business-level active window while allowing narrower component windows. | Compound `timing` plus component timing overrides; same-start/different-duration final audit. | PASS |
| 18 | Make compound completion semantics explicit. | `CompoundCompletionRule`; invalid completion semantics rejected. | PASS |
| 19 | Make compound atomicity explicit: ALL_OR_NOTHING, BEST_EFFORT or DEPENDENCY_GATED. | Type contract plus unsupported/partial/dependency-gated fixtures and tests. | PASS |
| 20 | Keep preflight/readiness outside the immutable CompoundAction definition. | Separate `CompoundActionReadiness` and evaluator inputs; no runtime readiness fields in CompoundAction. | PASS |
| 21 | Represent compound readiness as READY, PARTIALLY_READY, BLOCKED or UNKNOWN. | `CompoundReadinessState` and readiness tests. | PASS |
| 22 | Compose atomic eligibility conservatively, preserving UNKNOWN rather than treating it as ineligible. | Per-component tri-state eligibility evidence and UNKNOWN readiness tests. | PASS |
| 23 | Make compound failure semantics explicit. | Closed failure policies; failure policy participates in semantic identity. | PASS |
| 24 | Preserve two rollback levels: atomic/domain rollback contracts plus compound rollback coordination. | Embedded atomic Actions remain unchanged; separate compound rollback contract/readiness. | PASS |
| 25 | Do not replace domain-specific rollback safety with generic compound restoration. | Rollback readiness delegates component reversibility and preserves domain conflicts. | PASS |
| 26 | Make compound rollback policy explicit. | Closed `CompoundRollbackPolicy` and identity/readiness tests. | PASS |
| 27 | Represent partial reversibility explicitly. | `PARTIALLY_REVERSIBLE` summary and mixed reversible/irreversible fixture. | PASS |
| 28 | Preserve irreversible components explicitly. | Irreversible component IDs/states in rollback readiness and email-send fixtures. | PASS |
| 29 | Keep compensation separate from rollback. | `CompensationRequirement` and mixed-reversibility tests. | PASS |
| 30 | Make rollback ordering explicit and dependency-safe. | REVERSE_DEPENDENCY_ORDER / EXPLICIT / UNORDERED; reverse-order and explicit-order tests. | PASS |
| 31 | Protect later legitimate decisions from rollback conflicts. | Conflict evidence remains explicit and disables automatic rollback. | PASS |
| 32 | Expose a separate `CompoundRollbackReadiness` contract rather than executing rollback. | Separate type surface plus readiness derivation/final audit; no rollback executor exists. | PASS |
| 33 | Derive compound cost without inventing unsupported arithmetic. | `summarizeCompoundCosts`; only compatible known monetary dimensions aggregate. | PASS |
| 34 | Derive compound resource requirements with unit/currency compatibility. | `summarizeCompoundResources`; unknown/incompatible units fail aggregation. | PASS |
| 35 | Preserve compound-level constraints independently from component constraints. | Typed `constraints` on CompoundAction, validation/readiness and semantic identity. | PASS |
| 36 | Preserve compound risk without manufacturing a numeric score. | `summarizeCompoundRisk` keeps component risk dimensions categorically. | PASS |
| 37 | Define an explicit compound measurement horizon without replacing component measurement semantics. | `CompoundMeasurementHorizon`; component-vs-compound measurement edge case. | PASS |
| 38 | Preserve causal attribution boundaries between the compound business decision, atomic Actions and simulator interventions. | Flatten/translation provenance keeps compound ID as origin and atomic actionId as source. | PASS |
| 39 | Keep predicted interaction/synergy effects out of CompoundAction. | Explicit leakage keys plus separate evaluation envelope; final evaluation-boundary test. | PASS |
| 40 | Preserve careful NO_OP semantics inside compounds without inventing treatment effects or assignment. | Explicit CONTROL role; zero-intervention NO_OP translation; no traffic allocation. | PASS |
| 41 | Allow WAIT/OBSERVE and INVESTIGATE components while preserving their zero-causal-intervention meaning. | Dedicated active+WAIT and active+INVESTIGATE fixtures/tests. | PASS |
| 42 | Keep RUN_EXPERIMENT as an experiment-engine boundary; do not embed experiment assignment/design. | Translation returns EXPERIMENT_REQUIRES_ENGINE; experiment fields rejected. | PASS |
| 43 | Keep CompoundAction components atomic by default and reject arbitrary recursive nested compounds. | Nested-compound adversarial test and atomic component validation. | PASS |
| 44 | Flatten deterministically while preserving compound/component/atomic provenance, dependencies, timing and population bindings. | `flattenCompoundAction` and comprehensive/final provenance tests. | PASS |
| 45 | Support typed component roles such as SOURCE, DESTINATION, PRIMARY, SUPPORTING, TRIGGER, DEPENDENT and CONTROL. | Closed role union, role validation and fixture coverage. | PASS |
| 46 | Define semantic equality over component business semantics, roles, ordering, dependencies, timing, populations, constraints, failure/rollback policy and atomicity. | Canonical semantic projection plus coordination-change tests. | PASS |
| 47 | Make compound fingerprints deterministic and exclude runtime/evaluation/prediction state and record-only IDs. | FNV-1a semantic fingerprint and renamed-ID/evaluation-metadata tests. | PASS |
| 48 | Provide deterministic canonical serialization with exact semantic round-trip. | `serializeCompoundAction` / `deserializeCompoundAction`; unordered canonicalization and round-trip tests. | PASS |
| 49 | Keep lifecycle/execution status outside immutable CompoundAction. | Runtime status fields are absent from the type and explicitly rejected by leakage validation. | PASS |
| 50 | Keep `CompoundActionEvaluation` separate from `CompoundAction`; evaluation may carry predictions, expected economics, uncertainty, interactions, risks and recommendation ranking. | Separate versioned evaluation envelope in `types.ts`; final boundary test proves its fields are rejected from CompoundAction. | PASS |
| 51 | Extend translation by translating atomic components and preserve compound provenance/dependencies. | `translateCompoundAction` reuses atomic translators and attaches coordination/provenance. | PASS |
| 52 | Preserve one-to-many translation across compound -> atomic Action -> SimulatorIntervention levels. | Component/intervention index/count provenance and one-to-many promotion test. | PASS |
| 53 | Return explicit per-component translation results. | `CompoundComponentTranslationResult` surface and comprehensive translation assertions. | PASS |
| 54 | Represent unsupported simulator/execution capability explicitly. | Unsupported status is preserved in readiness and translation results. | PASS |
| 55 | Never approximate an unsupported component through a different simulator mechanism. | ALL_OR_NOTHING/BEST_EFFORT tests; unsupported lifecycle/CRO/etc. remain unsupported rather than mutated through proxies. | PASS |
| 56 | Reuse Step 12 timing resolution for compound/component timing instead of creating a scheduler. | `resolveCompoundTiming` delegates to ActionTiming resolution and preserves relational dependencies. | PASS |
| 57 | Preserve recurring CompoundActions as one coordinated merchant decision. | Recurring-weekend fixture and recurrence test; no expansion into unrelated Actions. | PASS |
| 58 | Resolve compound populations through external canonical population bindings and fail closed when unavailable. | `resolveCompoundPopulations` and snapshot/binding-time tests. | PASS |
| 59 | Reject prediction/evaluation/GroundTruth-style leakage from the CompoundAction definition. | Recursive forbidden-information validation plus evaluation-boundary and prediction-leakage tests. | PASS |
| 60 | Provide the required 25 canonical CompoundAction fixtures. | `requiredCompoundFixtures` is asserted at exactly 25; all valid fixtures validate and required invalid fixtures fail correctly. | PASS |
| 61 | Test semantic identity adversarially, including same Actions with different coordination and renamed record IDs with unchanged meaning. | `compound.test.ts`, `edge-cases.test.ts`, `final-audit.test.ts`. | PASS |
| 62 | Provide comprehensive tests for validation, readiness, rollback, cost/resources/risk, timing/population resolution, translation, serialization and boundaries, while retaining inherited tests. | Focused CompoundAction suite plus full repository suite in CI. | PASS |
| 63 | Preserve architectural boundaries: no optimizer, recommender, decision policy, execution orchestrator, transaction manager, experiment-assignment engine, prediction layer or hidden evaluator logic in CompoundAction. | Dependency-cruiser boundary, forbidden-field validation, zero-intervention/experiment tests and full architecture gate. | PASS |

## Freeze rule

Step 13 is frozen only when all 63 rows above are PASS and the exact frozen branch head passes:

- architecture boundary validation
- strict TypeScript typecheck
- focused Step 13 CompoundAction tests
- full inherited repository test suite
- production build

The pull request remains draft, open and unmerged. Freezing records a verified research contract; it does not merge, deploy, execute, optimize, rank or recommend CompoundActions.
