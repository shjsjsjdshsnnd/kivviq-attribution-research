import { describe, expect, it } from "vitest";
import { declarativeProbeFingerprint, runBaselineValidationCase, runBaselineValidationSuite, stableBaselineConformanceReportJson } from "../../src/validation/index.js";
import { ALL_BASELINE_VALIDATION_CASES, FROZEN_BASELINE_OPERATOR_IDS } from "./helpers.js";

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
    const complete = ALL_BASELINE_VALIDATION_CASES[0]!;
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
});
