# Step 2 Diversity Report

Benchmark source head:

`756553b48c2288bd60fbd471ff55bcf1bcfc5dc5`

The benchmark generates 10,000 complete merchant worlds across all supported archetypes, scales and complexity levels. Every world passes the frozen Step 1 GroundTruth parser as part of generation.

## Diversity acceptance

| Measure | Result |
| --- | ---: |
| Generated worlds | 10,000 |
| Unique world IDs | 10,000 |
| Unique exact summary signatures | 10,000 |
| Exact duplicate rate | 0% |
| Coarse signatures | 10,000 |
| Largest coarse-signature share | 0.01% |
| Active channel combinations | 73 |
| Response-curve families | 4 |
| Catalog profiles covered | 5 / 5 |
| Promotion profiles covered | 5 / 5 |
| Seasonality profiles covered | 7 / 7 |
| Inventory profiles covered | 6 / 6 |
| Archetypes covered | 11 / 11 |

Response-curve families observed:

- Hill/saturating
- linear
- piecewise
- threshold

The linear family includes zero and negative causal response cases. Piecewise worlds can exhibit negative marginal returns beyond the peak.

## Numeric distribution results

All money values below are integer minor currency units.

| Dimension | Mean | Std. dev. | Min | Max |
| --- | ---: | ---: | ---: | ---: |
| Annual revenue potential | 3,349,076,172 | 12,292,860,254 | 648,388 | 253,111,906,206 |
| Expected AOV | 39,708 | 67,485 | 897 | 596,974 |
| SKU count | 163.0 | 152.0 | 6 | 1,500 |
| Gross margin rate | 53.55% | 15.06 pp | 12.38% | 84.99% |
| Repeat probability | 41.89% | 21.41 pp | 3.03% | 96.00% |
| Mobile traffic share | 64.78% | 10.75 pp | 28.00% | 95.00% |
| Active channel count | 4.24 | 1.42 | 2 | 7 |
| Paid dependence | 50.32% | 19.08 pp | 8.29% | 89.99% |
| Organic-demand share | 54.14% | 21.61 pp | 10.01% | 95.00% |
| Seasonality strength | 0.301 | 0.152 | 0.020 | 0.620 |
| Top-five SKU latent-demand share | 39.58% | 17.40 pp | 5.01% | 94.79% |
| Expected discount rate | 11.00% | 7.78 pp | 0.50% | 29.99% |

## Archetype coverage

Balanced benchmark counts:

- fashion/apparel: 910
- beauty/cosmetics: 909
- furniture: 909
- home furnishings/decor: 909
- supplements/wellness: 909
- consumer electronics: 909
- specialty retail: 909
- luxury: 909
- commodity/value retail: 909
- replenishment-heavy: 909
- subscription-heavy: 909

The one-count difference is only the remainder from dividing 10,000 worlds across 11 families.

## Interpretation

The benchmark rejects a disguised-template generator in several independent ways:

1. No exact summary duplicates were observed.
2. No coarse parameter bucket represented more than 0.01% of the population.
3. Channel portfolios produced 73 distinct combinations.
4. Every requested catalog/promotion/seasonality/inventory profile appeared.
5. Numeric merchant characteristics span broad ranges with substantial variance.
6. Product concentration covers both strong hero-product and highly diversified long-tail merchants.
7. Catalog size ranges from six SKUs to the configured 1,500-SKU ceiling.
8. Distribution tests separately confirm economically expected archetype tendencies while preserving within-archetype variance and controlled outliers.

These are research acceptance checks, not claims that the chosen synthetic population is empirically calibrated to the real ecommerce market. No real merchant data was used.

## Runtime

The complete CI suite includes:

- Step 1 architecture and leakage tests;
- Step 1 GroundTruth validation tests;
- Step 2 determinism/override tests;
- 1,000-world property validation;
- distribution/correlation tests;
- economic/entity coherence tests;
- scale/difficulty tests;
- 1,000+ SKU catalog tests;
- the 10,000-world diversity benchmark;
- TypeScript build.

The benchmark remains deterministic for its fixed generator version, seed sequence and configuration sequence.
