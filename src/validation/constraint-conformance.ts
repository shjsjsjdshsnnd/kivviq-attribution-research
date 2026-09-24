import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import {
  assertDecisionOpportunityAllowed,
  assertValidBaselineEvaluationContract,
  buildActionAvailabilitySnapshot,
  CONSTRAINT_ISSUE_KINDS,
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
  canonicalInputIntegrity,
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
      const invalidKindIndex = rawAttempt["constraintIssues"].findIndex(
        (constraintIssue) => !CONSTRAINT_ISSUE_KINDS.includes((constraintIssue as Record<string, unknown>)["kind"] as never),
      );
      if (invalidKindIndex >= 0) {
        issues.push(issue("INVALID_CONSTRAINT_ISSUE_KIND", `${path}.constraintIssues[${invalidKindIndex}].kind`, "constraint issue kind is outside the frozen Step 3.1 union"));
        return;
      }
      const invalidValueIndex = rawAttempt["constraintIssues"].findIndex((constraintIssue) => {
        const candidate = constraintIssue as Record<string, unknown>;
        return typeof candidate["constraintRef"] !== "string" || candidate["constraintRef"].trim().length === 0 ||
          typeof candidate["reason"] !== "string" || candidate["reason"].trim().length === 0;
      });
      if (invalidValueIndex >= 0) {
        issues.push(issue("INVALID_ATTEMPT_EVIDENCE", `${path}.constraintIssues[${invalidValueIndex}]`, "constraintRef and reason must be non-empty strings"));
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
        if (recomputed.actionValidation.valid && recomputed.constraintDisposition?.status === "MODIFIED") {
          const modified = assertValidAction(explicit);
          if (actionFingerprint(modified) === recomputed.actionValidation.fingerprint) {
            issues.push(issue("MODIFIED_ACTION_UNCHANGED", `${path}.explicitModifiedAction`, "MODIFIED requires a valid explicit Action that differs from the proposal"));
          }
        }
        if (recomputed.actionValidation.valid && recomputed.constraintDisposition?.status === "ACCEPTED" &&
          (recomputed.executedAction === undefined || actionFingerprint(recomputed.executedAction) !== recomputed.actionValidation.fingerprint)) {
          issues.push(issue("DISPOSITION_TAMPERED", `${path}.attemptRecord`, "ACCEPTED must execute the proposed Action unchanged"));
        }
        if (recomputed.constraintDisposition?.status === "REJECTED" && recomputed.executedAction !== undefined) {
          issues.push(issue("DISPOSITION_TAMPERED", `${path}.attemptRecord`, "REJECTED must not carry an executed Action"));
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
  let beforeIntegrity: ReturnType<typeof canonicalInputIntegrity> | undefined;
  let afterIntegrity: ReturnType<typeof canonicalInputIntegrity> | undefined;
  const dispositionEvidence = value["dispositionEvidence"];
  if (isRecord(dispositionEvidence) && isRecord(dispositionEvidence["contract"]) &&
    isRecord(dispositionEvidence["opportunity"]) && isRecord(dispositionEvidence["availability"])) {
    try {
      const contract = dispositionEvidence["contract"] as unknown as BaselineEvaluationContract;
      const opportunity = dispositionEvidence["opportunity"] as unknown as DecisionOpportunity;
      const availability = dispositionEvidence["availability"] as unknown as ActionAvailabilitySnapshot;
      assertValidBaselineEvaluationContract(contract);
      assertDecisionOpportunityAllowed(contract, opportunity);
      beforeIntegrity = canonicalInputIntegrity(before, contract, opportunity, availability, "evidence.canonicalInputBefore");
      afterIntegrity = canonicalInputIntegrity(after, contract, opportunity, availability, "evidence.canonicalInputAfter");
      issues.push(...beforeIntegrity.issues, ...afterIntegrity.issues);
    } catch (error) {
      issues.push(issue("INVALID_EVALUATOR_DISPOSITION", "evidence.dispositionEvidence", caughtMessage(error)));
    }
  }
  if (!frozenCanonicalInput(before) || !frozenCanonicalInput(after)) {
    issues.push(issue("MUTABLE_OPERATOR_INPUT", "evidence.canonicalInputBefore", "canonical inputs and nested observation, Action-space, constraints, and provenance objects must remain frozen"));
  } else {
    const beforeFingerprint = beforeIntegrity?.inputFingerprint ?? evaluationFingerprint(before);
    const afterFingerprint = afterIntegrity?.inputFingerprint ?? evaluationFingerprint(after);
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
      value["observationFingerprintBefore"] !== beforeIntegrity?.observationFingerprint ||
      value["observationFingerprintAfter"] !== afterIntegrity?.observationFingerprint ||
      value["observationFingerprintBefore"] !== value["observationFingerprintAfter"]
    ) {
      issues.push(issue("OBSERVATION_MUTATION", "evidence.observationFingerprintAfter", "observation binding changed across invocation"));
    }
    if (
      value["legalActionSpaceFingerprintBefore"] !== beforeIntegrity?.availabilityFingerprint ||
      value["legalActionSpaceFingerprintAfter"] !== afterIntegrity?.availabilityFingerprint ||
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
