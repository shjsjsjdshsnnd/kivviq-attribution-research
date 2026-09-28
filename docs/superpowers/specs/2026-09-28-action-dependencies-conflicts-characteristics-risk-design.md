# Steps 19–22: Dependencies, Conflicts, Action Characteristics, and Risk Contracts

## Goal

Extend the canonical Action Space so it can describe prerequisite relationships, reject impossible portfolios, and expose the implementation and downside dimensions that a later optimizer will need. The extension defines intent and deterministic readiness checks. It does not predict outcomes, score risk, rank Actions, or select a portfolio.

## Design principles

The design preserves the boundaries established in Steps 10–18:

- Canonical Actions contain immutable definitions, never observations or assessment results.
- Runtime evidence is bound to the exact Action or CompoundAction identity, semantic fingerprint, target, evaluation boundary, and observation time.
- Eligibility, dependency readiness, portfolio compatibility, translation capability, execution state, and experiment readiness remain separate results.
- Translation and readiness recompute from raw evidence. They do not trust caller-supplied status claims.
- Every set-like collection has deterministic ordering and duplicate detection.
- Missing, stale, conflicting, or duplicate exact evidence fails to `UNKNOWN` or `BLOCKED`; it never silently satisfies a gate.
- Existing v2 Actions retain their fingerprints when every new collection is empty and characteristics are absent.

## Canonical envelope additions

The v2 envelope gains three definition-only fields with backward-compatible defaults:

```ts
interface CanonicalActionExtensions {
  readonly dependencies: readonly ActionDependency[];       // default []
  readonly conflicts: readonly ActionConflictDefinition[];  // default []
  readonly characteristics: ActionCharacteristicsState;     // default ABSENT
  readonly riskDimensions: readonly RiskMeasurementContract[]; // default []
}
```

Readers apply these defaults to historical v2 payloads. Semantic serialization omits empty arrays and the absent characteristics state, exactly as it already omits empty hard constraints. Non-empty definitions participate in the fingerprint after canonical sorting. Array order, map insertion order, evidence order, and portfolio input order do not affect fingerprints or assessment fingerprints.

New authoring helpers require an explicit characteristics state and all six risk measurement contracts. The permissive reader default exists only so stored v2 data remains readable and keeps its original fingerprint.

## Step 19: action dependencies

### Definition

Dependencies are typed gates attached to the dependent Action. They do not duplicate `ActionTiming.dependencies`: timing remains authoritative for temporal ordering, including offsets and start/end relationships. An Action dependency answers whether a prerequisite is satisfied; timing answers when the Action can occur.

```ts
type LifecycleState = "STARTED" | "EFFECTIVE" | "COMPLETED" | "RESOLVED";

type CanonicalEntityReference =
  | {
      entityKind: "ACTION";
      actionId: string;
      actionFingerprint: string;
    }
  | {
      entityKind: "COMPOUND";
      compoundActionId: string;
      compoundFingerprint: string;
    };

type ActionDependency =
  | {
      dependencyId: string;
      kind: "ENTITY_LIFECYCLE";
      prerequisite: CanonicalEntityReference;
      requiredState: LifecycleState;
      whenUnknown: "UNKNOWN" | "BLOCKED";
    }
  | {
      dependencyId: string;
      kind: "HARD_CONSTRAINT_GATE";
      constraintId: string;
      requiredStatus: "SATISFIED";
      whenUnknown: "UNKNOWN" | "BLOCKED";
    }
  | {
      dependencyId: string;
      kind: "ELIGIBILITY_CHECK_GATE";
      checkId: string;
      requiredStatus: "SATISFIED";
      whenUnknown: "UNKNOWN" | "BLOCKED";
    }
  | {
      dependencyId: string;
      kind: "EXPERIMENT_READINESS_GATE";
      requirement: "READY" | "SUFFICIENT_ELIGIBLE_TRAFFIC";
      whenUnknown: "UNKNOWN" | "BLOCKED";
    };
```

`ENTITY_LIFECYCLE` references an immutable canonical Action or CompoundAction by both ID and fingerprint. The allowed states deliberately exclude `ELIGIBLE`. An Action-state edge that asks whether another Action is eligible would recursively nest eligibility evaluation and make cycles difficult to explain. Audience eligibility, inventory sufficiency, channel availability, and similar prerequisites instead reference an existing eligibility check or hard constraint on the dependent Action. Experiment traffic references the existing experiment-readiness definition.

Examples:

- “Scale Product A advertising” carries an `INVENTORY_AVAILABILITY` hard constraint and a `HARD_CONSTRAINT_GATE` pointing to that constraint.
- “Launch winback email” carries the existing population/domain eligibility check and an `ELIGIBILITY_CHECK_GATE` pointing to its stable check ID.
- “Run checkout experiment” carries `EXPERIMENT_READINESS_GATE: SUFFICIENT_ELIGIBLE_TRAFFIC`.
- “Publish campaign after creative approval” may reference the exact approval Action and require `COMPLETED`.

The schema requires unique dependency IDs, exact local gate references, and acyclic exact entity references. An Action cannot reference itself. Compound expansion adds component definitions to the same graph and detects cycles across Action, CompoundAction, component, and experiment-arm boundaries.

### Evidence and assessment

```ts
interface DependencyEvidenceReceipt {
  receiptId: string;
  dependentActionId: string;
  dependentActionFingerprint: string;
  dependencyId: string;
  evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
  observedAt: string;
  evidenceRefs: string[];
  provenance: string[];
  fact:
    | { kind: "ENTITY_LIFECYCLE"; prerequisite: CanonicalEntityReference; state: LifecycleState }
    | { kind: "ELIGIBILITY_INPUT"; checkId: string }
    | { kind: "CONSTRAINT_INPUT"; constraintId: string }
    | { kind: "EXPERIMENT_READINESS_INPUT"; requirement: "READY" | "SUFFICIENT_ELIGIBLE_TRAFFIC" };
}

interface DependencyAssessment {
  actionId: string;
  actionFingerprint: string;
  evaluatedAt: string;
  evaluationBoundary: EvaluationBoundary;
  status: "SATISFIED" | "BLOCKED" | "UNKNOWN";
  checks: DependencyCheck[];
  assessmentFingerprint: string;
}
```

Lifecycle receipts are verified directly. Gate receipts are pointers to raw input bundles, not reusable status assertions: assessment replays `assessHardConstraints`, `evaluateActionEligibility`, or `assessExperimentReadiness` and verifies the exact referenced definition. Freshness uses the stricter of the caller maximum age and the receipt or source policy. Multiple exact matches are ambiguous regardless of order.

Any blocked check makes the dependency assessment `BLOCKED`; otherwise any unresolved check makes it `UNKNOWN`; otherwise it is `SATISFIED`. All checks are retained and sorted by dependency ID.

## Step 20: action conflicts and portfolio compatibility

### Definition

Conflicts describe coexistence, not preference. They are symmetric relations over exact target, scope, and resolved time intervals.

```ts
type ConflictKind =
  | "MUTUALLY_EXCLUSIVE_INTENT"
  | "CONTRADICTORY_VALUE_CHANGE"
  | "EXCLUSIVE_RESOURCE"
  | "POLICY_PROHIBITION"
  | "CUSTOM";

interface ActionConflictDefinition {
  conflictId: string;
  kind: ConflictKind;
  target: ConstraintTarget;
  scope: ConflictScope;
  overlapRule: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP" | "FULL_CONTAINMENT";
  counterparty:
    | CanonicalEntityReference
    | { registryRef: string; code: string };
}
```

Exact references support explicitly known conflicts. Registered semantic adapters detect domain contradictions without guessing from labels, such as opposing price changes for the same product and currency. Adapters consume typed WHAT fields only. A price increase and decrease conflict only when target, scope, currency, and their resolved effective intervals intersect.

A conflict declared by either side creates one normalized unordered pair. The result is symmetric: evaluating `[A, B]` or `[B, A]` returns the same pair key, reasons, and status. Duplicate or contradictory declarations are rejected. Self-conflicts and unknown counterpart identities are invalid or unresolved rather than ignored.

```ts
interface PortfolioCompatibilityAssessment {
  portfolioFingerprint: string;
  evaluatedAt: string;
  status: "COMPATIBLE" | "CONFLICTING" | "UNKNOWN";
  expandedMembers: readonly CanonicalEntityReference[];
  pairs: readonly PortfolioPairAssessment[];
  evidenceRefs: readonly string[];
  assessmentFingerprint: string;
}
```

`assessPortfolioCompatibility` validates exact identities, expands CompoundActions and experiment arms, resolves timing, and evaluates every applicable unordered pair. Any proven conflict yields `CONFLICTING`; otherwise unresolved identity, scope, timing, or evidence yields `UNKNOWN`; otherwise the portfolio is `COMPATIBLE`. It reports all conflicts. It never drops an Action, chooses a winner, calculates utility, or repairs the portfolio.

Impossible portfolios are rejected before optimizer or translation entry. Translation receives raw compatibility context and replays the assessment. A supplied `COMPATIBLE` object cannot bypass missing, stale, mismatched, or ambiguous evidence.

## Step 21: implementation cost, reversibility, and burden

### Single delay authority

`action.timing.implementationDelay` is the sole representation of implementation delay. `ActionCharacteristics` cannot contain `delay`, `leadTime`, `implementationSeconds`, or any equivalent field. Portfolio aggregation reads the resolved timing value rather than copying it.

### Typed characteristics

```ts
type KnownOrRange<T> =
  | { state: "KNOWN"; value: T; sourceRefs: string[] }
  | { state: "RANGE"; minimum: T; maximum: T; sourceRefs: string[] }
  | { state: "UNKNOWN"; reason: string };

interface MoneyValue {
  amountMinor: number;
  currency: string;
}

interface OperationalQuantity {
  quantity: number;
  unit: string;
  resourceRef: string;
}

type Reversibility =
  | { kind: "FULLY_REVERSIBLE"; reversalActionRef: string }
  | { kind: "PARTIALLY_REVERSIBLE"; irreversibleEffects: string[]; reversalActionRef: string }
  | { kind: "IRREVERSIBLE"; irreversibleEffects: string[] };

interface StageCancellationCost {
  stage: "BEFORE_START" | "IMPLEMENTING" | "EFFECTIVE" | "COMPLETED";
  cost: KnownOrRange<MoneyValue>;
  operationalBurden: readonly KnownOrRange<OperationalQuantity>[];
}

interface ActionCharacteristics {
  implementationCost: KnownOrRange<MoneyValue>;
  reversibility: Reversibility;
  cancellationCosts: readonly StageCancellationCost[];
  operationalBurden: readonly KnownOrRange<OperationalQuantity>[];
}
```

Money values require integer minor units and ISO-style currencies. Ranges require equal units/currencies and `minimum <= maximum`. Operational quantities require finite non-negative values, registered units, and exact resource references. Cancellation costs are stage-sensitive and must cover every reachable stage. Duplicate stages are invalid.

Reversibility is strict. A sent message, completed irreversible purchase, or consumed resource cannot be labeled fully reversible merely because a compensating Action exists. `FULLY_REVERSIBLE` requires a registered reversal contract with no declared irreversible effects. `PARTIALLY_REVERSIBLE` requires both a reversal reference and at least one irreversible effect. `IRREVERSIBLE` forbids a reversal claim. Domain adapters enforce known invariants from pricing, inventory, lifecycle, shipping, merchandising, and CRO rollback contracts.

Characteristics are descriptive inputs. The Action Space validates and aggregates them but does not turn them into utility, penalties, preferences, or rankings.

### Compound and portfolio aggregation

Compound expansion produces a vector, never a scalar score:

```ts
interface ActionCharacteristicsVector {
  implementationCostByCurrency: Record<string, MoneyRange>;
  implementationDelayByMember: Record<string, TimingValue<TemporalOffset>>;
  operationalBurdenByUnitAndResource: Record<string, QuantityRange>;
  cancellationCostByStageAndCurrency: Record<string, MoneyRange>;
  reversibility: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE" | "UNKNOWN";
  memberRefs: CanonicalEntityReference[];
}
```

Money is summed only within a currency. Quantities are summed only for the same registered unit and resource. Unknown members remain explicit. Range addition preserves lower and upper bounds. Aggregate reversibility is the strictest member state, while the member breakdown remains available. Shared components are deduplicated by exact identity and fingerprint.

## Step 22: risk and downside measurement contracts

Canonical Actions define exactly six risk dimensions. They contain measurement instructions only—no values, estimates, probabilities, grades, labels, weights, composite scores, recommendations, or predictions.

```ts
type RiskDimension =
  | "FINANCIAL_DOWNSIDE"
  | "IRREVERSIBILITY"
  | "UNCERTAINTY"
  | "INVENTORY_EXPOSURE"
  | "CUSTOMER_IMPACT"
  | "TIME_TO_RECOVERY";

interface RiskMeasurementContract {
  contractId: string;
  dimension: RiskDimension;
  metricRef: string;
  target: ConstraintTarget;
  horizon: { amount: number; unit: "HOUR" | "DAY" | "WEEK" | "MONTH" };
  valueType:
    | { kind: "MONEY"; currency: string }
    | { kind: "PERCENTAGE" }
    | { kind: "QUANTITY"; unit: string }
    | { kind: "DURATION"; unit: "SECOND" | "MINUTE" | "HOUR" | "DAY" }
    | { kind: "SCALAR"; unit: string };
  aggregation: "SUM" | "MAXIMUM" | "DISTRIBUTION" | "INTERVAL";
  evidencePolicyRef: string;
}
```

There is exactly one contract per dimension for newly authored Actions. Contract IDs and dimensions are unique. The schema recursively rejects fields such as `value`, `score`, `rating`, `probability`, `prediction`, `expectedLoss`, `confidence`, `weight`, `rank`, and `recommendation`.

The dimensions mean:

1. `FINANCIAL_DOWNSIDE`: currency-bound loss exposure over a stated horizon.
2. `IRREVERSIBILITY`: measurable unrecoverable effects, distinct from the declared reversibility contract.
3. `UNCERTAINTY`: the future prediction system's required uncertainty output contract, without an uncertainty value.
4. `INVENTORY_EXPOSURE`: units or money tied to inventory exposure over a horizon.
5. `CUSTOMER_IMPACT`: a population-bound customer harm or disruption measure.
6. `TIME_TO_RECOVERY`: duration required to return to a defined baseline.

Later prediction systems may emit evidence-bound estimates against these contracts. This step only validates the contracts and aggregates them as a six-dimensional vector. It does not define a model, forecast, risk appetite, threshold, or composite risk score. Existing `RISK_LIMIT` hard constraints remain policy gates and may reference a future measured metric; they are not replaced by these contracts.

## Runtime APIs and result boundaries

The public surface adds:

```ts
assessActionDependencies(action, context): DependencyAssessmentResult;
assessPortfolioCompatibility(portfolio, context): PortfolioCompatibilityResult;
describeActionCharacteristics(actionOrCompound, context): CharacteristicsVectorResult;
validateRiskMeasurementContracts(action): RiskContractValidation;
```

The dependency and compatibility contexts contain registries, raw observations, exact timestamps, maximum ages, timing context, and the existing eligibility/constraint/experiment-readiness input bundles. Results contain deterministic fingerprints. Consumers validate those fingerprints and replay from raw context.

Translation ordering is:

1. parse and fingerprint canonical identities;
2. expand compounds and experiment arms;
3. evaluate eligibility and hard constraints from raw evidence;
4. evaluate dependencies from raw evidence;
5. evaluate portfolio compatibility from raw evidence and resolved timing;
6. evaluate compound and experiment readiness;
7. translate supported Actions.

A failure at one gate retains the other diagnostic results where safe. No gate implies provider execution or real-world completion.

## Compatibility and migration

- Historical v1 Actions continue through existing legacy readers.
- Existing v2 serialized Actions parse with empty dependencies/conflicts/risk contracts and absent characteristics.
- Their semantic fingerprints remain byte-for-byte stable.
- New non-empty definitions change the canonical fingerprint.
- Existing `ActionTiming.dependencies` remain authoritative for temporal relations and are not migrated automatically into business prerequisite gates.
- Existing CompoundAction component dependencies remain readable. Exact recognized `REQUIRES` relationships may be exposed through an adapter, but unknown semantics are preserved without guessing.
- Existing domain conflict helpers remain compatibility surfaces. Registered adapters project their typed rules into symmetric portfolio pair checks.
- Existing rollback contracts inform strict reversibility validation; they are not rewritten.

## Architecture boundaries

New definition modules may depend on canonical schemas, timing types, constraints, eligibility schemas, experiment schemas, population references, and core units. They may not import simulation, ground truth, evaluation, prediction, ranking, optimizer, oracle, provider execution, or economic-response internals.

Assessment modules may call public assessors for constraints, eligibility, experiment readiness, timing, compound expansion, and registered domain adapters. The canonical schema must not import assessment or translation modules. Risk contracts must not import future prediction outputs. Portfolio compatibility must not select Actions or calculate objective values.

Dependency-cruiser rules enforce these directions, including a specific prohibition on imports from `action_dependencies`, `action_conflicts`, `action_characteristics`, and `action_risk` into forbidden internals.

## Validation invariants

- IDs are stable, unique, and syntactically valid.
- Exact references include both entity ID and semantic fingerprint.
- No dependency may require another Action's `ELIGIBLE` state.
- Local gates reference definitions that exist on the same canonical Action.
- Dependency graphs are acyclic after compound and experiment expansion.
- Conflict pair keys are unordered, symmetric, and unique.
- Conflict checks require matching target, scope, and overlapping resolved time.
- Unknown time or scope cannot prove compatibility.
- Characteristics contain no second implementation-delay field.
- Monetary and quantity ranges are typed and internally consistent.
- Reversibility declarations cannot contradict known domain effects.
- Cancellation cost is tied to execution stage.
- Risk contracts contain exactly the six named dimensions and no value or score.
- Empty defaults preserve historical v2 fingerprints.
- Runtime evidence is exact, fresh, unambiguous, and order independent.

## Representative examples

### Inventory-gated advertising

An advertising Action targets Product A and includes an inventory hard constraint plus a dependency gate to that constraint. A fresh warehouse receipt for Product B cannot satisfy it. Translation replays the inventory assessment, and insufficient Product A inventory blocks the Action before any paid-media intervention is emitted.

### Eligible winback audience

A lifecycle start-flow Action references its canonical population and an eligibility check for audience membership. Duplicate snapshots, a mismatched population fingerprint, or stale membership evidence leave the dependency unresolved or blocked according to `whenUnknown`.

### Checkout experiment traffic

An `experiment.run` Action uses `SUFFICIENT_ELIGIBLE_TRAFFIC`. The dependency evaluator invokes experiment readiness with the exact population evaluation and sample target. It does not accept a boolean `hasTraffic` claim.

### Contradictory prices

A +10% and a -15% price Action for Product A in CAD over intersecting effective intervals produce one symmetric `CONTRADICTORY_VALUE_CHANGE` pair. The same Actions on different products, currencies, or non-overlapping intervals do not conflict. Missing timing yields `UNKNOWN`, not `COMPATIBLE`.

### Reversibility

An ad-budget change may declare full reversibility when its exact rollback contract has no irreversible effects. A large inventory purchase declares partial or irreversible behavior depending on cancellation stage and supplier commitment. The aggregate remains a vector; no arbitrary cost or risk score is produced.

## Test matrix

Tests cover:

- every dependency kind, exact ACTION and COMPOUND references, unknown references, fingerprint mismatch, self-reference, direct cycles, and cycles through compounds or experiment arms;
- inventory, audience, and traffic examples using existing raw evidence assessors;
- explicit rejection of an `ELIGIBLE` entity-lifecycle dependency;
- missing, stale, duplicate, boundary-mismatched, target-mismatched, and order-reversed evidence;
- symmetric conflict output under reversed Action and declaration order;
- target, scope, currency, and time-window distinctions;
- explicit, domain-derived, resource, policy, and custom conflicts;
- all conflicts reported and no winner, rank, utility, or repair fields;
- price increase/decrease overlap and non-overlap cases;
- implementation cost known/range/unknown, currency mismatch, invalid range, and non-integer minor units;
- operational quantities by resource and unit;
- implementation delay appearing only in ActionTiming;
- cancellation cost at every stage and duplicate/missing stages;
- strict full, partial, and irreversible declarations against domain rollback behavior;
- exactly six risk dimensions, duplicates, omissions, extra dimensions, and leakage fields;
- compound and experiment-arm expansion, shared-member deduplication, vector aggregation, and unknown propagation;
- old v2 parse and fingerprint fixtures, new fingerprint sensitivity, and collection order independence;
- translation/readiness raw-evidence replay and rejection of forged assessment status;
- architecture rules and public package exports.

## Non-goals

This work does not add portfolio optimization, candidate selection, ranking, utility functions, expected value, budgets as objectives, trade-off weights, risk scores, risk predictions, outcome predictions, experiment results, winner selection, causal inference, provider orchestration, execution, automated cancellation, or automatic rollback. It does not infer conflict or dependency semantics from prose, labels, Action IDs, or substring matching.
