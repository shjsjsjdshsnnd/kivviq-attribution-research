# Information Boundaries

## Three layers

### 1. Latent Ground Truth

Contains hidden causal reality such as:

- latent intent;
- true channel incrementality;
- true elasticity;
- response curves;
- counterfactual purchase probabilities;
- true unconstrained demand;
- the causal graph.

This layer is available only to simulation/evaluation infrastructure.

### 2. Perfectly Observable Events

Contains events that could theoretically be observed with perfect instrumentation:

- impressions;
- clicks;
- sessions;
- page/product/cart/checkout events;
- purchases;
- device;
- timestamps;
- order amounts.

These events do not contain latent causal parameters.

### 3. Merchant Observation

Contains the evidence a merchant could receive after future measurement limitations are applied.

Step 1 defines the boundary and schema only. It does not yet implement measurement corruption.

## Data flow

```
GroundTruth ---------------------> Simulator / Oracle / Evaluator

future SimulationState
        |
        v
ObservationGenerator
        |
        v
ObservableEvent[]
        |
        v
future MeasurementLayer
        |
        v
MerchantObservation
        |
        v
OperatorInput
```

GroundTruth does not flow through the Operator path.

## Package-level boundary

The root package surface exports only:

- explicit units;
- ObservableEvent;
- MerchantObservation;
- OperatorInput;
- the allowlisted Operator boundary functions.

GroundTruth is intentionally absent from the root export.

God-mode consumers must explicitly import the `./ground-truth` subpath.

Evaluator-only access is isolated behind `./evaluation`.

## Allowlist transformation

`toOperatorInput` constructs a new object from approved fields.

It does not serialize a richer object and delete hidden fields afterward.

This is intentional: omission from a rich GroundTruth-bearing structure would be fragile and could leak future fields.

## Covert channels

Operator-facing structures do not support arbitrary `metadata: Record<string, unknown>`.

The leakage guard recursively rejects forbidden latent keys and unrestricted metadata objects.

This is defense in depth. The primary control is the type/module boundary and explicit allowlist.

## Temporal leakage

Observable events carry both `subjectCreatedAt` and `occurredAt`.

The Operator boundary rejects events that occur before the subject exists.

Future simulator and measurement implementations must continue this rule: future state cannot modify past evidence.

## Security model

These boundaries are research information-flow controls, not a substitute for process isolation or a production authorization system.

Future Step 2 code must preserve the same dependency direction and must not give Operator-facing code references to God-mode objects.
