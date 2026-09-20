# Step 4 — Customer Journey / Behavioral Simulation

## Frozen foundations

Step 4 starts from the exact frozen Step 3 head:

`da2d6e90198b24b39c9c1e42552f825eb3a7436e`

The frozen references are:

- Step 1 — GroundTruth foundation  
  `cdea7f6c3d313578d2b40870bebadc2690f75495`
- Step 2 — Merchant/world generation  
  `74edb930affca78c8b8ea262821943bba223d770`
- Step 3 — Latent customer population  
  `da2d6e90198b24b39c9c1e42552f825eb3a7436e`

Steps 1–3 remain authoritative and must not be modified or weakened by Step 4.

## Objective

Turn the static merchant worlds and latent customer populations from Steps 1–3 into a deterministic-under-seed, time-evolving stochastic ecommerce economy.

Customers now behave.

The simulator should generate realized journeys from:

- frozen merchant GroundTruth;
- frozen latent customer state;
- explicit time;
- interventions;
- stochastic variation.

## Core principle

The customer decides whether to act.

A channel does not own the customer.

Marketing exposures may have zero, positive, delayed, interactive, timing, product-choice, or negative effects where frozen GroundTruth permits.

Customers must also be able to purchase without modeled marketing.

## Core contract

Conceptually:

```ts
simulateWorld({
  merchantWorld,
  latentPopulation,
  simulationSeed,
  startTime,
  endTime,
  interventions?
}) -> SimulationResult
```

The same:

- frozen merchant world;
- frozen latent population;
- simulator version;
- simulation seed;
- time range;
- intervention set;

must reproduce the same realized simulation.

Different simulation seeds should produce different stochastic realizations while preserving expected GroundTruth properties.

## Time

Time is first-class.

The simulator must support:

- timestamps;
- hours;
- days;
- weeks;
- months;
- multi-year simulations.

Time affects causality directly through:

- need formation;
- delayed marketing effects;
- replenishment;
- repeat purchase;
- lifecycle changes;
- seasonality;
- promotions;
- channel interactions;
- external shocks.

Events must not be independently generated and timestamped afterward.

## Event-driven architecture

Prefer a discrete-event or equivalently principled simulation.

Candidate internal events include:

- NeedFormation
- MarketingExposure
- AwarenessChange
- ConsiderationChange
- Search
- Visit
- SessionStart
- LandingPageView
- CollectionView
- SiteSearch
- ProductView
- AddToCart
- RemoveFromCart
- CheckoutStart
- CheckoutAbandon
- Purchase
- ReturnVisit
- EmailEligibility
- RepeatNeedFormation
- RepeatPurchase
- ChurnStateChange

Latent state-change events remain God-mode.

## Information boundary

Preserve the Step 1 three-layer architecture.

### Latent simulation state

May contain:

- intent;
- awareness;
- consideration;
- need;
- affinity;
- latent purchase probability;
- channel susceptibility;
- counterfactual state.

### Perfectly observable behavior

May contain:

- impression;
- click;
- visit;
- page view;
- add to cart;
- checkout;
- purchase.

Latent causal truth must never be placed in Operator-facing structures.

## Journey generation

Journeys are not templates.

Valid paths should emerge from underlying mechanisms, including:

- Meta -> leave
- Meta -> Organic -> purchase
- Google -> PDP -> leave -> Direct later -> purchase
- Pinterest -> Meta -> Email -> Google -> purchase
- Organic -> purchase
- Email -> purchase
- No marketing -> Direct -> purchase
- multi-session abandoned carts/checkouts followed by later purchase
- repeat purchases after prior purchase

No fixed percentage of multi-touch journeys should be hard-coded.

## Need and intent

Journeys begin with need/demand, not necessarily marketing.

Need formation depends on merchant/category, latent customer traits, lifecycle, purchase-frequency tendencies, seasonality, elapsed time, prior conceptual purchases and stochastic variation.

Purchase intent evolves over time and remains latent.

## Marketing exposure vs causal effect

Exposure and effect are separate.

A customer can be exposed and still have:

- zero effect;
- awareness effect only;
- delayed search/visit effect;
- purchase acceleration;
- product-choice change;
- purchase-probability lift;
- negative response;
- cross-channel interaction.

The observed path must not reveal causal truth directly.

## Natural channel selection

Use Step 3's explicit distinction between:

- natural channel propensity;
- causal channel susceptibility.

High-intent customers may naturally search.

Brand-loyal customers may naturally use email/direct.

Visual customers may naturally use Pinterest.

This should create observational selection bias organically rather than by injecting attribution bias.

## Sessions and browsing

Support:

- multiple sessions per customer;
- stochastic source/device/landing selection;
- homepage/collection/PDP/search-result landings;
- loops across collections/PDPs/search;
- cart persistence;
- checkout abandonment;
- later return;
- non-converting journeys.

A principled stopping/hazard rule must prevent infinite browsing loops.

## Product, inventory, price and promotion

Product choice should use:

- sparse customer preferences;
- merchant product demand/popularity;
- price;
- promotions;
- inventory;
- browsing context;
- exploration.

Inventory must constrain realized sales and allow abandonment, substitution, waiting or return.

Price and promotion response must use both merchant-level mechanisms and Step 3 customer heterogeneity.

## Purchase

Purchases are realized outcomes of the simulated causal process.

God-mode evaluation records may contain:

- customer reference;
- timestamp;
- products/quantities;
- prices/discounts;
- revenue;
- costs;
- contribution economics;
- observed journey;
- latent/counterfactual references where permitted.

Operator-facing purchase events must not contain latent causal truth.

## Purchase without marketing

This is mandatory.

Baseline/organic demand must be capable of producing direct or organic purchases with no modeled marketing exposure.

Setting paid marketing to zero must not eliminate commerce for merchants with baseline demand.

## Multi-session / multi-channel / delayed behavior

Support:

- long consideration;
- multi-session returns;
- cross-channel sequences;
- delayed causal effects;
- carryover/decay;
- channel interactions;
- purchase acceleration;
- later direct/organic behavior after prior exposure.

## Repeat purchase / retention

After purchase, latent state may evolve:

- current need resets;
- replenishment clock changes;
- lifecycle changes;
- repeat propensity can influence future behavior;
- brand/category state may change where frozen mechanisms permit.

Repeat behavior must emerge from customer/merchant retention mechanisms rather than being forced.

## Seasonality and shocks

Apply frozen merchant/product seasonality and Step 2 external shocks during the simulation process.

They must affect causal descendants only and cannot alter historical events retroactively.

## Interventions

Use the frozen Step 1 intervention contract.

Supported Step 4 interventions should modify causal mechanisms/state and allow downstream outcomes to change naturally.

Examples:

- Meta spend = 0;
- Google spend increase;
- price change;
- promotion off;
- inventory unconstrained;
- reduced checkout friction where formally supported.

Do not directly edit final orders/revenue to manufacture effects.

## Counterfactual replay

Factual and counterfactual simulations must share controlled randomness.

Conceptually:

```
World A: normal Meta spend
World B: Meta spend = 0

same merchant
same latent customers
same stochastic structure
different intervention
```

Outcome differences then provide known simulated causal truth.

Where practical, God-mode evaluator infrastructure should be able to inspect individual counterfactual questions such as whether a specific customer would have purchased, purchased later, or chosen another product under another intervention.

## Research boundary

This branch remains PUBLIC and synthetic-only.

Do not access or depend on:

- private Kivviq;
- Maison Olive data;
- real merchant/customer data;
- production systems;
- credentials;
- production APIs;
- private implementation details.

This bootstrap commit establishes Step 4 isolation and scope only. No frozen Step 1–3 code is modified.
