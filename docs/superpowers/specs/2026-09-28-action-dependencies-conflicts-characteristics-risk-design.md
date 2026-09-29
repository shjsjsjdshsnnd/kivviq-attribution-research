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
  readonly riskDimensions: ActionRiskMeasurementContracts | { state: "ABSENT" }; // default ABSENT
}
```

Readers apply these defaults to historical v2 payloads. Semantic serialization omits empty arrays plus absent characteristics and risk states, exactly as it already omits empty hard constraints. Non-empty definitions participate in the fingerprint after canonical sorting. Array order, map insertion order, evidence order, and portfolio input order do not affect fingerprints or assessment fingerprints.

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
      evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
      prerequisite: CanonicalEntityReference;
      requiredState: LifecycleState;
      whenUnknown: "UNKNOWN" | "BLOCKED";
    }
  | {
      dependencyId: string;
      kind: "HARD_CONSTRAINT_GATE";
      evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
      constraintId: string;
      requiredStatus: "SATISFIED";
      whenUnknown: "UNKNOWN" | "BLOCKED";
    }
  | {
      dependencyId: string;
      kind: "ELIGIBILITY_CHECK_GATE";
      evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
      checkId: string;
      requiredStatus: "SATISFIED";
      whenUnknown: "UNKNOWN" | "BLOCKED";
    }
  | {
      dependencyId: string;
      kind: "EXPERIMENT_READINESS_GATE";
      evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
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

The pure schema requires unique dependency IDs and closed, typed references. A hard-constraint gate must use the same evaluation boundary as the constraint definition it references. Eligibility gates instead define the boundary at which the existing check is recomputed; canonical envelope validation enforces these distinct rules once all local definitions are present.

Registry-dependent rules do not belong in the schema. Dependency assessment resolves references, rejects ambiguous identities, rejects self-reference, and detects cycles across Action, CompoundAction, component, and experiment-arm boundaries.

Lifecycle state has an authoritative event meaning. The only positive atomic lifecycle input is an immutable raw event:

```ts
interface ActionLifecycleEvent {
  eventId: string;
  subject: { kind: "ACTION"; actionId: string; actionFingerprint: string };
  eventKind: "STARTED" | "EFFECTIVE" | "COMPLETED";
  occurredAt: string; // UTC-Z
  sourceRef: string;
  provenance: readonly string[];
}
```

Receipt wrappers bind and carry these events; they cannot contain `state`, `status`, or another asserted lifecycle conclusion. For an ACTION prerequisite, every accepted event subject must exactly equal the prerequisite Action ID and fingerprint. For a COMPOUND prerequisite, events must exactly match canonical component Action IDs/fingerprints and assessment derives the compound state. Compound-level lifecycle events are invalid. `RESOLVED` is derived only from the existing bound investigation result, not a lifecycle event. Planned or resolved timing proves no lifecycle state.

Compound lifecycle derives only from exact raw ACTION events for its canonical components and the declared policy. `ALL_OR_NOTHING` reaches `STARTED`, `EFFECTIVE`, or `COMPLETED` only when every component reaches that state. `BEST_EFFORT` reaches `STARTED` when any component starts, but reaches `EFFECTIVE` or `COMPLETED` only when every component that was permitted and attempted has reached that state and every skipped/failed component is explicitly accounted for by raw execution events under the failure policy. `DEPENDENCY_GATED` reaches a state only when every root or dependency-unblocked component required by the graph has reached it; downstream components remain required once their gates become satisfied. `RESOLVED` requires every required investigation component to have an accepted bound result. Missing, conflicting, or duplicate exact events yield unknown/blocked according to the dependency policy. No compound-level event or caller-supplied compound status is authoritative.

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
    | { kind: "ENTITY_LIFECYCLE"; prerequisite: CanonicalEntityReference; events: readonly [ActionLifecycleEvent, ...ActionLifecycleEvent[]] }
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

Lifecycle receipts are verified directly from their nested raw events. Gate receipts are pointers to raw input bundles, not reusable status assertions: assessment replays `assessHardConstraints`, `evaluateActionEligibility`, or `assessExperimentReadiness` and verifies the exact referenced definition. Freshness uses the stricter of the caller maximum age and the receipt or source policy. Multiple exact matches are ambiguous regardless of order.

The selected assessment boundary must equal the dependency definition boundary. For `HARD_CONSTRAINT_GATE` only, that boundary must also equal the referenced hard-constraint definition boundary. An eligibility gate is recomputed at the dependency boundary and its exact result boundary, assessment fingerprint, and complete expected check manifest must match. Cross-boundary evidence cannot satisfy either gate.

`SUFFICIENT_ELIGIBLE_TRAFFIC` requires experiment readiness to expose a deterministic traffic check with an exact experiment fingerprint, population identity/fingerprint, binding time, sample target, eligible count derived from raw membership evidence, and assessment fingerprint. Its raw source policy declares `maximumAgeSeconds`; readiness uses the stricter of that policy and the caller limit. Dependency assessment first replays experiment readiness from raw population and engine inputs, validates its complete manifest and fingerprint, and only then reads the positive `SUFFICIENT_ELIGIBLE_TRAFFIC` check. Absence, stale raw membership/traffic evidence, `UNKNOWN`, duplicate population evidence, or a caller-provided count cannot satisfy the dependency.

The winback example uses only the existing exact `domain.lifecycle.audience_available` eligibility gate. Its raw domain fact must bind the dependent action ID/fingerprint, the exact population target, dependency evaluation boundary, observation time, source, and provenance. Missing, stale, target-mismatched, or duplicate exact facts fail closed. A caller-provided audience snapshot or audience-available boolean does not satisfy this gate.

Every hard-constraint gate boundary equals its referenced hard-constraint definition. Generated legacy or domain eligibility gates are emitted at the dependency boundary, evaluated at that boundary, and accepted only when the recomputed eligibility result has the exact action identity/fingerprint, boundary, assessment fingerprint, and complete expected check manifest.

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
  overlapRule: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP";
  counterparty:
    | CanonicalEntityReference
    | { registryRef: string; code: string };
}
```

Temporal modes are exhaustive:

- `ANY_OVERLAP` compares each Action's full active interval `[resolvedRequestedStart, resolvedEnd)`, including implementation before effect. A missing requested start or end required by the Action shape yields `UNKNOWN`.
- `EFFECTIVE_OVERLAP` compares `[resolvedEffectiveStart, resolvedEnd)` and ignores pre-effect implementation. A missing effective start or required end yields `UNKNOWN`.

No other temporal mode, implicit persistent overlap, or label-derived window is accepted.

`ConflictScope` is a closed coordinate union rather than an arbitrary object:

```ts
type ConflictCoordinate =
  | { kind: "GLOBAL" }
  | { kind: "PRODUCT"; productRef: string }
  | { kind: "VARIANT"; productRef: string; variantRef: string }
  | { kind: "CHANNEL"; channelRef: string }
  | { kind: "PLACEMENT"; channelRef: string; placementRef: string }
  | { kind: "POPULATION"; populationId: string; version: number; definitionFingerprint: string; binding: string; membershipMode: string; snapshotRef?: string }
  | { kind: "RESOURCE"; resourceRef: string; unit: string }
  | { kind: "CUSTOM"; registryRef: string; code: string; version: string };

interface ConflictScope {
  coordinates: readonly ConflictCoordinate[];
}
```

Each full scope groups coordinates by dimension: product/variant, channel/placement, population, resource, and custom registry dimension. Repeating the same dimension in one scope is invalid. Omission of a dimension means unconstrained for that dimension, equivalent to `GLOBAL` on that axis; an explicit `GLOBAL` scope is unconstrained on every axis. Compare every dimension present on either side. If any dimension is provably disjoint, the full scopes are disjoint. If none is disjoint and every shared/restricted dimension is proven overlapping, the scopes overlap. If none is disjoint but any required comparison is unresolved, the result is `UNKNOWN`. A missing custom registry interpretation or population intersection is never guessed. `ScopeIntersectionEvidence` binds the pair key, both exact scope fingerprints, observed time, boundary, provenance, and a positive, negative, or unknown intersection fact. Only exact, fresh, unique evidence may prove a non-structural intersection or disjointness.

The complete coordinate matrix is:

- `GLOBAL` intersects every valid scope. An empty coordinate list is invalid and never aliases `GLOBAL`.
- Repeating a coordinate dimension within one scope is invalid, including two identical coordinates; set-valued meaning requires one versioned custom coordinate whose registry defines the set.
- `PRODUCT(p)` intersects the same product and any `VARIANT(p, v)`; different products are disjoint. Two variants intersect only when product and variant both match.
- `CHANNEL(c)` intersects the same channel and any `PLACEMENT(c, p)`; different channels are disjoint. Two placements intersect only when channel and placement both match.
- `RESOURCE(r, u)` intersects only the same resource and a compatible controlled unit. Different resources are disjoint; incompatible units are invalid/unknown rather than coerced.
- Two exact population references with equal identity, fingerprint, binding, and membership mode intersect. Different frozen snapshots are disjoint only with exact membership/partition evidence; dynamic or otherwise different populations require intersection evidence.
- `CUSTOM` coordinates intersect only through one unique versioned registry interpretation and bound intersection evidence.
- Coordinates of unrelated kinds are disjoint unless one is `GLOBAL` or a versioned registry rule explicitly defines their relationship. No product-to-resource, placement-to-population, or other cross-kind inference is built in.

Exact references support explicitly known conflicts. Registered semantic adapters detect domain contradictions without guessing from labels. Price semantics are closed and exact:

```ts
type PriceOperation =
  | { kind: "SET"; amountMinor: number; currency: string }
  | { kind: "DELTA"; amountMinor: number; currency: string }
  | { kind: "MULTIPLY"; factor: number; baselineRef: string; baselineFingerprint: string; currency: string };
```

Two price Actions are contradictory only when their exact product/variant scopes and currencies intersect and their resulting prices differ. `SET` compares directly. `DELTA` and `MULTIPLY` require one fresh, unique baseline receipt bound to both the baseline reference/fingerprint and pair boundary; otherwise compatibility is `UNKNOWN`. A percentage-like multiplier is never compared across currencies or inferred from a label.

A conflict declared by either side creates one normalized relation identity:

```ts
type NormalizedConflictRelationIdentity = {
  leftEntityKey: string;  // lexicographically smaller exact kind:id:fingerprint
  rightEntityKey: string;
  kind: ConflictKind;
  targetFingerprint: string;
  leftScopeFingerprint: string;
  rightScopeFingerprint: string;
  temporalMode: "ANY_OVERLAP" | "EFFECTIVE_OVERLAP";
  registryIdentity?: { registryRef: string; code: string; version: string };
};
```

The result is symmetric: evaluating `[A, B]` or `[B, A]` returns the same identity, reasons, and status. Semantically identical duplicate declarations normalize to one relation while retaining their source paths. Same endpoints with incompatible kind, target, scope, temporal mode/direction, or registry version are contradictory declarations and make the relation invalid. Duplicate registry matches, self-conflicts, and unknown counterpart identities are ambiguous or unresolved rather than ignored.

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

`assessPortfolioCompatibility` validates exact identities, expands CompoundActions and experiment arms, resolves timing, and evaluates every applicable unordered pair. Expansion never silently deduplicates. The same exact Action reached through two top-level entries or independent component/arm paths is rejected as duplicate execution unless an explicit versioned alias contract declares those paths to represent one execution. Traversal may memoize only repeated visits to the same entity on the same traversal path for cycle handling; it cannot use a global visited set to erase independent execution paths. Conflicting payloads for one exact identity are ambiguous.

Resolved intervals use half-open semantics `[modeSelectedStart, end)`, where `modeSelectedStart` is requested start for `ANY_OVERLAP` and effective start for `EFFECTIVE_OVERLAP`. Two finite intervals overlap when `max(start) < min(end)`. An instantaneous Action occupies its mode-selected instant and conflicts with an interval when `start <= instant < end`; two instants overlap only when equal. Persistent Actions form `[modeSelectedStart, horizonEnd)` for assessment and therefore require a finite horizon. Recurrence expands every occurrence whose instant lies in the horizon or whose half-open interval intersects `[horizonStart, horizonEnd)`, then clips only for comparison while retaining the original occurrence bounds and index. Occurrences ending exactly at horizon start or starting exactly at horizon end are excluded. Truncation by `maxOccurrences` is valid only when the declared recurrence boundary is reached; an assessor safety cap before that boundary yields `UNKNOWN`, not a compatible partial answer. Open-ended or unbounded recurrence without a supplied finite horizon is `UNKNOWN`. All pair logic is symmetric under input reversal.

Any proven conflict yields `CONFLICTING`; otherwise unresolved identity, scope, timing, recurrence horizon, or evidence yields `UNKNOWN`; otherwise the portfolio is `COMPATIBLE`. It reports all conflicts. It never drops an Action, chooses a winner, calculates utility, or repairs the portfolio.

Experiment arms are alternatives for assignment, but that does not make all arm conflicts irrelevant. Writes to global or shared merchant state, shared resources, or non-population coordinates are compared across arms and can conflict. Population-scoped arm Actions may coexist only when exact assignment/partition evidence proves disjoint membership for the compared occurrences. Missing or duplicate partition evidence yields `UNKNOWN`. Pair diagnostics retain experiment ID, arm ID, and nested component path for each endpoint.

Impossible portfolios are rejected before optimizer or translation entry. Translation receives raw compatibility context and replays the assessment. A supplied `COMPATIBLE` object cannot bypass missing, stale, mismatched, or ambiguous evidence.

## Step 21: implementation cost, reversibility, and burden

### Single delay authority

`action.timing.implementationDelay` is the sole representation of implementation delay. `ActionCharacteristics` cannot contain `delay`, `leadTime`, `implementationSeconds`, or any equivalent field. Portfolio aggregation reads the resolved timing value rather than copying it.

### Typed characteristics

```ts
type KnownRangeUnknownOrNA<T> =
  | { state: "KNOWN"; value: T }
  | { state: "RANGE"; minimum: T; maximum: T }
  | { state: "UNKNOWN"; reason: string }
  | { state: "NOT_APPLICABLE"; reason: string };

interface MoneyValue {
  amountMinor: number;
  currency: string;
}

interface OperationalQuantity {
  quantity: number;
  unit: "minutes" | "hours" | "units" | "orders" | "messages" | "placements" | { registryRef: string; code: string; version: string };
  resource:
    | { kind: "STAFF"; resourceRef: string }
    | { kind: "WAREHOUSE"; resourceRef: string }
    | { kind: "FULFILLMENT"; resourceRef: string }
    | { kind: "CHANNEL"; resourceRef: string }
    | { kind: "PLACEMENT"; resourceRef: string }
    | { kind: "CUSTOM"; registryRef: string; code: string; version: string };
}

interface OperationalBurdenLineItem {
  burdenId: string;
  amount: KnownRangeUnknownOrNA<OperationalQuantity>;
}

type ReversalReference =
  | { kind: "ACTION"; actionId: string; actionFingerprint: string }
  | { kind: "REGISTERED"; registryRef: string; code: string; version: string };

type IrreversibleEffect =
  | { kind: "MESSAGE_DELIVERED"; channelRef: string }
  | { kind: "INVENTORY_COMMITTED"; resourceRef: string; unit: string }
  | { kind: "CUSTOMER_EXPOSED"; populationRef: string }
  | { kind: "EXTERNAL_COMMITMENT"; contractRef: string; contractVersion: string }
  | { kind: "CUSTOM"; registryRef: string; code: string; version: string };

type Reversibility =
  | { kind: "FULLY_REVERSIBLE"; reversal: ReversalReference }
  | { kind: "PARTIALLY_REVERSIBLE"; irreversibleEffects: IrreversibleEffect[]; reversal: ReversalReference }
  | { kind: "IRREVERSIBLE"; irreversibleEffects: IrreversibleEffect[] }
  | { kind: "UNKNOWN"; reason: string }
  | { kind: "NOT_APPLICABLE"; reason: string };

interface CostLineItem {
  lineItemId: string;
  category: "MEDIA" | "LABOR" | "PLATFORM" | "PROCUREMENT" | "FULFILLMENT" | "CANCELLATION" | "OTHER";
  amount: KnownRangeUnknownOrNA<MoneyValue>;
}

interface StageCancellationCost {
  stage: "BEFORE_START" | "IMPLEMENTING" | "COMMITTED" | "EFFECTIVE" | "COMPLETED";
  cancellationAvailable: boolean;
  cancellationCost: readonly CostLineItem[];
  compensationCost: readonly CostLineItem[];
  operationalBurden: readonly OperationalBurdenLineItem[];
}

interface ActionCharacteristics {
  implementationCost: readonly CostLineItem[];
  reversibility: Reversibility;
  cancellationCosts: readonly StageCancellationCost[];
  operationalBurden: readonly OperationalBurdenLineItem[];
}
```

These are definitions, so they contain no evidence `sourceRefs`; evidence and provenance belong to later observations. Money values require integer minor units and ISO-style currencies. Ranges require equal units/currencies and `minimum <= maximum`; the shared range builder always requires an explicit compatibility-and-order predicate. Operational quantities require finite non-negative values no greater than `Number.MAX_SAFE_INTEGER`, registered units, and exact resource references. Every burden has a stable `burdenId`, unique within its vector, so aggregation cannot silently double-count an indistinguishable entry. `UNKNOWN` differs from `NOT_APPLICABLE`: unknown means the dimension applies but is not known, while not applicable asserts that it does not apply and requires a reason. Cost vectors retain line-item category and currency instead of collapsing implementation expense into one number.

Stage semantics are explicit. `BEFORE_START` precedes an authoritative start event; `IMPLEMENTING` begins at start and remains cancellable before an external commitment; `COMMITTED` begins at the exact external commitment event and precedes effect; `EFFECTIVE` begins at the effect event and precedes completion; `COMPLETED` begins at completion. Cancellation stops work before an irrevocable commitment or effect. Compensation addresses a commitment or effect after cancellation is no longer possible. Therefore a stage declares `cancellationAvailable`, separate cancellation and compensation line items, and identified burden line items. Duplicate stages are invalid, and every reachable stage must be represented.

Reachability is derived, not author asserted. An instantaneous send reaches `BEFORE_START` then atomically reaches `EFFECTIVE` and `COMPLETED`; it has no cancellable `IMPLEMENTING` interval, and post-send entries describe compensation only. A persistent policy reaches `BEFORE_START`, `IMPLEMENTING` when rollout starts, and `EFFECTIVE` until an explicit completion/withdrawal event; it does not require `COMPLETED` unless its timing defines one. A temporary price Action reaches `BEFORE_START`, `IMPLEMENTING`, `EFFECTIVE`, and `COMPLETED` when implementation, effect, and finite end/completion are distinct. An inventory purchase reaches `COMMITTED` at the supplier commitment event between `IMPLEMENTING` and `EFFECTIVE`; cancellation is unavailable there, and supplier return, resale, or disposal is compensation. Schema/cross-field validation requires exactly the stages reachable from ActionTiming plus typed domain semantics.

Reversibility is strict. A sent message, completed irreversible purchase, or consumed resource cannot be labeled fully reversible merely because a compensating Action exists. `FULLY_REVERSIBLE` requires an exact Action ID/fingerprint or versioned registered reversal contract and no irreversible effects. `PARTIALLY_REVERSIBLE` requires the same exact reversal identity plus at least one typed irreversible effect. `IRREVERSIBLE` requires typed effects and forbids a reversal claim. `UNKNOWN` cannot be treated as reversible; `NOT_APPLICABLE` is reserved for Actions with no implemented state to reverse. Domain adapters enforce known invariants from pricing, inventory, lifecycle, shipping, merchandising, and CRO rollback contracts.

Characteristics are descriptive inputs. The Action Space validates and aggregates them but does not turn them into utility, penalties, preferences, or rankings.

### Compound and portfolio aggregation

Compound expansion produces a vector, never a scalar score:

```ts
interface ActionCharacteristicsVector {
  implementationCostByCategoryAndCurrency: Record<string, MoneyRange>;
  declaredImplementationDelayByMember: Record<string, TimingValue<TemporalOffset>>;
  derivedCriticalPathDelay?: TemporalOffset;
  operationalBurdenByUnitAndResource: Record<string, QuantityRange>;
  cancellationCostByStageAndCurrency: Record<string, MoneyRange>;
  compensationCostByStageAndCurrency: Record<string, MoneyRange>;
  reversibility: "FULLY_REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE" | "UNKNOWN" | "NOT_APPLICABLE";
  memberRefs: CanonicalEntityReference[];
}
```

Money is bucketed by category and currency. Quantities are bucketed only for the same registered unit and resource. Compound totals follow the compound execution policy: parallel branches retain branch buckets, while ordered/dependent branches expose a derived critical path computed from ActionTiming. The derived critical path is a separate assessment output and never rewrites any member's declared `timing.implementationDelay`. Unknown and not-applicable members remain explicit. Range addition preserves lower and upper bounds. Aggregate reversibility is the strictest member state, while the member breakdown remains available. Repeated exact members retain all paths and are rejected as duplicate executions unless a versioned alias contract authorizes one shared execution; authorized aliases are aggregated once with every path retained.

Experiment characteristics are arm-stratified. Each arm retains allocation basis points and its own characteristic vector. Implementation setup shared by the experiment may be reported in a separate shared bucket, but arm costs, burdens, delays, and cancellation costs are not naively summed because arms are alternative assignments rather than a sequential portfolio.

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

interface RiskMeasurementBase {
  measurementId: string;
  metricRef: string;
  horizon: { amount: number; unit: "HOUR" | "DAY" | "WEEK" | "MONTH" };
  aggregation: "SUM" | "MAXIMUM" | "DISTRIBUTION" | "INTERVAL";
  evidencePolicyRef: string;
  sourceDefinitionRef: { registryRef: string; code: string; version: string };
}

type ControlledQuantityUnit =
  | "units" | "customers" | "orders" | "messages"
  | { registryRef: string; code: string; version: string };

type FinancialDownsideMeasurement = RiskMeasurementBase & {
  dimension: "FINANCIAL_DOWNSIDE";
  target: ConstraintTarget;
  valueType: { kind: "MONEY"; currency: string };
  lossBaselineRef: string;
};
type IrreversibilityMeasurement = RiskMeasurementBase & {
  dimension: "IRREVERSIBILITY";
  target: ConstraintTarget;
  valueType: { kind: "QUANTITY"; unit: ControlledQuantityUnit } | { kind: "PERCENTAGE" };
  reversibilityContractRef: string;
  irreversibleEffectKinds: readonly IrreversibleEffect["kind"][];
};
type UncertaintyMeasurement = RiskMeasurementBase & {
  dimension: "UNCERTAINTY";
  target: ConstraintTarget;
  valueType: { kind: "PERCENTAGE" } | { kind: "SCALAR"; unit: { registryRef: string; code: string; version: string } };
  uncertainQuantityRef: string;
  uncertaintySource:
    | { kind: "PARAMETER_METRIC"; parameterRef: string; metricRef: string }
    | { kind: "CUSTOM"; registryRef: string; code: string; version: string };
};
type InventoryExposureMeasurement = RiskMeasurementBase & {
  dimension: "INVENTORY_EXPOSURE";
  inventoryTarget: { productRef: string; variantRef?: string; locationRef?: string };
  valueType: { kind: "MONEY"; currency: string } | { kind: "QUANTITY"; unit: "units" | { registryRef: string; code: string; version: string } };
};
type CustomerImpactMeasurement = RiskMeasurementBase & {
  dimension: "CUSTOMER_IMPACT";
  population: PopulationReference;
  valueType: { kind: "PERCENTAGE" } | { kind: "QUANTITY"; unit: "customers" };
};
type TimeToRecoveryMeasurement = RiskMeasurementBase & {
  dimension: "TIME_TO_RECOVERY";
  target: ConstraintTarget;
  recoveryBaselineRef: string;
  recoveryCriterionRef: string;
  startBoundary: "ACTION_STARTED" | "ACTION_EFFECTIVE" | "DOWNSIDE_OBSERVED" | "REVERSAL_STARTED";
  valueType: { kind: "DURATION"; unit: "SECOND" | "MINUTE" | "HOUR" | "DAY" };
};

type RiskMeasurementContract = FinancialDownsideMeasurement | IrreversibilityMeasurement | UncertaintyMeasurement | InventoryExposureMeasurement | CustomerImpactMeasurement | TimeToRecoveryMeasurement;

interface ActionRiskMeasurementContracts {
  FINANCIAL_DOWNSIDE: readonly [FinancialDownsideMeasurement, ...FinancialDownsideMeasurement[]];
  IRREVERSIBILITY: readonly [IrreversibilityMeasurement, ...IrreversibilityMeasurement[]];
  UNCERTAINTY: readonly [UncertaintyMeasurement, ...UncertaintyMeasurement[]];
  INVENTORY_EXPOSURE: readonly [InventoryExposureMeasurement, ...InventoryExposureMeasurement[]];
  CUSTOMER_IMPACT: readonly [CustomerImpactMeasurement, ...CustomerImpactMeasurement[]];
  TIME_TO_RECOVERY: readonly [TimeToRecoveryMeasurement, ...TimeToRecoveryMeasurement[]];
}
```

There are exactly six top-level dimension keys for newly authored Actions and each contains one or more measurements of that dimension's concrete type. Every branch is a strict object: financial measurements require only their loss/currency link, irreversibility requires its contract/effect links, uncertainty its uncertain quantity, inventory its inventory target, customer impact its exact population, and recovery its baseline. Fields from another branch are rejected. Measurement IDs are unique across the six vectors. The schema recursively rejects fields such as `value`, `score`, `rating`, `probability`, `prediction`, `expectedLoss`, `confidence`, `weight`, `rank`, and `recommendation`.

The dimensions mean:

1. `FINANCIAL_DOWNSIDE`: currency-bound loss exposure over a stated horizon.
2. `IRREVERSIBILITY`: measurable unrecoverable effects, distinct from the declared reversibility contract.
3. `UNCERTAINTY`: the future prediction system's required uncertainty output contract, without an uncertainty value.
4. `INVENTORY_EXPOSURE`: units or money tied to inventory exposure over a horizon.
5. `CUSTOMER_IMPACT`: a population-bound customer harm or disruption measure.
6. `TIME_TO_RECOVERY`: duration required to return to a defined baseline.

Later prediction systems may emit evidence-bound estimates against these contracts. This step only validates the contracts. Compound views group contracts by dimension and exact member path; experiment views remain arm-stratified with allocation metadata. They do not naively add measurements or manufacture an aggregate risk value. This step does not define a model, forecast, risk appetite, threshold, or composite risk score. Existing `RISK_LIMIT` hard constraints remain policy gates and may reference a future measured metric; they are not replaced by these contracts.

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
- Legacy adapters are explicit and one-way: recognized legacy prerequisite expressions map only to an exact local constraint/check gate; recognized domain conflicts map only when typed targets and operations are complete; legacy costs map only with currency/unit metadata; rollback declarations map only with exact reversal identity; all other legacy fields remain preserved as legacy data and produce `UNKNOWN`/`ABSENT` rather than guessed native semantics.
- Adapter output is tested against historical fixtures and cannot change their stored serialization or fingerprint. Native writers never emit legacy shapes.

Legacy characteristic mapping is lossless and limited to seven cost buckets: paid spend → `MEDIA`; measured staff/service time with a money amount → `LABOR`; provider/license fees → `PLATFORM`; inventory acquisition → `PROCUREMENT`; shipping/handling → `FULFILLMENT`; an explicit pre-effect cancellation charge → `CANCELLATION`; and typed monetary cost with none of those exact source kinds → `OTHER`. Each mapped line retains the original legacy field reference, amount, and currency in adapter provenance outside the definition. A value without currency, a currency conversion, a negative/ambiguous amount, or free prose does not map.

Legacy delay maps only into `ActionTiming.implementationDelay`; it never creates a characteristic field. Operational burden maps only from typed finite quantities with exact resource and controlled unit: staff/service time, inventory units handled, orders, messages, or placements. Money-only costs, narrative effort, generic complexity, scores, and unregistered units are excluded. Legacy reversibility maps only from an exact Action ID/fingerprint rollback reference or a versioned registered rollback contract; compensating prose does not map. Legacy cancellation characteristics default to `UNKNOWN` for every reachable stage unless typed stage-specific cancellation and compensation data exists. No legacy prose, risk label, score, or free-form objective is converted into a risk metric or measurement contract.

## Architecture boundaries

Pure definition modules may depend only on lower-level core units and shared leaf schemas. They do not import the canonical envelope, assessment, readiness, translation, simulation, ground truth, evaluation, prediction, ranking, optimizer, oracle, provider execution, or economic-response internals. The canonical envelope may import the four definition schemas. Assessment modules may import the canonical envelope and public evidence/readiness contracts. Translation may import assessment APIs. Imports never point back upward.

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
- New risk contracts contain exactly the six named top-level dimensions, at least one measurement per dimension, and no value or score.
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
- ACTION-only raw immutable lifecycle events, exact prerequisite/component subject matching, rejection of compound-level events and wrapper state claims, and lifecycle derivation for all three atomicity policies;
- inventory and traffic examples using existing raw evidence assessors, including source maximum-age and stale-traffic cases;
- winback through only `domain.lifecycle.audience_available`, with action/fingerprint/target/boundary/freshness/duplicate checks and rejection of snapshot/boolean claims;
- explicit rejection of an `ELIGIBLE` entity-lifecycle dependency;
- missing, stale, duplicate, boundary-mismatched, target-mismatched, and order-reversed evidence;
- symmetric conflict output under reversed Action and declaration order;
- the full dimension-grouped coordinate matrix, including omitted, repeated, all-overlap, one-disjoint, and unresolved multi-coordinate cases;
- both temporal modes including requested/effective divergence, half-open/instant/persistent mode-selected starts, recurrence horizon truncation, and safety-cap unknown behavior;
- normalized relation identity, contradictory declarations, registry ambiguity, alias contracts, duplicate top-level/independent paths, and path-local memoization;
- explicit, domain-derived, resource, policy, and custom conflicts;
- all conflicts reported and no winner, rank, utility, or repair fields;
- price increase/decrease overlap and non-overlap cases;
- implementation cost known/range/unknown, currency mismatch, invalid range, and non-integer minor units;
- operational quantities by resource and unit;
- implementation delay appearing only in ActionTiming;
- cancellation versus compensation and exact reachable stages for instantaneous send, persistent policy, temporary price, and committed inventory;
- strict full, partial, and irreversible declarations against domain rollback behavior;
- exactly six top-level risk dimensions, one-or-more measurements per dimension, duplicate measurement IDs, omissions, extra dimensions, and leakage fields;
- strict risk branch links for loss/recovery baselines, recovery criterion/start boundary, population, inventory, uncertainty source, irreversibility, and controlled/versioned units;
- compound and experiment-arm expansion, repeated-member path retention, alias-authorized shared execution, duplicate-path rejection, vector aggregation, and unknown propagation;
- historical fingerprints with omitted and explicit empty/absent defaults, fingerprint sensitivity for every non-empty semantic field, and order independence for every set-like collection;
- old v2 parse and fingerprint fixtures, new fingerprint sensitivity, and collection order independence;
- lossless seven-bucket legacy cost mapping, timing-only legacy delay, burden inclusion/exclusion, exact reversal mapping, unknown cancellation defaults, and rejection of prose-to-metric mapping;
- translation/readiness raw-evidence replay and rejection of forged assessment status;
- architecture rules and public package exports.

## Non-goals

This work does not add portfolio optimization, candidate selection, ranking, utility functions, expected value, budgets as objectives, trade-off weights, risk scores, risk predictions, outcome predictions, experiment results, winner selection, causal inference, provider orchestration, execution, automated cancellation, or automatic rollback. It does not infer conflict or dependency semantics from prose, labels, Action IDs, or substring matching.
