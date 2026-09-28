# Action Dependencies, Conflicts, Characteristics, and Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical prerequisite gates, symmetric pre-optimizer portfolio conflicts, typed implementation characteristics, and six value-free risk measurement contracts while preserving existing v2 identities.

**Architecture:** Extend the canonical envelope with definition-only contracts and backward-compatible empty defaults. Put evidence-bound dependency and portfolio assessment in separate modules that reuse the existing hard-constraint, eligibility, experiment-readiness, timing, and compound-expansion boundaries. Keep characteristics and risk as typed vectors; no layer introduced here may rank, predict, optimize, or execute Actions.

**Tech Stack:** TypeScript, Zod, Temporal, Vitest, dependency-cruiser

---

## File map

- `src/action_dependencies/schema.ts`: strict dependency definitions and exact entity references.
- `src/action_dependencies/assessment.ts`: evidence-bound dependency graph expansion and deterministic assessment.
- `src/action_dependencies/index.ts`: public dependency API.
- `src/action_conflicts/schema.ts`: conflict definitions, target/scope, and normalized pair contracts.
- `src/action_conflicts/adapters.ts`: typed domain contradiction adapters.
- `src/action_conflicts/assessment.ts`: portfolio expansion, timing overlap, and symmetric pair assessment.
- `src/action_conflicts/index.ts`: public conflict API.
- `src/action_characteristics/schema.ts`: typed costs, ranges, burden, cancellation stages, and reversibility.
- `src/action_characteristics/validation.ts`: cross-field and domain rollback consistency checks.
- `src/action_characteristics/aggregate.ts`: compound and portfolio vector aggregation.
- `src/action_characteristics/index.ts`: public characteristics API.
- `src/action_risk/schema.ts`: exactly six measurement-contract dimensions and leakage guards.
- `src/action_risk/aggregate.ts`: six-dimensional compound and portfolio contract vectors.
- `src/action_risk/index.ts`: public risk-contract API.
- `src/canonical_action/schema.ts`: envelope defaults and cross-definition validation.
- `src/canonical_action/serialization.ts`: stable semantic projection and order-independent fingerprints.
- `src/compound_action/schema.ts`: exact expansion integration and cross-graph cycle validation.
- `src/compound_action/readiness.ts`: dependency and compatibility gates from raw evidence.
- `src/experiment/readiness.ts`: expose exact arm expansion needed by dependency/conflict traversal.
- `src/action_translation/context.ts`: raw dependency and portfolio evidence contexts.
- `src/action_translation/canonical.ts`: replay gates before emitting interventions or experiment tasks.
- `src/action_translation/compound.ts`: replay expanded portfolio gates.
- `.dependency-cruiser.cjs`: definition and assessment layer import boundaries.
- `src/index.ts` and `package.json`: root and package subpath exports.
- `docs/action-dependencies-conflicts-characteristics-risk.md`: public contract guide.
- `.github/workflows/action-dependencies-conflicts-risk-ci.yml`: focused CI entry.

### Task 1: Exact dependency definitions

**Files:**
- Create: `src/action_dependencies/schema.ts`
- Create: `src/action_dependencies/index.ts`
- Create: `tests/action_dependencies/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover exact `ACTION` and `COMPOUND` references with fingerprints; `ENTITY_LIFECYCLE`, `HARD_CONSTRAINT_GATE`, `ELIGIBILITY_CHECK_GATE`, and `EXPERIMENT_READINESS_GATE`; unique IDs; closed objects; and `whenUnknown`. Add an explicit regression that `requiredState: "ELIGIBLE"` is rejected.

- [ ] **Step 2: Run the red test**

Run `npx vitest run tests/action_dependencies/schema.test.ts --maxWorkers=1`.
Expected: FAIL because the dependency module does not exist.

- [ ] **Step 3: Implement the strict union**

Export `canonicalEntityReferenceSchema`, `actionDependencySchema`, `actionDependenciesSchema`, and inferred types. Lifecycle state must be exactly `STARTED | EFFECTIVE | COMPLETED | RESOLVED`; do not include eligibility as an entity state.

- [ ] **Step 4: Verify and commit**

Run the focused test and `npm run typecheck`.
Expected: PASS.

Commit: `feat: define canonical action dependencies`

- [ ] **Step 5: Specification review checkpoint**

Dispatch a fresh reviewer against the Step 19 definition section. Fix any gap with a failing regression test before continuing.

- [ ] **Step 6: Code-quality review checkpoint**

Dispatch a different fresh reviewer for strictness, naming, duplicate handling, and dependency direction. Resolve all important findings.

### Task 2: Evidence-bound dependency assessment

**Files:**
- Create: `src/action_dependencies/assessment.ts`
- Create: `tests/action_dependencies/assessment.test.ts`
- Modify: `src/action_dependencies/index.ts`

- [ ] **Step 1: Write failing evidence tests**

Test exact dependent ID/fingerprint/dependency binding, prerequisite ID/fingerprint, evaluation boundary, UTC-Z timestamps, freshness, source provenance, missing evidence, duplicate exact receipts, and order independence. Require complete deterministic check output.

- [ ] **Step 2: Write failing replay tests**

Use raw evidence bundles for a hard constraint, an eligibility check, and experiment traffic. Assert that a forged `SATISFIED`, `ELIGIBLE`, or `READY` object cannot satisfy a gate. Assert that the existing assessor is invoked and that its assessment fingerprint and complete manifest are verified.

- [ ] **Step 3: Write failing graph tests**

Cover self-reference, direct cycle, transitive cycle, exact Action and CompoundAction registry ambiguity, missing references, and fingerprint mismatches.

- [ ] **Step 4: Run the red tests**

Run `npx vitest run tests/action_dependencies --maxWorkers=1`.
Expected: FAIL on missing assessment behavior.

- [ ] **Step 5: Implement `assessActionDependencies`**

Return a discriminated success/failure result with `SATISFIED | BLOCKED | UNKNOWN`, all sorted checks, evidence references, missing information, evaluation boundary, evaluated time, and a deterministic assessment fingerprint. Aggregate `BLOCKED > UNKNOWN > SATISFIED`.

- [ ] **Step 6: Implement raw-evidence replay**

Route local gate definitions to `assessHardConstraints`, `evaluateActionEligibility`, and `assessExperimentReadiness`. Verify exact local IDs and never evaluate an Action-state `ELIGIBLE` edge.

- [ ] **Step 7: Verify and commit**

Run `npx vitest run tests/action_dependencies tests/action_constraints tests/action_eligibility tests/experiment --maxWorkers=1` and `npm run typecheck`.
Expected: PASS.

Commit: `feat: assess action dependencies from evidence`

- [ ] **Step 8: Specification and quality reviews**

Use separate fresh reviewers. Add regression tests for every accepted finding, rerun the focused suite, and obtain approval from both reviewers.

### Task 3: Symmetric conflict definitions

**Files:**
- Create: `src/action_conflicts/schema.ts`
- Create: `src/action_conflicts/index.ts`
- Create: `tests/action_conflicts/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover every conflict kind, exact and registry counterparties, shared constraint targets, typed scopes, overlap rules, duplicate IDs, self-reference, strict unknown-key rejection, and forbidden preference fields such as winner, priority, utility, score, rank, and recommendation.

- [ ] **Step 2: Run the red test**

Run `npx vitest run tests/action_conflicts/schema.test.ts --maxWorkers=1`.
Expected: FAIL because schemas do not exist.

- [ ] **Step 3: Implement definitions and normalized pair identity**

Export a pair-key helper that sorts exact entity keys before hashing. Make the relation symmetric by construction and keep target, scope, and overlap rule in its semantic projection.

- [ ] **Step 4: Verify and commit**

Run the focused test and type checker.
Expected: PASS.

Commit: `feat: define symmetric action conflicts`

- [ ] **Step 5: Specification and quality reviews**

Have independent reviewers confirm that conflict definitions describe incompatibility only and cannot encode selection.

### Task 4: Portfolio compatibility and typed domain adapters

**Files:**
- Create: `src/action_conflicts/adapters.ts`
- Create: `src/action_conflicts/assessment.ts`
- Create: `tests/action_conflicts/assessment.test.ts`
- Create: `tests/action_conflicts/domains.test.ts`
- Modify: `src/action_conflicts/index.ts`

- [ ] **Step 1: Write failing symmetry and timing tests**

Assert identical result fingerprints and normalized pair keys when portfolio order, declaration order, or evidence order is reversed. Cover `ANY_OVERLAP`, `EFFECTIVE_OVERLAP`, and `FULL_CONTAINMENT`, plus unresolved timing returning `UNKNOWN`.

- [ ] **Step 2: Write failing target and scope tests**

Prove that different products, populations, channels, placements, currencies, or non-overlapping intervals do not conflict. Prove that ambiguous scope evidence cannot establish compatibility.

- [ ] **Step 3: Write the pricing example first**

Create a +10% and -15% Product A price pair in the same currency and overlapping period. Expect one `CONTRADICTORY_VALUE_CHANGE` pair. Add negative controls for Product B and disjoint windows.

- [ ] **Step 4: Add domain adapter tests**

Cover existing promotion, shipping, merchandising, CRO, and lifecycle typed conflict rules, plus exclusive resources and policy prohibitions. Reject substring and label inference.

- [ ] **Step 5: Add compound and experiment expansion tests**

Expand CompoundActions and experiment arms to exact members, deduplicate shared exact identities, detect cycles/ambiguity, and retain parent-to-member paths in diagnostics.

- [ ] **Step 6: Run the red tests**

Run `npx vitest run tests/action_conflicts --maxWorkers=1`.
Expected: FAIL on unimplemented assessment and adapters.

- [ ] **Step 7: Implement `assessPortfolioCompatibility`**

Parse exact registry entries, expand members, resolve ActionTiming, evaluate all unordered pairs, and aggregate `CONFLICTING > UNKNOWN > COMPATIBLE`. Return every applicable pair and an assessment fingerprint. Do not emit a selected subset or repair proposal.

- [ ] **Step 8: Verify and commit**

Run conflict, timing, compound, experiment, and domain conflict tests plus type checking.
Expected: PASS.

Commit: `feat: reject incompatible action portfolios`

- [ ] **Step 9: Specification and quality reviews**

Require one reviewer to focus on the price example and symmetry, and another on evidence ambiguity, expansion, and accidental optimizer behavior.

### Task 5: Typed implementation characteristics

**Files:**
- Create: `src/action_characteristics/schema.ts`
- Create: `src/action_characteristics/validation.ts`
- Create: `src/action_characteristics/index.ts`
- Create: `tests/action_characteristics/schema.test.ts`
- Create: `tests/action_characteristics/validation.test.ts`

- [ ] **Step 1: Write failing money and range tests**

Cover integer minor units, ISO-style currencies, known/range/unknown states, equal range currencies, finite values, `minimum <= maximum`, source references, and strict unknown-key rejection.

- [ ] **Step 2: Write failing operational burden tests**

Cover non-negative finite quantities, exact resource references, registered units, incompatible units, and duplicate resource/unit entries.

- [ ] **Step 3: Write failing delay-authority tests**

Reject `delay`, `leadTime`, `implementationDelaySeconds`, and equivalent nested characteristics fields. Assert that the only implementation delay read by later aggregation is `action.timing.implementationDelay`.

- [ ] **Step 4: Write failing cancellation tests**

Require one entry for every reachable stage, reject duplicate stages, and preserve stage-specific money and burden ranges.

- [ ] **Step 5: Write failing reversibility tests**

Test the exact invariants for fully reversible, partially reversible, and irreversible forms. Add domain regressions for reversible ad budget, staged inventory commitment, sent lifecycle messages, and existing pricing/shipping/merchandising/CRO rollback contracts.

- [ ] **Step 6: Run the red tests**

Run `npx vitest run tests/action_characteristics --maxWorkers=1`.
Expected: FAIL because the module is absent.

- [ ] **Step 7: Implement schemas and strict validation**

Keep descriptive characteristics separate from evidence and optimizer preferences. Use registered adapters for known rollback invariants and fail on contradictions.

- [ ] **Step 8: Verify and commit**

Run the focused tests, all domain rollback tests, compound rollback tests, and type checking.
Expected: PASS.

Commit: `feat: define action implementation characteristics`

- [ ] **Step 9: Specification and quality reviews**

Require explicit reviewer approval for the single delay authority, typed ranges, stage-sensitive cancellation, and reversibility strictness.

### Task 6: Characteristics vector aggregation

**Files:**
- Create: `src/action_characteristics/aggregate.ts`
- Create: `tests/action_characteristics/aggregate.test.ts`
- Modify: `src/action_characteristics/index.ts`

- [ ] **Step 1: Write failing atomic vector tests**

Assert costs grouped by currency, burden grouped by resource and unit, cancellation costs grouped by stage and currency, and the ActionTiming delay retained by exact member identity.

- [ ] **Step 2: Write failing range and unknown tests**

Verify range addition, explicit unknown propagation, currency/unit non-coercion, and deterministic member ordering.

- [ ] **Step 3: Write failing compound/experiment tests**

Expand nested compounds and experiment arms, deduplicate exact shared members, reject identity ambiguity and cycles, and calculate the strictest reversibility while retaining member details.

- [ ] **Step 4: Run the red tests**

Run `npx vitest run tests/action_characteristics/aggregate.test.ts --maxWorkers=1`.
Expected: FAIL on missing aggregator.

- [ ] **Step 5: Implement `describeActionCharacteristics`**

Return a typed vector and diagnostics. Never collapse currencies, units, stages, delays, or reversibility into a score.

- [ ] **Step 6: Verify, commit, and review**

Run focused, compound, experiment, timing, and type-check suites.
Expected: PASS.

Commit: `feat: aggregate action characteristic vectors`

Complete separate specification and code-quality reviews.

### Task 7: Six risk measurement contracts

**Files:**
- Create: `src/action_risk/schema.ts`
- Create: `src/action_risk/aggregate.ts`
- Create: `src/action_risk/index.ts`
- Create: `tests/action_risk/schema.test.ts`
- Create: `tests/action_risk/aggregate.test.ts`

- [ ] **Step 1: Write failing dimension-completeness tests**

Require exactly one each of `FINANCIAL_DOWNSIDE`, `IRREVERSIBILITY`, `UNCERTAINTY`, `INVENTORY_EXPOSURE`, `CUSTOMER_IMPACT`, and `TIME_TO_RECOVERY` for new authoring. Reject missing, duplicate, and seventh dimensions.

- [ ] **Step 2: Write failing contract-shape tests**

Cover metric reference, exact target, positive typed horizon, value type, aggregation, evidence-policy reference, money currency, quantity unit, and duration unit.

- [ ] **Step 3: Write leakage tests**

Recursively reject value, score, rating, grade, probability, prediction, expected loss, confidence, weight, rank, recommendation, winner, and composite risk fields.

- [ ] **Step 4: Write failing aggregation tests**

Expand compounds and experiment arms into six-dimensional member vectors. Preserve contracts by member, target, horizon, unit, and currency; do not fabricate values or scalarize dimensions.

- [ ] **Step 5: Run the red tests**

Run `npx vitest run tests/action_risk --maxWorkers=1`.
Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement contracts and aggregation**

Keep the existing `RISK_LIMIT` hard constraint independent. Export validation for reader compatibility and strict new authoring.

- [ ] **Step 7: Verify and commit**

Run risk, hard-constraint, compound, experiment, and type-check suites.
Expected: PASS.

Commit: `feat: define action risk measurement contracts`

- [ ] **Step 8: Specification and quality reviews**

Require reviewers to confirm that exactly six dimensions exist and no values, scores, forecasts, or policy thresholds leaked into the definitions.

### Task 8: Canonical envelope, serialization, and compatibility

**Files:**
- Modify: `src/canonical_action/schema.ts`
- Modify: `src/canonical_action/serialization.ts`
- Modify: `src/canonical_action/fixtures.ts`
- Create: `tests/canonical_action/dependencies-conflicts-characteristics-risk.test.ts`
- Modify: `tests/canonical_action/serialization.test.ts`

- [ ] **Step 1: Lock historical fingerprints before implementation**

Add fixture assertions for representative stored v2 Actions from Steps 10–18. Record their current fingerprints and prove that omitted fields and parsed empty defaults retain those values.

- [ ] **Step 2: Write failing new-semantic tests**

Assert each non-empty dependency, conflict, characteristics, or risk definition changes the fingerprint. Assert set-like array order does not. Assert a changed range, cancellation stage, target, horizon, or exact reference does.

- [ ] **Step 3: Write failing cross-reference tests**

Reject unknown local constraint/check IDs, duplicate definitions, self-references, impossible reversibility, a second delay field, and risk leakage. Detect cycles available within the supplied canonical registry.

- [ ] **Step 4: Run the red tests**

Run canonical serialization and new integration tests.
Expected: FAIL on missing envelope fields.

- [ ] **Step 5: Add backward-compatible defaults and semantic projection**

Default collections to `[]` and characteristics to the absent reader state. Omit all empty defaults from the semantic fingerprint projection and canonical-sort non-empty set-like collections by stable IDs.

- [ ] **Step 6: Add strict authoring validation**

Expose a new-writer helper that requires characteristics plus all six risk contracts without making historical readers reject old payloads.

- [ ] **Step 7: Verify and commit**

Run all canonical, dependency, conflict, characteristics, risk, experiment, and constraint tests plus type checking.
Expected: PASS with historical fingerprint fixtures unchanged.

Commit: `feat: integrate action portfolio definitions`

- [ ] **Step 8: Specification and quality reviews**

Review compatibility and fingerprint behavior independently before translation integration.

### Task 9: Compound readiness and vector integration

**Files:**
- Modify: `src/compound_action/schema.ts`
- Modify: `src/compound_action/readiness.ts`
- Modify: `src/compound_action/fixtures.ts`
- Modify: `tests/compound_action/compound.test.ts`
- Modify: `tests/compound_action/evolution.test.ts`

- [ ] **Step 1: Write failing expanded dependency tests**

Cover component, exact external Action, exact external CompoundAction, and experiment-arm edges in one graph. Reject cycles and ambiguous duplicate identities regardless of registry order.

- [ ] **Step 2: Write failing compatibility tests**

Prove a conflict between any all-or-nothing component and another portfolio member blocks readiness before translation. Preserve all pair diagnostics for best-effort compounds without silently dropping components.

- [ ] **Step 3: Write failing vector tests**

Assert cost, burden, cancellation, reversibility, delay, and six risk dimensions retain per-member identity and correct grouped aggregates.

- [ ] **Step 4: Run the red tests**

Run `npx vitest run tests/compound_action --maxWorkers=1`.
Expected: FAIL on missing integration.

- [ ] **Step 5: Implement expansion and readiness gates**

Reuse one exact graph traversal across dependency, conflict, characteristics, and risk modules. Preserve atomicity, existing component eligibility, timing, simulator capability, and experiment readiness as separate checks.

- [ ] **Step 6: Verify and commit**

Run compound, experiment, dependency, conflict, characteristics, risk, eligibility, and timing suites plus type checking.
Expected: PASS.

Commit: `feat: integrate portfolio contracts with compounds`

- [ ] **Step 7: Specification and quality reviews**

Require reviewers to inspect cycle detection, shared-member deduplication, vector aggregation, and atomicity behavior.

### Task 10: Translation raw-evidence enforcement

**Files:**
- Modify: `src/action_translation/context.ts`
- Modify: `src/action_translation/types.ts`
- Modify: `src/action_translation/canonical.ts`
- Modify: `src/action_translation/compound.ts`
- Modify: `src/action_translation/experiment.ts`
- Create: `tests/action_translation/portfolio-gates.test.ts`
- Modify: `tests/action_translation/compound-canonical.test.ts`
- Modify: `tests/action_translation/experiment-canonical.test.ts`

- [ ] **Step 1: Write failing gate-order tests**

Assert translation expands identities, recomputes eligibility, dependencies, and compatibility from raw evidence, then evaluates readiness and capability. A blocked dependency or conflicting portfolio emits no interventions or experiment tasks.

- [ ] **Step 2: Write forgery and freshness tests**

Supply valid-looking assessment objects with missing raw inputs, altered fingerprints, stale evidence, duplicate evidence, and incomplete manifests. Expect explicit missing-context or blocked failures.

- [ ] **Step 3: Write separation tests**

Prove dependency satisfaction does not imply eligibility, compatibility does not imply simulator support, characteristics/risk contracts do not block unless referenced by an existing hard policy gate, and translation does not imply execution.

- [ ] **Step 4: Run the red tests**

Run action-translation tests.
Expected: FAIL until contexts and gates are integrated.

- [ ] **Step 5: Implement raw-context replay**

Add exact raw contexts and deterministic failure codes. Retain full dependency and pair diagnostics. Keep legacy translation behavior unchanged where no new definitions exist.

- [ ] **Step 6: Verify and commit**

Run all translation, eligibility, constraint, experiment, compound, dependency, and conflict tests plus type checking.
Expected: PASS.

Commit: `feat: enforce portfolio gates before translation`

- [ ] **Step 7: Specification and quality reviews**

Review specifically for trusted caller status, bypass paths, assessment freshness, and accidental execution or optimizer semantics.

### Task 11: Public surface, architecture, documentation, and CI

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `.dependency-cruiser.cjs`
- Modify: `README.md`
- Create: `docs/action-dependencies-conflicts-characteristics-risk.md`
- Create: `.github/workflows/action-dependencies-conflicts-risk-ci.yml`
- Create: `tests/architecture/action-portfolio-boundaries.test.ts` if source-level assertions add coverage beyond dependency-cruiser.

- [ ] **Step 1: Add failing package export tests**

Verify root exports and `./action-dependencies`, `./action-conflicts`, `./action-characteristics`, and `./action-risk` subpaths from the built package.

- [ ] **Step 2: Add architecture rules**

Forbid the four new definition/assessment areas from importing simulation, ground truth, evaluation, prediction, ranking, optimizer/optimization, oracle, provider execution, and God-mode modules. Forbid canonical schemas from importing assessment or translation implementations.

- [ ] **Step 3: Write public documentation**

Document the four definition families, raw-evidence assessment flow, status precedence, compound/experiment expansion, compatibility behavior, delay authority, vector aggregation, six risk dimensions, migration defaults, and non-goals. Include the inventory, winback, traffic, and contradictory-price examples.

- [ ] **Step 4: Add focused CI**

Add a package script that runs the four new suites plus affected canonical, translation, compound, timing, eligibility, constraint, and experiment suites. The workflow runs install, focused tests, type checking, architecture, and build.

- [ ] **Step 5: Verify and commit**

Run `npm run typecheck`, `npm run architecture`, the focused script, and `npm run build`.
Expected: PASS.

Commit: `docs: publish action portfolio contracts`

- [ ] **Step 6: Specification and quality reviews**

Require independent approval for exports, public terminology, architecture boundaries, compatibility statements, and CI coverage.

### Task 12: Final audit, full verification, and draft PR

**Files:**
- Review every file changed from the Steps 16–18 base branch.

- [ ] **Step 1: Run an independent final specification audit**

Provide the approved design, the original Steps 19–22 request, and the full branch diff. Require explicit coverage findings for all invariants, examples, compatibility behavior, and non-goals.

- [ ] **Step 2: Run an independent final code-quality audit**

Focus on fail-open behavior, duplicate evidence, timestamp freshness, unit/currency coercion, cycle detection, ordering, recursion, raw-assessment trust, and forbidden optimizer/prediction semantics.

- [ ] **Step 3: Fix findings with TDD**

For every valid finding, add a failing regression test, make the smallest fix, and rerun the affected suite. Repeat both reviews until approved.

- [ ] **Step 4: Run full verification**

Run `npm run check` and `git diff --check`.
Expected: all tests, type checking, architecture checks, and build pass; no whitespace errors.

- [ ] **Step 5: Inspect final history and diff**

Confirm the branch contains only Steps 19–22 work above the intended Steps 16–18 base and that generated or unrelated files are absent.

- [ ] **Step 6: Push and open a stacked draft PR**

Push `action-space/steps19-22-dependencies-conflicts-risk` and open a draft PR against the Steps 16–18 branch. The description leads with the behavior change, lists the four boundaries, explains compatibility, and records exact verification evidence.

- [ ] **Step 7: Attach the PR and wait for CI**

Attach the created PR to the task, wait for every required check, and fix failures before reporting completion. Do not merge without explicit user authorization.

## Plan self-review

- Every Step 19 dependency example maps to an existing hard-constraint, eligibility-check, or experiment-readiness definition and is replayed from raw evidence.
- No Action-state dependency can request `ELIGIBLE`.
- Conflict evaluation is symmetric, target/scope/time aware, exhaustive, and selection-free.
- `timing.implementationDelay` remains the sole delay authority.
- Costs and burdens retain units, currencies, ranges, stages, and member identities.
- Reversibility is checked against known domain effects.
- Risk contracts contain exactly the six requested dimensions and no values or scores.
- Empty defaults preserve old v2 fingerprints; non-empty semantics are order independent.
- Compounds and experiment arms expand through exact identities with cycle and ambiguity checks.
- Translation and readiness replay raw evidence rather than trusting assessments.
- Every implementation task has focused TDD, a commit, and independent specification and quality review checkpoints.
