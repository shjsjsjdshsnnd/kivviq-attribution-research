# Action Space Steps 23–24 — measurable outcomes and adversarial validation

This branch extends the frozen Action Space lineage without changing the meaning of earlier Actions, simulator interventions, eligibility, constraints, conflicts, or compound execution semantics.

## Step 23 — measurable outcomes

A Step 23+ Action declares what evidence could establish whether the decision worked. The contract describes measurement; it never contains a predicted or realized answer.

Each outcome declares:

- a stable outcome identity and metric reference
- a controlled outcome family such as contribution profit, incremental customers, conversion rate, inventory position, retention, revenue, orders, customer value, returns, engagement, delivery, or evidence quality
- its role: primary, secondary, or guardrail
- an explicit measurement scope (action scope, whole business/global, population, entity, or versioned registered scope)
- an explicit value type and unit
- the comparison basis: pre-action baseline, concurrent control, holdout population, registered reference, or absolute metric
- a success criterion: directional, registered threshold, or observe-only
- the earliest meaningful, primary evaluation, and optional long-term measurement horizons
- a versioned source definition and evidence policy

The horizon uses fixed duration units through weeks. Months are intentionally excluded because a calendar month is not a deterministic duration without an anchor and calendar semantics.

Outcome contracts reject answer-bearing fields such as expected profit, predicted lift, counterfactual revenue, true incremental ROAS, ground truth, oracle state, or realized values. Primary outcomes cannot be observe-only, and incremental-customer outcomes cannot use an absolute metric without a comparison reference.

Historical canonical v2 Actions remain readable. The Step 23 validation schema requires an explicit outcome plan for new Actions. A Step 23 compound decision requires both a compound-level outcome plan and an outcome plan on every component Action.

The stable `outcomeId`, `metricRef`, comparison contract, evidence policy, and measurement horizon feed `buildOutcomeMeasurementBridge`, which deterministically projects Action- or compound-bound Decision Ledger outcome keys and Learning signal keys. The bridge is only a typed join contract: it does not implement those later systems, record results, update beliefs, or score decisions.

## Step 24 — Action Space validation

`validateActionSpaceDecision` and `validateActionSpacePortfolio` form an operator-safe pre-execution boundary.

They reject:

- malformed canonical and compound decisions
- invalid or incomplete targets
- impossible parameters already prohibited by the canonical Action schemas
- missing measurable outcomes
- duplicate portfolio identities
- malformed or cyclic compound dependencies
- hidden God-mode, future-state, counterfactual, optimizer-answer, and prediction fields
- incompatible portfolios when supplied to the existing portfolio compatibility engine

Dynamic merchant constraints, eligibility, dependencies, and evidence freshness remain authoritative in their existing engines. Step 24 does not duplicate or weaken those contracts. `validateActionSpaceActionEligibility` composes the existing eligibility engine so a bound hard-constraint or domain-rule violation is rejected explicitly at the Action Space validation boundary before translation; unresolved evidence remains fail-closed.

## Translation invariant

The governing invariant is:

> A valid Action with supported simulator semantics must translate deterministically without changing its business meaning.

For supported actions, tests compare the canonical Step 23 translation against the established historical translation for target, operation, units, scope, timing, duration, and termination.

A valid Action whose business meaning cannot be represented by the simulator remains valid but returns the existing explicit unsupported or engine-boundary result. The validator never invents an approximate intervention merely to make translation succeed.

## Adversarial scale

The focused Step 24 suite deterministically exercises:

- 3,000 valid generated Actions
- 2,000 valid generated portfolios
- 1,500 invalid/adversarial Actions and compounds
- 500 generated no-op translation determinism checks
- 500 generated compound parsing/determinism checks
- explicit portfolio conflicts
- hard-constraint denial before intervention emission
- supported budget, pricing, and promotion semantic-equivalence checks
- the existing campaign-pause translator plus the frozen manual-reversal canonical-migration boundary
- deterministic unsupported-action behavior

The generator is seeded/deterministic so failures are reproducible.

## Compatibility

Earlier canonical Actions do not gain a mandatory field retroactively. Existing fingerprints remain unchanged when `outcomePlan` is absent. New outcome plans participate in canonical fingerprints when present.

No production merchant data, provider credentials, execution system, ranking policy, recommendation score, evaluator answer, or simulator ground truth is introduced into the operator-facing Action Space.
