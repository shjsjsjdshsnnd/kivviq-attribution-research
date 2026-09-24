import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import {
  assertDecisionOpportunityAllowed,
  assertValidBaselineEvaluationContract,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  stableEvaluationJson,
  validateActionBatchAtDecision,
  type ActionAvailabilitySnapshot,
  type BaselineEvaluationContract,
  type DecisionOpportunity,
} from "../evaluation/baseline-contract.js";
import {
  CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION,
  CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION,
  canonicalInputFingerprint,
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

const INPUT_KEYS = ["schemaVersion", "opportunityId", "decisionTime", "observation", "legalActionSpace", "decisionContext", "constraints", "provenance"] as const;
const OBSERVATION_KEYS = ["records"] as const;
const OBSERVATION_RECORD_KEYS = ["observationKey", "informationClass", "sourceMinOccurredAt", "sourceMaxOccurredAt", "availableAt", "sourceRef", "value"] as const;
const ACTION_SPACE_KEYS = ["rules", "mutualExclusionGroups"] as const;
const ACTION_RULE_KEYS = ["actionType", "eligibleTargets", "parameterBounds", "requiredPreconditionIds"] as const;
const BOUND_ALLOWED_KEYS = ["path", "minInclusive", "maxInclusive"] as const;
const GROUP_KEYS = ["groupId", "actionTypes"] as const;
const DECISION_CONTEXT_KEYS = ["sequence", "trigger"] as const;
const CONSTRAINT_KEYS = ["dimensions", "evaluationBoundary", "invalidActionHandling", "infeasibleActionHandling", "partialFeasibilityHandling", "conflictHandling", "silentModificationForbidden"] as const;
const PROVENANCE_KEYS = ["schemaVersion", "evaluationContractFingerprint", "evaluationContractVersion", "observationFingerprint", "legalActionSpaceFingerprint", "actionOntologyVersion", "source"] as const;

function hasAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowed.includes(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function exactCanonicalInputShape(input: Record<string, unknown>): boolean {
  if (!hasExactKeys(input, INPUT_KEYS) ||
    !isRecord(input["observation"]) || !hasExactKeys(input["observation"], OBSERVATION_KEYS) ||
    !Array.isArray(input["observation"]["records"]) ||
    !input["observation"]["records"].every((record) => isRecord(record) && hasExactKeys(record, OBSERVATION_RECORD_KEYS)) ||
    !isRecord(input["legalActionSpace"]) || !hasExactKeys(input["legalActionSpace"], ACTION_SPACE_KEYS) ||
    !Array.isArray(input["legalActionSpace"]["rules"]) ||
    !input["legalActionSpace"]["rules"].every((rule) => isRecord(rule) && hasExactKeys(rule, ACTION_RULE_KEYS) &&
      Array.isArray(rule["parameterBounds"]) && rule["parameterBounds"].every((bound) => isRecord(bound) && hasAllowedKeys(bound, BOUND_ALLOWED_KEYS, ["path"])) ) ||
    !Array.isArray(input["legalActionSpace"]["mutualExclusionGroups"]) ||
    !input["legalActionSpace"]["mutualExclusionGroups"].every((group) => isRecord(group) && hasExactKeys(group, GROUP_KEYS)) ||
    !isRecord(input["decisionContext"]) || !hasExactKeys(input["decisionContext"], DECISION_CONTEXT_KEYS) ||
    !isRecord(input["decisionContext"]["trigger"]) ||
    !isRecord(input["constraints"]) || !hasExactKeys(input["constraints"], CONSTRAINT_KEYS) ||
    !isRecord(input["provenance"]) || !hasExactKeys(input["provenance"], PROVENANCE_KEYS)) return false;
  const trigger = input["decisionContext"]["trigger"];
  return (trigger["kind"] === "fixed_interval" && hasExactKeys(trigger, ["kind", "intervalIndex"])) ||
    (trigger["kind"] === "simulation_tick" && hasExactKeys(trigger, ["kind", "tick"])) ||
    (trigger["kind"] === "event" && hasExactKeys(trigger, ["kind", "eventType", "eventId"]));
}

export interface CanonicalInputIntegrityResult {
  readonly issues: readonly BaselineValidationIssue[];
  readonly inputFingerprint?: string;
  readonly observationFingerprint?: string;
  readonly availabilityFingerprint?: string;
}

/** @internal Shared by the Action and operator-authority evidence checks. */
export function validateCanonicalInputIntegrity(
  value: unknown,
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  availability: ActionAvailabilitySnapshot,
  path = "evidence.canonicalInput",
): CanonicalInputIntegrityResult {
  const issues: BaselineValidationIssue[] = [];
  if (!isRecord(value) || !exactCanonicalInputShape(value)) {
    return { issues: [issue("INVALID_INPUT_SCHEMA", path, "canonical operator input must match the exact Step 3.10 schema")] };
  }
  const input = value as unknown as CanonicalOperatorInputV2;
  if (input.schemaVersion !== CANONICAL_OPERATOR_INPUT_SCHEMA_VERSION ||
    input.provenance.schemaVersion !== CANONICAL_OPERATOR_PROVENANCE_SCHEMA_VERSION ||
    input.provenance.source !== "step3.1-governed-evaluator-adapter") {
    issues.push(issue("INVALID_INPUT_SCHEMA", path, "canonical operator input or provenance schema version is unsupported"));
  }
  if (input.opportunityId !== opportunity.opportunityId || input.decisionTime !== opportunity.at ||
    stableEvaluationJson(input.decisionContext) !== stableEvaluationJson({ sequence: opportunity.sequence, trigger: opportunity.trigger })) {
    issues.push(issue("INPUT_BINDING_MISMATCH", path, "canonical input does not bind the supplied decision opportunity"));
  }

  let observationFingerprint: string | undefined;
  try {
    const snapshot = buildOperatorObservationSnapshot(contract, opportunity, input.observation.records as never);
    observationFingerprint = snapshot.observationFingerprint;
    if (stableEvaluationJson(snapshot.records) !== stableEvaluationJson(input.observation.records) ||
      input.provenance.observationFingerprint !== observationFingerprint) {
      throw new TypeError("observation records or provenance fingerprint differ from the canonical snapshot");
    }
  } catch (error) {
    issues.push(issue("OBSERVATION_INTEGRITY", `${path}.observation`, caughtMessage(error)));
  }

  let availabilityFingerprint: string | undefined;
  try {
    const snapshot = buildActionAvailabilitySnapshot(
      contract,
      opportunity,
      input.legalActionSpace.rules,
      input.legalActionSpace.mutualExclusionGroups,
    );
    availabilityFingerprint = snapshot.availabilityFingerprint;
    if (stableEvaluationJson({ rules: snapshot.rules, mutualExclusionGroups: snapshot.mutualExclusionGroups }) !== stableEvaluationJson(input.legalActionSpace) ||
      input.provenance.legalActionSpaceFingerprint !== availabilityFingerprint ||
      stableEvaluationJson(snapshot) !== stableEvaluationJson(availability)) {
      throw new TypeError("legal Action space, provenance fingerprint, or bound availability differs from the canonical snapshot");
    }
  } catch (error) {
    issues.push(issue("ACTION_SPACE_INTEGRITY", `${path}.legalActionSpace`, caughtMessage(error)));
  }

  const expectedConstraints = {
    dimensions: contract.businessConstraints.dimensions,
    evaluationBoundary: contract.businessConstraints.evaluationBoundary,
    invalidActionHandling: contract.businessConstraints.invalidActionHandling,
    infeasibleActionHandling: contract.businessConstraints.infeasibleActionHandling,
    partialFeasibilityHandling: contract.businessConstraints.partialFeasibilityHandling,
    conflictHandling: contract.businessConstraints.conflictHandling,
    silentModificationForbidden: contract.businessConstraints.silentModificationForbidden,
  };
  if (stableEvaluationJson(input.constraints) !== stableEvaluationJson(expectedConstraints)) {
    issues.push(issue("CONSTRAINT_INTEGRITY", `${path}.constraints`, "operator constraints differ from the frozen evaluation contract"));
  }
  if (input.provenance.evaluationContractFingerprint !== contract.contractFingerprint ||
    input.provenance.evaluationContractVersion !== contract.contractVersion ||
    input.provenance.actionOntologyVersion !== contract.actionSpace.ontologySchemaVersion) {
    issues.push(issue("PROVENANCE_INTEGRITY", `${path}.provenance`, "canonical input provenance differs from the recomputed contract or Action Ontology binding"));
  }

  return {
    issues,
    inputFingerprint: canonicalInputFingerprint(input),
    ...(observationFingerprint === undefined ? {} : { observationFingerprint }),
    ...(availabilityFingerprint === undefined ? {} : { availabilityFingerprint }),
  };
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
    issues.push(...validateCanonicalInputIntegrity(input, contract, opportunity, availability).issues);
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
