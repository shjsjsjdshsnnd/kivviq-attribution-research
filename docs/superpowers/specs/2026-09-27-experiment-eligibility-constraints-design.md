# Steps 16–18: Experiment, Eligibility, and Hard Constraints

## Goal

Add experiments to the canonical Action Space, evaluate whether canonical Actions may proceed, and enforce evidence-backed hard constraints. The work prepares a shared boundary for a future Experiment Selector without adding selection, ranking, outcome analysis, or execution orchestration.

## Scope

This design covers three additions:

1. A native canonical `experiment.run` Action.
2. A unified eligibility assessment for atomic and compound Actions.
3. Typed hard constraints with evidence-bound assessments.

The implementation retains the existing legacy experiment and constraint readers. It adds exact adapters where the legacy semantics map cleanly to the new contracts.

The implementation does not add an Experiment Selector, statistical inference, winner selection, adaptive allocation, expected value, recommendation scoring, provider execution, or ActionEvaluation.

## Canonical experiment intent

`experiment.run` becomes a native WHAT variant in the v2 `CanonicalAction` envelope. The existing envelope supplies identity, population, timing, provenance, and hard constraints.

Each experiment arm references a separately stored immutable Action:

```ts
interface ExperimentArmReference {
  armId: string;
  role: "CONTROL" | "TREATMENT";
  actionId: string;
  actionFingerprint: string;
  allocationBasisPoints: number;
}
```

The arm resolver must receive the referenced Actions as runtime context. It verifies the ID and fingerprint before readiness may become eligible. An arm may reference an atomic or compound Action. A control may reference explicit `NO_OP` or another active Action. Control and treatment arms must resolve to distinct canonical semantics.

The experiment WHAT includes:

- a stable hypothesis reference;
- two or more arm references with one control and at least one treatment;
- a primary metric reference and optional guardrail metric references;
- a randomization unit from `CUSTOMER`, `SESSION`, `ORDER`, or a registered custom unit;
- fixed allocation totaling 10,000 basis points;
- a fixed sample target, a fixed timing horizon, or both;
- an assignment boundary tied to the canonical population binding;
- a measurement window that remains distinct from execution timing.

The experiment uses the envelope population. It cannot introduce a second population reference. The shared ActionTiming contract defines execution and recurrence. Experiment duration does not duplicate ActionTiming.

The schema rejects outcome and selection fields, including winner, lift, significance, posterior probability, expected revenue, expected profit, recommendation score, best arm, adaptive allocation, and sequential stopping policy.

## Experiment runtime boundary

Experiment intent and experiment results remain separate. Translation resolves the Action, its population, timing, arm registry, and eligibility. A valid experiment produces an `ExperimentTask` and no commercial simulator interventions. The task retains the experiment Action ID and fingerprint plus every resolved arm ID and fingerprint.

The existing historical `EXPERIMENT_REQUIRES_ENGINE` result remains available for legacy Actions. Native v2 experiments use the new task contract. Neither path claims that an experiment ran or produced a result.

A later `ExperimentResult` may record assignments, exposure, metric observations, exclusions, completion, statistical output, and provenance. This step does not define selection or winner semantics.

## Canonical hard constraints

`CanonicalAction` gains an optional immutable `constraints` array. The default is an empty array for serialization and semantic identity. Constraint definitions contain no runtime result.

The strict constraint union covers:

- `AVAILABLE_BUDGET`;
- `MINIMUM_MARGIN`;
- `PRICE_FLOOR`;
- `INVENTORY_AVAILABILITY`;
- `MERCHANT_POLICY`;
- `CHANNEL_AVAILABILITY`;
- `OPERATIONAL_CAPACITY`;
- `MAXIMUM_DISCOUNT`;
- `CONTRACTUAL_RESTRICTION`;
- `RISK_LIMIT`;
- registered `CUSTOM` constraints.

Every constraint has a stable ID, target or scope, evaluation boundary, `whenUnknown: "UNKNOWN" | "INELIGIBLE"`, and the typed fields required by its kind. Numeric thresholds carry units and currency where relevant. Merchant policy and contractual constraints reference versioned rule identities and effective intervals instead of prose. Risk limits use a measurable metric, threshold, and horizon; they do not contain predicted outcomes.

Constraints distinguish `CURRENT_STATE` from `PROJECTED_AFTER_ACTION`. Price floors, margin floors, and discount caps evaluate the resulting action value or supplied post-action fact. They cannot pass because a policy threshold merely exists.

Resource requirements remain the single declaration of required quantities. A capacity or budget constraint may reference a resource requirement and compare it with separately evidenced availability.

Compound constraints retain component applicability. Existing `BUDGET_NEUTRAL`, `TOTAL_COST_LIMIT`, and `EVIDENCE_REQUIRED` semantics adapt into the shared assessment model. Literal contradictions override external claims.

## Constraint assessments

Runtime evidence stays outside the Action:

```ts
interface ConstraintAssessment {
  constraintId: string;
  actionId: string;
  actionFingerprint: string;
  status: "SATISFIED" | "VIOLATED" | "UNKNOWN";
  observedValue?: TypedValue;
  targetRef: string;
  evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
  observedAt: string;
  evidenceRefs: string[];
  provenance: string[];
}
```

Validation checks identity, target, fingerprint, unit and currency compatibility, boundary, freshness, and evidence completeness. Unknown or stale evidence cannot satisfy a hard constraint. `whenUnknown` decides whether missing evidence leaves overall eligibility unknown or blocks the Action as ineligible.

## Unified eligibility

`assessActionEligibility` returns one deterministic result for native and adapted Actions:

```ts
interface ActionEligibility {
  actionId: string;
  actionFingerprint: string;
  evaluatedAt: string;
  status: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  checks: EligibilityCheck[];
}
```

Each check identifies `PRECONDITION`, `HARD_CONSTRAINT`, or `DOMAIN_RULE` and reports `SATISFIED`, `VIOLATED`, or `UNKNOWN`, with reason codes, evidence references, and missing information. The evaluator reports every applicable check in deterministic order.

Aggregation follows these rules:

1. Any violation yields `INELIGIBLE`.
2. Otherwise, any unknown yields `UNKNOWN`.
3. Otherwise, the Action is `ELIGIBLE`.

A legacy precondition with `whenUnknown: "ineligible"` converts its unknown observation into a violation. Invalid Actions and unsupported Action families remain separate errors rather than eligibility results.

The evaluator reads facts through a narrow evidence port for properties, entity status, capabilities, policy rules, contracts, resources, and evidence freshness. It does not import simulator truth, evaluation results, or an optimizer. Evidence receipts bind facts to source, target, observation time, and evaluation boundary.

Domain adapters add checks for facts that generic expressions cannot represent. This closes known gaps such as discontinued inventory products, unused advertising channels, and pricing or paid-media eligibility. Existing domain evaluators may remain as compatibility surfaces, but the new facade does not trust unbound `hardConstraintResults` maps.

## Translation and compound integration

Translation accepts a validated eligibility result bound to the exact Action fingerprint. `INELIGIBLE` returns an explicit eligibility failure. `UNKNOWN` returns missing context. Eligibility does not imply simulator support, and simulator support does not imply eligibility.

Compound readiness consumes each component's unified eligibility:

- `ELIGIBLE` maps to the component's normal readiness evaluation;
- `INELIGIBLE` maps to `INELIGIBLE`;
- `UNKNOWN` maps to `UNKNOWN` or `MISSING_CONTEXT` with retained checks.

Compound dependencies, atomicity, timing, simulator capability, and compound constraints remain separate gates. Coupled constraints such as budget neutrality apply to the emitted component set and cannot permit one side of a transfer to proceed alone.

An experiment may reference a compound Action as an arm. An experiment cannot recursively reference itself, and the resolved arm graph must be acyclic.

## Compatibility

Historical Actions continue to parse and translate through existing paths. The legacy `run_experiment` contract keeps its experiment-engine boundary. A deterministic adapter may create native arm references only when it receives exact Actions and fingerprints for both legacy arm IDs and an exact canonical population reference.

Recognized legacy hard expressions map to native constraint kinds. Unrecognized property, capability, or evidence expressions map to a registered custom constraint instead of acquiring guessed semantics. Readers keep historical data intact; new writers emit v2 contracts.

## Validation and fixtures

Tests cover:

- a `NO_OP` control and active treatment;
- two active arms;
- atomic and compound arm references;
- missing, stale, mismatched, duplicate, and cyclic arm references;
- invalid allocation totals and duplicate arm IDs;
- fixed sample, fixed horizon, and combined stopping rules;
- population and timing resolution;
- leakage and adaptive-policy rejection;
- unavailable budget and operational capacity;
- discontinued products and unused channels;
- resulting price, margin, and discount limits;
- inventory and warehouse restrictions;
- merchant policy and contractual prohibitions;
- measurable risk limits;
- unknown and stale evidence;
- multiple simultaneous violations and missing facts;
- legacy compatibility;
- eligibility, translation capability, and execution state remaining separate.

Architecture rules prevent experiment, constraint, and eligibility modules from importing simulator internals, ground truth, evaluation, ranking, or optimizer code.
