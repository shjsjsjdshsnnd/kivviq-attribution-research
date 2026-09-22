import type { Action } from "../action_ontology/types.js";
import type {
  CanonicalOperator,
  OperatorDecisionInput,
  OperatorObservationInformationClass,
} from "../operator/types.js";
import {
  type ActionAvailabilitySnapshot,
  type BaselineEvaluationContract,
  type ConstraintIssue,
  type DecisionOpportunity,
  type EvaluationDecisionRecord,
  type OperatorObservationSnapshot,
  createEvaluationActionAttemptRecord,
  deepFreezeEvaluation,
  evaluationFingerprint,
  validateActionAtDecision,
} from "./baseline-contract.js";

export class OperatorEvaluationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OperatorEvaluationError";
  }
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new OperatorEvaluationError(message);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function operatorInformationClass(
  value: string,
): OperatorObservationInformationClass {
  switch (value) {
    case "observable_merchant_data":
    case "derived_observable_metric":
    case "historical_information":
    case "current_state_information":
      return value;
    default:
      throw new OperatorEvaluationError(
        "prohibited observation information class reached operator adapter: " +
          value,
      );
  }
}

export interface ProposalConstraintAssessment {
  readonly issues: readonly ConstraintIssue[];
  readonly explicitModifiedAction?: Action;
}

export type ProposalConstraintAssessor = (
  action: Action,
  proposalIndex: number,
) => ProposalConstraintAssessment;

export type OperatorInvocationDisposition =
  | "NO_DISCRETIONARY_ACTIONS"
  | "ACTION_PROPOSALS_RECORDED";

export interface OperatorInvocationAudit {
  readonly invocationId: string;
  readonly operatorId: string;
  readonly operatorVersion: string;
  readonly operatorFingerprint: string;
  readonly opportunityId: string;
  readonly decisionTime: string;
  readonly observationFingerprint: string;
  readonly availabilityFingerprint: string;
  readonly inputFingerprint: string;
  readonly outputFingerprint: string;
  readonly proposedActionCount: number;
  readonly disposition: OperatorInvocationDisposition;
}

export interface EvaluatedOperatorDecision {
  readonly invocation: OperatorInvocationAudit;
  readonly decisionRecord: EvaluationDecisionRecord;
}

export function assertOperatorCompatibleWithContract(
  contract: BaselineEvaluationContract,
  operator: CanonicalOperator,
): void {
  const metadata = operator.metadata;

  requireCondition(
    metadata.supportedEvaluationContract.contractId === contract.contractId,
    "operator does not support this evaluation contract ID",
  );
  requireCondition(
    metadata.supportedEvaluationContract.contractVersion ===
      contract.contractVersion,
    "operator does not support this evaluation contract version",
  );
  requireCondition(
    metadata.supportedEvaluationContract.contractFingerprint ===
      contract.contractFingerprint,
    "operator does not support this frozen evaluation contract fingerprint",
  );
  requireCondition(
    metadata.supportedActionOntologyVersion ===
      contract.actionSpace.ontologySchemaVersion,
    "operator does not support this Action Ontology version",
  );
  requireCondition(
    metadata.implementationFingerprint.trim().length > 0,
    "operator implementation fingerprint is required",
  );
}

export function toOperatorDecisionInput(
  opportunity: DecisionOpportunity,
  observation: OperatorObservationSnapshot,
  availability: ActionAvailabilitySnapshot,
): OperatorDecisionInput {
  requireCondition(
    observation.opportunityId === opportunity.opportunityId,
    "observation snapshot belongs to a different decision opportunity",
  );
  requireCondition(
    availability.opportunityId === opportunity.opportunityId,
    "legal Action snapshot belongs to a different decision opportunity",
  );
  requireCondition(
    Date.parse(observation.decisionTime) === Date.parse(opportunity.at),
    "observation decision time differs from decision opportunity",
  );

  return deepFreezeEvaluation({
    opportunityId: opportunity.opportunityId,
    decisionTime: opportunity.at,
    observation: {
      records: observation.records.map((record) => ({
        observationKey: record.observationKey,
        informationClass: operatorInformationClass(
          record.informationClass,
        ),
        sourceMinOccurredAt: record.sourceMinOccurredAt,
        sourceMaxOccurredAt: record.sourceMaxOccurredAt,
        availableAt: record.availableAt,
        sourceRef: record.sourceRef,
        value: cloneJson(record.value),
      })),
    },
    legalActionSpace: {
      rules: availability.rules.map((rule) => ({
        actionType: rule.actionType,
        eligibleTargets: cloneJson(rule.eligibleTargets),
        parameterBounds: cloneJson(rule.parameterBounds),
        requiredPreconditionIds: [...rule.requiredPreconditionIds],
      })),
      mutualExclusionGroups: availability.mutualExclusionGroups.map(
        (group) => ({
          groupId: group.groupId,
          actionTypes: [...group.actionTypes],
        }),
      ),
    },
  });
}

function assertDecisionOutput(
  value: unknown,
): asserts value is { readonly actions: readonly Action[] } {
  requireCondition(
    typeof value === "object" &&
      value !== null &&
      !Array.isArray(value),
    "operator decision output must be an object",
  );
  const record = value as Record<string, unknown>;
  requireCondition(
    Object.keys(record).length === 1 &&
      Object.prototype.hasOwnProperty.call(record, "actions"),
    "operator decision output must contain exactly the actions field",
  );
  requireCondition(
    Array.isArray(record.actions),
    "operator decision output actions must be an array",
  );
}

export function invokeOperatorAtDecision(
  contract: BaselineEvaluationContract,
  operator: CanonicalOperator,
  opportunity: DecisionOpportunity,
  observation: OperatorObservationSnapshot,
  availability: ActionAvailabilitySnapshot,
  assessConstraints?: ProposalConstraintAssessor,
): EvaluatedOperatorDecision {
  assertOperatorCompatibleWithContract(contract, operator);

  const input = toOperatorDecisionInput(
    opportunity,
    observation,
    availability,
  );
  const output = operator.decide(input);
  assertDecisionOutput(output);

  const actions = [...output.actions];
  const attempts = actions.map((rawAction, proposalIndex) => {
    const preliminary = validateActionAtDecision(
      contract,
      opportunity,
      availability,
      rawAction,
    );

    if (!preliminary.valid) {
      return createEvaluationActionAttemptRecord(
        contract,
        opportunity,
        availability,
        rawAction,
      );
    }

    requireCondition(
      assessConstraints !== undefined,
      "valid discretionary Action proposal requires the normal constraint assessor",
    );
    const assessment = assessConstraints(
      preliminary.action,
      proposalIndex,
    );

    return createEvaluationActionAttemptRecord(
      contract,
      opportunity,
      availability,
      rawAction,
      assessment.issues,
      assessment.explicitModifiedAction,
    );
  });

  const decisionRecord: EvaluationDecisionRecord =
    deepFreezeEvaluation({
      opportunity,
      observation,
      availability,
      actionAttempts: attempts,
    });

  const inputFingerprint = evaluationFingerprint(input);
  const outputFingerprint = evaluationFingerprint(output);
  const invocationBody = {
    operatorId: operator.metadata.operatorId,
    operatorVersion: operator.metadata.operatorVersion,
    operatorFingerprint:
      operator.metadata.implementationFingerprint,
    opportunityId: opportunity.opportunityId,
    decisionTime: opportunity.at,
    observationFingerprint:
      observation.observationFingerprint,
    availabilityFingerprint:
      availability.availabilityFingerprint,
    inputFingerprint,
    outputFingerprint,
    proposedActionCount: actions.length,
    disposition:
      actions.length === 0
        ? ("NO_DISCRETIONARY_ACTIONS" as const)
        : ("ACTION_PROPOSALS_RECORDED" as const),
  };

  const invocation: OperatorInvocationAudit =
    deepFreezeEvaluation({
      invocationId:
        "operator_invocation_" +
        evaluationFingerprint(invocationBody).replace(
          "fnv1a64:",
          "",
        ),
      ...invocationBody,
    });

  return deepFreezeEvaluation({
    invocation,
    decisionRecord,
  });
}
