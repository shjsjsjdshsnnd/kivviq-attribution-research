# Phase 2 — Action Space
## Step 9 — CRO Actions

## Governing principle

**A CRO Action describes what aspect of the customer experience is deliberately changed, where it is changed, and for whom—not the concrete creative variant, predicted outcome or experiment result.**

Step 9 advances canonical Action schema to `1.7.0` while preserving genuine 1.0–1.6 Actions.

## Canonical action family

The rigorous CRO family supports:

- `cro.modify_experience`
- `cro.add_element`
- `cro.remove_element`
- `cro.reorder_elements`
- `cro.modify_interaction`
- `cro.modify_navigation`
- `cro.modify_search`
- `cro.modify_checkout`
- `cro.rollback_experience`

Legacy `cro.change_page` remains readable for backward compatibility.

## Surface, component, intervention and variant separation

Every CRO intervention carries typed surface, component, intervention, page/template scope, device, audience, modifiable dimensions, capabilities, conflict semantics and timing. Concrete implementation variants remain outside the Action.

Canonical surfaces cover SITE_WIDE navigation, HOMEPAGE, COLLECTION, PDP, CART, CHECKOUT, SITE_SEARCH and LANDING_PAGE. Device is separate: ALL_DEVICES, MOBILE or DESKTOP.

Canonical component taxonomy covers homepage, collection, PDP, cart, checkout, search and landing-page components plus PAGE_LAYOUT. Surface/component compatibility is validated.

## Generic interventions

Intervention kinds are ADD, REMOVE, REORDER, MODIFY_PRESENTATION, MODIFY_INTERACTION, MODIFY_NAVIGATION, MODIFY_SEARCH, MODIFY_CHECKOUT and MODIFY_PERFORMANCE.

ADD requires explicit existence/coexistence semantics. REMOVE/MODIFY/REORDER require current-state presence at eligibility time. ADD is never silently reinterpreted as MODIFY.

## Page/template and audience scope

Typed page scope includes ALL_SURFACE, ALL_PDP, ALL_COLLECTIONS, PRODUCT_PDP, CATEGORY_PDP_SET, PAGE_TEMPLATE, SPECIFIC_PAGE and LANDING_PAGE.

Audience is typed as ALL_VISITORS, NEW_VISITORS, RETURNING_VISITORS or CUSTOMER_SEGMENT with explicit membership-boundary semantics. No customer-level personalization is created.

## Ordering and structure snapshots

Ordering uses SET_POSITION or relational PLACE_BEFORE / PLACE_AFTER. Relational ordering requires a frozen structure binding with surface, page/template identity, device, ordered component identities, evaluation boundary, timestamp and provenance.

Historical replay therefore never interprets a relational placement against a different future page structure.

## Variant-ready dimensions

Actions expose typed modifiable dimensions such as POSITION, PROMINENCE, CONTENT_STRUCTURE, INTERACTION, LAYOUT, DENSITY, REQUIRED_FIELDS, STEP_STRUCTURE, ERROR_PRESENTATION, PAYMENT_PRESENTATION, PROGRESS_COMMUNICATION, INFORMATION_HIERARCHY, LOAD_PERFORMANCE, INTERACTION_LATENCY and IMAGE_LOADING.

Future variant bindings reuse those typed dimensions. There is no unrestricted `variantPayload` field.

## Experiment boundary

CRO Actions are not experiments. Traffic allocation, randomization unit, significance threshold, experiment result and other experiment-design fields are forbidden from canonical CRO Actions. Step 1 RUN_EXPERIMENT remains separate.

## Timing and rollback

CRO uses canonical decision time, requested start, effective time, implementation delay, duration and termination. Temporary CRO interventions require an available `croRollback` contract.

Rollback supports RESTORE_PRE_ACTION_VALUE using a state snapshot or SET_EXPLICIT_VALUE using an explicit state reference. REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT prevents an expiring temporary Action from overwriting a later legitimate experience change.

## Conflicts

Page-structure conflicts are detectable by surface/page/device plus placement coordinate. PRECEDENCE or MUTUALLY_EXCLUSIVE_GROUP can resolve a conflict; otherwise incompatible placements remain AMBIGUOUS.

## Current-state capability and existence context

Operator-safe CRO eligibility consumes only current page structure, current component existence, declared surface capabilities, current performance configuration, current audience membership bindings and hard-constraint results.

It preserves eligible / ineligible / unknown. Missing page context, structure snapshot, performance configuration or audience membership is never guessed.

## Performance and friction

Performance interventions use MODIFY_PERFORMANCE plus typed technical dimensions such as LOAD_PERFORMANCE, INTERACTION_LATENCY and IMAGE_LOADING without prescribing implementation.

Checkout friction is represented through structured CHECKOUT components and dimensions such as REQUIRED_FIELDS, STEP_STRUCTURE, ERROR_PRESENTATION, PAYMENT_PRESENTATION and PROGRESS_COMMUNICATION.

## Cross-family boundaries

CRO presentation remains separate from the underlying business policy:

- product rank/placement priority belongs to merchandising;
- product price belongs to pricing;
- free-shipping threshold/economics belongs to shipping;
- coupon validity/depth/eligibility belongs to promotion.

Showing a free-shipping threshold message is CRO. Setting that threshold is shipping.

Changing coupon-entry/error presentation is CRO. Changing discount depth or promotion eligibility is promotion.

## Measurement

All CRO Actions continue to use the canonical measurement-horizon contract with earliest meaningful observation, primary evaluation horizon, optional longer-term follow-up and metric identities.

Outcome families now also include engagement and experience_performance for relevant CRO metrics. Expected metric changes never belong inside the Action.

## TranslationContext

TranslationContext advances to `1.5.0` with optional `croStructureSnapshots` and `croExperienceBindings`. These may contain current page/template structure, component ordering/existence, device context, surface capabilities, current component-state references and current performance configuration.

Future conversion, sessions, orders, predicted revenue, counterfactual outcomes, evaluator/oracle/GroundTruth information, experiment allocation/result fields and variant payloads are rejected.

## Conservative Step 2 translation

The current simulator has no native PageComponentIntervention, PageOrderingIntervention, InteractionIntervention, SitePerformanceIntervention, SearchExperienceIntervention or CheckoutExperienceIntervention.

Every new Step 9 CRO Action therefore returns `UNSUPPORTED_SIMULATOR_CAPABILITY`. CRO is never approximated by mutating conversion propensity, purchase probability, revenue or demand.

## Canonical fixtures

Fixtures cover homepage hero, featured collection add, collection product-card/filters/grid density, PDP gallery/ATC/delivery/returns/price presentation, cart layout/shipping/promotion messaging, checkout form/field/progress/errors, search autocomplete/no-results, landing CTA/navigation, mobile navigation, desktop homepage, mobile performance, all-PDP vs Product-A-PDP scope, customer segment audience, absolute and relational ordering, temporary reorder/rollback, missing component/context and page-structure conflicts.

## Non-scope

No experiment engine, A/B framework, variant generator, CRO optimizer, personalization engine, frontend renderer, recommendation ranking, search relevance/LTR, statistical evaluator, Shopify execution, DOM selector schema or Growth Operator decision policy is built.