# Phase 1 continuation: executable measurement cases and a bounded action oracle

Status: active research, not frozen. This extends the plan in `phase1-steps15-23-plan.md`.

## What is executable

`measurement-scenario-library/0.1.0` adds nine simulator-backed measurement cases:

| ID | Measurement mechanism | Public seed-set qualification |
| --- | --- | --- |
| adv-008 | Missing UTMs with Direct fallback | Mechanism verified |
| adv-009 | Cross-device fragmentation | Mechanism verified |
| adv-010 | Cookie fragmentation | Mechanism verified |
| adv-012 | Blocked browser pixels, intact server accounting | Mechanism verified |
| adv-013 | Duplicate purchase receipts, unchanged orders | Mechanism verified |
| adv-014 | Report lag and subsequent backfill | Mechanism verified |
| adv-015 | Independent Meta/Google overlapping claims | **Unqualified** |
| adv-016 | Incorrect channel classification | Mechanism verified |
| identity-001 | Incomplete account identity | Mechanism verified |

Every case runs the existing simulator, then compares corrupted observations against a clean measurement of the same perfect facts. No KPI rows are invented to manufacture the apparent pattern. Verifiers require nonempty commerce, server-order reconciliation, the case-specific distortion and an allowlisted Operator payload. The eight verified mechanisms have passed both development seeds (1410, 1411) and both validation seeds (2410, 2411).

**These are measurement-mechanism qualifications, not Phase 1 decision-scenario acceptance.** The worlds deliberately use a known zero-incrementality control. They do not yet demonstrate the positive causal effects, complete action sets, long-horizon losses or multiple merchant contexts required by all 24 backlog recipes. `phase1AcceptedScenarioIds` remains empty.

### The failed candidate is retained

`adv-015` exhibits the requested overlap on both development seeds, but not on validation seeds 2410 and 2411. In those validation worlds, total platform claims equal store revenue rather than exceeding it. The strict `summedClaims > storeRevenue` predicate remains unchanged. Both failed cases remain in the report, and the admission function marks the family `UNQUALIFIED`.

Tests intentionally verify this rejection. A green software test suite must not be interpreted as nine successful scenario qualifications. Adding a second seed is not a new scenario. The seeds are public development/validation fixtures, **not sealed benchmark holdouts**.

## Explicit expenditure and bounded economics

`scenario-period-spend/1.0.0` declares a synthetic fully-spent period allocation and derives an exact-cent daily debit ledger, including fractional final days. Expenditure is independent of purchases and is still charged when nobody buys. Meta and Google feed their own measured platform spend; other paid channels remain in total business expenditure.

The action adapter uses the existing simulator's period-allocation convention, not a daily-budget reinterpretation. It rejects competing spend authorities, mismatched periods and inactive-channel allocations.

`scenarioBookedEconomics` reuses the product-level Step 7 accounting engine and reconciles unweighted explicit-agent orders, COGS, payment fees, merchant shipping, fulfillment, variable costs, total paid expenditure and explicit action cost. Its declared scope is **booked product contribution with no returns, CLV or overhead**. Unsupported later-step economics fail explicitly rather than silently disappearing from the objective. This is not the complete long-horizon economics adapter.

## Simulator-backed finite oracle

Six registered feasible period allocations are evaluated against identical frozen latent inputs and common seeds: baseline, Meta +$1,000, Google Search +$1,000, Meta off, Google off and all paid off. This is the complete set for this small fixture, not the complete canonical BusinessAction universe.

In the known null-effect control, Meta +$1,000 and Google Search +$1,000 each have exactly -$1,000 marginal booked contribution on the two validation seeds. Purchases do not change; expenditure does. Relative to all paid off, choosing either increased-budget action has $2,250 realized finite-set regret. These values characterize the synthetic control, not a merchant recommendation or evidence that advertising is generally ineffective.

The finite oracle contract is now `finite-decision-oracle/1.1.0`. A candidate-set hash binds action payloads as well as IDs. `validateFiniteDecision` freezes the chosen action before evaluating disjoint seeds, rejects altered candidates and insufficient evaluation budgets, and returns paired uncertainty. It does not silently choose a new policy using validation results. Its reference maximum is explicitly in-sample for the validation set; expected global optimality is not certified.

## CLI and information boundary

After building:

```sh
npm run --silent simulate -- --scenario adv-013 --seed 1410
```

The nine registered IDs are accepted. `9274` remains the original measurement-control alias. Default stdout is corrupted observations only. Private manifests, perfect facts, scenario verifiers, seed assignments, causal controls and oracle results belong to the evaluator. Existing strict serialization, sanitized errors and transitive dependency guards remain in force.

This is still not an OS-level sandbox. Untrusted algorithms must not run in a process that can read the evaluator modules, manifests, environment or filesystem.

## Verification and remaining gates

Focused validation includes the existing measurement suite and new `tests/scenario_library` tests. CI runs both, plus architecture checks, TypeScript, build and compiled CLI replay. The full inherited test suite remains a separate blocking job, with no skipped or weakened imagery assertion.

The inherited Step 12 imagery test reproduces an uplift of 0.027118619084284035 against a >0.05 assertion. It is unchanged in this continuation. A passing focused job is not a passing full repository suite.

Remaining work includes the full adversarial decision cases (at least 20 accepted), positive-effect and long-term causal controls, adaptive budget actions in `world.step`, canonical BusinessAction/checkpoint integration, return/retention/inventory-aware oracle economics, sealed evaluation, isolated Operator execution, dependency/runtime locking and the complete Phase 1 acceptance run. Nothing in this document is a release certificate.
