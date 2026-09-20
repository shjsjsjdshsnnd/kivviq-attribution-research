# Step 3 Latent Customer Population — Acceptance Report

## Frozen base

Step 3 was created from the exact accepted Step 2 head:

`74edb930affca78c8b8ea262821943bba223d770`

PR #2 and PR #5 were not modified.

## Implemented customer truth

Each explicit latent agent contains:

- stable synthetic identifier only;
- population weight;
- correlated latent factors;
- purchase intent;
- current purchase need;
- price-sensitivity multiplier;
- distinct promotion-sensitivity multiplier;
- brand affinity;
- sparse category preferences;
- sparse product preferences;
- per-channel causal susceptibility;
- separate natural channel-use propensity;
- natural search/direct/email/promotion/retargeting selection propensities;
- probabilistic device preference;
- repeat propensity;
- expected purchase interval;
- annual purchase hazard;
- expected future purchases;
- expected order value;
- expected lifetime value;
- abstract lifecycle state;
- overlapping derived labels.

No realized sessions, exposures, searches, page views, carts, checkouts, orders, attribution records or purchase histories are generated.

## Micro ↔ macro reconciliation

Population generation is rejected unless deterministic calibration converges.

Calibrated targets include:

- latent purchase-intent mean;
- brand-affinity mean;
- repeat-propensity mean;
- mobile population composition;
- organic propensity;
- expected purchase interval;
- expected future purchases;
- purchase-weighted AOV;
- expected CLV;
- mean customer price-response multiplier = 1;
- mean customer promotion-response multiplier = 1;
- mean causal-response multiplier = 1 for every active marketing channel.

This makes customer-level heterogeneity aggregate back to the frozen merchant mechanisms under the documented Step 3 reference condition.

A merchant channel with zero true incrementality remains zero for every customer because individual multipliers apply to the merchant effect rather than creating a second independent channel effect.

## Selection-bias acceptance

Tests explicitly verify latent mechanisms that can later generate observational confounding without hard-coded attribution bias.

### High-intent search selection

A merchant world with Google Search true incrementality forced to zero is paired with a latent population where:

- purchase intent strongly increases natural search probability;
- causal search susceptibility remains a separate variable;
- every individual implied Google causal effect remains zero.

### Email selection

A merchant world with email true incrementality forced to zero is paired with a population where:

- brand affinity strongly increases email-subscription propensity;
- brand affinity is not equated with email causal susceptibility.

### Promotion selection

Price-sensitive customers have elevated latent promotion-waiting propensity.

### Retargeting selection

High-intent / high-current-need customers have elevated retargeting-eligibility propensity.

No exposure, attribution or purchase event is generated in these tests.

## Treatment-effect heterogeneity

Tests require within-population variation in:

- channel causal multipliers;
- price sensitivity;
- promotion sensitivity;
- repeat propensity;
- purchase intent;
- brand affinity.

Adversarial populations permit negative individual causal-response multipliers while retaining a calibrated population mean of 1.

Simple populations prohibit negative channel multipliers and use weaker heterogeneity/selection.

## Product-market fit

Customer preferences are sparse and restricted to the merchant's own catalog.

For every customer:

- category references must exist in merchant product-demand mechanisms;
- product references must exist;
- product/category pairs must reconcile;
- channel traits must reference active merchant channels;
- channel mechanism IDs must match the frozen merchant mechanism.

Invalid cross-merchant or invented references fail validation.

## Lifecycle semantics

Lifecycle states that imply prior relationship with the merchant are abstract latent classifications only.

They do not materialize historical orders/events.

The population-weighted existing-customer share must reconcile to the Step 1 merchant target within one explicit agent of discretization tolerance.

## Weighted-agent semantics

If the merchant latent population exceeds the explicit-agent limit, one agent represents multiple statistically equivalent potential customers.

Population weights are used in all aggregate calibration.

The sum of agent weights must equal the merchant represented population.

## Scalability benchmark

Benchmark source code head before this report-only commit:

`bbf8cb3756a27fe61e90d6e1288d58f131b526db`

Benchmark merchant:

- commodity/value retail;
- large scale;
- adversarial merchant;
- long-tail catalog.

Observed CI benchmark:

| Measure | Result |
| --- | ---: |
| Merchant SKU count | 613 |
| Represented customers | 35,998 |
| Explicit agents | 3,000 |
| Population weight per agent | 11.9993 |
| Weighted mode | yes |
| Generation time | 665.36 ms |
| Heap delta | 29,932,640 bytes |
| Serialized population size | 8,444,820 bytes |
| Serialized bytes / explicit agent | 2,814.94 |
| Average product preferences / agent | 3.013 |
| Average category preferences / agent | 1.994 |

Runtime and heap measurements are CI-environment observations, not performance guarantees. The architectural result is the important part: storage scales with explicit weighted agents, active channels and sparse preferences rather than represented population × full catalog.

## Validation gates

The Step 3 test suite includes:

- exact population determinism;
- different-seed variation with preserved merchant targets;
- merchant GroundTruth immutability;
- synthetic-ID / no-PII / no-realized-event checks;
- weighted population accounting;
- strict nested schema validation;
- micro↔macro calibration across multiple merchant families;
- lifecycle mixture reconciliation;
- zero-incrementality selection-bias tests;
- search/email/promotion/retargeting selection tests;
- treatment-effect heterogeneity;
- price vs promotion distinction;
- merchant-conditional population tests;
- sparse product-market-fit validation;
- overlapping segment labels;
- invalid reference and fake-calibration rejection;
- structural difficulty tests;
- scalability benchmark;
- existing frozen Step 1 and Step 2 tests;
- architecture boundary;
- TypeScript build.

## Information boundary

`src/customer_population/` is God-mode research infrastructure.

Operator-facing modules and the root Operator-safe package are forbidden from importing or exporting it.

The population contains hidden causal/behavioral traits and must never be passed directly to Growth Operator.

## Frozen-schema constraint

Step 3 does not modify Step 1 or Step 2 to add missing authoritative AOV/mobile/base-price fields.

Where Step 2 intentionally retained AOV/mobile composition as generator-side merchant-world diagnostics, Step 3 may use those frozen `GeneratedMerchantWorld.summary` values as calibration references.

They are not inserted into GroundTruth metadata and are not exposed to OperatorInput.
