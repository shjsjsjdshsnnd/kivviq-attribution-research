# Diagnosis regression repair

This is a repair of the Step 5 branch's validation gate, not completion of the 27-step Diagnosis Engine and not a production deployment.

## Complete regression execution

The original workflow combined architecture, types, all simulation tests and build into one 20-minute job. Existing research regression workflows allow 40 minutes. The repaired workflow exposes architecture/typecheck/build separately and uses eight native Vitest file shards for the complete existing `npm test` universe. It retains single-worker isolation in each shard, does not filter tests or lower assertions, preserves JSON reports, and requires every shard plus the diagnosis and static checks before the existing `repository-regression` gate can pass. Superseded runs on the same event/ref are cancelled; PR checks continue to test the proposed merge tree.

The first sharded run (`36781281686`, feature head `1cf0e970374eb2ad506c7d2ca681186bbe14e512`) confirmed the full repository architecture/typecheck/build and diagnosis checks, and exposed an inherited failure in `tests/website_cro/model-contract.test.ts`:

- weak imagery quality: 0.24;
- imagery intervention quality: 0.96;
- original change in PDP transition multiplier: 0.027118619084284035;
- existing required minimum: strictly greater than 0.05.

The original test and fixture are deliberately unchanged.

## Root cause and correction

The v1 runtime averaged a severe imagery deficit together with healthy unrelated PDP attributes, then passed the average through a saturating quality function. The imagery defect was flagged but healthy attributes compensated for most of its effect. This conflicted with the existing severe-imagery scenario's minimum-effect contract.

A bounded confidence bottleneck now acts **only** on PDPs below the existing weak-imagery threshold, using the effective product imagery and the category's existing imagery importance:

```text
shortfall = max(0, 0.52 - effectiveImageryQuality)
confidenceFactor = 1 - categoryImageryImportance * shortfall^2
```

The factor is continuous and monotone, has zero slope at the threshold, equals one for acceptable imagery or zero category importance, and never falls below 0.7296 for valid parameters. Both progression/continuation multipliers retain their existing floors. This is an explicit **synthetic response assumption**, not an experimentally estimated real-world conversion effect or proof of causal validity in merchant data.

The correction does not inspect scenario IDs or expected answers. It leaves the no-website path, every non-PDP component, acceptable imagery, unrelated state, intervention activation/targeting and source timestamps unchanged. Differential tests retain the exact pre-correction implementation in `runtime-v1.ts` (Git blob `6ff2cc1d4810548ce70de7e435f4218b1df48028`) so these claims can be checked against the original code rather than only against new expectations. Only weak PDP response multipliers are revised; the corrected fixture's transition difference is 0.08824642254096582.

## Reproducibility and compatibility

The scenario schema and `website_model_v1` family identifier are unchanged. The behavior change is NOT silently represented as the same implementation: serialized scenarios and their provenance fingerprints include `runtimeRevision: website-runtime/1.0.1`. Consequently website-enabled scenario fingerprints change, including otherwise healthy configurations. Reproduce old artifacts with their original commit/runtime; do not mix pre-correction and corrected simulation results as identical executions. The normal build still stamps the full source execution identity.

The new tests check the original failure, unchanged controls, product overrides, category sensitivity, scheduled/device-specific interventions, monotonicity and bounds across 3,003 generated settings, continuity, input immutability, and runtime identity. They supplement rather than replace or weaken the inherited assertion.

## Verification status

The code correction must pass the unchanged model-contract test, the new differential tests, all existing website and simulator tests, strict typecheck/build and all eight full-regression shards. A partial or running workflow is not a completed regression pass. Final run IDs and results are recorded in PR #64 after execution.
