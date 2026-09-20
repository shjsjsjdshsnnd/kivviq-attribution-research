# Step 7 — Ecommerce Economics

## Frozen foundations

Step 7 starts from the exact frozen Step 6 head:

`04e92f05364578c9b92358c887c9f316e5419a42`

Frozen references:

- Step 1 — GroundTruth: `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — merchant/world generation: `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — latent customer population: `da2d6e90198b24b39c9c1e42552f825eb3a7436e`
- Step 4 — customer journey simulation: `0c30df8973c27f6ad6b96f4a4b426de74fd0cf3b`
- Step 5 — advertising economics: `23d8372a6fec2b3271ff70ecf9c065d625c9a7c3`
- Step 6 — cross-channel interactions: `04e92f05364578c9b92358c887c9f316e5419a42`

Steps 1–6 remain authoritative and unchanged.

## Objective

Make the simulator evaluate actual ecommerce business value rather than treating revenue, orders, conversion or ROAS as the final objective.

The authoritative economic waterfall remains aligned with the frozen Step 1 accounting identity:

```
Gross merchandise revenue
- discounts
= revenue after discounts
- returns / refunds
= net revenue
- COGS
= gross profit
- payment fees
- shipping subsidy
- fulfillment cost
- variable operating costs
- promotional costs
- advertising cost
= contribution profit
```

Step 7 will add precise order/product/customer/period economics, returns/refunds, shipping economics, multi-item baskets, inventory opportunity-cost evaluation, price/discount economics, new-vs-repeat contribution, expected-future value, and shared-randomness economic counterfactuals.

This branch remains PUBLIC and SYNTHETIC-ONLY.

No private Kivviq, Maison Olive, real merchant/customer data, production systems, credentials, production APIs, or private implementation details are used.

This commit establishes Step 7 isolation only.
