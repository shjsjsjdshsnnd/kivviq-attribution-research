import { z } from "zod";

export const PHASE1_REQUIREMENTS = [
  "reproducibility", "accounting_reconciliation", "causal_truth_retained",
  "zero_future_leakage", "zero_impossible_inventory", "merchant_archetypes",
  "core_channels", "customer_segments", "product_economics", "diminishing_returns",
  "cross_channel_interactions", "price_elasticity", "retention_clv", "inventory_effects",
  "external_shocks", "measurement_corruption", "counterfactual_interventions",
  "decision_oracle", "adversarial_scenarios", "difficulty_levels", "automated_validation",
] as const;
export type Phase1Requirement = typeof PHASE1_REQUIREMENTS[number];
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const evidenceSchema = z.object({
  requirement: z.enum(PHASE1_REQUIREMENTS),
  codeRevision: revisionSchema,
  runId: z.string().min(1),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Executed test identifiers and outcomes, not a hand-written capability flag. */
  cases: z.array(z.object({
    caseId: z.string().min(1), passed: z.boolean(),
    /** For coverage gates only: the actual executed archetype/channel/scenario/etc. */
    coverageValues: z.array(z.string().min(1)).default([]),
  }).strict()),
}).strict();
export type Phase1Evidence = z.input<typeof evidenceSchema>;
const coverageTargets: Partial<Record<Phase1Requirement, number>> = {
  merchant_archetypes: 10, core_channels: 7, customer_segments: 6,
  adversarial_scenarios: 20, difficulty_levels: 7,
};
export type GateStatus = "PASS" | "FAIL" | "NOT_MEASURED";
export interface AcceptanceRow {
  readonly requirement: Phase1Requirement;
  readonly status: GateStatus;
  readonly checkedCases: number;
  readonly passedCases: number;
  readonly distinctCoverage: number;
  readonly requiredCoverage: number | null;
  readonly evidenceRunId: string | null;
  readonly artifactSha256: string | null;
}

/** This validates evidence structure/results. Artifact authenticity is the CI collector's responsibility. */
export function assessPhase1Acceptance(codeRevision: string, evidence: readonly Phase1Evidence[]): {
  readonly schemaVersion: "phase1-acceptance/1.0.0";
  readonly codeRevision: string;
  readonly overall: "PASS" | "FAIL" | "INCOMPLETE";
  readonly requirements: readonly AcceptanceRow[];
} {
  revisionSchema.parse(codeRevision);
  const byRequirement = new Map<Phase1Requirement, z.infer<typeof evidenceSchema>>();
  for (const value of evidence) {
    const item = evidenceSchema.parse(value);
    if (item.codeRevision !== codeRevision) throw new RangeError("stale or mixed-revision acceptance evidence");
    if (byRequirement.has(item.requirement)) throw new RangeError("duplicate acceptance evidence for requirement");
    if (new Set(item.cases.map(c => c.caseId)).size !== item.cases.length) throw new RangeError("duplicate test case evidence");
    byRequirement.set(item.requirement, item);
  }
  const requirements = PHASE1_REQUIREMENTS.map((requirement): AcceptanceRow => {
    const proof = byRequirement.get(requirement);
    const checkedCases = proof?.cases.length ?? 0;
    const passedCases = proof?.cases.filter(c => c.passed).length ?? 0;
    const distinctCoverage = new Set(proof?.cases.filter(c => c.passed).flatMap(c => c.coverageValues) ?? []).size;
    const requiredCoverage = coverageTargets[requirement] ?? null;
    const status: GateStatus = checkedCases === 0 ? "NOT_MEASURED"
      : passedCases !== checkedCases || (requiredCoverage !== null && distinctCoverage < requiredCoverage) ? "FAIL" : "PASS";
    return { requirement, status, checkedCases, passedCases, distinctCoverage, requiredCoverage,
      evidenceRunId: proof?.runId ?? null, artifactSha256: proof?.artifactSha256 ?? null };
  });
  return { schemaVersion: "phase1-acceptance/1.0.0", codeRevision,
    overall: requirements.some(r => r.status === "FAIL") ? "FAIL"
      : requirements.every(r => r.status === "PASS") ? "PASS" : "INCOMPLETE",
    requirements };
}

export const DIFFICULTY_LEVELS = [
  { level: 1, name: "deterministic" },
  { level: 2, name: "stochastic" },
  { level: 3, name: "confounded" },
  { level: 4, name: "corrupted" },
  { level: 5, name: "dynamic" },
  { level: 6, name: "adversarial" },
  { level: 7, name: "realistic_chaos" },
] as const;
const level = z.number().int().min(1).max(7);
const ruleSchema = z.object({ level, minimumCases: z.number().int().positive(),
  minimumPassRate: z.number().finite().min(0).max(1), maximumMeanRegretMinor: z.number().finite().nonnegative() }).strict();
const resultSchema = z.object({
  caseId: z.string().min(1), level, holdoutId: z.string().min(1),
  passed: z.boolean(), regretMinor: z.number().finite().nonnegative(),
  safetyViolations: z.number().int().nonnegative(),
}).strict();
export type GraduationRule = z.infer<typeof ruleSchema>;
export type DifficultyCaseResult = z.infer<typeof resultSchema>;

/** Rules and holdout identity must be preregistered; this function never tunes them from outcomes. */
export function assessGraduation(input: {
  readonly policyVersion: string;
  readonly holdoutId: string;
  readonly rules: readonly GraduationRule[];
  readonly results: readonly DifficultyCaseResult[];
}) {
  if (!input.policyVersion.trim() || !input.holdoutId.trim()) throw new RangeError("graduation requires a frozen policy and holdout ID");
  const rules = input.rules.map(r => ruleSchema.parse(r));
  if (rules.length !== 7 || new Set(rules.map(r => r.level)).size !== 7) throw new RangeError("one graduation rule per level is required");
  const results = input.results.map(r => resultSchema.parse(r));
  if (new Set(results.map(r => r.caseId)).size !== results.length) throw new RangeError("repeated holdout case");
  if (results.some(r => r.holdoutId !== input.holdoutId)) throw new RangeError("mixed holdout results");
  let highestGraduatedLevel = 0;
  const levels = DIFFICULTY_LEVELS.map(definition => {
    const rule = rules.find(r => r.level === definition.level)!;
    const cases = results.filter(r => r.level === definition.level);
    const passRate = cases.length === 0 ? null : cases.filter(c => c.passed).length / cases.length;
    const meanRegretMinor = cases.length === 0 ? null : cases.reduce((n, c) => n + c.regretMinor, 0) / cases.length;
    const safe = cases.every(c => c.safetyViolations === 0);
    const measured = cases.length >= rule.minimumCases;
    const meetsThresholds = measured && safe && passRate !== null && meanRegretMinor !== null &&
      passRate >= rule.minimumPassRate && meanRegretMinor <= rule.maximumMeanRegretMinor;
    const prerequisitesMet = highestGraduatedLevel === definition.level - 1;
    const graduated = prerequisitesMet && meetsThresholds;
    if (graduated) highestGraduatedLevel = definition.level;
    return { ...definition, checkedCases: cases.length, passRate, meanRegretMinor,
      status: graduated ? "GRADUATED" as const
        : !prerequisitesMet ? "BLOCKED_BY_PREVIOUS_LEVEL" as const
        : !measured ? "NOT_MEASURED" as const : "FAILED" as const };
  });
  return { policyVersion: input.policyVersion, holdoutId: input.holdoutId, highestGraduatedLevel, levels };
}
