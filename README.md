# kivviq-attribution-research

## Growth Operator research

This public repository is a synthetic-only causal ecommerce research environment.

### Frozen research references

**Step 1 — GroundTruth**

- Frozen head: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- PR #2

**Step 2 — merchant/world generation**

- Frozen head: `74edb930affca78c8ea262821943bba223d770`
- PR #5

**Step 3 — latent customer population**

- Frozen head: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- PR #8

**Step 4 — customer journey / behavioral simulation**

- Frozen head: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`
- PR #11

**Step 5 — advertising economics**

- Frozen head: `23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`
- PR #14

Steps 1–5 are frozen and unchanged by Step 6.

### Step 6 — cross-channel interactions

Branch: `step6/cross-channel-interactions`

Draft PR: #15

Step 6 makes channel value conditional on the rest of the marketing system.

Implemented:

- typed interaction rules compiled from frozen Step 1 GroundTruth mechanisms and causal-graph edges;
- mediation;
- synergy/complementarity;
- cannibalization;
- substitution;
- audience creation;
- audience depletion/saturation;
- delayed interactions;
- state-dependent interactions;
- explicit zero interaction;
- sparse higher-order interactions;
- directional/asymmetric interactions;
- customer-level interaction heterogeneity;
- product/category selectors;
- calendar/promotion/inventory/lifecycle state gating;
- Step 4 memory/decay reuse;
- Step 5 spend/saturation integration;
- audience-overlap diagnostics;
- Meta → branded Search mediation;
- Pinterest → Organic/Direct delayed mediation;
- Email × promotion non-additivity;
- Meta × Google synergy;
- future retargeting/email/search audience creation;
- Paid Search → Direct/Organic cannibalization/substitution;
- conditional channel response;
- portfolio response surfaces;
- joint interventions;
- pairwise interaction value;
- interaction decomposition where structurally meaningful;
- channel-removal spillovers;
- controlled budget reallocation;
- multi-horizon evaluation;
- zero-interaction control worlds;
- positive-synergy worlds;
- cannibalization worlds;
- mediation worlds;
- interaction-reversal worlds;
- hard portfolio-reallocation trap;
- hard 7-day vs 90-day prospecting-cut trap.

### Hard Step 6 acceptance

**Portfolio reallocation trap**

Google shows much stronger independent dashboard signals than Meta, but reallocating 65% of Meta spend to Google reduces true contribution profit by ~257,645 minor units and true revenue by ~497,952 minor units.

**Prospecting-cut trap**

A 50% Meta prospecting cut improves 7-day contribution profit slightly, but over 90 days:

- contribution profit falls ~214,418 minor units;
- revenue falls ~424,341 minor units;
- branded-search readiness falls;
- retargeting audience falls;
- email audience falls.

**Interaction reversal**

Google marginal iROAS changes materially depending on whether Meta is active.

### Information boundary

Cross-channel network compilation, portfolio counterfactuals, interaction decomposition and adversarial fixtures are God-mode evaluator infrastructure.

The Operator-safe root package cannot import/export them.

### Research isolation

No private Kivviq, Maison Olive data, real merchant/customer data, production systems, credentials or private implementation details are used.

### Documentation

- `docs/ground-truth.md`
- `docs/information-boundaries.md`
- `docs/causal-semantics.md`
- `docs/merchant-world-generation.md`
- `docs/step2-diversity-report.md`
- `docs/latent-customer-population.md`
- `docs/step3-customer-population-report.md`
- `docs/step4-customer-journey-simulation.md`
- `docs/step4-simulation-acceptance.md`
- `docs/step5-advertising-economics.md`
- `docs/step5-advertising-economics-acceptance.md`
- `docs/step6-cross-channel-interactions.md`
- `docs/step6-cross-channel-acceptance.md`
