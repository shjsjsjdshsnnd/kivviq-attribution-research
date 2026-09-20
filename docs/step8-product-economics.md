# Step 8 — Product Economics

## Frozen foundations

Step 8 starts from the exact frozen Step 7 head:

`a1e17128fcc308896ddd234bb01c18ac295a7f53`

Steps 1–7 remain frozen and must not be modified.

## Objective

Make every SKU economically and behaviorally meaningful enough that product-level decisions can disagree with superficial sales/ROAS signals.

At minimum, product intelligence must expose or derive:

- price;
- COGS;
- margin;
- inventory;
- category;
- brand;
- conversion propensity;
- structural demand;
- seasonality;
- substitution relationships;
- complementary relationships;
- return rate;
- shipping cost;
- discount sensitivity.

## Core principle

Observed product sales are not identical to latent product desirability.

Inventory, substitutions, promotions, channel mix and product availability can move observed sales without changing the underlying customer preference state.

The evaluator must therefore distinguish:

```
structural product demand
observed product demand
inventory-constrained realized sales
substitution-driven demand transfer
economic contribution opportunity
```

## Hard acceptance cases

### Inventory-constrained ROAS trap

A product can show excellent platform/observed advertising performance while only a small number of units remain.

The evaluator must identify that further scaling can have little or negative marginal contribution value because the campaign accelerates stockout or displaces later higher-value demand.

### Sellout substitution trap

Product A sells out.

Demand shifts into Product B through the existing substitution mechanism.

Observed sales/conversion for Product B increase.

God-mode structural preference/demand for Product B must remain distinguishable from that substitution-driven observed lift.

A product-ranking system must not conclude that Product B became intrinsically more desirable merely because Product A became unavailable.

## Boundary

PUBLIC and synthetic-only.

Do not use private Kivviq, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs or private implementation details.

Step 8 remains God-mode/evaluator research infrastructure. No Growth Operator optimizer is built.
