# Phase 2 — Action Space
## Step 1 — Canonical Action Ontology

## Governing principle

**Every Kivviq module must speak the same action language.**

This step defines contracts only. It does not choose, rank, recommend, optimize,
execute or predict the outcome of actions.

## Core boundary

The canonical concepts are deliberately separate:

- Action — an immutable definition of a possible business intervention.
- ActionLifecycleRecord — what later happened to that action.
- ActionEvaluationReference — a reference to a future evaluation.
- SimulatorIntervention — the causal manipulation used by a simulator.
- EligibilityResult — eligible, ineligible or unknown.

Action contains no lifecycle state, prediction, confidence, recommendation score,
rank, success state or God-mode simulator truth.

## Canonical Action

The Step 1 canonical Action is an AtomicAction. Every action contains:

- stable typed identity: ActionId, ActionType, ActionCategory and schemaVersion;
- human-readable description, explicitly non-authoritative;
- discriminated typed target;
- scope, separate from target;
- typed parameters;
- explicit timing and implementation delay;
- duration and termination semantics;
- typed implementation-cost dimensions;
- resource requirements;
- hard and soft constraints;
- preconditions;
- reversibility;
- risk dimensions;
- uncertainty dimensions, separate from risk;
- measurement horizon;
- primary and guardrail outcome families;
- descriptive intent;
- provenance;
- optional reference to the action being reversed.

The TypeScript contract is readonly and assertValidAction recursively freezes
validated actions at runtime.

## Identity and schema version

Descriptions are never identifiers.

Core identity is represented by typed ActionId, ActionType, ActionCategoryId and
ActionSchemaVersion values.

The supported schema version is exactly 1.0.0. Unsupported versions are rejected.
No old action is silently reinterpreted. Future migrations must be explicit.

## Categories

The top-level taxonomy includes advertising, pricing, promotion, shipping,
merchandising, inventory, CRO, lifecycle, customer targeting, experimentation,
investigation, operational and no-op.

Category names do not implement behavior.

## Target versus scope

ActionTarget identifies what the action operates on: channel, campaign, ad set,
ad, audience, product, SKU, category, collection, customer segment, funnel stage,
page, lifecycle program, shipping policy, inventory policy, experiment or
merchant.

ActionScope is separate and can qualify an action by geography, device, customer
population, product population, channel subset or time window.

Example:

- target: Google Ads campaign
- scope: Canada / mobile / new customers

Targets do not accept arbitrary metadata.

## Parameters and exact operation semantics

Authoritative action semantics never use Record<string, unknown>.

Typed parameter families include budget, price, promotion, inventory, frequency,
toggles, merchandising position, shipping, page changes, customer targeting,
experiments, investigations, no-op and wait/observe.

Numeric mutation is explicit:

- SET
- DELTA
- MULTIPLY

Relative operations carry an explicit ReferenceValue: current value at decision
time, named baseline snapshot, previous period or explicit baseline value.

Therefore "increase budget 20%" cannot exist as an unresolved natural-language
instruction.

Money uses integer minor units with explicit currency. Budget rates carry an
explicit day, week or month denominator. Percentages use integer basis points.
Quantity and frequency values carry explicit units.

## Timing

Timing distinguishes decision time, requested start, effective start and
implementation delay.

Known timestamps are UTC ISO-8601 values. Unknown timing is represented
explicitly with a reason. Runtime validation rejects impossible chronology.

The inventory fixture demonstrates a decision made now whose business effect
begins 45 days later.

## Duration and termination

Supported duration semantics are instantaneous, temporary, persistent, recurring
and until reversed.

Termination is separate and may be fixed end, fixed duration, condition
reference, manual reversal or persistent.

No autonomous condition monitor is implemented here.

## Cost and resources

Action cost is not a single number. The contract separates direct financial cost,
media spend, implementation cost, engineering cost, operational cost,
promotional cost and inventory commitment.

Opportunity cost is stored only as a reference for later evaluation and is never
silently counted as realized accounting expense.

Resource requirements are separate for advertising budget, inventory,
engineering capacity, creative capacity, email audience, operational capacity
and testing traffic.

## Constraints and preconditions

Constraints are typed and classified:

- hard — a future eligibility evaluator cannot silently violate them;
- soft — a preference a future optimizer may trade off.

Preconditions describe what must already be true before an action is meaningful
or executable.

Runtime validation checks registered property references, operators, units,
freshness fields and contradictory minimum/maximum bounds. This step does not
build a Business State engine.

## Eligibility

The ontology defines ActionEligibilityEvaluator.isEligible(action,
businessState) as a future-compatible interface.

The result is tri-state: eligible, ineligible or unknown.

ActionEligibilityBusinessState declares what an evaluator would need without
implementing Business State. eligibilityInformationRequirements statically
extracts hard-constraint and precondition requirements. Soft preferences do not
become hard eligibility gates.

## Reversibility and reversal

Reversibility is explicit:

- immediately reversible;
- reversible with delay;
- partially reversible;
- effectively irreversible.

A reversible action identifies how to restore the previous target/parameter
value or references an explicit reversal action ID. Irreversible actions state
why no reversal exists.

A reversal may reference the original action through reversalOfActionId.

## Lifecycle is not Action

The semantic definition does not mutate from proposed to accepted, started or
completed.

Those states are represented only by the separate ActionLifecycleRecord
contract. The original Action remains immutable for later Decision, Execution
and Outcome Measurement systems.

## Risk versus uncertainty

Risk describes possible downside categories. Action stores structured risk
dimensions and definitions, not a scalar risk score.

Dimensions include financial downside, inventory exposure, customer experience,
implementation, irreversibility, measurement uncertainty, operational
complexity, time to recovery and brand/reputation exposure.

Uncertainty is distinct and covers information gaps about causal effect,
measurement, demand, implementation or timing.

Action contains no predicted probability, impact estimate or confidence score.

## Measurement horizon and outcomes

Each action declares earliest meaningful evaluation time, primary measurement
horizon, optional long-term follow-up, primary outcomes and guardrail outcomes.

Outcome families include incremental contribution profit, revenue, orders, new
customers, repeat customers, conversion, inventory position, customer value,
retention and return rate.

There is no universal 30-day window.

## Intent and provenance

Intent explains why the action is being considered. It is descriptive and does
not change execution semantics.

Provenance can identify human, rule-based, diagnosis, opportunity, optimizer,
experiment-selector or imported/manual origin. Provenance never changes what the
action means.

## NO_OP, WAIT, INVESTIGATE and RUN_EXPERIMENT

NO_OP / DO_NOTHING is a first-class measurable action, not null.

WAIT / OBSERVE is distinct: intervention is deferred because additional natural
evidence is expected.

INVESTIGATE changes the information state rather than directly changing business
economics.

RUN_EXPERIMENT can reference hypothesis, intervention action, control action,
target population, duration and primary outcome. No Experiment Selector is built.

## Atomic and compound readiness

Step 1 keeps canonical Action atomic.

CompoundAction is a readiness-only grouping contract containing stable component
action IDs. It intentionally does not define execution policy, dependency
scheduling, transactionality or optimization.

This is enough to represent a future paired reallocation such as Meta
-CAD 2,000/week plus Google +CAD 2,000/week without redesigning atomic Action.

## Action to simulator Intervention boundary

Business Action is not simulator Intervention.

translateActionToInterventions(action, referenceState) uses registered typed
translators. Translation is deterministic and reads structured fields only.
Natural-language description is never interpreted.

The Step 1 proof includes typed translators for advertising budget adjustment,
price adjustment and campaign pause.

NO_OP, WAIT and INVESTIGATE produce no causal business manipulation in the
current simulator boundary.

An unsupported action type fails explicitly until a typed translator is
registered.

## Information boundary

Action-space modules are included in the repository dependency-cruiser
Operator-safe boundary. They may not import GroundTruth, generation, latent
customer population, simulator internals, economic God-mode layers,
evaluation/oracle modules or product-economics internals.

Runtime validation additionally rejects hidden fields such as
trueIncrementalROAS, trueResponseCurve, futureDemand, futureStockout,
counterfactualRevenue and oracleBestAction.

It also rejects predictions, confidence, ranking, recommendation score and
lifecycle/execution state embedded in Action.

## Semantic equality and fingerprint

Semantic equality intentionally ignores actionId, human-readable description,
intent, provenance and creation timestamp, risk/uncertainty commentary and
measurement plan.

It includes authoritative intervention semantics: type/category, target, scope,
parameters, timing, duration, termination, cost/resource commitments,
constraints, preconditions, reversibility and reversal reference.

Constraint, scope and resource ordering is canonicalized.

actionFingerprint hashes the canonical semantic projection using deterministic
FNV-1a 64-bit. It is a reproducibility/deduplication fingerprint, not a security
primitive.

## Serialization and validation

Canonical serialization recursively sorts object keys before JSON encoding.

Round trip from Action to serialized form and back preserves semantics.

Runtime validation rejects malformed IDs, unsupported schema versions, unknown
top-level fields, unknown targets, unit mismatches, invalid currency,
NaN/Infinity, invalid timestamps, negative/inconsistent duration, impossible
implementation chronology, malformed constraints/preconditions, contradictory
bounds, reversibility contradictions, malformed outcome horizons and
God-mode/prediction/ranking/lifecycle leakage.

No silent coercion is performed.

## Non-scope

This step does not build an optimizer, recommendation engine, opportunity engine,
action ranking system, Digital Twin, decision policy, LLM recommendation layer,
production execution system, Business State engine, Experiment Selector or
autonomous condition monitor.
