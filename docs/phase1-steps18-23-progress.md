# Steps 18–23: decision truth, reproducibility and acceptance evidence

Status: **Phase 1 accepted for the current PR merge candidate.** GitHub Actions run `36789127433` tested merge commit `53b1cfd581b0891529950d7ba5f39e1d8f319d0e` (head `d981589ff85bc8d2204d3bae5887fea7f88da815` onto base `5155f4a36f74ebb9e2c6ec65095dee35c582ca24`) and produced `96/96 PASS` with all 21 frozen Phase 1 requirements passing. Acceptance artifact SHA-256: `0d8994d631bf1b42b13978bdada7025552b2d53b6d8c09e8263868657e5e2603`. The focused suite passed 218/218 tests; the full repository suite passed 513/513 tests across 100 files. This is Phase 1 simulator/research acceptance, not production deployment readiness. All worlds are public synthetic fixtures. No production merchant data, platform credentials or live commerce APIs are used.

## 18. Two distinct decision oracles

### Exact finite-support expectations

`src/evaluation/exact-decision-oracle.ts` exhausts both the complete registered action set and the complete finite support of exogenous world states. Each state has a positive integer probability mass. The evaluator obtains economics by executing the model for every action/state pair; it does not accept an answer table or rank attributed revenue.

Weighted contribution totals, ties, ordering and regret use BigInt rational arithmetic. Displayed means may be fractional minor units. The quantity being optimized is **max over actions of expected contribution**, not **expected value of the per-state hindsight winner**. A unit control makes the distinction explicit: the former uplift is 7 minor units, while the latter is 10.

Completeness remains a property the registered model builder must establish. Passing 100 convenient seeds to a callback is not exhaustive integration over a stochastic population. Missing actions, empty/truncated support, invalid probability masses, insufficient execution budgets and failed branches abort the comparison. Stored rankings are independently reconciled against their complete outcome/economic ledger before regret is scored, even when someone has recomputed a digest after editing a result.

`finiteIntegerGrid` enumerates bounded integer grids without silently dropping an unreachable endpoint. Exhausting a grid certifies that grid, **not a continuous or global optimum**. A general continuous optimizer is not added in this step.

### Executed 37-action control

`tractable-checkout-control.ts` is a deliberately small structural model with four independent buyers, each having four equally likely exogenous states: 256 possible worlds. It registers 37 alternatives: no-op; 12 Google allocations; 12 Meta allocations; four mobile-checkout improvements; four winback variants; and four discounts. Purchases are generated from buyer intent, channel/action effects, prices and finite stock. Contribution subtracts product cost, payment fees, shipping, fulfillment, actual paid allocation and implementation expense.

Full enumeration executes **37 × 256 = 9,472 model evaluations**. The current model's best action is `checkout-3`; its expected contribution is 97,000 minor units and its uplift versus no-op is 40,593.75 minor units. Choosing no-op therefore has exact expected regret **10,392,000 / 256 = 40,593.75 minor units**, or **CAD 405.9375**. The worst action is `meta-12`, whose zero-effect expenditure loses 120,000 minor units relative to no-op. These values arise from the model, not the example dollar amounts in the task.

This is a tractable oracle control, **not 37 fully integrated canonical BusinessActions, a calibrated merchant, a new accepted adversarial scenario, or measured Growth Operator performance**. A test choosing no-op is not evidence that Kivviq made that decision.

### Main-simulator outcomes and blinded choices

The existing finite/shared-seed oracle and scheduled-spend adapter remain available. Their arithmetic now safely aggregates integer outcomes, verifies stored summaries and preserves metadata against callback mutation. Single-seed results remain **realized counterfactual regret**. Multiple-seed results remain **in-sample finite-set estimates**; no verified expected-optimum label is silently attached to them.

`blind-decision-trial.ts` adds an explicit offer → locked choice → evaluator reveal lifecycle. Before a valid choice, the oracle callback is not executed. Concurrent reveal requests share one evaluation. A choice cannot be replaced after seeing the answer; a failed evaluation cannot silently fall back to another branch. The safe `decision-protocol.ts` carries only the corrupted observation, objective/time/currency, neutral action descriptions and action IDs. There is no transport operation to reveal truth or reset the experiment.

The main-simulator adapter checks that the oracle evaluated the exact observation used for the choice. It deliberately supports one fixed decision seed and labels its regret as realized, not conditional expected regret. The registered descriptions and interface must not encode a scenario's answer; schema validation does not prove arbitrary prose is free of clues.

## 19. Reproduce the actual executable experiment

The existing measured-world manifest already retains the complete merchant manifest, customer population, channels, causal graph, response curves, external-shock inputs, measurement configuration, interventions and all three output hashes. The updated schema is `evaluator-replay-manifest/1.1.0`.

New execution identity records the exact Node version, V8/ICU versions, platform, architecture, locale and timezone, plus hashes of source/configuration, the dependency lock and compiled JavaScript. `.nvmrc` pins Node **22.16.0**; direct dependencies are exact versions, transitive dependencies are committed in `package-lock.json`, and every workflow uses `npm ci`. Builds remove stale output and create a new build fingerprint. CLI evidence requires committed runtime inputs and a fresh matching build; changed, deleted, staged or untracked runtime source cannot masquerade as the recorded revision.

Replay refuses mismatched code, runtime, source, lock or compiled output instead of claiming byte-identical reproduction across unverified environments. For cross-machine reproduction use the recorded revision **and** recorded environment. A digest is an integrity check, not a signature, proof of authorship, or an OS isolation boundary. Installed dependency provenance relies on `npm ci` and lockfile integrity; it is not a hash of every live node_modules byte.

Programmatic measured manifests explicitly distinguish `unbound_programmatic` from `revision_locked_build`; weaker provenance is never silently represented as a locked executable. `decision-manifest.ts` captures complete prospective action experiments, choice commitments and result hashes, and reruns all branches to verify the recorded result. Its programmatic contract pins revision/runtime, not a compiled-build claim. CLI exact-control artifacts additionally bind executable identity.

Example commands from a clean checkout of the recorded public revision, with the pinned runtime:

```sh
nvm use
npm ci --no-audit --no-fund
npm run build
mkdir -m 700 /tmp/kivviq-evaluator

npm run --silent simulate -- --scenario 9274 --seed 88213 \
  --manifest /tmp/kivviq-evaluator/world.json > /tmp/observed-first.json
npm run --silent simulate -- --replay /tmp/kivviq-evaluator/world.json > /tmp/observed-replay.json
cmp /tmp/observed-first.json /tmp/observed-replay.json

npm run oracle:control -- --out /tmp/kivviq-evaluator/oracle.json --selected a0
npm run replay:oracle -- --input /tmp/kivviq-evaluator/oracle.json
npm run validate:phase1 -- --out /tmp/kivviq-evaluator/validation.json --run-id public-validation-1
```

Validation intentionally exits **2** when Phase 1 is incomplete or failing. CLI summaries contain status/counts/hashes only, never truth or rankings. Evaluator artifacts are created exclusively with mode **0600** and cannot overwrite existing paths. Keep their directory, code and process inaccessible to the Operator. Scenario `9274` remains the registered measurement control, not a new canonical trap.

## 20. Test the simulator, not just generated files

`simulator-audit.ts` independently reconciles line/order revenue and per-order booked economics using integers; checks unique order identity, customer existence/timing, perfect server orders, observed-event chronology and retained causal inputs; and checks every physical inventory ledger transition and final position. It recomputes inventory conservation rather than trusting an engine-provided `reconcilesExactly` flag. Absent inventory execution is **NOT_MEASURED**, not evidence of zero impossible states. In the current kernel all initial explicit agents exist at episode start; a future late-entry population model needs its own birth-time contract.

The registered executable matrix has **61 checks**, including:

- Replay, non-vacuous order accounting, physical inventory and truth/measurement boundaries for **11 merchant archetypes**, with 64 explicit agents per world.
- Observed execution of **seven core channels** and actual membership of **six overlapping customer segments**.
- Independent-seed distribution comparisons for generated AOV and repeat propensity, economic constraints and heterogeneity. Archetypes are independently drawn from the same fixed uniform mixture; units are merchants, not correlated events from one merchant. Thresholds are fixed before evaluation.
- Complete 37-action/256-state oracle enumeration; an actual main-simulator zero-effect budget intervention with identical predecision evidence and future purchases; and independent reconciliation of its additional scheduled expenditure.
- Checks of registered Hill response curves at and above half-saturation, where diminishing marginal response is expected.

The actual-spend test covers a different scope from the per-order legacy marketing-allocation audit. It does not turn legacy allocated marketing costs into total store contribution. Returns, retention, overhead and inventory-aware long-horizon action economics still require compatible oracle adapters.

The statistical checks establish internal stationarity and basic constraints, **not external calibration to real ecommerce**. No Maison Olive calibration is used. The exact +20%/doubling recovery tests are explicitly analytic controls; they are not presented as measured +20% recovery for the entire event kernel. Broader empirical calibration remains later research work and is not represented as part of the frozen Phase 1 acceptance table.

Mutation tests deliberately inject wrong revenue, unknown customers, purchases before the episode, negative inventory, future receipts, stale executables, altered results and missing evidence. A validator that also accepts those mutations is not considered adequate.

## 21. Preserve the three truth layers

The flow remains:

```text
Evaluator latent truth
    → perfect observable facts
    → corrupted observations
    → Operator offer / observe / step / choose
```

Only the evaluator receives manifests, oracle traces, exact probability masses, world hashes, alternative-branch outcomes, regret, scenario labels or qualification diagnostics. Safe protocol modules are separate entry points and are covered by architecture/transitive-import checks. Browser loss does not erase independent server accounting. Measurement-only changes are checked not to mutate latent outcomes.

**This code does not supply OS/process isolation for an untrusted agent.** Run the evaluator across an isolated transport with separate filesystem/process access. Giving an Operator this entire repository in the same execution environment would defeat an API-only restriction. Hosting, authentication, rate limits, transport retry semantics and sealed benchmark custody remain separate requirements.

## 22. Evidence-bound graduation, not seven labels

`difficulty-curriculum.ts` adds preregistered required/forbidden feature profiles for all seven levels. Level 1 requires evidence of deterministic behavior across exogenous states, not merely reuse of one seed. Later levels progressively require randomness, confounding, corruption, dynamics, multiple traps and their combination.

A curriculum case must link to actual verified qualification-artifact contents at the same revision, with a matching case ID, level, world hash, feature set and deterministic/stochastic claim. Within-level scoring requires comparable currency, economic scope, horizon and regret meaning. Trial scores are computed from complete oracle evidence, not caller-supplied regret numbers. Missing registered cases do not shrink the denominator; safety violations and a failed earlier level block graduation. Candidate-universe mismatches and changed policies are rejected.

The gate logic remains independently tested with manufactured receipts, but Phase 1 now also includes **seven executable qualified difficulty worlds** in `executable-difficulty-worlds.ts`. Levels 1–7 respectively prove deterministic response, stochastic response, confounding, measurement corruption, dynamics, multiple simultaneous traps and combined mechanism coverage. Each level produces executed qualification evidence with world/candidate/oracle hashes and is included in the integrated acceptance artifact. These public qualification worlds are not sealed benchmark holdouts and do not constitute measured Growth Operator graduation.

## 23. Artifact-backed acceptance

`validation-evidence.ts` requires the registered plan and actual executed artifact contents. It binds code revision, plan hash, case IDs, outcomes and measurements. Every registered case appears exactly once; failures, exceptions and missing executions remain visible. Altered hashes, stale revisions, self-rehashed missing rows, duplicate cases and reused artifacts are rejected.

Coverage counts distinct executed merchant/channel/segment values. Canonical adversarial coverage counts **mechanism families**, not seeds or renamed copies. Measurement-only fixtures and analytic controls cannot count toward the 20 canonical adversarial scenarios. Difficulty coverage requires explicitly qualified worlds rather than the existence of seven names. Evidence authorship and adequacy still require trusted CI/review; checksums alone cannot establish scientific validity.

The matrix is scoped acceptance evidence, not a universal correctness proof. The integrated plan now contains **96 preregistered executable cases**: 61 core cases, eight main-kernel domain cases, 20 distinct canonical adversarial mechanism families and seven difficulty worlds. Current CI requires **96/96 PASS**, zero NOT_RUN cases and **21/21 Phase 1 requirements PASS**; any other result fails the completion gate.

### Completion boundary and later hardening

The 20-scenario Phase 1 gate counts distinct **qualified canonical decision mechanism families**, never seeds, labels or measurement-only fixtures. The seven difficulty levels likewise require executable qualification evidence. The inherited Step 12 imagery minimum-effect assertion is preserved and the corrected website runtime is explicitly revisioned; the assertion is not weakened or skipped.

Items such as sealed benchmark custody, OS/process isolation for an untrusted Operator, external empirical calibration, a complete production BusinessAction adapter and broader native checkpoint/long-horizon economics remain later benchmark or product-hardening work. They must not be silently claimed by a Phase 1 pass.

Run `npm run test:phase1-validation`, `npm run architecture`, `npm run typecheck`, `npm test` and `npm run build`. The exact-head CI artifact is the acceptance record. A green focused subset never overrides a failed full-suite or 96-case acceptance gate.
