# Step 12 — Universal Action Timing

This branch introduces the first implementation slice of the universal Action Timing contract.

## Frozen boundary

Timing represents **when a chosen intervention applies**. It does not decide whether the intervention should happen, when it would be optimal, how valuable it is, or which treatment should be selected.

The invariant is:

> Timing, not timing desirability.

ActionTiming may encode temporal business intent. TimingResolution may deterministically resolve that intent from an approved clock, known events, known Action timing and explicit timing capabilities. Neither may contain optimization, recommendation, future realized state, GroundTruth or evaluator output.

## First implementation slice

The new `src/action_timing` domain provides:

- versioned `ActionTiming`
- explicit SPECIFIED / UNKNOWN / ABSENT / NOT_APPLICABLE value state
- decision time
- requested start
- implementation delay
- effective start intent
- elapsed vs calendar duration
- duration anchors
- persistent Actions
- explicit end rules
- typed state/event/Action termination conditions
- FIRST_OF / LAST_OF / ALL_REQUIRED termination composition
- structured recurrence with explicit bounded/open-ended semantics
- event-relative timing
- trigger-relative timing
- Action-relative timing
- canonical IANA timezone validation
- timing constraints
- timing dependencies and cycle detection
- deterministic canonical serialization and FNV-1a fingerprinting
- separate `TimingResolution`
- fail-closed handling where timezone-aware calendar arithmetic is not yet available
- anti-optimization/future-leakage guards

## Conservative resolution

The resolver currently resolves semantics that are safe with the existing dependency set:

- IMMEDIATE against an approved clock
- absolute UTC timing
- elapsed implementation delays
- elapsed duration
- event-relative elapsed offsets when the event is already known
- Action-relative elapsed offsets when referenced Action times are known

Calendar-local arithmetic remains explicitly unresolved rather than treating one calendar day as 24 hours or inventing DST behavior.

This is intentional until the repository adopts an established timezone/calendar engine.

## Next integration slice

After this contract is green:

1. advance canonical Action schema to the next version;
2. make universal ActionTiming the canonical timing representation for new Actions;
3. retain historical Action schema readability and fingerprints;
4. audit paid media, pricing, promotions, shipping, merchandising, inventory, CRO and lifecycle for parallel timing fields;
5. extend TranslationContext with approved timing inputs/capabilities;
6. preserve timing during Action -> SimulatorIntervention translation;
7. reject unsupported temporal semantics explicitly.
