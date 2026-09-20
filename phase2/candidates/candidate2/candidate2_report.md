# Candidate 2 final research report

Candidate: `candidate2-aipw-dr-observable` v`1.0.0`

## Final outcome

**REJECT**

FROZEN_PHASE1 primary observed-selection comparison failed: Candidate 2 aggregate known-zero error 0.066058 was not lower than Candidate 1 0.064983, and only 1 of 4 required scenario means improved.

Candidate 2 failed before sealed-holdout eligibility. `candidate2-holdout-v1` remains sealed and unconsumed.

## DEVELOPMENT

The preregistered 3×3 nuisance-regularization grid selected **outcome L2 = 5.0** and **propensity L2 = 5.0** using development worlds only.

Selected development mean effect MAE: **0.0282**.

Candidate 1 holdout metrics, frozen Phase 1 results and the Candidate 2 holdout were not used for development tuning.

## FROZEN_PHASE1 — observed-selection comparison

| Scenario | Candidate 2 | Candidate 1 frozen comparator | Improved? |
| --- | ---: | ---: | --- |
| demand_capture | 0.0811 | 0.0809 | no |
| retargeting_selection | 0.0608 | 0.0569 | no |
| null_channel_high_intent | 0.0639 | 0.0618 | no |
| null_channel_retargeting | 0.0584 | 0.0603 | yes |

Candidate 2 aggregate: **0.06606**; Candidate 1 aggregate: **0.06498**. Candidate 2 improved **1 of 4** scenario means; the preregistered requirement was at least 3 of 4 plus lower aggregate error.

## Other frozen Phase 1 evidence

- Overall perfect-observation mean effect MAE: **0.0204** — PASS.
- Known-zero aggregate mean absolute effect: **0.0422** — PASS.
- Mean interval coverage: **0.8538** — PASS.
- Harmful-channel mean estimate: **-0.0436**; mean absolute error **0.0084** — PASS.
- Missing-50 mean absolute effect-vector change: **0.0231** — PASS.
- Fragmented-identity effect-vector change: **0.0081** — PASS.

## Propensity / overlap diagnostics

- Minimum treated/control ESS across perfect Phase 1 cases: **20.622**.
- Maximum extreme raw propensity fraction across perfect cases: **0.684**.
- Maximum clipped inverse weight across perfect cases: **40.000**.

These are diagnostics. No post-hoc Phase 1 overlap threshold was added.

## Hidden-confounding performance

**NOT EVALUATED.** Candidate 2 failed its preregistered pre-holdout gate, so the sealed `latent_intent_shift` family was never exposed. This preserves the new holdout as genuinely unseen historical evidence rather than consuming it for a candidate that was already rejected.

## Sealed Candidate 2 holdout

- Version: `candidate2-holdout-v1`
- Generator fingerprint: `acdc2014358b7171a57118d2dc32ea2dfbf41a431a720421180b38e6c5a2e4d7`
- Configuration fingerprint: `138f7864be008b618443a49aacfbae674479869066cd75a24a7887009a317c74`
- Feedback-bearing exposures consumed: **0**
- Results by family: **NOT EVALUATED — PREHOLDOUT REJECT**

## Scientific interpretation

The doubly robust hypothesis did not satisfy its primary public Phase 1 selection criterion. This does not show that doubly robust estimation is generally ineffective; it rejects this frozen Candidate 2 specification under its preregistered synthetic protocol.

**Doubly robust does not mean robust to unobserved confounding.** The sealed hidden-confounding test was not reached, so no claim about Candidate 2's performance under the new hidden-latent-intent holdout is warranted.

## Public holdout limitation

The holdout-family architecture is public because the repository is public. The instantiated holdout seeds, parameter values, treatment effects, latent-intent strengths, interactions, selection mechanisms and corruption settings remained sealed from Candidate 2 development. This is strong research-process separation, not a completely secret external benchmark.

## Boundaries

- Candidate 1 remains permanently frozen as REJECT and was not modified.
- Candidate 1's sealed holdout was not reused.
- Phase 1 remains frozen.
- No private Kivviq, merchant, production or external merchant system was accessed.
- No merge or deployment occurred.
- Candidate 3 was not implemented.
