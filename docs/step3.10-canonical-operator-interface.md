# Step 3.10 — Canonical Operator Interface

## Purpose

Step 3.10 freezes one universal execution boundary for every existing baseline and every future Kivviq decision system.

The canonical architecture is:

`ObservableBusinessState → CanonicalOperator → Action[] → ConstraintValidation → Execution → Outcomes → Evaluation`

This step does not change any frozen policy logic.

## Frozen lineage

- Step 3.9 parent: `772546d5d6c23eada255d1b5f7997a1a04896ca2`
- Step 3.1 contract commit: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 contract fingerprint: `fnv1a64:b1cc22917a3e566b`
- Action Ontology: `1.6.0`

Existing Step 3.2–3.9 implementation/configuration fingerprints remain unchanged.

## Interface version

Canonical interface:

`2.0.0`

Frozen schemas:

- canonical input schema `1.0.0`
- canonical decision schema `1.0.0`
- canonical metadata schema `1.0.0`
- canonical capability schema `1.0.0`
- provenance schema `1.0.0`

Breaking interface changes require a new interface version.

## Legacy compatibility

Steps 3.2–3.9 were already built around the same conceptual `decide(input) → { actions }` boundary, but their frozen metadata identifies legacy interface `1.0.0`.

Step 3.10 therefore uses a generic compatibility adapter:

`Frozen v1 operator → v2 canonical adapter → evaluator`

The adapter does not alter:

- operator ID/version
- implementation fingerprint
- configuration fingerprint
- policy algorithm
- Action semantics
- observation access

Legacy audit functions continue to receive their original decision ordering, while the canonical execution envelope uses deterministic Action ordering.

Native future v2 operators bypass the legacy adapter and use the same evaluator path directly.

## Canonical input

The v2 input contains only legally observable/evaluator-governed decision state:

- opportunity ID
- decision timestamp
- governed observation records
- per-decision legal Action space
- mutual exclusion groups
- decision context: sequence + trigger
- frozen business-constraint contract reference
- provenance fingerprints

Provenance includes:

- evaluation-contract fingerprint/version
- observation fingerprint
- legal Action-space fingerprint
- Action Ontology version

The input contains no direct:

- simulator object
- execution function
- GroundTruth
- future events/outcomes
- evaluator-only metrics
- latent customer state
- counterfactual outcomes

Constraint assessment/execution remains outside the operator.

## Canonical output

Every v2 operator returns one typed decision envelope:

- schema version
- canonical `Action[]`
- canonical operator metadata
- canonical decision metadata

The interface supports:

- `[]`
- one Action
- multiple Actions

No new compound-action execution semantics are introduced.

## Metadata

Canonical metadata records:

- operator ID
- operator version
- operator family
- description
- implementation fingerprint
- configuration fingerprint
- legacy interface version when adapted
- supported evaluation-contract identity
- supported Action Ontology version
- capability declaration
- interface-adapter fingerprint

The original frozen implementation/configuration identities remain authoritative.

## Capabilities

Capabilities restrict what an operator may emit.

They declare:

- Action domains
- zero/one/multiple Action support
- maximum Actions per decision
- deterministic or seeded-stochastic randomness semantics

Capabilities never grant additional observation access.

Current baselines are registered with their existing emission domains.

Future native-v2 decision systems may declare broader multi-domain capabilities without changing the interface.

## Action ordering

Multiple returned Actions must already use canonical deterministic ordering:

1. Action type
2. canonical target serialization
3. canonical parameter serialization
4. Action ID

Legacy operators are explicitly normalized by the adapter before validation.

Native v2 operators that return noncanonical ordering are rejected rather than silently reordered.

## Invalid-output behavior

The evaluator/interface rejects deterministically:

- malformed decision envelope
- unsupported output fields
- malformed decision metadata
- invalid canonical Action
- missing/invalid target or parameter
- non-finite values
- duplicate Action IDs
- duplicate semantic Actions
- conflicting same-type/same-target Actions
- mutual-exclusion-group violations
- Action domains outside declared capabilities
- output count above capability limit
- noncanonical Action ordering

No arbitrary output is silently coerced into a valid Action.

## Constraint ownership

Operators propose Actions.

The evaluator remains responsible for:

- canonical Action validation
- legal Action-space validation
- business-constraint assessment
- accepted/rejected/modified disposition
- execution handoff

Operators do not receive the constraint assessor, simulator executor or outcome state.

## Deterministic replay

For deterministic operators:

`same implementation + same configuration + same canonical input → identical Action[]`

The v2 input and decision envelope both receive deterministic fingerprints.

Future stochastic operators must declare:

`seeded_stochastic + operator_internal seed`

and record that seed through evaluation provenance.

## Conformance suite

One reusable shared suite is applied to all existing frozen baselines:

- DO_NOTHING
- STATUS_QUO
- five advertising heuristics
- four inventory heuristics
- four pricing/promotion heuristics
- three merchandising heuristics
- three greedy operators
- six flawed optimizers

Total existing baseline operators under shared conformance: 27.

The shared suite validates:

- v2 adaptation
- frozen implementation identity preservation
- canonical input acceptance
- immutable governed input
- canonical Action output
- capability compliance
- deterministic replay
- complete invocation provenance
- same evaluator path

## Future-operator substitution

A synthetic native-v2 future Kivviq decision system is evaluated through the exact same `invokeOperatorAtDecision` path as:

- DO_NOTHING
- STATUS_QUO
- MAX_ROAS
- HIGHEST_CONVERSION_RATE

No operator-family switch exists in evaluator execution.

The evaluator only requires a canonical operator boundary.

## Lineage rule

If a future frozen operator cannot be adapted without changing its decision semantics, it must not be silently rewritten.

That incompatibility requires an explicitly versioned successor.

For current Steps 3.2–3.9, no such incompatibility was required: the generic adapter preserves their decision logic and identities.


## Frozen verification

Validated head:

`a25b0c5683077ac6cfbd6a5000142eed4ddd538f`

GitHub Actions run:

`35995888503`

Results:

- Architecture boundary: PASS
- Strict TypeScript: PASS
- Focused canonical-interface conformance: 114/114 tests, 1/1 file
- Full inherited + Step 3.10 suite: 778/778 tests, 83/83 files
- Build: PASS
- Frozen interface fingerprint emission: PASS

The inherited DO_NOTHING output fingerprint remains the frozen Action-only evaluator fingerprint. The v2 canonical decision-envelope fingerprint is available separately through the interface helper and does not replace historical evaluation provenance.

The inherited Step 3.4 90-opportunity artifact test retains its full workload with a test-local 15-second budget; operator/evaluator runtime semantics are unchanged.

## Frozen schema fingerprints

- canonical interface version: `2.0.0`
- interface schema fingerprint: `fnv1a64:771759d019aefa24`
- input schema fingerprint: `fnv1a64:9baa3fb770f593ae`
- output schema fingerprint: `fnv1a64:7c852fa831cf12a8`
- metadata schema fingerprint: `fnv1a64:b199f4d287d99937`
- capability schema fingerprint: `fnv1a64:57fc390e508fd575`

Dependencies:

- Step 3.1 commit: `c74e9a4ba32f16aa016f06782cbb60e07e765af6`
- Step 3.1 contract fingerprint: `fnv1a64:b1cc22917a3e566b`
- Step 3.9 parent: `772546d5d6c23eada255d1b5f7997a1a04896ca2`
- Action Ontology: `1.6.0`

## Completion gate

Step 3.10 is complete when this validated head is frozen.

The final boundary is:

`Observable Business State → Canonical Operator v2 → Action[] → evaluator-owned validation → execution → outcomes → evaluation`

Every existing baseline reaches that boundary through the same evaluator invocation path. Frozen v1 operators are adapted generically without changing their policy logic or implementation/configuration identity. Future native v2 Kivviq decision systems can use the same path without adding operator-family branching.
