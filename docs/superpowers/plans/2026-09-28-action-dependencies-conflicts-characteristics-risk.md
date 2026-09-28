# Action Dependencies, Conflicts, Characteristics, and Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical prerequisite gates, symmetric pre-optimizer portfolio conflicts, typed implementation characteristics, and six value-free risk measurement dimensions while preserving existing v2 identities.

**Architecture:** Build pure schemas first, integrate their empty defaults into the canonical envelope second, and only then build registry- and evidence-aware assessors. Definition modules import core types but never assessment, translation, simulator, prediction, or optimization code. Assessment modules reuse public timing, eligibility, constraint, experiment-readiness, compound, and domain contracts; translation replays them from raw evidence.

**Tech Stack:** TypeScript, Zod, Temporal, Vitest, dependency-cruiser

---

## Required execution order and review rule

Tasks must run in order: pure schemas (1–4), minimal canonical integration (5), assessment and aggregation (6–9), translation and compatibility adapters (10), then public surface and final audit (11–12). Every task starts with a failing test, ends with focused verification and a commit, then receives a fresh specification review and a separate code-quality review. Valid review findings require a regression test before a fix.

## File map

- `src/action_dependencies/schema.ts`: pure dependency definitions and exact entity references.
- `src/action_conflicts/schema.ts`: pure conflict, coordinate, scope, and pair definition types.
- `src/action_characteristics/schema.ts`: pure cost line items, ranges, burdens, stages, and reversibility.
- `src/action_risk/schema.ts`: pure six-dimension measurement-contract union.
- `src/canonical_action/schema.ts`, `serialization.ts`: empty defaults, cross-field checks, and stable fingerprints.
- `src/action_dependencies/assessment.ts`: registry graph and raw-evidence dependency assessment.
- `src/action_conflicts/assessment.ts`, `adapters.ts`: expansion, scope/time intersection, and typed domain contradictions.
- `src/action_characteristics/validation.ts`, `aggregate.ts`: domain consistency and vectors/critical path.
- `src/action_risk/aggregate.ts`: member- and arm-stratified measurement-contract views.
- `src/action_translation/*`, `src/compound_action/readiness.ts`, `src/experiment/readiness.ts`: raw replay and readiness integration.
- `src/*/legacy.ts`: explicit one-way legacy adapters.

### Task 1: Pure dependency schema

**Files:**
- Create: `src/action_dependencies/schema.ts`
- Create: `src/action_dependencies/index.ts`
- Create: `tests/action_dependencies/schema.test.ts`

- [ ] Write failing tests for exact `ACTION` and `COMPOUND` ID/fingerprint references; all four dependency kinds; required `evaluationBoundary`; `whenUnknown`; unique IDs; closed objects; and rejection of lifecycle state `ELIGIBLE`. Receipt schemas carry raw events and reject wrapper `state`/`status` assertions.
- [ ] Assert the pure schema accepts unresolved registry references and graph cycles. Those require runtime registries and belong to assessment.
- [ ] Run `npx vitest run tests/action_dependencies/schema.test.ts --maxWorkers=1`; expect missing-module failures.
- [ ] Implement the strict discriminated union with lifecycle states `STARTED | EFFECTIVE | COMPLETED | RESOLVED` and no imports from assessors or translation.
- [ ] Run the focused test and `npm run typecheck`; expect PASS.
- [ ] Commit `feat: define action dependency contracts`.
- [ ] Complete fresh specification and code-quality reviews before Task 2.

### Task 2: Pure conflict and scope schema

**Files:**
- Create: `src/action_conflicts/schema.ts`
- Create: `src/action_conflicts/index.ts`
- Create: `tests/action_conflicts/schema.test.ts`

- [ ] Write failing tests for the closed `GLOBAL | PRODUCT | VARIANT | CHANNEL | PLACEMENT | POPULATION | RESOURCE | CUSTOM` coordinate union, non-empty intersection scopes, conflict kinds, exact/registered counterparties, normalized relation identity, unique IDs, and closed objects. Retain only `ANY_OVERLAP` and `EFFECTIVE_OVERLAP`, with their precise requested-start versus effective-start rules.
- [ ] Add leakage tests rejecting winner, priority, utility, rank, score, recommendation, selected action, and repair fields.
- [ ] Assert registry ambiguity and time/scope intersection are absent from pure schema validation.
- [ ] Run the focused test; expect missing-module failures.
- [ ] Implement pure definitions and deterministic pair-key normalization without importing timing resolution, registries, domains, or translation.
- [ ] Run the focused test and type checker; commit `feat: define symmetric conflict contracts`.
- [ ] Complete fresh specification and code-quality reviews.

### Task 3: Pure characteristics schema

**Files:**
- Create: `src/action_characteristics/schema.ts`
- Create: `src/action_characteristics/index.ts`
- Create: `tests/action_characteristics/schema.test.ts`

- [ ] Write failing tests for `KNOWN | RANGE | UNKNOWN | NOT_APPLICABLE`; integer minor-unit money; consistent range currency/unit; cost line-item ID/category/currency; operational resource quantities; and no evidence `sourceRefs` in definitions.
- [ ] Test stage semantics for `BEFORE_START | IMPLEMENTING | EFFECTIVE | COMPLETED`, `cancellationAvailable`, separate cancellation and compensation cost vectors, duplicate stages, and exact reachable-stage derivation for instantaneous send, persistent policy, temporary price, and committed inventory purchase.
- [ ] Test exact Action ID/fingerprint and versioned registered reversal references, typed irreversible effects, and strict `FULLY_REVERSIBLE | PARTIALLY_REVERSIBLE | IRREVERSIBLE | UNKNOWN | NOT_APPLICABLE` shapes.
- [ ] Recursively reject `delay`, `leadTime`, `implementationDelaySeconds`, and equivalent fields so `timing.implementationDelay` remains the sole declared delay.
- [ ] Run the focused test; implement pure schemas; rerun with type checking; commit `feat: define action characteristic contracts`.
- [ ] Complete fresh specification and code-quality reviews.

### Task 4: Pure six-dimension risk schema

**Files:**
- Create: `src/action_risk/schema.ts`
- Create: `src/action_risk/index.ts`
- Create: `tests/action_risk/schema.test.ts`

- [ ] Write failing tests requiring exactly six top-level keys: `FINANCIAL_DOWNSIDE`, `IRREVERSIBILITY`, `UNCERTAINTY`, `INVENTORY_EXPOSURE`, `CUSTOMER_IMPACT`, and `TIME_TO_RECOVERY`, with each property typed to its own strict measurement branch.
- [ ] Require one or more measurements under every key, unique measurement IDs, and the strict value-type branch allowed for each dimension.
- [ ] Test typed target where applicable, positive horizon, aggregation, metric/evidence-policy/source-definition references, loss baseline, irreversibility contract/effects, uncertain quantity plus closed parameter/metric or versioned custom source, specialized inventory target without a generic target, exact customer population without a generic target, recovery baseline/criterion/closed start boundary, controlled units, and versioned custom resource/unit definitions.
- [ ] Recursively reject values, scores, ratings, grades, probabilities, predictions, expected losses, confidence, weights, ranks, recommendations, and composite-risk fields.
- [ ] Run the red test; implement the strict discriminated union; run tests/typecheck; commit `feat: define risk measurement contracts`.
- [ ] Complete fresh specification and code-quality reviews.

### Task 5: Minimal canonical envelope and fingerprint integration

**Files:**
- Modify: `src/canonical_action/schema.ts`
- Modify: `src/canonical_action/serialization.ts`
- Modify: `src/canonical_action/fixtures.ts`
- Create: `tests/canonical_action/dependencies-conflicts-characteristics-risk.test.ts`
- Modify: `tests/canonical_action/serialization.test.ts`

- [ ] First lock current fingerprints for representative stored v2 Actions from Steps 10–18.
- [ ] Write failing tests that omitted new fields parse to empty dependencies/conflicts, absent characteristics, and absent risk contracts while retaining byte-for-byte historical fingerprints.
- [ ] Write failing tests that every non-empty semantic definition changes the fingerprint and that dependency/conflict/risk measurement input order does not.
- [ ] Test changed boundary, reference fingerprint, scope coordinate, cost category/currency/range, cancellation stage, reversal reference, risk target/horizon/type, and measurement ID.
- [ ] Add cross-field validation for unique IDs and local constraint/check existence. Require boundary equality with the referenced definition only for `HARD_CONSTRAINT_GATE`; eligibility checks are recomputed at the dependency boundary. Do not resolve registries or detect graph cycles here.
- [ ] Add a strict new-author helper requiring explicit characteristics plus all six risk dimensions, while the reader continues accepting old v2 payloads.
- [ ] Keep imports one-way: canonical schema may import the four schema modules; those modules may not import canonical schema, assessors, or translation.
- [ ] Run canonical and four schema suites plus type checking; commit `feat: integrate action portfolio definitions`.
- [ ] Complete fresh reviews focused on layering and fingerprint compatibility.

### Task 6: Dependency assessment and authoritative lifecycle evidence

**Files:**
- Create: `src/action_dependencies/assessment.ts`
- Create: `tests/action_dependencies/assessment.test.ts`
- Modify: `src/action_dependencies/index.ts`
- Modify: `src/experiment/readiness.ts`
- Modify: `tests/experiment/readiness.test.ts`

- [ ] Write failing binding tests for dependent ID/fingerprint, dependency ID, boundary equality, UTC-Z time, freshness, evidence refs, provenance, missing evidence, duplicate exact receipts, and order independence.
- [ ] Define raw immutable events with `eventId`, ACTION-only exact subject ID/fingerprint, `STARTED | EFFECTIVE | COMPLETED` event kind, UTC `occurredAt`, source, and provenance. Require exact prerequisite/event subject equality; wrappers cannot assert state. Reject compound-level lifecycle events. Only the existing bound investigation result proves `RESOLVED`.
- [ ] Test CompoundAction derivation from exact component ACTION events separately for `ALL_OR_NOTHING`, `BEST_EFFORT`, and `DEPENDENCY_GATED`, including skipped/failed accounting and newly unblocked downstream components. No omitted event, compound-level event, or ambiguous registry entry may produce a positive state.
- [ ] Test self-reference, direct/transitive cycles, and cycles through components or experiment arms in assessment, not schema.
- [ ] Extend experiment readiness tests with a deterministic `SUFFICIENT_ELIGIBLE_TRAFFIC` check bound to experiment fingerprint, population identity/fingerprint, binding time, sample target, evidence-derived eligible count, readiness fingerprint, and explicit raw-source maximum age. Add stale raw traffic and stricter caller-age regressions.
- [ ] Test hard-constraint, eligibility-check, and traffic gates by supplying raw evidence. Forged `SATISFIED`, `ELIGIBLE`, `READY`, or caller-provided traffic counts must fail.
- [ ] Require definition-boundary equality only for `HARD_CONSTRAINT_GATE`. Generated legacy/domain eligibility gates evaluate at the dependency boundary; accept only a recomputed exact result with matching action ID/fingerprint, dependency boundary, assessment fingerprint, and complete check manifest.
- [ ] Test winback only through exact `domain.lifecycle.audience_available` raw facts bound to action/fingerprint/population target/boundary/time/source/provenance. Cover stale, mismatched, and duplicate facts; reject snapshots and audience-available booleans as claims.
- [ ] Aggregate `BLOCKED > UNKNOWN > SATISFIED`, retain every sorted check, and fingerprint the assessment.
- [ ] Run dependency, experiment, eligibility, constraint, compound, and timing tests plus type checking; commit `feat: assess action dependencies from evidence`.
- [ ] Complete fresh reviews focused on cycles, lifecycle facts, boundary equality, traffic replay, freshness, and ambiguity.

### Task 7: Symmetric portfolio compatibility assessment

**Files:**
- Create: `src/action_conflicts/assessment.ts`
- Create: `src/action_conflicts/adapters.ts`
- Create: `tests/action_conflicts/assessment.test.ts`
- Create: `tests/action_conflicts/domains.test.ts`
- Modify: `src/action_conflicts/index.ts`

- [ ] Write failing tests for normalized relation identity: identical duplicates normalize with all paths; endpoint-equal declarations differing in kind, target, scope, temporal mode/direction, or registry version contradict; duplicate registry matches are ambiguous; unknown/self counterparties do not disappear.
- [ ] Write the full dimension-grouped coordinate matrix: `GLOBAL`, invalid empty scopes, repeated same dimensions, omitted/unconstrained dimensions, multi-coordinate scopes where all overlap, one dimension is disjoint, or none is disjoint and one is unresolved; product↔variant, resource/unit, channel↔placement, population evidence, custom registry evidence, different same-kind values, and unrelated kinds. Bind intersection evidence exactly.
- [ ] Test both temporal modes under reversal, including an explicit case where requested and effective starts make `ANY_OVERLAP` conflict while `EFFECTIVE_OVERLAP` does not. Persistent intervals begin at `modeSelectedStart`; also cover half-open adjacency, instants, and finite horizons.
- [ ] Test recurrence inclusion/clipping at both horizon boundaries, retained original bounds/indexes, declared recurrence end/max occurrence, open-ended recurrence, and assessor safety-cap truncation returning `UNKNOWN`.
- [ ] Build the price matrix first: exact `SET`, `DELTA`, and `MULTIPLY`; matching product/variant and currency; fresh unique baseline reference/fingerprint for delta/multiply; different results conflict; different targets/currencies or equal results do not. Missing/duplicate baselines return `UNKNOWN`.
- [ ] Add typed adapters for existing promotion, shipping, merchandising, CRO, lifecycle, exclusive-resource, and policy conflicts. Reject label, substring, and free-text inference.
- [ ] Expand without silent deduplication. Reject duplicate top-level or independent execution paths unless a versioned alias contract identifies one execution. Memoize only the same traversal path for cycle handling; never use a global visited set. Preserve every path and report conflicting payloads as ambiguous.
- [ ] Test experiment arm semantics: global/shared-state and resource writes can conflict across arms; population-scoped Actions coexist only with exact assignment/partition evidence proving disjointness; missing/duplicate partition evidence yields `UNKNOWN`; diagnostics retain arm and nested component paths.
- [ ] Return every unordered pair and aggregate `CONFLICTING > UNKNOWN > COMPATIBLE`; never return a winner, subset, rank, utility, or repair.
- [ ] Run conflict, timing, compound, experiment, and domain suites plus type checking; commit `feat: assess portfolio compatibility`.
- [ ] Complete fresh specification and quality reviews focused on symmetry, time, scope, price baselines, arm partitions, and expansion paths.

### Task 8: Characteristics validation and compound vectors

**Files:**
- Create: `src/action_characteristics/validation.ts`
- Create: `src/action_characteristics/aggregate.ts`
- Create: `tests/action_characteristics/validation.test.ts`
- Create: `tests/action_characteristics/aggregate.test.ts`
- Modify: `src/action_characteristics/index.ts`

- [ ] Test known domain invariants: reversible ad-budget changes, stage-sensitive inventory commitments, delivered lifecycle messages, and existing pricing/shipping/merchandising/CRO rollback contracts.
- [ ] Prove an exact compensating Action is not full reversal when typed irreversible effects remain. Reject missing/mismatched Action fingerprints and ambiguous registered reversals.
- [ ] Test cost buckets by line-item category and currency, burden buckets by resource/unit, and cancellation versus compensation by lifecycle stage. Preserve `UNKNOWN` and `NOT_APPLICABLE` separately.
- [ ] Test compound aggregation by execution policy: ordered/dependent branches expose a derived critical-path delay; parallel branches retain branch buckets. Declared delay remains per member from `timing.implementationDelay`; derived critical path is separate and never mutates it.
- [ ] Expand nested compounds without silent deduplication, retaining all paths and rejecting repeated execution identities unless a versioned alias contract authorizes one shared execution.
- [ ] Test experiment output as arm-stratified vectors with arm ID, role, and allocation basis points. Keep shared setup separate and never naively sum alternative-arm costs, burdens, delays, reversibility, or cancellation costs.
- [ ] Run characteristics, timing, rollback, compound, and experiment suites plus type checking; commit `feat: validate and aggregate action characteristics`.
- [ ] Complete fresh reviews focused on stage meaning, reversal identity, vector buckets, and critical-path separation.

### Task 9: Risk contract views for compounds and experiments

**Files:**
- Create: `src/action_risk/aggregate.ts`
- Create: `tests/action_risk/aggregate.test.ts`
- Modify: `src/action_risk/index.ts`

- [ ] Test atomic views retaining all six dimensions, multiple measurements, exact target, horizon, type, and member identity without any value.
- [ ] Test compound views grouped by dimension and exact member/component path. Do not add heterogeneous measurements or create a composite risk contract.
- [ ] Test experiment views stratified by arm with role and allocation basis points; keep shared setup separate; do not combine alternative-arm risks.
- [ ] Test repeated identities with and without alias contracts, ambiguous payloads, nested compounds, cycles, and deterministic order.
- [ ] Recursively assert no aggregate output gains score, weight, probability, estimate, expected loss, prediction, rank, or recommendation fields.
- [ ] Run risk, compound, and experiment suites plus type checking; commit `feat: expose action risk contract views`.
- [ ] Complete fresh specification and code-quality reviews.

### Task 10: Legacy adapters, compound readiness, and translation replay

**Files:**
- Create: `src/action_dependencies/legacy.ts`
- Create: `src/action_conflicts/legacy.ts`
- Create: `src/action_characteristics/legacy.ts`
- Create: `src/action_risk/legacy.ts`
- Modify: `src/compound_action/readiness.ts`
- Modify: `src/action_translation/context.ts`
- Modify: `src/action_translation/types.ts`
- Modify: `src/action_translation/canonical.ts`
- Modify: `src/action_translation/compound.ts`
- Modify: `src/action_translation/experiment.ts`
- Create: `tests/compatibility/action-portfolio-legacy.test.ts`
- Create: `tests/action_translation/portfolio-gates.test.ts`

- [ ] Write legacy tests before adapters. Prove lossless mapping into exactly seven cost buckets: `MEDIA`, `LABOR`, `PLATFORM`, `PROCUREMENT`, `FULFILLMENT`, `CANCELLATION`, and `OTHER`, retaining original field/amount/currency in adapter provenance. Reject missing currency, conversions, ambiguous/negative values, and prose.
- [ ] Test timing-only delay mapping; typed burden mappings for staff/service time, inventory units, orders, messages, and placements; exclusions for money-only/narrative/complexity/score/unregistered values; exact reversibility mapping; stage cancellation default `UNKNOWN`; and no prose/label/score-to-risk-metric conversion.
- [ ] Prove adapter output does not change historical serialization or fingerprints and native writers never emit legacy shapes.
- [ ] Test readiness order: exact expansion, eligibility/constraints from raw evidence, dependencies from raw evidence, compatibility from raw evidence/timing, compound/experiment readiness, then simulator capability.
- [ ] Test forged assessments, incomplete manifests, stale receipts, duplicate evidence, boundary mismatch, fingerprint mismatch, registry ambiguity, and missing recurrence/partition horizons.
- [ ] Assert a blocked dependency or conflicting portfolio emits no interventions or experiment tasks. Preserve all diagnostic checks/pairs/paths.
- [ ] Prove satisfied dependencies do not imply eligibility, compatibility does not imply simulator support, characteristics/risk contracts are descriptive unless an existing hard policy gate references a measured metric, and translation does not imply execution.
- [ ] Run compatibility, translation, readiness, eligibility, constraint, timing, compound, and experiment suites plus type checking; commit `feat: enforce action portfolio gates`.
- [ ] Complete fresh reviews focused on fail-open adapters and raw-status bypasses.

### Task 11: Public exports, architecture, documentation, and CI

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `.dependency-cruiser.cjs`
- Modify: `README.md`
- Create: `docs/action-dependencies-conflicts-characteristics-risk.md`
- Create: `.github/workflows/action-dependencies-conflicts-risk-ci.yml`
- Create: `tests/architecture/action-portfolio-boundaries.test.ts` if needed.

- [ ] Add failing built-package tests for root exports and `./action-dependencies`, `./action-conflicts`, `./action-characteristics`, and `./action-risk` subpaths.
- [ ] Add one-way architecture rules: pure schema modules cannot import canonical, assessment, translation, simulator, prediction, evaluation, ranking, optimizer, oracle, provider execution, or God-mode modules; canonical may import schemas only; assessment may import public evidence/readiness contracts; translation consumes assessment APIs.
- [ ] Document definitions versus observations/assessments/readiness/translation/execution, authoritative lifecycle events, boundary equality, time/scope intersection, price baselines, arm partitions, characteristics buckets/critical path, all six risk dimensions, legacy behavior, and non-goals.
- [ ] Add focused CI covering all new suites plus canonical, timing, constraints, eligibility, experiment, compound, translation, architecture, type checking, and build.
- [ ] Run focused CI commands locally; commit `docs: publish action portfolio contracts`.
- [ ] Complete fresh specification and quality reviews.

### Task 12: Final audits, verification, and draft PR

**Files:**
- Review every file changed from the Steps 16–18 base branch.

- [ ] Dispatch an independent final specification audit with the original Steps 19–22 request, approved design, and full diff.
- [ ] Dispatch a different final code-quality audit focused on fail-open paths, ambiguity, freshness, boundary equality, cycles, half-open recurrence, price baselines, expansion paths, vector errors, fingerprint drift, and forbidden scoring/selection/prediction.
- [ ] Fix each accepted finding by first adding a failing regression test; repeat reviews until both approve.
- [ ] Run `npm run check` and `git diff --check`; expect all tests, type checking, architecture, and build to pass with no whitespace errors.
- [ ] Confirm the branch contains only Steps 19–22 work above the intended Steps 16–18 base.
- [ ] Push `action-space/steps19-22-dependencies-conflicts-risk`, open a stacked draft PR against the Steps 16–18 branch, attach it to the task, and wait for every required CI check. Do not merge without explicit user authorization.

## Self-review against reviewer findings

1. Pure schemas precede minimal canonical integration; assessors follow, with one-way imports stated and tested.
2. Every dependency has an evaluation boundary; hard-constraint gates match their definition, while eligibility gates recompute and verify the complete result at the dependency boundary.
3. Traffic dependency uses a deterministic positive experiment-readiness check with fingerprint and raw replay.
4. Cycles and lifecycle semantics live in assessment; authoritative Action events and CompoundAction derivation are explicit.
5. Conflict scope uses a closed coordinate union plus bound intersection evidence.
6. Half-open intervals, instants, recurrence expansion, and finite horizons are symmetric and explicit.
7. Declaration contradictions, registry ambiguity, and repeated expansion paths cannot disappear through deduplication.
8. Price `SET | DELTA | MULTIPLY` has exact currency and baseline semantics.
9. Experiment global/shared writes can conflict; population arms need exact disjoint partition evidence; arm paths remain visible.
10. Characteristics include `UNKNOWN` and `NOT_APPLICABLE`, category/currency line items, cancellation versus compensation, exact reversal references, typed irreversible effects, and no definition evidence refs.
11. Risk is a strict discriminated union with exactly six top-level dimensions and one or more measurements per dimension.
12. Legacy adapters and historical serialization/fingerprint tests are explicit.
13. Compounds use execution-policy buckets and a separately derived critical path; experiments remain arm-stratified with allocation metadata and no naive sums.
14. Declared member delay remains solely in `timing.implementationDelay`; the derived critical path is a separate assessment output.
15. Compatibility and fingerprint tests cover empty defaults, every non-empty semantic field, order independence, and legacy stability.
16. Lifecycle evidence uses ACTION-only raw immutable events; exact prerequisite/component subject matching is required, compound-level events are rejected, and all three compound atomicity policies have derivation tests.
17. Winback uses only `domain.lifecycle.audience_available` with exact bound raw facts; snapshot/boolean claims are rejected.
18. Traffic evidence has an explicit source maximum age and stale-source regressions.
19. Every retained temporal mode, mode-selected persistent start, dimension-grouped multi-coordinate intersection case, recurrence horizon edge, relation contradiction, and duplicate execution path has explicit semantics and tests.
20. Cancellation versus compensation and reachable stages are fixed for instantaneous send, persistent policy, temporary price, and committed inventory.
21. Risk map properties use dimension-specific strict branches with exact loss/recovery baselines, recovery criterion/start boundary, population, inventory, closed uncertainty source, and irreversibility links plus controlled/versioned custom units; specialized inventory/customer branches have no generic target.
22. The legacy adapter has seven lossless cost buckets, timing-only delay, typed burden inclusion/exclusion, exact reversibility, unknown cancellation defaults, and no prose-to-risk mapping.
