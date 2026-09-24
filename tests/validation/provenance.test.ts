import { describe, expect, it } from "vitest";
import { evaluationFingerprint, stableEvaluationJson } from "../../src/evaluation/baseline-contract.js";
import {
  BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
  BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
  BASELINE_VALIDATION_SUITE_VERSION,
  FROZEN_BASELINE_VALIDATION_FIXTURES,
  FROZEN_BASELINE_VALIDATION_SEED_SET,
  recomputeFixtureDescriptorFingerprint,
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

  it("rejects semantic seed-set changes even when every fingerprint is recomputed", () => {
    const mutate = (
      change: (value: {
        cases: Array<{
          caseId: string;
          seeds: Record<string, number>;
        }>;
      }) => void,
    ): unknown => {
      const value = mutableCopy(FROZEN_BASELINE_VALIDATION_SEED_SET) as unknown as {
        cases: Array<{ caseId: string; seeds: Record<string, number> }>;
        seedSetFingerprint: string;
      };
      change(value);
      value.seedSetFingerprint = recomputeSeedSetFingerprint(value as never);
      return value;
    };

    const changedSeed = mutate((value) => {
      value.cases[0]!.seeds["merchant_generation"]! += 1;
    });
    const changedCaseId = mutate((value) => {
      value.cases[0]!.caseId = "renamed-case";
    });
    const reorderedCases = mutate((value) => {
      [value.cases[0], value.cases[1]] = [value.cases[1]!, value.cases[0]!];
    });

    for (const changed of [changedSeed, changedCaseId, reorderedCases]) {
      expect(() => validateBaselineValidationSeedSet(changed)).toThrow(
        "frozen seed-set identity mismatch",
      );
    }
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

  it("rejects semantic fixture changes even when all fingerprints are recomputed", () => {
    const mutate = (
      change: (value: {
        fixtures: Array<{
          purpose: string;
          evidenceCategories: string[];
          fixtureFingerprint: string;
        }>;
      }) => void,
    ): unknown => {
      const value = mutableCopy(FROZEN_BASELINE_VALIDATION_FIXTURES) as unknown as {
        fixtures: Array<{
          purpose: string;
          evidenceCategories: string[];
          fixtureFingerprint: string;
        }>;
        fixtureManifestFingerprint: string;
      };
      change(value);
      for (const descriptor of value.fixtures) {
        descriptor.fixtureFingerprint = recomputeFixtureDescriptorFingerprint(
          descriptor as never,
        );
      }
      value.fixtureManifestFingerprint = recomputeFixtureManifestFingerprint(
        value as never,
      );
      return value;
    };

    const changedPurpose = mutate((value) => {
      value.fixtures[0]!.purpose = "Changed semantic purpose.";
    });
    const changedCategories = mutate((value) => {
      value.fixtures[0]!.evidenceCategories.reverse();
    });
    const reorderedDescriptors = mutate((value) => {
      [value.fixtures[0], value.fixtures[1]] = [
        value.fixtures[1]!,
        value.fixtures[0]!,
      ];
    });

    for (const changed of [
      changedPurpose,
      changedCategories,
      reorderedDescriptors,
    ]) {
      expect(() => validateBaselineValidationFixtureManifest(changed)).toThrow(
        "frozen fixture manifest identity mismatch",
      );
    }
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

  it("accepts nested values from the strict deterministic JSON domain", () => {
    const nullPrototype = Object.assign(Object.create(null) as object, {
      child: [null, true, false, 0, 1.5, "text", { nested: "value" }],
    });
    const fingerprint = evaluationFingerprint(nullPrototype);

    expect(
      validateRecordedFingerprint({
        label: "strict-json",
        value: nullPrototype,
        recordedFingerprint: fingerprint,
      }),
    ).toMatchObject({ status: "PASS", evidenceFingerprints: [fingerprint] });
  });

  it("rejects every value outside the strict deterministic JSON domain", () => {
    class ExampleClass {
      public readonly value = 1;
    }

    const sparse = new Array(2);
    sparse[1] = "present";
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const symbolKey = { visible: true } as Record<PropertyKey, unknown>;
    symbolKey[Symbol("hidden")] = true;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get: () => 1,
    });
    const nonEnumerable = { visible: true };
    Object.defineProperty(nonEnumerable, "hidden", {
      enumerable: false,
      value: true,
    });

    const invalidValues: readonly unknown[] = [
      undefined,
      () => 1,
      Symbol("value"),
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      sparse,
      new Date("2026-09-24T00:00:00.000Z"),
      new Map([["key", "value"]]),
      new Set(["value"]),
      /value/u,
      new Uint8Array([1, 2]),
      new ExampleClass(),
      cyclic,
      symbolKey,
      accessor,
      nonEnumerable,
    ];

    for (const [index, value] of invalidValues.entries()) {
      const result = validateRecordedFingerprint({
        label: `invalid-${index}`,
        value,
        recordedFingerprint: "fnv1a64:0000000000000000",
      });
      expect(result.status).toBe("FAIL");
      expect(result.issues.map((issue) => issue.code)).toContain(
        "INVALID_PROVENANCE_VALUE",
      );
      expect(result.evidenceFingerprints).toEqual([]);
    }
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
