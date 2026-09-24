import { describe, expect, it } from "vitest";
import { googleBudgetUp2000, reduceSkuPrice899To849 } from "../../src/action_translation/fixtures.js";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, invokeOperatorAtDecision, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import { canonicalInputFingerprint, canonicalOperatorDecisionFingerprint, ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import {
  baselineValidationCaseFingerprint,
  canonicalReplaySchemaFingerprint,
  canonicalPolicyDecisionFingerprint,
  createRecordedDecisionArtifact,
  runBaselineValidationCase,
  runBaselineValidationSuite,
  stableBaselineConformanceReportJson,
  type BaselineValidationCase,
  type ExecutableConformanceProbe,
} from "../../src/validation/index.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
const opportunity = createFixedIntervalDecisionOpportunity(contract, "2026-10-01T00:00:00.000Z", 0);
const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));

function probe(checkId: ExecutableConformanceProbe["checkId"], caseId: string, expectation: ExecutableConformanceProbe["expectation"]): ExecutableConformanceProbe {
  const before = expectation === "multiple_actions" ? [googleBudgetUp2000, reduceSkuPrice899To849] : [];
  const after = expectation === "different" ? [googleBudgetUp2000] : before;
  return {
    probeId: `probe:${checkId}`,
    checkId,
    operatorId: DO_NOTHING_OPERATOR.metadata.operatorId,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, DO_NOTHING_OPERATOR.metadata.operatorId),
    expectation,
    execute: () => ({ beforeActions: before, afterActions: after }),
  };
}

function passingCase(caseId = "case-a"): BaselineValidationCase {
  const operator = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
  const decision = operator.decide(input);
  const decisionFp = canonicalOperatorDecisionFingerprint(decision);
  const sample = (sampleId: string) => ({
    sampleId,
    canonicalInputFingerprint: canonicalInputFingerprint(input),
    operatorFingerprint: operator.metadata.implementationFingerprint,
    configurationFingerprint: operator.metadata.configurationFingerprint,
    seedBindingFingerprint: evaluationFingerprint({ seed: 1 }),
    actions: decision.actions,
    decisionEnvelope: decision,
  });
  const isolationSide = (witness: number) => ({
    visibleInputFingerprint: canonicalInputFingerprint(input),
    witnessFingerprint: evaluationFingerprint({ witness }),
    decisionFingerprint: canonicalPolicyDecisionFingerprint([]),
    actions: [],
  });
  const evaluated = invokeOperatorAtDecision(contract, DO_NOTHING_OPERATOR, opportunity, observation, availability);
  const disposition = { contract, opportunity, availability, attempts: [] };
  const replay = createRecordedDecisionArtifact(operator, input, decision, {
    constraintFingerprint: evaluationFingerprint(input.constraints),
    schemaFingerprint: canonicalReplaySchemaFingerprint(),
    seedBinding: { seed: 1 },
    seedFingerprint: evaluationFingerprint({ seed: 1 }),
  });
  return {
    caseId,
    operator: DO_NOTHING_OPERATOR,
    evidence: {
      determinism: [sample("a"), sample("b")],
      seedReproducibility: [
        { sampleId: "a", seedSetFingerprint: evaluationFingerprint({ seed: 1 }), canonicalInputFingerprint: canonicalInputFingerprint(input), operatorFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, runFingerprint: decisionFp },
        { sampleId: "b", seedSetFingerprint: evaluationFingerprint({ seed: 1 }), canonicalInputFingerprint: canonicalInputFingerprint(input), operatorFingerprint: operator.metadata.implementationFingerprint, configurationFingerprint: operator.metadata.configurationFingerprint, runFingerprint: decisionFp },
      ],
      hiddenTruthIsolation: [{ pairId: "hidden", baseline: isolationSide(1), variant: isolationSide(2) }],
      futureInformationIsolation: [{ pairId: "future", baseline: isolationSide(3), variant: isolationSide(4) }],
      temporalBoundary: { decisionTimestamp: opportunity.at, observations: [] },
      lookbackWindow: { startInclusive: "2026-09-01T00:00:00.000Z", endInclusive: opportunity.at, decisionTimestamp: opportunity.at, observations: [] },
      actionConformance: { contract, opportunity, availability, canonicalInput: input, operatorMetadata: operator.metadata, decisionEnvelope: decision },
      constraintConformance: disposition,
      policySemantics: probe("policy_semantics", caseId, "equal"),
      permittedInformationSensitivity: probe("permitted_information_sensitivity", caseId, "different"),
      prohibitedInformationInvariance: [{ pairId: "prohibited", baseline: isolationSide(5), variant: isolationSide(6) }],
      tieBreaking: probe("tie_breaking", caseId, "equal"),
      missingDataBehavior: probe("missing_data_behavior", caseId, "equal"),
      zeroActionBehavior: probe("zero_action_behavior", caseId, "zero_actions"),
      multiActionBehavior: probe("multi_action_behavior", caseId, "multiple_actions"),
      artifactReplay: replay,
      provenanceIntegrity: [{ label: "input", value: input, recordedFingerprint: evaluationFingerprint(input) }],
      uncontrolledRandomness: [sample("a"), sample("b"), sample("c")],
      operatorIsolation: { canonicalInputBefore: input, canonicalInputAfter: input, operatorMetadata: operator.metadata, decisionEnvelope: decision, evaluatedDecision: evaluated, dispositionEvidence: disposition },
    },
  };
}

describe("baseline validation harness", () => {
  it("runs every focused validator and executable probe into a stable passing report", () => {
    const first = runBaselineValidationCase(passingCase());
    const second = runBaselineValidationCase(passingCase());
    expect(first.overall).toBe("PASS");
    expect(first.checks).toHaveLength(19);
    expect(stableBaselineConformanceReportJson(first)).toBe(stableBaselineConformanceReportJson(second));
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("fails closed for every missing evidence section", () => {
    const complete = passingCase();
    for (const key of Object.keys(complete.evidence)) {
      const changed: any = { ...complete, evidence: { ...complete.evidence } };
      delete changed.evidence[key];
      const report = runBaselineValidationCase(changed);
      expect(report.overall, key).toBe("FAIL");
      expect(report.checks.some((check) => check.status === "FAIL" && check.issues.some((entry) => entry.code === "MISSING_REQUIRED_EVIDENCE")), key).toBe(true);
    }
  });

  it("sorts suites by code unit and rejects duplicate operator IDs", () => {
    const a: any = passingCase("a");
    const b: any = passingCase("b");
    b.operator = { ...b.operator, metadata: { ...b.operator.metadata, operatorId: "z" } };
    for (const value of Object.values(b.evidence) as any[]) if (value?.operatorId) value.operatorId = "z";
    const reports = runBaselineValidationSuite({ cases: [b, a] });
    expect(reports.map((entry) => entry.operator.operatorId)).toEqual(["baseline.do_nothing", "z"]);
    expect(() => runBaselineValidationSuite({ cases: [a, passingCase("duplicate")] })).toThrow(/duplicate operator ID/);
  });

  it("converts operator throws, mutation attempts, and malformed probe evidence to deterministic FAIL", () => {
    const throwing: any = passingCase();
    throwing.operator = { ...throwing.operator, decide() { throw new Error("boom"); } };
    expect(runBaselineValidationCase(throwing).overall).toBe("FAIL");

    const mutating: any = passingCase();
    mutating.operator = { ...mutating.operator, decide(value: any) { value.opportunityId = "mutated"; return ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR).decide(value); } };
    expect(runBaselineValidationCase(mutating).overall).toBe("FAIL");

    const malformed: any = passingCase();
    malformed.evidence.policySemantics = { ...malformed.evidence.policySemantics, ambient: true };
    const first = runBaselineValidationCase(malformed);
    const second = runBaselineValidationCase(malformed);
    expect(first.overall).toBe("FAIL");
    expect(first).toEqual(second);
  });

  it("fails closed on unknown case and evidence fields", () => {
    const unknownEvidence: any = passingCase();
    unknownEvidence.evidence.ambient = true;
    expect(runBaselineValidationCase(unknownEvidence).overall).toBe("FAIL");

    const unknownCase: any = { ...passingCase(), ambient: true };
    expect(runBaselineValidationCase(unknownCase).overall).toBe("FAIL");
  });
});
