# Causal Semantics

## Attribution is not incrementality

A channel can receive observed or platform-reported attribution without causing the attributed purchase.

The GroundTruth contract therefore stores causal channel mechanisms separately from anything the merchant observes.

Future evaluation should compare an algorithm's estimate against GroundTruth incrementality, not against platform attribution.

## Factual and counterfactual worlds

A factual world is generated from a manifest and seed.

A counterfactual world applies one or more interventions to that same world definition.

The contract requires:

```
randomSeedPolicy = "shared"
```

for factual/counterfactual comparisons so stochastic differences are controlled rather than confused with intervention effects.

Step 1 defines this contract only. It does not execute counterfactual simulation.

## Intervention semantics

An intervention has:

- a causal variable;
- operation `set`;
- a typed value;
- optional effective time;
- optional duration;
- optional population selector.

Numeric intervention values must match the unit of the targeted causal node.

Examples:

```ts
{
  variable: "marketing.meta_spend",
  operation: "set",
  value: { kind: "number", value: 0, unit: "money_minor" }
}
```

```ts
{
  variable: "promotion.discount_active",
  operation: "set",
  value: { kind: "boolean", value: false }
}
```

The causal graph explicitly marks whether a variable is intervenable.

## Graph semantics

Each causal node declares:

- domain;
- temporal scope;
- value type;
- unit;
- intervenability;
- information visibility.

Each edge declares:

- parent;
- child;
- relationship type;
- mechanism id;
- optional positive time lag.

Zero-lag relationships must form a DAG.

Positive-lag feedback is permitted only when both parent and child are explicitly time-indexed.

This allows valid temporal feedback while preventing accidental contemporaneous cycles.

## Descendants and intervention scope

Counterfactual changes should propagate only through descendants of the intervened variable unless another explicitly modeled mechanism applies.

`descendantsOf` provides the structural contract future simulator/evaluator code can use to check that rule.

## Average and marginal effects

Average channel efficiency and marginal response are distinct.

A response curve defines incremental outcome as intervention intensity changes.

CAC likewise distinguishes average incremental CAC from a marginal CAC mechanism.

Future optimization must use marginal effects when determining whether additional spend remains beneficial.

## Confounding and mediation

The graph can represent structures such as:

```
latent intent -> purchase probability

Meta exposure -> brand awareness
              -> branded search
              -> purchase probability
```

That makes it possible for later evaluation to test whether an algorithm mistakes demand capture for causal lift.

## External shocks

External shocks are exogenous causal mechanisms, not seasonality.

Each shock declares:

- start;
- duration;
- population selector;
- affected variables;
- causal functional form and magnitude.

A future simulator must apply those shocks independently of ordinary seasonal mechanisms.
