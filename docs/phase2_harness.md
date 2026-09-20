# Phase 2 research harness

## Status

This branch contains **research infrastructure only**. It does not implement a Phase 2 attribution candidate.

The frozen Phase 1 reference is:

`1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf`

The Phase 1 models, simulator, benchmark, and reports are verified by blob hash in CI and must remain unchanged.

## Research sequence

`ESTIMAND -> CANDIDATE HYPOTHESIS -> DEVELOPMENT -> FROZEN_PHASE1 -> SEALED_HOLDOUT -> ROBUSTNESS/UNCERTAINTY -> SURVIVE/REJECT`

A candidate must declare what it estimates before implementation/evaluation.

## Three information layers

### Candidate-visible

Future candidate code receives only the standalone `phase2_candidate_sdk` and a standardized observable dataset/context. The declaration contract requires candidate ID/version, estimand, hypothesis, observable inputs, assumptions, outcome type, negative/interaction representability, uncertainty method, hyperparameters and selection procedure, development usage, randomization behavior, expected failures, and preregistered falsification criteria.

### Benchmark-visible

The `FrozenPhase1Adapter` references the exact frozen Phase 1 commit and exposes cases labelled `FROZEN_PHASE1`. Phase 1 truth is a known falsification benchmark and is not treated as a sealed holdout.

### Evaluator-only

`attribution_lab.phase2_evaluator` owns holdout instantiation, private seal files, oracle truth, scoring, gates, and the research ledger.

Candidate evaluation executes in a temporary isolated Python subprocess. Only the candidate source and a copied `phase2_candidate_sdk` are placed in the candidate workspace. Static AST checks reject direct and common dynamic imports of `attribution_lab`, and a runtime import guard blocks normal imports of it in the subprocess.

## Estimands

Typed estimands cover contracts for descriptive allocation, average treatment effects, conditional treatment effects, incremental conversion probability, incremental revenue, and time-varying treatment effects. These are definitions only; no estimator for these families is implemented here.

Every estimand explicitly states population, treatment/exposure, outcome, horizon, intervention, comparison, unit, temporal ordering, treatment regime, and aggregation target.

## Development worlds

Development worlds are candidate-visible and may be used for architecture selection, hyperparameter selection, debugging, and diagnostics. `DevelopmentWorldRecord` records the exact development world IDs, parameter ranges, architecture-selection notes, and hyperparameter-selection notes. Development output is always labelled `DEVELOPMENT`.

## Frozen Phase 1

The adapter always records the frozen commit and labels output `FROZEN_PHASE1`. CI runs `scripts/check_phase1_frozen.py` so a Phase 2 change to frozen Phase 1 source/report files fails validation.

## Sealed holdouts

The evaluator supports these public family names without exposing instantiated parameters:

- selection shift
- latent-intent shift
- prevalence/ordering shift
- time-varying and delayed effects
- unseen interactions
- negative/heterogeneous effects
- sparse identity loss
- compounded measurement failure

`HoldoutSealStore` creates immutable versioned seal files outside the repository. Public metadata contains only version, generator/configuration fingerprints, creation timestamp, family manifest, and protocol version. Exact seeds and instantiated parameters remain in the evaluator-owned seal.

Changing a holdout creates a new version. Existing versions cannot be overwritten.

## Evaluation isolation

Candidate code is called conceptually as:

`estimate(observed_dataset, declared_context) -> CandidateResponse`

The candidate receives no oracle truth, holdout parameters, hidden seed, holdout manifest, or evaluator scoring object. The parent evaluator compares estimates to oracle truth only after candidate execution.

Candidate exceptions are sanitized to a generic execution failure rather than returning evaluator internals.

## Result separation

`SeparatedEvaluationReport` has three independent fields:

- `development_results`
- `frozen_phase1_results`
- `sealed_holdout_results`

It deliberately has no overall/weighted score.

## Survive / reject / inconclusive

Falsification rules are preregistered per candidate version. The gate evaluates required holdout families independently. A failing required family causes `REJECT`. Missing required families cause `INCONCLUSIVE`. Unsupported/invalid required families cannot become zero error. Development and Phase 1 results are not averaged with holdout results and cannot rescue holdout failure.

Thresholds are not supplied by the harness; they must be preregistered by the candidate protocol.

## Anti-overfitting

The registration store fingerprints the declaration, code, and development usage. Reusing an ID/version with changed estimand, hypothesis, assumptions, architecture/code, hyperparameters, criteria, or development record is rejected.

The first holdout exposure is recorded. Repeated exposure to the same holdout version is blocked unless explicitly marked as an exact reproducibility rerun, and code/declaration fingerprints must still match.

Holdout versions are append-only rather than replaceable.

## Research ledger

The synthetic research ledger is JSONL with a hash chain. Each entry records candidate/version, estimand and hypothesis fingerprints, code fingerprint, development record fingerprint, Phase 1 reference, holdout version, protocol version, result/uncertainty/robustness summaries, outcome, and rejection reasons.

It never records private or real-world data and never stores hidden holdout parameter values.

## Robustness and uncertainty

The harness defines a `RobustnessPlan` contract for repeated seeds, sample sizes, measurement degradation, sparsity, identity loss, temporal shifts, selection shifts, and the candidate-declared uncertainty method. It does not prescribe one uncertainty estimator for all estimands.

## Residual isolation limitations

This is strong **research-process isolation**, not a hostile-code sandbox.

Python code running under the same operating-system account can potentially use filesystem access, process APIs, debugger/introspection techniques, or deliberate exploitation to escape normal import conventions. The harness blocks normal/static/dynamic imports of evaluator modules and does not serialize hidden truth into candidate inputs, but it does not claim OS-level confidentiality against malicious code.

For stronger adversarial isolation, execute candidates in a separate container/VM with a read-only candidate SDK/data mount and no evaluator filesystem access.

Because the repository is public, evaluator implementation code is visible to researchers. What remains sealed is each instantiated holdout's exact synthetic parameters and seed, stored outside Git. This prevents routine tuning against instantiated holdouts; it cannot prevent a human from studying the public generator family design.

## Real-world boundary

Synthetic causal recovery remains evidence about the simulator only. This harness does not establish real-world causal validity and does not access any production or merchant system.
