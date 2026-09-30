# Step 5 — Business State integration and local-day comparisons

Status: implemented increment; validation gates below apply. Not a completed 27-step engine, not frozen, not deployed.

This progress record supersedes the Stage B **not implemented** status in the original `step5-diagnosis-plan.md`, which records the initial foundation increment. Remaining domain, hypothesis, statistical, seasonal-adjustment and full scenario-validation requirements in that plan still apply.

## What changed

- Added `src/diagnosis_integration/business-state.ts`: `projectBusinessState` and `diagnoseBusinessState` consume the canonical Business State v1 snapshot plus explicit evidence metadata. The original canonical schema, registry and collector are unchanged.
- The projection verifies snapshot ID, merchant, asOf, currency, timezone, scope, population, source, source period, metric definition and value encoding. It rejects ambiguous source rows and value/coverage disagreements. It checks canonical metric units, authoritative sources and AOV/CVR dependency formulas against the registry.
- Source completeness and data maturity require evidence-specific metadata; `snapshot.evidenceComplete` is not used as proof that an individual source scan is complete. Missing metadata returns unknown findings rather than guessed scope, coverage or currency units.
- Totals in major currency units are converted to integer minor units only when explicitly declared. Floating representation noise is tolerated, but genuine sub-minor-unit totals and unsafe ranges are rejected. Fractional AOV is retained for reconciliation.
- AOV and CVR are recomputed only from verified, comparable source operands. Conflicting stored derived values are rejected. Source IDs, metadata evidence IDs and deterministic calculation lineage are preserved.
- Unsafe source values are quarantined before producing derived metrics, including the public projection API. The core also removes derived values/graph nodes when their source lineage is invalid.
- Added merchant-local date handling to the diagnosis core. `lastCompleteLocalDays(asOf, timezone, days)` excludes the current local day, preserves actual UTC evidence boundaries and supports DST weeks of 167/169 hours and fractional-hour changes.
- Previous windows must remain adjacent. YoY requires an explicit same-calendar-date or 52-week convention. Unequal day counts, ambiguous/nonexistent midnight and unresolvable leap-day comparisons fail closed. No automatic Feb 29-to-Feb 28 substitution.
- The output reports weekday-mix and elapsed-hour differences. Alignment is **not** seasonal adjustment, a statistical test, or causal evidence. Legacy calls without calendar context retain their elapsed-duration and UTC alignment checks.
- On this feature branch only, fixed the two existing Business State test typing errors: omit undefined `domains` and use bracket access for `knownMetrics["revenue_net"]`. No test assertions or canonical metric semantics were weakened.

## API

```ts
import { lastCompleteLocalDays } from "../src/diagnosis/index.js";
import { diagnoseBusinessState } from "../src/diagnosis_integration/index.js";

const periods = lastCompleteLocalDays(asOf, merchantTimezone, 7);
// Collect the canonical snapshot for periods.current / periods.reference.
// Supply BusinessStateProjectionContext with source-backed metadata for each
// atomic revenue, orders and sessions observation. All materiality thresholds
// are explicit; monetary thresholds in the diagnosis policy use minor units.
const result = diagnoseBusinessState(snapshot, projectionContext);
```

Metadata contains `metadataEvidenceId`, the atomic `evidenceId`, merchant, source, observedAt, period bounds, scope/population, canonical definition ID, measurement version, currency/encoding, coverage, dataThrough and completeness flags. It is additional provider evidence, not a model's inference. The library verifies bindings and consistency; a governed collector is still responsible for obtaining genuine source metadata. It does not cryptographically authenticate attestations or fetch live platforms.

## Validation gates

```sh
node scripts/test-diagnosis.mjs
npm exec -- vitest run tests/diagnosis_integration --maxWorkers=1
npm run check
```

The original 93-test foundation suite remains intact. New integration tests call the actual Business State collector with synthetic source evidence, then exercise the adapter and core together. Calendar tests cover DST, current-day exclusion, YoY conventions, leap days, ambiguous/nonexistent midnight, fractional offsets and 280 deterministic generated date/timezone combinations.

The local environment cannot clone GitHub because external DNS is unavailable. The pure calendar implementation was locally compiled and its 33 tests passed on Node 22.16.0 / TypeScript 5.8.3. Repository dependency installation, complete core/integration execution and full regression/build are verified through GitHub Actions; consult the PR's latest verified run for those results rather than treating a test definition as a passing test.

## Remaining release blockers

No live-provider metadata collector or production application wiring is included. Channel, customer, product, pricing/promotion, profitability, inventory, lifecycle and funnel diagnoses remain to be implemented. Competing hypotheses, bounded follow-up retrieval, seasonal/trend/statistical models and full simulator adversarial validation remain incomplete. Confidence remains an evidence-quality rubric rather than calibrated causal probability.

Next functional milestone: governed profitability decomposition and source-complete channel diagnosis, reusing this evidence boundary and retaining explicit unknowns and non-causal classifications.
