import { z } from "zod";
import { sha256, canonicalJson } from "./replay-manifest.js";
import { PHASE1_REQUIREMENTS, assessPhase1Acceptance, type Phase1Evidence } from "./phase1-acceptance.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/), revision = z.string().regex(/^[a-f0-9]{40}$/);
const kind = z.enum(["simulator_invariant", "analytic_control", "distribution", "measurement_case", "canonical_decision_scenario", "qualified_difficulty_world"]);
export const validationCaseSchema = z.object({
  caseId: z.string().min(1), implementationVersion: z.string().min(1), kind,
  requirements: z.array(z.enum(PHASE1_REQUIREMENTS)).min(1),
  coverage: z.record(z.enum(PHASE1_REQUIREMENTS), z.array(z.string().min(1))).default({}),
  /** A new seed or parameter variant does not create an independent mechanism. */
  scenarioFamily: z.string().min(1).optional(), difficultyLevel: z.number().int().min(1).max(7).optional(),
}).strict();
export type ValidationCaseSpec = z.input<typeof validationCaseSchema>;
const planSchema = z.object({ version: z.literal("simulator-validation-plan/1.0.0"), suiteId: z.string().min(1),
  cases: z.array(validationCaseSchema).min(1) }).strict();
export type ValidationPlan = z.input<typeof planSchema>;
const caseResultSchema = z.object({ caseId: z.string().min(1), status: z.enum(["PASS", "FAIL", "ERROR", "NOT_RUN"]),
  measurements: z.record(z.unknown()), errorCode: z.string().optional() }).strict();
const artifactSchema = z.object({ payload: z.object({
  version: z.literal("simulator-validation-evidence/1.0.0"), access: z.literal("evaluator_only"),
  codeRevision: revision, runId: z.string().min(1), planHash: hash,
  runtime: z.object({ node: z.string(), platform: z.string(), architecture: z.string() }).strict(),
  results: z.array(caseResultSchema),
}).strict(), sha256: hash }).strict();
export type ValidationArtifact = z.infer<typeof artifactSchema>;
export interface ExecutableValidationCase {
  readonly spec: ValidationCaseSpec;
  readonly run: () => { passed: boolean; measurements: Record<string, unknown> } | Promise<{ passed: boolean; measurements: Record<string, unknown> }>;
}
export function validatePlan(raw: unknown) {
  const plan = planSchema.parse(raw);
  if (new Set(plan.cases.map(c => c.caseId)).size !== plan.cases.length) throw new RangeError("duplicate registered case");
  for (const c of plan.cases) {
    if (new Set(c.requirements).size !== c.requirements.length || Object.keys(c.coverage).some(r => !c.requirements.includes(r as typeof PHASE1_REQUIREMENTS[number]))) {
      throw new RangeError("coverage must refer to a unique registered requirement");
    }
    if (c.requirements.includes("adversarial_scenarios") && (c.kind !== "canonical_decision_scenario" || !c.scenarioFamily)) {
      throw new RangeError("only qualified canonical decision mechanisms can count as adversarial scenarios");
    }
    if (c.requirements.includes("difficulty_levels") && (c.kind !== "qualified_difficulty_world" || c.difficultyLevel === undefined)) {
      throw new RangeError("difficulty coverage requires executed world qualification, not level names");
    }
  }
  return plan;
}
/** Execute every preregistered check; errors remain in the denominator. No skipped-case pass. */
export async function executeValidationPlan(input: {
  readonly codeRevision: string; readonly runId: string; readonly plan: ValidationPlan;
  readonly executors: readonly ExecutableValidationCase[];
}): Promise<ValidationArtifact> {
  const plan = validatePlan(input.plan), codeRevision = revision.parse(input.codeRevision), runId = input.runId;
  const executors = new Map(input.executors.map(c => [c.spec.caseId, c]));
  if (!runId.trim() || executors.size !== input.executors.length || input.executors.some(c => !plan.cases.some(s => s.caseId === c.spec.caseId))) {
    throw new RangeError("invalid run ID or unregistered executors");
  }
  const results: z.infer<typeof caseResultSchema>[] = [];
  for (const spec of plan.cases) {
    const executor = executors.get(spec.caseId);
    if (!executor) { results.push({ caseId: spec.caseId, status: "NOT_RUN", measurements: {} }); continue; }
    if (sha256(validationCaseSchema.parse(executor.spec)) !== sha256(spec)) throw new RangeError("executor differs from the preregistered case");
    try {
      const output = await executor.run();
      if (typeof output.passed !== "boolean") throw new RangeError("check did not return a boolean result");
      canonicalJson(output.measurements);
      results.push(caseResultSchema.parse({ caseId: spec.caseId, status: output.passed ? "PASS" : "FAIL", measurements: structuredClone(output.measurements) }));
    } catch {
      results.push({ caseId: spec.caseId, status: "ERROR", measurements: {}, errorCode: "VALIDATION_EXECUTION_FAILED" });
    }
  }
  const payload: ValidationArtifact["payload"] = { version: "simulator-validation-evidence/1.0.0", access: "evaluator_only",
    codeRevision, runId, planHash: sha256(plan), runtime: { node: process.version, platform: process.platform, architecture: process.arch }, results };
  return artifactSchema.parse({ payload, sha256: sha256(payload) });
}
export function verifyValidationArtifact(raw: unknown, rawPlan: unknown, codeRevision: string): ValidationArtifact {
  const artifact = artifactSchema.parse(raw), plan = validatePlan(rawPlan);
  if (artifact.sha256 !== sha256(artifact.payload) || artifact.payload.codeRevision !== revision.parse(codeRevision) || artifact.payload.planHash !== sha256(plan)) {
    throw new RangeError("validation artifact integrity, revision or plan mismatch");
  }
  const ids = artifact.payload.results.map(r => r.caseId);
  if (new Set(ids).size !== ids.length || canonicalJson([...ids].sort()) !== canonicalJson(plan.cases.map(c => c.caseId).sort())) {
    throw new RangeError("validation artifact must account for every registered case exactly once");
  }
  return artifact;
}

function hasHash(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function canonicalAdversarialQualification(
  measurements: Readonly<Record<string, unknown>>,
): boolean {
  return (
    measurements["completeActionSet"] === true &&
    measurements["completeOutcomeSupport"] === true &&
    measurements["operatorLeakFree"] === true &&
    measurements["oracleReplayVerified"] === true &&
    measurements["threeLevelBoundaryVerified"] === true &&
    measurements["causalCounterfactualVerified"] === true &&
    hasHash(measurements["worldHash"]) &&
    hasHash(measurements["candidateSetHash"]) &&
    hasHash(measurements["oracleHash"])
  );
}

/**
 * Acceptance consumes actual artifact bytes and the registered plan, never a
 * caller's pass flags or an unchecked hash. CI provenance/authorship is still a
 * trust boundary; these digests are not signatures or proof of test adequacy.
 */
export function assessArtifactBackedAcceptance(codeRevision: string, sources: readonly { readonly plan: ValidationPlan; readonly artifact: unknown }[]) {
  const evidence: Phase1Evidence[] = [];
  const seen = new Set<string>();
  const verified = sources.map(source => {
    const plan = validatePlan(source.plan), artifact = verifyValidationArtifact(source.artifact, plan, codeRevision);
    for (const c of plan.cases) { if (seen.has(c.caseId)) throw new RangeError("case reused across evidence artifacts"); seen.add(c.caseId); }
    return { plan, artifact };
  });
  for (const requirement of PHASE1_REQUIREMENTS) {
    const cases = verified.flatMap(({ plan, artifact }) => plan.cases.filter(c => c.requirements.includes(requirement)).map(spec => {
      const result = artifact.payload.results.find(r => r.caseId === spec.caseId)!;
      const passed =
        result.status === "PASS" &&
        (requirement !== "adversarial_scenarios" ||
          canonicalAdversarialQualification(result.measurements));
      return { caseId: spec.caseId, passed, coverageValues:
        requirement === "adversarial_scenarios" ? [spec.scenarioFamily!] : requirement === "difficulty_levels" ? [String(spec.difficultyLevel)] : spec.coverage[requirement] ?? [] };
    }));
    if (cases.length > 0) evidence.push({ requirement, codeRevision, runId: verified.map(s => s.artifact.payload.runId).join("+"),
      artifactSha256: sha256(verified.map(s => s.artifact.sha256)), cases });
  }
  const result = assessPhase1Acceptance(codeRevision, evidence);
  return { ...result, evidenceMode: "verified_artifact_contents" as const,
    scope: "all_registered_cases_at_this_revision_not_a_universal_correctness_proof" as const,
    artifacts: verified.map(s => ({ runId: s.artifact.payload.runId, sha256: s.artifact.sha256 })),
    notRunCases: verified.flatMap(s => s.artifact.payload.results.filter(r => r.status === "NOT_RUN").map(r => r.caseId)) };
}
