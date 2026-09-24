import { actionFingerprint } from "../action_ontology/semantics.js";
import {
  assertDecisionOpportunityAllowed,
  assertValidBaselineEvaluationContract,
  buildActionAvailabilitySnapshot,
  createEvaluationActionAttemptRecord,
  evaluationFingerprint,
  stableEvaluationJson,
  type ActionAvailabilitySnapshot,
  type BaselineEvaluationContract,
  type ConstraintIssue,
  type DecisionOpportunity,
  type EvaluationActionAttemptRecord,
} from "../evaluation/baseline-contract.js";
import type { CanonicalOperatorInputV2 } from "../operator/canonical-interface.js";
import type { BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import {
  compareCodeUnits,
  hasExactKeys,
  isFingerprint,
  isRecord,
  isStrictJson,
  issue,
  result,
  safeFingerprint,
} from "./shared.js";

export interface ConstraintDispositionAttemptEvidence {
  readonly rawProposal: unknown;
  readonly constraintIssues: readonly ConstraintIssue[];
  readonly explicitModifiedAction: unknown | null;
  readonly attemptRecord: EvaluationActionAttemptRecord;
}

export interface ConstraintDispositionEvidence {
  readonly contract: BaselineEvaluationContract;
  readonly opportunity: DecisionOpportunity;
  readonly availability: ActionAvailabilitySnapshot;
  readonly attempts: readonly ConstraintDispositionAttemptEvidence[];
}

export interface OperatorAuthorityBoundaryEvidence {
  readonly canonicalInputBefore: CanonicalOperatorInputV2;
  readonly canonicalInputAfter: CanonicalOperatorInputV2;
  readonly inputFingerprintBefore: string;
  readonly inputFingerprintAfter: string;
  readonly observationFingerprintBefore: string;
  readonly observationFingerprintAfter: string;
  readonly legalActionSpaceFingerprintBefore: string;
  readonly legalActionSpaceFingerprintAfter: string;
  readonly constraintsFingerprintBefore: string;
  readonly constraintsFingerprintAfter: string;
  readonly dispositionEvidence: ConstraintDispositionEvidence;
  readonly dispositionEvidenceFingerprint: string;
  readonly dispositionCreatedByEvaluator: boolean;
  readonly operatorExecutedActions: boolean;
  readonly operatorMutatedSimulatorState: boolean;
}

const DISPOSITION_KEYS = ["contract", "opportunity", "availability", "attempts"] as const;
const ATTEMPT_KEYS = ["rawProposal", "constraintIssues", "explicitModifiedAction", "attemptRecord"] as const;
const AUTHORITY_KEYS = [
  "canonicalInputBefore", "canonicalInputAfter",
  "inputFingerprintBefore", "inputFingerprintAfter",
  "observationFingerprintBefore", "observationFingerprintAfter",
  "legalActionSpaceFingerprintBefore", "legalActionSpaceFingerprintAfter",
  "constraintsFingerprintBefore", "constraintsFingerprintAfter",
  "dispositionEvidence", "dispositionEvidenceFingerprint",
  "dispositionCreatedByEvaluator", "operatorExecutedActions",
  "operatorMutatedSimulatorState",
] as const;

function caughtMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attemptOrderKey(attempt: Record<string, unknown>): string | undefined {
  try {
    return actionFingerprint(attempt["rawProposal"] as never) + "|" + stableEvaluationJson(attempt["constraintIssues"]) + "|" + stableEvaluationJson(attempt["explicitModifiedAction"]);
  } catch {
    return undefined;
  }
}

export function validateConstraintDispositionEvidence(
  value: unknown,
): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isRecord(value) || !hasExactKeys(value, DISPOSITION_KEYS)) {
    return result("constraint_conformance", [
      issue("INVALID_EVIDENCE_SHAPE", "evidence", "constraint evidence must have the exact required keys"),
    ], []);
  }
  if (!isStrictJson(value)) {
    issues.push(issue("INVALID_JSON_EVIDENCE", "evidence", "constraint evidence must be strict deterministic JSON"));
  }

  let contract: BaselineEvaluationContract | undefined;
  let opportunity: DecisionOpportunity | undefined;
  let availability: ActionAvailabilitySnapshot | undefined;
  try {
    assertValidBaselineEvaluationContract(value["contract"] as BaselineEvaluationContract);
    contract = value["contract"] as BaselineEvaluationContract;
    assertDecisionOpportunityAllowed(contract, value["opportunity"] as DecisionOpportunity);
    opportunity = value["opportunity"] as DecisionOpportunity;
    if (!isRecord(value["availability"])) throw new TypeError("availability must be an object");
    const rawAvailability = value["availability"];
    availability = buildActionAvailabilitySnapshot(
      contract,
      opportunity,
      rawAvailability["rules"] as ActionAvailabilitySnapshot["rules"],
      rawAvailability["mutualExclusionGroups"] as ActionAvailabilitySnapshot["mutualExclusionGroups"],
    );
    if (stableEvaluationJson(availability) !== stableEvaluationJson(rawAvailability)) {
      throw new TypeError("availability snapshot does not match its canonical fingerprint or exact schema");
    }
  } catch (error) {
    issues.push(issue("INVALID_CONTEXT_BINDING", "evidence", caughtMessage(error)));
  }

  if (!Array.isArray(value["attempts"]) || value["attempts"].length === 0) {
    issues.push(issue("INVALID_EVIDENCE_SHAPE", "evidence.attempts", "constraint evidence requires a non-empty attempt array"));
  } else {
    const orderingKeys: string[] = [];
    value["attempts"].forEach((rawAttempt, index) => {
      const path = `evidence.attempts[${index}]`;
      if (!isRecord(rawAttempt) || !hasExactKeys(rawAttempt, ATTEMPT_KEYS)) {
        issues.push(issue("INVALID_ATTEMPT_EVIDENCE", path, "attempt evidence must have the exact required keys"));
        return;
      }
      const orderKey = attemptOrderKey(rawAttempt);
      if (orderKey !== undefined) orderingKeys.push(orderKey);
      if (contract === undefined || opportunity === undefined || availability === undefined) return;
      if (!Array.isArray(rawAttempt["constraintIssues"])) {
        issues.push(issue("INVALID_ATTEMPT_EVIDENCE", `${path}.constraintIssues`, "constraintIssues must be an array"));
        return;
      }
      const malformedIssueIndex = rawAttempt["constraintIssues"].findIndex(
        (constraintIssue) => !isRecord(constraintIssue) || !hasExactKeys(constraintIssue, ["kind", "constraintRef", "reason"]),
      );
      if (malformedIssueIndex >= 0) {
        issues.push(issue("INVALID_ATTEMPT_EVIDENCE", `${path}.constraintIssues[${malformedIssueIndex}]`, "constraint issue must have the exact required keys"));
        return;
      }
      try {
        const explicit = rawAttempt["explicitModifiedAction"] === null
          ? undefined
          : rawAttempt["explicitModifiedAction"] as never;
        const recomputed = createEvaluationActionAttemptRecord(
          contract,
          opportunity,
          availability,
          rawAttempt["rawProposal"],
          rawAttempt["constraintIssues"] as readonly ConstraintIssue[],
          explicit,
        );
        if (stableEvaluationJson(recomputed) !== stableEvaluationJson(rawAttempt["attemptRecord"])) {
          issues.push(issue("DISPOSITION_TAMPERED", `${path}.attemptRecord`, "recorded Action validation, disposition, or executed Action differs from the evaluator-created record"));
        }
      } catch (error) {
        issues.push(issue("INVALID_DISPOSITION_EVIDENCE", path, caughtMessage(error)));
      }
    });
    if (orderingKeys.length === value["attempts"].length) {
      const sorted = [...orderingKeys].sort(compareCodeUnits);
      if (stableEvaluationJson(orderingKeys) !== stableEvaluationJson(sorted)) {
        issues.push(issue("UNSTABLE_ATTEMPT_ORDER", "evidence.attempts", "attempt evidence must use stable proposal-and-constraint ordering"));
      }
    }
  }

  const fingerprint = safeFingerprint(value);
  return result("constraint_conformance", issues, fingerprint === undefined ? [] : [fingerprint]);
}

function isDeeplyFrozenJson(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (key === "length" && Array.isArray(value)) return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor && isDeeplyFrozenJson(descriptor.value);
  });
}

function frozenCanonicalInput(value: unknown): value is CanonicalOperatorInputV2 {
  return isRecord(value) && isDeeplyFrozenJson(value) &&
    isRecord(value["observation"]) && isRecord(value["legalActionSpace"]) &&
    isRecord(value["constraints"]) && isRecord(value["provenance"]);
}

export function validateOperatorAuthorityBoundary(
  value: unknown,
): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isRecord(value) || !hasExactKeys(value, AUTHORITY_KEYS)) {
    return result("operator_isolation", [
      issue("INVALID_EVIDENCE_SHAPE", "evidence", "operator authority evidence must have the exact required keys"),
    ], []);
  }
  if (!isStrictJson(value)) {
    issues.push(issue("INVALID_JSON_EVIDENCE", "evidence", "operator authority evidence must be strict deterministic JSON"));
  }

  const before = value["canonicalInputBefore"];
  const after = value["canonicalInputAfter"];
  if (!frozenCanonicalInput(before) || !frozenCanonicalInput(after)) {
    issues.push(issue("MUTABLE_OPERATOR_INPUT", "evidence.canonicalInputBefore", "canonical inputs and nested observation, Action-space, constraints, and provenance objects must remain frozen"));
  } else {
    const beforeFingerprint = evaluationFingerprint(before);
    const afterFingerprint = evaluationFingerprint(after);
    const recordedFingerprints = [
      value["inputFingerprintBefore"], value["inputFingerprintAfter"],
      value["observationFingerprintBefore"], value["observationFingerprintAfter"],
      value["legalActionSpaceFingerprintBefore"], value["legalActionSpaceFingerprintAfter"],
      value["constraintsFingerprintBefore"], value["constraintsFingerprintAfter"],
    ];
    if (!recordedFingerprints.every(isFingerprint)) {
      issues.push(issue("INVALID_BOUNDARY_FINGERPRINT", "evidence", "all authority-boundary fingerprints must be canonical fingerprints"));
    }
    if (
      value["inputFingerprintBefore"] !== beforeFingerprint ||
      value["inputFingerprintAfter"] !== afterFingerprint ||
      beforeFingerprint !== afterFingerprint ||
      stableEvaluationJson(before) !== stableEvaluationJson(after)
    ) {
      issues.push(issue("OPERATOR_INPUT_MUTATION", "evidence.canonicalInputAfter", "operator input changed across invocation"));
    }
    if (
      value["observationFingerprintBefore"] !== before.provenance.observationFingerprint ||
      value["observationFingerprintAfter"] !== after.provenance.observationFingerprint ||
      value["observationFingerprintBefore"] !== value["observationFingerprintAfter"]
    ) {
      issues.push(issue("OBSERVATION_MUTATION", "evidence.observationFingerprintAfter", "observation binding changed across invocation"));
    }
    if (
      value["legalActionSpaceFingerprintBefore"] !== before.provenance.legalActionSpaceFingerprint ||
      value["legalActionSpaceFingerprintAfter"] !== after.provenance.legalActionSpaceFingerprint ||
      value["legalActionSpaceFingerprintBefore"] !== value["legalActionSpaceFingerprintAfter"]
    ) {
      issues.push(issue("ACTION_SPACE_MUTATION", "evidence.legalActionSpaceFingerprintAfter", "legal Action-space binding changed across invocation"));
    }
    if (
      value["constraintsFingerprintBefore"] !== evaluationFingerprint(before.constraints) ||
      value["constraintsFingerprintAfter"] !== evaluationFingerprint(after.constraints) ||
      value["constraintsFingerprintBefore"] !== value["constraintsFingerprintAfter"]
    ) {
      issues.push(issue("CONSTRAINT_MUTATION", "evidence.constraintsFingerprintAfter", "constraint binding changed across invocation"));
    }
  }

  if (value["dispositionCreatedByEvaluator"] !== true) {
    issues.push(issue("EVALUATOR_BYPASS", "evidence.dispositionCreatedByEvaluator", "constraint dispositions must be created by the evaluator"));
  }
  if (value["operatorExecutedActions"] !== false) {
    issues.push(issue("DIRECT_EXECUTION_CLAIM", "evidence.operatorExecutedActions", "operators may propose Actions but may not execute them"));
  }
  if (value["operatorMutatedSimulatorState"] !== false) {
    issues.push(issue("SIMULATOR_MUTATION_CLAIM", "evidence.operatorMutatedSimulatorState", "operators may not mutate simulator state"));
  }

  const dispositionResult = validateConstraintDispositionEvidence(value["dispositionEvidence"]);
  if (dispositionResult.status !== "PASS") {
    issues.push(issue("INVALID_EVALUATOR_DISPOSITION", "evidence.dispositionEvidence", "disposition evidence failed constraint conformance"));
  }
  if (
    !isFingerprint(value["dispositionEvidenceFingerprint"]) ||
    safeFingerprint(value["dispositionEvidence"]) !== value["dispositionEvidenceFingerprint"]
  ) {
    issues.push(issue("DISPOSITION_EVIDENCE_TAMPERED", "evidence.dispositionEvidenceFingerprint", "disposition evidence fingerprint mismatch"));
  }

  const fingerprint = safeFingerprint(value);
  return result("operator_isolation", issues, fingerprint === undefined ? [] : [fingerprint]);
}
