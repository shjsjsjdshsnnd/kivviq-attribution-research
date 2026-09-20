# Contributing

## Public-repository rules

Use synthetic data only. Do not copy or reconstruct private application code, schemas, configuration, logs, credentials, merchant/customer records, real campaign/order identifiers, real account identifiers, or real business performance figures.

Do not connect tests, scripts or examples to merchant platforms, production/staging databases, hosted production infrastructure, analytics properties or advertising accounts. Do not add secrets to GitHub Actions.

Before every commit:

1. inspect `git status` and staged files;
2. inspect the complete staged diff;
3. run `python -m kivviq_evidence_lab.cli safety .`;
4. run unit tests, benchmark tests, mutation tests, lint and type checks;
5. stop if any material is uncertain to be safe for a public repository.

Do not bypass security checks or force-add ignored files. Do not auto-merge pull requests.

## Adding benchmark cases

Add semantic families rather than one-off phrase patches. Each case must declare machine-readable expected semantics and an answer contract. Ambiguity should be retained only when materially different interpretations remain unresolved.

## Adding providers

Add providers through generic source identifiers and metric-authority rules. Never add real account identifiers or credentials. Provider-specific measured facts may be represented synthetically, but store revenue and provider-attributed revenue must remain distinct metric families.
