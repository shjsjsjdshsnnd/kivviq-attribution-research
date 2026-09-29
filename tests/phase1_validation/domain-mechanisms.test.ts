import { describe, expect, it } from "vitest";
import { buildDomainValidationCases, DOMAIN_VALIDATION_SEEDS } from "../../src/evaluation/domain-validation-suite.js";
import { buildIntegratedPhase1ValidationSuite } from "../../src/evaluation/phase1-integrated-validation.js";
import { executeValidationPlan, assessArtifactBackedAcceptance } from "../../src/evaluation/validation-evidence.js";

const cases = buildDomainValidationCases();
describe("actual main-kernel mechanism evidence", () => {
  it("retains all previous checks and every registered domain seed", () => {
    expect(cases).toHaveLength(8);
    const integrated = buildIntegratedPhase1ValidationSuite();
    expect(integrated.plan.cases).toHaveLength(69);
    expect(new Set(integrated.plan.cases.map(c => c.caseId)).size).toBe(69);
    expect(Object.values(DOMAIN_VALIDATION_SEEDS).flat()).toHaveLength(8);
    expect(cases.every(c => !c.spec.requirements.includes("adversarial_scenarios") && !c.spec.requirements.includes("difficulty_levels"))).toBe(true);
  });
  it.each(cases.filter(c => !c.spec.caseId.startsWith("domain:retention")))("$spec.caseId has a measured mechanism, stable replay and valid accounting", async c => {
    const output = await c.run();
    expect(output.measurements["checks"]).not.toEqual([]);
    expect(output.passed).toBe(true);
    expect(output.measurements["externalCalibration"]).toBe(false);
    expect(output.measurements["qualification"]).toBe("kernel_mechanism_regression_not_canonical_decision_scenario");
  }, 90000);
  it("preserves failed retention qualifications in the artifact instead of counting the seed as accepted", async () => {
    const retention = cases.filter(c => c.spec.caseId.startsWith("domain:retention"));
    const plan = { version: "simulator-validation-plan/1.0.0" as const, suiteId: "retention-domain-regression", cases: retention.map(c => c.spec) };
    const artifact = await executeValidationPlan({ codeRevision: "a".repeat(40), runId: "retention-public-regression", plan, executors: retention });
    expect(artifact.payload.results).toHaveLength(2);
    for (const record of artifact.payload.results) {
      const checks = record.measurements["checks"] as Array<{ id: string; passed: boolean }>;
      expect(record.status).not.toBe("ERROR"); expect(record.status).not.toBe("NOT_RUN");
      expect(record.status === "PASS").toBe(checks.every(c => c.passed));
    }
    // This is an executed known failing qualification, not permission to weaken
    // its non-vacuous future-value requirement or remove its registered seed.
    const failed = artifact.payload.results.find(r => r.caseId.endsWith(":1211201"))!;
    expect(failed.status).toBe("FAIL");
    expect((failed.measurements["checks"] as Array<{ id: string; passed: boolean }>).filter(c => !c.passed).map(c => c.id))
      .toContain("future_value_is_nonvacuous_and_separate");
    const acceptance = assessArtifactBackedAcceptance("a".repeat(40), [{ plan, artifact }]);
    expect(acceptance.overall).toBe("FAIL");
    expect(acceptance.requirements.find(r => r.requirement === "retention_clv")!.checkedCases).toBe(2);
  }, 90000);
});
