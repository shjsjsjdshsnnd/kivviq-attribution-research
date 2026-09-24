import {
  deepFreezeEvaluation,
  evaluationFingerprint,
} from "../evaluation/baseline-contract.js";
import {
  BASELINE_VALIDATION_CONTRACT_SCHEMA_VERSION,
  BASELINE_VALIDATION_FROZEN_PARENT_COMMIT,
  BASELINE_VALIDATION_SUITE_VERSION,
} from "./version.js";

export class BaselineValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BaselineValidationError";
  }
}

export const BASELINE_VALIDATION_REQUIRED_CHECKS = deepFreezeEvaluation([
  "determinism",
  "seed_reproducibility",
  "hidden_truth_isolation",
  "future_information_isolation",
  "temporal_boundary_conformance",
  "lookback_window_conformance",
  "action_ontology_conformance",
  "constraint_conformance",
  "policy_semantics",
  "permitted_information_sensitivity",
  "prohibited_information_invariance",
  "tie_breaking",
  "missing_data_behavior",
  "zero_action_behavior",
  "multi_action_behavior",
  "artifact_replay",
  "provenance_integrity",
  "uncontrolled_randomness_detection",
  "operator_isolation",
] as const);

export type BaselineValidationCheckId =
  (typeof BASELINE_VALIDATION_REQUIRED_CHECKS)[number];

export type BaselineValidationStatus = "PASS" | "FAIL";

export interface BaselineValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface BaselineValidationCheckResult {
  readonly checkId: BaselineValidationCheckId;
  readonly status: BaselineValidationStatus;
  readonly evidenceFingerprints: readonly string[];
  readonly issues: readonly BaselineValidationIssue[];
}

export interface BaselineValidationContractBody {
  readonly kind: "baseline_validation_contract";
  readonly schemaVersion: typeof BASELINE_VALIDATION_CONTRACT_SCHEMA_VERSION;
  readonly validationSuiteVersion: typeof BASELINE_VALIDATION_SUITE_VERSION;
  readonly frozenParentCommit: typeof BASELINE_VALIDATION_FROZEN_PARENT_COMMIT;
  readonly requiredChecks: readonly BaselineValidationCheckId[];
  readonly resultStatuses: readonly BaselineValidationStatus[];
  readonly missingEvidenceDisposition: "FAIL";
  readonly checkOrdering: "contract_order";
}

export interface BaselineValidationContract extends BaselineValidationContractBody {
  readonly contractFingerprint: string;
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new BaselineValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CONTRACT_BODY: BaselineValidationContractBody = {
  kind: "baseline_validation_contract",
  schemaVersion: BASELINE_VALIDATION_CONTRACT_SCHEMA_VERSION,
  validationSuiteVersion: BASELINE_VALIDATION_SUITE_VERSION,
  frozenParentCommit: BASELINE_VALIDATION_FROZEN_PARENT_COMMIT,
  requiredChecks: BASELINE_VALIDATION_REQUIRED_CHECKS,
  resultStatuses: ["PASS", "FAIL"],
  missingEvidenceDisposition: "FAIL",
  checkOrdering: "contract_order",
};

export function baselineValidationContractFingerprint(
  contract: BaselineValidationContractBody | BaselineValidationContract,
): string {
  const { contractFingerprint: _omitted, ...body } = contract as
    BaselineValidationContract & Record<string, unknown>;
  return evaluationFingerprint(body);
}

export const BASELINE_VALIDATION_CONTRACT: BaselineValidationContract =
  deepFreezeEvaluation({
    ...CONTRACT_BODY,
    contractFingerprint: evaluationFingerprint(CONTRACT_BODY),
  });

export function validateBaselineValidationContract(
  value: unknown,
): BaselineValidationContract {
  requireCondition(isRecord(value), "validation contract must be an object");
  requireCondition(
    value["kind"] === CONTRACT_BODY.kind,
    "validation contract kind mismatch",
  );
  requireCondition(
    value["schemaVersion"] === BASELINE_VALIDATION_CONTRACT_SCHEMA_VERSION,
    "validation contract schema version mismatch",
  );
  requireCondition(
    value["validationSuiteVersion"] === BASELINE_VALIDATION_SUITE_VERSION,
    "validation suite version mismatch",
  );
  requireCondition(
    value["frozenParentCommit"] === BASELINE_VALIDATION_FROZEN_PARENT_COMMIT,
    "validation contract parent commit mismatch",
  );
  requireCondition(
    JSON.stringify(value["requiredChecks"]) ===
      JSON.stringify(BASELINE_VALIDATION_REQUIRED_CHECKS),
    "validation contract required checks mismatch",
  );
  requireCondition(
    JSON.stringify(value["resultStatuses"]) === JSON.stringify(["PASS", "FAIL"]),
    "validation contract statuses mismatch",
  );
  requireCondition(
    value["missingEvidenceDisposition"] === "FAIL" &&
      value["checkOrdering"] === "contract_order",
    "validation contract semantics mismatch",
  );
  requireCondition(
    typeof value["contractFingerprint"] === "string" &&
      value["contractFingerprint"] ===
        baselineValidationContractFingerprint(value as unknown as BaselineValidationContract),
    "validation contract fingerprint mismatch",
  );
  return value as unknown as BaselineValidationContract;
}

export const BASELINE_VALIDATION_FINGERPRINT_PATTERN =
  /^fnv1a64:[0-9a-f]{16}$/;

export function assertBaselineValidationFingerprint(
  value: unknown,
  label = "fingerprint",
): asserts value is string {
  requireCondition(
    typeof value === "string" &&
      BASELINE_VALIDATION_FINGERPRINT_PATTERN.test(value),
    `${label} must match fnv1a64:<16 lowercase hexadecimal digits>`,
  );
}
