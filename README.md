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

**Step 4 — customer journey / behavioral simulation**

- Frozen head: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`
- PR #11

Steps 1–4 are frozen and unchanged by Step 5.

### Step 5 — advertising economics

Branch: `step5/advertising-economics`

Draft PR: #14

Step 5 makes advertising performance explicitly multi-layered:

```
platform reported
observed
true incremental
marginal incremental
```

Implemented:

- deterministic evaluation of frozen response curves;
- total / average / marginal response;
- diminishing returns and saturation;
- negative marginal-return regions;
- spend→delivery machinery;
- CPM/CPC-like synthetic delivery;
- reach/frequency saturation;
- reachable audiences;
- audience-quality decay;
- Step 3 susceptibility-driven heterogeneous response;
- average/marginal true CAC;
- causal-blind synthetic platform attribution;
- click/view windows;
- view-through attribution;
- retargeting-style claim expansion;
- overlapping platform claims;
- branded vs non-brand Search reporting;
- platform ROAS/CAC;
- observed touch-associated ROAS/CAC;
- shared-randomness true incremental ROAS;
- local marginal ROAS;
- gross/net/gross-profit/contribution economics;
- break-even economics;
- evaluator-only optimal-spend diagnostics;
- finite-budget candidate evaluation;
- promotion/inventory/time-varying response;
- spend delta/multiplier helpers resolved to frozen `set` interventions;
- platform-vs-true performance reports;
- deterministic vanity-ROAS and retargeting traps.

### Adversarial Step 5 acceptance

**Vanity ROAS trap**

The deterministic fixture produces Meta as the platform ROAS leader (~196.9×) while true and marginal incremental ROAS are 0× and another channel has ~4.36× marginal iROAS.

**Retargeting trap**

The deterministic fixture produces ~31.17× platform ROAS for Meta while true incremental ROAS is 0×.

These are fixture outputs, not universal assumptions about real platforms.

### Information boundary

Advertising economics, platform-vs-truth comparison and optimal-spend diagnostics are God-mode/evaluator infrastructure.

The Operator-safe root package cannot import or export them.

Synthetic platform attribution is type-level causal blind: it accepts observable events and purchases, not the God-mode causal ledger.

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
