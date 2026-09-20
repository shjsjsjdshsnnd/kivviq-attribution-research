# Step 2 — Merchant / World Generation

## Status and boundary

Step 2 starts from the frozen Step 1 accepted head:

`cdea7f6c3d313578d2b40870bebadc2690f75495`

The generator is synthetic-only and does not access private Kivviq, Maison Olive, real merchants/customers, production systems, credentials, production APIs, or private implementation details.

It does not generate:

- individual customers;
- sessions;
- journeys;
- orders;
- attribution data;
- recommendations;
- optimizations;
- Growth Operator behavior;
- LLM outputs.

## Core contract

```ts
generateMerchantWorld(config: MerchantGenerationConfig): GroundTruthManifest
```

The frozen Step 1 `parseGroundTruthManifest` is the final output gate.

A generated world that does not satisfy Step 1 runtime validation, causal validation, unit semantics, information boundaries, and reference integrity is rejected inside the generator.

For research/debugging, the companion API is:

```ts
generateMerchantWorldRecord(config)
  -> {
       manifest,
       provenance,
       summary
     }
```

`manifest` is authoritative causal GroundTruth.

`provenance` records the generator version, seed, configuration, difficulty and applied typed overrides needed for reproduction.

`summary` is generator-only diagnostic output used to test population properties. It is not exported through the Operator-safe root API and is not serialized into `OperatorInput`.

## Determinism

The PRNG is seeded from:

```
generator version
+ seed
+ canonicalized generation config
```

Configuration object key order therefore does not change the generated world.

The same generator version + GroundTruth schema + seed + configuration + overrides reproduces the same manifest exactly.

## Hierarchical generation

Merchant fields are not sampled independently.

The generation chain is broadly:

```
archetype
  -> orthogonal business profiles
  -> scale / demand opportunity
  -> AOV and purchase frequency
  -> lifecycle / retention
  -> margin and cost structure
  -> promotion sensitivity
  -> catalog structure
  -> inventory structure
  -> channel portfolio
  -> true channel economics
  -> funnel/device behavior
  -> seasonality
  -> causal graph
  -> Step 1 validation
```

Correlations are probabilistic rather than universal.

For example, high-AOV merchants tend toward longer consideration and lower frequency, while replenishment merchants tend toward shorter intervals and higher repeat probability, but controlled outliers can violate those tendencies.

## Archetypes

Supported families:

- fashion/apparel;
- beauty/cosmetics;
- furniture;
- home furnishings/decor;
- supplements/wellness;
- consumer electronics;
- specialty retail;
- luxury;
- commodity/value retail;
- replenishment-heavy ecommerce;
- subscription-heavy ecommerce.

Each archetype defines distributions and tendencies, not a fixed merchant template.

## Orthogonal profiles

Generation can independently vary:

- AOV profile;
- purchase-frequency model;
- marketing dependence;
- promotion behavior;
- catalog structure;
- inventory profile;
- customer economics;
- seasonality.

These may be requested explicitly or generated from archetype-weighted distributions.

## Scale semantics

Scale is defined primarily by latent annual order opportunity rather than arbitrary revenue labels.

Current broad regimes:

| Scale | Approximate latent annual order regime |
| --- | ---: |
| micro | 350–2,500 |
| small | 1,800–10,000 |
| growth | 7,500–42,000 |
| mid-market | 30,000–160,000 |
| large | 120,000–650,000 |

The sampled value can move outside those exact ranges through conditional purchase-frequency variation.

Scale also influences catalog breadth and latent customer population.

Scale is deliberately **not** an input to gross-margin quality, paid-media efficiency, or contribution-margin quality. Tests verify that large merchants can be inefficient and micro merchants can be highly profitable.

## Catalog generation

Each merchant receives a synthetic product catalog.

Product demand weights use a parameterized Zipf-style ranked distribution:

```
weight(rank) proportional to 1 / rank^alpha
```

The concentration exponent `alpha` varies by generated catalog profile and seed.

This produces:

- hero-product merchants;
- moderate concentration;
- diversified catalogs;
- long-tail structures.

Generated product mechanisms include:

- synthetic product/category identifiers;
- latent demand;
- substitution/complement relationships;
- own-price elasticity;
- selected cross-price elasticity;
- inventory/replenishment constraints;
- return propensity;
- promotion sensitivity;
- product-specific seasonality for higher-complexity worlds.

No real product names are used.

## Channel portfolio and true economics

Potential modeled channels:

- Meta;
- Google Search;
- Google Shopping;
- Pinterest;
- Email;
- SMS;
- Affiliate.

Not every merchant receives every channel.

Selection depends probabilistically on archetype suitability, lifecycle strength, search intent, marketing dependence and seed variation.

For active channels, generation creates Step 1 mechanisms for:

- true incrementality;
- spend-response curves;
- acquisition-response curves where incremental acquisition exists;
- saturation;
- incremental CAC where defined;
- lagged effects;
- customer heterogeneity;
- interactions.

A channel can be:

- strongly incremental;
- weakly incremental / demand-capturing;
- exactly zero incremental;
- negative;
- saturating;
- delayed;
- positive at low spend but negative at the margin.

Zero and negative incremental channels do not receive a contradictory positive acquisition/CAC model.

## Baseline / organic demand

Paid intervention is kept causally separate from demand that exists without modeled paid intervention.

Baseline order opportunity is decomposed into parameterized brand, category, existing-customer and residual organic components.

The Step 1 `organicDemand` counterfactual explicitly references those baseline mechanisms.

Merchants therefore vary from strong organic/brand businesses to acquisition-dependent businesses.

## Promotions and lifecycle

Promotion profile influences:

- expected discounting;
- conversion response;
- margin consequences;
- repeat response;
- price sensitivity.

No actual promotion calendar is generated in Step 2.

Lifecycle generation defines merchant-level mechanisms only:

- repeat probability;
- expected purchase interval;
- expected future purchase count;
- CLV economics;
- retention heterogeneity.

No individual customers are created.

## Device behavior

The generator produces:

- mobile/desktop composition as generator-side diagnostic structure;
- population-adjusted true device effects on conversion and AOV in GroundTruth.

The causal device effect is kept distinct from customer-composition differences.

## Inventory

Per-product inventory mechanisms vary in:

- stock depth;
- replenishment amount;
- replenishment cadence;
- supplier lead time;
- stockout behavior;
- backorder support;
- substitution.

Step 2 creates constraints/mechanisms only, not daily inventory movements.

## Seasonality

Seasonality uses parameterized smooth components plus profile-specific peaks rather than a small set of copied curves.

Supported profiles include:

- low;
- moderate;
- strong;
- holiday-heavy;
- summer-heavy;
- Q4-heavy;
- event-driven.

Monthly curves are normalized to mean 1 and include controlled merchant-specific perturbation.

## Difficulty

Difficulty alters structure rather than simply increasing random noise.

### Simple

- 2–3 channels;
- no channel interactions;
- straightforward response curves;
- lower structural heterogeneity.

### Normal

- 3–5 channels;
- limited interactions;
- moderate product and seasonal heterogeneity.

### Complex

- 4–6 channels;
- interactions;
- threshold/nonlinear response;
- stronger product heterogeneity.

### Adversarial

- 4–7 channels;
- multiple interactions;
- cannibalization;
- negative channels;
- fast saturation;
- negative marginal returns;
- plausible outlier merchants.

Measurement corruption is not introduced.

## Overrides

Overrides are explicit and typed.

Current research overrides include:

- force selected channel true incrementality to zero;
- mobile traffic share;
- seasonality profile;
- AOV profile;
- promotion profile;
- marketing-dependence profile;
- catalog profile.

Overrides appear in provenance and must still yield a valid Step 1 manifest.

Arbitrary untyped mutation is not supported.

## Information boundary

`src/generation/` is treated as God-mode research infrastructure.

Dependency-cruiser forbids Operator-facing code and the root Operator-safe API from importing generation modules.

The existing recursive Step 1 leakage scanner remains defense-in-depth.

## Frozen-schema constraint

Step 1 remains authoritative and is not modified by Step 2.

The accepted v1 manifest has no dedicated typed fields for several requested merchant-generation diagnostics, including baseline AOV, device traffic share, explicit base product prices, or collection membership.

Step 2 therefore does **not** hide those values in arbitrary metadata, identifiers, or Operator structures.

Where such quantities are useful to generate correlated mechanisms or measure population quality, they remain generator-side diagnostics/provenance. The accepted GroundTruth manifest remains the sole authoritative causal schema.

If a later simulator requires one of these quantities as authoritative simulation state, that requires an explicit governed GroundTruth schema evolution rather than an implicit Step 2 extension.

## Research tests

The Step 2 suite includes:

- exact determinism/reproduction;
- typed override behavior;
- 1,000-world validation/property testing;
- intra-archetype variation;
- archetype distribution checks;
- correlated-economics checks;
- controlled-outlier checks;
- scale/difficulty semantics;
- negative channel and negative marginal-return tests;
- entity/reference coherence;
- Operator isolation;
- a 10,000-world quantitative diversity benchmark.

The benchmark reports duplicate rates, concentration of parameter combinations, channel-combination diversity, response-curve coverage, profile coverage, and variance/extremes of key merchant dimensions.
