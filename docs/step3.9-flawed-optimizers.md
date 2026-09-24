# Step 3.9 — Plausible but Flawed Optimization Baselines

## Purpose

Step 3.9 adds six deliberately narrow optimization benchmarks:

1. `MAX_ROAS`
2. `MIN_CAC`
3. `MAX_REVENUE`
4. `BEST_SELLER_PUSH`
5. `LOWEST_CPA`
6. `HIGHEST_CONVERSION_RATE`

These policies aggressively optimize a recognizable observable KPI while intentionally ignoring broader business value.

Frozen lineage:

- Step 3.8 parent: `5a461df3c962f22fbae9a1fcc5b4d39a3f1e5bae`
- Step 3.1 contract: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`
- ecommerce economics: `ecommerce-economics-7.0.0`
- product economics: `product-economics-8.0.0`
- simulator: `customer-journey-simulator-4.0.0`

No prior frozen baseline, contract, ontology, metric or simulator semantic is modified.

## Shared architecture

All six use the same canonical flow:

`permitted observation → legal finite candidate set → one frozen KPI → deterministic ranking → one canonical Action/no action → generic constraints → execution`

No operator receives a special evaluator path.

Every operator freezes:

- operator ID/version;
- objective KPI;
- direction;
- formula;
- scope;
- population;
- currency;
- 7-day trailing lookback;
- minimum evidence;
- legal action domains;
- finite parameter grid;
- no-action score;
- missing-data exclusion;
- deterministic tie-break;
- exact dependency fingerprints.

## Observation contract

Frozen key:

`flawed_optimizer.kpi_evidence.v1`

Frozen lookback:

`7 days ending exactly at decision time`

Permitted channel evidence:

- active state;
- current weekly budget;
- observed spend;
- attributed revenue;
- represented new customers;
- represented realized purchase-conversion events.

Permitted product evidence:

- active/available/eligibility;
- current price;
- recent realized units;
- observed revenue;
- realized units sold;
- represented conversions;
- observed product views;
- current merchandising position.

No GroundTruth, future outcome, counterfactual, latent customer value, hidden response curve or evaluator-only metric is supplied.

## Candidate generation

Shared bounded grid:

### Advertising

- `advertising.adjust_budget`
- +CAD 1,000/week
- up to 8 legal channel targets

Used by:

- MAX_ROAS
- MIN_CAC
- MAX_REVENUE
- LOWEST_CPA

### Pricing

- `pricing.adjust_price`
- -10%
- +5%

Used only by MAX_REVENUE.

### Promotions

- `promotion.start`
- 10% automatic direct-SKU seven-day templates for SKU A and SKU B

Used by:

- MAX_REVENUE
- BEST_SELLER_PUSH
- HIGHEST_CONVERSION_RATE

### Merchandising

- `merchandising.move_product`
- move eligible product to position 1

Used by:

- MAX_REVENUE
- BEST_SELLER_PUSH
- HIGHEST_CONVERSION_RATE

Maximum total candidates:

`64`

Stable enumeration uses Action-type order, canonical target key and parameter key.

## No action

Every operator includes canonical no action.

Ranking score:

`0`

This serves as deterministic fallback when no valid KPI candidate exists, and wins an exact zero-score tie.

## MAX_ROAS

Operator objective:

`maximize observed attributed ROAS`

Frozen formula:

`attributedRevenueMinor / observedSpendMinor`

Population:

`active legal advertising channels`

Minimum evidence:

- spend >= 1 minor unit;
- attributed revenue observed.

Candidate:

`+CAD 1,000/week advertising budget`

The candidate attached to the highest observed ROAS wins.

Ignored:

- incrementality;
- attribution bias;
- organic demand;
- cannibalization;
- customer quality;
- CLV;
- saturation;
- delayed conversions;
- cross-channel effects.

## MIN_CAC

Operator objective:

`minimize observed cost per canonical new customer`

Frozen formula:

`observed advertising spend / represented new customers`

Frozen customer population:

`canonical new customers with first realized order in the lookback`

Minimum evidence:

`>= 1 represented new customer`

Ranking uses a strictly monotonic reciprocal transform:

`1 / (1 + CAC_minor)`

This transform changes ranking orientation only; the audited KPI remains CAC.

Ignored:

- customer revenue;
- margin;
- repeat purchase;
- retention;
- CLV;
- incrementality;
- customer quality.

## LOWEST_CPA

Operator objective:

`minimize observed cost per configured conversion event`

Frozen formula:

`observed advertising spend / represented realized purchase-conversion events`

Configured event:

`REPRESENTED_REALIZED_PURCHASE_ORDER`

Population:

`configured realized purchase-conversion events in the lookback`

Minimum evidence:

`>= 1 represented purchase conversion`

Ranking transform:

`1 / (1 + CPA_minor)`

This is intentionally distinct from MIN_CAC. Repeat/customer-population semantics may cause the operators to choose different channels.

## MAX_REVENUE

Operator objective:

`maximize observable short-term revenue`

Candidate KPI estimates:

### Advertising
`observed trailing attributed revenue of target channel`

### Pricing
`recent realized units × target price`

### Promotion
`recent realized units × discounted price`

with no assumed demand lift.

### Merchandising
`observed trailing product revenue`

Ignored:

- COGS;
- gross margin;
- contribution margin;
- ad cost where outside the revenue KPI;
- discount cost beyond observed price effect;
- shipping;
- returns as a separate profitability correction;
- long-term profit;
- CLV.

The estimator is intentionally narrow and may prefer high revenue with poor or negative profit.

## BEST_SELLER_PUSH

Operator objective:

`maximize observed realized units sold`

Frozen bestseller definition:

`SUM_REALIZED_ORDER_LINE_QUANTITY`

Eligible exposure actions:

- move product to position 1;
- start the frozen 10% promotion template.

The product with the highest observed units sold receives more exposure.

Ignored:

- margin;
- stockout risk;
- substitution;
- product discovery;
- diversification;
- returns;
- future demand;
- assortment effects.

## HIGHEST_CONVERSION_RATE

Operator objective:

`maximize observed product conversion rate`

Frozen formula:

`represented realized orders containing product / observed product views`

Minimum evidence:

`20 product views`

Eligible exposure actions:

- move product to position 1;
- start the frozen 10% promotion template.

Zero conversions with sufficient views is a valid zero rate.
Missing/under-20 views excludes the candidate.

Ignored:

- AOV;
- revenue;
- margin;
- customer quality;
- acquisition cost;
- CLV;
- sample-size uncertainty beyond the 20-view floor.

## Missing data

Frozen behavior:

`missing KPI / zero denominator / insufficient evidence / inactive entity → exclude candidate`

No estimate is imputed.

Every excluded candidate remains in the audit with its reason.

## Tie-breaking

Candidates rank by:

1. transformed ranking score descending;
2. no action first on exact score tie;
3. frozen Action-type order;
4. target key ascending;
5. parameter key ascending;
6. candidate ID ascending.

Runtime or database ordering never chooses the winner.

## Narrow-objective failure modes

All six deliberately ignore:

- causal validity;
- attribution bias correction;
- confounding;
- selection effects;
- uncertainty;
- confidence intervals;
- Bayesian shrinkage;
- delayed effects;
- future demand;
- future customer behavior;
- substitution;
- cannibalization;
- retention;
- CLV;
- broader profit.

No operator secretly replaces its objective with contribution profit.

## Constraints

Every generated Action is canonical and comes from the per-decision legal Action space.

The suite respects:

- legal target eligibility;
- required preconditions;
- numeric Action bounds;
- active/available state;
- pricing/promotion/merchandising eligibility.

The selected Action then passes through the generic Step 3.1 constraint system.

Accepted, rejected and explicitly modified outcomes are recorded.
No silent repair occurs.

## Complete audit

Every decision records:

- objective/KPI;
- direction/formula;
- scope/population/currency;
- exact 7-day window;
- minimum evidence;
- legal Action-space fingerprint;
- complete candidate set;
- candidate canonical Action;
- raw KPI value;
- transformed ranking score;
- evidence used;
- missing/exclusion reason;
- complete ordering;
- tie-break decisions;
- selected candidate/Action;
- operator/configuration/dependency identities.

Generic evaluator records preserve validation, constraint disposition and executed Action.

## Objective fidelity

The focused suite includes a fixture where:

- channel A has higher ROAS;
- channel B has lower CAC;
- channel B has greater observable revenue.

Expected:

- MAX_ROAS → A;
- MIN_CAC → B;
- MAX_REVENUE → B.

Separate fixtures prove:

- MIN_CAC and LOWEST_CPA can disagree;
- BEST_SELLER_PUSH follows units sold;
- HIGHEST_CONVERSION_RATE follows orders/views.

## Adversarial behavior

Tests intentionally add signals showing broader business-value conflicts:

- low incrementality;
- poor retention;
- margin destruction;
- near-stockout bestseller;
- cheap low-value conversions;
- high conversion with low AOV;
- low sample sizes;
- delayed effects;
- substitution/cannibalization;
- return differences;
- promotion pull-forward;
- position bias.

The operator continues optimizing its named KPI.

## Operator objective versus evaluator outcome

Every audit records:

`objectiveSeparatedFromEvaluationMetrics = true`

and:

`evaluatorOutcomeMetricUsedInDecision = false`

A policy may succeed at its narrow objective and still perform worse on gross profit, contribution, CLV or inventory outcomes.

## Paired comparisons

All six use the exact frozen Step 3.1 comparison binding.

Tests compare them against the prior ladder under identical:

- worlds;
- initial conditions;
- environmental seeds;
- observations;
- cadence;
- legal Action space;
- constraints;
- horizons;
- evaluator metrics.

Only policy behavior and operator-specific seed binding differ.

## Evaluation artifacts

Every operator produces deterministic 90-opportunity EvaluationRunArtifacts and generic OperatorEvaluationBundles preserving:

- contract fingerprint;
- operator/version/fingerprint;
- objective/configuration fingerprint;
- Action Ontology;
- simulator;
- world;
- metric set;
- currency;
- seeds;
- observations;
- candidate Actions;
- KPI values;
- candidate scores;
- ranking;
- selected Action;
- validation;
- execution;
- outcomes;
- canonical evaluation metrics.

## Freeze discipline

Before benchmark evaluation, Step 3.9 freezes for every operator:

- KPI definition;
- formula;
- scope;
- population;
- 7-day lookback;
- candidate grid;
- minimum evidence;
- missing-data exclusion;
- no-action score;
- tie-break;
- action-domain eligibility.

Future substantive changes require new versions/fingerprints.
