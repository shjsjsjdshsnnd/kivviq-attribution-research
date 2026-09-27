# Compound actions, preservation decisions, and investigations

Steps 13–15 extend the shared canonical Action envelope. Atomic WHAT, population, and timing remain separate. These contracts describe intent and readiness; they do not run campaigns, choose actions, rank candidates, or estimate commercial value.

## Public modules

- `@kivviq/growth-operator-research/compound-action`: compound schema, serialization, readiness, coordinated timing, guarded rollback, and twelve cross-family fixtures.
- `@kivviq/growth-operator-research/decision-forms`: strict NO_OP, WAIT, and investigation WHAT schemas.
- `@kivviq/growth-operator-research/investigation`: result schema, evidence validation, readiness, and dependency checks.
- `@kivviq/growth-operator-research/action-translation`: canonical atomic and compound translation.

The root export calls the new type `CanonicalCompoundAction`; historical `CompoundAction` remains available for compatibility. A canonical compound embeds complete v2 atomic Actions with stable component IDs and roles. It never replaces population definitions or ActionTiming with a second contract.

## Compound policy and translation

`compoundActionSchema` rejects unknown fields, invalid references, duplicate identities, and cycles across compound dependencies, ordered components, and embedded timing references. Each component retains its own population and timing. SAME/DIFFERENT population relationships compare complete versioned references.

`assessCompoundActionReadiness` reports every component and distinguishes readiness from execution. Temporal coordination uses the shared resolver. COMPLETED requirements need execution evidence; investigation dependencies additionally validate a result against the exact Action identity and fingerprint. A planned end does not prove completion.

`translateCanonicalCompoundAction(action, context)` takes `{ timing, components, readiness }`. `timing` is the common ActionTiming resolution context. `components` maps component IDs to canonical translation contexts containing simulator mappings and population evidence. `readiness` contains per-component evidence and optional constraint evidence. Constraint evidence is bound to the compound fingerprint. Known budget deltas and costs are checked rather than overridden by an approval claim.

All-or-nothing compounds emit no interventions if any component cannot proceed. Best-effort and dependency-gated compounds emit only ready components while preserving every component result and an explicit partial flag. Failed prerequisites gate dependent components. Information tasks and observation requests remain separate from commercial interventions. Intervention provenance retains the compound ID, source Action ID, component index, and component count. Translation is a plan; it does not implement distributed transactions or provider execution.

`assessCompoundRollback` evaluates policies in reverse dependency order and calls existing domain guards. Evidence must describe the original Action and current domain state. Sent communications remain irreversible; compensation is a new action. Missing or conflicting evidence cannot become rollback approval. Runtime failure and rollback execution remain outside this contract.

## NO_OP and WAIT

A NO_OP has `what: { actionType: 'no_op.do_nothing', scope: { kind: 'GLOBAL' } }` plus an ordinary v2 envelope and ActionTiming. Family, channel, campaign, product, SKU, and population scopes are supported. A population scope requires the envelope population reference. A valid NO_OP translates successfully to `interventions: []` with `decisionType: 'NO_OP'`.

WAIT uses `no_op.wait_observe` and an explicit reassessment duration. It returns an observation request retaining timing, fingerprint, and population. It does not become an investigation. Missing, malformed, or unsupported actions never become preservation decisions automatically.

An empty intervention list does not reset campaigns, cancel orders, freeze inventory, or stop customer activity. Regression tests compare real simulator outputs with no new interventions, and demonstrate existing supplier replenishment arriving. The simulator does not execute scheduled promotion expiry: fixture 17 verifies that its existing canonical end remains unchanged, without claiming unsupported execution behavior.

## Investigations

`investigation.inspect` records structured category, targets, required evidence, success criteria, observation window, expected duration, maximum horizon, resources, and separately known or unknown costs. Known costs use nonnegative integer `amountMinor` values in the declared currency. Tracking investigations retain source/event/suspected-class context; anomaly investigations retain metric, target, direction, and comparison context. Suspicions do not assert findings. Population targets use the `envelope-population` marker and the envelope's full population reference.

Execution timing resolves separately from the evidence observation window. Translation requires finite execution within the declared maximum horizon, including timezone and calendar arithmetic. It returns an information task and no commercial intervention. This preserves information-acquisition intent; source access and permissions are assessed separately by `checkInvestigationReadiness`.

`InvestigationResult` is separate from intent. It records collected evidence, coverage, findings, unresolved evidence, completion time, provenance, and RESOLVED/PARTIALLY_RESOLVED/UNRESOLVED/FAILED status. `validateInvestigationResult` checks identity, fingerprint, evidence references, coverage, chronology, and resolution claims. `checkInvestigationDependency` gates only the explicitly requested future action; it never generates or selects that action.

Predicted revenue, profit, lift, ROAS, synergy, information value, recommendation scores, and best-action fields are excluded from canonical intent. Architecture checks prevent these modules from importing simulation truth or evaluation internals.

## Coverage and source boundary

The twelve compound fixtures cover reallocation, promotion/email/paid-media bundles, homepage merchandising, inventory protection, clearance, ordering, differing populations, unsupported capabilities, all-or-nothing blocking, mixed rollback, rollback conflicts, and cycles. Decision fixtures cover global, paid-media, SKU, and population preservation. Investigation fixtures cover the missing facts, tracking audits, anomalies, and reconciliation examples in the supplied brief.

The supplied source ends at “18. NO_OP while an existing purchase”. Fixture 18 interprets this as an existing purchase order arriving, consistent with the earlier natural-evolution requirement. No requirements beyond that truncated line are claimed.

Run `npm run test:decision-forms` for focused coverage and `npm run check` for architecture, type checks, all tests, and build.
