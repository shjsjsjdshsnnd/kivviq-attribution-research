# Step 3 — Latent Customer Population

## Frozen foundation

Step 3 starts from the exact accepted Step 2 head:

`74edb930affca78c8b8ea262821943bba223d770`

Step 1 and Step 2 remain frozen. The customer generator consumes a Step 2 `GeneratedMerchantWorld` read-only and verifies that its serialized GroundTruth manifest is unchanged after population generation.

## Purpose

Step 3 defines **who exists** in a synthetic merchant world.

It does not determine what customers do over time.

No Step 3 structure contains realized:

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
- marketing journeys;
- purchase-event history.

No real PII is generated. Identity is a stable synthetic identifier only.

## API

```ts
generateCustomerPopulation({
  merchantWorld,
  populationSeed,
  populationConfig?
}): LatentCustomerPopulation
```

Determinism is bound to:

```
customer-population generator version
+ frozen merchant-world identity/fingerprint
+ population seed
+ population configuration
```

The same inputs reproduce the same explicit latent agents, weights, traits, preferences, calibration report and provenance.

## Weighted agents

The Step 2 merchant world defines a latent customer population size.

Step 3 represents the full population explicitly when practical. For larger populations it creates a bounded number of **weighted latent agents**.

Example:

```
representedCustomerCount = 120,000
explicitAgentCount       = 3,000
populationWeight         = 40 per agent
```

A weight means that the agent represents that many statistically equivalent potential customers under aggregate calculations.

It does **not** mean forty realized purchases or forty event histories.

All micro↔macro calibration uses population weights.

## Joint latent-factor model

Customer attributes are not sampled independently.

Each agent is generated from correlated underlying factors:

- purchase urgency;
- brand attachment;
- deal orientation;
- category involvement;
- marketing receptivity;
- loyalty tendency;
- digital behavior;
- exploration tendency.

These factors are not intended as demographic variables.

They are latent behavioral/economic constructs that generate downstream traits.

The dependency structure includes tendencies such as:

```
brand attachment
  -> brand affinity
  -> repeat propensity
  -> branded/direct and email selection

deal orientation
  -> price sensitivity
  -> promotion sensitivity
  -> promotion-waiting propensity

purchase urgency + current need
  -> purchase intent
  -> natural search propensity
  -> retargeting eligibility

loyalty + purchase interval
  -> future purchase tendency
  -> expected lifetime value

digital behavior
  -> mobile preference
  -> natural digital-channel usage
```

Relationships are probabilistic. Controlled outliers modify the latent factors rather than inserting impossible final values.

## Purchase intent vs current purchase need

`currentPurchaseNeed` represents whether the customer currently has a reason to buy from the merchant/category.

`purchaseIntent` represents broader in-market propensity under the current latent state.

They are distinct.

A high-affinity customer can have low current need.

A moderate-affinity customer with urgent need can have high intent.

Neither variable is a conversion probability.

The population mean purchase intent is calibrated to the Step 2 merchant's Step 1 latent-intent distribution mean.

## Price vs promotion sensitivity

`priceSensitivityMultiplier` is a customer-level multiplier around the merchant's product price-elasticity mechanisms.

`promotionSensitivityMultiplier` is a separate response multiplier around merchant promotion mechanisms.

They are correlated through deal orientation but are not identical.

Promotion sensitivity may be negative for plausible promotion-averse customers.

Population-weighted reference means are calibrated to 1 so customer heterogeneity does not silently change the frozen merchant-level elasticity.

## Brand affinity

Brand affinity is continuous in `[0,1]`.

Its population mean is calibrated to the merchant's Step 1 `baselineBrandPreference`.

Brand affinity influences, but does not determine:

- natural direct/branded propensity;
- email subscription propensity;
- repeat behavior;
- price/promotion response;
- channel selection.

## Sparse catalog preferences

Step 3 never creates a dense customer × SKU matrix.

Preferences are hierarchical and sparse:

1. merchant catalog demand is aggregated into valid merchant categories;
2. each customer receives a small category-affinity set;
3. a small product-affinity set is sampled only from those merchant categories.

Default maximums:

- 4 category preferences per explicit agent;
- 6 product preferences per explicit agent.

Both are configurable within bounded limits.

Every category and product reference is validated against the frozen merchant catalog.

This supports catalogs with 1,000+ SKUs without multiplying customer count by SKU count.

## Channel susceptibility vs natural channel propensity

This distinction is fundamental.

Each active channel has two separate customer-level quantities:

### Causal susceptibility

`causalEffectMultiplier`

A relative multiplier on the frozen merchant-level causal channel effect under the Step 3 reference condition.

Population-weighted mean is calibrated to 1.

Therefore:

```
merchant effect X
× weighted mean customer multiplier 1
= merchant effect X
```

If merchant-level true incrementality is zero, every individual implied causal effect remains zero regardless of customer multiplier.

This prevents customer generation from manufacturing causal channel lift that contradicts the merchant world.

### Natural channel use

`naturalUseProbability`

A selection propensity that exists independently of causal treatment.

Examples:

- high-intent customers naturally search more;
- loyal customers naturally subscribe/open branded lifecycle channels more;
- deal-oriented customers naturally select shopping/affiliate contexts more.

This is intentionally **not** calibrated to causal channel effect.

## Genuine future selection bias

Step 3 creates the latent mechanisms that can later produce confounded observational data.

### Search

Purchase intent and current need increase natural search probability.

For search channels, high purchase intent can simultaneously reduce incremental causal susceptibility because highly in-market customers were already likely to buy/search.

Thus future observational data can show:

```
Google exposure <-> high purchase rate
```

even when Google true incrementality is weak or exactly zero.

### Email

Brand affinity and repeat propensity increase natural email subscription/use propensity.

High brand affinity is not treated as equivalent to email causal response.

A merchant can therefore have strong email selection but zero email incrementality.

### Retargeting

High intent and current need increase latent retargeting-eligibility probability.

No retargeting impression or event is created yet.

### Promotions

Price/promotion-sensitive customers have a higher latent probability of waiting for promotions.

No promotion event or transaction is generated.

Step 3 never writes fake attribution bias directly.

## Device preference

Each customer receives probabilities for:

- mobile;
- desktop;
- tablet.

They sum to exactly 1.

The weighted population mean mobile probability is calibrated to the Step 2 merchant-world mobile composition diagnostic.

This is a customer-composition effect.

It remains distinct from the Step 1 merchant-level **causal device effects** on conversion/AOV.

A future simulator can therefore combine:

- different customers selecting different devices;
- true causal device friction;
- both.

## Repeat, frequency and lifecycle

Repeat propensity is continuous and calibrated to the merchant's repeat target.

Expected purchase interval is customer-specific and calibrated to the merchant-world expected interval.

Lifecycle state is an **abstract latent pre-simulation classification**:

- prospect;
- abstract recent buyer;
- abstract active repeat;
- abstract lapsing;
- abstract dormant;
- abstract subscriber.

These labels do not create event history.

`preSimulationHistory` explicitly distinguishes:

- none;
- abstract existing customer;
- abstract subscriber.

The weighted existing-customer mixture is checked against the Step 1 merchant `existingCustomerShare`.

## Expected future purchases and CLV

Expected lifetime value is not independently sampled.

The customer generator derives:

1. repeat propensity;
2. purchase interval;
3. purchase-hazard score;
4. calibrated expected future purchases;
5. customer expected order value;
6. merchant CLV economics;
7. customer expected CLV.

The population mean expected future purchases is calibrated to the Step 1 merchant CLV mechanism.

Customer AOV is calibrated **purchase-weighted**, not population-weighted:

```
sum(weight × expected purchases × customer AOV)
------------------------------------------------ = merchant expected AOV
sum(weight × expected purchases)
```

This makes expected economic value reconcile correctly.

Customer expected CLV then applies the merchant CLV gross-margin/discount/returns/fulfillment economics to each customer's calibrated expected purchase exposure, minus a heterogeneous acquisition-cost allocation.

The population-weighted mean customer CLV is required to equal the merchant CLV target within tolerance.

No realized historical value exists in Step 3.

## Derived customer labels

Segments are derived labels, not mutually exclusive customer classes.

Possible labels include:

- new/prospect;
- returning-oriented;
- high-value;
- discount-sensitive;
- brand-loyal;
- category enthusiast;
- gift-oriented;
- replenishment-oriented;
- low-intent browser;
- advertising-resistant;
- mobile-dominant.

One customer can carry several labels.

The latent traits remain authoritative.

## Micro ↔ macro calibration

Calibration is deterministic and mandatory.

The population is generated, then reconciled against merchant targets.

Current calibrated targets:

| Customer aggregate | Merchant reference |
| --- | --- |
| mean purchase intent | Step 1 beta latent-intent mean |
| mean brand affinity | Step 1 baseline brand preference |
| mean repeat propensity | Step 2 repeat target |
| mean mobile probability | Step 2 device-composition diagnostic |
| mean organic propensity | Step 2 organic-demand diagnostic |
| mean purchase interval | Step 2 purchase-interval diagnostic |
| mean expected future purchases | Step 1 CLV mechanism |
| purchase-weighted AOV | Step 2 AOV diagnostic |
| mean expected CLV | Step 1 CLV economics |
| mean price multiplier | 1 × merchant elasticity |
| mean promotion multiplier | 1 × merchant promotion mechanism |
| per-channel causal multiplier mean | 1 × merchant channel effect |

Probability targets are calibrated with a deterministic logit-shift binary search.

Positive quantities use deterministic multiplicative scaling.

Bounded signed multipliers use deterministic bounded mean calibration.

A calibration report stores target, implied value, absolute error, tolerance and convergence status.

Generation fails loudly if any required metric is outside tolerance.

## Price/promotion/channel reference condition

For price and promotion response, the micro↔macro reference condition holds the merchant/product intervention fixed and averages customer multipliers over the latent population.

For a given merchant product elasticity `E`:

```
weighted mean(customer price multiplier) = 1

implied aggregate elasticity = E × 1 = E
```

The same contract applies to promotion and channel causal-response multipliers.

Later journey simulation may condition treatment assignment on customer traits; that does not change this Step 3 calibration reference definition.

## Complexity / difficulty

Population complexity defaults to the Step 2 merchant difficulty but can be explicitly overridden for research.

### Simple

- lower latent-factor variance;
- weaker correlations;
- weaker channel selection;
- no negative customer causal multipliers.

### Normal

- realistic heterogeneity;
- correlated traits;
- channel differences and selection.

### Complex

- stronger heterogeneity;
- stronger interaction of latent factors;
- stronger selection effects.

### Adversarial

- high heterogeneity;
- stronger confounding;
- rare customer outliers;
- negative individual treatment multipliers;
- high-intent channel selection.

Difficulty changes structural heterogeneity/selection rather than merchant macro targets. All difficulty levels are still calibrated back to the same merchant-level GroundTruth.

## Validation and information boundary

The population schema is strict.

Validation rejects:

- unknown fields;
- invalid probabilities/ranges;
- non-finite values;
- duplicate customer IDs;
- invalid product/category references;
- invalid/inactive channel references;
- channel mechanism mismatches;
- inconsistent population weights;
- invalid lifecycle history semantics;
- uncalibrated populations;
- PII fields;
- realized event/journey/history fields.

`src/customer_population/` is God-mode infrastructure.

Dependency-cruiser forbids Operator-facing code and `src/index.ts` from importing it.

The Operator-safe root API does not export customer population generation or validation.

## Frozen Step 2 diagnostic constraint

Step 2 correctly kept AOV/mobile-share/base-price diagnostics outside the frozen Step 1 GroundTruth schema where no dedicated v1 fields existed.

Step 3 does not modify Step 1 or Step 2 to solve that limitation.

When a calibration target is available only on the frozen Step 2 `GeneratedMerchantWorld.summary` (for example expected AOV or mobile composition), Step 3 records it as a merchant-world research reference target.

It does not insert those values into GroundTruth metadata or Operator structures.

## Scalability

The architecture avoids dense customer × product × channel × time state.

Per explicit customer storage is approximately:

```
O(latent factors)
+ O(active merchant channels)
+ O(sparse category preferences)
+ O(sparse product preferences)
```

not:

```
O(all SKUs × all channels × all time)
```

Large merchant populations are represented through weighted agents while retaining the exact represented population mass.

CI includes a benchmark for:

- generation time;
- heap-use delta when available;
- serialized population size;
- bytes per explicit agent;
- preference sparsity.
