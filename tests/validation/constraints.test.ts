import { describe, expect, it } from "vitest";
import { increaseGoogleShoppingBudget20 } from "../../src/action_ontology/fixtures.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createEvaluationActionAttemptRecord,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
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

  it("rejects unstable attempt ordering, unknown fields, and malformed evidence", () => {
    const unstable = dispositionEvidence();
    unstable.attempts = [...unstable.attempts].reverse();
    expect(validateConstraintDispositionEvidence(unstable).issues).toContainEqual(
      expect.objectContaining({ code: "UNSTABLE_ATTEMPT_ORDER", path: "evidence.attempts" }),
    );

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
    const { canonicalInput } = context();
    const constraintsFingerprint = evaluationFingerprint(canonicalInput.constraints);
    return {
      canonicalInputBefore: canonicalInput,
      canonicalInputAfter: canonicalInput,
      inputFingerprintBefore: evaluationFingerprint(canonicalInput),
      inputFingerprintAfter: evaluationFingerprint(canonicalInput),
      observationFingerprintBefore: canonicalInput.provenance.observationFingerprint,
      observationFingerprintAfter: canonicalInput.provenance.observationFingerprint,
      legalActionSpaceFingerprintBefore: canonicalInput.provenance.legalActionSpaceFingerprint,
      legalActionSpaceFingerprintAfter: canonicalInput.provenance.legalActionSpaceFingerprint,
      constraintsFingerprintBefore: constraintsFingerprint,
      constraintsFingerprintAfter: constraintsFingerprint,
      dispositionEvidence: dispositionEvidence(),
      dispositionEvidenceFingerprint: evaluationFingerprint(dispositionEvidence()),
      dispositionCreatedByEvaluator: true,
      operatorExecutedActions: false,
      operatorMutatedSimulatorState: false,
    };
  }

  it("passes an immutable input with evaluator-created dispositions and no direct authority", () => {
    const result = validateOperatorAuthorityBoundary(validAuthorityEvidence());
    expect(result.status).toBe("PASS");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["direct execution", "DIRECT_EXECUTION_CLAIM", (e: any) => { e.operatorExecutedActions = true; }],
    ["simulator mutation", "SIMULATOR_MUTATION_CLAIM", (e: any) => { e.operatorMutatedSimulatorState = true; }],
    ["evaluator bypass", "EVALUATOR_BYPASS", (e: any) => { e.dispositionCreatedByEvaluator = false; }],
  ])("fails authority violation: %s", (_label, code, mutate) => {
    const evidence = clone(validAuthorityEvidence());
    mutate(evidence);
    refreeze(evidence.canonicalInputBefore);
    refreeze(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code }),
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
    evidence.legalActionSpaceFingerprintBefore = evidence.canonicalInputBefore.provenance.legalActionSpaceFingerprint;
    evidence.legalActionSpaceFingerprintAfter = evidence.canonicalInputAfter.provenance.legalActionSpaceFingerprint;
    evidence.inputFingerprintBefore = evaluationFingerprint(evidence.canonicalInputBefore);
    evidence.inputFingerprintAfter = evaluationFingerprint(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "ACTION_SPACE_INTEGRITY" }),
    );
  });

  it("rejects an equally pre-tampered, refrozen constraint policy with recomputed caller fingerprints", () => {
    const evidence = clone(validAuthorityEvidence());
    const input = evidence.canonicalInputBefore;
    input.constraints.dimensions = input.constraints.dimensions.slice(1);
    refreeze(input);
    evidence.constraintsFingerprintBefore = evaluationFingerprint(evidence.canonicalInputBefore.constraints);
    evidence.constraintsFingerprintAfter = evaluationFingerprint(evidence.canonicalInputAfter.constraints);
    evidence.inputFingerprintBefore = evaluationFingerprint(evidence.canonicalInputBefore);
    evidence.inputFingerprintAfter = evaluationFingerprint(evidence.canonicalInputAfter);
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
    evidence.dispositionEvidenceFingerprint = evaluationFingerprint(evidence.dispositionEvidence);
    refreeze(evidence.canonicalInputBefore);
    refreeze(evidence.canonicalInputAfter);
    expect(validateOperatorAuthorityBoundary(evidence).issues).toContainEqual(
      expect.objectContaining({ code: "ACTION_SPACE_INTEGRITY" }),
    );
  });

  it("rejects disposition fingerprint tampering and unknown fields", () => {
    const tampered = validAuthorityEvidence();
    const result = validateOperatorAuthorityBoundary({
      ...tampered,
      dispositionEvidenceFingerprint: "fnv1a64:0000000000000000",
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "DISPOSITION_EVIDENCE_TAMPERED" }));
    expect(validateOperatorAuthorityBoundary({ ...tampered, extra: true }).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_EVIDENCE_SHAPE" }),
    );
  });
});
