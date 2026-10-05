# Experiment selector v0.1

Operator-only implementation. Synthetic fixtures only. No providers, merchant data,
execution credentials, simulator truth or evaluation/oracle imports enter the core.
Selection never authorizes execution.

## Implemented

- All five decisions: ACT_NOW, MONITOR, INVESTIGATE_MORE, RUN_EXPERIMENT,
  EXPERIMENT_NOT_FEASIBLE; reason codes, rejected alternatives and replay identifier.
- Strict input boundary, matching tenant/action dose/population/metric definition,
  currency, outcome horizon and evidence freshness. Observational attribution does
  not become incremental evidence. Conflicting valid records are not averaged away.
- Verified mechanical remediation and domination exemptions; economic materiality,
  implementation cost, action/test loss budgets and contribution requirements.
- Customer A/B and persistent audience holdout planning. A supplied verified capability
  and existing canonical readiness gateway are mandatory, including for paid media.
- Fixed-horizon independent-unit power (binary/continuous), unequal allocation,
  finite audience versus recruitment, variance prerequisites and mature outcome lag.
- Plan-bound finite-signal expected value of sample information. Learning candidates
  share scenario priors, currency and business horizon. Setup/exposure/delay charged
  once. Unknown probabilities do not become made-up dollar information value.
- Structured experiment dossier, preregistered decision rules and safety stops.
- Result validity, assignment SRM, guardrails, statistical versus economic decisions,
  scoped causal evidence and idempotent learning-event payloads.
- Canonical Action Space/readiness and optimizer CandidateGate adapters; powered
  merchant-local measurement windows are checked across DST. The adapters recompute
  the selector rather than treating a fingerprint as authorization.

## Boundaries and remaining work

This is not an experiment execution engine or a full production rollout. A merchant
connection is not proof of holdout capability. Inputs and imported results must be
assembled and provenance-verified by trusted server adapters, not accepted from an
LLM or an HTTP request. The replay fingerprint is not a cryptographic signature.

Advanced geo, platform lift, switchback and randomized phased-rollout methods are
registered but unavailable until their specialized power, assignment and analysis
implementations pass validation. Session randomization is not enabled. Existing
legacy geo evidence must not be relabeled as randomized 95%-confidence evidence.

The finite VOI model currently compares the proposed action versus baseline after
learning. It is not a complete contingent multi-action portfolio optimizer. A
qualified robust act-now decision takes precedence in this version. Digital Twin
calibration, persistent result/version ledgers, transactional learning consumers,
merchant APIs/UI and account-capability collectors remain follow-on integration.
Result validation emits a payload; it does not write a ledger or update a Twin.

Result ADOPT requires a significant directionally favorable effect, point estimate
at least the economic threshold and all guardrails. Immediate act-now policy is
more conservative: its relevant effect interval must clear that threshold. Both
still require revalidation and separate approval. Binary power is against zero,
not an 80% guarantee of clearing the economic threshold. Continuous normal methods
require a validated independent-unit distribution; no arbitrary data trimming.

## Verification

Run `node scripts/test-experiment-selector.mjs` after `npm ci`.
The dependency-free core/result/timing suite contains 75 Node tests, including one
1,000-case adversarial test. It covers five outcomes, namespace/scope isolation,
missing data, conflicting evidence, unsupported designs, costs, noisy information,
power, insufficient audience, outcome lag, assignment SRM and profit harm.

The binary fixture (baseline .02, absolute effect .004, balanced allocation,
two-sided alpha .05, power .8) requires 21,109 units per arm, matching the rounded
statsmodels 0.14.6 `samplesize_proportions_2indep_onetail` reference.

Focused tests and strict TypeScript compilation were executed locally. The full
repository dependency graph and adapters require repository CI; do not infer a
full-suite pass from the focused test report. No experiments or deployments were
performed. The public entry point is `src/experiment_selector/index.ts`; adapters
are a separate import so the pure core never imports simulator-facing code.
