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

This is the Step 12 CRO-saturation behavior. The current acceptance contract is the complete 21-section simulated-ecommerce-website specification; no older truncated-draft boundary is used for freeze acceptance.

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
- pagination/load-more reach;
- product density;
- relevance;
- availability visibility.

Product discovery is not uniform. Product-level presentation can change collection visibility independently of latent demand. Pagination/load-more is modeled as a browsing-depth reach mechanism: poor load-more usability disproportionately suppresses products buried deeper in the collection rather than applying a global conversion penalty.

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

Coupon behavior is customer- and promotion-dependent. The simulator distinguishes coupon search, an invalid code when no valid coupon is available, and a genuine functionality defect where a valid expected coupon fails. Either failure can reduce checkout completion but does not deterministically force abandonment.

When a Step 10 pricing/promotion scenario is present, active `coupon` mechanics determine whether a valid coupon is available at checkout; general promotions can still induce coupon searching without being treated as valid coupon truth.

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

The evaluator preserves typed contact, shipping, payment and review stage qualities. A weak stage emits a distinct God-mode causal friction label, so stage-specific defects are not collapsed into a single hidden checkout-quality number. Completion still uses a minimum causal abstraction rather than recreating a real checkout UI.

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
- represented contribution profit;
- optional God-mode oracle future realized contribution after an explicit `futureValueAsOf` cutoff.

The future-value field is deliberately distinct from expected CLV. It is populated only when the evaluator requests an in-horizon cutoff satisfying `startTime < futureValueAsOf < endTime`, and it measures same-seed realized contribution after that cutoff.

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


## Canonical model identity, schema and fingerprint

The canonical website simulation layer is identified by:

- model: `website_model_v1`;
- schema version: `1`;
- implementation contract: `WEBSITE_CRO_VERSION = 12.0.0`.

`serializeWebsiteScenario` produces a stable machine-readable representation with canonical object-key ordering while preserving semantically meaningful array order. `websiteScenarioFingerprint` hashes that representation. When Step 12 is enabled, the model version, schema version and scenario fingerprint are written both to evaluator-only website truth and to simulation provenance. When Step 12 is omitted, those provenance fields are absent so the frozen Step 1–11 output path remains unchanged.

## Canonical healthy defaults and defect scenarios

`healthyWebsiteState()` is the canonical healthy baseline. It contains no intentionally injected CRO defect.

The frozen Step 12 fixture set includes:

- healthy website;
- slow mobile PDP;
- poor checkout;
- bad search;
- weak product imagery;
- shipping surprise;
- broken coupon;
- poor collection sorting;
- multiple simultaneous CRO issues;
- subtle mobile checkout drag.

The subtle fixture deliberately combines stronger upstream merchandising with moderate mobile-checkout deterioration. The dated checkout-regression acceptance test additionally combines a checkout regression with a simultaneous marketing-mix change, so diagnosis cannot be reduced to a single obvious topline movement.

Scenario helpers configure underlying parameters. They are not binary defect flags.

## Observable website evidence

Observable journey data remains distinct from hidden causal truth.

Step 12 can emit website-relevant observations including:

- visits, landing views, collection views and searches;
- zero-result and reformulation search events;
- PDP views;
- cart views and add-to-cart events;
- checkout starts and checkout-stage events;
- coupon search/attempt/invalid/error events;
- shipping-cost reveal events;
- payment and address-validation failures;
- purchases and checkout abandonment;
- `page_performance` measurements with component, device and measured page-load time.

Page-load observations are deterministic under the simulation seed but include measurement noise. The observable event therefore does not copy the hidden configured latency value verbatim.

Fields such as root cause, hidden-defect flags, causal probability multipliers, causal friction labels, website scenario ID and component-version truth are not included in Operator-visible event payloads. Those remain in evaluator/God-mode records.

## Parameter definitions, units and ranges

The canonical parameter contract is:

| Area | Parameters | Units / range |
| --- | --- | --- |
| Component identity | `componentVersion` | non-empty version string |
| Website state | `versionId`, `deployedAt` | non-empty version string; ISO timestamp |
| Performance | `latencyMs`, `interactionDelayMs` | milliseconds, >= 0 |
| Performance | `loadSuccessProbability`, `responsiveness` | [0, 1] |
| Performance | `assetWeightProxy` | non-negative dimensionless proxy |
| Homepage | discovery, merchandising, navigation, promotion, visibility | [0, 1] |
| Navigation | discoverability, hierarchy, path efficiency, mobile menu usability | [0, 1] |
| Collection | ranking, filtering, sorting, load-more, density, relevance, availability visibility | [0, 1] |
| Search | entry propensity, relevance, synonym coverage, zero-result probability, reformulation, alternative discovery | [0, 1] |
| PDP | imagery, information, price/variant/inventory/delivery clarity, trust, social proof, CTA, price-confidence sensitivity | [0, 1] |
| Cart | clarity, shipping/promotion visibility, coupon reliability/expectation, cross-sell relevance, quantity editing, persistence | [0, 1] |
| Checkout | stage/form/mobile usability, account friction, address/payment reliability, excessive steps, future-affinity impact | [0, 1] |
| Checkout | shipping-cost visibility | `pdp`, `cart`, `checkout_shipping`, or `checkout_review` |
| Product presentation overrides | collection visibility, searchability, imagery, information, delivery clarity | [0, 1] when supplied |
| Category sensitivity | imagery, information, trust, delivery importance | [0, 1] |

Device-specific performance is represented separately for mobile, desktop and tablet. Mobile and desktop therefore never share a mandatory global website-performance value.

## Behavioral mappings and interactions

Website parameters change transition probabilities rather than dictating outcomes. The causal mapping is explicit:

- homepage/navigation quality affects landing continuation, browsing and search fallback;
- collection quality and depth affect product discoverability and collection-to-PDP progression;
- search relevance/synonyms/zero-result behavior affect search-to-PDP progression, reformulation and exit;
- PDP performance/content/imagery affect PDP continuation and add-to-cart probability;
- cart quality, cross-sell and shipping/coupon visibility affect cart-to-checkout progression;
- checkout stage quality, reliability, steps, shipping surprise and coupon behavior affect checkout completion.

The mappings interact with customer intent/need/brand affinity, device, product presentation, category sensitivities, product price, promotion state, shipping burden, inventory/availability, channel/device mix and retention state where those sidecars are enabled. These interactions are explicit and testable rather than globally independent multipliers.

## Intervention integration points

Step 12 does not add new Growth Operator Action Ontology entries. It reuses the frozen generic simulator `Intervention` boundary and validates website targets inside the website layer.

Integration targets include page speed, collection ranking, search repair, PDP imagery/content/delivery clarity, coupon reliability, shipping visibility, checkout usability/reliability and shipping-cost disclosure timing. This is the bridge a later canonical Action translator can use without changing the frozen Action ontology here.

## Known simplifications

This layer simulates ecommerce website behavior, not browser rendering. It does not recreate DOM layout, CSS, network waterfalls, real search NLP, payment processors or a live checkout UI. Page performance and UX are causal abstractions calibrated to create realistic noisy evidence and intervention response while preserving reproducibility and evaluator truth.
