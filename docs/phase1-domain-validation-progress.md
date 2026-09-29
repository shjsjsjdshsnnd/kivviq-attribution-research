# Integrated domain validation and external-occurrence repair

Status: **draft research; no merge, deployment or Phase 1 freeze**. This continuation builds on public implementation `2f637e14ca6d9941b0dfef1efd9c6fb4ce768b7e`. All worlds are synthetic. Frozen causal coefficients, action ontology and previous baseline operators are unchanged.

## Recurrent external-effect IDs: an executed defect, not a tuning problem

The registered external-world seed 1141 originally failed with an external application ID being reused with a different resolution. A customer's repeat-need cycle can recur on another date while retaining its logical label. The old kernel called `applyAt` with that recurring label, although this API requires a globally unique application ID.

`ExternalRealityRuntime.applyOccurrenceAt` now identifies a kernel occurrence by both its logical label and event time, using `external-effect-occurrence/1.0.0`. The simulator, session and commerce paths use this method. The original `applyAt` remains strict and unchanged. Conflicting context or target at the same logical occurrence still fails; repeated identical calls remain idempotent. Random-stream keys, multipliers and causal coefficients are not altered.

The new tests cover recurring labels, collision rejection, replay/prefix stability, inactive applications and the actual kernel. The last test executes a previously working shock world through both the repaired and legacy application paths and compares its purchases, observable events, totals and effects after removing the deliberately changed diagnostic IDs. Seed 1141 now completes instead of crashing.

## Eight registered main-kernel comparisons

`domain-validation-suite.ts` registers control, treatment and exact treatment replay for each case. Every pair retains the same customer population, simulation seed and episode. It independently audits the result and verifies all three measurement layers reproduce. Failures remain in the evidence artifact.

These are **mechanism regression cases**, not new canonical adversarial decision scenarios or sealed holdouts. They use public fixed seeds:

| Domain | Seeds | Specific evidence |
| --- | --- | --- |
| Cross-channel interaction | 93060, 193060 | Ablate only the Meta-to-branded-search mediator; verify its application, one-day lag and downstream search change. |
| Price response | 210201, 1210201 | Apply lower prices prospectively after February 1 in one unchanged episode; verify structural response direction, executed order prices and unchanged perfect/corrupted history. |
| Retention and realized customer value | 211201, 1211201 | Compare declared repeat-hazard settings and reconcile customer/order value from one fixed episode, with earlier and future value kept separate. |
| External shocks | 141, 1141 | Apply a dated demand/propensity shock with unchanged merchant actions; verify actual effects, future timing, stable past and replay. |

For price and shock tests, January 1–May 1, 2026 is one fixed episode. The decision cutoff is February 1 at midnight UTC; changes start one millisecond later. Shorter evidence windows do not rescale the episode or expose future results to an Operator.

The declared external demand multiplier of 2 and purchase-propensity multiplier of 1.2 are checked as structural effects. They are **not** claims of exactly doubled realized sales or a recovered 20% revenue uplift. The price cases likewise verify response direction and actual price application without asserting that a 10% price cut must increase revenue on every seed.

### Retention qualification deliberately remains failed

Both retention cases execute a January 1, 2026–January 1, 2027 episode with 32 explicit customers and a maximum of 32 sessions per customer. This is a bounded simulation, not evidence of uncensored real-world annual CLV. Each result records the configured limit and the count of customers reaching it.

At the registered April 1 cutoff, seed 211201 has 11 earlier orders and three later orders. Seed **1211201 has eight earlier orders and zero later orders**. It therefore fails `future_value_is_nonvacuous_and_separate`. The seed, cutoff and predicate are retained. The current evidence does not establish that the session cap alone caused the empty tail; separating cap effects from the fixture's purchase dynamics remains further work.

A unit test verifies that this executed failure survives artifact serialization and prevents acceptance. Passing that unit test does **not** turn the scientific qualification into PASS. No failed seed has been replaced with an easier seed.

## Evaluator-only customer-value ledger

`customer-value-ledger.ts` calculates customer value from the existing full simulation result. It validates provenance, customer and order identities, event times, integer monetary arithmetic and reconciliation. It never resimulates a shorter horizon.

The output explicitly separates `realizedAtAsOf` from `futureRealizedTruthNotForecast`. The second object is evaluator-only realized future truth, not a prediction and not Operator input. A mutation test changes a future order's self-consistent economics and verifies the earlier ledger stays unchanged.

The metric is **unweighted explicit-customer legacy booked order contribution before advertising**, computed from merchandise revenue less COGS, fees, fulfillment and shipping subsidy. Returns, overhead, extra promotional/variable costs and forecast value are excluded. This is not all-spend store contribution, causal customer acquisition value, or expected CLV. The new domain cases do not enable or claim inventory execution; the separate existing inventory matrix remains authoritative for its own tested scope.

## Integrated acceptance, without hiding failures

`phase1-integrated-validation.ts` preserves every one of the previous 61 registered cases and adds these eight, producing a **69-case plan**. The validation CLI now executes this combined plan rather than the earlier core-only matrix. The earlier builder remains available for its original scoped regression tests.

The CI acceptance assertion is not weakened: every registered case must pass before that check is green. The newly measured retention failure is expected to make the scientific validation gate red. A CLI exit code of 2 means incomplete or failed Phase 1, not successful acceptance. Read the artifact's individual results and recomputed overall status rather than inferring success from the exit code alone.

```sh
npm ci
npm run typecheck
npm run architecture
npm test
npm run build
npm run validate:phase1 -- --out /secure/evaluator-validation.json --run-id public-domain-regression
```

The output path must not already exist. Build/runtime/source verification and evaluator file mode 0600 remain enforced. Run identifiers, environment identity and source revision belong to the artifact. Full evaluator inputs, output hashes, comparisons and failed predicates must never be handed to an untrusted Operator.

This continuation does not count these eight checks toward the required 20 qualified canonical scenarios. It does not supply the seven qualified difficulty-world generators, sealed holdouts, native checkpoints, complete canonical action translation, compatible long-horizon inventory/returns economics, external empirical calibration or OS-level Operator isolation. The inherited imagery magnitude assertion and earlier unqualified scenarios remain unresolved. Completed local and exact-head CI results are recorded on PR #59; they must not be inferred from the existence of this document.
