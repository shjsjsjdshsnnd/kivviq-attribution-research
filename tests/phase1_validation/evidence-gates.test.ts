import { describe, expect, it } from "vitest";
import { executeValidationPlan, assessArtifactBackedAcceptance, verifyValidationArtifact, validatePlan, type ValidationPlan, type ExecutableValidationCase } from "../../src/evaluation/validation-evidence.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";
const revision = "a".repeat(40);
function suite() {
  const cases: ExecutableValidationCase[] = ["reproducibility", "accounting_reconciliation"].map((r, i) => ({
    spec: { caseId: `case-${i}`, implementationVersion: "test/1", kind: "analytic_control", requirements: [r as "reproducibility" | "accounting_reconciliation"] },
    run: () => ({ passed: true, measurements: { measured: 10, expected: 10 } }),
  }));
  const plan: ValidationPlan = { version: "simulator-validation-plan/1.0.0", suiteId: "unit-scope-not-acceptance", cases: cases.map(c => c.spec) };
  return { cases, plan };
}
describe("artifact-backed Phase 1 evidence", () => {
  it("does not call an empty or partial feature report Phase 1 complete", async () => {
    const { cases, plan } = suite();
    const artifact = await executeValidationPlan({ codeRevision: revision, runId: "test", plan, executors: cases });
    const report = assessArtifactBackedAcceptance(revision, [{ plan, artifact }]);
    expect(report.overall).toBe("INCOMPLETE"); expect(report.requirements.filter(r => r.status === "PASS")).toHaveLength(2);
    expect(report.evidenceMode).toBe("verified_artifact_contents");
  });
  it("rejects tampered content even when a caller supplies a valid-looking hash", async () => {
    const { cases, plan } = suite(), artifact = await executeValidationPlan({ codeRevision: revision, runId: "test", plan, executors: cases });
    const tampered = structuredClone(artifact); tampered.payload.results[0]!.status = "FAIL";
    expect(() => assessArtifactBackedAcceptance(revision, [{ plan, artifact: tampered }])).toThrow("integrity");
    expect(() => verifyValidationArtifact(artifact, plan, "b".repeat(40))).toThrow("revision");
    expect(() => verifyValidationArtifact(artifact, { ...plan, suiteId: "another" }, revision)).toThrow("plan");
  });
  it("errors and missing executors stay in the registered denominator and block a pass", async () => {
    const { cases, plan } = suite();
    const artifact = await executeValidationPlan({ codeRevision: revision, runId: "test", plan,
      executors: [{ ...cases[0]!, run: () => { throw Error("internal world details"); } }] });
    expect(artifact.payload.results.map(r => r.status)).toEqual(["ERROR", "NOT_RUN"]);
    expect(JSON.stringify(artifact)).not.toContain("internal world details");
    const report = assessArtifactBackedAcceptance(revision, [{ plan, artifact }]);
    expect(report.overall).toBe("FAIL"); expect(report.notRunCases).toEqual(["case-1"]);
  });
  it("rejects removed or duplicated cases even in a self-rehashed artifact", async () => {
    const { cases, plan } = suite(), artifact = await executeValidationPlan({ codeRevision: revision, runId: "test", plan, executors: cases });
    artifact.payload.results.pop(); artifact.sha256 = sha256(artifact.payload);
    expect(() => verifyValidationArtifact(artifact, plan, revision)).toThrow("every registered");
    expect(() => validatePlan({ ...plan, cases: [...plan.cases, plan.cases[0]!] })).toThrow("duplicate");
  });
  it("does not count seeds, controls or measurement fixtures as canonical adversarial scenarios", async () => {
    const base = suite().plan;
    expect(() => validatePlan({ ...base, cases: [{ ...base.cases[0], requirements: ["adversarial_scenarios"], coverage: { adversarial_scenarios: Array.from({ length: 20 }, (_, i) => String(i)) } }] })).toThrow("canonical");
    const cases: ExecutableValidationCase[] = Array.from({ length: 20 }, (_, i) => ({
      spec: { caseId: `seed-${i}`, implementationVersion: "test/1", kind: "canonical_decision_scenario", scenarioFamily: "same-mechanism",
        requirements: ["adversarial_scenarios"] }, run: () => ({ passed: true, measurements: {} }) }));
    const plan: ValidationPlan = { ...base, cases: cases.map(c => c.spec) };
    const artifact = await executeValidationPlan({ codeRevision: revision, runId: "test", plan, executors: cases });
    const row = assessArtifactBackedAcceptance(revision, [{ plan, artifact }]).requirements.find(r => r.requirement === "adversarial_scenarios")!;
    expect(row.distinctCoverage).toBe(1); expect(row.status).toBe("FAIL");
  });
  it("cannot award difficulty coverage from labels alone or reuse artifacts to inflate coverage", async () => {
    const { cases, plan } = suite();
    expect(() => validatePlan({ ...plan, cases: [{ ...plan.cases[0], requirements: ["difficulty_levels"] }] })).toThrow("qualification");
    const artifact = await executeValidationPlan({ codeRevision: revision, runId: "test", plan, executors: cases });
    expect(() => assessArtifactBackedAcceptance(revision, [{ plan, artifact }, { plan, artifact }])).toThrow("reused");
  });
});
