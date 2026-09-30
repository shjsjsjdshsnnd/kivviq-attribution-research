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
  it("qualifies Levels 1–4 from executed world evidence without pretending the seven-level ladder is complete", async () => {
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

    const acceptance = assessArtifactBackedAcceptance(revision, [
      { plan, artifact },
    ]);
    const difficulty = acceptance.requirements.find(
      (row) => row.requirement === "difficulty_levels",
    )!;
    expect(difficulty.checkedCases).toBe(4);
    expect(difficulty.distinctCoverage).toBe(4);
    expect(difficulty.requiredCoverage).toBe(7);
    expect(difficulty.status).toBe("FAIL");
    expect(acceptance.overall).toBe("FAIL");
  });
});
