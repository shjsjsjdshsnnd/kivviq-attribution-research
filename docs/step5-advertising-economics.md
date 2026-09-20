# Step 5 — Advertising Economics

## Frozen foundations

Step 5 starts from the exact frozen Step 4 head:

`0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`

Frozen references:

- Step 1 — GroundTruth: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — merchant/world generation: `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — latent customer population: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- Step 4 — customer journey simulation: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`

Steps 1–4 remain authoritative and must not be modified or weakened.

## Objective

Build a rigorous advertising-economic layer in which:

```
platform-reported performance
!= observed merchant performance
!= true incremental performance
!= marginal incremental performance
```

These quantities may sometimes be close, but they are never treated as the same definition.

## Core causal chain

```
spend
  -> delivery opportunity
  -> reach/frequency/exposure
  -> heterogeneous customer response
  -> direct/delayed/cross-channel effects
  -> incremental commerce
  -> incremental economics
```

Separately:

```
observable touchpoints
  -> synthetic attribution rules
  -> platform-attributed conversions/revenue
  -> platform-reported ROAS/CAC
```

Platform attribution never reads God-mode causal truth.

## Response functions

Step 5 consumes the frozen Step 1/2 response-curve semantics rather than creating a competing GroundTruth model.

Supported existing curve families:

- linear;
- Hill/saturating;
- threshold;
- piecewise.

Step 5 adds evaluator operations over those frozen curves:

- deterministic total-response evaluation;
- average response;
- local marginal response;
- saturation diagnostics;
- break-even diagnostics;
- contribution-profit evaluation;
- economically optimal spend approximation.

Step 5 may apply explicit state modifiers for time, inventory, promotion, reachable audience and audience quality, but the underlying frozen merchant response curve remains authoritative.

## Spend → delivery

Spend does not directly create revenue.

The Step 5 delivery layer models synthetic:

- CPM/CPC-like delivery economics;
- reachable audience;
- reach;
- frequency;
- audience saturation;
- quality decay;
- repeated exposure.

Delivery parameters are synthetic research parameters derived deterministically from the frozen merchant/channel world.

They are not intended to reproduce proprietary auction algorithms.

## True performance

True incremental performance is measured through frozen Step 4 shared-randomness counterfactual replay.

For a spend intervention:

```
incremental revenue =
Revenue(high-spend world)
- Revenue(low-spend world)

incremental spend =
high spend - low spend

true incremental ROAS =
incremental revenue / incremental spend
```

Marginal return evaluates a small spend block around a reference spend.

## Platform reporting

Step 5 adds transparent synthetic platform attribution rules supporting:

- click-like attribution;
- view-through attribution;
- explicit windows;
- platform touch ownership;
- overlapping claims;
- retargeting-style claims.

Multiple platforms may claim the same purchase.

Platform-attributed revenue therefore need not reconcile to merchant revenue.

## Research-only evaluator

The God-mode evaluator may compare:

- spend;
- platform-attributed revenue;
- platform ROAS;
- observed touch-associated revenue;
- true incremental revenue;
- true incremental ROAS;
- marginal incremental ROAS;
- average/marginal incremental CAC;
- incremental contribution profit;
- break-even economics;
- contribution-profit-maximizing spend.

This evaluator truth is not Operator input.

## Adversarial acceptance

At minimum Step 5 must include deterministic fixtures for:

### Vanity ROAS trap

The channel with the highest platform-reported ROAS has poor true marginal economics.

### Retargeting trap

A retargeting-style channel can show excellent platform-reported performance because it selects high-propensity customers while true incrementality is materially lower.

## Research isolation

PUBLIC and synthetic-only.

No private Kivviq, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details.

This bootstrap commit establishes Step 5 scope only.
