# Step 13 — Canonical Compound Actions

A CompoundAction is one coordinated business decision composed only of valid canonical atomic Actions plus explicit relationships between them.

## Boundary

CompoundAction describes composition. It does not optimize, recommend, predict, execute, transact, assign experiments or evaluate outcomes.

Atomic identity remains authoritative. Every component retains its own Action ID, target, parameters, timing, constraints, reversibility, risk and measurement semantics.

## Canonical coordination

The Step 13 contract defines:
- separate compound and component identity
- ordered vs unordered components
- START_TOGETHER / EFFECTIVE_TOGETHER / INDEPENDENT_TIMING
- typed START_AFTER / EFFECTIVE_AFTER / COMPLETE_AFTER / REQUIRES / END_WITH dependencies
- dependency graph validation and cycle rejection
- generic cross-family composition
- typed conservation and compound hard constraints
- explicit population INHERIT / OVERRIDE / NOT_APPLICABLE
- explicit timing INHERIT / OVERRIDE / DEPENDENT using Step 12 ActionTiming
- completion, atomicity and failure policy
- compound rollback policy while preserving domain-specific atomic rollback
- separate CompoundActionReadiness and CompoundRollbackReadiness
- deterministic flattening preserving compound/component/atomic identity
- deterministic semantic fingerprint and canonical serialization
- per-component compound translation that reuses atomic translators
- unsupported components are reported, never silently omitted

## Canonical budget reallocation

The reference fixture represents CAD 2,000/week Meta -> Google as:
- Meta DELTA -200,000 minor CAD/week, role SOURCE
- Google DELTA +200,000 minor CAD/week, role DESTINATION
- EFFECTIVE_TOGETHER
- ALL_OR_NOTHING
- SUM_MONETARY_DELTAS_EQUALS 0

The existing paid-media atomic Actions remain unchanged.

## Population dependency

The repository branch `action-space/step11-customer-targeting` still points to the frozen Step 10 head. Therefore Step 13 exposes explicit population-binding references but does not invent or duplicate the missing Step 11 PopulationDefinition/PopulationEvaluation implementation.

When Step 11 is implemented, these references must bind to that frozen canonical population contract rather than a new compound-specific population model.
