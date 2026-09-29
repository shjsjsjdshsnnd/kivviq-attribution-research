import { describe, expect, it } from "vitest";
import { DIFFICULTY_FEATURES, registerDifficultyCurriculum, graduateScoredCurriculum, type CurriculumCase } from "../../src/evaluation/difficulty-curriculum.js";
import { executeValidationPlan, type ExecutableValidationCase, type ValidationPlan } from "../../src/evaluation/validation-evidence.js";
import { evaluateExactActionSet } from "../../src/evaluation/exact-decision-oracle.js";
import { buildTractableCheckoutControl } from "../../src/evaluation/tractable-checkout-control.js";
import { sha256 } from "../../src/evaluation/replay-manifest.js";

// Deliberately manufactured qualification receipts test the gating logic. They
// are NOT actual qualified difficulty worlds and are never Phase 1 evidence.
async function setup() {
  const oracle = await evaluateExactActionSet(buildTractableCheckoutControl());
  const cases: ExecutableValidationCase[] = DIFFICULTY_FEATURES.map(p => ({
    spec: { caseId: `case-${p.level}`, implementationVersion: "logic-only/1", kind: "qualified_difficulty_world",
      difficultyLevel: p.level, requirements: ["difficulty_levels"] },
    run: () => ({ passed: true, measurements: { worldHash: sha256(`logic-world-${p.level}`),
      verifiedFeatures: [...p.required], deterministicAcrossExogenousStates: p.level === 1 } }),
  }));
  const plan: ValidationPlan = { version: "simulator-validation-plan/1.0.0", suiteId: "logic-only-not-world-qualification", cases: cases.map(c => c.spec) };
  const codeRevision = "a".repeat(40);
  const artifact = await executeValidationPlan({ codeRevision, runId: "logic-only", plan, executors: cases });
  const specs: CurriculumCase[] = cases.map((c, i) => ({ caseId: c.spec.caseId, level: i + 1, family: `logic-family-${i}`,
    worldHash: sha256(`logic-world-${i + 1}`), qualificationArtifactHash: artifact.sha256,
    candidateSetHash: oracle.candidateSetHash, regretBasis: "exact_expected", currency: oracle.currency, scope: oracle.scope,
    horizonDays: 1, verifiedFeatures: [...DIFFICULTY_FEATURES[i]!.required], deterministicAcrossExogenousStates: i === 0 }));
  const input = { codeRevision, version: "graduation-policy/1", holdoutId: "public-logic-tests", split: "public_validation" as const,
    rules: DIFFICULTY_FEATURES.map(p => ({ level: p.level, minimumCases: 1, minimumPassRate: 1, maximumMeanRegretMinor: 0 })), cases: specs };
  const sources = [{ plan, artifact }];
  const curriculum = registerDifficultyCurriculum(input, sources);
  const trials = specs.map(c => ({ caseId: c.caseId, worldHash: c.worldHash, qualificationArtifactHash: c.qualificationArtifactHash,
    selectedActionId: oracle.bestActionId, oracle, safetyViolations: 0 }));
  return { oracle, input, sources, curriculum, trials };
}
describe("evidence-bound difficulty graduation", () => {
  it("requires actual matching qualification artifacts, not names or a valid-looking hash", async () => {
    const x = await setup();
    expect(() => registerDifficultyCurriculum(x.input, [])).toThrow("qualification");
    const wrong = structuredClone(x.input); wrong.cases[0]!.worldHash = "0".repeat(64);
    expect(() => registerDifficultyCurriculum(wrong, x.sources)).toThrow("qualification");
    expect(() => registerDifficultyCurriculum({ ...x.input, codeRevision: "b".repeat(40) }, x.sources)).toThrow("revision");
  });
  it("rejects stochastic Level 1 and mislabeled feature profiles even in a consistent receipt", async () => {
    const x = await setup(), input = structuredClone(x.input), source = structuredClone(x.sources[0]!);
    input.cases[0]!.deterministicAcrossExogenousStates = false;
    source.artifact.payload.results[0]!.measurements["deterministicAcrossExogenousStates"] = false;
    source.artifact.sha256 = sha256(source.artifact.payload);
    for (const c of input.cases) c.qualificationArtifactHash = source.artifact.sha256;
    expect(() => registerDifficultyCurriculum(input, [source])).toThrow("claimed difficulty");
  });
  it("computes regret from full oracle evidence and advances levels in sequence", async () => {
    const x = await setup();
    expect(graduateScoredCurriculum(x.curriculum, x.trials).highestGraduatedLevel).toBe(7);
    const bad = structuredClone(x.trials); bad[0]!.selectedActionId = x.oracle.worstActionId;
    const report = graduateScoredCurriculum(x.curriculum, bad);
    expect(report.highestGraduatedLevel).toBe(0);
    expect(report.levels[0]!.status).toBe("FAILED");
    expect(report.levels.slice(1).every(l => l.status === "BLOCKED_BY_PREVIOUS_LEVEL")).toBe(true);
    expect(report.sealedHoldoutClaim).toBe("not_a_sealed_holdout");
  });
  it("missing expected cases and any safety violation block graduation", async () => {
    const x = await setup();
    const missing = graduateScoredCurriculum(x.curriculum, x.trials.slice(1));
    expect(missing.highestGraduatedLevel).toBe(0); expect(missing.missingCases).toEqual(["case-1"]);
    const unsafe = structuredClone(x.trials); unsafe[1]!.safetyViolations = 1;
    expect(graduateScoredCurriculum(x.curriculum, unsafe).highestGraduatedLevel).toBe(1);
  });
  it("rejects mixed action universes, horizons, regret meanings, forged scores and repeat submissions", async () => {
    const x = await setup();
    expect(() => graduateScoredCurriculum(x.curriculum, [x.trials[0]!, x.trials[0]!])).toThrow("duplicate");
    const wrong = structuredClone(x.trials); (wrong[0]!.oracle as { candidateSetHash: string }).candidateSetHash = "0".repeat(64);
    expect(() => graduateScoredCurriculum(x.curriculum, wrong)).toThrow("scope");
    const corrupt = structuredClone(x.trials); (corrupt[0]!.oracle.ranking[0] as { weightedContribution: string }).weightedContribution = "0";
    expect(() => graduateScoredCurriculum(x.curriculum, corrupt)).toThrow("integrity");
    const changed = structuredClone(x.curriculum); changed.rules[0]!.maximumMeanRegretMinor = 999999;
    expect(() => graduateScoredCurriculum(changed, x.trials)).toThrow("changed");
  });
});
