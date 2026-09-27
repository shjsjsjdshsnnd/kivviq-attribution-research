# Experiments, eligibility, and hard constraints

Steps 16–18 add three operator-facing contracts: native experiment intent, immutable hard-constraint definitions, and evidence-bound Action eligibility. The implementation keeps intent, runtime evidence, translation, execution, and results in separate records.

## Public API

The package root exports the operator-safe experiment, constraint, and eligibility contracts. Consumers can also use these subpaths:

```ts
import { experimentWhatSchema, assessExperimentReadiness } from "@kivviq/growth-operator-research/experiment";
import { hardConstraintSchema, assessHardConstraints } from "@kivviq/growth-operator-research/action-constraints";
import { actionEligibilitySchema, evaluateActionEligibility } from "@kivviq/growth-operator-research/action-eligibility";
```

The architecture rules prevent these modules from importing simulator state, ground truth, evaluation, ranking, optimization, or provider-execution code.

## State boundaries

| State | Stored information | Excluded information |
| --- | --- | --- |
| Action definition | WHAT, WHO, WHEN, immutable constraint definitions, experiment arms, fixed allocation, metrics, and stopping intent | Observed constraint values, eligibility decisions, outcomes, winners, execution state |
| Constraint assessment | Evidence receipts bound to the Action ID, semantic fingerprint, target, evaluation boundary, observation time, currency, and unit | Recommendations and predicted outcomes |
| Action eligibility | All precondition, hard-constraint, and domain checks with `ELIGIBLE`, `INELIGIBLE`, or `UNKNOWN` aggregation | Simulator capability and provider execution state |
| Experiment readiness | Exact arm resolution, population binding, timing, metric definitions, eligible traffic, and engine capability | Assignment results, lift, significance, winners |
| Translation | A reviewable simulator intervention, information task, observation request, or experiment-engine task | Execution and experiment results |
| Execution and result | Owned by a future execution or experiment engine | Not represented by the Action, readiness, or translation contracts |

An Action fingerprint covers its semantic definition, including canonical constraints. Constraint array order does not change that fingerprint. Changing a constraint definition does.

## Hard constraints and eligibility

`assessHardConstraints` compares typed receipts with immutable definitions. It returns one assessment per constraint. Missing, stale, future, or incorrectly bound evidence produces `UNKNOWN`. Evidence with an incompatible currency, unit, value basis, or value shape produces `VIOLATED` with reason code `INCOMPATIBLE_VALUE`; literal violations also remain violations.

`evaluateActionEligibility` combines three check classes:

- preconditions adapted from legacy Actions;
- native hard constraints assessed from receipts;
- registered domain rules derived from typed facts.

The evaluator keeps every check and applies `INELIGIBLE > UNKNOWN > ELIGIBLE`. Domain facts bind to the exact Action fingerprint, target, boundary, and observation time. A fact for SKU A cannot satisfy SKU B, and a Meta channel fact cannot satisfy Google.

```ts
const eligibility = evaluateActionEligibility(
  { action, nativeConstraints: { constraints: action.constraints, resourceRequirements } },
  {
    evaluatedAt: approvedClock,
    evaluationBoundary: "TRANSLATION_TIME",
    maximumAgeSeconds: 3600,
    observations: [],
    constraintReceipts,
    domainFacts,
  },
);
```

Callers must handle the evaluator's failure form before reading `eligibility.result`.

## Native experiment boundary

`experiment.run` records one control arm, one or more treatment arms, a 10,000-basis-point fixed allocation, a randomization unit, metric references, a measurement window, and a fixed stopping rule. An arm references an atomic or compound Action by exact ID and semantic fingerprint.

`assessExperimentReadiness` resolves those references and checks population, timing, metrics, traffic, and engine capability. It reports `READY`, `BLOCKED`, or `UNKNOWN`; it does not choose an experiment or inspect results.

Translation requires a fresh `ELIGIBLE` result at `TRANSLATION_TIME` and exact arm registry entries. A successful native experiment translation emits no commercial intervention. It emits one structured `experimentTask` that preserves the experiment specification, population, timing, Action ID, and fingerprint. Compound translation also preserves the containing compound and component IDs.

The current contract supports fixed allocation only. Adaptive allocation, sequential stopping, winner selection, lift, significance, outcome evaluation, and recommendation logic remain outside this phase.

## Compound Actions

Compound readiness retains each component's validated eligibility result and checks. It evaluates eligibility separately from timing, simulator or engine capability, dependencies, coupled constraints, and atomicity. Mismatched, incomplete, stale, or future eligibility contributes a diagnostic code without attaching the rejected evidence to the component.

For `ALL_OR_NOTHING`, one unavailable component prevents emission of the whole compound. Other policies can emit ready components only after dependency and coupled-constraint gates pass. Experiment components remain structured experiment tasks rather than simulator interventions.

## Legacy compatibility

Existing v2 canonical payloads without `constraints` remain readable and receive an empty constraint array. Recognized legacy constraint expressions map to typed definitions. Unknown legacy expressions map to registered `CUSTOM` constraints so the system preserves the original restriction without pretending to understand it.

Legacy `RUN_EXPERIMENT` Actions keep the `EXPERIMENT_REQUIRES_ENGINE` translation boundary. Only native `experiment.run` Actions produce structured experiment-engine tasks.
