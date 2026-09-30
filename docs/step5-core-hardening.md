# Step 5 core hardening — diagnosis/0.1.1

This patch fixes three reproduced defects in the Step 5 core. It does not complete the remaining domain diagnoses, add live-provider wiring, change simulator semantics, merge the PR or freeze the full engine.

Baseline: `3e16eeb95d6870c5a07ae9957ff04b10840f0c0d` on `diagnosis/step5-foundation`, PR #64.

## Reproduced defects and repairs

### 1. Canonical definition substitution at the direct core API

The canonical adapter already checked definition IDs, but callers could invoke the public `diagnose` function directly. The core checked only that the two periods used the same `definitionId`. Giving both revenue observations `gross_sales@business-state/1.0.0` therefore still produced a high-confidence net-revenue diagnosis.

Every observation now requires its own canonical metric ID and the supported Business State definition revision. Unknown aliases, a different metric's definition and unsupported revisions yield `canonical_definition_mismatch`. Rejected values are quarantined from the report and source graph; derived findings are blocked when their source lineage is unusable. Compatible direct observations and safe alternative decompositions remain available.

The definition revision is exported as `CANONICAL_DEFINITION_VERSION`; six integration tests bind it, the supported metric IDs, units and sources to the actual canonical Business State registry. This verifies identifiers, not the truth of a caller's attestations. Source collection and semantic integrity remain the governed collector's responsibility.

### 2. Numerically unsafe interactions could crash valid input

Individual endpoint values can be within the supported input range while mixed-period product terms are too large for safe money allocation. For example, one period can have 1 order at 100,000,000,000,000 minor units per order and the other 100,000,000,000,000 orders at 2 minor units. Both revenue totals are valid inputs, but symmetric product effects exceed the safe allocation range.

The core now checks all mixed-period vertices and the reconciliation range. When the traffic/CVR/AOV partition is unsafe, it tries the independently valid orders/AOV partition. When neither is safe it returns an unknown allocation, retains the verified revenue delta as unallocated change, and specifies the need for higher-precision computation. It does not clip contributions, change currency units or reinterpret a numerical failure as full explanation. Malformed or out-of-input-range values still raise `DiagnosisInputError`.

Ordinary numerical behavior and the allocation formula are unchanged. Small legitimate reconciliation residuals remain explicit rather than being hidden.

### 3. Hidden materiality rules bypassed validation

The validator used `Object.keys` to traverse materiality rules but used the `in` operator to check their presence. A non-enumerable rule could therefore satisfy presence checks without being validated. A getter nested inside that rule executed later during diagnosis. Inherited rules could also satisfy the presence check.

The input boundary now rejects non-enumerable object fields and array entries, requires required fields to be own properties, and checks materiality with `Object.hasOwn`. Accessors are rejected before execution. The materiality map can still contain only rules for the supplied metric subset, and plain null-prototype data objects remain supported.

## Tests and execution

Added `tests/diagnosis/hardening.node-test.mjs`: **34 named tests**, including 1,000 fixed-seed ordinary diagnoses and 280 disproportionate-factor cases. These cases are numerical/validation checks, not distinct causal scenarios. Added `tests/diagnosis_integration/definition-revision.test.ts`: **six registry compatibility tests**.

The local reproduction used byte-matched copies of the baseline core files. Running the same 34 tests against the baseline yielded **6 passed / 28 failed**; running against the corrected core yielded **34 passed / 0 failed**. Strict local TypeScript compilation passed on Node 22.16.0 / TypeScript 5.8.3. Local GitHub DNS was unavailable, so the complete repository regression and locked compiler environment must be verified in GitHub CI, not inferred from this local subset.

The existing core runner now discovers all `tests/diagnosis/*.node-test.mjs` files, sorted deterministically, and fails when none exist. The original 93-test foundation file and assertions are unchanged; the new tests are not omitted by the runner's former single-file allowlist.

```sh
node scripts/test-diagnosis.mjs
npm exec -- vitest run tests/diagnosis_integration --maxWorkers=1
npm run check
```

## Compatibility

Output implementation version: `diagnosis/0.1.1`. Input layout/version remains `diagnosis-input/0.1.0`; formerly accepted invalid definitions and non-JSON-like input are now rejected or quarantined. Calendar semantics, canonical registry definitions, source authorities, causal classifications and simulator behavior are unchanged. Replay earlier behavior at its original code revision.

This is not production-readiness or completion of all 27 Diagnosis Engine requirements. Profitability, channel/customer/product/inventory/lifecycle/funnel diagnoses, bounded hypothesis retrieval and broader statistical/seasonal validation remain separate work.
