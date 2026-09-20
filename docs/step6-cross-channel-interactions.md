# Step 6 — Cross-Channel Interactions

## Frozen foundations

Step 6 starts from the exact frozen Step 5 head:

`23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`

Frozen references:

- Step 1 — GroundTruth: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — merchant/world generation: `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — latent customer population: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- Step 4 — customer journey simulation: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`
- Step 5 — advertising economics: `23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`

Steps 1–5 remain authoritative and unchanged.

## Objective

Marketing channels are no longer evaluated as independent response functions.

Step 6 adds a typed causal interaction runtime/evaluator capable of:

- mediation;
- synergy/complementarity;
- cannibalization;
- substitution;
- audience creation;
- audience depletion/saturation;
- delayed interaction;
- state-dependent interaction;
- explicit zero interaction;
- sparse higher-order interaction;
- asymmetric interactions;
- customer/product/time heterogeneity;
- audience overlap;
- portfolio counterfactuals.

## GroundTruth integration

Step 6 does **not** create a second interaction schema.

Executable interaction rules are compiled from:

- frozen Step 1 `channelInteractions`;
- frozen Step 1 causal graph edges sharing the interaction mechanism ID;
- existing typed causal variable IDs;
- frozen Step 4 carryover/memory;
- frozen Step 3 customer heterogeneity;
- frozen Step 5 delivery/saturation economics.

Step 6 fixtures may clone a synthetic merchant world and add interaction mechanisms/nodes/edges that are valid under the frozen Step 1 schema. Frozen Steps 1–5 themselves are not edited.

## Required portfolio semantics

The evaluator must support:

```
Effect(A | B active) != Effect(A | B inactive)
```

and therefore:

```
Value(A + B) != Value(A) + Value(B)
```

where the world contains interaction.

Pairwise interaction value is measured by shared-randomness replay:

```
Y(A+B) - Y(A only) - Y(B only) + Y(neither)
```

for supported outcomes including revenue, orders and contribution profit.

## Hard acceptance cases

Step 6 will include deterministic worlds for:

- zero interaction control;
- positive synergy;
- cannibalization/substitution;
- Meta → branded Google mediation;
- interaction reversal;
- portfolio reallocation trap;
- prospecting-cut short-term vs long-term reversal.

No Growth Operator optimization algorithm will be added.

## Research isolation

PUBLIC and synthetic-only.

No private Kivviq, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details.
