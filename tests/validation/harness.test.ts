import { describe, expect, it } from "vitest";
import { googleBudgetUp2000, reduceSkuPrice899To849 } from "../../src/action_translation/fixtures.js";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import {
  CANONICAL_BASELINE_EVALUATION_CONTRACT_V1,
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  createFixedIntervalDecisionOpportunity,
  evaluationFingerprint,
  stableEvaluationJson,
} from "../../src/evaluation/baseline-contract.js";
import { buildCanonicalOperatorInput, invokeOperatorAtDecision, toOperatorDecisionInput } from "../../src/evaluation/operator-evaluation.js";
import { CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION, CANONICAL_OPERATOR_INTERFACE_VERSION, canonicalInputFingerprint, canonicalOperatorDecisionFingerprint, ensureCanonicalOperatorV2, type CanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import { DO_NOTHING_OPERATOR } from "../../src/operator/do-nothing.js";
import { operatorFingerprint } from "../../src/operator/identity.js";
import {
  baselineValidationCaseFingerprint,
  canonicalReplaySchemaFingerprint,
  canonicalPolicyDecisionFingerprint,
  createRecordedDecisionArtifact,
  runBaselineValidationCase,
  runBaselineValidationSuite,
  runExecutableConformanceProbe,
  runProhibitedInformationProbe,
  stableBaselineConformanceReportJson,
  canonicalProbeDecisionFingerprint,
  declarativeProbeFingerprint,
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  type BaselineValidationCase,
  type ExecutableConformanceProbe,
  type ProhibitedInformationProbe,
} from "../../src/validation/index.js";

const contract = CANONICAL_BASELINE_EVALUATION_CONTRACT_V1;
function context(sequence: number) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, "2026-10-01T00:00:00.000Z", sequence);
  const observation = buildOperatorObservationSnapshot(contract, opportunity, []);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, []);
  const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
  return { opportunity, observation, availability, input };
}
function observedContext(value: number, start = "2026-10-01T00:00:00.000Z", withActionRule = false) {
  const opportunity = createFixedIntervalDecisionOpportunity(contract, start, 0);
  const record = { observationKey: "metric:permitted", informationClass: "observable_merchant_data" as const, sourceMinOccurredAt: "2026-09-30T00:00:00.000Z", sourceMaxOccurredAt: "2026-09-30T00:00:00.000Z", availableAt: "2026-09-30T00:00:00.000Z", sourceRef: "merchant-observations:permitted", value: { value } };
  const observation = buildOperatorObservationSnapshot(contract, opportunity, [record]);
  const availability = buildActionAvailabilitySnapshot(contract, opportunity, withActionRule ? [{ actionType: String(googleBudgetUp2000.actionType), eligibleTargets: [googleBudgetUp2000.target], parameterBounds: [], requiredPreconditionIds: [] }] : []);
  const input = buildCanonicalOperatorInput(contract, opportunity, observation, availability, toOperatorDecisionInput(opportunity, observation, availability));
  return { opportunity, observation, availability, input };
}
const baseContext = context(0);
const input = baseContext.input;
const opportunity = baseContext.opportunity;
const observation = baseContext.observation;
const availability = baseContext.availability;

const probeOperator: CanonicalOperatorV2 = (() => {
  const base = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
  const metadata = { ...base.metadata, operatorId: "test.harness-probe", operatorFamily: "advanced_decision_system" as const, implementationFingerprint: operatorFingerprint({ implementation: "harness-probe" }), configurationFingerprint: operatorFingerprint({ configuration: "harness-probe" }), adapterFingerprint: operatorFingerprint({ adapter: "harness-probe" }), legacyInterfaceVersion: null, capabilities: { ...base.metadata.capabilities, actionDomains: ["advertising" as const, "pricing" as const], maximumActionsPerDecision: 2 } };
  return { metadata, decide(value) {
    const permittedSignal = value.observation.records.some((record) => stableEvaluationJson(record.value) === stableEvaluationJson({ value: 1 }));
    const actions = value.decisionContext.sequence === 2 ? [googleBudgetUp2000, reduceSkuPrice899To849] : permittedSignal ? [googleBudgetUp2000] : [];
    return { schemaVersion: CANONICAL_OPERATOR_DECISION_SCHEMA_VERSION, actions, operatorMetadata: metadata, decisionMetadata: { interfaceVersion: CANONICAL_OPERATOR_INTERFACE_VERSION, decisionTimestamp: value.decisionTime, deterministicReplayExpected: true, randomness: { kind: "deterministic" }, canonicalActionOrdering: "ACTION_TYPE_TARGET_PARAMETERS_ACTION_ID_ASC" } };
  } };
})();

function probe(checkId: ExecutableConformanceProbe["checkId"], caseId: string, sequences: readonly number[], expectation: ExecutableConformanceProbe["expectation"]): ExecutableConformanceProbe {
  const fixtureByCheck = { policy_semantics: "missing_data", permitted_information_sensitivity: "single_action", tie_breaking: "exact_tie", missing_data_behavior: "missing_data", zero_action_behavior: "empty", multi_action_behavior: "multi_action" } as const;
  const body = {
    probeId: `probe:${checkId}`,
    checkId,
    operatorId: probeOperator.metadata.operatorId,
    configurationFingerprint: probeOperator.metadata.configurationFingerprint,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, probeOperator.metadata.operatorId),
    invocations: sequences.map((sequence) => ({ fixtureId: fixtureByCheck[checkId], canonicalInput: context(sequence).input, inputFingerprint: canonicalInputFingerprint(context(sequence).input) })),
    expectation,
  };
  return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

function sensitivityProbe(caseId: string, inputs = [observedContext(0).input, observedContext(1).input]): ExecutableConformanceProbe {
  const body = { probeId: "probe:permitted_information_sensitivity", checkId: "permitted_information_sensitivity" as const, operatorId: probeOperator.metadata.operatorId, configurationFingerprint: probeOperator.metadata.configurationFingerprint, caseFingerprint: baselineValidationCaseFingerprint(caseId, probeOperator.metadata.operatorId), invocations: inputs.map((canonicalInput) => ({ fixtureId: "single_action", canonicalInput, inputFingerprint: canonicalInputFingerprint(canonicalInput) })), expectation: { kind: "sensitive" as const } };
  return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

function prohibitedProbe(caseId: string): ProhibitedInformationProbe {
    const body = {
    probeId: "probe:prohibited_information_invariance",
    checkId: "prohibited_information_invariance",
    operatorId: probeOperator.metadata.operatorId,
    configurationFingerprint: probeOperator.metadata.configurationFingerprint,
    caseFingerprint: baselineValidationCaseFingerprint(caseId, probeOperator.metadata.operatorId),
    pairs: [{
      pairId: "prohibited-pair",
      leftFixtureId: "hidden_truth_pair",
      rightFixtureId: "future_pair",
      leftInput: input,
      rightInput: input,
      leftWitnessFingerprint: evaluationFingerprint({ witness: "left" }),
      rightWitnessFingerprint: evaluationFingerprint({ witness: "right" }),
      }],
    } satisfies Omit<ProhibitedInformationProbe, "probeFingerprint">;
    return { ...body, probeFingerprint: declarativeProbeFingerprint(body) };
}

function passingCase(caseId = "case-a"): BaselineValidationCase {
  const operator = probeOperator;
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
  const evaluated = invokeOperatorAtDecision(contract, operator, opportunity, observation, availability);
  const disposition = { contract, opportunity, availability, attempts: [] };
  const frozenSeedCase = FROZEN_BASELINE_VALIDATION_SEED_SET.cases[0]!;
  const replay = createRecordedDecisionArtifact(operator, input, decision, {
    constraintFingerprint: evaluationFingerprint(input.constraints),
    schemaFingerprint: canonicalReplaySchemaFingerprint(),
    seedCaseId: frozenSeedCase.caseId,
    seedSetVersion: FROZEN_BASELINE_VALIDATION_SEED_SET.schemaVersion,
    seedSetFingerprint: FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint,
    seeds: frozenSeedCase.seeds,
    seedFingerprint: evaluationFingerprint(frozenSeedCase.seeds),
  });
  return {
    caseId,
    operator,
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
      policySemantics: probe("policy_semantics", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] }),
      permittedInformationSensitivity: sensitivityProbe(caseId),
      prohibitedInformationInvariance: prohibitedProbe(caseId),
      tieBreaking: probe("tie_breaking", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] }),
      missingDataBehavior: probe("missing_data_behavior", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] }),
      zeroActionBehavior: probe("zero_action_behavior", caseId, [0, 0], { kind: "zero_actions" }),
      multiActionBehavior: probe("multi_action_behavior", caseId, [0, 2], { kind: "multi_action" }),
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

  it("uses real operator invocations and rejects fabricated-output probe fields", () => {
    const operator = ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR);
    const caseId = "real-do-nothing";
    const realProbe: ExecutableConformanceProbe = {
      probeId: "probe:real-do-nothing",
      checkId: "policy_semantics",
      operatorId: operator.metadata.operatorId,
      configurationFingerprint: operator.metadata.configurationFingerprint,
      caseFingerprint: baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId),
      invocations: [{ fixtureId: "missing_data", canonicalInput: input, inputFingerprint: canonicalInputFingerprint(input) }],
      expectation: { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] },
      probeFingerprint: "",
    };
    const finalized = { ...realProbe, probeFingerprint: declarativeProbeFingerprint(realProbe) };
    expect(runExecutableConformanceProbe(operator, finalized, "policy_semantics", caseId).status).toBe("PASS");
    expect(runExecutableConformanceProbe(operator, { ...finalized, returnedActions: [] }, "policy_semantics", caseId).issues.map((x) => x.code)).toContain("INVALID_PROBE_EVIDENCE");
    expect(runExecutableConformanceProbe(operator, { ...finalized, execute: () => ({ beforeActions: [] }) }, "policy_semantics", caseId).status).toBe("FAIL");
  });

  it("rejects fixture mismatch, identical sensitive inputs, stateful decisions, and mutated fingerprints", () => {
    const caseId = "probe-hardening";
    const mismatch: any = probe("tie_breaking", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] });
    mismatch.invocations[0].fixtureId = "empty";
    mismatch.probeFingerprint = declarativeProbeFingerprint(mismatch);
    expect(runExecutableConformanceProbe(probeOperator, mismatch, "tie_breaking", caseId).status).toBe("FAIL");

    const identical = probe("permitted_information_sensitivity", caseId, [0, 0], { kind: "sensitive" });
    expect(runExecutableConformanceProbe(probeOperator, identical, "permitted_information_sensitivity", caseId).status).toBe("FAIL");

    let calls = 0;
    const stateful: CanonicalOperatorV2 = { ...probeOperator, decide(value) { calls += 1; return calls % 2 === 1 ? probeOperator.decide(value) : { ...probeOperator.decide(value), actions: [googleBudgetUp2000] }; } };
    const exact = probe("policy_semantics", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] });
    expect(runExecutableConformanceProbe(stateful, exact, "policy_semantics", caseId).status).toBe("FAIL");

    const mutated: any = probe("missing_data_behavior", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] });
    mutated.expectation.expectedDecisionFingerprints[0] = evaluationFingerprint({ forged: true });
    expect(runExecutableConformanceProbe(probeOperator, mutated, "missing_data_behavior", caseId).status).toBe("FAIL");
  });

  it("requires observation-only controlled variation for sensitivity", () => {
    const caseId = "controlled-sensitivity";
    expect(runExecutableConformanceProbe(probeOperator, sensitivityProbe(caseId), "permitted_information_sensitivity", caseId).status).toBe("PASS");
    expect(runExecutableConformanceProbe(probeOperator, probe("permitted_information_sensitivity", caseId, [0, 1], { kind: "sensitive" }), "permitted_information_sensitivity", caseId).status).toBe("FAIL");
    const validControlChanges: any[] = [
      observedContext(1, "2026-10-02T00:00:00.000Z").input,
      observedContext(1, "2026-10-01T00:00:00.000Z", true).input,
    ];
    const changedConstraints: any = structuredClone(observedContext(1).input);
    changedConstraints.constraints.dimensions.push("changed");
    validControlChanges.push(changedConstraints);
    for (const changed of validControlChanges) {
      const evidence: any = sensitivityProbe(caseId, [observedContext(0).input, changed]);
      expect(runExecutableConformanceProbe(probeOperator, evidence, "permitted_information_sensitivity", caseId).status).toBe("FAIL");
    }
  });

  it("returns stable failures for malformed nested declarative probes", () => {
    const caseId = "malformed-probes";
    const executable: any = probe("policy_semantics", caseId, [0], { kind: "exact", expectedDecisionFingerprints: [canonicalProbeDecisionFingerprint([])], expectedActionFingerprints: [[]] });
    const prohibited: any = prohibitedProbe(caseId);
    const cases: Array<[any, (value: any) => any, string]> = [
      [{ ...executable, probeFingerprint: 1n }, (value) => runExecutableConformanceProbe(probeOperator, value, "policy_semantics", caseId), "INVALID_PROBE_EVIDENCE"],
      [{ ...executable, invocations: null }, (value) => runExecutableConformanceProbe(probeOperator, value, "policy_semantics", caseId), "INVALID_PROBE_EVIDENCE"],
      [{ ...executable, invocations: {} }, (value) => runExecutableConformanceProbe(probeOperator, value, "policy_semantics", caseId), "INVALID_PROBE_EVIDENCE"],
      [{ ...executable, invocations: [{ ...executable.invocations[0], extra: true }] }, (value) => runExecutableConformanceProbe(probeOperator, value, "policy_semantics", caseId), "INVALID_PROBE_INVOCATION"],
      [{ ...executable, expectation: { kind: "exact", expectedDecisionFingerprints: () => [], expectedActionFingerprints: [] } }, (value) => runExecutableConformanceProbe(probeOperator, value, "policy_semantics", caseId), "INVALID_PROBE_EVIDENCE"],
      [{ ...prohibited, probeFingerprint: 1n }, (value) => runProhibitedInformationProbe(probeOperator, value, caseId), "INVALID_PAIRED_EVIDENCE"],
      [{ ...prohibited, pairs: null }, (value) => runProhibitedInformationProbe(probeOperator, value, caseId), "INVALID_PAIRED_EVIDENCE"],
      [{ ...prohibited, pairs: {} }, (value) => runProhibitedInformationProbe(probeOperator, value, caseId), "INVALID_PAIRED_EVIDENCE"],
      [{ ...prohibited, pairs: [{ ...prohibited.pairs[0], extra: true }] }, (value) => runProhibitedInformationProbe(probeOperator, value, caseId), "INVALID_PAIRED_EVIDENCE"],
      [{ ...prohibited, pairs: [{ ...prohibited.pairs[0], leftInput: null }] }, (value) => runProhibitedInformationProbe(probeOperator, value, caseId), "INVALID_PAIRED_EVIDENCE"],
      [{ ...prohibited, pairs: [{ ...prohibited.pairs[0], leftWitnessFingerprint: () => "forged" }] }, (value) => runProhibitedInformationProbe(probeOperator, value, caseId), "INVALID_PAIRED_EVIDENCE"],
    ];
    for (const [value, run, code] of cases) {
      const first = run(value); const second = run(value);
      expect(first.status).toBe("FAIL");
      expect(first.issues.map((entry: any) => entry.code)).toEqual([code]);
      expect(first).toEqual(second);
    }
  });

  it("preserves paired-witness semantics for prohibited-information invariance", () => {
    const caseId = "paired-witness";
    const base = prohibitedProbe(caseId);
    expect(runProhibitedInformationProbe(probeOperator, base, caseId).status).toBe("PASS");

    const sameWitness: any = structuredClone(base);
    sameWitness.pairs[0].rightWitnessFingerprint = sameWitness.pairs[0].leftWitnessFingerprint;
    sameWitness.probeFingerprint = declarativeProbeFingerprint(sameWitness);
    expect(runProhibitedInformationProbe(probeOperator, sameWitness, caseId).issues.map((x) => x.code)).toContain("INVALID_PAIRED_EVIDENCE");

    const differentVisible: any = structuredClone(base);
    differentVisible.pairs[0].rightInput = context(1).input;
    differentVisible.probeFingerprint = declarativeProbeFingerprint(differentVisible);
    expect(runProhibitedInformationProbe(probeOperator, differentVisible, caseId).issues.map((x) => x.code)).toContain("INVALID_PAIRED_EVIDENCE");

    let calls = 0;
    const divergent: CanonicalOperatorV2 = { ...probeOperator, decide(value) { calls += 1; return calls % 2 === 1 ? probeOperator.decide(value) : { ...probeOperator.decide(value), actions: [googleBudgetUp2000] }; } };
    expect(runProhibitedInformationProbe(divergent, base, caseId).issues.map((x) => x.code)).toContain("PROHIBITED_INFORMATION_LEAKAGE");

    const missing: any = structuredClone(base);
    delete missing.pairs[0].leftWitnessFingerprint;
    expect(runProhibitedInformationProbe(probeOperator, missing, caseId).status).toBe("FAIL");
    expect(runProhibitedInformationProbe(probeOperator, { ...base, ambient: true }, caseId).status).toBe("FAIL");
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
    const withId = (operatorId: string, caseId: string) => {
      const value: any = passingCase(caseId);
      value.operator = { ...value.operator, metadata: { ...value.operator.metadata, operatorId } };
      return value;
    };
    const reports = runBaselineValidationSuite({ cases: [withId("é", "4"), withId("a", "2"), withId("e\u0301", "3"), withId("Z", "1")] });
    expect(reports.map((entry) => entry.operator.operatorId)).toEqual(["Z", "a", "e\u0301", "é"]);
    const a = passingCase("a");
    expect(() => runBaselineValidationSuite({ cases: [a, passingCase("duplicate")] })).toThrow(/duplicate operator ID/);
    const duplicateCase: any = withId("other.operator", "a");
    expect(() => runBaselineValidationSuite({ cases: [a, duplicateCase] })).toThrow(/duplicate case ID/);
  });

  it("converts operator throws, mutation attempts, and malformed probe evidence to deterministic FAIL", () => {
    const throwing: any = passingCase();
    let throwCount = 0;
    throwing.operator = { ...throwing.operator, decide() { throwCount += 1; throw new Error(`ambient-${throwCount}-${Date.now()}`); } };
    const thrownFirst = runBaselineValidationCase(throwing);
    const thrownSecond = runBaselineValidationCase(throwing);
    expect(thrownFirst.overall).toBe("FAIL");
    expect(stableBaselineConformanceReportJson(thrownFirst)).toBe(stableBaselineConformanceReportJson(thrownSecond));
    expect(thrownFirst.reportFingerprint).toBe(thrownSecond.reportFingerprint);

    const mutating: any = passingCase();
    mutating.operator = { ...mutating.operator, decide(value: any) { value.opportunityId = "mutated"; return ensureCanonicalOperatorV2(DO_NOTHING_OPERATOR).decide(value); } };
    expect(runBaselineValidationCase(mutating).overall).toBe("FAIL");

    const malformed: any = passingCase();
    malformed.evidence.policySemantics = { ...malformed.evidence.policySemantics, fabricatedActions: [] };
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
