# Kivviq Evidence & Reasoning Lab

A **public, synthetic-only** research laboratory for testing whether an ecommerce business-intelligence system can interpret merchant questions, select the right metric/source/scope/timeframe, handle incomplete evidence, and avoid unsupported conclusions.

## Safety boundary

This repository must contain only generic synthetic research material. It must not access or contain private application repositories, merchant/customer data, credentials, production/staging systems, private endpoints, environment variables, or external merchant-platform data. The lab performs no merchant API calls.

The automated repository scanner catches common accidental leak patterns, but it is not a guarantee. Human diff review remains required before every commit and pull request.

## What Phase 1 contains

- deterministic synthetic ecommerce evidence world covering commerce, analytics, search ads, paid social, visual/social ads, lifecycle messaging, first-party measurement, and cost/margin evidence
- provenance-rich evidence facts with metric, source, scope, requested/served period, currency, freshness, measurement status, definition, confidence, quality and coverage metadata
- authoritative metric registry that keeps store revenue, provider-attributed revenue, analytics revenue and first-party linked revenue distinct
- typed request semantics for intent, metric, provider, scope, breakdown dimension, period/comparison period, aggregation, attribution/profit basis, journey and freshness requirements
- deterministic natural-language benchmark with 545 cases across semantic, routing, evidence, failure, freshness, causality, journey and profitability categories
- evidence retriever and independent evidence governor
- explicit expected-answer contracts and failure taxonomy
- 10 deliberate mutation/regression scenarios
- repository safety scanner
- deterministic unit/benchmark/mutation tests and GitHub Actions CI

## Run locally

```bash
python -m pip install -e ".[dev]"
python -m unittest discover -s tests -v
python -m kivviq_evidence_lab.cli benchmark --json
python -m kivviq_evidence_lab.cli mutations
python -m kivviq_evidence_lab.cli safety .
ruff check .
mypy src
```

## Phase 1 baseline

The checked-in baseline report is in `reports/phase1-baseline.json`. It is generated entirely from synthetic data and a fixed benchmark reference date/time.

## Scope

This lab validates generic research behavior only. It does **not** establish that any production intelligence system has been improved. Useful components must be deliberately reviewed and ported into a private application under separate security, privacy, testing and deployment controls.

See `docs/evidence-reasoning-lab.md` for methodology, architecture, limitations and extension guidance.
