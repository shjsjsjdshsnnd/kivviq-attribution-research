# Kivviq Truth & Voice Governor prototype

Research-only, model-agnostic prototype for governing LLM answers. It contains synthetic fixtures only and is isolated from production Kivviq, merchant data, private repositories, attribution simulation, and GroundTruth work.

## Governing principle

**The LLM writes. Kivviq judges.**

The language model may choose prose. It may not choose what is known, unknown, causal, contradictory, material, economically acceptable, or decision-worthy.

## Architecture

`Evidence → Claim Ledger → Materiality → Contradictions → Decision Engine → Truth & Voice Governor → AnswerSpec → LLM → Answer Verifier → User`

### Trust boundaries

| Stage | Deterministic responsibility | Trust boundary |
| --- | --- | --- |
| Evidence | External inputs are represented as evidence/source IDs and typed provenance. | Evidence is not treated as true merely because a model repeats it. |
| Claim Ledger | Validates atomic claims, claim type, metric/scope/period, values, provenance, confidence, completeness, materiality, contradiction status, and maximum language strength. | The downstream model cannot legitimately upgrade a claim beyond `allowedLanguage`. |
| Materiality | Applies explicit sample-size, completeness, noise-band, absolute, relative, economic, and merchant-threshold rules. | The LLM never decides whether a movement matters. |
| Contradictions | Quantifies source disagreement, materiality, confidence penalty, unresolved status, and whether it blocks action. | Material unresolved contradictions are first-class objects, not footnotes. |
| Decision Engine | Requires supporting claim IDs, blocks UNKNOWN materiality/low-quality evidence, and converts blocking contradictions to `INVESTIGATE`. | A recommendation cannot exist without governed support. |
| Truth & Voice Governor | Builds the immutable `AnswerSpec`, required unknowns/disclosures, premise correction, conclusion polarity, and response contract. | Directness is constrained by evidence strength. |
| LLM adapter | Serializes the same governed state into a compact vendor-neutral payload. | ChatGPT, Claude, and other clients receive the same factual/decision boundary. |
| LLM | Writes prose only. | Prose is untrusted until verified. |
| Answer Verifier | Rejects numeric hallucination, altered numbers, unsupported claims/causality, UNKNOWN promotion, contradiction omission, decision drift, source errors, threshold invention, spin, and excessive hedging. | Failed drafts are safe to regenerate automatically; they are not user-ready. |

## Epistemic ladder

The claim type is explicit: `FACT`, `DERIVED_FACT`, `INFERENCE`, `CAUSAL_INFERENCE`, or `UNKNOWN`.

Language strength is deterministic:

- `UNKNOWN` → `UNKNOWN_ONLY`
- `INFERENCE` → `SUGGESTIVE`
- `FACT` / `DERIVED_FACT` → `ASSERTIVE` only when measurement confidence and completeness clear policy thresholds; otherwise `QUALIFIED`
- `CAUSAL_INFERENCE` → `CAUSAL` only when causal, measurement, and completeness thresholds all clear the causal gate; otherwise it is reduced to `SUGGESTIVE`

This prevents silent movement from “associated with” to “caused.”

## Merchant economics

The economics contract accepts optional contribution margin, gross margin, break-even ROAS, CAC target, LTV, payback requirement, cash constraints, inventory constraints, and growth targets. None are hard-coded.

`compareRoasToBreakEven(2.1, {})` returns `UNKNOWN`.

`compareRoasToBreakEven(2.1, { breakEvenRoas: 2.7 })` returns `BELOW`.

The verifier also rejects a threshold named by the model when that threshold was never supplied.

## Materiality

The deterministic engine returns `IMMATERIAL`, `WATCH`, `MATERIAL`, `CRITICAL`, or `UNKNOWN`. It considers:

- absolute change
- relative change
- economic impact
- merchant threshold crossings
- sample size
- completeness
- configurable noise bands

An undersized sample returns `UNKNOWN` even when its percentage movement is large. Directional decisions are blocked when their support has `UNKNOWN` materiality.

## Contradiction-first behavior

A contradiction records claims, sources, disagreement size, supported explanation, resolution status, confidence penalty, and whether it blocks a decision. A material unresolved contradiction is required in the AnswerSpec and verifier acknowledgement list. If it touches a directional recommendation, the Decision Engine converts the decision to `INVESTIGATE`.

## Decision states

`SCALE`, `KEEP`, `REDUCE`, `STOP`, `INVESTIGATE`, `INSUFFICIENT_EVIDENCE`.

Every governed decision carries target, reason, supporting/contradicting claims, confidence, optional expected impact, risk, reversibility, measurement requirement, and conditions that would change it.

## Answer verifier

The verifier returns exactly `PASS` or `FAIL` plus machine-readable violation codes. It is designed for a regeneration loop: a failed draft can be discarded and the same AnswerSpec can be sent to the same or a different model.

The DraftAnswer envelope supplies structured annotations for claim use, language strength, numbers, sources, contradictions, unknowns, recommendations, merchant thresholds, and premise correction. The verifier additionally scans prose for ungoverned numbers, causal verbs, positive-spin terms, and unnecessary hedge terms.

## Adversarial suite

Thirteen deterministic fixtures cover:

1. Meta-attributed revenue vs Shopify disagreement
2. revenue rising while orders are flat
3. spend rising faster than revenue
4. huge percentage movement from a tiny sample
5. missing data
6. zero vs unavailable
7. attribution vs incrementality
8. contradictory sources
9. correlation without causal evidence
10. a leading question with a false premise
11. superficially good ROAS below merchant break-even
12. insufficient observation period
13. a requested recommendation with inadequate evidence

Each fixture defines synthetic evidence, governed claims, forbidden claims, expected decision state, expected materiality, and AnswerSpec constraints.

## Evaluation harness

The deterministic harness reports:

- unsupported-claim detection rate
- numeric-hallucination detection rate
- causal-overstatement detection rate
- contradiction-omission detection rate
- recommendation-integrity rate
- unknown-preservation rate
- false-positive rejection rate
- overall mutation rejection rate

The current test corpus includes valid-answer controls as well as deliberate mutations. Metrics from this synthetic corpus are prototype regression metrics, not claims about real-world model behavior.

## Deterministic vs probabilistic

Deterministic in this prototype: schema validation, claim permissions, thresholds, materiality, contradiction blocking, decision support requirements, AnswerSpec construction, serialization, verification, mutation scoring.

Potentially probabilistic outside this core: upstream semantic interpretation, entity/metric resolution, causal estimation methods, anomaly detection, forecasting, and the LLM's prose. Those systems may propose inputs, but they do not get to override this governor.

## Commands

From `prototype/truth-voice-governor`:

```bash
npm install
npm run typecheck
npm test
npm run build
```

No model API, secrets, production integration, private code, or merchant data are required.
