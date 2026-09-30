import { describe, expect, it } from "vitest";
import { buildDomainValidationCases, DOMAIN_VALIDATION_SEEDS } from "../../src/evaluation/domain-validation-suite.js";
import { buildIntegratedPhase1ValidationSuite } from "../../src/evaluation/phase1-integrated-validation.js";
import { executeValidationPlan, assessArtifactBackedAcceptance } from "../../src/evaluation/validation-evidence.js";

const cases = buildDomainValidationCases();
describe("actual main-kernel mechanism evidence", () => {
  it("retains all previous checks and every registered domain seed", () => {
    expect(cases).toHaveLength(8);
    const integrated = buildIntegratedPhase1ValidationSuite();
    expect(integrated.plan.cases).toHaveLength(74);
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
  it("requires retention evidence to be uncensored and stable under a doubled session ceiling", async () => {
    const retention = cases.filter(c => c.spec.caseId.startsWith("domain:retention"));
    const plan = { version: "simulator-validation-plan/1.0.0" as const, suiteId: "retention-domain-regression", cases: retention.map(c => c.spec) };
    const artifact = await executeValidationPlan({ codeRevision: "a".repeat(40), runId: "retention-public-regression", plan, executors: retention });
    expect(artifact.payload.results).toHaveLength(2);
    for (const record of artifact.payload.results) {
      const checks = record.measurements["checks"] as Array<{ id: string; passed: boolean }>;
      expect(record.status).not.toBe("ERROR"); expect(record.status).not.toBe("NOT_RUN");
      expect(record.status === "PASS").toBe(checks.every(c => c.passed));
      expect(checks.find(c => c.id === "retention_session_cap_is_nonbinding")?.passed).toBe(true);
      expect(checks.find(c => c.id === "retention_trajectory_converges_under_doubled_cap")?.passed).toBe(true);
      expect(checks.find(c => c.id === "future_value_is_nonvacuous_and_separate")?.passed).toBe(true);
      const validity = record.measurements["longitudinalValidity"] as {
        primarySessionCap: number; convergenceSessionCap: number;
        sessionCapNonbinding: boolean; trajectoryConverged: boolean;
      };
      expect(validity.primarySessionCap).toBeLessThan(validity.convergenceSessionCap);
      expect(validity.sessionCapNonbinding).toBe(true);
      expect(validity.trajectoryConverged).toBe(true);
    }
    const acceptance = assessArtifactBackedAcceptance("a".repeat(40), [{ plan, artifact }]);
    expect(acceptance.requirements.find(r => r.requirement === "retention_clv")!.status).toBe("PASS");
    expect(acceptance.requirements.find(r => r.requirement === "retention_clv")!.checkedCases).toBe(2);
  }, 180000);
});
