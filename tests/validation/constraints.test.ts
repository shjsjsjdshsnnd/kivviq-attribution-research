import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20, pauseUnderperformingMetaCampaign } from "../../src/action_ontology/fixtures.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createEvaluationActionAttemptRecord,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, invokeOperatorAtDecision, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import { canonicalizeActionOrdering, ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import {
  validateConstraintDispositionEvidence,
  validateOperatorAuthorityBoundary,
} from "../../src/validation/index.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const start = String(increaseGoogleShoppingBudget20.timing.decisionTime);

function clone<T>(value: T): any {
  return structuredClone(value);
}

function refreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) refreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function context() {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, start, 0);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, [{
    actionType: String(increaseGoogleShoppingBudget20.actionType),
    eligibleTargets: [increaseGoogleShoppingBudget20.target],
    parameterBounds: [{ path: "parameters.operation.factor", minInclusive: 1, maxInclusive: 2 }],
    requiredPreconditionIds: ["campaign_exists"],
  }]);
  const canonicalInput = buildCanonicalOperatorInput(
    contract,
    opportunity,
    observation,
    availability,
    toOperatorDecisionInput(opportunity, observation, availability),
  );
  return { opportunity, observation, availability, canonicalInput };
}

function multiActionContext() {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, start, 0);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, [
    {
      actionType: String(increaseGoogleShoppingBudget20.actionType),
      eligibleTargets: [increaseGoogleShoppingBudget20.target],
      parameterBounds: [{ path: "parameters.operation.factor", minInclusive: 1, maxInclusive: 2 }],
      requiredPreconditionIds: ["campaign_exists"],
    },
    {
      actionType: String(pauseUnderperformingMetaCampaign.actionType),
      eligibleTargets: [pauseUnderperformingMetaCampaign.target],
      parameterBounds: [],
      requiredPreconditionIds: [],
    },
  ]);
  return { opportunity, observation, availability };
}

function modifiedAction() {
  const modified = clone(increaseGoogleShoppingBudget20);
  modified.actionId = "action_google_shopping_budget_multiply_110";
  modified.parameters.operation.factor = 1.1;
  return modified;
}

function dispositionEvidence() {
  const { opportunity, availability } = context();
  const rejectedIssues = [{
    kind: "INFEASIBLE" as const,
    constraintRef: "budget.available_minor",
    reason: "insufficient budget",
  }];
  const partialIssues = [{
    kind: "PARTIALLY_FEASIBLE" as const,
    constraintRef: "budget.available_minor",
    reason: "only a smaller increase is feasible",
  }];
  const modified = modifiedAction();
  return {
    contract,
    opportunity,
    availability,
    attempts: [
      {
        rawProposal: increaseGoogleShoppingBudget20,
        constraintIssues: [],
        explicitModifiedAction: null,
        attemptRecord: createEvaluationActionAttemptRecord(contract, opportunity, availability, increaseGoogleShoppingBudget20),
      },
      {
        rawProposal: increaseGoogleShoppingBudget20,
        constraintIssues: rejectedIssues,
        explicitModifiedAction: null,
        attemptRecord: createEvaluationActionAttemptRecord(contract, opportunity, availability, increaseGoogleShoppingBudget20, rejectedIssues),
      },
      {
        rawProposal: increaseGoogleShoppingBudget20,
        constraintIssues: partialIssues,
        explicitModifiedAction: modified,
        attemptRecord: createEvaluationActionAttemptRecord(contract, opportunity, availability, increaseGoogleShoppingBudget20, partialIssues, modified),
      },
    ],
  };
}

describe("constraint disposition conformance", () => {
  it("accepts deterministic empty evidence for a zero-Action decision", () => {
    const { opportunity, availability } = context();
    const evidence = { contract, opportunity, availability, attempts: [] };
    const result = validateConstraintDispositionEvidence(evidence);
    expect(result.status).toBe("PASS");
    expect(validateConstraintDispositionEvidence(clone(evidence))).toEqual(result);
  });

  it("uses canonical Action ordering rather than lexical fingerprint ordering", () => {
    const { opportunity, availability } = multiActionContext();
    const actions = canonicalizeActionOrdering([
      pauseUnderperformingMetaCampaign,
      increaseGoogleShoppingBudget20,
    ]);
    const attempts = actions.map((action) => ({
      rawProposal: action,
      constraintIssues: [],
      explicitModifiedAction: null,
      attemptRecord: createEvaluationActionAttemptRecord(contract, opportunity, availability, action),
    }));
    const evidence = { contract, opportunity, availability, attempts };
    expect(validateConstraintDispositionEvidence(evidence).status).toBe("PASS");
    expect(validateConstraintDispositionEvidence({ ...evidence, attempts: [...attempts].reverse() }).issues).toContainEqual(
      expect.objectContaining({ code: "UNSTABLE_ATTEMPT_ORDER" }),
    );
  });
  it("validates ACCEPTED, REJECTED, and deterministic MODIFIED evaluator records", () => {
    const evidence = dispositionEvidence();
    const result = validateConstraintDispositionEvidence(evidence);
    expect(result.status).toBe("PASS");
    expect(evidence.attempts.map((entry) => entry.attemptRecord.constraintDisposition?.status)).toEqual([
      "ACCEPTED", "REJECTED", "MODIFIED",
    ]);
    expect(Object.isFrozen(result)).toBe(true);

    const repeated = dispositionEvidence();
    expect(repeated.attempts[2]!.attemptRecord.constraintDisposition).toEqual(
      evidence.attempts[2]!.attemptRecord.constraintDisposition,
    );
    expect(validateConstraintDispositionEvidence(repeated)).toEqual(result);
  });

  it("rejects tampered proposed and executed fingerprints and disposition semantics", () => {
    const proposed = dispositionEvidence();
    proposed.attempts[0]!.attemptRecord = clone(proposed.attempts[0]!.attemptRecord);
    (proposed.attempts[0]!.attemptRecord as any).constraintDisposition.proposedActionFingerprint = "fnv1a64:0000000000000000";
    expect(validateConstraintDispositionEvidence(proposed).issues).toContainEqual(
      expect.objectContaining({ code: "DISPOSITION_TAMPERED", path: "evidence.attempts[0].attemptRecord" }),
    );

    const executed = dispositionEvidence();
    executed.attempts[2]!.attemptRecord = clone(executed.attempts[2]!.attemptRecord);
    (executed.attempts[2]!.attemptRecord as any).constraintDisposition.executedActionFingerprint = "fnv1a64:0000000000000000";
    expect(validateConstraintDispositionEvidence(executed).issues).toContainEqual(
      expect.objectContaining({ code: "DISPOSITION_TAMPERED", path: "evidence.attempts[2].attemptRecord" }),
    );
  });

  it("rejects unknown fields and malformed evidence", () => {
    expect(validateConstraintDispositionEvidence({ ...dispositionEvidence(), extra: true }).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_EVIDENCE_SHAPE" }),
    );
    const issueWithExtra = dispositionEvidence();
    (issueWithExtra.attempts[1]!.constraintIssues[0] as any).extra = true;
    expect(validateConstraintDispositionEvidence(issueWithExtra).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_ATTEMPT_EVIDENCE" }),
    );
    expect(validateConstraintDispositionEvidence({ attempts: "bad" }).status).toBe("FAIL");
  });

  it("rejects unknown constraint issue kinds before disposition resolution", () => {
    const evidence = dispositionEvidence();
    const attempt = evidence.attempts[1]!;
    attempt.constraintIssues = [
      ...attempt.constraintIssues,
      { kind: "UNKNOWN", constraintRef: "unknown", reason: "must fail closed" } as any,
    ];
    attempt.attemptRecord = createEvaluationActionAttemptRecord(
      contract,
      evidence.opportunity,
      evidence.availability,
      attempt.rawProposal,
      attempt.constraintIssues as any,
    );
    expect(validateConstraintDispositionEvidence(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_CONSTRAINT_ISSUE_KIND" }),
    );
  });

  it("rejects a MODIFIED disposition whose explicit Action is semantically unchanged", () => {
    const evidence = dispositionEvidence();
    const partial = [{
      kind: "PARTIALLY_FEASIBLE" as const,
      constraintRef: "budget.available_minor",
      reason: "replacement is required",
    }];
    evidence.attempts = [{
      rawProposal: increaseGoogleShoppingBudget20,
      constraintIssues: partial,
      explicitModifiedAction: increaseGoogleShoppingBudget20,
      attemptRecord: createEvaluationActionAttemptRecord(
        contract,
        evidence.opportunity,
        evidence.availability,
        increaseGoogleShoppingBudget20,
        partial,
        increaseGoogleShoppingBudget20,
      ),
    }];
    expect(validateConstraintDispositionEvidence(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "MODIFIED_ACTION_UNCHANGED" }),
    );
  });
});

describe("operator authority boundary", () => {
  function validAuthorityEvidence() {
    const { opportunity, observation, availability, canonicalInput } = context();
    const operator = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    const evaluatedDecision = invokeOperatorAtDecision(
      contract,
      operator,
      opportunity,
      observation,
      availability,
    );
    return {
      canonicalInputBefore: canonicalInput,
      canonicalInputAfter: canonicalInput,
      operatorMetadata: operator.metadata,
      evaluatedDecision,
      dispositionEvidence: {
        contract,
        opportunity,
        availability,
        attempts: [],
      },
    };
  }

  it("passes an immutable input with evaluator-created dispositions and no direct authority", () => {
    const result = validateOperatorAuthorityBoundary(validAuthorityEvidence());
    expect(result.status).toBe("PASS");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["direct execution", (e: any) => { e.executedActions = []; }],
    ["simulator mutation", (e: any) => { e.simulatorStateMutation = {}; }],
    ["constraint bypass", (e: any) => { e.constraintBypass = true; }],
  ])("rejects structurally forbidden authority claim: %s", (_label, mutate) => {
    const evidence = clone(validAuthorityEvidence());
    mutate(evidence);
    refreeze(evidence.canonicalInputBefore);
    refreeze(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_EVIDENCE_SHAPE" }),
    );
  });

  it("rejects missing and tampered evaluator invocation audits", () => {
    const missing = clone(validAuthorityEvidence());
    delete missing.evaluatedDecision;
    expect(validateOperatorAuthorityBoundary(missing).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_EVIDENCE_SHAPE" }),
    );

    const tampered = clone(validAuthorityEvidence());
    tampered.evaluatedDecision.invocation.inputFingerprint = "fnv1a64:0000000000000000";
    refreeze(tampered.canonicalInputBefore);
    refreeze(tampered.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(tampered).issues).toContainEqual(
      expect.objectContaining({ code: "INVOCATION_AUDIT_TAMPERED" }),
    );
  });

  it.each([
    ["interface", (audit: any) => { audit.interfaceVersion = "99.0.0"; }],
    ["operator identity", (audit: any) => { audit.operatorId = "other"; }],
    ["configuration", (audit: any) => { audit.configurationFingerprint = "fnv1a64:0000000000000000"; }],
    ["output", (audit: any) => { audit.outputFingerprint = "fnv1a64:0000000000000000"; }],
    ["decision timestamp", (audit: any) => { audit.decisionTime = "2027-01-01T00:00:00.000Z"; }],
  ])("cross-binds invocation %s", (_label, mutate) => {
    const evidence = clone(validAuthorityEvidence());
    mutate(evidence.evaluatedDecision.invocation);
    refreeze(evidence.canonicalInputBefore);
    refreeze(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "INVOCATION_AUDIT_TAMPERED" }),
    );
  });

  it("rejects a decision record observation body that only preserves the stored fingerprint", () => {
    const evidence = clone(validAuthorityEvidence());
    evidence.evaluatedDecision.decisionRecord.observation.records = [{
      observationKey: "tampered",
      informationClass: "observable_merchant_data",
      sourceMinOccurredAt: start,
      sourceMaxOccurredAt: start,
      availableAt: start,
      sourceRef: "tampered",
      value: 1,
    }];
    refreeze(evidence.canonicalInputBefore);
    refreeze(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "EVALUATED_DECISION_MISMATCH" }),
    );
  });

  it("rejects an equally pre-tampered, refrozen legal Action space with recomputed caller fingerprints", () => {
    const evidence = clone(validAuthorityEvidence());
    const input = evidence.canonicalInputBefore;
    input.legalActionSpace.rules[0].parameterBounds[0].maxInclusive = 999;
    input.provenance.legalActionSpaceFingerprint = evaluationFingerprint({
      opportunityId: input.opportunityId,
      rules: input.legalActionSpace.rules,
      mutualExclusionGroups: input.legalActionSpace.mutualExclusionGroups,
    });
    refreeze(input);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "ACTION_SPACE_INTEGRITY" }),
    );
  });

  it("rejects an equally pre-tampered, refrozen constraint policy with recomputed caller fingerprints", () => {
    const evidence = clone(validAuthorityEvidence());
    const input = evidence.canonicalInputBefore;
    input.constraints.dimensions = input.constraints.dimensions.slice(1);
    refreeze(input);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "CONSTRAINT_INTEGRITY" }),
    );
  });

  it("cross-binds disposition availability to the same canonical input", () => {
    const evidence = clone(validAuthorityEvidence());
    evidence.dispositionEvidence.availability = {
      ...evidence.dispositionEvidence.availability,
      availabilityFingerprint: "fnv1a64:0000000000000000",
    };
    refreeze(evidence.canonicalInputBefore);
    refreeze(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "ACTION_SPACE_INTEGRITY" }),
    );
  });

  it("rejects mismatched evaluator disposition records and unknown fields", () => {
    const tampered = validAuthorityEvidence();
    const mismatched = clone(tampered);
    mismatched.dispositionEvidence.attempts = dispositionEvidence().attempts;
    refreeze(mismatched.canonicalInputBefore);
    refreeze(mismatched.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(mismatched).issues).toContainEqual(
      expect.objectContaining({ code: "EVALUATED_DECISION_MISMATCH" }),
    );
    expect(validateOperatorAuthorityBoundary({ ...tampered, extra: true }).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_EVIDENCE_SHAPE" }),
    );
  });

  it("returns deterministic FAIL for deeply frozen cyclic evidence", () => {
    const evidence = validAuthorityEvidence() as any;
    const cycle: any = {};
    cycle.self = cycle;
    Object.freeze(cycle);
    evidence.dispositionEvidence.contract = cycle;
    const result = validateOperatorAuthorityBoundary(evidence);
    expect(result.status).toBe("FAIL");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_JSON_EVIDENCE" }));
  });
});
