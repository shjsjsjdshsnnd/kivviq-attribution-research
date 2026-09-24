import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import {
  assertDecisionOpportunityAllowed,
  assertValidBaselineEvaluationContract,
  buildActionAvailabilitySnapshot,
  stableEvaluationJson,
  validateActionBatchAtDecision,
  type ActionAvailabilitySnapshot,
  type BaselineEvaluationContract,
  type DecisionOpportunity,
} from "../evaluation/baseline-contract.js";
import {
  validateCanonicalDecisionEnvelope,
  type CanonicalOperatorDecisionV2,
  type CanonicalOperatorInputV2,
  type CanonicalOperatorMetadataV2,
} from "../operator/canonical-interface.js";
import type { BaselineValidationCheckResult, BaselineValidationIssue } from "./contract.js";
import {
  hasExactKeys,
  isRecord,
  isStrictJson,
  issue,
  result,
  safeFingerprint,
} from "./shared.js";

export interface DecisionActionConformanceEvidence {
  readonly contract: BaselineEvaluationContract;
  readonly opportunity: DecisionOpportunity;
  readonly availability: ActionAvailabilitySnapshot;
  readonly canonicalInput: CanonicalOperatorInputV2;
  readonly operatorMetadata: CanonicalOperatorMetadataV2;
  readonly decisionEnvelope: unknown;
}

const EVIDENCE_KEYS = [
  "contract",
  "opportunity",
  "availability",
  "canonicalInput",
  "operatorMetadata",
  "decisionEnvelope",
] as const;

function caughtMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envelopeIssue(error: unknown): BaselineValidationIssue {
  const message = caughtMessage(error);
  if (/duplicate/i.test(message)) {
    return issue("DUPLICATE_ACTIONS", "evidence.decisionEnvelope.actions", message);
  }
  if (/conflicting Actions|mutual exclusion/i.test(message)) {
    return issue("CONFLICTING_ACTIONS", "evidence.decisionEnvelope.actions", message);
  }
  if (/canonical deterministic ordering/i.test(message)) {
    return issue("UNSTABLE_ACTION_ORDER", "evidence.decisionEnvelope.actions", message);
  }
  if (/declared capability|undeclared Action domain/i.test(message)) {
    return issue("CAPABILITY_VIOLATION", "evidence.operatorMetadata.capabilities", message);
  }
  return issue("INVALID_DECISION_ENVELOPE", "evidence.decisionEnvelope", message);
}

function validateBindings(
  evidence: Record<string, unknown>,
  issues: BaselineValidationIssue[],
): {
  contract: BaselineEvaluationContract | undefined;
  opportunity: DecisionOpportunity | undefined;
  availability: ActionAvailabilitySnapshot | undefined;
  input: CanonicalOperatorInputV2 | undefined;
  metadata: CanonicalOperatorMetadataV2 | undefined;
} {
  let contract: BaselineEvaluationContract | undefined;
  let opportunity: DecisionOpportunity | undefined;
  let availability: ActionAvailabilitySnapshot | undefined;

  try {
    assertValidBaselineEvaluationContract(evidence["contract"] as BaselineEvaluationContract);
    contract = evidence["contract"] as BaselineEvaluationContract;
  } catch (error) {
    issues.push(issue("INVALID_CONTRACT_BINDING", "evidence.contract", caughtMessage(error)));
  }

  if (contract !== undefined) {
    try {
      assertDecisionOpportunityAllowed(contract, evidence["opportunity"] as DecisionOpportunity);
      opportunity = evidence["opportunity"] as DecisionOpportunity;
    } catch (error) {
      issues.push(issue("INVALID_OPPORTUNITY_BINDING", "evidence.opportunity", caughtMessage(error)));
    }
  }

  if (contract !== undefined && opportunity !== undefined && isRecord(evidence["availability"])) {
    try {
      const raw = evidence["availability"];
      const rebuilt = buildActionAvailabilitySnapshot(
        contract,
        opportunity,
        raw["rules"] as ActionAvailabilitySnapshot["rules"],
        raw["mutualExclusionGroups"] as ActionAvailabilitySnapshot["mutualExclusionGroups"],
      );
      if (stableEvaluationJson(rebuilt) !== stableEvaluationJson(raw)) {
        throw new TypeError("availability snapshot does not match its canonical fingerprint or exact schema");
      }
      availability = rebuilt;
    } catch (error) {
      issues.push(issue("INVALID_AVAILABILITY_BINDING", "evidence.availability", caughtMessage(error)));
    }
  } else if (!isRecord(evidence["availability"])) {
    issues.push(issue("INVALID_AVAILABILITY_BINDING", "evidence.availability", "availability must be a canonical snapshot"));
  }

  const input = isRecord(evidence["canonicalInput"])
    ? evidence["canonicalInput"] as unknown as CanonicalOperatorInputV2
    : undefined;
  const metadata = isRecord(evidence["operatorMetadata"])
    ? evidence["operatorMetadata"] as unknown as CanonicalOperatorMetadataV2
    : undefined;
  if (input === undefined) {
    issues.push(issue("INVALID_INPUT_BINDING", "evidence.canonicalInput", "canonical input must be an object"));
  } else if (contract !== undefined && opportunity !== undefined && availability !== undefined) {
    try {
      const expectedConstraints = {
        dimensions: contract.businessConstraints.dimensions,
        evaluationBoundary: contract.businessConstraints.evaluationBoundary,
        invalidActionHandling: contract.businessConstraints.invalidActionHandling,
        infeasibleActionHandling: contract.businessConstraints.infeasibleActionHandling,
        partialFeasibilityHandling: contract.businessConstraints.partialFeasibilityHandling,
        conflictHandling: contract.businessConstraints.conflictHandling,
        silentModificationForbidden: contract.businessConstraints.silentModificationForbidden,
      };
      const expectedLegalActionSpace = {
        rules: availability.rules,
        mutualExclusionGroups: availability.mutualExclusionGroups,
      };
      const bindingValid =
        isRecord(input.decisionContext) && isRecord(input.provenance) &&
        input.opportunityId === opportunity.opportunityId &&
        input.decisionTime === opportunity.at &&
        stableEvaluationJson(input.decisionContext) === stableEvaluationJson({ sequence: opportunity.sequence, trigger: opportunity.trigger }) &&
        stableEvaluationJson(input.constraints) === stableEvaluationJson(expectedConstraints) &&
        stableEvaluationJson(input.legalActionSpace) === stableEvaluationJson(expectedLegalActionSpace) &&
        input.provenance.evaluationContractFingerprint === contract.contractFingerprint &&
        input.provenance.evaluationContractVersion === contract.contractVersion &&
        input.provenance.legalActionSpaceFingerprint === availability.availabilityFingerprint &&
        input.provenance.actionOntologyVersion === contract.actionSpace.ontologySchemaVersion;
      if (!bindingValid) throw new TypeError("canonical input binding mismatch");
    } catch {
      issues.push(issue("INPUT_BINDING_MISMATCH", "evidence.canonicalInput", "canonical input differs from the frozen opportunity, constraints, or legal Action space"));
    }
  }
  if (metadata === undefined) {
    issues.push(issue("INVALID_OPERATOR_METADATA", "evidence.operatorMetadata", "operator metadata must be an object"));
  } else if (contract !== undefined) {
    const supported = metadata.supportedEvaluationContract;
    if (!isRecord(supported) ||
      supported["contractId"] !== contract.contractId ||
      supported["contractVersion"] !== contract.contractVersion ||
      supported["contractFingerprint"] !== contract.contractFingerprint ||
      metadata.supportedActionOntologyVersion !== contract.actionSpace.ontologySchemaVersion
    ) {
      issues.push(issue("OPERATOR_BINDING_MISMATCH", "evidence.operatorMetadata", "operator metadata is not bound to the frozen evaluation contract and Action Ontology"));
    }
  }

  return { contract, opportunity, availability, input, metadata };
}

export function validateDecisionActionConformance(
  value: unknown,
): BaselineValidationCheckResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS)) {
    return result("action_ontology_conformance", [
      issue("INVALID_EVIDENCE_SHAPE", "evidence", "Action conformance evidence must have the exact required keys"),
    ], []);
  }
  if (!isStrictJson(value)) {
    issues.push(issue("INVALID_JSON_EVIDENCE", "evidence", "Action conformance evidence must be strict deterministic JSON"));
  }

  const bindings = validateBindings(value, issues);
  const envelope = value["decisionEnvelope"];
  const rawActions = isRecord(envelope) && Array.isArray(envelope["actions"])
    ? envelope["actions"]
    : undefined;

  if (rawActions === undefined) {
    issues.push(issue("INVALID_DECISION_ENVELOPE", "evidence.decisionEnvelope.actions", "decision envelope must contain an Action array"));
  } else {
    rawActions.forEach((rawAction, index) => {
      try {
        assertValidAction(rawAction);
      } catch (error) {
        issues.push(issue("INVALID_ACTION", `evidence.decisionEnvelope.actions[${index}]`, caughtMessage(error)));
      }
    });
  }

  let validated: CanonicalOperatorDecisionV2 | undefined;
  if (bindings.input !== undefined && bindings.metadata !== undefined) {
    try {
      validated = validateCanonicalDecisionEnvelope(bindings.input, bindings.metadata, envelope);
    } catch (error) {
      issues.push(envelopeIssue(error));
    }
  }

  if (
    validated !== undefined && bindings.contract !== undefined &&
    bindings.opportunity !== undefined && bindings.availability !== undefined
  ) {
    const actionResults = validateActionBatchAtDecision(
      bindings.contract,
      bindings.opportunity,
      bindings.availability,
      validated.actions,
    );
    actionResults.forEach((actionResult, index) => {
      if (!actionResult.valid) {
        issues.push(issue(actionResult.code, `evidence.decisionEnvelope.actions[${index}]`, actionResult.reason));
      }
    });
    for (const action of validated.actions) actionFingerprint(action);
  }

  const fingerprint = safeFingerprint(value);
  return result(
    "action_ontology_conformance",
    issues,
    fingerprint === undefined ? [] : [fingerprint],
  );
}
