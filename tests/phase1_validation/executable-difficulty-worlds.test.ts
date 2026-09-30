import { describe, expect, it } from "vitest";
import {
  buildExecutableDifficultyWorldCases,
} from "../../src/evaluation/executable-difficulty-worlds.js";
import {
  assessArtifactBackedAcceptance,
  executeValidationPlan,
  type ValidationPlan,
} from "../../src/evaluation/validation-evidence.js";

describe("executed difficulty worlds", () => {
  it("qualifies all seven levels from executed world evidence, including full Level 7 mechanism coverage", async () => {
    const cases = [...buildExecutableDifficultyWorldCases()];
    const plan: ValidationPlan = {
      version: "simulator-validation-plan/1.0.0",
      suiteId: "difficulty-worlds-levels-1-2",
      cases: cases.map((candidate) => candidate.spec),
    };
    const revision = "a".repeat(40);
    const artifact = await executeValidationPlan({
      codeRevision: revision,
      runId: "difficulty-worlds-public-regression",
      plan,
      executors: cases,
    });

    expect(artifact.payload.results.map((row) => row.status)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);

    const level1 = artifact.payload.results[0]!;
    expect(level1.measurements["verifiedFeatures"]).toEqual([]);
    expect(
      level1.measurements["deterministicAcrossExogenousStates"],
    ).toBe(true);
    expect(level1.measurements["probabilityDenominator"]).toBe("1");
    expect(level1.measurements["exogenousProbeCount"]).toBe(5);

    const level2 = artifact.payload.results[1]!;
    expect(level2.measurements["verifiedFeatures"]).toEqual([
      "stochastic",
    ]);
    expect(
      level2.measurements["deterministicAcrossExogenousStates"],
    ).toBe(false);
    expect(level2.measurements["outcomeCount"]).toBe(256);
    expect(level2.measurements["evaluatedActions"]).toBe(37);
    expect(level2.measurements["stochasticOutcomeResponse"]).toBe(true);

    const level3 = artifact.payload.results[2]!;
    expect(level3.measurements["verifiedFeatures"]).toEqual([
      "stochastic",
      "confounding",
    ]);
    expect(level3.measurements["confoundingObserved"]).toBe(true);
    expect(level3.measurements["statewisePurchaseInvariance"]).toBe(true);
    expect(level3.measurements["exposedConversion"]).toBeGreaterThan(
      level3.measurements["unexposedConversion"] as number,
    );

    const level4 = artifact.payload.results[3]!;
    expect(level4.measurements["verifiedFeatures"]).toEqual([
      "stochastic",
      "confounding",
      "corruption",
    ]);
    expect(level4.measurements["corruptionObserved"]).toBe(true);
    expect(level4.measurements["preservedOrders"]).toBe(true);
    expect(level4.measurements["cleanMetaEvents"]).toBeGreaterThan(0);
    expect(level4.measurements["corruptedMetaEvents"]).toBe(0);
    expect(level4.measurements["corruptionReasons"]).toContain("missing_utms");
    expect(level4.measurements["corruptionReasons"]).toContain("direct_fallback");

    const level5 = artifact.payload.results[4]!;
    expect(level5.measurements["verifiedFeatures"]).toEqual([
      "stochastic",
      "confounding",
      "corruption",
      "dynamics",
    ]);
    expect(level5.measurements["confoundingObserved"]).toBe(true);
    expect(level5.measurements["corruptionObserved"]).toBe(true);
    expect(level5.measurements["preservedOrders"]).toBe(true);
    expect(level5.measurements["stablePastAcrossShock"]).toBe(true);
    expect(level5.measurements["knownShockEffect"]).toBe(true);
    expect(level5.measurements["inventoryNeverNegative"]).toBe(true);
    expect(level5.measurements["pairedDynamicCases"]).toBe(16);
    expect(level5.measurements["outcomeCount"]).toBe(32);

    const level6 = artifact.payload.results[5]!;
    expect(level6.measurements["verifiedFeatures"]).toEqual([
      "stochastic",
      "confounding",
      "corruption",
      "dynamics",
      "multiple_traps",
    ]);
    expect(level6.measurements["scaleHasZeroIncrementalSales"]).toBe(true);
    expect(level6.measurements["scaleDestroysContribution"]).toBe(true);
    expect(level6.measurements["discountRaisesRevenue"]).toBe(true);
    expect(level6.measurements["discountLowersContribution"]).toBe(true);
    expect(level6.measurements["inventoryBindingStates"]).toBeGreaterThan(0);
    expect(level6.measurements["independentTrapCount"]).toBeGreaterThanOrEqual(3);

    const level7 = artifact.payload.results[6]!;
    expect(level7.measurements["verifiedFeatures"]).toEqual([
      "stochastic",
      "confounding",
      "corruption",
      "dynamics",
      "multiple_traps",
      "all_mechanisms",
    ]);
    expect(level7.measurements["confoundingObserved"]).toBe(true);
    expect(level7.measurements["preservedOrders"]).toBe(true);
    expect(level7.measurements["stablePastAcrossShock"]).toBe(true);
    expect(level7.measurements["inventoryBindingStates"]).toBeGreaterThan(0);
    expect(level7.measurements["scaleMetaRevenueTrap"]).toBe(true);
    expect(level7.measurements["discountRevenueTrap"]).toBe(true);
    expect(level7.measurements["allMechanismsCoverage"]).toEqual([
      "paid_media_response",
      "diminishing_channel_returns",
      "cross_channel_interaction",
      "pricing_elasticity",
      "promotion_economics",
      "retention_customer_value",
      "inventory_constraints",
      "external_shocks",
      "measurement_corruption",
      "returns_economics",
      "counterfactual_interventions",
    ]);
    expect(Object.values(
      level7.measurements["allMechanismsChecks"] as Record<string, boolean>,
    ).every(Boolean)).toBe(true);

    const acceptance = assessArtifactBackedAcceptance(revision, [
      { plan, artifact },
    ]);
    const difficulty = acceptance.requirements.find(
      (row) => row.requirement === "difficulty_levels",
    )!;
    expect(difficulty.checkedCases).toBe(7);
    expect(difficulty.distinctCoverage).toBe(7);
    expect(difficulty.requiredCoverage).toBe(7);
    expect(difficulty.status).toBe("PASS");
    expect(acceptance.overall).toBe("INCOMPLETE");
  });
});
