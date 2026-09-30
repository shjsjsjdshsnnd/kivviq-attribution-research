import { verifyValidationArtifact, validatePlan, type ValidationPlan } from "./validation-evidence.js";
import { z } from "zod";
import { sha256, canonicalJson } from "./replay-manifest.js";
import { DIFFICULTY_LEVELS, assessGraduation, type GraduationRule } from "./phase1-acceptance.js";
import { decisionRegret, type FiniteOracleResult } from "./finite-decision-oracle.js";
import { exactDecisionRegret, type ExactOracleResult } from "./exact-decision-oracle.js";

/** Evaluator-only curriculum; labels/features must never enter an Operator offer. */
export const LEVEL7_MECHANISM_REQUIREMENTS = [
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
] as const;

export const DIFFICULTY_FEATURES = [
  { level: 1, required: [], forbidden: ["stochastic", "confounding", "corruption", "dynamics", "multiple_traps", "all_mechanisms"] },
  { level: 2, required: ["stochastic"], forbidden: ["confounding", "corruption", "dynamics", "multiple_traps", "all_mechanisms"] },
  { level: 3, required: ["stochastic", "confounding"], forbidden: ["corruption", "dynamics", "multiple_traps", "all_mechanisms"] },
  { level: 4, required: ["stochastic", "confounding", "corruption"], forbidden: ["dynamics", "multiple_traps", "all_mechanisms"] },
  { level: 5, required: ["stochastic", "confounding", "corruption", "dynamics"], forbidden: ["multiple_traps", "all_mechanisms"] },
  { level: 6, required: ["stochastic", "confounding", "corruption", "dynamics", "multiple_traps"], forbidden: ["all_mechanisms"] },
  { level: 7, required: ["stochastic", "confounding", "corruption", "dynamics", "multiple_traps", "all_mechanisms"], forbidden: [] },
] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const caseSchema = z.object({ caseId: z.string().min(1), level: z.number().int().min(1).max(7),
  family: z.string().min(1), worldHash: hash, qualificationArtifactHash: hash, candidateSetHash: hash,
  regretBasis: z.enum(["exact_expected", "single_seed_realized", "sample_mean_estimate"]),
  currency: z.string().regex(/^[A-Z]{3}$/), scope: z.string().min(1), horizonDays: z.number().positive(),
  /** Must come from executed mechanism checks, not inferred from a scenario title. */
  verifiedFeatures: z.array(z.enum(["stochastic", "confounding", "corruption", "dynamics", "multiple_traps", "all_mechanisms"])),
  deterministicAcrossExogenousStates: z.boolean(),
}).strict();
export type CurriculumCase = z.infer<typeof caseSchema>;
export function registerDifficultyCurriculum(raw: {
  readonly codeRevision: string; readonly version: string; readonly holdoutId: string; readonly split: "public_validation" | "sealed_holdout";
  readonly rules: readonly GraduationRule[]; readonly cases: readonly CurriculumCase[];
}, qualificationSources: readonly { readonly plan: ValidationPlan; readonly artifact: unknown }[]) {
  const proofs = qualificationSources.map(s => ({ plan: validatePlan(s.plan), artifact: verifyValidationArtifact(s.artifact, s.plan, raw.codeRevision) }));
  const cases = raw.cases.map(c => caseSchema.parse(c));
  if (!raw.version.trim() || !raw.holdoutId.trim() || new Set(cases.map(c => c.caseId)).size !== cases.length) throw new RangeError("unique registered curriculum cases required");
  for (const c of cases) {
    const proof = proofs.find(p => p.artifact.sha256 === c.qualificationArtifactHash);
    const registered = proof?.plan.cases.find(s => s.caseId === c.caseId && s.kind === "qualified_difficulty_world" && s.difficultyLevel === c.level);
    const executed = proof?.artifact.payload.results.find(r => r.caseId === c.caseId);
    if (!registered || executed?.status !== "PASS" || executed.measurements["worldHash"] !== c.worldHash ||
        canonicalJson(executed.measurements["verifiedFeatures"]) !== canonicalJson(c.verifiedFeatures) ||
        executed.measurements["deterministicAcrossExogenousStates"] !== c.deterministicAcrossExogenousStates) {
      throw new RangeError("difficulty case lacks matching executed qualification evidence");
    }
    const profile = DIFFICULTY_FEATURES[c.level - 1]!;
    if (profile.required.some(f => !c.verifiedFeatures.includes(f)) || profile.forbidden.some(f => c.verifiedFeatures.includes(f)) ||
        (c.level === 1 && !c.deterministicAcrossExogenousStates) || (c.level > 1 && c.deterministicAcrossExogenousStates)) {
      throw new RangeError("world qualification does not establish the claimed difficulty");
    }
    if (c.level === 7) {
      const coverage = executed.measurements["allMechanismsCoverage"];
      const checks = executed.measurements["allMechanismsChecks"];
      const coverageValid =
        Array.isArray(coverage) &&
        canonicalJson(coverage) === canonicalJson(LEVEL7_MECHANISM_REQUIREMENTS);
      const checksValid =
        typeof checks === "object" &&
        checks !== null &&
        !Array.isArray(checks) &&
        LEVEL7_MECHANISM_REQUIREMENTS.every(
          (mechanism) =>
            (checks as Record<string, unknown>)[mechanism] === true,
        ) &&
        Object.keys(checks as Record<string, unknown>).length ===
          LEVEL7_MECHANISM_REQUIREMENTS.length;
      if (!coverageValid || !checksValid) {
        throw new RangeError(
          "Level 7 requires executed evidence for every canonical mechanism",
        );
      }
    }
  }
  for (const { level } of DIFFICULTY_LEVELS) {
    const group = cases.filter(c => c.level === level);
    if (new Set(group.map(c => c.family)).size !== group.length || new Set(group.map(c => `${c.currency}:${c.scope}:${c.horizonDays}:${c.regretBasis}`)).size > 1) {
      throw new RangeError("within-level cases require distinct mechanism families and comparable regret units/horizons");
    }
  }
  assessGraduation({ policyVersion: raw.version, holdoutId: raw.holdoutId, rules: raw.rules, results: [] });
  const payload = { ...structuredClone(raw), cases };
  return { access: "evaluator_only" as const, ...payload, curriculumHash: sha256(payload) };
}
export type DifficultyCurriculum = ReturnType<typeof registerDifficultyCurriculum>;
export interface ScoredCurriculumTrial {
  readonly caseId: string; readonly worldHash: string; readonly qualificationArtifactHash: string;
  readonly selectedActionId: string; readonly oracle: FiniteOracleResult | ExactOracleResult;
  readonly safetyViolations: number;
}
/** Compute regret from oracle evidence. Do not accept a caller's claimed regret or level. */
export function graduateScoredCurriculum(curriculum: DifficultyCurriculum, rawTrials: readonly ScoredCurriculumTrial[]) {
  const { curriculumHash, access: _access, ...registered } = curriculum;
  if (sha256(registered) !== curriculumHash) throw new RangeError("curriculum changed after registration");
  const trials = structuredClone(rawTrials);
  if (new Set(trials.map(t => t.caseId)).size !== trials.length) throw new RangeError("duplicate scored trial");
  const results = trials.map(trial => {
    const spec = curriculum.cases.find(c => c.caseId === trial.caseId);
    if (!spec || trial.worldHash !== spec.worldHash || trial.qualificationArtifactHash !== spec.qualificationArtifactHash ||
        !Number.isSafeInteger(trial.safetyViolations) || trial.safetyViolations < 0 ||
        trial.oracle.currency !== spec.currency || trial.oracle.scope !== spec.scope || trial.oracle.candidateSetHash !== spec.candidateSetHash ||
        ("probabilityDenominator" in trial.oracle ? "exact_expected" : trial.oracle.method === "single_seed_realized" ? "single_seed_realized" : "sample_mean_estimate") !== spec.regretBasis ||
        (Date.parse(trial.oracle.horizon.end) - Date.parse(trial.oracle.horizon.start)) / 86400000 !== spec.horizonDays) {
      throw new RangeError("trial evidence does not match its registered world, qualification and economic scope");
    }
    const regret = "probabilityDenominator" in trial.oracle ? exactDecisionRegret(trial.oracle, trial.selectedActionId) : decisionRegret(trial.oracle, trial.selectedActionId);
    const rule = curriculum.rules.find(r => r.level === spec.level)!;
    return { caseId: spec.caseId, holdoutId: curriculum.holdoutId, level: spec.level,
      passed: regret.regretMinor <= rule.maximumMeanRegretMinor, regretMinor: regret.regretMinor, safetyViolations: trial.safetyViolations };
  });
  // Missing registered cases block the level instead of shrinking its denominator.
  const rules = curriculum.rules.map(rule => ({ ...rule, minimumCases: Math.max(rule.minimumCases, curriculum.cases.filter(c => c.level === rule.level).length) }));
  return { access: "evaluator_only" as const, curriculumHash, split: curriculum.split,
    sealedHoldoutClaim: curriculum.split === "sealed_holdout" ? "requires_external_split_custody" as const : "not_a_sealed_holdout" as const,
    ...assessGraduation({ policyVersion: curriculum.version, holdoutId: curriculum.holdoutId, rules, results }),
    missingCases: curriculum.cases.filter(c => !trials.some(t => t.caseId === c.caseId)).map(c => c.caseId),
    evidenceHash: sha256({ curriculumHash, trials }), results };
}
