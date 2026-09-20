# Step 8 — Product Economics Acceptance Report

## Frozen foundations

Step 8 starts from the exact frozen Step 7 head:

`a1e17128fcc308896ddd234bb01c18ac295a7f53`

Steps 1–7 remain frozen and unchanged.

## Objective

Step 8 makes SKU-level product economics and structural product demand first-class God-mode research concepts.

The core distinction is:

```
structural product desirability
!= observed product sales
!= platform-attributed product revenue
!= marginal economic opportunity
```

Inventory, substitution, promotions, channel exposure and availability can change observed product outcomes without changing the underlying latent product preference.

## Unified SKU product contract

Every frozen merchant SKU now receives a Step 8 product-intelligence record containing:

- product ID;
- category;
- synthetic deterministic brand ID;
- price;
- COGS;
- gross margin;
- expected contribution per unit;
- available/reserved/sellable inventory;
- replenishment quantity;
- supplier lead time;
- backorder semantics;
- stockout behavior;
- structural demand units/day;
- structural demand share;
- structural desirability index;
- conversion propensity;
- seasonality;
- substitution relationships;
- complementary relationships;
- return rate;
- shipping cost;
- fulfillment cost;
- discount sensitivity.

## Brand semantics

The frozen Step 1/2 merchant GroundTruth has no authoritative product-brand field.

Step 8 therefore creates a deterministic synthetic brand assignment for evaluator/product-research use.

Every record explicitly marks:

`brandSource = "step8_synthetic_assignment"`

This brand value is not represented as frozen merchant GroundTruth and is not silently treated as causal truth.

## Price / COGS / margin

Step 8 reuses Step 7 product economics.

COGS and margin remain coherent:

```
margin =
1 - COGS / price
```

rather than being independently generated contradictory values.

Product contribution also incorporates the existing Step 7 return/shipping/fulfillment/payment/variable-cost semantics.

## Structural demand

Structural demand comes from the frozen Step 2 product-demand mechanisms.

Step 8 exposes:

- demand cadence normalized to units/day;
- product demand share;
- normalized structural desirability.

This state is separate from realized sales.

## Conversion propensity

Product conversion propensity is a deterministic structural index based on:

- frozen funnel transition probabilities;
- product structural desirability;
- relative product price.

It is not inferred from observed sales and therefore does not jump merely because another SKU stocks out.

## Seasonality

Step 8 resolves all applicable frozen seasonality mechanisms for each SKU.

Product-specific seasonality is retained where Step 2 provides it.

Merchant-level seasonality also remains visible for the product where applicable.

## Substitutes / complements

Step 8 unifies substitution references from:

- product demand mechanisms;
- inventory mechanisms.

Complement relationships use frozen Step 2 product-demand complementarity.

These relationships are used by the existing Step 7 enhanced basket/product-choice simulation.

## Observed product performance

When an ecommerce economic report is supplied, Step 8 separately calculates observed product outcomes:

- represented orders;
- represented units;
- net revenue;
- gross profit;
- contribution before advertising;
- product views;
- add-to-cart activity;
- observed view→purchase rate.

These are explicitly observational.

They do not overwrite structural demand/desirability.

## Product campaign performance

A paid product-campaign evaluator calculates:

- explicit product campaign spend;
- platform-claimed product revenue;
- platform product ROAS;
- claimed represented orders containing the product.

The product campaign spend is explicit input.

Step 8 does not falsely allocate an entire channel budget to one SKU.

## Inventory scale-risk bound

For a SKU with limited inventory, the evaluator calculates an optimistic economic ceiling:

```
maximum remaining inventory contribution =
remaining units
× max(0, expected contribution per unit)

optimistic marginal contribution upper bound =
maximum remaining inventory contribution
- proposed additional advertising spend
```

If this upper bound is negative, scaling cannot be economically justified even under the impossible best case where every remaining unit is sold solely because of the additional campaign spend.

This is stronger than merely forecasting lower ROAS.

## Hard low-inventory ROAS trap

Deterministic acceptance fixture:

`createLowInventoryProductRoasTrapFixture()`

Observed diagnostics:

```
remaining units:                              17
platform product ROAS:                        54.6673x
stock coverage:                               1.3434 days

optimistic contribution from all 17 units:    122,162 minor units
proposed additional spend:                    500,000 minor units

optimistic marginal contribution upper bound: -377,838 minor units
```

Therefore:

- the product looks exceptional by platform ROAS;
- only 17 units remain;
- even selling every remaining unit cannot economically justify the proposed scale block.

This directly demonstrates that “best-performing product campaign” does not imply “scale this product.”

## Structural vs observed substitution

Step 8 adds a shared-randomness product-choice experiment.

The same:

- merchant;
- latent customers;
- preferences;
- product demand mechanisms;
- timestamp;
- random keys

are used in two worlds.

The only runtime change is that Product A becomes unavailable.

The evaluator then compares product selection outcomes without changing structural product demand or customer latent preference.

## Hard sellout substitution trap

Deterministic acceptance fixture:

`createSelloutSubstitutionTrapFixture()`

Product A has an explicit frozen substitution path to Product B.

Observed diagnostics:

```
Product A weighted selection delta:  -34,211.85
Product B weighted selection delta:   +5,506.53

Product B structural demand delta:     0
Product B latent preference delta:     0
```

Product B therefore receives a large observed demand-routing lift even though:

- its frozen structural demand did not change;
- its customer latent preference did not change.

An unsophisticated system using only observed sales/conversion could conclude that Product B became more desirable.

The Step 8 evaluator knows that the increase is consistent with inventory-driven substitution.

## Information boundary

Product economics remains God-mode/evaluator infrastructure.

The Operator-safe root API explicitly cannot expose:

- `buildSkuEconomicIntelligence`;
- `buildProductEconomicsReport`;
- `productCampaignPerformance`;
- `evaluateInventoryScaleRisk`;
- `evaluateSelloutSubstitution`;
- Step 8 adversarial fixtures.

## Validation coverage

Step 8 tests verify:

- every SKU has all required economic/product fields;
- brand assignment is explicit synthetic metadata;
- price / COGS / margin are finite and coherent;
- every product has structural demand;
- every product has conversion propensity;
- every product resolves applicable seasonality;
- substitutes/complements are represented;
- return/shipping/discount sensitivity are available;
- structural desirability remains separate from contribution economics;
- low-stock product campaign can show strong platform ROAS while scaling is economically impossible;
- sellout can increase substitute demand without changing substitute structural demand;
- sellout can increase substitute demand without changing substitute latent preference;
- Operator/God-mode isolation.

All inherited Step 1–7 tests remain in Step 8 CI.

## Final implementation code head

The passing implementation head before acceptance-report packaging is:

`e9144e39bcea2cd6016896bf2066b98121af047f`

On that exact code head:

- Architecture boundary: PASS
- Typecheck: PASS
- Full inherited + Step 8 tests: PASS
- Build: PASS

## Research isolation

Step 8 remains PUBLIC and synthetic-only.

No private Kivviq code, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details are used.

PR #20 remains draft and unmerged.
