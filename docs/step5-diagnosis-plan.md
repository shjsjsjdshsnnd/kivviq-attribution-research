# Step 5 — Diagnosis Engine: understand what changed

Status: **started; foundation implemented; not frozen; not production-ready**.
Version: `diagnosis/0.1.0`.
Branch: `diagnosis/step5-foundation`.
Pinned parent: `business-state/steps1-25` at `97786904c290684303f478b2e6e7a2a3c3ac7cf9`.
This is a stacked increment, not a change to main, frozen baselines, simulator semantics or production Kivviq.

## Architecture and governing decisions

```text
Canonical Business State + governed source evidence
  -> explicit observable projection / compatibility adapter (next increment)
  -> quality + comparability gates
  -> material changes
  -> arithmetic decompositions and domain diagnoses
  -> competing hypotheses + bounded evidence retrieval (later)
  -> non-overlapping explanation ledger + unresolved uncertainty
  -> typed diagnosis report + evidence graph
  -> deterministic explanation
  -> downstream opportunity / decision / action engines (later)
```

The engine never reads simulator truth, oracle answers, future observations or merchant secrets. Truth belongs to the evaluator. Simulator scenarios and expectation labels in tests are separate from engine input.

A revenue identity can be fully reconciled without knowing its causal explanation. Keep `arithmeticResidualMinorUnits` separate from `causallyExplainedMinorUnits`. In this increment, causal explanation is always `not_established`, and causally explained money is always `null`, not an invented zero or 100%.

No LLM, provider calls, action execution or broad analyst invocation is used in the foundation. It is a deterministic library. A `DERIVED` source label is not sufficient: AOV and CVR must have comparable, usable operands and verified identities.

## Build sequence

### A. Evidence-safe diagnosis core — implemented foundation

Draft typed input/output contract; strict observable-only runtime boundary; comparison and commercial materiality; orders × AOV and compatible sessions × CVR × AOV allocations; explicit residuals; provenance graph; evidence-quality confidence; deterministic wording; unknown-answer behavior; synthetic deterministic/adversarial tests.

The rate/mix helper is implemented and tested but is not connected to merchant segment evidence. It requires a complete, mutually exclusive partition from its caller. It must not yet be described as an integrated mix-diagnosis feature.

### B. Business State integration and reliable time context — next

Build an explicit adapter to the canonical snapshot and metric registry. Do not silently enrich the frozen snapshot with guessed metadata or change upstream contracts. Require source-backed scope, population, definition, measurement-version, completeness, coverage, currency and availability metadata. Bind derived calculations to their underlying evidence references.

The inspected Business State snapshot does not carry all of these dimensions. The core therefore accepts a separate observed-evidence projection, **not the raw Business State snapshot**. The next adapter must fail closed when these dimensions cannot be established. Add registry-conformance tests so canonical definitions and authorities cannot drift from this supported subset.

Time alignment must use the merchant timezone and explicit half-open windows. Add matched local-day periods, DST transitions, leap days, weekday mix, YoY conventions, historical baseline/trend support, refund/attribution maturity and calendar-adjusted comparisons. Publish raw and adjusted comparisons separately. The current core deliberately requires equal elapsed durations, adjacent previous periods and exact prior-year UTC calendar dates; unsupported calendar comparisons abstain.

### C. Domain diagnosis modules

Add channel, customer, product, pricing/promotion, profitability, inventory and lifecycle diagnosis modules. Each returns the same typed change/driver/uncertainty structure with explicit scope and coverage. Do not add domain-specific narratives before corresponding evidence and test scenarios exist.

Profit must use governed accounting definitions: reconcile revenue to COGS and variable costs; never subtract refunds twice if already netted from revenue. Distinguish whole-store contribution, attributed channel contribution and experimentally estimated incremental contribution. Missing costs remain unknown, not zero.

### D. Funnel, mix and interacting explanations

Add session-based funnel cohorts and complete disjoint segment evidence. Treat event counts and unique sessions as different quantities. Integrate the tested rate/mix helper only after scope, segment universe, identity and denominator checks. Handle entering/exiting segments separately; never assign zero-denominator rates.

Keep explanation partitions explicit. Orders/AOV and channel/customer/product breakdowns are alternative or nested views; do not add their totals together. Maintain signed offsets and distinguish shares of net change from shares of gross movement.

### E. Hypotheses, external context and evidence collection

Create deterministic candidate hypotheses with supporting, contradicting and missing evidence. Rank bounded follow-up queries by ability to distinguish hypotheses, not by query volume. Enforce merchant/scope/period boundaries, request budgets, latency limits, cancellation, caching and evidence availability at asOf. Do not call the broad analyst.

External events and seasonality require dated evidence. Correlation is not a causal design. Causal promotion needs an independently validated experiment or identified design with stated assumptions, diagnostics and uncertainty; never accept a caller's self-assigned causal label.

### F. Integrated validation and release gate

Connect deterministic simulator scenarios through observed-world projections only. Add scenario families for all domains and adversarial traps. Evaluate material-change detection, arithmetic reconciliation, supported-driver ranking, false causal claims, abstention correctness, evidence completeness, confidence calibration and output replayability. Freeze only after integrated acceptance and full repository regression gates pass.

## All 27 requirements and acceptance criteria

“Foundation” below means an implemented and tested part of a requirement, not completion of the full engine.

| Step | Component | Current state | Completion gate |
| --- | --- | --- | --- |
| 5.1 | Diagnosis contract | Foundation | Freeze a versioned full-domain schema with evidence, uncertainty, compatibility and output validation. |
| 5.2 | Material changes | Foundation: supplied period comparisons + configurable absolute AND relative thresholds | Add baseline/trend/calendar support and valid statistical tests where the data model permits them; never equate commercial materiality with significance. |
| 5.3 | Revenue decomposition | Core implemented | Integrate governed snapshot evidence; reconcile both periods and expose all residuals; no unmatched storewide orders/storefront sessions. |
| 5.4 | Channel changes | Planned | Reconcile source spend, traffic, attributed results, CAC/ROAS and contribution without summing overlapping platform claims. |
| 5.5 | Customer mix | Planned | Complete new/returning and cohort definitions; identity coverage and acquisition/retention maturity; no new-customer count substituted for new-customer orders. |
| 5.6 | Product/merchandising mix | Planned | Complete eligible product/category universe, stable product identity and disjoint or explicitly overlapping collection semantics. |
| 5.7 | Pricing/promotions | Planned | Separate unit price, units, discounts, participation and mix; avoid asserting promotion lift from before/after correlation. |
| 5.8 | Profitability | Planned | Reconcile gross and contribution bridges including coverage, returns accounting and missing costs. |
| 5.9 | Inventory effects | Planned | Use time-aligned availability, stockout duration, sell-through and replenishment evidence; estimated lost demand is not observed sales. |
| 5.10 | Lifecycle/email | Planned | Full campaign/automation universe, provider pagination/completeness, delivery/engagement maturity and attribution overlap checks. |
| 5.11 | Funnel changes | Planned | Compatible sessions→PDP→ATC→checkout→purchase cohorts by useful dimensions; comparable denominators and missing instrumentation checks. |
| 5.12 | Mix effects | Standalone helper tested | Integrate complete disjoint segment evidence; cover Simpson reversals, entering/exiting segments and denominator changes. |
| 5.13 | Correlation/causation | Foundation boundary enforced | Add governed causal-evidence designs; arithmetic and observational findings never auto-promote. |
| 5.14 | Competing hypotheses | Planned | Multiple distinguishable candidates, counterevidence and explicit untestable explanations. |
| 5.15 | Evidence tests | Planned | Bounded, minimal, source-authorized retrieval with cache/time/request budgets and deterministic hypothesis outcomes. |
| 5.16 | Explanatory ranking | Foundation: one arithmetic partition | Add cross-domain overlap controls and nested budgets; no additive double counting between alternative views. |
| 5.17 | Interactions | Product-identity allocation implemented | Extend to governed domain interactions without relabeling allocations as causal effects. |
| 5.18 | External/seasonal effects | Planned | Merchant-local calendars, dated events and explicit raw-vs-adjusted comparisons; unknown external causes remain unknown. |
| 5.19 | Measurement guardrails | Foundation | Integrate automated tracking/attribution/source disagreement detection and sample/identity coverage; boundary metadata must be backed by sources. |
| 5.20 | Confidence | Deterministic rubric implemented | Validate labels across held-out scenarios; separate evidence quality, statistical precision and causal identification. |
| 5.21 | Unexplained change | Arithmetic residual implemented | Add supported cross-domain explanation coverage without equating arithmetic reconciliation with causal explanation. |
| 5.22 | Evidence graph | Core graph implemented | Integrate provider/calculation/hypothesis lineage and full replay metadata across domains. |
| 5.23 | Structured output | Draft core JSON implemented | Freeze full-domain output contracts and downstream consumer compatibility tests. |
| 5.24 | Explanation layer | Deterministic core wording implemented | Broader templates constrained to supported claims; no numeric invention or stronger causal language than evidence permits. |
| 5.25 | Validation suite | Foundation suite implemented | Integrated known-driver scenarios across all domains; observed input and evaluator truth strictly separated. |
| 5.26 | Adversarial tests | Foundation subset implemented | Add branded search, retargeting, misleading ROAS, discount/profit, stockout and cannibalization scenarios, beyond current corruption/scope/mix tests. |
| 5.27 | Unknown answers | Foundation implemented | Domain-wide known/unknown/evidence-needed output; test genuine ambiguity and conflicting evidence, not just missing values. |

## Implemented API and trust boundary

- `diagnose(observedProjection)` returns a `DiagnosisReport`.
- `serializeDiagnosis(observedProjection)` produces deterministic formatted JSON.
- `allocateProductChange` and `roundEffects` are pure arithmetic helpers.
- `decomposeRateMix` is a binomial-rate arithmetic helper, **not** a provider-backed segment diagnosis.

The supported metric IDs are the existing canonical `revenue_net`, `orders`, `aov`, `sessions` and `cvr`. No aliases or platform-ROAS substitutions are accepted. Monetary totals use integer minor units with explicit currency scaling; AOV may retain fractional minor units to preserve identities. Atomic evidence IDs must be unique.

Metadata checks are not cryptographic proof of source quality. The planned adapter/collector owns verification of source scans, coverage, population and definition identifiers. The engine verifies the supplied boundary and calculation consistency, not the truth of arbitrary caller attestations.

Malformed/hidden-field input raises `DiagnosisInputError`. Validly shaped but missing, incomplete, stale, future, incompatible or non-authoritative evidence produces unknown findings. Rejected observations' raw values are quarantined from both the report and graph. No model-assigned confidence or causal label is accepted as input.

## Verification and reproducibility

```sh
node scripts/test-diagnosis.mjs
```

This compiles the entire new core under strict TypeScript settings and runs Node's deterministic test runner. It uses the repository-installed compiler when present and a global compiler only as a fallback. Output is built in a temporary directory and removed afterward.

The test filenames intentionally use `.node-test.mjs`, avoiding accidental registration inside the pre-existing Vitest suite. Dedicated CI runs this core gate and the existing `npm run check` as separate jobs. Existing `test:step5` refers to advertising economics and is deliberately unchanged.

Local verification for this increment: Node `22.16.0`, TypeScript `5.8.3`; **93 tests passed**, including **4,000 fixed-seed generated cases** (2,000 product allocations, 1,000 full diagnoses, 1,000 rate/mix partitions). These counts do not mean 4,000 distinct causal scenarios.

The full repository could not be cloned in the local execution environment because outbound GitHub DNS was unavailable. Therefore full repository installation/typecheck/build/Vitest results and compatibility under the repository's pinned TypeScript `5.9.3` must be obtained from CI; they are **not claimed as locally verified**.

Release remains blocked on the canonical adapter, remaining domain and hypothesis modules, full simulator validation and passing integration/regression gates. No deployment or freeze is part of this increment.
