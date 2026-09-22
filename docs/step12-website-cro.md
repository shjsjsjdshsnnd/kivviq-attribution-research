# Step 12 — Website, Funnel & CRO Simulation

## Status and frozen parent

Step 12 is public, synthetic-only Growth Operator research.

- Branch: `step12/website-cro-simulation`
- Draft PR: #39
- Canonical frozen Step 11 parent: `62de3c0840d408116064a7fc691c777a83906e55`
- Step 11 and all earlier frozen research foundations remain unchanged.

No private Kivviq code, Maison Olive data, real merchant/customer data, production systems, credentials, production APIs, or private implementation details are used.

## Objective

The storefront is a causal part of the simulated ecommerce business rather than a frictionless visit-to-purchase pipe.

Step 12 models hidden website state for:

- homepage;
- navigation;
- collections;
- site search;
- product detail pages;
- cart;
- checkout;
- mobile, desktop, and tablet execution.

The Operator-safe root does not expose hidden website parameters. Website state and causal friction events live under evaluator/God-mode surfaces only.

## Versioned website state

`WebsiteScenario` contains strictly time-ordered `WebsiteState` versions. Each state has:

- a website `versionId`;
- `deployedAt`;
- a version identifier for every component;
- component-specific causal configuration;
- device-specific performance.

Resolution is timestamp-aware. A dated release can therefore change one component while the rest of the business, customer population, marketing, products, inventory, pricing, and randomness remain unchanged.

## Performance and latency

Each website component has a device-specific `PagePerformance` contract:

- latency;
- load-success probability;
- interaction delay;
- responsiveness;
- asset-weight proxy.

The simulator does not emulate a browser. Performance affects continuation through customer-specific hazard mechanics.

Latency tolerance depends on existing latent/runtime customer state, including intent, need and brand affinity, plus device. High-intent customers can survive friction that causes lower-intent customers to abandon.

There is no global “+1 second = -X% conversion” rule.

## Nonlinear CRO effects

Website quality is transformed through saturating nonlinear response functions. Moving a component from poor to acceptable can therefore create materially more value than moving the same component from good to excellent.

This is the Step 12 CRO-saturation behavior. No separate requirements were inferred beyond the supplied specification, which ended at the `54. CRO SATURATION` heading.

## Homepage and navigation

Homepage and navigation mechanics separately represent:

- discovery quality;
- merchandising relevance;
- navigation clarity;
- promotional clarity;
- product/collection visibility;
- category discoverability;
- hierarchy clarity;
- path efficiency;
- mobile-menu usability.

Poor navigation can lower continuation and shift customers toward site search. Not every journey visits the homepage because source-specific landing behavior remains inherited from the frozen journey simulator.

## Collections and merchandising

Collection mechanics represent:

- ranking;
- filtering;
- sorting;
- product density;
- relevance;
- availability visibility.

Product discovery is not uniform. Product-level presentation can change collection visibility independently of latent demand.

The poor-collection-sorting trap deliberately buries a product with strong latent preference. Observed PDP views, ATC and sales fall even though underlying demand remains strong.

## Site search

Synthetic site search models:

- search entry;
- relevance;
- synonym coverage;
- zero-result risk;
- reformulation;
- alternative discovery;
- category fallback;
- abandonment.

Search operates on synthetic intent/catalog relevance; no NLP engine is required.

Zero-result search does not force abandonment. Customers can reformulate or move back into category browsing.

## PDP

PDP mechanics remain decomposed rather than represented by a single hidden quality number:

- imagery;
- information completeness;
- price clarity;
- variant-selection usability;
- inventory clarity;
- delivery clarity;
- trust;
- social proof;
- CTA usability;
- device-specific performance.

PDP response can vary by category, product presentation and price. High-price products can place greater weight on information, trust and delivery clarity where the scenario enables that interaction.

## Inventory information

Availability shown by the site is derived from the existing inventory system. Step 12 does not create an independent inventory truth.

Observable product-view events can carry availability/delivery information derived from Step 9 state and mechanisms.

## Cart

Cart mechanics include:

- clarity;
- shipping visibility;
- promotion visibility;
- coupon reliability;
- coupon expectation;
- cross-sell relevance;
- quantity editing;
- persistence;
- performance.

Cart persistence remains multi-session. Persistence probability governs whether the existing cart survives; the inherited persistent-cart state carries lines forward across sessions.

Cross-sell behavior uses the existing product complementarity/substitution structure and can help, do nothing, distract, or redirect choice rather than assuming every recommendation adds value.

## Coupon behavior

Coupon attempts are customer- and promotion-dependent. A failed expected coupon can reduce checkout completion but does not deterministically force abandonment.

The broken-coupon trap keeps promotional traffic, ATC and checkout entry healthy while completion deteriorates because expected coupon functionality fails.

## Checkout

Checkout is separate from cart and models stage-specific mechanics:

- contact usability;
- shipping usability;
- payment usability;
- review usability;
- form usability;
- mobile usability;
- account-requirement friction;
- address-validation reliability;
- payment reliability;
- excessive steps;
- shipping-cost visibility;
- performance.

Checkout defects produce explicit hidden causal friction events and observable diagnostic events such as coupon errors, payment failures, address-validation failures and shipping-cost reveals.

Customers can still complete after some failures, reflecting retry/tolerance/alternative-path behavior. Existing multi-session logic can also create later returns after abandonment.

## Shipping surprise

Shipping surprise is generated only when a real positive shipping charge is revealed late enough to violate prior expectation.

Its effect varies with shipping burden, price sensitivity, intent, brand affinity and prior cart visibility.

The shipping-surprise trap preserves healthy PDP → ATC and ATC → checkout behavior while checkout completion falls after the late cost reveal.

## Website × channel

Because channels produce different customer/device mixes, a device-specific defect can change observed channel economics without changing the channel's frozen causal treatment effect.

The channel-blame trap makes Meta look worse because Meta traffic is disproportionately mobile while the mobile PDP is defective. The underlying channel causal effect remains unchanged.

## Website × product/category/price/promotion/inventory/retention

Step 12 supports interactions with:

- product-specific presentation;
- category-specific imagery/information/trust/delivery sensitivity;
- price-confidence pressure;
- promotion expectation and coupon flow;
- Step 9 inventory/availability;
- Step 11 retention state when enabled.

Persistent retention damage is not automatic. A scenario must explicitly configure `futureAffinityImpact`, and it is applied only when the Step 11 retention sidecar is active and a sufficiently severe checkout failure is realized.

## Evaluator-only CRO interventions

Step 12 reuses the frozen generic `Intervention` contract for simulator/evaluator interventions while keeping website-variable validation inside Step 12 because earlier frozen causal graphs do not contain website nodes.

Supported intervention targets include:

- mobile PDP latency;
- PDP imagery;
- PDP information completeness;
- PDP delivery clarity;
- search relevance / search defect repair;
- collection ranking;
- cart coupon reliability;
- cart shipping visibility;
- checkout form/mobile usability;
- checkout address/payment reliability;
- checkout defect repair;
- shipping-cost visibility.

These are simulator interventions, not the separate Growth Operator business Action ontology.

## Shared-randomness counterfactuals

`replayCroIntervention` runs factual and counterfactual worlds with the same:

- merchant;
- latent population;
- simulation seed;
- demand;
- marketing interventions;
- products;
- inventory;
- pricing/promotion;
- event-keyed randomness.

Only the website intervention differs.

Reported counterfactual deltas include:

- sessions progressing to product;
- add-to-carts;
- checkout starts;
- represented orders;
- represented revenue;
- represented contribution profit.

## Observational funnel diagnostics

`funnelDiagnostics` is observational. It reports:

- visits;
- landing continuation;
- collection engagement;
- search attempts and success;
- PDP views;
- PDP → ATC;
- ATC → checkout;
- checkout → purchase;
- weighted abandonment by stage;
- device;
- channel;
- product;
- category when merchant-world metadata is supplied.

These diagnostics do not claim that the visually weakest metric is the highest-value causal opportunity.

## Causal opportunity value

CRO value is computed from shared-randomness intervention replay:

`CRO intervention → incremental contribution`

not:

`weak funnel metric → assumed opportunity`.

The evaluator can compare the economic contribution of individual CRO fixes without defining an Opportunity Engine ranking.

## Deterministic acceptance traps

Step 12 includes deterministic fixtures/tests for:

1. poor collection sorting hiding strong latent demand;
2. bad search despite healthy traffic, intent and inventory;
3. slow mobile PDP with comparable customer quality;
4. the opposite device-neutral traffic-quality control;
5. broken coupon functionality;
6. late shipping surprise;
7. a dated checkout regression with a simultaneous marketing-mix change;
8. channel blame caused by a mobile defect rather than channel-quality deterioration;
9. the visually worst funnel rate not being the highest-value causal fix;
10. traffic-vs-CRO sequencing: a website bottleneck makes added traffic inferior to fixing the site first, after which marginal traffic can become attractive again.

## Information boundary

`src/website_cro` is evaluator/God-mode research infrastructure.

The dependency-cruiser boundary forbids Operator-facing modules and the root package entrypoint from importing website/CRO internals. The public package subpath `./website-cro` is an explicit evaluator/research surface.

## Validation

The Step 12 workflow runs, in order:

1. architecture boundary validation;
2. strict TypeScript typecheck;
3. focused Step 12 tests;
4. the full inherited test suite;
5. build.

A separate acceptance report records exact-head results once the final Step 12 head is green.
