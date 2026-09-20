# kivviq-attribution-research

## Growth Operator research

This public repository is a synthetic-only research environment.

### Frozen foundations

**Step 1 — GroundTruth**

- Accepted head: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- PR #2

**Step 2 — merchant/world generation**

- Accepted head: `74edb930affca78c8b8ea262821943bba223d770`
- Branch: `step2/merchant-world-generation`
- PR #5

Neither frozen branch is modified by Step 3.

### Step 3 — latent customer population

Branch: `step3/latent-customer-population`

Draft PR: #8

Step 3 generates deterministic heterogeneous latent consumers inside frozen Step 2 merchant worlds.

Implemented:

- stable synthetic customer IDs only;
- weighted-agent population semantics;
- correlated latent behavioral/economic factors;
- continuous purchase intent and current purchase need;
- distinct price and promotion sensitivity;
- brand affinity;
- sparse merchant-aligned category/product preferences;
- channel causal susceptibility;
- separate natural channel-use propensity;
- natural selection mechanisms for search, email, promotions and future retargeting;
- probabilistic device preference;
- repeat propensity and purchase-frequency hazard;
- abstract lifecycle state without fabricated events;
- customer expected CLV derived from underlying retention/economic mechanisms;
- overlapping derived customer labels;
- deterministic micro↔macro calibration;
- strict runtime/reference validation;
- simple/normal/complex/adversarial customer heterogeneity;
- weighted-agent scalability benchmarking.

Every population is rejected unless it reconciles to the frozen merchant world within explicit calibration tolerances.

### Step 3 does NOT generate

- sessions;
- impressions;
- clicks;
- ad exposures;
- searches;
- page views;
- carts;
- checkouts;
- orders;
- attribution records;
- realized customer journeys;
- recommendations;
- optimization;
- Growth Operator;
- LLM reasoning.

No real names, emails, phone numbers, addresses or demographic records are used.

### Information boundary

Latent customer populations are God-mode information.

The architecture gate prevents Operator-facing modules and `src/index.ts` from importing:

- GroundTruth;
- merchant generation;
- latent customer population;
- evaluation/oracle;
- future simulation/God-mode internals.

### Documentation

- `docs/ground-truth.md`
- `docs/information-boundaries.md`
- `docs/causal-semantics.md`
- `docs/merchant-world-generation.md`
- `docs/step2-diversity-report.md`
- `docs/latent-customer-population.md`
- `docs/step3-customer-population-report.md`
