# Truth & Voice Governor prototype

Research-only prototype for making Kivviq's downstream ChatGPT/LLM answers more direct without making them more reckless.

## Principle

**The model writes; Kivviq judges.**

The prototype creates a governed `AnswerSpec` containing atomic claims, multidimensional confidence, contradictions, unknowns, a decision state, and a strict response contract. A post-generation verifier then rejects drafts that invent numbers, use unsupported causal language, hide contradictions, upgrade unknowns into facts, or invent recommendations.

## Pipeline

`evidence -> deterministic analysis -> claim ledger -> decision -> truth/voice governor -> AnswerSpec -> LLM -> verifier -> user`

## Safety boundary

This branch is synthetic/research-only. It contains no production Kivviq code, credentials, merchant data, or private-repository content. It is intentionally isolated from the existing attribution and GroundTruth work.

## Next prototype steps

Add schema validation, adversarial fixtures, materiality/economic thresholds, deterministic rendering tests, and a model-agnostic adapter that serializes AnswerSpec for MCP/tool responses.
