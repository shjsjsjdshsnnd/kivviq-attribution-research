# Step 8 — Decision optimizer, first implementation pass

Version: `decision-optimizer/0.1.0`. **Draft; not frozen, deployed, or a claim that all 30 requirements are complete.**

Stacked on the exact Opportunity Engine head `8fde65db82a7e3f38c797c938f921e39f60cb90c` (PR #71). Main, existing branches, Action semantics, simulator economics, and oracle interfaces are unchanged.

## Boundary and use

`OpportunitySet + bound canonical Actions + merchant objectives/constraints -> canonical eligibility/compatibility -> bounded portfolios -> observable-evidence Digital Twin gateway -> incremental risk-adjusted comparison -> non-authorized decision plan`.

The optimizer cannot import simulator/evaluator ground truth. The Twin is an injected interface, not an implementation of Step 7, and no forecast in the tests is an empirical merchant prediction. A trusted integration must supply genuinely calibrated joint predictive scenarios, source-bound accounting, canonical resource/eligibility evidence, and exact calendar boundaries. Metadata checks cannot independently prove that an external model or source attestation is true.

Import the source barrel from `src/decision_optimizer/index.ts`; package-root/subpath publication is intentionally not changed in this initial draft.

- `optimizeDecision(input, twin, gate)` is the lower-level research core. Its explicit gate is mandatory.
- `optimizeOpportunities(set, input, bindings, compatibilityFor, twin)` consumes the actual existing Opportunity contract and reuses Action Space eligibility/portfolio validation. It preserves canonical Action objects/fingerprints when passing candidates to the Twin. Missing canonical bindings, resources or timing fail closed.
- `boundedParameterGrid` enumerates finite parameter/timing tuples. Domain factories must still produce valid, provenance-bound canonical Actions/Opportunities; grid tuples alone are not executable Actions.
- `objectiveFromIntent` accepts six documented exact intents. Combined merchant goals use explicit weighted/scaled terms and hard metric constraints; unsupported prose is rejected rather than guessed.

The adapter currently supports finite, single-occurrence, day-aligned atomic Actions. Persistent, instantaneous, recurring, event-dependent or sub-day timing is not approximated. Resource quantities, descriptive intervention parameters and domain-semantic bindings still require trusted provider/domain adapters. Execution uses the preserved canonical fingerprint, never the descriptive parameter map as an API payload.

## Economics and uncertainty

Money is explicitly in **major currency units** in one `context.currency`; Action parameters expressed in minor units remain unchanged and must be converted explicitly by the resource/prediction adapter. Every monetary input in a prediction uses the context's `moneyUnit: MAJOR` convention.

`netRevenue` means net merchandise plus net shipping revenue after discounts/refunds, excluding tax. Nonnegative cost totals must be separately supplied:

```
contributionProfit = netRevenue - costOfGoods - fulfillmentCost
                   - paidMediaCost - otherVariableCost - interventionCost
incrementalProfit = contributionProfit(candidate) - contributionProfit(baseline)
```

Costs must not overlap. No missing cost becomes zero. Net-negative cost/credit periods need a future explicit accounting extension rather than coercion. Attributed revenue and reported ROAS are retained only as diagnostic metrics. Ratios are recomputed from pooled totals, not averaged across customer/device segments; this does not establish causal explanations of Simpson reversals.

One Twin request carries one snapshot, as-of time, currency, exact merchant-local calendar and horizon. Scenario identities and probabilities pair each candidate with the same natural-evolution baseline. Whole portfolios require joint predictions; singleton uplift estimates are never added to invent interaction effects. Missing/unpaired predictions, unresolved eligibility or absent required economics withhold selection.

Utility is the weighted/scaled sum of incremental objective metrics. The score subtracts configured predictive standard-deviation, lower-tail-loss and reversibility penalties. Defaults are explicit research policy settings, **not learned or empirically calibrated risk preferences**. Lower-tail expected value uses fractional probability mass. Practical and paired predictive ties prefer reversibility, less downside/spread, lower commitments and simpler plans. Predictive overlap is not a p-value or a statistical equivalence proof.

Consumable resources remain spent/reserved after an action ends; renewable resources can be reused. Availability is checked day by day, so future inventory is not borrowed into today. Monetary resources must use the same currency. Predicted metric guardrails are separately enforced; integrations must bind accounting/cash/inventory limits to both declared resource requirements and relevant forecast constraints. Future predicted proceeds are not automatically made available to fund another intervention.

Opportunity cost comes from comparing competing whole portfolios under the same resource limits. `foregoneUtilityVersusBestEvaluated` is explanatory only, not a second cost deduction or oracle regret. Bounds limit both candidate count and portfolio size. Results explicitly say `BEST_EVALUATED_ONLY`; truncation never becomes a global-optimum claim.

## Requirement status

| Requirement | Status in this pass | Remaining boundary |
|---|---|---|
| 8.1 | Implemented core decision envelope | Persistent lifecycle association remains 8.28 |
| 8.2 | Partial: six exact intents and structured objectives | General natural-language intent parsing |
| 8.3 | Explicit multi-objective weights/scales and hard floors/caps | Merchant UX for trade-off approval |
| 8.4 | Consumable/renewable resources and forecast metric constraints | Full provider/domain constraint binding |
| 8.5 | Existing Opportunity + canonical Action adapter | Live source collection and all domain projections |
| 8.6 | Bounded parameter/timing grids | Domain factories/rebinding every generated variant |
| 8.7–8.8 | Bounded combinations, exclusions, temporal control conflicts, existing portfolio gate | All supported domain-specific compositions |
| 8.9 | Common-baseline joint Twin gateway | Actual calibrated Step 7 implementation/integration |
| 8.10–8.12 | Incremental utility, explicit accounting and portfolio opportunity cost | Empirical response validity |
| 8.13–8.15 | Predictive uncertainty/downside penalties and conservative ties | Calibration/coverage studies and merchant risk elicitation |
| 8.16–8.17 | Deterministic bounded enumeration and shared-resource allocation | Bayesian/adaptive search and broader scale |
| 8.18 | Partial: pre-bound finite day-aligned alternatives, DST-aware boundaries | Sub-day/event/recurrence/persistent timing and automatic rescheduling |
| 8.19 | Partial: prerequisites, lag checks and outcome-gated plan steps | Runtime dependency orchestration and conditional-policy simulation |
| 8.20 | Reversibility classification, risk penalty and tie preference | Verified provider-specific rollback |
| 8.21 | Partial: finite-belief EVSI/EVPI helper with cost | Horizon/resource-safe experiment ranking; no automatic EVSI score bonus |
| 8.22–8.24 | Best evaluated feasible choice, hold/incomplete states, metrics and rejected alternatives | Full merchant-facing explanation renderer |
| 8.25 | Partial: owner, timing, parameters, resources, prerequisites and approval gates | Execution authorization/dispatch and domain-semantic completion |
| 8.26 | Partial: objective direction, causal comparison and measurement horizon | Minimum meaningful effect, experiment power and decision-specific success thresholds |
| 8.27 | Partial: complete-day streak evaluation, causal marginal CAC, reversal safeguards | Live monitoring and automatic stop/rollback execution |
| 8.28 | **Not implemented** | Durable Decision Ledger, approvals, execution/results, idempotency and concurrency |
| 8.29 | Partial: aligned outcome-error records and explicit Learning sink | Durable ledger linkage and actual Twin/optimizer model updates |
| 8.30 | Core adversarial/property suite and source-boundary integration tests | Full simulator-world trials, empirical calibration and end-to-end acceptance |

## Execution and learning safeguards

Plans are always `NOT_AUTHORIZED`. Outcome-gated downstream steps cannot be automatically dispatched; runtime observation and reapproval are required. A selected conditional sequence is not proof that a prerequisite will work. All hard constraints and source freshness must be revalidated at execution. A provider-specific executor must stop/reassess on failed hard constraints; this library does not operate providers.

`assessStopRule` requires an explicit latest complete-day index and consecutive observations. Missing days do not count as a breach-free run. Marginal CAC needs independently estimated no-intervention acquisition outcomes, not yesterday's totals or attributed orders. Positive incremental spend with no incremental customers is an unbounded CAC breach. Automatic ROLLBACK rules are rejected unless full reversibility is declared.

`buildLearningFeedback` checks merchant, snapshot, currency, horizon and outcome maturity. Observational totals can produce forecast errors but not incremental treatment-effect updates. Causal feedback requires a separately supplied counterfactual and evidence; experiment-design validity remains the measurement adapter's responsibility. `submitLearningFeedback` sends an immutable record to an explicit sink, but does not pretend the model has retrained.

`estimateInformationValue` calculates finite-belief expected sample information value and its perfect-information upper bound, net of study cost. It is deliberately separate from immediate candidate utility until downstream horizons, resources, feasibility and double-counting are integrated.

## Verification

```
node scripts/test-decision-optimizer.mjs
npm exec -- vitest run tests/decision_optimizer/opportunity-adapter.test.ts --maxWorkers=1
npm exec -- depcruise --config .dependency-cruiser.optimizer.cjs src
npm run typecheck
npm test
npm run build
```

The isolated Node runner compiles the pure core with the repository's strictness flags and runs every `*.node-test.mjs` in this directory. The integrated adapter must additionally pass the real dependency graph in GitHub CI; isolated compilation is not a substitute.

Local core validation: **58 named tests pass**, including **1,000 fixed-seed allocation cases** inside one property test. Cases cover misleading ROAS/attribution, discount margin damage, pooled ratios, outliers, paired scenarios, missing costs, budget conflicts, stockouts/arrival timing, dependency cycles, source identity, currency-unit/horizon substitution, DST, incomplete predictions, conservative ties, complete-day stops and causal-vs-observational learning. Generated allocation cases are not 1,000 distinct causal scenarios.

Five integration tests use the real Opportunity generator and test source parsing, abstention and blocking. Positive domain-specific canonical execution binding remains an explicit further integration test requirement. The workflow runs strict repository typechecking, architecture, the core tests, all existing Vitest tests and the production build. Record actual CI results separately; a configured gate is not a passed gate.
