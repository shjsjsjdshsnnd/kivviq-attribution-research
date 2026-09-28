import { describe, expect, it } from "vitest";
import { evaluationFingerprint } from "../../src/evaluation/baseline-contract.js";
import { canonicalInputFingerprint, ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
import { declarativeProbeFingerprint, runBaselineValidationCase, runBaselineValidationSuite, stableBaselineConformanceReportJson } from "../../src/validation/index.js";
import { ALL_BASELINE_VALIDATION_CASES, FROZEN_BASELINE_OPERATORS, FROZEN_BASELINE_OPERATOR_IDS, FROZEN_POLICY_ACTION_FINGERPRINTS, createCompleteBaselineValidationCase } from "./helpers.js";

describe("all frozen baseline validation coverage", () => {
  it("registers every frozen baseline exactly once in frozen order", () => {
    expect(ALL_BASELINE_VALIDATION_CASES).toHaveLength(27);
    expect(ALL_BASELINE_VALIDATION_CASES.map((entry) => entry.operator.metadata.operatorId)).toEqual(
      FROZEN_BASELINE_OPERATOR_IDS,
    );
    expect(new Set(FROZEN_BASELINE_OPERATOR_IDS)).toHaveLength(27);
  });

  it("runs all 27 complete real-operator cases to stable PASS reports", () => {
    const first = runBaselineValidationSuite({ cases: ALL_BASELINE_VALIDATION_CASES });
    const second = runBaselineValidationSuite({ cases: ALL_BASELINE_VALIDATION_CASES });
    expect(first).toHaveLength(27);
    const failures = first.flatMap((report) => report.checks
      .filter((check) => check.status === "FAIL")
      .map((check) => `${report.operator.operatorId}:${check.checkId}:${check.issues.map((issue) => issue.code).join(",")}`));
    expect(failures).toEqual([]);
    expect(first.every((report) => report.checks.length === 19)).toBe(true);
    expect(first.every((report) =>
      /^fnv1a64:[0-9a-f]{16}$/.test(report.evidenceFingerprint) &&
      /^fnv1a64:[0-9a-f]{16}$/.test(report.reportFingerprint) &&
      report.checks.every((check) => check.evidenceFingerprints.every(
        (fingerprint) => /^fnv1a64:[0-9a-f]{16}$/.test(fingerprint),
      )),
    )).toBe(true);
    expect(first.map(stableBaselineConformanceReportJson)).toEqual(
      second.map(stableBaselineConformanceReportJson),
    );
  }, 15_000);

  it("rejects invariant permitted-information evidence without controlled observation variation", () => {
    const complete = ALL_BASELINE_VALIDATION_CASES[2]!;
    const probe = complete.evidence.permittedInformationSensitivity;
    const { probeFingerprint: _omitted, ...probeBody } = probe;
    const incompleteProbe = { ...probeBody, invocations: [probe.invocations[0]!, probe.invocations[0]!] };
    const incomplete = {
      ...complete,
      evidence: {
        ...complete.evidence,
        permittedInformationSensitivity: { ...incompleteProbe, probeFingerprint: declarativeProbeFingerprint(incompleteProbe) },
      },
    };
    const check = runBaselineValidationCase(incomplete).checks.find(
      (entry) => entry.checkId === "permitted_information_sensitivity",
    );
    expect(check?.status).toBe("FAIL");
  });

  it("rejects shortcut evidence across policy, sensitivity, witnesses, and seeds", () => {
    const nonEmptyPolicies = ALL_BASELINE_VALIDATION_CASES.filter((entry) => {
      const expectation = entry.evidence.policySemantics.expectation;
      return expectation.kind === "exact" && expectation.expectedActionFingerprints[0]!.length > 0;
    });
    expect(nonEmptyPolicies.length).toBeGreaterThan(20);

    for (const entry of ALL_BASELINE_VALIDATION_CASES) {
      const id = entry.operator.metadata.operatorId;
      const policy = entry.evidence.policySemantics.expectation;
      expect(policy.kind).toBe("exact");
      if (policy.kind === "exact") expect(policy.expectedActionFingerprints[0]).toBe(FROZEN_POLICY_ACTION_FINGERPRINTS[id]);

      const sensitivity = entry.evidence.permittedInformationSensitivity.expectation;
      if (!["baseline.do_nothing", "baseline.inventory.no_inventory_aware_intervention"].includes(id)) {
        expect(sensitivity.kind, id).toBe("sensitive");
      }

      const pair = entry.evidence.prohibitedInformationInvariance.pairs[0]!;
      const witnessKeys = Object.keys(pair.leftWitness);
      expect(witnessKeys).toEqual(Object.keys(pair.rightWitness));
      expect(witnessKeys.some((key) => ["caseId", "kind", "witness"].includes(key))).toBe(false);
      const requiredWitnessKey = id.startsWith("baseline.advertising.") ? "hiddenIncrementalRoas"
        : id.startsWith("baseline.inventory.") ? "futureDemandUnits"
          : id.startsWith("baseline.pricing.") || id.startsWith("baseline.promotion.") ? "marginMinor"
            : id.startsWith("baseline.merchandising.") ? "futureConversionBasisPoints"
              : id.startsWith("baseline.greedy.") ? "futureContributionMinor"
                : id.startsWith("baseline.flawed.") ? "clvMinor"
                  : "causalPolicyEffectMinor";
      expect(witnessKeys, id).toContain(requiredWitnessKey);
      expect(pair.leftWitnessFingerprint).not.toBe(pair.rightWitnessFingerprint);
      for (const isolation of [entry.evidence.hiddenTruthIsolation, entry.evidence.futureInformationIsolation]) {
        const declared = isolation.pairs[0]!;
        expect(declared.canonicalInputFingerprint).toBe(isolation.primaryInputFingerprint);
        expect(declared.baselineWitnessFingerprint).toBe(evaluationFingerprint(declared.baselineWitness));
        expect(declared.variantWitnessFingerprint).toBe(evaluationFingerprint(declared.variantWitness));
        for (const witness of [declared.baselineWitness, declared.variantWitness]) expect(Object.keys(witness).some((key) => ["caseId", "kind", "witness"].includes(key))).toBe(false);
      }

      const seedBindings = entry.evidence.provenanceIntegrity.filter((evidence) => evidence.label.startsWith("seed-binding:"));
      expect(seedBindings).toHaveLength(2);
      expect(new Set(seedBindings.map((evidence) => evidence.recordedFingerprint)).size).toBe(2);
      const bindingFingerprints = seedBindings.map((evidence) => {
        const value = evidence.value as { seedCaseId: string; seeds: unknown; seedBindingFingerprint: string };
        expect(value.seedBindingFingerprint).toBe(evaluationFingerprint({ seedCaseId: value.seedCaseId, seeds: value.seeds }));
        return value.seedBindingFingerprint;
      });
      expect(new Set(bindingFingerprints).size).toBe(2);
      expect(new Set(entry.evidence.seedReproducibility.seedCases.map((sample) => sample.seedCaseId))).toEqual(new Set(seedBindings.map((evidence) => (evidence.value as { seedCaseId: string }).seedCaseId)));
      expect(new Set(entry.evidence.seedReproducibility.seedCases.map((sample) => sample.seedBindingFingerprint))).toEqual(new Set(bindingFingerprints));
      expect(new Set(entry.evidence.seedReproducibility.seedCases.map((sample) => `${sample.seedCaseId}:${sample.seedBindingFingerprint}`))).toEqual(new Set(seedBindings.map((evidence) => {
        const value = evidence.value as { seedCaseId: string; seedBindingFingerprint: string };
        return `${value.seedCaseId}:${value.seedBindingFingerprint}`;
      })));
      if (ensureCanonicalOperatorV2(entry.operator).metadata.capabilities.maximumActionsPerDecision > 0) {
        expect(entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.legalActionSpace.rules.length, id).toBeGreaterThan(0);
      }
      const policyInput = entry.evidence.policySemantics.invocations[0]!.canonicalInput;
      const primaryInputFingerprint = entry.evidence.policySemantics.primaryInputFingerprint;
      expect(primaryInputFingerprint, id).toBe(entry.evidence.policySemantics.invocations[0]!.inputFingerprint);
      expect(primaryInputFingerprint, id).toBe(canonicalInputFingerprint(entry.evidence.actionConformance.canonicalInput));
      expect(primaryInputFingerprint, id).toBe(entry.evidence.determinism.canonicalInputFingerprint);
      expect(primaryInputFingerprint, id).toBe(entry.evidence.uncontrolledRandomness.canonicalInputFingerprint);
      expect(primaryInputFingerprint, id).toBe(entry.evidence.seedReproducibility.baseCanonicalInputFingerprint);
      expect(primaryInputFingerprint, id).toBe(entry.evidence.artifactReplay.provenance.canonicalInputFingerprint);
      expect(primaryInputFingerprint, id).toBe(canonicalInputFingerprint(entry.evidence.operatorIsolation.canonicalInputBefore));
      expect(primaryInputFingerprint, id).toBe(canonicalInputFingerprint(entry.evidence.operatorIsolation.canonicalInputAfter));
      expect(entry.evidence.temporalBoundary.observationFingerprint).toBe(policyInput.provenance.observationFingerprint);
      expect(entry.evidence.lookbackWindow.observationFingerprint).toBe(policyInput.provenance.observationFingerprint);
      if (policyInput.observation.records.length > 0) {
        expect(entry.evidence.temporalBoundary.observations.length, id).toBeGreaterThan(0);
        expect(entry.evidence.lookbackWindow.observations.length, id).toBeGreaterThan(0);
        const sourceMinima = policyInput.observation.records.map((record) => record.sourceMinOccurredAt);
        const sourceMaxima = policyInput.observation.records.map((record) => record.sourceMaxOccurredAt);
        const expectedStart = sourceMinima.reduce((earliest, timestamp) => Date.parse(timestamp) < Date.parse(earliest) ? timestamp : earliest);
        expect(entry.evidence.lookbackWindow.startInclusive, id).toBe(expectedStart);
        expect(entry.evidence.lookbackWindow.endInclusive, id).toBe(policyInput.decisionTime);
        expect(entry.evidence.temporalBoundary.decisionTimestamp, id).toBe(policyInput.decisionTime);
        expect(new Set(entry.evidence.temporalBoundary.observations.map((observation) => observation.occurredAt)), id).toEqual(new Set(sourceMaxima));
        expect(new Set(entry.evidence.lookbackWindow.observations.map((observation) => observation.occurredAt)), id).toEqual(new Set([...sourceMinima, ...sourceMaxima]));
        for (const temporal of [...entry.evidence.temporalBoundary.observations, ...entry.evidence.lookbackWindow.observations]) {
          const payload = temporal.payload as { observationFingerprint: string; data: unknown; dataFingerprint: string };
          expect(payload.observationFingerprint).toBe(policyInput.provenance.observationFingerprint);
          expect(payload.dataFingerprint).toBe(evaluationFingerprint(payload.data));
        }
      }
    }
  });

  it("keeps frozen policy expectations independent from the live operator decision", () => {
    const original = FROZEN_BASELINE_OPERATORS[2]!;
    const altered = { metadata: original.metadata, decide: (_input: Parameters<typeof original.decide>[0]) => ({ actions: [] }) };
    const validationCase = createCompleteBaselineValidationCase(altered, 2);
    const expectation = validationCase.evidence.policySemantics.expectation;
    expect(expectation.kind).toBe("exact");
    if (expectation.kind !== "exact") return;
    expect(expectation.expectedActionFingerprints[0]).toBe(FROZEN_POLICY_ACTION_FINGERPRINTS[original.metadata.operatorId]);
    expect(expectation.expectedActionFingerprints[0]).not.toEqual([]);
    expect(altered.decide(validationCase.evidence.policySemantics.invocations[0]!.canonicalInput).actions).toEqual([]);
  });

  it("builds determinism, seed, leakage, and randomness evidence from fresh real invocations", () => {
    const original = FROZEN_BASELINE_OPERATORS[2]!;
    let realCalls = 0;
    const counting = { ...original, decide(input: Parameters<typeof original.decide>[0]) { realCalls += 1; return original.decide(input); } };
    const validationCase = createCompleteBaselineValidationCase(counting, 2);
    expect(Object.keys(validationCase.evidence.determinism)).toEqual(["operatorBinding", "canonicalInput", "canonicalInputFingerprint"]);
    expect(Object.keys(validationCase.evidence.uncontrolledRandomness)).toEqual(["operatorBinding", "canonicalInput", "canonicalInputFingerprint"]);
    expect(Object.keys(validationCase.evidence.seedReproducibility)).toEqual(["operatorBinding", "baseCanonicalInput", "baseCanonicalInputFingerprint", "seedCases"]);
    const beforeHarness = realCalls;
    expect(runBaselineValidationCase(validationCase).overall).toBe("PASS");
    expect(realCalls - beforeHarness).toBeGreaterThanOrEqual(9);
  });

  it("fails temporal checks when report evidence is rebound away from its canonical policy input", () => {
    const original = ALL_BASELINE_VALIDATION_CASES[2]!;
    const changed = { ...original, evidence: { ...original.evidence, temporalBoundary: { ...original.evidence.temporalBoundary, observationFingerprint: evaluationFingerprint({ forged: true }) } } };
    const report = runBaselineValidationCase(changed);
    expect(report.checks.find((check) => check.checkId === "temporal_boundary_conformance")?.issues.map((issue) => issue.code)).toContain("OBSERVATION_BINDING_MISMATCH");
    const payload = { observationKey: "forged.observation", observationFingerprint: original.evidence.temporalBoundary.observationFingerprint, data: { forged: true }, dataFingerprint: evaluationFingerprint({ forged: true }) };
    const changedPayload = { ...original, evidence: { ...original.evidence, temporalBoundary: { ...original.evidence.temporalBoundary, observations: [{ ...original.evidence.temporalBoundary.observations[0]!, payload }] } } };
    const payloadReport = runBaselineValidationCase(changedPayload);
    expect(payloadReport.checks.find((check) => check.checkId === "temporal_boundary_conformance")?.issues.map((issue) => issue.code)).toContain("OBSERVATION_BINDING_MISMATCH");
    const later = "2026-12-31T00:00:00.000Z";
    const shiftedDecision = { ...original, evidence: { ...original.evidence, temporalBoundary: { ...original.evidence.temporalBoundary, decisionTimestamp: later } } };
    expect(runBaselineValidationCase(shiftedDecision).checks.find((check) => check.checkId === "temporal_boundary_conformance")?.issues.map((issue) => issue.code)).toContain("TEMPORAL_BINDING_MISMATCH");
    const widenedLookback = { ...original, evidence: { ...original.evidence, lookbackWindow: { ...original.evidence.lookbackWindow, startInclusive: "2025-01-01T00:00:00.000Z" } } };
    expect(runBaselineValidationCase(widenedLookback).checks.find((check) => check.checkId === "lookback_window_conformance")?.issues.map((issue) => issue.code)).toContain("TEMPORAL_BINDING_MISMATCH");
  });
});
