import { evaluationFingerprint } from "../evaluation/baseline-contract.js";
import { ensureCanonicalOperatorV2, type CanonicalOperatorV2 } from "../operator/canonical-interface.js";
import type { CanonicalOperator } from "../operator/types.js";
import { validateDecisionActionConformance, type DecisionActionConformanceEvidence } from "./action-conformance.js";
import { runExecutableConformanceProbe, runProhibitedInformationProbe, failedValidationCheck, type ExecutableConformanceProbe, type ProhibitedInformationProbe } from "./conformance.js";
import { validateConstraintDispositionEvidence, validateOperatorAuthorityBoundary, type ConstraintDispositionEvidence, type OperatorAuthorityBoundaryEvidence } from "./constraint-conformance.js";
import { BASELINE_VALIDATION_REQUIRED_CHECKS, BaselineValidationError, type BaselineValidationCheckId, type BaselineValidationCheckResult } from "./contract.js";
import { detectUncontrolledRandomness, validateDeterministicDecisions, validateSeedReproducibility, type DeterministicDecisionSample, type SeedReproducibilitySample } from "./determinism.js";
import { validateFutureInformationIsolation, validateHiddenTruthIsolation, type InformationIsolationPair } from "./leakage.js";
import { validateProvenanceEvidence, type RecordedFingerprintEvidence } from "./provenance.js";
import { replayRecordedDecision, type RecordedDecisionArtifact } from "./replay.js";
import { createBaselineConformanceReport, type BaselineConformanceReport, type BaselineValidationOperatorIdentity } from "./report.js";
import { compareCodeUnits, hasExactKeys, isFingerprint, isNonEmptyString, isRecord } from "./shared.js";
import { validateLookbackWindow, validateTemporalObservationBoundary, type LookbackWindowInput, type TemporalObservationBoundaryInput } from "./temporal-boundaries.js";

export interface BaselineValidationCaseEvidence {
  readonly determinism: readonly DeterministicDecisionSample[];
  readonly seedReproducibility: readonly SeedReproducibilitySample[];
  readonly hiddenTruthIsolation: readonly InformationIsolationPair[];
  readonly futureInformationIsolation: readonly InformationIsolationPair[];
  readonly temporalBoundary: TemporalObservationBoundaryInput;
  readonly lookbackWindow: LookbackWindowInput;
  readonly actionConformance: DecisionActionConformanceEvidence;
  readonly constraintConformance: ConstraintDispositionEvidence;
  readonly policySemantics: ExecutableConformanceProbe;
  readonly permittedInformationSensitivity: ExecutableConformanceProbe;
  readonly prohibitedInformationInvariance: ProhibitedInformationProbe;
  readonly tieBreaking: ExecutableConformanceProbe;
  readonly missingDataBehavior: ExecutableConformanceProbe;
  readonly zeroActionBehavior: ExecutableConformanceProbe;
  readonly multiActionBehavior: ExecutableConformanceProbe;
  readonly artifactReplay: RecordedDecisionArtifact;
  readonly provenanceIntegrity: readonly RecordedFingerprintEvidence[];
  readonly uncontrolledRandomness: readonly DeterministicDecisionSample[];
  readonly operatorIsolation: OperatorAuthorityBoundaryEvidence;
}

export interface BaselineValidationCase {
  readonly caseId: string;
  readonly operator: CanonicalOperator | CanonicalOperatorV2;
  readonly evidence: BaselineValidationCaseEvidence;
}

export interface BaselineValidationSuiteInput { readonly cases: readonly BaselineValidationCase[]; }

const EVIDENCE_TO_CHECK = {
  determinism: "determinism",
  seedReproducibility: "seed_reproducibility",
  hiddenTruthIsolation: "hidden_truth_isolation",
  futureInformationIsolation: "future_information_isolation",
  temporalBoundary: "temporal_boundary_conformance",
  lookbackWindow: "lookback_window_conformance",
  actionConformance: "action_ontology_conformance",
  constraintConformance: "constraint_conformance",
  policySemantics: "policy_semantics",
  permittedInformationSensitivity: "permitted_information_sensitivity",
  prohibitedInformationInvariance: "prohibited_information_invariance",
  tieBreaking: "tie_breaking",
  missingDataBehavior: "missing_data_behavior",
  zeroActionBehavior: "zero_action_behavior",
  multiActionBehavior: "multi_action_behavior",
  artifactReplay: "artifact_replay",
  provenanceIntegrity: "provenance_integrity",
  uncontrolledRandomness: "uncontrolled_randomness_detection",
  operatorIsolation: "operator_isolation",
} as const satisfies Record<keyof BaselineValidationCaseEvidence, BaselineValidationCheckId>;

function fallbackIdentity(value: unknown): BaselineValidationOperatorIdentity {
  const metadata = isRecord(value) && isRecord(value["metadata"]) ? value["metadata"] : {};
  return {
    operatorId: isNonEmptyString(metadata["operatorId"]) ? metadata["operatorId"] : "invalid.operator",
    operatorVersion: isNonEmptyString(metadata["operatorVersion"]) ? metadata["operatorVersion"] : "0.0.0",
    implementationFingerprint: isFingerprint(metadata["implementationFingerprint"]) ? metadata["implementationFingerprint"] : evaluationFingerprint({ invalid: "implementation" }),
    configurationFingerprint: isFingerprint(metadata["configurationFingerprint"]) ? metadata["configurationFingerprint"] : evaluationFingerprint({ invalid: "configuration" }),
  };
}

function safeRun(checkId: BaselineValidationCheckId, fn: () => BaselineValidationCheckResult): BaselineValidationCheckResult {
  try {
    const value = fn();
    return value.checkId === checkId ? value : failedValidationCheck(checkId, "VALIDATOR_RESULT_MISMATCH", "focused validator returned the wrong check ID");
  } catch (error) {
    return failedValidationCheck(checkId, "VALIDATOR_EXECUTION_FAILED", "focused validator execution failed");
  }
}

export function runBaselineValidationCase(value: BaselineValidationCase): BaselineConformanceReport {
  const raw: Record<string, unknown> = isRecord(value) ? value : {};
  const caseShapeValid = hasExactKeys(raw, ["caseId", "operator", "evidence"]);
  const caseId = isNonEmptyString(raw["caseId"]) ? raw["caseId"] : "invalid-case";
  let canonical: CanonicalOperatorV2 | undefined;
  let identity = fallbackIdentity(raw["operator"]);
  try {
    canonical = ensureCanonicalOperatorV2(raw["operator"] as CanonicalOperator | CanonicalOperatorV2);
    identity = {
      operatorId: canonical.metadata.operatorId,
      operatorVersion: canonical.metadata.operatorVersion,
      implementationFingerprint: canonical.metadata.implementationFingerprint,
      configurationFingerprint: canonical.metadata.configurationFingerprint,
    };
  } catch { /* fail each check below */ }
  const evidence: Record<string, unknown> = isRecord(raw["evidence"]) ? raw["evidence"] : {};
  const evidenceHasUnknownKeys = Reflect.ownKeys(evidence).some(
    (key) => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(EVIDENCE_TO_CHECK, key),
  );
  const missing = (key: keyof BaselineValidationCaseEvidence, fn: () => BaselineValidationCheckResult): BaselineValidationCheckResult =>
    Object.prototype.hasOwnProperty.call(evidence, key)
      ? safeRun(EVIDENCE_TO_CHECK[key], fn)
      : failedValidationCheck(EVIDENCE_TO_CHECK[key], "MISSING_REQUIRED_EVIDENCE", `required evidence section ${key} is absent`);
  const operatorRequired = (key: keyof BaselineValidationCaseEvidence, fn: (operator: CanonicalOperatorV2) => BaselineValidationCheckResult) =>
    canonical === undefined ? failedValidationCheck(EVIDENCE_TO_CHECK[key], "INVALID_OPERATOR", "operator could not be canonicalized") : missing(key, () => fn(canonical!));

  const checks: BaselineValidationCheckResult[] = [
    !caseShapeValid || evidenceHasUnknownKeys
      ? failedValidationCheck("determinism", "INVALID_CASE_EVIDENCE_SHAPE", "validation case and evidence must have their exact declared keys")
      : missing("determinism", () => validateDeterministicDecisions(evidence["determinism"] as never)),
    missing("seedReproducibility", () => validateSeedReproducibility(evidence["seedReproducibility"] as never)),
    missing("hiddenTruthIsolation", () => validateHiddenTruthIsolation(evidence["hiddenTruthIsolation"] as never)),
    missing("futureInformationIsolation", () => validateFutureInformationIsolation(evidence["futureInformationIsolation"] as never)),
    missing("temporalBoundary", () => validateTemporalObservationBoundary(evidence["temporalBoundary"] as never)),
    missing("lookbackWindow", () => validateLookbackWindow(evidence["lookbackWindow"] as never)),
    missing("actionConformance", () => validateDecisionActionConformance(evidence["actionConformance"])),
    missing("constraintConformance", () => validateConstraintDispositionEvidence(evidence["constraintConformance"])),
    operatorRequired("policySemantics", (operator) => runExecutableConformanceProbe(operator, evidence["policySemantics"], "policy_semantics", caseId)),
    operatorRequired("permittedInformationSensitivity", (operator) => runExecutableConformanceProbe(operator, evidence["permittedInformationSensitivity"], "permitted_information_sensitivity", caseId)),
    operatorRequired("prohibitedInformationInvariance", (operator) => runProhibitedInformationProbe(operator, evidence["prohibitedInformationInvariance"], caseId)),
    operatorRequired("tieBreaking", (operator) => runExecutableConformanceProbe(operator, evidence["tieBreaking"], "tie_breaking", caseId)),
    operatorRequired("missingDataBehavior", (operator) => runExecutableConformanceProbe(operator, evidence["missingDataBehavior"], "missing_data_behavior", caseId)),
    operatorRequired("zeroActionBehavior", (operator) => runExecutableConformanceProbe(operator, evidence["zeroActionBehavior"], "zero_action_behavior", caseId)),
    operatorRequired("multiActionBehavior", (operator) => runExecutableConformanceProbe(operator, evidence["multiActionBehavior"], "multi_action_behavior", caseId)),
    operatorRequired("artifactReplay", (operator) => replayRecordedDecision(operator, evidence["artifactReplay"])),
    missing("provenanceIntegrity", () => validateProvenanceEvidence(evidence["provenanceIntegrity"] as never)),
    missing("uncontrolledRandomness", () => detectUncontrolledRandomness(evidence["uncontrolledRandomness"] as never)),
    missing("operatorIsolation", () => validateOperatorAuthorityBoundary(evidence["operatorIsolation"])),
  ];
  return createBaselineConformanceReport({ operator: identity, checks });
}

export function runBaselineValidationSuite(value: BaselineValidationSuiteInput): readonly BaselineConformanceReport[] {
  if (!isRecord(value) || Reflect.ownKeys(value).length !== 1 || !Array.isArray(value["cases"])) throw new BaselineValidationError("validation suite container must have the exact cases array");
  const cases = value["cases"] as readonly BaselineValidationCase[];
  const ids = cases.map((entry) => fallbackIdentity(isRecord(entry) ? entry["operator"] : undefined).operatorId);
  if (new Set(ids).size !== ids.length) throw new BaselineValidationError("duplicate operator ID in validation suite");
  const caseIds = cases.map((entry) => isRecord(entry) && isNonEmptyString(entry["caseId"]) ? entry["caseId"] : "invalid-case");
  if (new Set(caseIds).size !== caseIds.length) throw new BaselineValidationError("duplicate case ID in validation suite");
  return Object.freeze(cases.map(runBaselineValidationCase).sort((left, right) => compareCodeUnits(left.operator.operatorId, right.operator.operatorId)));
}

export { BASELINE_VALIDATION_REQUIRED_CHECKS };
