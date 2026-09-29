import { buildPhase1ValidationSuite } from "./phase1-validation-suite.js";
import { buildDomainValidationCases } from "./domain-validation-suite.js";
import { executeValidationPlan, assessArtifactBackedAcceptance, type ValidationPlan } from "./validation-evidence.js";

export const INTEGRATED_VALIDATION_VERSION = "phase1-integrated-kernel-validation/1.0.0" as const;
/** Retains the entire earlier matrix; adds mechanism checks without filtering failures. */
export function buildIntegratedPhase1ValidationSuite() {
  const core = buildPhase1ValidationSuite();
  const cases = [...core.cases, ...buildDomainValidationCases()];
  const plan: ValidationPlan = { version: "simulator-validation-plan/1.0.0", suiteId: INTEGRATED_VALIDATION_VERSION,
    cases: cases.map(c => c.spec) };
  return { plan, cases };
}
export async function runIntegratedPhase1Validation(codeRevision: string, runId: string) {
  const suite = buildIntegratedPhase1ValidationSuite();
  const artifact = await executeValidationPlan({ codeRevision, runId, plan: suite.plan, executors: suite.cases });
  return { plan: suite.plan, artifact, acceptance: assessArtifactBackedAcceptance(codeRevision, [{ plan: suite.plan, artifact }]) };
}
