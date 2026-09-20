# kivviq-attribution-research

## Growth Operator research

This public repository is a synthetic-only causal ecommerce research environment.

### Frozen research references

**Step 1 — GroundTruth**

- Frozen head: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- PR #2

**Step 2 — merchant/world generation**

- Frozen head: `74edb930affca78c8b8ea262821943bba223d770`
- PR #5

**Step 3 — latent customer population**

- Frozen head: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- PR #8

Steps 1–3 are frozen and unchanged by Step 4.

### Step 4 — customer journey / behavioral simulation

Branch: `step4/customer-journey-simulation`

Draft PR: #11

Bootstrap-only reference:

`aa313e0981e846424c3a56bce73fda60977489f7`

Step 4 turns the frozen merchant worlds and latent customer populations into deterministic-under-seed, time-evolving stochastic ecommerce economies.

Implemented:

- timestamp-ordered discrete-event kernel;
- first-class simulation clock;
- semantic keyed shared randomness;
- latent need/intent/awareness/consideration state;
- carryover and decay;
- lifecycle/lapse/churn state transitions;
- natural channel selection;
- separate marketing exposure generation;
- separate exposure causal treatment effects;
- delayed effects;
- cross-channel mediation/synergy/cannibalization;
- natural search/direct/email/SMS/Pinterest/affiliate behavior;
- stochastic source/device/landing selection;
- multi-session browsing;
- collection/search/PDP loops;
- persistent carts;
- checkout abandonment and later return;
- product choice using sparse customer preferences;
- inventory constraints and substitution pressure;
- price/promotion response;
- purchase/contribution economics;
- purchase without marketing;
- repeat need and repeat purchase;
- merchant/product seasonality;
- external shocks;
- frozen Step 1 spend/price/promotion/inventory interventions;
- shared-randomness factual/counterfactual replay;
- observational platform-style channel metrics;
- separate God-mode causal truth ledger;
- individual factual/counterfactual purchase comparisons.

### Step 4 causal acceptance

The validation harness demonstrates:

- paid channels can receive attributed revenue while true paid incrementality is exactly zero;
- natural channel selection remains active when all paid causal effects are zero;
- direct/organic commerce survives with paid media off;
- zero-effect channel cohorts can look observationally stronger than untouched cohorts;
- promotion purchasers can be compositionally more promotion-sensitive;
- one identical Meta → Google → purchase path can correspond to:
  - Meta only causal;
  - Google only causal;
  - both causal;
  - neither causal;
- re-enabling nonzero paid effects produces positive shared-randomness counterfactual revenue differences.

Observed paths therefore do not encode causal truth.

### Information boundary

Simulation and latent truth are God-mode research infrastructure.

Operator-facing modules and the safe root API are prohibited from importing/exporting:

- GroundTruth;
- merchant generation;
- latent customer populations;
- simulation;
- counterfactual replay;
- causal evaluators.

Observable event streams never contain latent intent, causal-effect ledgers or counterfactual truth.

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
