# Step 3.6 — Simple Pricing and Promotion Heuristic Baselines

## Purpose

Step 3.6 adds four intentionally simple commercial benchmark operators:

1. `NEVER_DISCOUNT`
2. `FIXED_DISCOUNT`
3. `EXCESS_INVENTORY_DISCOUNT`
4. `FIXED_PROMOTIONAL_CALENDAR`

They are deterministic benchmark rules, not optimizers.

Frozen lineage:

- Step 3.5 parent: `cc6c07d0b1ec152e3548d5b306c0ee7debed6aa3`
- Step 3.1 contract: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`
- simulator: `customer-journey-simulator-4.0.0`

No prior baseline, evaluation contract, metric, simulator semantic or ontology is changed.

## Observable state

Frozen observation key:

`pricing_promotion.sku_state.v1`

The governed operator may use only current observable SKU state:

- current price;
- regular/reference price;
- current discount depth and owner;
- current observable inventory;
- product/SKU eligibility;
- active promotion IDs;
- promotion ownership;
- active heuristic rule IDs and observable start times;
- decision time from the canonical operator input.

No future demand, revenue, conversion, inventory, elasticity, GroundTruth, counterfactuals or evaluator-only metrics are exposed.

Missing required information fails closed to no new discretionary Action.

## NEVER_DISCOUNT

Operator:

`baseline.pricing.never_discount`

Frozen semantics:

- discretionary discount target = 0%;
- applicable SKU: `sku:A`;
- pre-existing merchant-discretionary or heuristic-owned discount:
  restore regular price at first valid opportunity;
- environment-owned and STATUS_QUO-owned discounts:
  preserve owner and do not interfere;
- restoration uses an explicit price SET to the observed regular price;
- repeated opportunities after restoration emit nothing.

The rule never reacts to performance.

## FIXED_DISCOUNT

Operator:

`baseline.pricing.fixed_discount`

Frozen configuration:

- rule ID: `heuristic.fixed_discount.sku_a.v1`;
- applicable SKU: `sku:A`;
- discount: 10%;
- start: `2026-10-03T00:00:00.000Z`;
- duration: 7 days;
- start condition: at/after start, before end, only when not already applied;
- stacking: do not stack with active non-heuristic discount/promotion;
- restoration: explicit SET to the observed regular price at/after end;
- price rounding: floor to minor units.

For the representative CAD 899 regular price, the frozen 10% price is CAD 809.10.

Restoration never multiplies the current price and therefore cannot drift.

## EXCESS_INVENTORY_DISCOUNT

Operator:

`baseline.pricing.excess_inventory_discount`

Frozen configuration:

- rule ID: `heuristic.excess_inventory_discount.sku_a.v1`;
- applicable SKU: `sku:A`;
- trigger: observable inventory strictly greater than 100 units;
- fixed discount: 15%;
- restoration threshold: inventory at or below 80 units;
- minimum promotion duration: 2 days;
- stacking: no active non-heuristic commercial conflict;
- restoration: explicit SET to observed regular price.

The hysteresis band is deliberate:

- inactive at 100 or below;
- start above 100;
- once active, remain active above 80;
- restore at 80 or below after minimum duration.

No sell-through, days-of-supply, demand, margin or optimal-markdown estimate is calculated.

## FIXED_PROMOTIONAL_CALENDAR

Operator:

`baseline.promotion.fixed_promotional_calendar`

Calendar semantics:

- timezone: UTC;
- start only at exact configured start;
- temporary canonical `promotion.start` Actions;
- fixed-duration expiry;
- direct SKU scope;
- automatic discount;
- all-customer eligibility;
- stackable;
- conflict resolution: none;
- regular price is never mutated, so expiry reveals the unchanged regular price.

Frozen entries:

1. `calendar.fall_a`
   - promotion: `promo_heuristic_calendar_fall_a_v1`
   - SKU A
   - 10%
   - 2026-10-05 00:00 UTC → 2026-10-09 00:00 UTC

2. `calendar.overlap_b`
   - promotion: `promo_heuristic_calendar_overlap_b_v1`
   - SKU A
   - 15%
   - 2026-10-07 00:00 UTC → 2026-10-11 00:00 UTC

The overlap is intentional and preregistered. The two configured entries may stack.

If the same promotion ID is already active and heuristic-owned, duplicate execution is suppressed. If the same ID is owned by environment/STATUS_QUO/another source, the operator preserves that owner and skips the entry.

Invalid/empty calendar configurations are rejected before evaluation.

## Ownership

Commercial ownership is explicit.

Observed discounts/promotions identify one owner:

- environment;
- STATUS_QUO;
- merchant discretionary;
- heuristic.

The heuristic never double-applies a promotion already owned elsewhere.

Price-based heuristic restoration is allowed only while the observed discount remains heuristic-owned. A later ownership conflict fails closed rather than overwriting another policy.

## Canonical Actions

Price rules emit only:

`pricing.adjust_price`

with explicit `SET` regular/discounted prices.

Calendar entries emit only:

`promotion.start`

with explicit direct-SKU promotion definitions, duration and termination.

No heuristic-specific Action type exists.

All proposals continue through the frozen Step 3.1 Action-space and generic business-constraint path.

## Constraint semantics

The suite does not silently repair an invalid price/promotion.

Tests cover:

- legal price bounds;
- accepted proposals;
- rejected proposals;
- explicit PARTIALLY_FEASIBLE modified price Actions.

A modified action exists only when the evaluator explicitly records it.

## Simulator compatibility

The selected Step 3.6 action shapes are supported by the frozen translation boundary:

- direct SKU `pricing.adjust_price` SET → translated price intervention;
- direct SKU, automatic, stackable `promotion.start` → translated temporary promotion intervention;
- fixed Action duration/end condition is preserved in the simulator intervention.

The calendar deliberately does not require unsupported `promotion.stop` or `promotion.modify`.

## Decision audit

Every invocation records deterministic rule execution including:

- current and regular price;
- current discount depth;
- current discount owner;
- observable inventory used;
- configured inventory threshold;
- configured discount;
- promotion eligibility;
- promotion ownership;
- calendar state;
- rule evaluation;
- proposed Action IDs;
- restoration Action IDs;
- fallback reason;
- simulator compatibility;
- exact operator/configuration/dependency identities.

## Anti-optimization boundary

The implementation contains no:

- price optimization;
- promotion optimization;
- elasticity estimation;
- demand/revenue forecasting;
- margin optimization;
- CLV optimization;
- causal lift/incrementality;
- reinforcement learning;
- bandits;
- learned policies;
- competitor-price optimization.

Adversarial tests add signals suggesting a different discount would be commercially superior. The frozen output remains unchanged.

## Paired comparison

Step 3.6 operators reuse the exact Step 3.1 comparison binding.

Tests verify equivalent comparison-critical bindings against:

- DO_NOTHING;
- STATUS_QUO;
- Step 3.4 equal-budget allocation;
- Step 3.5 fixed reorder threshold;
- all Step 3.6 operators.

World, price/inventory starting state, shared environmental seeds, cadence, Action space, constraints, horizon and metric definitions remain comparison-controlled.

## Evaluation artifacts

Every Step 3.6 operator has a deterministic 90-opportunity artifact fixture using the normal generic evaluator.

Artifacts preserve:

- evaluation-contract identity;
- operator identity/fingerprint;
- configuration/fingerprint;
- Action Ontology;
- simulator;
- world;
- metric set;
- currency;
- seeds;
- pricing observations;
- inventory observations used;
- calendar state;
- rule audit;
- proposed/validated/executed Actions;
- restoration Actions;
- outcome summary;
- all canonical metric slots.

These synthetic fixtures validate contract/provenance shape rather than preregistering favorable benchmark outcomes.

## Freeze discipline

Discount levels, thresholds, populations, calendar dates, durations, restoration behavior, stacking/conflict semantics, ownership and missing-data policy are frozen before benchmark outcome evaluation.

Future substantive changes require new versions/fingerprints.
