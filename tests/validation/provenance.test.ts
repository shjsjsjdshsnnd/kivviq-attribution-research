import { describe, expect, it } from "vitest";
import { evaluationFingerprint, stableEvaluationJson } from "../../src/evaluation/baseline-contract.js";
import {
  BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
  BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
  BASELINE_VALIDATION_SUITE_VERSION,
  FROZEN_BASELINE_VALIDATION_FIXTURES,
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  recomputeFixtureManifestFingerprint,
  recomputeSeedSetFingerprint,
  validateBaselineValidationFixtureManifest,
  validateBaselineValidationSeedSet,
  validateProvenanceEvidence,
  validateRecordedFingerprint,
} from "../../src/validation/index.js";

const SEED_NAMESPACES = [
  "merchant_generation",
  "customer_population",
  "baseline_warm_up",
  "shared_evaluation_environment",
  "operator_randomness",
] as const;

const FIXTURE_IDS = [
  "empty",
  "single_action",
  "multi_action",
  "constraint_rejected",
  "constraint_modified",
  "hidden_truth_pair",
  "future_pair",
  "missing_data",
  "exact_tie",
  "lookback_boundary",
] as const;

function mutableCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("frozen validation seeds", () => {
  it("freezes schema versions, explicit cases, profiles, and exact integer namespaces", () => {
    expect(BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION).toBe("1.0.0");
    expect(BASELINE_VALIDATION_SUITE_VERSION).toBe("1.0.0");
    expect(FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length).toBeGreaterThanOrEqual(6);
    expect(
      new Set(
        FROZEN_BASELINE_VALIDATION_SEED_SET.cases.map((entry) => entry.worldProfile),
      ).size,
    ).toBeGreaterThanOrEqual(3);
    expect(
      new Set(
        FROZEN_BASELINE_VALIDATION_SEED_SET.cases.map((entry) => entry.caseId),
      ).size,
    ).toBe(FROZEN_BASELINE_VALIDATION_SEED_SET.cases.length);

    for (const entry of FROZEN_BASELINE_VALIDATION_SEED_SET.cases) {
      expect(Object.keys(entry.seeds).sort()).toEqual([...SEED_NAMESPACES].sort());
      for (const namespace of SEED_NAMESPACES) {
        expect(Number.isSafeInteger(entry.seeds[namespace])).toBe(true);
      }
    }
  });

  it("recomputes a stable fingerprint from the body and returns a frozen canonical copy", () => {
    expect(recomputeSeedSetFingerprint(FROZEN_BASELINE_VALIDATION_SEED_SET)).toBe(
      FROZEN_BASELINE_VALIDATION_SEED_SET.seedSetFingerprint,
    );
    const mutable = mutableCopy(FROZEN_BASELINE_VALIDATION_SEED_SET);
    const validated = validateBaselineValidationSeedSet(mutable);

    expect(validated).not.toBe(mutable);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.cases)).toBe(true);
    expect(Object.isFrozen(validated.cases[0]?.seeds)).toBe(true);
    expect(stableEvaluationJson(validated)).toBe(
      stableEvaluationJson(FROZEN_BASELINE_VALIDATION_SEED_SET),
    );
  });

  it("rejects tampered fingerprints and unknown fields even after recomputation", () => {
    expect(() =>
      validateBaselineValidationSeedSet({
        ...FROZEN_BASELINE_VALIDATION_SEED_SET,
        seedSetFingerprint: "fnv1a64:0000000000000000",
      }),
    ).toThrow(/seed-set fingerprint mismatch/);

    const unknown = {
      ...FROZEN_BASELINE_VALIDATION_SEED_SET,
      generatedAt: "ambient",
    };
    expect(() =>
      validateBaselineValidationSeedSet({
        ...unknown,
        seedSetFingerprint: recomputeSeedSetFingerprint(unknown),
      }),
    ).toThrow(/unexpected keys/);

    const nested = mutableCopy(FROZEN_BASELINE_VALIDATION_SEED_SET) as unknown as {
      cases: Array<Record<string, unknown>>;
      seedSetFingerprint: string;
    };
    nested.cases[0]!["ambient"] = true;
    nested.seedSetFingerprint = recomputeSeedSetFingerprint(nested as never);
    expect(() => validateBaselineValidationSeedSet(nested)).toThrow(/unexpected keys/);
  });
});

describe("frozen validation fixtures", () => {
  it("freezes the versioned descriptor inventory and evidence categories", () => {
    expect(BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION).toBe("1.0.0");
    expect(FROZEN_BASELINE_VALIDATION_FIXTURES.fixtures.map((x) => x.fixtureId)).toEqual(
      FIXTURE_IDS,
    );
    for (const descriptor of FROZEN_BASELINE_VALIDATION_FIXTURES.fixtures) {
      expect(descriptor.fixtureVersion).toBe("1.0.0");
      expect(descriptor.purpose.trim().length).toBeGreaterThan(0);
      expect(descriptor.evidenceCategories.length).toBeGreaterThan(0);
      expect(descriptor.fixtureFingerprint).toBe(
        evaluationFingerprint({
          fixtureId: descriptor.fixtureId,
          fixtureVersion: descriptor.fixtureVersion,
          purpose: descriptor.purpose,
          evidenceCategories: descriptor.evidenceCategories,
        }),
      );
    }
  });

  it("recomputes the manifest fingerprint and returns a deeply frozen canonical copy", () => {
    expect(
      recomputeFixtureManifestFingerprint(FROZEN_BASELINE_VALIDATION_FIXTURES),
    ).toBe(FROZEN_BASELINE_VALIDATION_FIXTURES.fixtureManifestFingerprint);
    const mutable = mutableCopy(FROZEN_BASELINE_VALIDATION_FIXTURES);
    const validated = validateBaselineValidationFixtureManifest(mutable);

    expect(validated).not.toBe(mutable);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.fixtures)).toBe(true);
    expect(Object.isFrozen(validated.fixtures[0]?.evidenceCategories)).toBe(true);
    expect(stableEvaluationJson(validated)).toBe(
      stableEvaluationJson(FROZEN_BASELINE_VALIDATION_FIXTURES),
    );
  });

  it("rejects tampered descriptor fingerprints and unknown versioned fields", () => {
    const tampered = mutableCopy(
      FROZEN_BASELINE_VALIDATION_FIXTURES,
    ) as unknown as {
      fixtures: Array<Record<string, unknown>>;
      fixtureManifestFingerprint: string;
    };
    tampered.fixtures[0] = {
      ...tampered.fixtures[0]!,
      fixtureFingerprint: "fnv1a64:0000000000000000",
    };
    tampered.fixtureManifestFingerprint = recomputeFixtureManifestFingerprint(
      tampered as never,
    );
    expect(() => validateBaselineValidationFixtureManifest(tampered)).toThrow(
      /fixture fingerprint mismatch/,
    );

    const unknown = {
      ...FROZEN_BASELINE_VALIDATION_FIXTURES,
      source: "ambient",
    };
    expect(() =>
      validateBaselineValidationFixtureManifest({
        ...unknown,
        fixtureManifestFingerprint: recomputeFixtureManifestFingerprint(unknown),
      }),
    ).toThrow(/unexpected keys/);

    const nested = mutableCopy(FROZEN_BASELINE_VALIDATION_FIXTURES) as unknown as {
      fixtures: Array<Record<string, unknown>>;
      fixtureManifestFingerprint: string;
    };
    nested.fixtures[0]!["ambient"] = true;
    nested.fixtureManifestFingerprint = recomputeFixtureManifestFingerprint(
      nested as never,
    );
    expect(() => validateBaselineValidationFixtureManifest(nested)).toThrow(
      /unexpected keys/,
    );
  });
});

describe("provenance fingerprint validation", () => {
  it("passes only after independently recomputing the recorded fingerprint", () => {
    const value = { visible: 1 };
    const fingerprint = evaluationFingerprint(value);
    const result = validateRecordedFingerprint({
      label: "observation",
      value,
      recordedFingerprint: fingerprint,
    });

    expect(result).toEqual({
      checkId: "provenance_integrity",
      status: "PASS",
      evidenceFingerprints: [fingerprint],
      issues: [],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidenceFingerprints)).toBe(true);
  });

  it("fails closed for mismatches, malformed or missing labels, malformed fingerprints, and unknown keys", () => {
    const cases: Array<[unknown, string]> = [
      [
        {
          label: "observation",
          value: { visible: 1 },
          recordedFingerprint: "fnv1a64:0000000000000000",
        },
        "FINGERPRINT_MISMATCH",
      ],
      [
        { label: "  ", value: { visible: 1 }, recordedFingerprint: "fnv1a64:0000000000000000" },
        "INVALID_EVIDENCE_LABEL",
      ],
      [
        { value: { visible: 1 }, recordedFingerprint: "fnv1a64:0000000000000000" },
        "INVALID_EVIDENCE_LABEL",
      ],
      [
        { label: "observation", value: { visible: 1 }, recordedFingerprint: "sha256:nope" },
        "MALFORMED_RECORDED_FINGERPRINT",
      ],
      [
        {
          label: "observation",
          value: { visible: 1 },
          recordedFingerprint: evaluationFingerprint({ visible: 1 }),
          ambient: true,
        },
        "UNKNOWN_EVIDENCE_KEY",
      ],
    ];

    for (const [evidence, code] of cases) {
      const result = validateRecordedFingerprint(evidence as never);
      expect(result.status).toBe("FAIL");
      expect(result.issues.map((issue) => issue.code)).toContain(code);
    }
  });

  it("sorts aggregate issues and evidence fingerprints deterministically", () => {
    const alpha = { value: "alpha" };
    const zeta = { value: "zeta" };
    const result = validateProvenanceEvidence([
      {
        label: "zeta",
        value: zeta,
        recordedFingerprint: evaluationFingerprint(zeta),
      },
      {
        label: "alpha",
        value: alpha,
        recordedFingerprint: evaluationFingerprint(alpha),
      },
      {
        label: "alpha",
        value: alpha,
        recordedFingerprint: "fnv1a64:0000000000000000",
      },
    ]);

    expect(result.status).toBe("FAIL");
    expect(result.evidenceFingerprints).toEqual(
      [...result.evidenceFingerprints].sort(),
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "DUPLICATE_EVIDENCE_LABEL",
      "FINGERPRINT_MISMATCH",
    ]);
    expect(Object.isFrozen(result.issues)).toBe(true);
  });

  it("fails closed for empty evidence", () => {
    expect(validateProvenanceEvidence([])).toEqual({
      checkId: "provenance_integrity",
      status: "FAIL",
      evidenceFingerprints: [],
      issues: [
        {
          code: "EMPTY_PROVENANCE_EVIDENCE",
          path: "evidence",
          message: "provenance evidence must not be empty",
        },
      ],
    });
  });
});
