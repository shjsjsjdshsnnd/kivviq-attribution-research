# Compound, NO_OP, WAIT and Investigate Implementation Plan

> For agentic workers: use subagent-driven-development, test-driven-development and independent review.

Goal: complete Steps 13–15 as immutable canonical decision forms without evaluation, ranking, execution or provider orchestration.
Architecture: extend CanonicalAction WHAT with structured NO_OP/WAIT/investigation; compose canonical atomic components in CompoundAction. Components own population/timing, while compound relationships add constraints. Separate schema, readiness, result, rollback assessment and translation. Historical readers remain compatible.
Tech stack: TypeScript, Zod, Temporal, Vitest.

Approved design: extend merged Steps 10–12, selectively reuse older compound concepts, exclude CompoundActionEvaluation. User attachment ends at fixture 18; interpret the partial purchase example as a previously ordered inventory receipt, consistent with section 8. Cover every supplied section and add investigation fixtures from the explicit examples. Do not claim unseen remainder was implemented.

1. Add strict NO_OP/WAIT scopes and immutable structured investigation WHAT schemas; tests first reject outcomes/results/PII and missing questions.
2. Add InvestigationResult and readiness with explicit action references, evidence coverage, findings, completion, unresolved questions and permission/source/target/metric blockers. All runtime states stay outside actions.
3. Integrate canonical envelope, fingerprints and independent time/evidence windows. Reuse universal timing for duration/recurrence and population references for consent investigations.
4. Add strict CompoundAction schema, component identity/role, ordering/concurrency, typed acyclic dependencies, constraints, failure and rollback policies, measurement and provenance.
5. Add compound deterministic readiness and timing checks using shared TimingResolution; UNKNOWN never silently becomes READY. Keep all components reported for every atomicity policy.
6. Add compound rollback assessment requiring domain-specific readiness evidence, exact action identities, completed/dependent subsets and reverse dependency order. Sent communications remain irreversible and conflicts remain blocked.
7. Add translation: NO_OP -> TRANSLATED [], WAIT remains distinct, INVESTIGATE -> TRANSLATED [] plus explicit information-acquisition intent; never substitute these for unsupported actions. Cross-family compound translation retains component/compound causal IDs and never treats translatability as execution/completion.
8. Add all supplied compound/NO_OP fixtures and structured investigation examples; prove ordinary simulation evolves under empty interventions, and preserve unresolved/unsupported states.
9. Add architecture/export/CI guards, docs and migration examples; keep older evaluation code out.
10. Run focused red/green tests, independent specification and code reviews, then architecture, typecheck, full inherited suite and build. Create stacked draft PR and verify CI.

Ownership: worker A src/decision_forms and src/investigation plus their tests; worker B src/compound_action plus its tests. Controller owns canonical_action integration, action_translation, shared configuration, acceptance fixtures and regression tests. No overlapping edits or worker commits.
