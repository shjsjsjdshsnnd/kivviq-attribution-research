# kivviq-attribution-research

## Growth Operator research

This public repository is a synthetic-only research environment.

### Frozen Step 1 foundation

Step 1 remains frozen at:

- Branch: `step1/growth-operator-ground-truth`
- PR: #2
- Accepted head: `cdea7f6c3d313578d2b40870bebadc2690f75495`

Step 1 defines the authoritative GroundTruth schema, causal contracts, intervention semantics, unit rules, information boundaries, leakage protections, invariants and runtime validation.

### Step 2 — merchant/world generation

Branch: `step2/merchant-world-generation`

Draft PR: #5

Step 2 generates deterministic, economically coherent synthetic ecommerce merchant worlds from the frozen Step 1 GroundTruth mechanisms.

Implemented:

- 11 merchant archetype families;
- orthogonal AOV, lifecycle, marketing, promotion, catalog, inventory and seasonality profiles;
- micro through large scale regimes;
- correlated economic generation rather than independent random fields;
- synthetic catalogs from tiny curated assortments through 1,500-SKU long-tail catalogs;
- Zipf-style product concentration;
- merchant-specific channel portfolios;
- true channel incrementality, saturation, CAC and response curves;
- zero/negative incrementality and negative marginal returns;
- baseline/organic demand;
- promotion, lifecycle, device, funnel, inventory and elasticity mechanisms;
- merchant-specific causal graphs;
- controlled outliers;
- simple, normal, complex and adversarial difficulty levels;
- typed research overrides;
- deterministic generation provenance;
- Step 1 validation as the mandatory output gate;
- 1,000-world property testing;
- 10,000-world diversity benchmarking.

Every returned `GroundTruthManifest` is validated by the frozen Step 1 parser before leaving the generator.

### Research isolation

The Step 2 branch does not use:

- private Kivviq code;
- Maison Olive data;
- real merchant or customer data;
- production databases or APIs;
- credentials or secrets;
- private Kivviq implementation details.

It does not generate individual customers, orders, sessions, journeys or attribution observations, and does not implement Growth Operator, recommendations, optimization or an LLM layer.

### Information boundary

Merchant generation is God-mode research infrastructure. The dependency graph prevents Operator-facing modules and the Operator-safe root API from importing generation, GroundTruth, evaluator/oracle or future simulation internals.

### Documentation

- `docs/ground-truth.md`
- `docs/information-boundaries.md`
- `docs/causal-semantics.md`
- `docs/merchant-world-generation.md`
- `docs/step2-diversity-report.md`

### Frozen-schema note

Step 2 does not alter or bypass the accepted Step 1 schema. Merchant diagnostics for which Step 1 v1 has no dedicated typed GroundTruth field remain generator-side research diagnostics/provenance rather than being hidden in arbitrary metadata.
