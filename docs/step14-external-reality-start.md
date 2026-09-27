# Step 14 — External reality

Status: implementation-complete against the existing simulator clock; not frozen because the intended Step 13 daily clock/checkpoint contract is not published in this repository.

## Objective

External reality exists so Growth Operator cannot assume:

> Every observed change was caused by something the merchant did.

Step 14 therefore gives the synthetic business a separate exogenous causal environment with hidden truth, realistic observable signals and deterministic effects.

The Step 14 sidecar is opt-in. When `externalRealityEnvironment` is absent, the frozen Step 1–12 simulator path remains inert and produces no Step 14 fields.

## Canonical event universe

The model includes all requested external forces:

- competitor launch
- competitor sale
- economic slowdown
- viral TikTok
- weather event
- holiday timing
- supplier problem
- shipping disruption
- CAC inflation
- platform algorithm change
- consumer trend

Each event has a canonical domain and a constrained set of allowed targets. Invalid domain/kind or kind/target pairings fail validation.

## Effect semantics

External effects use log multipliers:

- `Math.log(0.8)` = 20% reduction
- `Math.log(1.25)` = 25% increase

Simultaneous effects add in log space, which makes the realized multipliers compose multiplicatively and independently of iteration order.

Effects support:

- market scope
- category scope
- channel scope
- product scope
- device scope
- delayed onset
- ramp
- decay
- temporary or structural duration

The environment is versioned and seeded. Counter-based domain streams make stochastic draws reproducible and independent of call order.

## Executed targets

Every allowed Step 14 target has an explicit execution surface:

| Target | Execution surface |
| --- | --- |
| demand | need formation |
| purchase propensity | checkout |
| price sensitivity | product choice and checkout |
| consideration time | session timing |
| organic traffic | natural visit opportunity |
| store traffic | natural visit opportunity |
| CPM | paid delivery |
| CPC | paid delivery |
| CTR | paid delivery |
| traffic quality | paid delivery |
| reported attribution | platform-style reporting |
| supplier lead time | replenishment timing |
| inventory availability | product choice and purchase gate |
| landed cost | COGS |
| delivery time | PDP delivery estimate and checkout |
| shipping cost | checkout charge and merchant shipping subsidy |
| return propensity | realized return response |
| category preference | product choice |

This is enforced by `EXTERNAL_TARGET_EXECUTION_SURFACES` and covered by Step 14 tests.

## Causal separation

External causes are applied upstream of outcomes rather than by perturbing final KPIs.

Examples:

- a macro slowdown changes demand and price sensitivity before sessions and purchases exist;
- CAC inflation changes fixed-budget paid delivery rather than rewriting ROAS after the fact;
- a supplier problem changes available inventory, replenishment time and landed cost;
- a shipping disruption changes checkout shipping charge, merchant shipping subsidy, delivery time and return propensity;
- a platform algorithm change can alter reported attribution without changing the true purchase;
- a consumer trend changes category preference during product selection.

Merchant interventions remain separately recorded in `provenance.interventions`.

The confounded Step 14 fixture intentionally runs a merchant price intervention at the same time as macro, logistics, supplier, consumer-trend and platform changes. The evaluator can therefore verify that merchant actions and exogenous causes remain distinct.

## Realized application ledger

Declared environment truth is not enough to prove an external effect actually influenced a simulation.

`ExternalRealityRuntime.applyAt(...)` records a hidden application only when a matching external contribution is active for that target, timestamp and scope.

God mode contains:

- declared events;
- realized application IDs;
- target;
- timestamp;
- scoped context;
- resolved multiplier;
- contributing external events.

Declared but unused events do not appear in the realized application ledger.

## Observation and evidence boundary

External truth is hidden under `result.godMode.externalReality`.

Operator-safe output contains only signals that are available by the relevant time:

- `forecast`
- `contemporaneous`
- `lagged_report`

The evidence adapter maps those signals to realistic source classes:

- competitor monitoring
- macroeconomic indicator
- social listening
- weather service
- calendar
- supplier notice
- carrier status
- advertising market monitor
- ad platform notice
- market research

The projection excludes:

- effect strength;
- hidden targets;
- future events;
- environment seed.

Architecture rules prevent Operator-facing modules from importing the hidden external-reality module.

## Backward compatibility

The pre-existing GroundTruth `externalShocks` mechanism remains untouched for compatibility with earlier frozen steps.

Step 14 is enabled only through:

`commercePolicy.externalRealityEnvironment`

An explicit integration test verifies that an empty commerce policy and an omitted commerce policy produce identical simulation output when no external environment is configured. Step 14-specific purchase fields, signals, provenance and God-mode truth are absent in that case.

## Replay coverage

Tests cover:

- all 11 event kinds;
- complete target execution-surface coverage;
- scope and interval boundaries;
- forecast timing;
- deterministic simultaneous effect composition;
- ramp and decay;
- domain-isolated random streams;
- realized application truth;
- evidence leakage prevention;
- more than three years of deterministic daily external-effect resolution;
- a confounded simulator run with simultaneous merchant and external causes;
- inert Step 14 behavior when the sidecar is disabled.

## CI

The dedicated Step 14 workflow runs:

1. architecture boundary validation;
2. TypeScript;
3. Step 14 tests;
4. full repository tests;
5. build.

Stale Step 14 runs are cancelled so validation follows the newest branch head.

## Freeze condition

Step 14 should remain a draft until the repository has a published Step 13 daily clock/checkpoint contract, or that dependency is explicitly waived.

No production integration, private Kivviq code, merchant data, deployment or production API access belongs in this PR.
