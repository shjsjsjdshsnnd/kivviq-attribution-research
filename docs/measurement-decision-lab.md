# Measurement and decision lab — first implementation slice

This is the initial implementation of the Steps 15–23 plan, not a completed Phase 1 simulator. The canonical plan is `docs/phase1-steps15-23-plan.md`. The work is stacked on Step 14 rather than merged into another research workstream.

## What is implemented

| Area | Current implementation | Not yet established |
| --- | --- | --- |
| Measurement corruption | Seeded measurement channel with the requested corruption modes, browser/server/platform source separation, time-of-arrival filtering and evaluator diagnostics | Calibration against empirical measurement distributions; a provider-faithful identity/consent implementation |
| Three truth levels | Explicit evaluator bundle containing latent simulation, perfect facts and corrupted observations; a strict observed-only JSON projection | An isolated untrusted-algorithm execution service |
| Interventions | `InteractiveReplayWorld.step(actionId)` and evaluator `reset(seed)`; preserved initial world/policies and complete action history | Actual-spend budget adapters, canonical BusinessAction translation, incremental checkpoints |
| Oracle | Complete finite-action search harness, common seeds, explicit costs, paired deltas and sampled regret | Full simulator action adapters, independently verified expected regret, global optimization |
| Reproducibility | Full input/ground-truth manifest and SHA-256 output verification; compiled control-scenario CLI and replay | A fully pinned dependency/runtime distribution and all scenario builders |
| Difficulty | Seven named levels and a fail-closed sequential graduation evaluator | Preregistered benchmark policies/holdouts and level-specific world generation |
| Acceptance | Twenty-one evidence gates that distinguish PASS, FAIL and NOT_MEASURED | A measured, passing Phase 1 acceptance report |
| Adversarial library | Detailed recipe backlog with distinct mechanisms and required predicates | Twenty verified executable traps; the CLI control does not count as one |

## The information boundary

```
Evaluator owns:
  frozen merchant + customer + channel + external inputs
       -> simulateWorld
       -> latent outcomes and causal mechanisms
       -> perfect observable facts
       -> measurement channel
       -> corrupted observation
                  |
                  | allowlisted JSON only
                  v
             Growth Operator
```

The Operator payload has only `schemaVersion`, `asOf`, `events`, `orders` and `platformReports`. Nested records are strict schemas. Hidden fields do not disappear silently at the wire boundary: unexpected fields fail validation.

Seeds, identity salts, raw customer/session/order identifiers, measurement crosswalks, unobserved event histories, causal strengths, oracle rankings, manifests and difficulty/scenario labels are not in that payload. Internal evaluator exceptions are converted to a generic public error without retaining their causes. Only public invalid-action and exhausted-horizon errors are preserved.

This is a data/API/import boundary. An untrusted algorithm must still run in a separate process/container with no access to evaluator modules, inputs, manifests, logs, filesystem, environment or network resources. A JavaScript object facade, HMAC identifier or TypeScript import restriction is not an operating-system sandbox. Do not run an untrusted agent inside the evaluator process and call that isolated.

## Measurement semantics

`measurePerfectWorld(perfectFacts, corruptionConfig, asOf)` is a pure, seeded measurement channel. Its input cannot contain latent intent, a causal graph, response coefficients or a `SimulationResult`. These fields belong elsewhere in the evaluator bundle.

Every corruption has an independent keyed random stream. Cookies persist within a sensor session; configured loss changes subsequent session identity, and configured cross-device fragmentation separates device scopes. Known account identifiers may reconnect sessions only when actually supplied and not excluded by the incomplete-identity setting. These are synthetic sensor semantics, not a browser-vendor emulation.

UTM loss does not reconstruct the hidden acquisition source. Independently available click/referrer evidence can still classify a visit; absent evidence becomes unknown unless the configured direct fallback applies. Actual direct navigation is distinct from an unknown source.

Browser consent/pixel failures remove browser records, not server commerce orders. Server-source loss is configured separately. Server-to-platform conversion delivery is also explicit. These settings model source availability; they do not claim to implement any real provider's consent or legal policy.

Duplicate deliveries share a semantic event ID and have separate receipt IDs. They do not create a second server order. Arrival delays are applied before as-of filtering, including duplicate receipts. Re-querying a later cutoff does not change already delivered receipt identities.

Meta and Google claim purchase value independently from eligible observed/native touches. Their reported revenue may overlap. Those claims neither create orders nor alter store revenue. No latent purchase propensity or causal lift is consulted to assign platform credit. This is a deliberately simplified attribution model, not a reproduction of either platform's complete attribution algorithm.

## Real simulator adapter and accounting scope

`runMeasuredWorld(request, options)` returns an evaluator-only bundle with all three layers. `operatorPayload(bundle)` serializes only the corrupted observation.

The initial adapter uses the simulator's **explicit agent population**. It does not multiply each delivered event/order by `populationWeight`, expose that hidden weight, or imply that unweighted observations equal represented-population totals. The evaluator bundle declares `measurementScope: explicit_simulated_agents` and the merchant currency. Cross-currency or represented-population transport requires an explicitly versioned extension.

Platform spend must be supplied as an explicit ledger. It is not inferred from reported conversions or order revenue. The existing legacy simulation's allocated marketing cost is a revenue-rate proxy; it is not sufficient evidence for evaluating budget interventions. That is why the initial interactive adapter rejects budget actions and the decision oracle has no automatic legacy-proxy adapter.

The ideal sensor adapter maps simulated observable routing sources to ideal UTMs/referrers. It does not invent click IDs as an escape hatch after UTM corruption. It currently assumes all explicit agents exist at the simulation start, consistent with the inherited initial-population runtime. Streaming customer creation requires additional integration.

### Legacy event identity compatibility

Integration tests found that some inherited repeat-purchase cycles reuse event IDs on different dates. For example, an owned-channel open or search may have the same legacy ID on two separate days.

The adapter retains every occurrence and derives a stable measurement identity from `(legacy event ID, occurredAt, event type, subject ID)`. It does not deduplicate those distinct records or use a whole-run array offset that could change after a later intervention. The raw simulator output remains unchanged in evaluator truth. An exact repeated occurrence key is still rejected instead of being disguised as a new fact.

## Interactive replay

The evaluator registers a finite catalog of supported simulator interventions and a no-op. The initial supported targets are price, promotion and inventory. The adapter does not replace the canonical BusinessAction ontology.

```
const operator = evaluatorWorld.observedHandle();
const before = operator.observe();
const after = operator.step("registered_action_id");

// Evaluator only, never on the Operator handle:
evaluatorWorld.reset(originalSimulationSeed);
```

Each step replays the frozen initial population and full action history. It does not create a new customer population each day. The simulator's complete commerce policies and external environment remain attached. The new intervention begins immediately after the previous inclusive observation cutoff. A guard verifies that the new replay has not changed previously delivered observations before committing the state transition.

Reset removes subsequent action history and resets simulation randomness. It leaves the merchant, population, measurement settings and external environment fixed. This supports paired comparisons under common randomness; it is a correctness-first full replay, not a fast checkpoint engine. The missing Step 13 clock/checkpoint work is not silently declared complete.

## Finite-action oracle

`evaluateFiniteActionSet` is evaluator-only. It requires an explicitly complete finite feasible action set, an action-set version, a baseline/no-op, a horizon, a currency, a metric scope and enough evaluation budget to cover every action on every declared seed. A failed replay aborts the ranking instead of quietly dropping a candidate.

The adapter callback must reset the same initial latent world for each action/seed and return reconciled net sales, COGS, payment fees, fulfillment, shipping, variable costs, total paid spend and implementation costs. Missing cost fields fail validation. Spend on non-converters and implementation costs cannot be omitted.

One seed yields a realized-seed optimum. Several seeds yield a sample estimate over the declared finite set, with paired deltas and standard errors. Neither is automatically a global optimum or independently verified expected value. `decisionRegret` marks expected-regret verification false until separate held-out verification is added. The analytic unit-test oracle is not proof that the complete merchant simulator has an optimal 37-action search.

## CLI and manifests

From this branch, with dependencies installed:

```sh
npm run build
npm run --silent simulate -- --scenario 9274 --seed 88213 > observed.json
```

`9274` is an alias of `measurement-control`: one pipeline integration control, **not** an adversarial scenario or an additional scenario count. Its world has explicitly zero paid budgets. Its measurement settings are synthetic examples rather than calibrated real-store parameters.

For evaluator replay, place the manifest outside the Operator input directory:

```sh
npm run --silent simulate -- --scenario measurement-control --seed 88213 \
  --manifest /private/evaluator/run-88213.json > observed.json
npm run --silent simulate -- --replay /private/evaluator/run-88213.json > replayed-observed.json
cmp observed.json replayed-observed.json
```

The private parent directory must already exist. The manifest is created with restrictive file permissions and exclusive creation; existing experiments are not overwritten. Standard output contains only corrupted observations, not the manifest. Direct invocation is also supported through `node dist/evaluation/simulate-cli.js`.

The manifest includes the exact code revision, model versions, runtime details, complete merchant/customer/channel inputs, causal graph and response curves through those inputs, external environment, corruption configuration, intervention history, ground truth and three output hashes. Replay rejects a different code revision, integrity mismatch or mismatched regenerated outputs. The digest is an integrity check, not an author signature.

The CLI refuses dirty implementation files before claiming a code revision. The current dependency ranges are not yet a fully locked distribution; runtime metadata plus output verification detects mismatches but does not replace dependency pinning. Independent cross-runtime reproducibility is therefore not claimed.

## Validation and unfinished work

Focused CI executes the measurement tests, simulator integration, manifest tamper/replay tests, step/reset tests, finite-oracle and acceptance/graduation tests, transitive import checks, build and compiled CLI round-trip. It checks that the CLI manifest is private and never appears in observed output.

Full inherited regression runs separately on the pull request. The parent is not fully green: run 36351667608 had 257 passing tests and one failing Step 12 imagery assertion (`tests/website_cro/model-contract.test.ts:128`, 0.027118619084284035 versus >0.05). That assertion is not weakened or skipped here.

Before Phase 1 can pass, still required are the isolated Operator runner, full actual-spend/canonical-action integration, verified adversarial scenario builders, independent oracle verification, the complete difficulty benchmark, broad multi-archetype distribution validation, dependency locking, inherited regression resolution and an evidence-backed acceptance report. None of those can be replaced by a capability flag or this document.
