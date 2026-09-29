# Steps 15–17 continuation: observed protocol, paired trajectories, fixed-horizon checks

Status: **active draft research; no merge, deployment or freeze**. This extends PR #59's existing measurement and budget-replay work. It does not replace the frozen simulator, action ontology or previous baseline operators. All inputs are public synthetic fixtures, not merchant records or production APIs.

## Step 15: explicit observation-only wire boundary

The existing path remains evaluator latent truth → perfect observable facts → corrupted observation. The existing corruption layer covers missing UTMs, cookie loss, consent exclusion, duplicates, blocked pixels, cross-device identity fragmentation, delayed arrivals, Meta/Google overlapping claims, direct/unknown traffic, incomplete customer identity and wrong channel classification.

New modules:

- `src/observation/world-protocol.ts`: strict Operator-safe request/response schemas, available through the `./observed-world-protocol` package export.
- `src/evaluation/observed-world-endpoint.ts`: evaluator-side `createObservedWorldEndpoint(world.observedHandle())`, accepting and returning JSON strings only.

The only accepted requests are:

```json
{"version":"observed-world-protocol/1.0.0","operation":"observe"}
```

```json
{"version":"observed-world-protocol/1.0.0","operation":"step","actionId":"a1"}
```

Success contains only `version`, `ok` and the recursively allowlisted, temporally validated `observation`. Errors contain only `version`, `ok` and one of `INVALID_REQUEST`, `UNKNOWN_ACTION`, `HORIZON_EXHAUSTED`, `OPERATION_FAILED`. Unknown fields/operations are rejected, not stripped. Request strings are limited to 4,096 JavaScript characters; action IDs to 256 characters.

There is deliberately no reset, seed, truth, oracle, checkpoint, diagnostics, raw intervention or evaluator-snapshot operation. Exception messages, stacks and causes are not serialized. Actual-world integration tests verify rejected calls leave its observation unchanged and that evaluator reset reproduces the initial response.

**This is not an OS sandbox or a production network service.** The evaluator must own the world and bind the endpoint to an isolated transport. An untrusted Operator must not share evaluator files, imports, process memory, logs, environment, manifests or credentials. Hosting, authentication, rate limits, serialized request processing, retry/idempotency handling and isolated execution remain integration work. Do not pass the evaluator class or its constructor inputs to an Operator. The architecture test checks transitive dependencies from every Operator-safe source entry point.

## Step 17: paired action sequences through actual step/reset

`src/evaluation/trajectory-comparison.ts` adds `compareInterventionTrajectories(input)`:

1. Validate registered actions, a true zero-cost no-op baseline, equally long trajectories, distinct seeds and a simulation budget covering every execution.
2. Reset the existing `InteractiveReplayWorld` to the same seed before each alternative.
3. Replay identical no-op warmup steps and verify identical initial latent-world hashes, every warmup observation and predecision booked economics.
4. Execute the registered action sequence through `world.step(actionId)`; retain earlier budget changes and non-budget interventions.
5. Reconcile only consequences after the decision cutoff. Abort the entire comparison if any branch fails or rewrites the observed/economic past.

For example, the evaluator can register `a1` as Meta +100,000 minor units, `a2` as Google +100,000 and `a0` as no-op, then compare:

```ts
trajectories: [
  { trajectoryId: "t0", actionIds: ["a0", "a0"] },
  { trajectoryId: "t1", actionIds: ["a1", "a0"] },
  { trajectoryId: "t2", actionIds: ["a2", "a0"] },
]
```

The complete comparison, seed labels, truth hashes, economic ledgers and paired deltas are evaluator-only. The Operator receives only the response to its own observed-world calls, never alternative-branch results or oracle rankings. Single-seed outcomes are labeled realized counterfactuals; multiple seeds estimate a sample mean conditional on the fixed merchant/customer/measurement inputs, not a global expected optimum.

The execution count is checked exactly:

```text
1 constructor + seeds × trajectories × (1 reset + warmup steps + trajectory steps)
```

Input action/trajectory/seed ordering does not alter the comparison. Caller inputs are cloned. Tests include reversing all three orders, accumulating then disabling a budget, baseline replay after prior alternatives, invalid negative-budget decisions and an insufficient simulation budget.

### Money and timing are not interchangeable

A budget amount is a rate per `spendPlan.referencePeriodMs`, not an immediate cash debit. The existing adapter integrates fully spent synthetic allocations independently of orders, carries fractional minor units across daily buckets and reports completed buckets only. Decisions become effective one millisecond after the inclusive observation cutoff.

In the daily-rate unit fixture, +100,000 minor units over two future days creates 199,999 additional minor units of booked spend because of that one-millisecond boundary and cumulative flooring. Separately declared implementation cost is charged once for each executed action. This is not a claim about actual ad-platform auction delivery.

Economic scope remains **explicit unweighted agents; booked contribution; actual scheduled paid expenditure; no returns, CLV or overhead**. Unsupported inventory-lifecycle, retention and later-step economic policies still fail closed. This is full-history replay, **not native checkpoints** and not the complete canonical BusinessAction adapter.

## Step 16: verify mechanisms instead of trusting fixture names

`scheduled-decision-oracle/0.2.0` adds evaluator-only `evaluationCutoffs`. Each shorter horizon is read from the **same full simulation episode**. The world is not shortened and the budget response coefficient is not rescaled for each report. Cutoffs must be strictly increasing closed days after the decision and within the original episode.

Each checkpoint contains future booked economics, future order count, first-purchase-order count and actual simulated branded-search-event count. First-purchase orders are a simulator diagnostic, not a separately established distinct-new-customer accounting metric. Checkpoints do not enter the Operator payload and require no extra simulator execution.

### New prospective upper-funnel cut candidate

`src/evaluation/prospecting-cut-decision-scenario.ts` reuses the existing Step 6 mediated/lagged-awareness fixture without changing its frozen coefficients. It registers:

- One January 1–May 1, 2026 episode, with a January 31 decision after 30 warmup days.
- Two actions: no-op and a 50% Meta allocation cut.
- Seven- and ninety-future-day checkpoints, February 7 and May 1.
- Development seeds 93120/93121 and separate public validation seeds 193120/193121, fixed before the first evaluation. They are **not sealed holdouts**.

Eight predicates require identical predecision observations, non-vacuous commerce, short-term contribution improvement, long-term contribution loss, lower long-term sales, fewer branded searches, fewer first-purchase orders, and actual paid-spend savings. All must pass; missing/unpaired branches or changed registered cutoffs are rejected.

**The candidate is unqualified.** Both development seeds show a short-term gain of 583 minor units and a ninety-day gain of 7,500, not a long-term loss. Sales and first-purchase-order counts are unchanged; branded searches fall by 60 and 77. A fall in branded searches alone does not establish the requested sales/profit collapse. No failed seed or predicate has been removed, and no coefficients or accounting have been tuned to force a pass. Validation results are retained separately when executed.

The qualification unit tests contain deliberately manufactured inputs to test the verifier's logic. They are explicitly **not** simulator scenario evidence and do not add accepted scenarios.

### Status of the seven requested decision scenarios

| Requested case | Integrated decision-evaluation status |
| --- | --- |
| Retargeting trap | Existing PR #59 prospective case passed its registered development/public-validation checks in a disclosed finite budget subspace; not full Phase 1 acceptance. |
| Google branded-ROAS trap | Pending integrated prospective qualification; the requested 11× is not an established result here. |
| Discount trap | Pending compatible economics and prospective qualification; +31% revenue/−8% contribution are not measured results here. |
| Four-day inventory trap | Pending inventory-aware action/economic integration and qualification. |
| Simpson's paradox | Pending full segment/mix reconciliation and integrated decision qualification. |
| Pinterest/seasonality false correlation | Pending external-reality-compatible economics and mechanism-isolating paired qualification. |
| Upper-funnel long-term trap | New executable prospective candidate; **FAIL / unqualified**, not the requested validated long-term collapse. |

The nine earlier measurement-only cases are still distinct from canonical decision scenarios. Existing `adv-015` remains unqualified on its registered validation seeds. This continuation neither repairs nor removes those failures and does not inflate the target count of 20 accepted canonical scenarios.

## Verification and remaining gates

New test files cover the strict endpoint, actual world integration, exact-reset trajectories, fixed-episode multi-horizon accounting and fail-closed scenario qualification. The first completed targeted runs passed **36/36 new tests**. TypeScript, build and architecture checks passed (119 modules / 561 dependencies). Full focused and repository regression results must be recorded from completed runs, not inferred from these targeted results.

The inherited Step 12 imagery assertion (`tests/website_cro/model-contract.test.ts:128`) has not been changed or skipped. Its previously reported mismatch is not evidence that this branch is release-ready.

Still required: qualify the remaining traps, repair the prospective long-term mechanism with documented evidence, integrate the canonical action universe and native checkpoints, support inventory/returns/retention-aware economics, run sealed holdouts and broader distributions, isolate untrusted Operators, resolve inherited regression gates, and complete the full Phase 1 acceptance evidence. **Do not merge, deploy or freeze this draft as a finished Growth Operator simulator.**
