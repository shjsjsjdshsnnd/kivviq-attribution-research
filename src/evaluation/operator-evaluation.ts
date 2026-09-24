import type { Action } from "../action_ontology/types.js";
import type {
  CanonicalOperator,
  CanonicalOperatorMetadata,
  OperatorDecisionAudit,
  OperatorDecisionInput,
  OperatorObservationInformationClass,
} from "../operator/types.js";
import {
  CANONICAL_OPERATOR_INTERFACE_VERSION,
  assertCanonicalOperatorInputV2,
  canonicalInputFingerprint,
  ensureCanonicalOperatorV2,
  validateCanonicalDecisionEnvelope,
  type CanonicalOperatorInputV2,
  type CanonicalOperatorV2,
} from "../operator/canonical-interface.js";
import {
  type ActionAvailabilitySnapshot,
  type BaselineEvaluationContract,
  type ConstraintIssue,
  type DecisionOpportunity,
  type EvaluationDecisionRecord,
  type EvaluationRunArtifact,
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

export function buildCanonicalOperatorInput(
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  observation: OperatorObservationSnapshot,
  availability: ActionAvailabilitySnapshot,
  legacyInput: OperatorDecisionInput,
): CanonicalOperatorInputV2 {
  const input = deepFreezeEvaluation({
    schemaVersion: "1.0.0",
    ...legacyInput,
    decisionContext: {
      sequence: opportunity.sequence,
      trigger: opportunity.trigger,
    },
    constraints: {
      dimensions: [...contract.businessConstraints.dimensions],
      evaluationBoundary: contract.businessConstraints.evaluationBoundary,
      invalidActionHandling:
        contract.businessConstraints.invalidActionHandling,
      infeasibleActionHandling:
        contract.businessConstraints.infeasibleActionHandling,
      partialFeasibilityHandling:
        contract.businessConstraints.partialFeasibilityHandling,
      conflictHandling: contract.businessConstraints.conflictHandling,
      silentModificationForbidden:
        contract.businessConstraints.silentModificationForbidden,
    },
    provenance: {
      schemaVersion: "1.0.0",
      evaluationContractFingerprint: contract.contractFingerprint,
      evaluationContractVersion: contract.contractVersion,
      observationFingerprint: observation.observationFingerprint,
      legalActionSpaceFingerprint: availability.availabilityFingerprint,
      actionOntologyVersion: contract.actionSpace.ontologySchemaVersion,
      source: "step3.1-governed-evaluator-adapter",
    },
  });
  return assertCanonicalOperatorInputV2(input, {
    opportunityId: opportunity.opportunityId,
    decisionTime: opportunity.at,
    decisionContext: input.decisionContext,
    observationRecords: input.observation.records,
    legalActionSpace: input.legalActionSpace,
    constraints: input.constraints,
    evaluationContractFingerprint: contract.contractFingerprint,
    evaluationContractVersion: contract.contractVersion,
    observationFingerprint: observation.observationFingerprint,
    legalActionSpaceFingerprint: availability.availabilityFingerprint,
    actionOntologyVersion: contract.actionSpace.ontologySchemaVersion,
  });
}

export function assertCanonicalOperatorCompatibleWithContract(
  contract: BaselineEvaluationContract,
  operator: CanonicalOperatorV2,
): void {
  const metadata = operator.metadata;
  requireCondition(
    metadata.interfaceVersion === CANONICAL_OPERATOR_INTERFACE_VERSION,
    "operator does not implement canonical v2 interface",
  );
  requireCondition(
    metadata.supportedEvaluationContract.contractId === contract.contractId &&
      metadata.supportedEvaluationContract.contractVersion ===
        contract.contractVersion &&
      metadata.supportedEvaluationContract.contractFingerprint ===
        contract.contractFingerprint,
    "canonical operator does not support this frozen evaluation contract",
  );
  requireCondition(
    metadata.supportedActionOntologyVersion ===
      contract.actionSpace.ontologySchemaVersion,
    "canonical operator does not support this Action Ontology version",
  );
}



export type ProposalConstraintAssessor = (
  action: Action,
  proposalIndex: number,
) => ProposalConstraintAssessment;

export type OperatorInvocationDisposition =
  | "NO_DISCRETIONARY_ACTIONS"
  | "ACTION_PROPOSALS_RECORDED";

export interface RecordedOperatorDecisionAudit {
  readonly auditType: string;
  readonly payload: OperatorDecisionAudit["payload"];
  readonly auditFingerprint: string;
}

export interface OperatorInvocationAudit {
  readonly invocationId: string;
  readonly interfaceVersion: typeof CANONICAL_OPERATOR_INTERFACE_VERSION;
  readonly operatorId: string;
  readonly operatorVersion: string;
  readonly operatorFamily: string;
  readonly operatorFingerprint: string;
  readonly configurationFingerprint: string;
  readonly interfaceAdapterFingerprint: string;
  readonly opportunityId: string;
  readonly decisionTime: string;
  readonly observationFingerprint: string;
  readonly availabilityFingerprint: string;
  readonly inputFingerprint: string;
  readonly outputFingerprint: string;
  readonly proposedActionCount: number;
  readonly disposition: OperatorInvocationDisposition;
  readonly decisionAudit?: RecordedOperatorDecisionAudit;
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

export function invokeOperatorAtDecision(
  contract: BaselineEvaluationContract,
  operator: CanonicalOperator | CanonicalOperatorV2,
  opportunity: DecisionOpportunity,
  observation: OperatorObservationSnapshot,
  availability: ActionAvailabilitySnapshot,
  assessConstraints?: ProposalConstraintAssessor,
): EvaluatedOperatorDecision {
  const legacyInput = toOperatorDecisionInput(
    opportunity,
    observation,
    availability,
  );
  const canonicalOperator = ensureCanonicalOperatorV2(operator);
  assertCanonicalOperatorCompatibleWithContract(
    contract,
    canonicalOperator,
  );
  const input = buildCanonicalOperatorInput(
    contract,
    opportunity,
    observation,
    availability,
    legacyInput,
  );
  const rawOutput = canonicalOperator.decide(input);
  const output = validateCanonicalDecisionEnvelope(
    input,
    canonicalOperator.metadata,
    rawOutput,
  );

  const decisionAudit = canonicalOperator.auditDecision?.(input, output);
  const recordedDecisionAudit =
    decisionAudit === undefined
      ? undefined
      : deepFreezeEvaluation({
          auditType: decisionAudit.auditType,
          payload: cloneJson(decisionAudit.payload),
          auditFingerprint: evaluationFingerprint({
            auditType: decisionAudit.auditType,
            payload: decisionAudit.payload,
          }),
        });

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

  const inputFingerprint = canonicalInputFingerprint(input);
  const outputFingerprint = evaluationFingerprint({
    actions: output.actions,
  });
  const invocationBody = {
    interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION,
    operatorId: canonicalOperator.metadata.operatorId,
    operatorVersion: canonicalOperator.metadata.operatorVersion,
    operatorFamily: canonicalOperator.metadata.operatorFamily,
    operatorFingerprint:
      canonicalOperator.metadata.implementationFingerprint,
    configurationFingerprint:
      canonicalOperator.metadata.configurationFingerprint,
    interfaceAdapterFingerprint:
      canonicalOperator.metadata.adapterFingerprint,
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
    ...(recordedDecisionAudit === undefined
      ? {}
      : { decisionAudit: recordedDecisionAudit }),
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


export const OPERATOR_EVALUATION_BUNDLE_SCHEMA_VERSION =
  "1.0.0" as const;

export interface OperatorEvaluationBundle {
  readonly kind: "operator_evaluation_bundle";
  readonly schemaVersion: typeof OPERATOR_EVALUATION_BUNDLE_SCHEMA_VERSION;
  readonly evaluationArtifact: EvaluationRunArtifact;
  readonly operatorInvocations: readonly OperatorInvocationAudit[];
  readonly operatorMetadata?: CanonicalOperatorMetadata;
  readonly bundleFingerprint: string;
}

export function createOperatorEvaluationBundle(
  evaluationArtifact: EvaluationRunArtifact,
  operatorInvocations: readonly OperatorInvocationAudit[],
  operatorMetadata?: CanonicalOperatorMetadata,
): OperatorEvaluationBundle {
  requireCondition(
    operatorInvocations.length ===
      evaluationArtifact.decisionRecords.length,
    "every decision opportunity must have exactly one operator invocation",
  );

  if (operatorMetadata !== undefined) {
    requireCondition(
      operatorMetadata.operatorId === evaluationArtifact.operator.operatorId &&
        operatorMetadata.operatorVersion === evaluationArtifact.operator.operatorVersion &&
        operatorMetadata.implementationFingerprint ===
          evaluationArtifact.operator.operatorFingerprint,
      "operator metadata differs from evaluation artifact identity",
    );
  }

  for (let index = 0; index < operatorInvocations.length; index += 1) {
    const invocation = operatorInvocations[index]!;
    const decision = evaluationArtifact.decisionRecords[index]!;

    requireCondition(
      invocation.operatorId ===
        evaluationArtifact.operator.operatorId &&
        invocation.operatorVersion ===
          evaluationArtifact.operator.operatorVersion &&
        invocation.operatorFingerprint ===
          evaluationArtifact.operator.operatorFingerprint,
      "operator invocation identity differs from evaluation artifact",
    );
    requireCondition(
      invocation.opportunityId ===
        decision.opportunity.opportunityId &&
        Date.parse(invocation.decisionTime) ===
          Date.parse(decision.opportunity.at),
      "operator invocation does not match its decision opportunity",
    );
    requireCondition(
      invocation.observationFingerprint ===
        decision.observation.observationFingerprint,
      "operator invocation observation differs from decision record",
    );
    requireCondition(
      invocation.availabilityFingerprint ===
        decision.availability.availabilityFingerprint,
      "operator invocation legal Action space differs from decision record",
    );
    requireCondition(
      invocation.proposedActionCount ===
        decision.actionAttempts.length,
      "operator invocation proposal count differs from recorded Action attempts",
    );

    if (invocation.disposition === "NO_DISCRETIONARY_ACTIONS") {
      requireCondition(
        invocation.proposedActionCount === 0 &&
          decision.actionAttempts.length === 0,
        "no-action disposition must have zero Action proposals",
      );
    } else {
      requireCondition(
        invocation.proposedActionCount > 0,
        "Action-proposal disposition requires at least one proposal",
      );
    }
  }

  const body = {
    kind: "operator_evaluation_bundle" as const,
    schemaVersion: OPERATOR_EVALUATION_BUNDLE_SCHEMA_VERSION,
    evaluationArtifact,
    operatorInvocations: cloneJson(operatorInvocations),
    ...(operatorMetadata === undefined
      ? {}
      : { operatorMetadata: cloneJson(operatorMetadata) }),
  };

  return deepFreezeEvaluation({
    ...body,
    bundleFingerprint: evaluationFingerprint(body),
  });
}
