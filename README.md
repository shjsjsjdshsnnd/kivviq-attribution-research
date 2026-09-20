# kivviq-attribution-research

## Growth Operator GroundTruth research

Branch: `step1/growth-operator-ground-truth`

This branch contains the Step 1 contract foundation for future Kivviq Growth Operator research.

### Isolation rules

- Synthetic data only.
- No private Kivviq production repository dependencies.
- No Maison Olive data.
- No real merchant or customer data.
- No production databases, credentials, secrets, or APIs.
- No private Kivviq implementation details.

### Step 1 scope

Included:

- strongly typed GroundTruth ontology;
- versioned GroundTruthManifest;
- explicit causal graph;
- intervention/counterfactual contract;
- explicit units and causal-effect semantics;
- ObservableEvent, MerchantObservation, and OperatorInput boundaries;
- invariant validation;
- GroundTruth leakage prevention;
- deterministic serialization/reproducibility contract;
- synthetic example manifest;
- tests and documentation.

Deliberately not included:

- merchant generation;
- customer generation;
- ecommerce simulation;
- Growth Operator implementation;
- recommendation algorithms;
- optimization algorithms;
- LLM layer.

See:

- `docs/ground-truth.md`
- `docs/information-boundaries.md`
- `docs/causal-semantics.md`

Draft PR: #2
