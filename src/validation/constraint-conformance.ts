import { actionFingerprint } from "../action_ontology/semantics.js";
import type { Action } from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import {
  assertDecisionOpportunityAllowed,
  assertValidBaselineEvaluationContract,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
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
import {
  assertCanonicalOperatorMetadataV2,
  canonicalInputFingerprint,
  canonicalizeActionOrdering,
  type CanonicalOperatorMetadataV2,
} from "../operator/canonical-interface.js";
import type { EvaluatedOperatorDecision, OperatorInvocationAudit } from "../evaluation/operator-evaluation.js";
import type { BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import {
  canonicalInputIntegrity,
  hasExactKeys,
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
  readonly operatorMetadata: CanonicalOperatorMetadataV2;
  readonly evaluatedDecision: EvaluatedOperatorDecision;
  readonly dispositionEvidence: ConstraintDispositionEvidence;
}

const DISPOSITION_KEYS = ["contract", "opportunity", "availability", "attempts"] as const;
const ATTEMPT_KEYS = ["rawProposal", "constraintIssues", "explicitModifiedAction", "attemptRecord"] as const;
const AUTHORITY_KEYS = [
  "canonicalInputBefore", "canonicalInputAfter",
  "operatorMetadata", "evaluatedDecision", "dispositionEvidence",
] as const;

function caughtMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    return result("constraint_conformance", [
      issue("INVALID_JSON_EVIDENCE", "evidence", "constraint evidence must be strict deterministic JSON"),
    ], []);
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

  if (!Array.isArray(value["attempts"])) {
    issues.push(issue("INVALID_EVIDENCE_SHAPE", "evidence.attempts", "constraint evidence requires an attempt array"));
  } else {
    const validProposals: Action[] = [];
    value["attempts"].forEach((rawAttempt, index) => {
      const path = `evidence.attempts[${index}]`;
      if (!isRecord(rawAttempt) || !hasExactKeys(rawAttempt, ATTEMPT_KEYS)) {
        issues.push(issue("INVALID_ATTEMPT_EVIDENCE", path, "attempt evidence must have the exact required keys"));
        return;
      }
      try {
        validProposals.push(assertValidAction(rawAttempt["rawProposal"] as never));
      } catch {
        // The evaluator record validation below reports malformed proposals.
      }
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
    if (validProposals.length === value["attempts"].length) {
      const actual = validProposals.map(actionFingerprint);
      const canonical = canonicalizeActionOrdering(validProposals).map(actionFingerprint);
      if (stableEvaluationJson(actual) !== stableEvaluationJson(canonical)) {
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
    return result("operator_isolation", [
      issue("INVALID_JSON_EVIDENCE", "evidence", "operator authority evidence must be strict deterministic JSON"),
    ], []);
  }

  const before = value["canonicalInputBefore"];
  const after = value["canonicalInputAfter"];
  let beforeIntegrity: ReturnType<typeof canonicalInputIntegrity> | undefined;
  let afterIntegrity: ReturnType<typeof canonicalInputIntegrity> | undefined;
  let authorityContract: BaselineEvaluationContract | undefined;
  let authorityOpportunity: DecisionOpportunity | undefined;
  const dispositionEvidence = value["dispositionEvidence"];
  if (isRecord(dispositionEvidence) && isRecord(dispositionEvidence["contract"]) &&
    isRecord(dispositionEvidence["opportunity"]) && isRecord(dispositionEvidence["availability"])) {
    try {
      const contract = dispositionEvidence["contract"] as unknown as BaselineEvaluationContract;
      const opportunity = dispositionEvidence["opportunity"] as unknown as DecisionOpportunity;
      const availability = dispositionEvidence["availability"] as unknown as ActionAvailabilitySnapshot;
      assertValidBaselineEvaluationContract(contract);
      assertDecisionOpportunityAllowed(contract, opportunity);
      authorityContract = contract;
      authorityOpportunity = opportunity;
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
    const beforeFingerprint = beforeIntegrity?.inputFingerprint ?? canonicalInputFingerprint(before);
    const afterFingerprint = afterIntegrity?.inputFingerprint ?? canonicalInputFingerprint(after);
    if (
      beforeFingerprint !== afterFingerprint ||
      stableEvaluationJson(before) !== stableEvaluationJson(after)
    ) {
      issues.push(issue("OPERATOR_INPUT_MUTATION", "evidence.canonicalInputAfter", "operator input changed across invocation"));
    }
  }

  const dispositionResult = validateConstraintDispositionEvidence(value["dispositionEvidence"]);
  if (dispositionResult.status !== "PASS") {
    issues.push(issue("INVALID_EVALUATOR_DISPOSITION", "evidence.dispositionEvidence", "disposition evidence failed constraint conformance"));
  }

  const metadata = value["operatorMetadata"];
  try {
    assertCanonicalOperatorMetadataV2(metadata as CanonicalOperatorMetadataV2);
    if (isRecord(dispositionEvidence) && isRecord(dispositionEvidence["contract"])) {
      const boundContract = dispositionEvidence["contract"] as unknown as BaselineEvaluationContract;
      const supported = (metadata as CanonicalOperatorMetadataV2).supportedEvaluationContract;
      if (supported.contractId !== boundContract.contractId ||
        supported.contractVersion !== boundContract.contractVersion ||
        supported.contractFingerprint !== boundContract.contractFingerprint ||
        (metadata as CanonicalOperatorMetadataV2).supportedActionOntologyVersion !== boundContract.actionSpace.ontologySchemaVersion) {
        throw new TypeError("operator metadata differs from evaluator contract");
      }
    }
  } catch (error) {
    issues.push(issue("INVALID_OPERATOR_METADATA", "evidence.operatorMetadata", caughtMessage(error)));
  }

  const evaluated = value["evaluatedDecision"];
  if (!isRecord(evaluated) || !hasExactKeys(evaluated, ["invocation", "decisionRecord"]) ||
    !isRecord(evaluated["invocation"]) || !isRecord(evaluated["decisionRecord"])) {
    issues.push(issue("INVALID_INVOCATION_AUDIT", "evidence.evaluatedDecision", "evaluated decision must have the exact evaluator-created shape"));
  } else {
    const invocation = evaluated["invocation"] as unknown as OperatorInvocationAudit;
    const invocationRecord = evaluated["invocation"];
    const decisionRecord = evaluated["decisionRecord"];
    const baseInvocationKeys = [
      "invocationId", "interfaceVersion", "operatorId", "operatorVersion", "operatorFamily",
      "operatorFingerprint", "configurationFingerprint", "interfaceAdapterFingerprint",
      "opportunityId", "decisionTime", "observationFingerprint", "availabilityFingerprint",
      "inputFingerprint", "outputFingerprint", "proposedActionCount", "disposition",
    ];
    const invocationKeys = Object.prototype.hasOwnProperty.call(invocationRecord, "decisionAudit")
      ? [...baseInvocationKeys, "decisionAudit"] : baseInvocationKeys;
    let auditShapeValid = hasExactKeys(invocationRecord, invocationKeys) &&
      hasExactKeys(decisionRecord, ["opportunity", "observation", "availability", "actionAttempts"]) &&
      isRecord(decisionRecord["opportunity"]) && isRecord(decisionRecord["observation"]) &&
      isRecord(decisionRecord["availability"]) && Array.isArray(decisionRecord["actionAttempts"]) &&
      decisionRecord["actionAttempts"].every(isRecord) && isRecord(metadata);
    if (Object.prototype.hasOwnProperty.call(invocationRecord, "decisionAudit")) {
      const decisionAudit = invocationRecord["decisionAudit"];
      auditShapeValid = auditShapeValid && isRecord(decisionAudit) &&
        hasExactKeys(decisionAudit, ["auditType", "payload", "auditFingerprint"]) &&
        decisionAudit["auditFingerprint"] === evaluationFingerprint({
          auditType: decisionAudit["auditType"],
          payload: decisionAudit["payload"],
        });
    }
    if (!auditShapeValid) {
      issues.push(issue("INVALID_INVOCATION_AUDIT", "evidence.evaluatedDecision", "invocation audit or decision record has unexpected fields"));
    } else {
      const { invocationId: _invocationId, ...invocationBody } = invocationRecord;
      const expectedInvocationId = "operator_invocation_" + evaluationFingerprint(invocationBody).replace("fnv1a64:", "");
      const dispositionAttempts = isRecord(dispositionEvidence) && Array.isArray(dispositionEvidence["attempts"]) &&
        dispositionEvidence["attempts"].every(isRecord)
        ? dispositionEvidence["attempts"] as Record<string, unknown>[] : undefined;
      const expectedAttempts = dispositionAttempts?.map((attempt) => attempt["attemptRecord"]);
      const decisionAttempts = decisionRecord["actionAttempts"] as Record<string, unknown>[];
      const rawActions = decisionAttempts.map((attempt) => attempt["rawProposal"]);
      const metadataValue = metadata as CanonicalOperatorMetadataV2;
      let expectedObservationMatches = false;
      if (authorityContract !== undefined && authorityOpportunity !== undefined &&
        isRecord(before) && isRecord(before["observation"]) && Array.isArray(before["observation"]["records"])) {
        try {
          const expectedObservation = buildOperatorObservationSnapshot(
            authorityContract,
            authorityOpportunity,
            before["observation"]["records"] as never,
          );
          expectedObservationMatches = stableEvaluationJson(expectedObservation) === stableEvaluationJson(decisionRecord["observation"]);
        } catch {
          expectedObservationMatches = false;
        }
      }
      if (invocation.invocationId !== expectedInvocationId ||
        invocation.interfaceVersion !== metadataValue.interfaceVersion ||
        invocation.operatorId !== metadataValue.operatorId ||
        invocation.operatorVersion !== metadataValue.operatorVersion ||
        invocation.operatorFamily !== metadataValue.operatorFamily ||
        invocation.operatorFingerprint !== metadataValue.implementationFingerprint ||
        invocation.configurationFingerprint !== metadataValue.configurationFingerprint ||
        invocation.interfaceAdapterFingerprint !== metadataValue.adapterFingerprint ||
        invocation.inputFingerprint !== beforeIntegrity?.inputFingerprint ||
        invocation.observationFingerprint !== beforeIntegrity?.observationFingerprint ||
        invocation.availabilityFingerprint !== beforeIntegrity?.availabilityFingerprint ||
        invocation.outputFingerprint !== evaluationFingerprint({ actions: rawActions }) ||
        invocation.proposedActionCount !== rawActions.length ||
        invocation.disposition !== (rawActions.length === 0 ? "NO_DISCRETIONARY_ACTIONS" : "ACTION_PROPOSALS_RECORDED")) {
        issues.push(issue("INVOCATION_AUDIT_TAMPERED", "evidence.evaluatedDecision.invocation", "invocation audit does not match operator, input, output, or disposition bindings"));
      }
      if (isRecord(dispositionEvidence) && expectedAttempts !== undefined &&
        (invocation.opportunityId !== (dispositionEvidence["opportunity"] as DecisionOpportunity | undefined)?.opportunityId ||
          invocation.decisionTime !== (dispositionEvidence["opportunity"] as DecisionOpportunity | undefined)?.at ||
          stableEvaluationJson(decisionRecord["opportunity"]) !== stableEvaluationJson(dispositionEvidence["opportunity"]) ||
          stableEvaluationJson(decisionRecord["availability"]) !== stableEvaluationJson(dispositionEvidence["availability"]) ||
          stableEvaluationJson(decisionRecord["actionAttempts"]) !== stableEvaluationJson(expectedAttempts) ||
          !expectedObservationMatches)) {
        issues.push(issue("EVALUATED_DECISION_MISMATCH", "evidence.evaluatedDecision.decisionRecord", "evaluator decision record differs from disposition evidence"));
      } else if (expectedAttempts === undefined) {
        issues.push(issue("EVALUATED_DECISION_MISMATCH", "evidence.evaluatedDecision.decisionRecord", "disposition attempts do not have evaluator-created records"));
      }
      if (!isRecord(decisionRecord["observation"]) ||
        invocation.observationFingerprint !== decisionRecord["observation"]["observationFingerprint"] ||
        invocation.availabilityFingerprint !== (decisionRecord["availability"] as Record<string, unknown> | undefined)?.["availabilityFingerprint"]) {
        issues.push(issue("INVOCATION_AUDIT_TAMPERED", "evidence.evaluatedDecision.decisionRecord", "decision record observation or availability differs from invocation audit"));
      }
    }
  }

  const fingerprint = safeFingerprint(value);
  return result("operator_isolation", issues, fingerprint === undefined ? [] : [fingerprint]);
}
