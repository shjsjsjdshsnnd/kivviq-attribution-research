# Action dependencies, conflicts, characteristics, and risk

Steps 19–22 extend the canonical Action envelope with four operator-safe contract families. They let callers reject an unready Action or impossible portfolio before optimization while preserving the boundary between a definition and evidence about the world.

## Boundary model

A **definition** is immutable intent stored on the canonical Action: a dependency, conflict, characteristic, or required risk measurement. An **observation** is raw, source-bound evidence. An **assessment** replays observations at an exact boundary and time. **Readiness** combines those assessments with the existing constraint, eligibility, timing, compound, and experiment checks. **Translation** may consume a bound assessment to produce simulator or experiment-engine tasks. An execution or result records what later happened. None of these contracts claims execution, predicts an outcome, ranks Actions, or chooses a portfolio.

The evaluation boundary is always exact: `DECISION_TIME`, `TRANSLATION_TIME`, or `EFFECTIVE_TIME`. Evidence for one boundary cannot satisfy another. Receipts bind to stable IDs and semantic fingerprints, include source provenance and observation time, and fail closed when missing, stale, duplicated, or ambiguous.

## Dependencies

Dependencies state what must be true before an Action may proceed. There are exactly four definition kinds:

- `ENTITY_LIFECYCLE`: another canonical Action or CompoundAction reaches `STARTED`, `EFFECTIVE`, `COMPLETED`, or `RESOLVED`;
- `HARD_CONSTRAINT_GATE`: one exact hard constraint is `SATISFIED` after replaying its raw evidence;
- `ELIGIBILITY_CHECK_GATE`: one exact eligibility check is `SATISFIED` after replaying its raw evidence;
- `EXPERIMENT_READINESS_GATE`: an exact experiment is `READY` or has `SUFFICIENT_ELIGIBLE_TRAFFIC` after replaying readiness evidence.

For example, scaling Product A advertising can require an inventory-availability constraint to pass. A winback flow can require exact population membership evidence for its audience. A checkout experiment can require its fixed sample and eligible-traffic readiness evidence. These references do not copy caller-supplied status flags. `assessActionDependencies` resolves the exact target, replays the appropriate assessor, validates freshness, and returns deterministic `SATISFIED`, `BLOCKED`, or `UNKNOWN` findings.

Action lifecycle evidence has exactly three event kinds: `STARTED`, `EFFECTIVE`, and `COMPLETED`, tied to the referenced Action ID and fingerprint. `RESOLVED` is established by a valid investigation result rather than a lifecycle event. Compound failures and skips use typed component outcomes. A timestamp, note, or provider callback without the required identity is insufficient. Business prerequisites are separate from `ActionTiming.dependencies`, which continue to define temporal ordering.

## Conflicts and portfolio compatibility

Conflicts are symmetric incompatibility definitions. `assessPortfolioCompatibility` expands compounds and experiment arms, resolves timing, compares exact scopes, and assesses every relevant pair. It rejects duplicate identities, unresolved cycles, contradictory registrations, and conflicting active intervals before translation.

Two price changes for the same product illustrate the rule. “Increase Product A price 10%” and “decrease Product A price 15%” conflict when their half-open effective intervals overlap and their product scopes intersect. A price-relative rule also requires an exact, fresh baseline receipt; the assessor does not infer a baseline from a description. Adjacent intervals do not overlap.

Scope intersection is exact for product, variant, collection, market, channel, placement, surface, flow, and population coordinates. Unknown scope evidence yields `UNKNOWN` or a block according to the definition; it never becomes “compatible” by default. For experiment arms, the portfolio assessor respects exact arm partitions only when a bound partition receipt proves disjoint assignment for the same population version, binding, boundary, and interval. An allocation percentage alone does not prove disjointness.

## Implementation characteristics

Characteristics describe operational consequences without turning them into an objective score:

- implementation cost, grouped into `MEDIA`, `LABOR`, `PLATFORM`, `PROCUREMENT`, `FULFILLMENT`, `CANCELLATION`, and `OTHER` buckets;
- implementation delay through canonical timing;
- reversibility and exact reversal references;
- cancellation cost for every reachable lifecycle stage;
- operational burden in typed resource quantities;
- explicit irreversible effects.

Known values, bounded ranges, `UNKNOWN`, and `NOT_APPLICABLE` remain distinct. Currency amounts are never combined across currencies, and operational units are never silently converted. Compound characteristics preserve member paths, deduplicate explicitly shared execution aliases, sum only compatible cost buckets, and use the dependency graph’s critical path for delay. Experiment characteristics remain arm-stratified so allocation metadata is visible rather than blending control and treatment costs.

An ad-budget adjustment can therefore declare low cancellation cost and an exact reversal Action. A large purchase order can declare procurement cost, inventory-handling burden, longer lead time, stage-specific cancellation charges, and irreversible supplier commitments. These facts remain descriptive inputs for a future optimizer.

## Risk measurement contracts

Risk contracts define outputs a future prediction system must estimate. They contain no arbitrary score, probability, expected value, confidence, weight, rank, recommendation, or risk appetite. Every newly authored complete risk vector contains all six dimensions:

1. `FINANCIAL_DOWNSIDE`: currency-bound loss exposure over a stated horizon.
2. `IRREVERSIBILITY`: measurable unrecoverable effects linked to the reversibility contract.
3. `UNCERTAINTY`: the exact future quantity whose uncertainty must be measured.
4. `INVENTORY_EXPOSURE`: units or money tied to an exact inventory target and horizon.
5. `CUSTOMER_IMPACT`: harm or disruption for an exact population reference.
6. `TIME_TO_RECOVERY`: duration to return to a defined baseline.

`validateRiskMeasurementContracts` validates definitions only. Compound views preserve dimension, member path, execution aliases, and registered interactions. Experiment views preserve arm identity and allocation. They do not sum unrelated measurements or manufacture a composite risk value. Existing `RISK_LIMIT` hard constraints remain policy gates against future measured evidence.

## Compatibility and legacy data

Historical v1 Actions remain readable through existing adapters. Existing v2 payloads default to empty dependencies and conflicts, absent characteristics, and absent risk contracts, preserving their established semantic fingerprints. New non-empty definitions participate in the fingerprint.

Legacy mapping is strict and one way. Typed prerequisite and conflict records map only when their identities, scopes, and operations are complete. Costs require exact amount, currency, and source kind. Operational burden requires a finite typed quantity and controlled unit. Reversibility requires an exact Action ID/fingerprint or registered versioned contract. Free prose, generic effort labels, and risk scores stay unmapped and yield `UNKNOWN` or `ABSENT` rather than guessed semantics.

## Public API and non-goals

The root package exports the operator-safe contracts. Stable subpaths are available at `./action-dependencies`, `./action-conflicts`, `./action-characteristics`, and `./action-risk`. Architecture rules prevent these modules from importing simulator internals, ground truth, prediction, evaluation, ranking, optimization, oracle state, provider execution, or economic-response internals.

This phase does not define an optimizer, risk model, prediction engine, objective value, preferred portfolio, provider workflow, or outcome evaluation. Translation consumes verified assessments; execution and results remain separate downstream records.
