import { describe, expect, it } from "vitest";
import { PHASE1_REQUIREMENTS, assessPhase1Acceptance, assessGraduation,
  type Phase1Requirement, type Phase1Evidence, type DifficultyCaseResult } from "../../src/evaluation/phase1-acceptance.js";
import { evaluateFiniteActionSet, decisionRegret, oracleContribution,
  type OracleEconomics, type OracleEvaluationContext } from "../../src/evaluation/finite-decision-oracle.js";
const REVISION = "a".repeat(40);
const proof = (requirement: Phase1Requirement, covered = 0): Phase1Evidence => ({
  requirement, codeRevision: REVISION, runId: "unit-test-run", artifactSha256: "b".repeat(64),
  cases: [{ caseId: `tested:${requirement}`, passed: true,
    coverageValues: Array.from({ length: covered }, (_, i) => `${requirement}:${i}`) }],
});

describe("Phase 1 acceptance evidence", () => {
  it("does not award any pass for a feature name, empty report or missing evidence", () => {
    const report = assessPhase1Acceptance(REVISION, []);
    expect(report.overall).toBe("INCOMPLETE");
    expect(report.requirements).toHaveLength(21);
    expect(report.requirements.every(r => r.status === "NOT_MEASURED")).toBe(true);
    expect(assessPhase1Acceptance(REVISION, [proof("measurement_corruption")]).overall).toBe("INCOMPLETE");
  });
  it("requires actual distinct coverage targets and all requirements", () => {
    const evidence = PHASE1_REQUIREMENTS.map(r => proof(r, r === "adversarial_scenarios" ? 20 : 10));
    expect(assessPhase1Acceptance(REVISION, evidence).overall).toBe("PASS");
    const missingScenario = evidence.map(e => e.requirement === "adversarial_scenarios" ? proof("adversarial_scenarios", 19) : e);
    expect(assessPhase1Acceptance(REVISION, missingScenario).overall).toBe("FAIL");
    // This is a gate unit test using synthetic evidence, not a Phase 1 acceptance run.
  });
  it("a single failed invariant blocks acceptance despite every other pass", () => {
    const evidence = PHASE1_REQUIREMENTS.map(r => proof(r, 20));
    const failing = { ...proof("zero_future_leakage"), cases: [{ caseId: "future-leak", passed: false }] };
    expect(assessPhase1Acceptance(REVISION, evidence.map(e => e.requirement === failing.requirement ? failing : e)).overall).toBe("FAIL");
  });
  it("rejects stale revisions, duplicate evidence and repeated test identities", () => {
    expect(() => assessPhase1Acceptance(REVISION, [{ ...proof("accounting_reconciliation"), codeRevision: "c".repeat(40) }])).toThrow();
    expect(() => assessPhase1Acceptance(REVISION, [proof("decision_oracle"), proof("decision_oracle")])).toThrow();
    expect(() => assessPhase1Acceptance(REVISION, [{ ...proof("reproducibility"), cases: [{ caseId: "same", passed: true }, { caseId: "same", passed: true }] }])).toThrow();
  });
});

describe("difficulty graduation", () => {
  const rules = Array.from({ length: 7 }, (_, i) => ({ level: i + 1, minimumCases: 2, minimumPassRate: 1, maximumMeanRegretMinor: 100 }));
  const results: DifficultyCaseResult[] = Array.from({ length: 14 }, (_, i) => ({
    caseId: `case-${i}`, level: Math.floor(i / 2) + 1, holdoutId: "sealed-holdout", passed: true, regretMinor: 50, safetyViolations: 0,
  }));
  const grade = (r: readonly DifficultyCaseResult[]) => assessGraduation({ policyVersion: "pre-registered-v1", holdoutId: "sealed-holdout", rules, results: r });
  it("missing earlier levels block graduation on later successes", () => {
    expect(grade([]).highestGraduatedLevel).toBe(0);
    expect(grade(results.filter(r => r.level > 1)).highestGraduatedLevel).toBe(0);
    expect(grade(results).highestGraduatedLevel).toBe(7);
  });
  it("a safety violation or excess regret blocks that level and all successors", () => {
    expect(grade(results.map(r => r.level === 3 ? { ...r, safetyViolations: 1 } : r)).highestGraduatedLevel).toBe(2);
    expect(grade(results.map(r => r.level === 4 ? { ...r, regretMinor: 101 } : r)).highestGraduatedLevel).toBe(3);
  });
  it("rejects negative regret, duplicate cases, mixed holdouts and missing rules", () => {
    expect(() => grade([{ ...results[0]!, regretMinor: -1 }])).toThrow();
    expect(() => grade([results[0]!, results[0]!])).toThrow();
    expect(() => grade([{ ...results[0]!, holdoutId: "different" }])).toThrow();
    expect(() => assessGraduation({ policyVersion: "v1", holdoutId: "h", rules: [], results: [] })).toThrow();
  });
});

function economics(value: Partial<OracleEconomics> = {}): OracleEconomics {
  return { netSalesMinor: 10000, cogsMinor: 3000, paymentFeesMinor: 300,
    fulfillmentMinor: 400, shippingCostMinor: 400, variableOperatingCostMinor: 100,
    paidSpendMinor: 1000, actionCostMinor: 0, ...value };
}
function search(overrides: Partial<Parameters<typeof evaluateFiniteActionSet<number>>[0]> = {}) {
  return evaluateFiniteActionSet<number>({
    actionSetVersion: "analytic-test-set-v1", universeComplete: true, baselineActionId: "no_op",
    candidates: [{ actionId: "no_op", action: 0 }, { actionId: "fix", action: 1 }, { actionId: "discount", action: 2 }],
    seeds: [1, 2, 3], scope: "synthetic-analytic-control", currency: "CAD",
    horizon: { start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" },
    maximumEvaluations: 9,
    evaluate: ({ candidate, seed }: OracleEvaluationContext<number>) => economics({
      netSalesMinor: 10000 + seed * 10 + (candidate.action === 1 ? 1000 : candidate.action === 2 ? 3100 : 0),
      actionCostMinor: candidate.action === 2 ? 4000 : 0,
    }),
    ...overrides,
  });
}

describe("evaluator finite-action oracle harness", () => {
  it("ranks reconciled contribution, not revenue, using identical seeds for every action", async () => {
    const result = await search();
    expect(result.bestActionId).toBe("fix");
    expect(result.worstActionId).toBe("discount");
    expect(result.evaluations).toBe(9);
    expect(result.ranking.every(r => r.contributionBySeed.map(v => v.seed).join() === "1,2,3")).toBe(true);
    expect(result.ranking[0]?.meanDeltaVersusBaselineMinor).toBe(1000);
    expect(result.ranking[0]?.pairedDeltaStandardErrorMinor).toBe(0);
    expect(decisionRegret(result, "no_op").regretMinor).toBe(1000);
    expect(decisionRegret(result, "discount").regretMinor).toBe(1900);
    expect(decisionRegret(result, "fix").regretMinor).toBe(0);
    expect(decisionRegret(result, "fix").expectedRegretVerified).toBe(false);
  });
  it("keeps non-converter spend and implementation costs in the objective", () => {
    expect(oracleContribution(economics({ netSalesMinor: 0, cogsMinor: 0, paymentFeesMinor: 0,
      fulfillmentMinor: 0, shippingCostMinor: 0, variableOperatingCostMinor: 0, paidSpendMinor: 1000, actionCostMinor: 100 }))).toBe(-1100);
    expect(() => oracleContribution({ ...economics(), platformRevenueMinor: 999999 })).toThrow();
    expect(() => oracleContribution({ ...economics(), paidSpendMinor: undefined })).toThrow();
  });
  it("never describes a single realized seed as an expected optimum", async () => {
    const result = await search({ seeds: [1] });
    expect(result.method).toBe("single_seed_realized");
    expect(result.ranking.every(r => r.standardErrorMinor === null)).toBe(true);
    expect(decisionRegret(result, "no_op").reference).toBe("realized_seed_optimum");
  });
  it("fails closed on missing universe, budget shortfall, duplicate seeds or failed replay", async () => {
    await expect(search({ universeComplete: false })).rejects.toThrow();
    await expect(search({ maximumEvaluations: 8 })).rejects.toThrow();
    await expect(search({ seeds: [1, 1] })).rejects.toThrow();
    await expect(search({ baselineActionId: "not-available" })).rejects.toThrow();
    await expect(search({ evaluate: () => { throw new Error("replay failed"); } })).rejects.toThrow("replay failed");
    const result = await search();
    expect(() => decisionRegret(result, "unknown-action")).toThrow();
  });
});
