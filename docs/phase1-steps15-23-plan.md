# Phase 1 completion programme — Steps 15–23

Status: implementation in progress; this document is a plan, not an acceptance certificate.

## Pinned starting point

- Repository: `shjsjsjdshsnnd/kivviq-attribution-research` (public, synthetic only).
- Parent branch: `step14/external-reality`, PR #57.
- Parent commit: `5155f4a36f74ebb9e2c6ec65095dee35c582ca24`.
- Parent full-suite result: 257 passed, 1 failed, run 36351667608. The failing assertion is `tests/website_cro/model-contract.test.ts:128` (imagery improvement 0.027118619084284035 versus required >0.05). Do not silently weaken it, delete it, or report the parent as fully validated.
- The simulator Step 13 daily/checkpoint contract is absent on this parent. The Action Space timing/compound-action branches are a separate workstream, not a substitute.

## Governing boundary

`latent truth -> perfect observable facts -> measurement system -> corrupted observation -> Growth Operator`

The evaluator owns latent customers, causal mechanisms, counterfactuals, oracle rankings, measurement parameters, identity crosswalks and reproducibility manifests. A perfect-observation feed is also evaluator-only. The Operator receives only a strictly validated corrupted-observation payload plus genuinely available merchant controls. No seed, scenario name, difficulty label, true customer ID, corruption reason, true coverage denominator, latent effect or oracle score is supplied to the Operator.

Use fresh allowlisted objects, not object spreading from simulation results. Validate at the wire boundary. Imports into Operator-facing modules may not traverse simulation, measurement, oracle or manifest internals. Untrusted algorithms must run in a separate process/container with only observed JSON and an action interface; a TypeScript private field or a package subpath is not a security sandbox.

## Build order and acceptance evidence

### A. Steps 15 and 21 — Measurement and three truth levels

Implement a versioned, seeded measurement channel with independent deterministic streams. Model missing UTMs, cookie loss, consent exclusions, duplicates, blocked browser pixels, cross-device fragmentation, delayed arrival, Meta/Google independent claims, direct/unknown classification, missing customer identifiers, and misclassification.

Preserve source boundaries: blocking a browser pixel must not erase a server order by default. Consent excludes identity-bearing analytics; server order accounting remains governed by an explicitly separate source policy. A report claiming a purchase is never a store order. Preserve non-purchasing journeys. Do not use hidden purchase intent or causal lift to make attribution claims.

Required tests: each corruption at 0 and 1, chronology, strict input/output schemas, source-specific outages, repeatable identity transitions, duplicate/delay stability under incremental reads, unknown versus direct, no mutation of perfect truth, no future arrivals, no latent leakage, and independent overlapping platform claims.

### B. Steps 16 and 22 — Scenarios and difficulty

Create stable scenario IDs and executable builders for at least 20 distinct traps. Reuse public Attribution research concepts and the existing simulator's advertising, inventory, promotion, retention and website trap fixtures. Do not relabel 20 random seeds as 20 different adversarial scenarios.

Every scenario must specify: mechanism, misleading observed signal, tempting wrong decision, evaluator-only success predicate, observation window, decision horizon, valid actions and a holdout policy. A label or README example is not proof a trap exists. Register proposed recipes separately from verified scenarios.

Required core traps: retargeting selection; branded Google demand capture; discount revenue/profit reversal; four-day stock cover; Simpson's paradox with every defined segment improving; seasonal common cause of Pinterest and sales; short-term Meta-cut gain followed by long-horizon loss.

Difficulty levels: 1 deterministic; 2 stochastic; 3 confounded; 4 corrupted; 5 dynamic; 6 adversarial; 7 realistic chaos. Level 1 is not merely a fixed seed for a stochastic world. Graduation requires preregistered per-level holdout success/regret thresholds, sufficient cases, and zero safety violations. Missing results block graduation.

### C. Step 17 — Stateful interventions

Provide `world.step(action)` and evaluator `world.reset(seed)`. Keep the canonical Action ontology unchanged: the initial adapter uses existing simulator `Intervention` objects, and later binds canonical BusinessAction translation once branch convergence is validated.

For an initial correctness-first implementation, replay the same frozen initial world and complete action history with keyed common randomness; reveal only observations available at the current clock. Never restart each day with a newly generated population. Reject retroactive actions. Preserve all commerce policies, inventory, external events, customers, pending deliveries and measurement configuration across comparisons. Reset removes action and measurement history. Checkpoint acceleration is a later implementation, not a claim made by replay.

### D. Step 18 — Evaluator-only decision oracle

Enumerate a finite, explicit eligible action set for tractable worlds, including no-op. Reuse exactly the same initial state, horizon and Monte Carlo seeds for every candidate. Deduct all candidate-specific costs exactly once, including spend on non-converters. Rank true contribution outcomes, not platform revenue, and retain the full candidate table only for the evaluator.

Report the search domain, action count, evaluation count, horizon, seed count, uncertainty and method. A grid optimum is optimal only over that grid. One seed gives a realized counterfactual, not an expectation. Use independent verification seeds to detect winner selection bias. Regret = best feasible value minus chosen value; distinguish sampled regret from exact deterministic regret. Fail closed on a missing candidate or failed replay rather than silently shrinking the universe.

### E. Step 19 — Reproducibility

Store simulator/model/schema versions, code revision, scenario ID/version, merchant/customer/channel inputs, causal graph/response curves, external shocks, measurement configuration, interventions, all seeds, evaluation horizon and hashes of truth/perfect/observed outputs. No wall-clock timestamps in deterministic payloads. Explicitly capture numerical/runtime assumptions and lock dependencies.

Provide a CLI with scenario and seed arguments. Default export is corrupted observations only. Evaluator manifests require a separate explicit output option and must never be placed in an Operator input directory. Verify replay hashes, not just copied seed labels. Reject tampered manifests.

### F. Steps 20 and 23 — Validation and acceptance

Run accounting, stock, timing, identity and causal tests on simulator outcomes. Use tolerances only for declared floating-point/Monte Carlo quantities, not to hide accounting mismatches. Reconcile unweighted agent ledgers and represented-population totals on their respective scopes. No division by a silently assumed population weight.

Add multiple-seed distribution checks across at least 10 archetypes, 7 channels and 6 segments. Plausibility is not calibration to one real merchant and is not empirical validation merely because generated numbers look realistic.

Acceptance report must have PASS / FAIL / NOT_MEASURED per requirement, plus evidence references and measured denominators. Overall PASS requires every requirement measured and passing. Do not replace missing evidence with a capability flag, file count or statement that a feature exists.

## Phase 1 acceptance matrix

| Requirement | Target | Required evidence |
| --- | --- | --- |
| Reproducibility | 100% of evaluated replays | identical output hashes |
| Accounting reconciliation | 100% of evaluated worlds | order/product/store waterfalls |
| Causal truth retained | 100% | complete evaluator manifests |
| Future leakage | 0 | prefix invariance and arrival filtering |
| Impossible inventory states | 0 | stock and reservation conservation |
| Merchant archetypes | >=10 | executed coverage, not enum count |
| Core channels | >=7 | executed coverage |
| Customer segments | >=6 | executed coverage |
| Product economics | yes | line-to-store reconciliation |
| Diminishing returns | yes | response-curve tests |
| Cross-channel interactions | yes | joint/non-additive replay |
| Price elasticity | yes | controlled price contrasts |
| Retention/CLV | yes | longitudinal observed/future split |
| Inventory effects | yes | constrained intervention replay |
| External shocks | yes | action/exogenous separation |
| Measurement corruption | yes | all configured modes exercised |
| Counterfactual interventions | yes | identical-start action replay |
| Decision oracle | yes | complete eligible set and verified regret |
| Adversarial scenarios | >=20 | distinct executable passing trap predicates |
| Difficulty ladder | yes | measured, fail-closed graduation |
| Automated validation | yes | exact-head results including inherited tests |

## Attribution reuse

Reference public research at `phase1/research-foundation`, commit `1d92f4d2d5fd89de261127b8ed4bdcced6f18fdf`: `src/attribution_lab/simulation/generator.py` separates latent selection/causal outcomes from touches and distinguishes click-ID/UTM/referrer/direct/unknown acquisition evidence. Preserve those distinctions. The TypeScript simulator's Step 5 reporting also distinguishes independent platform claims from realized purchases. This is conceptual interoperability; no private production code or merchant data is copied.

## Delivery discipline

Use additive modules and a stacked draft PR. Keep the parent and other frozen research branches unchanged. Record each implemented/tested slice separately. Steps 15–23 and Phase 1 remain unfinished until the full acceptance matrix has real passing evidence, including resolution of the inherited website test and Step 13 dependency.
