# Lifecycle, Targeting and Timing Implementation Plan

> For agentic workers: use subagent-driven-development, test-driven-development and independent review.

Goal: complete the approved WHAT / WHO / WHEN contract without desirability or simulated-effect leakage.
Architecture: preserve legacy Action 1.x readers and fingerprints. Introduce a strict versioned canonical Action using the independent population and universal timing packages; legacy family parameters are explicitly adapted with their temporal fields excluded from the new representation. Translation fails closed when any semantics lack simulator support.
Tech stack: TypeScript, Zod, Vitest, Temporal polyfill for calendar arithmetic.

1. Establish boundary: src/canonical_action holds the new versioned Action and explicit legacy adapter; src/population and src/action_timing remain independent. Add boundary tests before implementation.
2. Canonical lifecycle: strict lifecycle WHAT union for send, start/stop/modify flow, adjust frequency/contact policy and rollback. Preserve EMAIL/SMS and provider-neutral purposes.
3. Intervention semantics: validate cadence periods, separate contact caps, rollback conflict guards, and irreversible sends. Test SET/DELTA and cross-channel caps.
4. Flow structure: stable IDs, ordered steps, shared step ActionTiming, population references, suppression and deterministic purchase exit. Validate add/remove/replace step changes and stop state.
5. Population definitions: strict recursive structural rules, explicit windows and currency, composition, universe, provenance and deterministic fingerprints.
6. Population evaluation: complete three-valued logic, exclusion precedence, missing evidence, strict output schemas rejecting desirability fields.
7. Binding and snapshots: five evaluation bindings, frozen/dynamic modes, controlled IDs only, strict snapshots and fingerprint identity tests.
8. Universal timing: strict existing timing schema, Temporal calendar/DST engine, duration and recurrence support. Keep intent immutable.
9. Resolution: dependencies, embedded-reference cycles, missing-context propagation, bounded occurrences retaining Action identity, constraint/termination handling.
10. Integration: 30 named fixtures, required identity distinctions, fail-closed simulator translation, architecture rules, public exports, documentation and full inherited suite.

Ownership: population worker owns src/population and tests/population; timing worker owns src/action_timing and tests/action_timing. Controller owns canonical_action, lifecycle integration, package configuration, architecture and acceptance fixtures. Workers do not modify shared configuration or commit while work is concurrent.

Verification sequence: each worker writes behavior tests and records expected failure, implements, runs targeted Vitest with --maxWorkers=1. Controller runs architecture, typecheck, complete suite with one worker, build, then independent spec and quality review. Any discovered defects get regression tests and targeted rechecks before final full verification.
