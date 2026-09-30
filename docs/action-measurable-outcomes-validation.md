# Steps 23–24 — measurable outcomes and Action Space validation

Steps 23 and 24 close the Action Space definition boundary. An Action can now state how its effect will be measured, and the repository has a deterministic adversarial validation harness for Action and portfolio definitions.

## Step 23 — measurable outcomes

New canonical Actions must declare measurable outcome contracts. Historical schema-2.0.0 payloads remain readable through an explicit `ABSENT` compatibility state, but `assertNewCanonicalAction` requires `outcomes.state = "PRESENT"`.

Each Action outcome contract specifies:

- a stable outcome identity;
- one primary outcome, with optional secondary outcomes and guardrails;
- the metric and metric family;
- the affected target and optional population;
- the metric value type and units;
- the comparison basis, when one is needed;
- the success condition;
- an explicit measurement horizon and anchor;
- the evidence policy and versioned source definition;
- a stable Decision Ledger outcome/evidence slot;
- a stable Learning signal and update-rule reference.

Supported first-class outcome families include contribution profit, incremental customers, conversion rate, inventory position, retention rate, revenue, orders, AOV, CAC, repeat-purchase rate and lifecycle engagement. Evidence-resolution and information-gain outcomes support information actions. A versioned custom family remains available without weakening the contract.

Outcome contracts describe **what would establish whether an Action worked**. They do not contain observed results, predictions, rankings, optimization output, regret, the best Action, GroundTruth, TRUE WORLD, latent state or evaluator/oracle information.

Outcome definitions are part of canonical Action intent identity. Reordering outcome definitions does not change the Action fingerprint; changing an outcome definition does.

`buildOutcomeMeasurementPlan` creates a deterministic measurement plan keyed to the Action ID and Action fingerprint. This is the explicit bridge into the future Decision Ledger and Learning layers without importing either layer into the Action definition boundary.

## Step 24 — validation and adversarial testing

The Action Space validation harness reuses the canonical schemas and existing runtime gates rather than implementing parallel business rules.

Structural validation:

- parses canonical Actions and canonical compound Actions;
- rejects malformed targets and impossible parameters through the existing domain schemas;
- rejects duplicate portfolio entity identities;
- rejects malformed compound decisions and invalid component/dependency references;
- rejects hidden God-mode outcome fields or namespaces.

Portfolio validation:

- expands validated Action/compound references;
- delegates symmetric conflict decisions to the canonical conflict engine;
- preserves the existing UNKNOWN/fail-closed behavior when evidence or temporal resolution is insufficient;
- verifies explicit conflicts once overlap is resolvable.

Constraint validation remains owned by the canonical eligibility/constraint gate. The adversarial suite verifies that a structurally valid Action with a violated hard constraint cannot translate.

Translation validation:

- executes the same Action/context twice;
- requires byte-equivalent deterministic translation output;
- verifies the input Action is not mutated;
- verifies intervention provenance remains bound to the originating business Action and atomic source Action;
- compares simulator intervention business semantics while excluding identity-bearing evidence references such as an Action-specific baseline `sourceRef`.

The harness does not reinterpret Action meaning. Simulator intervention semantics remain owned by the existing translation layer.

## Adversarial corpus

The Step 24 focused suite currently exercises:

- 4,096 generated measurable canonical Actions;
- 2,048 invalid target/impossible-parameter mutations;
- 512 hidden God-mode outcome mutations;
- 512 malformed compound decisions;
- 2,048 portfolio validation cases covering valid and duplicate-invalid portfolios;
- 128 explicit conflicting portfolios;
- hard-constraint rejection at translation time;
- 2,000 deterministic translated business Actions across budget, campaign-delivery, pricing and promotion intervention semantics.

Existing domain-specific translation tests continue to cover the wider translator registry. Step 24 adds high-volume invariants on top of those domain tests; it does not replace them.

## Information boundary

`action_outcomes` and `action_validation` are operator-safe. Dependency-cruiser rules prohibit them from importing GroundTruth, generation, latent customer state, simulation internals, advertising/product economics, evaluator/oracle modules or other God-mode infrastructure.

## Commands

Focused Steps 23–24 validation:

```bash
npm run test:action-outcomes-validation
```

Portfolio contract suite, including Steps 19–24:

```bash
npm run test:action-portfolio
```

Full repository gate:

```bash
npm run check
```
