# Step 3.3 — Canonical `STATUS_QUO` Baseline

## Purpose

`STATUS_QUO` answers:

> What would have happened if the merchant simply kept operating the way it already was?

The governing rule is:

> Continue what the merchant was already doing. Do not improve it.

It is distinct from `DO_NOTHING`:

- `DO_NOTHING` proposes zero discretionary Actions at every opportunity.
- `STATUS_QUO` evaluates the merchant's frozen pre-existing operating policy and emits only the canonical Actions that policy already required.

No optimization, recommendation, forecasting, causal inference, counterfactual policy logic or learning is introduced.

## Frozen dependencies

Step 3.3 is stacked on:

- Step 3.2 frozen head: `a540ffd87d1ff43b96ad481aeae9d62a07b55362`
- Step 3.1 frozen evaluation contract: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 contract fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`
- metric set: `1.0.0`

Step 3.1 and Step 3.2 remain unchanged.

## Merchant policy contract

`src/operator/merchant-policy.ts` defines MerchantPolicy schema `1.0.0`.

A policy has:

- policy ID and semantic version;
- description;
- source/provenance and capture time;
- effective period;
- explicit components for advertising, pricing, promotions, merchandising and inventory;
- deterministic policy fingerprint.

Every component records whether coverage is:

- `defined`; or
- `undefined`.

Undefined coverage must contain zero rules. Missing merchant policy is therefore not silently invented.

The policy capture timestamp must be at or before the policy effective start. Scheduled Actions must fall inside both their rule effective period and the merchant-policy effective period. A policy authored after evaluation outcomes begin is rejected rather than being treated as pre-existing merchant behavior.

## State is not policy

The policy model keeps merchant state separate from merchant policy.

Examples of state are current budgets, prices, inventory and collection order.

Policy rules describe what the merchant had already committed to doing with those states.

A fixed state is represented by a `maintain_state` rule and causes no operator Action. A pre-existing scheduled or observation-triggered merchant decision is represented as an operator-owned policy rule and may produce a canonical Action.

## Rule types

The frozen v1 policy schema contains four rule forms.

### Maintain state

`maintain_state`

Represents pre-existing fixed-state policy such as:

- keep current channel allocation;
- keep current prices;
- keep current merchandising order.

It is environment-owned and emits no operator Action.

### Environment behavior

`environment_behavior`

Represents business-as-usual behavior already executed autonomously by the simulator/environment.

Examples include simulator-native replenishment mechanisms when the world already owns them.

It emits no operator Action.

### Scheduled Action

`scheduled_action`

Represents a merchant Action committed before outcome realization, such as:

- scheduled budget change;
- scheduled price change;
- scheduled promotion;
- scheduled merchandising update.

It emits exactly the frozen canonical Action when its predetermined decision time occurs.

### Observation-triggered Action

`observation_triggered_action`

Represents a pre-existing deterministic merchant rule such as:

```text
observed inventory available units < 10
→ reorder the frozen merchant quantity
```

The rule may evaluate only a named observation available through the Step 3.1 operator boundary.

If the required observation is absent or not usable, STATUS_QUO records an incompatibility and emits no Action. It never accesses hidden simulator state to make the rule work.

The v1 trigger semantics are intentionally explicit: `every_decision_while_true`. More complex merchant execution-memory semantics require a future version rather than hidden mutable operator state.

## Policy ownership

Every policy behavior has one `behaviorKey` and exactly one ownership class:

- `environment_owned`; or
- `operator_owned`.

Policy validation rejects a behavior if the same behavior key is assigned to both ownership classes.

This prevents a simulator-owned promotion/replenishment/update from also being emitted by STATUS_QUO.

Environment-owned rules never emit canonical Actions.

Operator-owned rules are the only rules that may emit Actions.

## Canonical Action materialization

Merchant policy stores validated canonical Action prototypes.

When a rule triggers, STATUS_QUO deterministically materializes the Action for that decision opportunity:

- exact prototype decision-time bindings are rebound to the current policy decision time;
- Action ID is deterministically namespaced to the policy rule and decision time;
- Action provenance becomes `rule_based_baseline`;
- source ID identifies the frozen merchant-policy rule/version;
- evidence references identify the merchant policy;
- intent explicitly states that the Action executes frozen merchant policy without optimization.

The resulting Action is revalidated through the canonical Action validator before it can leave the policy layer.

No STATUS_QUO-specific Action types exist.

## Canonical Operator interface

STATUS_QUO uses the Step 3.2 canonical Operator interface.

The generic Operator interface now supports an optional deterministic decision-audit hook. This is generic infrastructure for policy-based operators, not a STATUS_QUO-only execution route.

The generic evaluator still:

1. validates operator/contract compatibility;
2. constructs the governed Operator-safe input;
3. invokes `decide`;
4. validates output shape;
5. runs all proposed Actions through Step 3.1 Action validation;
6. requires the normal constraint assessor before a valid Action can be accepted;
7. records Action validation/disposition;
8. records one invocation per decision opportunity.

The optional audit records policy reasoning provenance without changing execution semantics.

## STATUS_QUO decision audit

Each invocation records:

- merchant-policy ID/version/fingerprint/schema;
- policy coverage by domain;
- every policy rule evaluated;
- ownership;
- rule result;
- rules triggered;
- emitted Action IDs;
- required observation key;
- observed trigger value when available;
- frozen threshold/comparison;
- simulator compatibility;
- explicit incompatibility reason when applicable;
- benchmark compatibility for the current decision.

A reviewer can reconstruct why every business-as-usual Action was proposed. If a required triggered policy Action is unsupported by the frozen simulator, the audit marks the decision `incompatible_required_policy_semantics`; it is not silently treated as a valid benchmark outcome.

## Advertising policy

STATUS_QUO can preserve:

- fixed existing allocations/budgets through maintain-state rules;
- predetermined scheduled budget changes through canonical advertising Actions.

It does not inspect ROAS/CAC/conversion to improve allocation unless such a rule was already frozen into merchant policy.

The frozen translation layer supports canonical advertising budget and supported campaign-delivery interventions.

## Pricing policy

STATUS_QUO can preserve:

- fixed current prices;
- predetermined scheduled price changes;
- existing price restoration Actions represented in the canonical pricing ontology.

It does not dynamically change price using demand, inventory, margin or elasticity unless such logic existed in the frozen merchant policy.

Supported SKU/product pricing semantics translate through the frozen translation layer where required context exists.

## Promotional policy

STATUS_QUO can preserve predetermined promotion schedules using canonical promotion Actions.

The representative fidelity fixture includes the already-defined temporary four-day collection promotion and verifies its duration remains exactly the frozen merchant policy duration.

The operator does not create a promotion because performance deteriorates.

## Merchandising policy

Fixed collection/product ordering can be preserved as environment-owned maintain-state policy without an Action.

Scheduled rigorous merchandising Actions can also be represented and emitted canonically by STATUS_QUO.

However, the frozen Step 3.1/3.2 simulator translation layer explicitly reports `UNSUPPORTED_SIMULATOR_CAPABILITY` for the rigorous Step 7 merchandising Action family because the simulator's older merchandising-position intervention cannot preserve surface/container, displacement, relationship, removal and rollback semantics.

STATUS_QUO records this incompatibility. It does not approximate the Action through demand, conversion, advertising or pricing.

## Inventory policy

Inventory policy has two legitimate ownership models.

### Environment-owned

If the frozen simulator/world already executes the merchant's pre-existing replenishment mechanism, MerchantPolicy records that mechanism as environment-owned.

STATUS_QUO emits no duplicate reorder Action.

### Operator-owned

A pre-existing merchant reorder rule can be represented as an observation-triggered canonical inventory Action when the trigger information is available through the governed observation boundary.

The representative fixture uses:

```text
inventory.sku_b.available_units < 10
→ canonical inventory.reorder
```

At 10 units the rule does not fire. At 9 units it emits exactly one canonical inventory Action.

The frozen simulator cannot faithfully translate the rigorous Step 8 inventory procurement/policy family. Such rules are therefore representable and auditable but explicitly marked `unsupported_by_frozen_simulator` for end-to-end causal execution.

No immediate `on_hand += reorder_quantity` approximation is allowed.

## Simulator compatibility boundary

The exact frozen dependencies currently support translation for representative:

- advertising budget Actions;
- SKU/product pricing Actions;
- supported promotion discount Actions.

They explicitly do not support faithful execution of:

- rigorous Step 7 merchandising Actions;
- rigorous Step 8 inventory procurement/policy Actions.

This is a lineage qualification, not an invitation to modify Step 3.1 or merge later simulator branches.

For a merchant whose status-quo policy requires unsupported operator-owned semantics, the decision audit records the required rule in `incompatibleRuleIds` and sets `benchmarkCompatibility = incompatible_required_policy_semantics`. The benchmark must not claim a valid performance comparison by silently dropping or approximating those policy effects.

Merchants whose unsupported domains are fixed/environment-owned may still be benchmarked normally because no unsupported operator Action is required.

## STATUS_QUO versus DO_NOTHING

The representative policy fixture includes pre-existing scheduled advertising, pricing and promotional Actions.

At the scheduled opportunity:

- `DO_NOTHING → []`
- `STATUS_QUO → frozen policy Actions`

A separate fixed-policy fixture has no recurring operator-owned Action.

For that merchant:

- `DO_NOTHING → []`
- `STATUS_QUO → []`

That equality is legitimate and is not artificially broken.

## Anti-optimization requirement

Tests change observed:

- ROAS;
- CAC;
- conversion;
- margin.

When those fields are not named by a frozen merchant-policy rule, STATUS_QUO's Action output remains identical.

The implementation contains no:

- ROAS threshold;
- CAC threshold;
- revenue/profit objective;
- forecasting;
- demand optimization;
- dynamic pricing optimizer;
- dynamic inventory optimizer;
- causal estimator;
- recommendation policy;
- learned policy.

## Natural business dynamics

The fixed-policy end-to-end fixture uses the exact frozen simulator version:

`customer-journey-simulator-4.0.0`

It runs with no new operator interventions while simulator-native merchant/world behavior and customer dynamics continue.

The fixture:

- generates a deterministic synthetic replenishment-heavy merchant;
- generates its latent customer population;
- enables simulator-native inventory lifecycle behavior;
- invokes STATUS_QUO at every daily decision opportunity;
- records environment-owned inventory lifecycle policy;
- emits zero duplicate inventory Actions;
- produces business activity, orders and revenue;
- calculates every Step 3.1 metric slot supported by the frozen simulator;
- creates the Step 3.1 evaluation artifact;
- creates the generic operator-evaluation bundle with full merchant-policy configuration provenance.

## Complete provenance

A STATUS_QUO evaluation preserves:

- Step 3.1 contract version/fingerprint;
- operator ID/version/fingerprint;
- merchant-policy schema/version/fingerprint;
- full deterministic operator configuration;
- simulator version;
- world ID/fingerprint;
- Action Ontology version;
- metric-set version;
- currency;
- seeds;
- horizon;
- observations;
- legal Action snapshots;
- every rule evaluated;
- rules triggered;
- raw Action proposals;
- validation/disposition;
- executed Action payloads where accepted;
- outcomes;
- canonical metrics.

## Paired comparisons

STATUS_QUO remains compatible with the Step 3.1 common-random-number comparison contract.

Future comparisons against DO_NOTHING or advanced operators must bind identical:

- world;
- environmental seeds;
- initial conditions;
- decision cadence;
- constraints;
- horizons;
- metric definitions.

Differences must arise from policy behavior.

Step 3.3 does not implement ranking logic.

## Freeze gate

Step 3.3 can be declared frozen only after the exact accepted head passes:

1. architecture boundary;
2. strict typecheck;
3. focused STATUS_QUO policy-fidelity/anti-optimization tests;
4. full inherited suite;
5. build;
6. frozen operator/policy/dependency fingerprint emission.

The freeze record must include:

- operator ID/version/fingerprint;
- MerchantPolicy schema version;
- representative policy fixture fingerprint(s);
- exact Step 3.1 dependency;
- exact Step 3.2 dependency;
- Action Ontology version;
- metric-set version;
- simulator version;
- explicit simulator compatibility qualification.

Future substantive changes require a new operator or policy schema/version.
