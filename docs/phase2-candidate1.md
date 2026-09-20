# Phase 2 Candidate 1 — model semantic resolver

Candidate version: `phase2-candidate1-model-semantic-v1.0.0`

Prompt version: `phase2-candidate1-prompt-v1.0.0`

## Hypothesis

A general language model constrained to produce the same typed `RequestSemantics` contract should generalize better than the frozen Phase 1 phrase/rule resolver on unseen merchant language, multilingual wording, code switching, multi-request messages, and legitimate conversational follow-ups.

The candidate is not allowed to decide whether requested claims are true.

## Boundary

Candidate 1 receives only:

- the current merchant message
- the deterministic reference timestamp
- up to six prior typed semantic requests as legitimate context
- the public semantic vocabulary/schema
- eight candidate-visible development examples

It does **not** receive:

- EvidenceFact values
- Evidence Governor results
- holdout prompts or expected answers through its candidate interface
- contradiction truth
- scoring truth

Its output must be JSON matching the typed semantic vocabulary. Unknown metrics/providers/scopes, malformed dates, extra top-level keys, empty request lists, and malformed JSON are rejected before evidence retrieval.

The downstream architecture is unchanged:

`merchant language → Candidate 1 → RequestSemantics → same retrieval → same Evidence Governor`

## Multiple requests and causal premises

Candidate 1 may emit multiple `RequestSemantics` objects when a message contains materially separate requests.

For an unsupported causal premise, the prompt instructs the model to preserve any valid descriptive/comparison request separately from a `causal_question`. The Evidence Governor—not the model—then determines whether causal evidence exists.

## Model backend

The repository intentionally does not embed an API credential, provider SDK, or external inference dependency. Candidate 1 depends on the `StructuredTextModel` protocol:

```python
class StructuredTextModel(Protocol):
    model_id: str
    def complete(self, system_prompt: str, user_prompt: str) -> str: ...
```

An actual model run therefore requires an explicitly configured external backend outside the public synthetic benchmark. Until such a backend is connected, Candidate 1 is implemented but **not evaluated** on holdout v1. No model result should be fabricated from a fake backend or from a developer who has seen holdout truth.

## Evaluation discipline

When an external backend becomes available:

1. freeze model identifier and inference settings;
2. run the 96-case development suite first;
3. freeze Candidate 1 version;
4. permit one sealed holdout-v1 evaluation for that candidate version;
5. record failures without patching exact holdout sentences;
6. use a new candidate version for any subsequent hypothesis.

The holdout digest remains:

`534a7ece84044d71e53b3765ef47c20a62a8fe352a2b612191ffe4b660fe11cd`
