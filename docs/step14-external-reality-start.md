# Step 14 — External reality

Status: active implementation. Not frozen.

## Objective

Introduce causal variables outside merchant control so the Growth Operator cannot safely assume that every business change was caused by a merchant action.

The Step 14 model is synthetic-only and opt-in. When no `externalRealityEnvironment` is supplied, the frozen Step 1–12 simulator path is unchanged.

## Canonical external event kinds

Step 14 now has typed events for:

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

Each event kind has an explicit domain and a constrained set of causal targets. Invalid domain/kind pairings or implausible target pairings are rejected.

## Known effects

Effects are declared as log multipliers and compose deterministically. For example:

- `Math.log(0.8)` means a 20% reduction.
- `Math.log(1.25)` means a 25% increase.
- simultaneous effects add in log space, so their outcome multipliers multiply.

Effects may be scoped by market, category, channel, product and device. They may also declare delay, ramp and decay.

The runtime has no hidden imperative mutation order: the same environment, timestamp and context always resolve to the same multiplier.

## Simulator integration

The first integrated upstream effects are:

- **Demand:** external demand effects change latent need formation.
- **Natural traffic:** store-traffic and organic-traffic effects alter visit opportunity probability.
- **Paid media:** CPM/CPC inflation reduces fixed-budget delivery; CTR and traffic-quality effects change useful paid exposure.
- **Checkout:** purchase-propensity effects alter conversion probability before the purchase draw.
- **Supply:** supplier-lead-time effects change realized replenishment timing.

The pre-existing GroundTruth `externalShocks` mechanism remains untouched for backward compatibility. Step 14 is an additional typed sidecar and defaults off.

## Observation boundary

External causal truth is kept under `result.godMode.externalReality`.

The non-God-mode projection is only `result.externalSignals`, containing signals whose `availableAt` time is within the simulation window. It never exposes:

- effect strength,
- future events,
- latent causal targets,
- hidden environment seed.

Observations are typed as:

- `forecast`: may precede the event (for example a weather forecast or announced competitor sale),
- `contemporaneous`,
- `lagged_report`.

This lets evaluation cases distinguish “the outside world changed” from “we changed something” without handing the Operator the causal answer.

## Reproducibility

The environment is versioned and seeded. Domain-specific random streams are counter-based and stable by semantic key. Cross-domain draws cannot perturb one another.

Simulation provenance records the external model version and environment ID.

## Still required before freeze

Step 14 is not complete until the branch also has:

1. explicit delivery/shipping-cost execution semantics;
2. category-preference and inventory-availability execution semantics;
3. a realized external-effect application ledger, not just declared environment truth;
4. evidence adapters that mimic real merchant-accessible sources;
5. confounding/adversarial fixtures combining merchant actions and external events;
6. multi-year performance/replay tests;
7. exact-head CI green on the full repository;
8. the published Step 13 daily clock/checkpoint contract, or an explicit decision to freeze Step 14 against the existing simulator clock.

Do not merge or freeze Step 14 before those items are resolved.
