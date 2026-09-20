# Evidence & Reasoning Lab — Phase 1

## Purpose

The lab tests the chain:

`merchant question → intent → metric → scope → timeframe → authoritative source → evidence retrieval → evidence validation → supported conclusion`

It focuses on failures where usable evidence exists but a system answers incorrectly because of semantic interpretation, authority selection, scope/time routing, evidence precedence or missing-data handling.

## Architecture

### Synthetic business world

`SyntheticWorld` deterministically generates generic ecommerce evidence for eight source classes:

1. commerce
2. analytics
3. search advertising
4. paid-social advertising
5. visual/social advertising
6. lifecycle messaging
7. first-party measurement
8. cost/margin evidence

Facts carry provenance and measurement metadata. Commerce relationships are internally consistent: gross sales, discounts, refunds, net sales, taxes, shipping and total sales reconcile, and sales-channel components reconcile to total sales.

### Metric authority registry

`MetricRegistry` maps each metric to its authoritative source class. Store revenue, analytics-reported revenue, provider-attributed revenue and first-party linked revenue are distinct metrics even when synthetic values are numerically similar.

Gross, net and total sales are distinct. Gross profit, contribution and net profit are also distinct.

### Request semantics

`RequestSemantics` explicitly represents:

- intent
- metric
- source/provider
- scope
- breakdown dimension
- period and comparison period
- currency
- aggregation
- attribution basis
- profit basis
- journey requirement
- freshness requirement

A breakdown request is not automatically ambiguous. For example, a revenue breakdown can resolve to total sales, all channels, with sales channel as the breakdown dimension.

### Retrieval and evidence governor

`EvidenceRetriever` selects facts using metric identity, authority, scope, period and breakdown requirements. `EvidenceGovernor` then validates a proposed answer against a separate `AnswerContract`.

This separation is deliberate: semantic interpretation can be tested independently from evidence validation, so the governor does not hide parser errors and the parser cannot weaken evidence rules.

The governor checks metric/source/scope/period, freshness, provider coverage, measurement state, permitted calculations, attribution basis, profit basis, required cost inputs, ordered-journey support and causal support.

### Missing-data states

The model distinguishes measured zero from null, unavailable, degraded, not requested and not applicable states. Missing cost inputs are never silently treated as zero.

## Benchmark methodology

The Phase 1 generator produces 545 deterministic cases from semantic phrase families. Categories include:

- store revenue
- channel scope
- revenue breakdowns
- provider spend
- provider-attributed revenue
- analytics sessions
- lifecycle metrics
- profitability
- ordered customer journeys
- causal/incrementality prompts
- genuine ambiguity
- partial provider failure
- freshness
- comparisons
- custom time periods
- adversarial evidence precedence
- missing cost inputs

The fixed reference clock is `2026-09-20 12:00 America/Toronto`, which makes date parsing deterministic and permits off-by-one/time-boundary tests.

## Expected-answer contracts

Supported cases declare the required metric, source, scope, period, breakdown, calculations, freshness, provider coverage, attribution basis, profit basis, cost inputs and journey/causal support where relevant.

Unsupported outcomes include ambiguity, unavailable/stale evidence, scope or period mismatch, degraded source coverage, insufficient evidence and unsupported causal claims.

## Failure taxonomy

The lab classifies failures including false ambiguity, wrong metric/source/scope/breakdown/period, stale evidence, null-as-zero, provider-failure contamination, attributed-as-store-revenue, gross/net/total confusion, unsupported profit or causality, fabricated journeys, unsupported calculations, missing caveats and evidence-available-but-rejected.

## Mutation tests

The mutation suite intentionally injects 10 regressions:

- obvious request forced to ambiguous
- exact spend replaced by null and presented as zero
- unavailable provider replaced with zero
- date shifted by one day
- total sales swapped for net sales
- provider-attributed revenue substituted for store revenue
- one provider silently dropped
- freshness metadata removed
- ordered journey fabricated without ordered-event support
- profitability asserted with missing variable-cost inputs

The benchmark is expected to detect every mutation.

## Repository safety

The safety scanner rejects common environment/key filenames, private-key blocks, common credential/token formats, suspicious credential assignments, non-example email addresses and unexpectedly large raw datasets/database artifacts.

This is defense in depth, not proof that a leak is impossible. Human review of the complete diff remains mandatory.

## Adding cases

Prefer semantic families with variables for wording, provider, scope and timeframe. Do not add one phrase solely to make a failing implementation pass. Every new case needs independently declared expected semantics and an evidence contract.

## Adding providers generically

Use a generic source identifier, define its authoritative metrics, generate synthetic evidence with provenance, and add failure/isolation tests. Do not add real account IDs, merchant names, campaign names, credentials or live endpoints.

## CI

GitHub Actions runs unit tests, the 545-case benchmark, mutation/regression tests, Ruff linting, mypy type checking and the repository safety scan. CI requires no secrets and makes no merchant-platform or production-system calls.

## Limitations

- The Phase 1 semantic resolver is deterministic and rule-based; high benchmark scores do not establish open-ended language understanding.
- Synthetic distributions are intentionally controlled and do not reproduce all real-world instrumentation pathologies.
- Causal questions are refused unless explicit synthetic causal evidence exists; this phase does not implement an incrementality estimator.
- Journey tests validate evidentiary requirements, not identity resolution quality in a live environment.
- Profitability tests validate required-input semantics; they do not model every accounting convention.
- Safety scanning detects known patterns and cannot guarantee the absence of sensitive information.

## Candidate Phase 2 research questions

- How well do model-based semantic resolvers generalize to paraphrases that were not produced by the benchmark generator?
- Can evidence contracts be inferred and then independently verified without increasing false refusals?
- How should contradictory fresh facts from equally authoritative replicas be reconciled?
- How should confidence calibration respond to partial observation coverage and identity uncertainty?
- Which benchmark distributions best stress multilingual, abbreviated and conversation-context questions?
- How can synthetic causal worlds be shared with attribution and budget-optimization research without leaking causal ground truth into the answering system?
- What metamorphic properties should remain invariant under paraphrase, provider failure, timezone shift and harmless evidence reordering?

## Porting guidance

Any useful component from this public lab should be treated as a research artifact. Port it manually into a private application only after independent review of security, privacy, data contracts, provider semantics, observability, tests and deployment controls. Do not import private implementation details back into this public repository.
