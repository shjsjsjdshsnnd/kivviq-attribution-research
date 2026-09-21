# Phase 2 — Action Space
## Step 4 — Pricing Actions

## Governing principle

**Price changes are canonical business interventions with explicit target, operation, timing, economic constraints and rollback semantics. They are not arbitrary mutations of simulator price fields.**

Step 4 does not optimize prices, estimate elasticity, predict demand/revenue, implement promotions, execute Shopify changes or rank pricing decisions.

## Schema version

Step 4 advances the canonical Action schema to 1.2.0.

Readers continue to accept 1.0.0 (Step 1), 1.1.0 (Step 3 paid media), and 1.2.0 pricing semantics. Historical Step 1 fixtures remain pinned to 1.0 and Step 3 paid-media fixtures remain pinned to 1.1. New pricing fixtures emit 1.2. A 1.2-only feature cannot be mislabeled as an older schema.

## Canonical pricing targets

pricing.adjust_price supports SKU, product, category and collection. SKU is the atomic business pricing target. Product, category and collection remain one merchant decision even when a simulator expands them into multiple SKU interventions. Category and collection remain separate canonical target types.

## Price operations

Pricing reuses SET, DELTA and MULTIPLY. Operations retain explicit currency and minor units. Validation rejects negative price money, missing/invalid currency, DELTA currency mismatch and explicit decreases larger than the baseline. No currency conversion is implicit.

## Relative baselines

DELTA and MULTIPLY retain Step 1 reference semantics. SKU baseline data may come from an explicit Action baseline or approved decision-time TranslationContext binding. If unavailable, translation returns MISSING_CONTEXT. Future simulator state, GroundTruth and oracle information are forbidden.

## Membership semantics

Product/category/collection pricing in schema 1.2 requires PricingMembershipSemantics. The Action declares whether membership is evaluated at decision_time, translation_time or effective_time, and may pin a stable bindingRef.

TranslationContext 1.1 adds optional pricing membership bindings containing the canonical target, boundary, bindingRef, snapshot timestamp/source, SKU members, simulator SKU targets and each SKU price at the boundary.

Generated interventions retain originating Action ID, translation version, member index, membership sourceRef, membership bindingRef, membership boundary and membership snapshot time. Historical replay therefore uses the frozen binding rather than later collection membership.

## Timing and duration

Pricing retains decision time, requested start, effective time and implementation delay. A decision made September 20 may become effective October 1. Persistent and temporary price changes remain semantically distinct.

Temporary pricing requires explicit duration/end semantics and an available conflict-protected pricing rollback contract.

## Safe rollback

Pricing rollback distinguishes RESTORE_PRE_ACTION_VALUE and SET_EXPLICIT_VALUE.

RESTORE_PRE_ACTION_VALUE can refer to a single pre-action price or a frozen pre-action membership pricing snapshot. Rollback metadata includes availability, target, strategy, trigger, delay, cost/unknown cost and conflict guard.

The mandatory guard is REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT. For SKU pricing it checks the current price still matches the original Action output. For expanded pricing it checks a membership pricing-state reference.

evaluatePricingRollbackReadiness returns READY, CONFLICT, MISSING_CONTEXT or INVALID_ACTION and never executes the rollback.

Example: if temporary Action A set SKU A from 899 to 799, then independent Action B later sets it to 849, Action A rollback returns CONFLICT rather than restoring 899 over Action B.

pricing.rollback_price is itself canonical business language and must reference the original Action consistently through originalActionId and reversalOfActionId. Normal simulator translation deliberately does not execute it yet.

## Margin constraints

Pricing uses the existing constraint/precondition system and preserves precise metric identity: finance.gross_margin_rate, finance.gross_margin_per_unit_minor, finance.contribution_margin_rate and finance.contribution_per_unit_minor. No ambiguous profitability/minimumMargin field is introduced.

Missing COGS or contribution inputs remain an eligibility information gap and can produce the existing tri-state unknown result rather than a guessed value.

## Pricing versus promotion

pricing.adjust_price changes regular price. promotion.apply_discount is a promotion. They remain different Action types, parameters, fingerprints and serialization even when checkout prices could look similar.

## Step 2 translation

SKU price Actions translate one-to-one when simulator price capability, target mapping and required baseline are available. SET, DELTA and MULTIPLY are preserved.

Product/category/collection Actions translate only with deterministic membership binding and valid snapshot timing. One business Action may produce multiple SKU interventions. If membership or capability is unavailable, translation returns an explicit missing/unsupported result.

Rollback is not automatically translated; conflict readiness must be evaluated first.

## Information leakage

Pricing Actions reject expectedDemand, expectedUnitsSold, expectedRevenue, expectedProfit, expectedContribution, predictedElasticity, predictedLift, futureDemand, futureMargin, counterfactualRevenue, recommendationScore and confidenceScore.

## Representative fixtures

Fixtures cover SKU SET CAD 849; SKU +CAD 50; SKU -10%; Product +5%; Category -10%; Collection -15%; future-effective October 1 price; temporary SKU/collection pricing; restore and explicit rollback strategies; rollback conflict; gross/contribution margin floors; missing-baseline translation; membership expansion/replay; invalid negative price; and invalid missing currency.

## Architecture boundary

The pricing business module may depend on canonical Action contracts only. Dependency-cruiser blocks pricing from action-translation implementation, simulator contracts/internals, Step 8 product-economics God-mode modules, GroundTruth and evaluator/oracle modules. Approved current information enters only through eligibility/constraint or TranslationContext contracts.

## Non-scope

No price optimization, elasticity estimation, dynamic pricing, promotion logic, recommendation ranking, Shopify/provider execution, Growth Operator decision policy or outcome prediction is built in Step 4.
