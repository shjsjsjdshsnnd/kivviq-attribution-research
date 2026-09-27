# Experiment, Eligibility, and Hard Constraints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native canonical experiments, evidence-backed eligibility, and typed hard constraints without adding experiment selection, outcome evaluation, or execution orchestration.

**Architecture:** Extend the v2 canonical Action envelope with native experiment intent and immutable hard-constraint definitions. Keep runtime arm resolution, constraint assessments, and eligibility results in separate modules, then make translation and compound readiness consume those bound results without conflating eligibility with simulator capability.

**Tech Stack:** TypeScript, Zod, Temporal, Vitest, dependency-cruiser

---

### Task 1: Typed hard-constraint definitions

**Files:**
- Create: `src/action_constraints/schema.ts`
- Create: `src/action_constraints/index.ts`
- Create: `tests/action_constraints/schema.test.ts`

- [ ] Write failing tests for every requested constraint kind, strict unknown-field rejection, typed values, target/scope, evaluation boundary, `whenUnknown`, resource references, and custom registry references.
- [ ] Run `npx vitest run tests/action_constraints/schema.test.ts --maxWorkers=1` and confirm the tests fail for missing modules.
- [ ] Implement the strict constraint union and exported TypeScript types.
- [ ] Reject outcome, recommendation, ranking, and unstructured policy fields.
- [ ] Run the focused test and type checker.

### Task 2: Evidence-bound constraint assessment

**Files:**
- Create: `src/action_constraints/assessment.ts`
- Create: `tests/action_constraints/assessment.test.ts`
- Modify: `src/action_constraints/index.ts`

- [ ] Write failing tests for action/fingerprint/target binding, timestamps, freshness, boundaries, currencies, units, resource availability, resulting-state values, and deterministic multi-check output.
- [ ] Add regressions proving stale or unknown evidence cannot satisfy a hard constraint and literal contradictions override caller claims.
- [ ] Implement `assessHardConstraints` with `SATISFIED | VIOLATED | UNKNOWN` results for every constraint.
- [ ] Keep evidence receipts separate from immutable definitions.
- [ ] Run focused tests and type checking.

### Task 3: Canonical experiment WHAT

**Files:**
- Create: `src/experiment/schema.ts`
- Create: `src/experiment/index.ts`
- Create: `tests/experiment/schema.test.ts`
- Modify: `src/canonical_action/schema.ts`
- Modify: `src/canonical_action/serialization.ts`

- [ ] Write failing tests for NO_OP and active controls, multiple treatments, allocation totals, fixed sample/horizon rules, randomization units, assignment population, metric references, and semantic fingerprints.
- [ ] Add leakage regressions for winner, lift, significance, adaptive allocation, sequential stopping, recommendations, and expected value.
- [ ] Implement the strict `experiment.run` WHAT schema and require the envelope population.
- [ ] Require distinct arm IDs and references, one control, at least one treatment, and a 10,000-basis-point total.
- [ ] Integrate experiment intent into canonical parsing and fingerprints without changing historical readers.
- [ ] Run focused canonical and experiment tests.

### Task 4: Experiment arm resolution and readiness

**Files:**
- Create: `src/experiment/readiness.ts`
- Create: `tests/experiment/readiness.test.ts`
- Modify: `src/experiment/index.ts`

- [ ] Write failing tests for exact ID/fingerprint resolution, missing arms, duplicate semantics, atomic and compound arms, cyclic references, population binding, timing, metrics, traffic, and engine capability.
- [ ] Implement a strict runtime context and `assessExperimentReadiness` returning per-arm and overall `READY | BLOCKED | UNKNOWN` without mutating intent.
- [ ] Resolve arm graphs deterministically and reject self-reference or cycles.
- [ ] Keep experiment execution and results outside readiness.
- [ ] Run focused tests and type checking.

### Task 5: Unified Action eligibility

**Files:**
- Create: `src/action_eligibility/schema.ts`
- Create: `src/action_eligibility/evaluate.ts`
- Create: `src/action_eligibility/index.ts`
- Create: `tests/action_eligibility/evaluate.test.ts`

- [ ] Write failing tests for full check aggregation and precedence `INELIGIBLE > UNKNOWN > ELIGIBLE`.
- [ ] Cover preconditions, hard constraints, domain rules, `whenUnknown`, evidence receipts, unsupported families, and invalid inputs.
- [ ] Implement the narrow evidence port and deterministic result schema bound to Action ID, fingerprint, evaluation boundary, and timestamp.
- [ ] Adapt legacy preconditions and recognized constraints without trusting caller-supplied result maps.
- [ ] Preserve all failed and unresolved checks rather than returning the first issue.
- [ ] Run focused tests and type checking.

### Task 6: Domain eligibility adapters and required examples

**Files:**
- Create: `src/action_eligibility/adapters.ts`
- Create: `src/action_eligibility/fixtures.ts`
- Create: `tests/action_eligibility/domains.test.ts`
- Modify: `src/action_eligibility/index.ts`

- [ ] Write failing tests for discontinued products, merchant-disabled channels, resulting price below floor, resulting margin below minimum, insufficient inventory, unavailable budget, operational capacity, maximum discount, merchant policy, contractual restrictions, and measurable risk limits.
- [ ] Implement generic paid-media and pricing checks plus adapters for existing inventory, promotion, shipping, merchandising, CRO, and lifecycle rules.
- [ ] Ensure target-specific facts cannot satisfy another target's constraint.
- [ ] Add canonical fixtures for every Step 17–18 example.
- [ ] Run focused tests and type checking.

### Task 7: Canonical envelope and compatibility integration

**Files:**
- Modify: `src/canonical_action/schema.ts`
- Modify: `src/canonical_action/serialization.ts`
- Modify: `src/canonical_action/legacy.ts`
- Create: `src/action_constraints/legacy.ts`
- Create: `tests/canonical_action/constraints.test.ts`

- [ ] Write failing tests for empty/default constraint semantics, fingerprint changes, strict validation, legacy mapping, and preservation of historical serialized Actions.
- [ ] Add the constraint array to canonical Actions while keeping old v2 payloads readable.
- [ ] Map recognized legacy expressions exactly and route unrecognized expressions to registered custom definitions.
- [ ] Reject currency, unit, target, and contradictory-bound mismatches.
- [ ] Run canonical, legacy, and constraint tests.

### Task 8: Translation and experiment-engine task

**Files:**
- Create: `src/action_translation/experiment.ts`
- Modify: `src/action_translation/canonical.ts`
- Modify: `src/action_translation/types.ts`
- Modify: `src/action_translation/index.ts`
- Create: `tests/action_translation/experiment-canonical.test.ts`

- [ ] Write failing tests proving native experiments produce zero commercial interventions plus a structured experiment task.
- [ ] Require a bound `ELIGIBLE` result; map `INELIGIBLE` to an explicit failure and `UNKNOWN` to missing context.
- [ ] Preserve exact experiment, arm, population, and timing identities.
- [ ] Keep legacy `EXPERIMENT_REQUIRES_ENGINE` behavior unchanged.
- [ ] Reject absent, stale, mismatched, or forged eligibility results.
- [ ] Run translation tests and type checking.

### Task 9: Compound integration

**Files:**
- Modify: `src/compound_action/readiness.ts`
- Modify: `src/action_translation/compound.ts`
- Modify: `tests/compound_action/compound.test.ts`
- Modify: `tests/action_translation/compound-canonical.test.ts`

- [ ] Write failing tests mapping component eligibility into compound readiness while retaining checks.
- [ ] Cover experiment components, experiment arms that reference compounds, all-or-nothing behavior, dependencies, simulator support, and coupled constraints.
- [ ] Implement eligibility as a gate separate from timing, constraints, and simulator capability.
- [ ] Preserve every component and experiment-task identity in translation output.
- [ ] Run compound and translation tests.

### Task 10: Public surface, architecture, documentation, and CI

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `.dependency-cruiser.cjs`
- Modify: `README.md`
- Create: `docs/experiment-eligibility-constraints.md`
- Create: `.github/workflows/experiment-eligibility-constraints-ci.yml`
- Create: `tests/architecture/experiment-boundaries.test.ts` if architecture assertions need source-level coverage

- [ ] Export experiment, constraint, and eligibility modules through package subpaths and the operator-safe root.
- [ ] Block imports from simulator internals, ground truth, evaluation, ranking, optimizer, and provider execution.
- [ ] Document Action definition, constraint assessment, eligibility, translation, execution, and result as separate states.
- [ ] Document legacy compatibility and the fixed-allocation experiment boundary.
- [ ] Add a focused test script and stacked-branch CI workflow.
- [ ] Run architecture and focused tests.

### Task 11: Review, verification, and draft PR

**Files:**
- Review all files changed since `b9d404c`.

- [ ] Dispatch an independent specification reviewer against the approved design.
- [ ] Fix every critical or important gap with a failing regression test, then re-run the reviewer.
- [ ] Dispatch an independent code-quality and boundary reviewer.
- [ ] Fix material findings and re-run focused checks.
- [ ] Run `npm run check` and confirm architecture, type checks, the full inherited suite, and build all pass.
- [ ] Commit the implementation, push `action-space/steps16-18-experiment-eligibility-constraints`, and open a draft PR against `action-space/steps13-15-decision-forms`.
- [ ] Attach the PR and wait for all GitHub checks.
