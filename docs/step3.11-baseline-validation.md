# Step 3.11 — Baseline Validation and Reproducibility

## Purpose

Step 3.11 freezes a reusable evaluator-owned validation library for the 27 baseline operators frozen in Steps 3.2–3.9. The library runs real operators through the Step 3.10 canonical boundary, validates recorded evidence, and emits deterministic machine-readable conformance reports.

Conformance establishes whether an operator satisfies the frozen interface, evidence, and policy checks. It does not rank operator performance or change any baseline policy, simulator behavior, Action Ontology rule, or metric definition.

## Frozen lineage and versions

- Step 3.11 frozen parent commit: `3fbc5c9396f2471c7c6fdd5fb73b50cb107dcaf3`
- validation suite version: `1.0.0`
- validation canonical-JSON version: `1.0.0`
- validation contract schema version: `1.0.0`
- conformance report schema version: `1.0.0`
- fixture-manifest schema version: `1.0.0`
- seed-set schema version: `1.0.0`
- recorded-decision artifact schema version: `1.0.0`
- Step 3.10 canonical operator interface: `2.0.0`
- Action Ontology: `1.6.0`

The Step 3.10 and Step 3.1 identities remain inputs to validation:

- canonical interface schema fingerprint: `fnv1a64:771759d019aefa24`
- canonical input schema fingerprint: `fnv1a64:9baa3fb770f593ae`
- canonical output schema fingerprint: `fnv1a64:7c852fa831cf12a8`
- canonical metadata schema fingerprint: `fnv1a64:b199f4d287d99937`
- canonical capability schema fingerprint: `fnv1a64:57fc390e508fd575`
- Step 3.1 evaluation contract fingerprint: `fnv1a64:b1cc22917a3e566b`

## Ownership and dependency direction

`src/validation/` is public, versioned, evaluator-owned research infrastructure. Consumers import it through the `./validation` package subpath. The operator-safe root API does not export validation internals.

The allowed dependency direction is:

```text
validation/evaluator
        ↓
canonical operator interface
        ↓
operators
```

Operator-facing modules may not import `src/validation/`. The dependency-cruiser rule and `tests/validation/architecture.test.ts` enforce that boundary across operator, observation, Action Ontology, translation, simulator-intervention, and operator business-language modules.

The validation layer may inspect evaluator-only evidence. It never adds GroundTruth, future information, evaluator metrics, seed material, generated environment profiles, or simulator-private state to `CanonicalOperatorInputV2`. PASS/FAIL ownership remains with the evaluator.

## Frozen artifacts and fingerprints

Each stored fingerprint is checked by recomputing it from the canonical body with the fingerprint field omitted. Validation rejects malformed, mismatched, duplicate, unknown, or non-canonical evidence.

Step 3.1 retains its frozen `localeCompare` key ordering. Step 3.11 owns a separate, explicitly versioned canonical-JSON serializer that uses Unicode code-unit key ordering for validation contracts, fixtures, seed sets, evidence summaries, and reports. This prevents validation portability requirements from changing the previously frozen evaluation serializer.

| Artifact | Frozen identity | Fingerprint |
| --- | --- | --- |
| Validation contract | suite/schema `1.0.0` | `fnv1a64:6967645220ae672b` |
| Fixture manifest | `baseline-validation-fixtures-v1` | `fnv1a64:4267f99df6098b65` |
| Seed set | `baseline-validation-seeds-v1` | `fnv1a64:382edc741c307867` |

Every conformance report records the fixture-manifest and seed-set schema versions and fingerprints. The report builder derives those fields from validated canonical artifacts. Both the evidence fingerprint and the report fingerprint cover them, so a stale or substituted validation artifact invalidates the report even when the operator checks remain unchanged.

The fixture manifest contains ten versioned fixtures: `empty`, `single_action`, `multi_action`, `constraint_rejected`, `constraint_modified`, `hidden_truth_pair`, `future_pair`, `missing_data`, `exact_tie`, and `lookback_boundary`. Every fixture has version `1.0.0` and its own recomputed fingerprint.

The seed set contains six fixed cases over four world profiles. Every case defines all five Step 3.1 seed namespaces: merchant generation, customer population, baseline warm-up, shared evaluation environment, and operator randomness. The evaluator derives and fingerprints the seed environment outside the operator boundary. Two invocations for the same frozen seed use the same canonical input, while namespace-sensitivity checks prove that changing any namespace changes the evaluator-only environment fingerprint.

## Frozen operator inventory

The harness registers each operator once, in this frozen order:

1. `baseline.do_nothing`
2. `baseline.status_quo`
3. `baseline.advertising.equal_budget_allocation`
4. `baseline.advertising.roas_threshold_increase`
5. `baseline.advertising.roas_threshold_decrease`
6. `baseline.advertising.highest_observed_roas`
7. `baseline.advertising.fixed_channel_allocation`
8. `baseline.inventory.fixed_reorder_threshold`
9. `baseline.inventory.fixed_reorder_quantity`
10. `baseline.inventory.low_inventory_depromotion`
11. `baseline.inventory.no_inventory_aware_intervention`
12. `baseline.pricing.never_discount`
13. `baseline.pricing.fixed_discount`
14. `baseline.pricing.excess_inventory_discount`
15. `baseline.promotion.fixed_promotional_calendar`
16. `baseline.merchandising.rank_by_revenue`
17. `baseline.merchandising.rank_by_conversion_rate`
18. `baseline.merchandising.rank_by_units_sold`
19. `baseline.greedy.immediate_revenue`
20. `baseline.greedy.immediate_gross_profit`
21. `baseline.greedy.immediate_contribution`
22. `baseline.flawed.max_roas`
23. `baseline.flawed.min_cac`
24. `baseline.flawed.max_revenue`
25. `baseline.flawed.best_seller_push`
26. `baseline.flawed.lowest_cpa`
27. `baseline.flawed.highest_conversion_rate`

## Required checks

Every report contains these 19 results in contract order:

1. `determinism`
2. `seed_reproducibility`
3. `hidden_truth_isolation`
4. `future_information_isolation`
5. `temporal_boundary_conformance`
6. `lookback_window_conformance`
7. `action_ontology_conformance`
8. `constraint_conformance`
9. `policy_semantics`
10. `permitted_information_sensitivity`
11. `prohibited_information_invariance`
12. `tie_breaking`
13. `missing_data_behavior`
14. `zero_action_behavior`
15. `multi_action_behavior`
16. `artifact_replay`
17. `provenance_integrity`
18. `uncontrolled_randomness_detection`
19. `operator_isolation`

The suite exercises real canonical invocations. Family-specific tests bind reviewed policy expectations to each operator, vary permitted observations, vary evaluator-only prohibited witnesses, verify exact threshold and temporal boundaries, and cover deterministic missing-data, tie, zero-Action, multi-Action, constraint, and replay behavior.

## Fail-closed rules

The evaluator returns `FAIL` or rejects the report when it encounters any of these conditions:

- a required evidence section or required check is absent;
- a case, report, check, issue, seed, fixture, or evidence record has unknown or malformed fields;
- a stored fingerprint cannot be independently recomputed;
- evidence sections do not bind to the same primary canonical input and observation provenance;
- repeated invocations diverge, use uncontrolled randomness, or mutate evaluator-owned input;
- seed declarations differ from the frozen set, repeat, exceed the frozen count, or attempt to control repetition counts;
- hidden-truth or future-information pairs alter visible input, fail to vary the evaluator-only witness, or change the Action semantics;
- timestamps fall after the decision time or outside the inclusive frozen lookback window;
- an Action violates the canonical envelope, Action Ontology, legal Action space, declared capability, deterministic ordering, or constraint disposition record;
- policy, sensitivity, tie, missing-data, zero-Action, or multi-Action evidence does not come from the declared executable probe;
- replay identity, configuration, input, output, provenance, schema, seed binding, or artifact identity differs;
- an operator claims execution, simulator mutation, or constraint-bypass authority.

One failed check makes `overall` equal `FAIL`. PASS/FAIL is evaluator-owned: a PASS result must have zero issues and at least one well-formed, unique evidence fingerprint; a FAIL result must have one or more issues. The builder rejects caller-supplied statuses that contradict those facts, and serialized report validation applies the same rules after independently recomputing aggregate fingerprints. The report builder inserts deterministic `MISSING_REQUIRED_EVIDENCE` results and never infers PASS from omitted evidence. Check ordering follows the contract, issue ordering uses code-unit order, and canonical serialization makes reports reproducible from the recorded evidence.

## Machine-readable report example

The following report was produced by the public report builder for the frozen DO_NOTHING identity. The check list is shown in full because report validation requires exact coverage and order.

```json
{
  "kind": "baseline_conformance_report",
  "schemaVersion": "1.0.0",
  "validationSuiteVersion": "1.0.0",
  "validationContractFingerprint": "fnv1a64:6967645220ae672b",
  "fixtureManifestSchemaVersion": "1.0.0",
  "fixtureManifestFingerprint": "fnv1a64:4267f99df6098b65",
  "seedSetSchemaVersion": "1.0.0",
  "seedSetFingerprint": "fnv1a64:382edc741c307867",
  "operator": {
    "operatorId": "baseline.do_nothing",
    "operatorVersion": "1.0.0",
    "implementationFingerprint": "fnv1a64:dcf958f1031e2e30",
    "configurationFingerprint": "fnv1a64:f9de9cb524d6bbf9"
  },
  "checks": [
    { "checkId": "determinism", "status": "PASS", "evidenceFingerprints": ["fnv1a64:5ce9dd27629e3d64"], "issues": [] },
    { "checkId": "seed_reproducibility", "status": "PASS", "evidenceFingerprints": ["fnv1a64:0d28ab5646b7d3c9"], "issues": [] },
    { "checkId": "hidden_truth_isolation", "status": "PASS", "evidenceFingerprints": ["fnv1a64:795c0885e75d9a38"], "issues": [] },
    { "checkId": "future_information_isolation", "status": "PASS", "evidenceFingerprints": ["fnv1a64:db016824f88db364"], "issues": [] },
    { "checkId": "temporal_boundary_conformance", "status": "PASS", "evidenceFingerprints": ["fnv1a64:b355bc586fa959a6"], "issues": [] },
    { "checkId": "lookback_window_conformance", "status": "PASS", "evidenceFingerprints": ["fnv1a64:a74bed405886096a"], "issues": [] },
    { "checkId": "action_ontology_conformance", "status": "PASS", "evidenceFingerprints": ["fnv1a64:e13fb7d369de0741"], "issues": [] },
    { "checkId": "constraint_conformance", "status": "PASS", "evidenceFingerprints": ["fnv1a64:4432d0a9d1c4fc50"], "issues": [] },
    { "checkId": "policy_semantics", "status": "PASS", "evidenceFingerprints": ["fnv1a64:8eb58e23f86f508d"], "issues": [] },
    { "checkId": "permitted_information_sensitivity", "status": "PASS", "evidenceFingerprints": ["fnv1a64:3972ee62b545d024"], "issues": [] },
    { "checkId": "prohibited_information_invariance", "status": "PASS", "evidenceFingerprints": ["fnv1a64:abccc0166472024d"], "issues": [] },
    { "checkId": "tie_breaking", "status": "PASS", "evidenceFingerprints": ["fnv1a64:683ce7e6dfb8029f"], "issues": [] },
    { "checkId": "missing_data_behavior", "status": "PASS", "evidenceFingerprints": ["fnv1a64:8cf34a34559cbe31"], "issues": [] },
    { "checkId": "zero_action_behavior", "status": "PASS", "evidenceFingerprints": ["fnv1a64:26640cd4dce3db61"], "issues": [] },
    { "checkId": "multi_action_behavior", "status": "PASS", "evidenceFingerprints": ["fnv1a64:ec7955af04983832"], "issues": [] },
    { "checkId": "artifact_replay", "status": "PASS", "evidenceFingerprints": ["fnv1a64:697bfbe240c356a1"], "issues": [] },
    { "checkId": "provenance_integrity", "status": "PASS", "evidenceFingerprints": ["fnv1a64:a8669f687d46c15a"], "issues": [] },
    { "checkId": "uncontrolled_randomness_detection", "status": "PASS", "evidenceFingerprints": ["fnv1a64:9f188e17494dcfc3"], "issues": [] },
    { "checkId": "operator_isolation", "status": "PASS", "evidenceFingerprints": ["fnv1a64:325d2d14a5dcd0ae"], "issues": [] }
  ],
  "overall": "PASS",
  "evidenceFingerprint": "fnv1a64:b2b0b848684d099a",
  "reportFingerprint": "fnv1a64:82ff8ae597b2424b"
}
```

## Frozen verification

Verification ran serially on 2026-09-25 from branch `baseline/step3.11-baseline-validation`:

| Command | Result |
| --- | --- |
| `npm run test:baseline-evaluation` | PASS, 21 tests in 1 file |
| `npm run test:canonical-operator-interface` | PASS, 190 tests in 1 file |
| `npm run test:baseline-validation` | PASS, 190 tests in 14 files; all 27 reports PASS |
| `npm run test:do-nothing` | PASS, 430 tests in 9 operator files |
| `npm run test:status-quo` | PASS, 26 tests in 1 file |
| `npm run test:advertising-heuristics` | PASS, 37 tests in 1 file |
| `npm run test:inventory-heuristics` | PASS, 39 tests in 1 file |
| `npm run test:pricing-promotion-heuristics` | PASS, 37 tests in 1 file |
| `npm run test:merchandising-heuristics` | PASS, 32 tests in 1 file |
| `npm run test:greedy-operators` | PASS, 24 tests in 1 file |
| `npm run test:flawed-optimizers` | PASS, 27 tests in 1 file |
| `npm run architecture` | PASS, 157 modules and 677 dependencies, zero violations |
| `npm run typecheck` | PASS |
| `npm test -- --maxWorkers=1` | PASS, 1,048 tests in 97 files |
| `npm run build` | PASS |

Step 3.11 freezes the validation methodology and evidence contract. A later semantic change requires a new version and fingerprint; it must not rewrite reports produced under `1.0.0`.
