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

**Step 5 — advertising economics**
- Frozen head: `23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`
- PR #14

**Step 6 — cross-channel interactions**
- Frozen head: `04e92f05364578c9b92358c887c9f316e5419a42`
- PR #15

Steps 1–6 are frozen and unchanged by Step 7.

### Step 7 — ecommerce economics

Branch: `step7/ecommerce-economics`

Draft PR: #18

Step 7 makes **contribution profit and customer economic value** first-class research outcomes instead of treating revenue/orders/conversion/ROAS as the final objective.

Implemented:

- canonical contribution-profit waterfall;
- integer minor-unit accounting and exact reconciliation;
- order-level economics;
- product-level economics;
- product margin/COGS heterogeneity;
- discounts and separate promotional costs;
- shipping revenue/cost/subsidy;
- free-shipping threshold behavior;
- percentage + fixed payment fees;
- fulfillment and variable operating cost;
- delayed returns/refunds;
- partial line returns;
- explicit return costs;
- authoritative period-level advertising cost;
- channel incremental contribution economics;
- new-customer economics;
- repeat-customer economics;
- expected future contribution;
- realized vs expected value separation;
- CLV-linked future value;
- multi-item / multi-quantity baskets;
- product complementarity and substitution;
- inventory/backorder/replenishment lifecycle;
- inventory opportunity-cost analysis;
- price elasticity economics;
- low/high-elasticity price-increase cases;
- discount economics and pull-forward;
- promotion × customer behavior;
- promotion × advertising economics;
- contribution decomposition by product/category/customer type/promotion;
- shared-randomness economic counterfactuals;
- low-inventory advertising trap;
- discount trap;
- best-seller trap;
- high-AOV trap;
- CAC-vs-future-value trap;
- short-term-vs-long-term customer-value reversal.

### Hard Step 7 examples

**Discount trap**

Promotion drives represented orders from ~559 to ~1,930 and net revenue from ~6.27M to ~22.85M minor units, while contribution profit deteriorates from ~-75K to ~-6.28M.

**Promotion × advertising trap**

Meta revenue iROAS rises from ~18.22× without promotion to ~53.46× with promotion, while incremental contribution changes from ~+284K to ~-1.47M minor units.

**Best-seller trap**

The revenue-leading product has ~2.44M revenue opportunity but ~-1.00M contribution opportunity, while a lower-revenue product has ~+572K contribution opportunity.

**Low-inventory ad trap**

A channel shows ~54.97× platform ROAS while marginal contribution-profit effect is -25K minor units.

### Information boundary

Ecommerce economics, opportunity diagnostics, economic counterfactuals and adversarial fixtures are God-mode/evaluator infrastructure.

The Operator-safe root API cannot import/export them.

### Step 8 — product economics

Branch: `step8/product-economics`

Draft PR: #20

Step 8 unifies SKU-level product economics and separates intrinsic product demand from observed demand created by inventory and substitution.

Every SKU now exposes:

- price;
- COGS;
- margin;
- inventory;
- category;
- explicit synthetic brand assignment;
- conversion propensity;
- structural demand;
- seasonality;
- substitutions;
- complements;
- return rate;
- shipping cost;
- discount sensitivity;
- expected contribution per unit.

Hard Step 8 traps:

**17-unit ROAS trap**

A SKU with only 17 units remaining shows ~54.67× platform product ROAS, but the maximum optimistic contribution from all remaining inventory is ~122K minor units versus a 500K proposed scale block. Even perfect sell-through cannot make scaling economically rational.

**Sellout substitution trap**

When Product A becomes unavailable, Product B gains ~5,507 weighted selections while Product B structural demand and latent preference both remain unchanged. The system can therefore distinguish substitution-driven observed growth from genuine increased desirability.

### Step 9 — inventory dynamics

Branch: `step9/inventory-dynamics`

Draft PR: #22

Step 9 makes inventory a **dynamic causal economic constraint** instead of a static product attribute.

The authoritative system now separates physical on-hand, sellable, reserved, committed, quarantined returns, damaged, inbound and backordered units; runs reservations/reorders/supplier delays/returns/backorder cancellation through the Step 4 clock; and exactly reconciles every SKU movement.

The hard distinction is:

```
latent demand
!= fulfilled demand
!= observed booked sales
```

Evaluator-only research adds named days-of-cover bases, low/excess stock, carrying cost, aging/obsolescence value, collection health, true simulated stockout probability, lost-sales/replenishment counterfactuals and inventory-constrained advertising response curves.

Hard Step 9 traps cover:

- stockout-driven observed-demand distortion;
- attractive platform ROAS with negative inventory-constrained marginal contribution;
- promotion-driven short-window revenue lift with lower full-horizon contribution.

Step 9 remains opt-in through `enableInventoryDynamics`; the frozen Step 1–8 execution path is unchanged when the flag is off.

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
- `docs/step7-ecommerce-economics.md`
- `docs/step7-ecommerce-economics-acceptance.md`
- `docs/step8-product-economics.md`
- `docs/step8-product-economics-acceptance.md`
- `docs/step9-inventory-dynamics.md`
