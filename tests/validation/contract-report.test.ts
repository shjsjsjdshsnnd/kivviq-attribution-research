import { describe, expect, it } from "vitest";
import {
  BASELINE_CONFORMANCE_REPORT_SCHEMA_VERSION,
  BASELINE_VALIDATION_CONTRACT,
  BASELINE_VALIDATION_CANONICAL_JSON_VERSION,
  BASELINE_VALIDATION_CONTRACT_SCHEMA_VERSION,
  BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
  BASELINE_VALIDATION_FROZEN_PARENT_COMMIT,
  BASELINE_VALIDATION_REQUIRED_CHECKS,
  BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
  BASELINE_VALIDATION_SUITE_VERSION,
  FROZEN_BASELINE_VALIDATION_FIXTURES,
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  BaselineValidationError,
  baselineConformanceEvidenceFingerprint,
  baselineValidationContractFingerprint,
  createBaselineConformanceReport,
  baselineConformanceReportFingerprint,
  stableBaselineConformanceReportJson,
  stableValidationJson,
  validationFingerprint,
  validateBaselineConformanceReport,
  validateBaselineValidationContract,
} from "../../src/validation/index.js";
import type {
  BaselineConformanceEvidence,
  BaselineConformanceReport,
  BaselineValidationCheckResult,
} from "../../src/validation/index.js";

const REQUIRED_CHECKS = [
  "determinism",
  "seed_reproducibility",
  "hidden_truth_isolation",
  "future_information_isolation",
  "temporal_boundary_conformance",
  "lookback_window_conformance",
  "action_ontology_conformance",
  "constraint_conformance",
  "policy_semantics",
  "permitted_information_sensitivity",
  "prohibited_information_invariance",
  "tie_breaking",
  "missing_data_behavior",
  "zero_action_behavior",
  "multi_action_behavior",
  "artifact_replay",
  "provenance_integrity",
  "uncontrolled_randomness_detection",
  "operator_isolation",
] as const;

function passingEvidence(): BaselineConformanceEvidence {
  return {
    operator: {
      operatorId: "baseline.do_nothing",
      operatorVersion: "1.0.0",
      implementationFingerprint: "fnv1a64:1111111111111111",
      configurationFingerprint: "fnv1a64:2222222222222222",
    },
    checks: REQUIRED_CHECKS.map((checkId, index) => ({
      checkId,
      status: "PASS",
      evidenceFingerprints: [
        `fnv1a64:${index.toString(16).padStart(16, "0")}`,
      ],
      issues: [],
    })),
  };
}

function mutableReport(report: BaselineConformanceReport): Record<string, unknown> {
  return JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
}

describe("Step 3.11 validation contract", () => {
  it("owns a versioned code-unit canonical serializer without changing Step 3.1", () => {
    expect(BASELINE_VALIDATION_CANONICAL_JSON_VERSION).toBe("1.0.0");
    expect(stableValidationJson({ a: 1, A: 2 })).toBe('{"A":2,"a":1}');
    expect(validationFingerprint({ a: 1, A: 2 })).toBe(
      "fnv1a64:cfcf9127b2237ca2",
    );
  });

  it("freezes versions, lineage, and required checks in exact order", () => {
    expect(BASELINE_VALIDATION_SUITE_VERSION).toBe("1.0.0");
    expect(BASELINE_VALIDATION_CONTRACT_SCHEMA_VERSION).toBe("1.0.0");
    expect(BASELINE_CONFORMANCE_REPORT_SCHEMA_VERSION).toBe("1.0.0");
    expect(BASELINE_VALIDATION_FROZEN_PARENT_COMMIT).toBe(
      "3fbc5c9396f2471c7c6fdd5fb73b50cb107dcaf3",
    );
    expect(BASELINE_VALIDATION_REQUIRED_CHECKS).toEqual(REQUIRED_CHECKS);
    expect(Object.isFrozen(BASELINE_VALIDATION_REQUIRED_CHECKS)).toBe(true);
    expect(Object.isFrozen(BASELINE_VALIDATION_CONTRACT)).toBe(true);
    expect(validateBaselineValidationContract(BASELINE_VALIDATION_CONTRACT)).toEqual(
      BASELINE_VALIDATION_CONTRACT,
    );
  });

  it("rejects a tampered contract fingerprint", () => {
    expect(() =>
      validateBaselineValidationContract({
        ...BASELINE_VALIDATION_CONTRACT,
        contractFingerprint: "fnv1a64:0000000000000000",
      }),
    ).toThrow(/contract fingerprint mismatch/);
  });

  it("rejects undeclared contract fields even when the fingerprint is recomputed", () => {
    const withAmbientField = {
      ...BASELINE_VALIDATION_CONTRACT,
      createdAt: "2026-09-24T00:00:00.000Z",
    };
    const recomputed = {
      ...withAmbientField,
      contractFingerprint: baselineValidationContractFingerprint(withAmbientField),
    };

    expect(() => validateBaselineValidationContract(recomputed)).toThrow(
      /unexpected keys/,
    );
  });

  it("returns a deeply frozen canonical copy from contract validation", () => {
    const mutable = JSON.parse(
      JSON.stringify(BASELINE_VALIDATION_CONTRACT),
    ) as Record<string, unknown>;
    const validated = validateBaselineValidationContract(mutable);

    expect(validated).not.toBe(mutable);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.requiredChecks)).toBe(true);
    (mutable["requiredChecks"] as string[])[0] = "mutated";
    expect(validated.requiredChecks[0]).toBe("determinism");
  });
});

describe("Step 3.11 conformance reports", () => {
  it("creates immutable, byte-identical passing reports", () => {
    const left = createBaselineConformanceReport(passingEvidence());
    const right = createBaselineConformanceReport(passingEvidence());

    expect(left).toEqual(right);
    expect(left.overall).toBe("PASS");
    expect(left.fixtureManifestSchemaVersion).toBe(
      BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
    );
    expect(left.fixtureManifestFingerprint).toBe(
      FROZEN_BASELINE_VALIDATION_FIXTURES.fixtureManifestFingerprint,
    );
    expect(left.seedSetSchemaVersion).toBe(
      BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
    );
    expect(left.seedSetFingerprint).toBe(
      FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint,
    );
    expect(left.checks.map((check) => check.checkId)).toEqual(REQUIRED_CHECKS);
    expect(Object.isFrozen(left)).toBe(true);
    expect(stableBaselineConformanceReportJson(left)).toBe(
      stableBaselineConformanceReportJson(right),
    );
    expect(baselineConformanceReportFingerprint(left)).toBe(
      left.reportFingerprint,
    );
    expect(validateBaselineConformanceReport(left)).toEqual(left);
    expect(stableBaselineConformanceReportJson(left)).not.toMatch(
      /createdAt|timestamp/i,
    );
  });

  it("binds evidence and report fingerprints to the exact frozen fixture and seed identities", () => {
    const report = createBaselineConformanceReport(passingEvidence());
    const changedFixture = {
      ...report,
      fixtureManifestFingerprint: "fnv1a64:0000000000000000",
    };
    const changedSeed = {
      ...report,
      seedSetFingerprint: "fnv1a64:0000000000000000",
    };

    expect(baselineConformanceEvidenceFingerprint(changedFixture)).not.toBe(
      report.evidenceFingerprint,
    );
    expect(baselineConformanceEvidenceFingerprint(changedSeed)).not.toBe(
      report.evidenceFingerprint,
    );
    expect(baselineConformanceReportFingerprint(changedFixture)).not.toBe(
      report.reportFingerprint,
    );
    expect(baselineConformanceReportFingerprint(changedSeed)).not.toBe(
      report.reportFingerprint,
    );
  });

  it("rejects stale or tampered frozen artifact identities after aggregate fingerprints are recomputed", () => {
    const report = createBaselineConformanceReport(passingEvidence());
    const cases = [
      [
        "fixtureManifestSchemaVersion",
        "9.0.0",
        /fixture manifest schema version mismatch/,
      ],
      [
        "fixtureManifestFingerprint",
        "fnv1a64:0000000000000000",
        /fixture manifest fingerprint mismatch/,
      ],
      ["seedSetSchemaVersion", "9.0.0", /seed-set schema version mismatch/],
      [
        "seedSetFingerprint",
        "fnv1a64:0000000000000000",
        /seed-set fingerprint mismatch/,
      ],
    ] as const;

    for (const [field, value, message] of cases) {
      const changed = mutableReport(report);
      changed[field] = value;
      changed["evidenceFingerprint"] = baselineConformanceEvidenceFingerprint(
        changed as unknown as BaselineConformanceReport,
      );
      changed["reportFingerprint"] = baselineConformanceReportFingerprint(
        changed as unknown as BaselineConformanceReport,
      );
      expect(() => validateBaselineConformanceReport(changed)).toThrow(message);
    }
  });

  it("rejects contradictory or unbound check outcomes even after report fingerprints are recomputed", () => {
    const base = createBaselineConformanceReport(passingEvidence());
    const cases = [
      {
        check: {
          ...base.checks[0]!,
          status: "PASS",
          issues: [{ code: "CONTRADICTION", path: "checks.determinism", message: "failed evidence" }],
        },
        message: /status does not match evaluator outcome/,
      },
      {
        check: { ...base.checks[0]!, status: "PASS", evidenceFingerprints: [] },
        message: /PASS check must contain evidence/,
      },
      {
        check: { ...base.checks[0]!, status: "FAIL", issues: [] },
        message: /status does not match evaluator outcome/,
      },
      {
        check: {
          ...base.checks[0]!,
          evidenceFingerprints: [
            base.checks[0]!.evidenceFingerprints[0]!,
            base.checks[0]!.evidenceFingerprints[0]!,
          ],
        },
        message: /duplicate evidence fingerprint/,
      },
      {
        check: { ...base.checks[0]!, evidenceFingerprints: ["not-a-fingerprint"] },
        message: /fingerprint must match/,
      },
    ] as const;

    for (const entry of cases) {
      const changed = mutableReport(base);
      (changed["checks"] as unknown[])[0] = entry.check;
      changed["evidenceFingerprint"] = baselineConformanceEvidenceFingerprint(
        changed as unknown as BaselineConformanceReport,
      );
      changed["reportFingerprint"] = baselineConformanceReportFingerprint(
        changed as unknown as BaselineConformanceReport,
      );
      expect(() => validateBaselineConformanceReport(changed)).toThrow(
        entry.message,
      );
    }
  });

  it("rejects contradictory raw results before creating a report", () => {
    const evidence = passingEvidence();
    const contradictory = {
      ...evidence,
      checks: [
        {
          ...evidence.checks[0]!,
          status: "PASS" as const,
          issues: [
            {
              code: "CONTRADICTION",
              path: "checks.determinism",
              message: "failed evidence",
            },
          ],
        },
        ...evidence.checks.slice(1),
      ],
    };

    expect(() => createBaselineConformanceReport(contradictory)).toThrow(
      /status does not match evaluator outcome/,
    );
  });

  it("sorts checks, issues, and evidence fingerprints deterministically", () => {
    const evidence = passingEvidence();
    const checks = [...evidence.checks].reverse().map((check, index) =>
      index === 0
        ? {
            ...check,
            status: "FAIL" as const,
            evidenceFingerprints: [
              "fnv1a64:ffffffffffffffff",
              "fnv1a64:0000000000000001",
            ],
            issues: [
              { code: "Z", path: "b", message: "second" },
              { code: "A", path: "z", message: "third" },
              { code: "A", path: "a", message: "first" },
            ],
          }
        : check,
    );
    const report = createBaselineConformanceReport({ ...evidence, checks });
    const last = report.checks.at(-1);

    expect(last?.evidenceFingerprints).toEqual([
      "fnv1a64:0000000000000001",
      "fnv1a64:ffffffffffffffff",
    ]);
    expect(last?.issues).toEqual([
      { code: "A", path: "a", message: "first" },
      { code: "A", path: "z", message: "third" },
      { code: "Z", path: "b", message: "second" },
    ]);
  });

  it("uses locale-independent code-unit issue ordering", () => {
    const evidence = passingEvidence();
    const report = createBaselineConformanceReport({
      ...evidence,
      checks: evidence.checks.map((check, index) =>
        index === 0
          ? {
              ...check,
              status: "FAIL" as const,
              issues: [
                { code: "a", path: "x", message: "lower" },
                { code: "Z", path: "x", message: "upper" },
              ],
            }
          : check,
      ),
    });

    expect(report.checks[0]?.issues.map((issue) => issue.code)).toEqual([
      "Z",
      "a",
    ]);
  });

  it("rejects undeclared evidence, operator, check, and issue fields", () => {
    const base = passingEvidence();
    const cases: unknown[] = [
      { ...base, createdAt: "ambient" },
      { ...base, operator: { ...base.operator, createdAt: "ambient" } },
      {
        ...base,
        checks: [
          { ...base.checks[0]!, createdAt: "ambient" },
          ...base.checks.slice(1),
        ],
      },
      {
        ...base,
        checks: [
          {
            ...base.checks[0]!,
            status: "FAIL",
            issues: [
              {
                code: "FAILURE",
                path: "checks.determinism",
                message: "failed",
                createdAt: "ambient",
              },
            ],
          },
          ...base.checks.slice(1),
        ],
      },
    ];

    for (const evidence of cases) {
      expect(() =>
        createBaselineConformanceReport(
          evidence as BaselineConformanceEvidence,
        ),
      ).toThrow(/unexpected keys/);
    }
  });

  it("fails closed with deterministic missing-evidence checks", () => {
    const evidence = passingEvidence();
    const report = createBaselineConformanceReport({
      ...evidence,
      checks: evidence.checks.filter(
        (check) => check.checkId !== "artifact_replay",
      ),
    });
    const missing = report.checks.find(
      (check) => check.checkId === "artifact_replay",
    );

    expect(report.overall).toBe("FAIL");
    expect(missing).toEqual({
      checkId: "artifact_replay",
      status: "FAIL",
      evidenceFingerprints: [],
      issues: [
        {
          code: "MISSING_REQUIRED_EVIDENCE",
          path: "checks.artifact_replay",
          message: "required validation evidence is absent",
        },
      ],
    });
  });

  it("rejects duplicate check results", () => {
    const evidence = passingEvidence();
    expect(() =>
      createBaselineConformanceReport({
        ...evidence,
        checks: [...evidence.checks, evidence.checks[0]!],
      }),
    ).toThrow(/duplicate check result/);
  });

  it("rejects malformed fingerprints", () => {
    const evidence = passingEvidence();
    const malformed: BaselineValidationCheckResult = {
      ...evidence.checks[0]!,
      evidenceFingerprints: ["sha256:not-supported"],
    };
    expect(() =>
      createBaselineConformanceReport({
        ...evidence,
        checks: [malformed, ...evidence.checks.slice(1)],
      }),
    ).toThrow(/fingerprint must match/);
  });

  it("rejects reordered, inconsistent, and fingerprint-tampered reports", () => {
    const report = createBaselineConformanceReport(passingEvidence());
    const reordered = mutableReport(report);
    const checks = reordered["checks"] as unknown[];
    [checks[0], checks[1]] = [checks[1], checks[0]];
    expect(() => validateBaselineConformanceReport(reordered)).toThrow(
      /contract order/,
    );

    const inconsistent = mutableReport(report);
    inconsistent["overall"] = "FAIL";
    expect(() => validateBaselineConformanceReport(inconsistent)).toThrow(
      /overall status mismatch/,
    );

    const badEvidenceAggregate = mutableReport(report);
    badEvidenceAggregate["evidenceFingerprint"] = "fnv1a64:0000000000000000";
    expect(() => validateBaselineConformanceReport(badEvidenceAggregate)).toThrow(
      /evidence fingerprint mismatch/,
    );

    const badReport = mutableReport(report);
    badReport["reportFingerprint"] = "fnv1a64:0000000000000000";
    expect(() => validateBaselineConformanceReport(badReport)).toThrow(
      /report fingerprint mismatch/,
    );
  });

  it("rejects undeclared report fields even with recomputed fingerprints", () => {
    const report = createBaselineConformanceReport(passingEvidence());
    const withAmbientField = {
      ...report,
      createdAt: "2026-09-24T00:00:00.000Z",
    };
    const recomputed = {
      ...withAmbientField,
      reportFingerprint: baselineConformanceReportFingerprint(withAmbientField),
    };

    expect(() => validateBaselineConformanceReport(recomputed)).toThrow(
      /unexpected keys/,
    );
  });

  it("returns a deeply frozen canonical copy from report validation", () => {
    const mutable = mutableReport(
      createBaselineConformanceReport(passingEvidence()),
    );
    const validated = validateBaselineConformanceReport(mutable);
    const originalOperator = validated.operator.operatorId;
    const originalIssueCount = validated.checks[0]!.issues.length;

    expect(validated).not.toBe(mutable);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.operator)).toBe(true);
    expect(Object.isFrozen(validated.checks)).toBe(true);
    (mutable["operator"] as Record<string, unknown>)["operatorId"] = "mutated";
    ((mutable["checks"] as Array<Record<string, unknown>>)[0]![
      "issues"
    ] as unknown[]).push({ code: "LATE", path: "x", message: "late" });
    expect(validated.operator.operatorId).toBe(originalOperator);
    expect(validated.checks[0]!.issues).toHaveLength(originalIssueCount);
  });

  it("rejects invalid versions, coverage, unknown checks, and issue shapes", () => {
    const report = createBaselineConformanceReport(passingEvidence());

    for (const [field, value, message] of [
      ["schemaVersion", "9.0.0", /report schema version/],
      ["validationSuiteVersion", "9.0.0", /validation suite version/],
      ["validationContractFingerprint", "fnv1a64:0000000000000000", /validation contract fingerprint/],
    ] as const) {
      const changed = mutableReport(report);
      changed[field] = value;
      expect(() => validateBaselineConformanceReport(changed)).toThrow(message);
    }

    const missing = mutableReport(report);
    (missing["checks"] as unknown[]).pop();
    expect(() => validateBaselineConformanceReport(missing)).toThrow(
      /required check coverage/,
    );

    const duplicate = mutableReport(report);
    const duplicateChecks = duplicate["checks"] as unknown[];
    duplicateChecks[1] = duplicateChecks[0];
    expect(() => validateBaselineConformanceReport(duplicate)).toThrow(
      /duplicate check result/,
    );

    const unknown = passingEvidence() as unknown as {
      operator: BaselineConformanceEvidence["operator"];
      checks: Array<Record<string, unknown>>;
    };
    unknown.checks[0]!["checkId"] = "not_a_check";
    expect(() =>
      createBaselineConformanceReport(
        unknown as unknown as BaselineConformanceEvidence,
      ),
    ).toThrow(
      /unknown checkId/,
    );

    const badIssue = passingEvidence() as unknown as {
      operator: BaselineConformanceEvidence["operator"];
      checks: Array<Record<string, unknown>>;
    };
    badIssue.checks[0]!["issues"] = [{ code: "", path: "x", message: "x" }];
    expect(() =>
      createBaselineConformanceReport(
        badIssue as unknown as BaselineConformanceEvidence,
      ),
    ).toThrow(
      BaselineValidationError,
    );
  });
});
