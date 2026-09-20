# Phase 2 Generalization Experiment

Phase 2 asks a different question from the frozen Phase 1 benchmark:

> Does the reasoning architecture generalize to merchant language it was not explicitly designed around?

Phase 2 begins from frozen Phase 1 commit `0f08e73915c0984d13ed47ac10059d41abc46e45`. The Phase 1 resolver is not modified before its first holdout evaluation.

## Information boundary

Candidate-visible:

- `RequestSemantics` and shared schemas
- `SemanticBundle` / resolver protocol
- the 96-case versioned development suite
- the evaluation interface
- the Evidence Governor interface

Candidate modules:

- `phase2/candidates/deterministic.py`
- `phase2/candidates/model_based.py`

Evaluator-only:

- `phase2_evaluator/holdout_v1.py`
- expected semantics
- dialogue truth
- hidden metamorphic transformations
- contradiction fixtures
- holdout digest and scoring implementation

Candidate modules are scanned in CI and may not import or dynamically load the evaluator package. The evaluator imports candidates; candidates do not import the evaluator.

Because this is a public research repository, this is an architectural information barrier rather than cryptographic secrecy from a human who deliberately reads the repository. It prevents candidate code from depending on holdout truth and makes accidental tuning detectable in review.

## Versioned suites

- Development: `phase2-development-v1.0.0`, 96 candidate-visible cases
- Holdout: `phase2-holdout-v1.0.0`
- Holdout semantic messages: 160
- Conversational turns: 16
- Metamorphic cases: 20
- Evidence Governor cases: 12
- Contradiction cases: 6
- Total evaluation units: 214

Any change to a holdout prompt, expected semantic request, transformation, dialogue truth, contradiction fixture, or scoring truth after candidate results have been observed requires a new holdout version.

## Coverage

The sealed evaluation includes:

- terse and conversational wording
- grammatical and spelling mistakes
- incomplete/noisy language
- unusual word order
- business slang
- irrelevant context
- multiple requests in one message
- English
- French with generic Quebec ecommerce terminology
- English/French code switching
- multi-turn provider/metric/period follow-ups
- genuine ambiguity
- adversarial causal premises
- evidence contradictions
- metamorphic invariance and contrast tests

## Model-based resolver boundary

`ModelBasedResolverCandidate` is an adapter for a model backend that returns the same typed semantic objects. No external model, API key, or hosted inference service is required or used by the public test suite. A future model backend can be injected without changing the Evidence Governor.

The mandatory flow remains:

`natural language → resolver → typed RequestSemantics → evidence retrieval → Evidence Governor`

Language interpretation may request a claim. It cannot authorize the claim.

## Research discipline

The deterministic Phase 1 resolver is evaluated unchanged on holdout v1. Holdout failures are recorded as research results. Candidate improvements must be justified as general hypotheses and evaluated on the development suite before a later holdout evaluation. Exact failed holdout sentences must not be patched into lookup tables.

Development and holdout metrics are reported separately. No overall intelligence score is produced. Serious failures remain visible by dimension and category.


## First sealed holdout observation

The frozen deterministic candidate was first evaluated on holdout v1 at commit `5785e7df796001d58a597a27696c9be27ce11ad8`. The candidate and holdout are not modified in response to these results.

Observed deterministic baseline:

- exact semantic resolution: 0.1375
- metric accuracy: 0.3953488372
- provider accuracy: 0.3895348837
- scope accuracy: 0.4011627907
- period accuracy: 0.7558139535
- breakdown accuracy: 0.7325581395
- ambiguity precision: 0.1485148515
- ambiguity recall: 0.9375
- false-ambiguity rate: 0.5972222222
- false-certainty rate: 0.0625
- conversational-context accuracy: 0.1875
- multilingual accuracy: 0.0454545455
- metamorphic consistency: 0.7
- Evidence Governor acceptance accuracy: 1.0
- unsupported-claim rate: 0.0
- governor false-refusal rate: 0.0
- contradiction safety: 0.6666666667

The result shows that Phase 1 benchmark success did not imply open-language generalization. The main observed gaps are multilingual interpretation, over-triggered ambiguity, multiple-request extraction, conversational context, breakdown paraphrases, noisy language, adversarial-premise decomposition, and same-authority evidence contradiction handling.

Holdout v1 digest is `534a7ece84044d71e53b3765ef47c20a62a8fe352a2b612191ffe4b660fe11cd`. Any change to its prompts, truth, transformations, or scoring contract requires a new holdout version.
