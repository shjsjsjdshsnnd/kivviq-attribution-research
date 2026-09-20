# Ground Truth

## Purpose

Ground Truth is the simulator-side description of what is actually true in a synthetic ecommerce world. It exists so future Growth Operator algorithms can be evaluated against known causal reality rather than against observed attribution.

This Step 1 package defines contracts only. It does **not** generate merchants, customers, journeys, orders, recommendations, optimizations, or counterfactual outcomes.

## Core distinction

Ground Truth is not:

- platform-reported attribution;
- observed correlation;
- reported ROAS;
- reported CAC;
- observed sales when inventory constrained demand;
- revenue used as a proxy for contribution profit.

Ground Truth includes the mechanisms needed to distinguish those quantities later.

## Ontology

The manifest supports typed mechanisms for:

- baseline and organic demand;
- causal channel incrementality;
- spend-response curves and saturation;
- incremental and marginal CAC;
- conditional conversion probability;
- own-price and cross-price elasticity;
- promotion elasticity;
- expected future CLV;
- repeat purchase;
- product demand, substitution, and complementarity;
- inventory, stockouts, replenishment, and backorders;
- seasonality;
- population-adjusted device effects;
- non-linear funnel paths;
- causal channel interactions;
- contribution-profit economics;
- external shocks;
- explicit causal relationships and interventions.

## Baseline demand

`BaselineDemandMechanism.paidMarketingIncluded` is structurally fixed to `false`.

This prevents paid marketing lift from silently entering the baseline against which incrementality is later evaluated.

Organic demand is defined counterfactually as demand that would exist without modeled paid intervention. It is not synonymous with traffic labeled "organic."

## Units

Core units are explicit:

- money: integer minor currency units;
- probabilities: values in `[0,1]`;
- timestamps: UTC ISO-8601;
- durations: integer seconds;
- causal effects: scale + numerical value + unit.

A causal effect therefore cannot be represented as an unexplained `effect: number`.

## Response curves

Response curves are distinct from average ROAS. Supported contract shapes include:

- linear;
- Hill/saturating;
- threshold;
- piecewise.

Future simulation code can use those definitions to evaluate average and marginal response separately.

## Economics

The v1 contribution-profit accounting identity is:

```
gross revenue
- discounts
- returns/refunds
- COGS
- payment fees
- shipping subsidy
- fulfillment costs
- modeled variable operating costs
- marketing spend
= contribution profit
```

The helper `contributionProfitMinor` enforces integer minor currency units.

## Versioning and serialization

`GroundTruthManifest.schemaVersion` is currently `1.0.0`.

The parser:

- requires all v1 top-level fields;
- rejects unknown top-level fields;
- rejects unsupported schema versions;
- validates core invariants before accepting a manifest.

Serialization recursively sorts object keys, providing a deterministic canonical representation. `reproducibilityKey` binds schema version, simulator version, world id, seed, and canonical manifest content.

This establishes the deterministic contract needed by Step 2 without implementing world generation yet.

## Step 2 boundary

Step 2 may generate realized merchant/customer/world state from these mechanism definitions.

Step 1 deliberately does not.

The distinction is:

```
MechanismDefinition -> describes how reality works
RealizedState       -> one generated state of that reality
```

This repository currently defines the first side only.

## Runtime validation

Every nested GroundTruth structure is validated at runtime with strict schemas.

Validation rejects:

- unknown fields at any nested level;
- missing required nested fields;
- invalid probabilities;
- NaN and Infinity;
- non-integer minor-currency values where integer money is required;
- invalid timestamps and durations;
- malformed response curves and probability distributions;
- incompatible causal-effect scale/unit combinations;
- invalid inventory and stockout semantics;
- malformed causal nodes and edges;
- invalid intervention and counterfactual-request structures.

After shape validation, semantic validation checks cross-object relationships such as causal-variable references, response-curve output units, saturation references, mechanism IDs, intervention targets, external-shock targets, mediator variables, currencies, and organic-demand baseline references.

Runtime validation complements, but does not replace, static TypeScript typing.
