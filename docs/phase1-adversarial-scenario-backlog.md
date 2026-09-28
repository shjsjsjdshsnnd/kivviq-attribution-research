# Adversarial scenario library — implementation backlog

Status: **proposed recipes, not verified executable scenarios**. None of the rows below counts toward the Phase 1 target of at least 20 verified adversarial scenarios. The existing simulator has individual domain traps; those must be reused and verified through the three-level measurement boundary before registration in the new integrated library. The CLI `measurement-control`/`9274` is a pipeline control, not one of these traps.

The numbers in requested examples (11x ROAS, +31% revenue/-8% contribution, four days of stock) are target fixture predicates, not measured results from this branch.

## Registration requirements

A registered executable scenario must have a stable opaque ID, version, world builder, independently fixed seed sets, complete feasible action catalog, observation window, decision/evaluation horizon, measurement configuration, explicit true economic ledger and an evaluator-only verifier. The verifier must check both the misleading observable pattern and the actual counterfactual mechanism. A descriptive title, parameter flag or second random seed is not a second scenario.

The Operator must never receive this catalog's labels, mechanism description, difficulty, parameters, verification results or correct action. It receives corrupted observations and a merchant-action interface with neutral action IDs. Development scenarios must not be used as sealed evaluation cases. Variations derived from the same mechanism belong to that scenario family, not inflated independent counts.

## Proposed distinct recipes

| Proposed ID | Misleading observed pattern / tempting decision | Evaluator-only causal predicate required | Observation / evaluation horizon |
| --- | --- | --- | --- |
| adv-001 | Meta retargeting has excellent measured return; increase its budget | Retargeting selects high-intent customers; most attributed buyers purchase in the same-seed paid-off replay; marginal contribution from added spend is near zero or negative | 30 days / 90 days |
| adv-002 | Google reports about 11x ROAS; expand branded-search spend | Most credit is captured branded demand; response is saturated and extra budget produces negligible incremental contribution despite high reported ROAS | 30 days / 90 days |
| adv-003 | Sitewide discount lifts revenue about 31%; repeat the promotion | Discounts, COGS, returns and implementation costs reconcile to contribution about 8% below no-discount control; both signs and specified ranges hold on the registered seed set | 30 days / 90 days |
| adv-004 | A campaign's conversion rate and margin justify scaling | Actual sellable stock has about four days of cover at baseline demand; added demand is constrained by stock and delayed replenishment; no impossible sales | 14 days / 60 days |
| adv-005 | Overall CVR declines; reverse a site change | Every preregistered meaningful segment improves while mix shifts toward lower-baseline-CVR segments; pooled reversal is mathematically reconciled without omitted segments | 30+30 days / 30 days |
| adv-006 | Pinterest traffic and sales rise together; increase Pinterest | A shared seasonal factor raises both; disabling Pinterest's causal effect leaves the seasonal sales rise; the observed correlation alone does not identify action value | 60 days / 90 days |
| adv-007 | Cutting upper-funnel Meta improves near-term profit; keep it off | Shared-seed 30-day gain reverses by roughly 90 days because awareness, branded search and new-customer acquisition decay; delayed effects and spend are reconciled | 30 days / 180 days |
| adv-008 | Direct revenue rises while paid appears weaker; cut paid | UTM loss/direct fallback changes measurement only; identical latent/perfect outcomes under clean versus corrupted measurement; paid-off replay still has material causal loss | 30 days / 90 days |
| adv-009 | An acquisition channel shows no assisted conversions; remove it | Cross-device identity fragmentation hides earlier assists; the causal channel-off replay changes purchases despite absent stitched observed journeys | 30 days / 90 days |
| adv-010 | Cookie loss increases new-visitor counts and lowers apparent repeat rate; spend on acquisition | True customer identities/repeat purchases are unchanged; a clean-measurement control recovers retention; acquisition is not the remedy for the identity defect | 90 days / 180 days |
| adv-011 | A high-consent segment dominates measured results; scale to all customers | Consent-related selection differs by segment; observed segment return is not population return; replay across the full eligible population reveals the extrapolation error | 30 days / 90 days |
| adv-012 | Pixel purchases fall abruptly; undo a checkout change | A browser-source outage removes purchase events while server orders and perfect conversion are stable; the checkout intervention has no modeled negative causal effect | 7+7 days / 30 days |
| adv-013 | Recorded purchases jump after a release; increase spend | Duplicate receipts increase event counts but distinct order count, revenue and latent outcomes do not; deduplicated measurement reconciles | 7+7 days / 30 days |
| adv-014 | Yesterday's performance is poor; pause a campaign immediately | Conversion/reporting delays censor the latest cohort; mature equal-method windows and actual causal replay disagree with the naive latest-day ranking | 14 days with immature tail / 60 days |
| adv-015 | Summed Meta and Google claims exceed the store's sales; both deserve credit | Independent overlapping platform claims refer to the same purchases; store revenue remains a single order ledger and joint incremental value is not their sum | 30 days / 90 days |
| adv-016 | Channel sales improve after tracking changes; reward that channel | Incorrect channel classification reallocates observed credit while true/perfect world is identical; a classification-only counterfactual explains the apparent improvement | 30+30 days / 60 days |
| adv-017 | High-ROAS products dominate revenue; shift all spend to them | Product mix has unequal COGS/fulfillment/returns; maximizing revenue/ROAS ranks actions differently from reconciled contribution | 30 days / 120 days |
| adv-018 | A profitable sales spike supports a discount extension | Promotion pulls future demand forward; long-horizon incremental contribution is lower or negative after the post-promotion dip and stockpiling, without arbitrary KPI subtraction | 14 days / 180 days |
| adv-019 | A campaign's booked revenue is strong; increase spend before returns arrive | Its customers/products have larger delayed return liabilities; mature realized contribution reverses the booked-revenue ranking | 30 days / 180 days |
| adv-020 | Reorder based on normal lead times; keep acquisition unchanged | An external supplier problem extends actual replenishment time and creates an avoidable stock gap; inventory conservation and lead-time timing are independently verified | 30 days / 120 days |
| adv-021 | Acquisition quality appears to fall; replace creative | Shipping disruption increases costs, delivery delays and abandonment; the same creative with logistics restored outperforms a creative-only change | 14 days / 90 days |
| adv-022 | Channel efficiency falls while conversion remains stable; enlarge the budget to recover volume | Auction-cost inflation raises marginal acquisition cost under fixed demand; added spend has diminishing or negative marginal contribution after actual expenditure | 30 days / 90 days |
| adv-023 | A product's sudden organic success looks permanent; place a large order | A temporary external viral event decays; excess replenishment creates carrying/markdown costs rather than durable demand, with event timing hidden until observable | 14 days / 180 days |
| adv-024 | A high-value customer segment looks unprofitable on first purchase; stop acquiring it | Acquisition changes future repeat/LTV contribution; a short-horizon ranking reverses after observed repeat cycles, without leaking future purchases into the Operator input | 30 days / 365 days |

## Composition and difficulty

These recipes should first be implemented individually at the minimum appropriate level. Composite Level 6–7 cases combine independently verified mechanisms with explicitly registered interaction rules, not uncontrolled corruption of arbitrary numbers. Each composite needs its own joint causal predicate and held-out seed set.

Level 1 controls require genuinely deterministic mechanics, not merely a fixed seed for stochastic behavior. Level 2 introduces customer randomness; Level 3 adds confounding; Level 4 measurement corruption; Level 5 dynamic effects; Level 6 several misleading mechanisms; Level 7 their realistic combinations. The implemented graduation function can score preregistered results, but its existence does not establish that these worlds or graduation outcomes have been produced.

## Required checks before counting a scenario

1. The observable trap predicate holds on the declared observation window and measurement method.
2. True store revenue and contribution reconcile independently of platform claims.
3. The alleged mechanism survives its specific same-seed counterfactual test.
4. The action ranking uses a complete eligible set, actual spend, implementation costs and an appropriate horizon.
5. No future events, true identities, causal parameters or oracle scores reach the Operator payload.
6. The complete manifest reproduces all three output hashes.
7. The independent validation seed set has sufficient coverage; failed seeds are reported, not filtered away.

Only after these checks pass should a recipe become a verified scenario in an evidence-backed acceptance report. This document does not assign a pass to any recipe.
