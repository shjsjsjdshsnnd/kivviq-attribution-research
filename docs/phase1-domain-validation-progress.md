# Integrated domain validation and external-occurrence repair

Status: **integrated Phase 1 accepted for the current PR merge candidate**. GitHub Actions run `36789127433` produced `96/96 PASS`, all 21 Phase 1 requirements PASS, and acceptance artifact SHA-256 `0d8994d631bf1b42b13978bdada7025552b2d53b6d8c09e8263868657e5e2603`. The tested merge commit is `53b1cfd581b0891529950d7ba5f39e1d8f319d0e`, corresponding to head `d981589ff85bc8d2204d3bae5887fea7f88da815` on base `5155f4a36f74ebb9e2c6ec65095dee35c582ca24`. This continuation builds on public implementation `2f637e14ca6d9941b0dfef1efd9c6fb4ce768b7e`. All worlds are synthetic. Frozen action ontology and previous baseline operators are unchanged; the separately revisioned Step 12 website runtime repair is documented in the repository regression history.

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

### Retention qualification now requires uncensored convergence

The original 32-session annual retention fixture was correctly rejected because the computational ceiling censored almost every customer trajectory. The registered seeds and annual episode were retained; the fix was **not** to substitute easier seeds or raise the cap until a preferred result appeared.

The current qualification uses a primary ceiling of **4,096 sessions per customer** and an independent convergence replay at **8,192**. A retention case passes only when both control and treatment have zero customers reaching the primary ceiling, the higher-cap treatment also remains non-binding, and the complete purchase/event/final-customer trajectory is identical across the two caps. The earlier/future customer-value split must also be non-vacuous and reconcile to the single fixed annual episode.

This converts the former censoring diagnostic into an explicit longitudinal-validity gate. The result is still realized synthetic 365-day customer value, **not** empirically calibrated expected lifetime value or causal CLV.

## Evaluator-only customer-value ledger

`customer-value-ledger.ts` calculates customer value from the existing full simulation result. It validates provenance, customer and order identities, event times, integer monetary arithmetic and reconciliation. It never resimulates a shorter horizon.

The output explicitly separates `realizedAtAsOf` from `futureRealizedTruthNotForecast`. The second object is evaluator-only realized future truth, not a prediction and not Operator input. A mutation test changes a future order's self-consistent economics and verifies the earlier ledger stays unchanged.

The metric is **unweighted explicit-customer legacy booked order contribution before advertising**, computed from merchandise revenue less COGS, fees, fulfillment and shipping subsidy. Returns, overhead, extra promotional/variable costs and forecast value are excluded. This is not all-spend store contribution, causal customer acquisition value, or expected CLV. The new domain cases do not enable or claim inventory execution; the separate existing inventory matrix remains authoritative for its own tested scope.

## Integrated acceptance, without hiding failures

`phase1-integrated-validation.ts` now combines the original **61** core cases, **eight** main-kernel domain cases, **20** canonical adversarial decision families and **seven** executable difficulty worlds for a **96-case plan**. The validation CLI executes this complete plan; the earlier 61-case builder remains available only for its scoped regression contract.

The CI acceptance assertion is stricter than before: `validate:phase1` must exit successfully, all **96/96** registered cases must be PASS, no case may be NOT_RUN, and all **21/21** frozen Phase 1 requirements must be PASS. There is no longer an allowed adversarial/difficulty coverage exception.

```sh
npm ci
npm run typecheck
npm run architecture
npm test
npm run build
npm run validate:phase1 -- --out /secure/evaluator-validation.json --run-id public-domain-regression
```

The output path must not already exist. Build/runtime/source verification and evaluator file mode 0600 remain enforced. Run identifiers, environment identity and source revision belong to the artifact. Full evaluator inputs, output hashes, comparisons and failed predicates must never be handed to an untrusted Operator.

These eight domain checks remain mechanism regressions and do not themselves count toward the 20-scenario requirement. The separate canonical adversarial suite supplies 20 distinct qualified decision mechanism families, and the executable difficulty suite supplies Levels 1–7. Sealed holdouts, external empirical calibration, OS/process isolation and broader production action/checkpoint integration remain later hardening work and are not implied by Phase 1 acceptance. The inherited imagery assertion is preserved and addressed through the explicitly revisioned website runtime repair. Exact-head CI remains the acceptance record.
