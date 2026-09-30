import { describe, expect, it } from "vitest";
import { runPhase1ValidationMatrix } from "../../src/evaluation/phase1-validation-suite.js";
import { buildIntegratedPhase1ValidationSuite } from "../../src/evaluation/phase1-integrated-validation.js";

describe("executed public simulator validation matrix", () => {
  it("keeps all Phase 1 evidence families in the integrated acceptance plan", () => {
    const { plan } = buildIntegratedPhase1ValidationSuite();
    expect(plan.cases).toHaveLength(96);
    expect(new Set(plan.cases.map((row) => row.caseId)).size).toBe(96);

    const adversarial = plan.cases.filter((row) =>
      row.requirements.includes("adversarial_scenarios"),
    );
    expect(adversarial).toHaveLength(20);
    expect(new Set(adversarial.map((row) => row.scenarioFamily)).size).toBe(20);

    const difficulty = plan.cases.filter((row) =>
      row.requirements.includes("difficulty_levels"),
    );
    expect(difficulty).toHaveLength(7);
    expect(difficulty.map((row) => row.difficultyLevel)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("executes every registered case without treating partial coverage as Phase 1 acceptance", async () => {
    const result = await runPhase1ValidationMatrix("a".repeat(40), "unit-matrix-public-seeds");
    expect(result.plan.cases).toHaveLength(61);
    expect(result.artifact.payload.results.filter(r => r.status !== "PASS")).toEqual([]);
    const row = (id: string) => result.acceptance.requirements.find(r => r.requirement === id)!;
    expect(row("merchant_archetypes").distinctCoverage).toBe(11);
    expect(row("core_channels").distinctCoverage).toBe(7);
    expect(row("customer_segments").distinctCoverage).toBe(6);
    expect(row("decision_oracle").status).toBe("PASS");
    expect(row("counterfactual_interventions").status).toBe("PASS");
    expect(row("adversarial_scenarios").status).toBe("NOT_MEASURED");
    expect(row("difficulty_levels").status).toBe("NOT_MEASURED");
    expect(result.acceptance.overall).toBe("INCOMPLETE");
    const distribution = result.artifact.payload.results.find(r => r.caseId === "matrix:independent-seed-distributions")!;
    expect(distribution.measurements["externalCalibration"]).toBe(false);
  }, 180000);
});
