# Phase 2 — Action Space
## Step 7 — Merchandising Actions

## Governing principle

Merchandising is structured business language for onsite visibility, ordering and directional product relationships. It is not prose saying to feature something, and it does not mutate product availability, paid-media spend, regular price or promotion state.

Step 7 advances Action schema to 1.5.0 while preserving genuine 1.0/1.1/1.2/1.3/1.4 Actions.

## Action family

New canonical Actions include merchandising.feature, merchandising.deprioritize, merchandising.set_rank, merchandising.promote_substitute, merchandising.set_cross_sell, merchandising.set_upsell, merchandising.remove_placement, merchandising.remove_relationship and merchandising.rollback_rank.

## Surfaces

Canonical surfaces include COLLECTION_PAGE, CATEGORY_PAGE, SEARCH_RESULTS, HOMEPAGE, PRODUCT_PAGE, CART, CHECKOUT, POST_PURCHASE, RECOMMENDATION_SLOT and CUSTOM. Surface identity is explicit and separate from the featured/ranked entity.

## Feature and deprioritize

Feature Actions carry stable merchplace_* placement identity plus explicit POSITION or NAMED_SLOT placement. Deprioritization is a visibility decision and remains distinct from product deletion, unavailability and paid-media pause.

## Ranking

Ranking is one-based. Position 0 and negative ranks are invalid. SET, DELTA and MOVE_TO_TOP are distinct business semantics. Relative DELTA requires an explicit ranking snapshot reference. Displacement is canonical SHIFT_OTHERS, so moving D to position 2 shifts B/C rather than replacing, duplicating or deleting them.

## Ranking snapshots

Frozen snapshots preserve surface/container, ordered entity IDs, evaluation boundary, timestamp and provenance. Relative rank resolution and historical replay use the exact bindingRef rather than current storefront ordering.

## Relationships

SUBSTITUTE, CROSS_SELL and UPSELL remain separate directional merchandising relationships. Source and destination are explicit; A→B never implies B→A. Ordered one-to-many recommendation sets preserve target positions and surface capacity.

Creating or removing a promoted substitute/cross-sell/upsell does not mutate underlying Step 8 substitution/complement knowledge.

## Conditions and economics

Existing constraints/preconditions support current inventory gates and precise economics such as inventory.available_units, finance.contribution_per_unit_minor and contribution margin metrics. Missing evidence remains tri-state unknown rather than being guessed.

## Temporary merchandising and rollback

Temporary rank changes require conflict-safe rollback metadata. RESTORE_PRE_ACTION_VALUE references a frozen pre-action ranking snapshot; SET_EXPLICIT_VALUE may specify a rank directly. REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT prevents expiry of Action A from overwriting a later legitimate rank Action B.

## Concurrency and capacity

Placement/rank conflicts are detected by surface and slot/position. PRECEDENCE or MUTUALLY_EXCLUSIVE_GROUP may resolve them; otherwise same exclusive placement is AMBIGUOUS. Known surface capacity is enforced. Missing capacity produces unknown eligibility rather than invented capacity.

## Personalization and search boundary

Actions may use canonical customer-segment scope, but Step 7 does not create customer-level predicted placements. SEARCH_RESULTS requires a canonical searchScopeId; query understanding, semantic search, learning-to-rank and personalized search are not built.

## Translation context

TranslationContext advances to 1.3.0 with optional merchandisingRankingSnapshots and merchandisingSurfaceDefinitions. These contain only current mechanical context such as ordered entities, surface capacity and named slots. Future demand, conversion, inventory, revenue, oracle relationships and evaluator results are forbidden.

## Conservative Step 2 translation

The existing legacy merchandising_position intervention cannot preserve the rigorous Step 7 surface/container, displacement, relationship, removal and rollback semantics. New Step 7 Actions therefore return UNSUPPORTED_SIMULATOR_CAPABILITY. They are never approximated through demand, conversion propensity, advertising spend, availability or price mutations. The inherited legacy merchandising.move_product translator remains unchanged for backward compatibility.

## Fixtures

Fixtures cover homepage product/collection features; deprioritization; absolute and relative collection ranking; snapshot-bound moves; substitute promotion; out-of-stock substitute trigger; one-to-one and ordered one-to-many cross-sells; upsell; inventory/contribution constraints; temporary rank with rollback; stale rollback conflict; same-slot homepage conflict; capacity overflow; missing ranking snapshot; explicit placement and relationship removal; and unsupported simulator translation.

## Information boundary

Merchandising rejects embedded expectedCTR, expected conversion/revenue/profit/units, predicted demand/purchase probability/cross-sell/upsell rate, future demand/conversion/inventory/revenue, counterfactual revenue, recommendationScore and confidenceScore.

## Non-scope

No merchandising optimizer, recommendation ranking, personalization engine, search relevance/query understanding, demand forecasting, Shopify execution, storefront rendering engine or Growth Operator decision policy is built.