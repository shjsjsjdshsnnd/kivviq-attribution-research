import { describe, expect, it } from "vitest";
import { evaluationFingerprint } from "../../src/evaluation/baseline-contract.js";
import { ensureCanonicalOperatorV2 } from "../../src/operator/canonical-interface.js";
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
  });

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

      const seedBindings = entry.evidence.provenanceIntegrity.filter((evidence) => evidence.label.startsWith("seed-binding:"));
      expect(seedBindings).toHaveLength(2);
      expect(new Set(seedBindings.map((evidence) => evidence.recordedFingerprint)).size).toBe(2);
      const bindingFingerprints = seedBindings.map((evidence) => {
        const value = evidence.value as { seedCaseId: string; seeds: unknown; seedBindingFingerprint: string };
        expect(value.seedBindingFingerprint).toBe(evaluationFingerprint({ seedCaseId: value.seedCaseId, seeds: value.seeds }));
        return value.seedBindingFingerprint;
      });
      expect(new Set(bindingFingerprints).size).toBe(2);
      expect(new Set(entry.evidence.seedReproducibility.map((sample) => sample.seedCaseId))).toEqual(new Set(seedBindings.map((evidence) => (evidence.value as { seedCaseId: string }).seedCaseId)));
      expect(new Set(entry.evidence.seedReproducibility.map((sample) => sample.seedBindingFingerprint))).toEqual(new Set(bindingFingerprints));
      expect(new Set(entry.evidence.seedReproducibility.map((sample) => `${sample.seedCaseId}:${sample.seedBindingFingerprint}`))).toEqual(new Set(seedBindings.map((evidence) => {
        const value = evidence.value as { seedCaseId: string; seedBindingFingerprint: string };
        return `${value.seedCaseId}:${value.seedBindingFingerprint}`;
      })));
      if (ensureCanonicalOperatorV2(entry.operator).metadata.capabilities.maximumActionsPerDecision > 0) {
        expect(entry.evidence.missingDataBehavior.invocations[0]!.canonicalInput.legalActionSpace.rules.length, id).toBeGreaterThan(0);
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
});
