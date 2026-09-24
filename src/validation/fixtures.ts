import {
  deepFreezeEvaluation,
  evaluationFingerprint,
  stableEvaluationJson,
} from "../evaluation/baseline-contract.js";
import {
  BASELINE_VALIDATION_REQUIRED_CHECKS,
  BaselineValidationError,
  assertBaselineValidationFingerprint,
  type BaselineValidationCheckId,
} from "./contract.js";
import {
  BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
  BASELINE_VALIDATION_SUITE_VERSION,
} from "./version.js";

export const BASELINE_VALIDATION_FIXTURE_IDS = deepFreezeEvaluation([
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
] as const);

export type BaselineValidationFixtureId =
  (typeof BASELINE_VALIDATION_FIXTURE_IDS)[number];

export interface BaselineValidationFixtureDescriptorBody {
  readonly fixtureId: BaselineValidationFixtureId;
  readonly fixtureVersion: "1.0.0";
  readonly purpose: string;
  readonly evidenceCategories: readonly BaselineValidationCheckId[];
}

export interface BaselineValidationFixtureDescriptor
  extends BaselineValidationFixtureDescriptorBody {
  readonly fixtureFingerprint: string;
}

export interface BaselineValidationFixtureManifestBody {
  readonly kind: "baseline_validation_fixture_manifest";
  readonly schemaVersion: typeof BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION;
  readonly validationSuiteVersion: typeof BASELINE_VALIDATION_SUITE_VERSION;
  readonly fixtureManifestId: "baseline-validation-fixtures-v1";
  readonly fixtures: readonly BaselineValidationFixtureDescriptor[];
}

export interface BaselineValidationFixtureManifest
  extends BaselineValidationFixtureManifestBody {
  readonly fixtureManifestFingerprint: string;
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BaselineValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  requireCondition(
    actual.length === allowed.length &&
      actual.every((key, index) => key === allowed[index]),
    `${label} has unexpected keys`,
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(stableEvaluationJson(value)) as T;
}

function fixtureDescriptor(
  body: BaselineValidationFixtureDescriptorBody,
): BaselineValidationFixtureDescriptor {
  return {
    ...body,
    fixtureFingerprint: evaluationFingerprint(body),
  };
}

export function recomputeFixtureDescriptorFingerprint(
  descriptor:
    | BaselineValidationFixtureDescriptorBody
    | BaselineValidationFixtureDescriptor,
): string {
  const { fixtureFingerprint: _omitted, ...body } = descriptor as
    BaselineValidationFixtureDescriptor & Record<string, unknown>;
  return evaluationFingerprint(body);
}

export function recomputeFixtureManifestFingerprint(
  manifest:
    | BaselineValidationFixtureManifestBody
    | BaselineValidationFixtureManifest,
): string {
  const { fixtureManifestFingerprint: _omitted, ...body } = manifest as
    BaselineValidationFixtureManifest & Record<string, unknown>;
  return evaluationFingerprint(body);
}

const FIXTURE_MANIFEST_BODY = {
  kind: "baseline_validation_fixture_manifest",
  schemaVersion: BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
  validationSuiteVersion: BASELINE_VALIDATION_SUITE_VERSION,
  fixtureManifestId: "baseline-validation-fixtures-v1",
  fixtures: [
    fixtureDescriptor({
      fixtureId: "empty",
      fixtureVersion: "1.0.0",
      purpose: "Validates zero-Action and empty-observation behavior.",
      evidenceCategories: ["zero_action_behavior", "missing_data_behavior"],
    }),
    fixtureDescriptor({
      fixtureId: "single_action",
      fixtureVersion: "1.0.0",
      purpose: "Validates one canonical Action through the operator boundary.",
      evidenceCategories: ["action_ontology_conformance", "artifact_replay"],
    }),
    fixtureDescriptor({
      fixtureId: "multi_action",
      fixtureVersion: "1.0.0",
      purpose: "Validates deterministic ordering and handling of multiple Actions.",
      evidenceCategories: ["multi_action_behavior", "determinism"],
    }),
    fixtureDescriptor({
      fixtureId: "constraint_rejected",
      fixtureVersion: "1.0.0",
      purpose: "Validates provenance for an Action rejected by constraints.",
      evidenceCategories: ["constraint_conformance", "provenance_integrity"],
    }),
    fixtureDescriptor({
      fixtureId: "constraint_modified",
      fixtureVersion: "1.0.0",
      purpose: "Validates provenance for an Action modified by constraints.",
      evidenceCategories: ["constraint_conformance", "provenance_integrity"],
    }),
    fixtureDescriptor({
      fixtureId: "hidden_truth_pair",
      fixtureVersion: "1.0.0",
      purpose: "Validates invariance across hidden-truth witnesses.",
      evidenceCategories: [
        "hidden_truth_isolation",
        "prohibited_information_invariance",
      ],
    }),
    fixtureDescriptor({
      fixtureId: "future_pair",
      fixtureVersion: "1.0.0",
      purpose: "Validates invariance across future-information witnesses.",
      evidenceCategories: [
        "future_information_isolation",
        "prohibited_information_invariance",
      ],
    }),
    fixtureDescriptor({
      fixtureId: "missing_data",
      fixtureVersion: "1.0.0",
      purpose: "Validates deterministic policy fallback when permitted data is absent.",
      evidenceCategories: ["missing_data_behavior", "policy_semantics"],
    }),
    fixtureDescriptor({
      fixtureId: "exact_tie",
      fixtureVersion: "1.0.0",
      purpose: "Validates deterministic tie-breaking under equal scores.",
      evidenceCategories: ["tie_breaking", "determinism"],
    }),
    fixtureDescriptor({
      fixtureId: "lookback_boundary",
      fixtureVersion: "1.0.0",
      purpose: "Validates exact inclusive and exclusive lookback boundaries.",
      evidenceCategories: [
        "lookback_window_conformance",
        "temporal_boundary_conformance",
      ],
    }),
  ],
} as const satisfies BaselineValidationFixtureManifestBody;

export const FROZEN_BASELINE_VALIDATION_FIXTURES: BaselineValidationFixtureManifest =
  deepFreezeEvaluation({
    ...FIXTURE_MANIFEST_BODY,
    fixtureManifestFingerprint: evaluationFingerprint(FIXTURE_MANIFEST_BODY),
  });

export function validateBaselineValidationFixtureManifest(
  value: unknown,
): BaselineValidationFixtureManifest {
  requireCondition(isRecord(value), "fixture manifest must be an object");
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "validationSuiteVersion",
      "fixtureManifestId",
      "fixtures",
      "fixtureManifestFingerprint",
    ],
    "fixture manifest",
  );
  requireCondition(
    value["kind"] === FIXTURE_MANIFEST_BODY.kind,
    "fixture manifest kind mismatch",
  );
  requireCondition(
    value["schemaVersion"] ===
      BASELINE_VALIDATION_FIXTURE_MANIFEST_SCHEMA_VERSION,
    "fixture manifest schema version mismatch",
  );
  requireCondition(
    value["validationSuiteVersion"] === BASELINE_VALIDATION_SUITE_VERSION,
    "validation suite version mismatch",
  );
  requireCondition(
    value["fixtureManifestId"] === FIXTURE_MANIFEST_BODY.fixtureManifestId,
    "fixture manifest ID mismatch",
  );
  requireCondition(Array.isArray(value["fixtures"]), "fixtures must be an array");

  const ids: string[] = [];
  for (const [index, descriptor] of value["fixtures"].entries()) {
    requireCondition(isRecord(descriptor), `fixture descriptor ${index} must be an object`);
    assertExactKeys(
      descriptor,
      [
        "fixtureId",
        "fixtureVersion",
        "purpose",
        "evidenceCategories",
        "fixtureFingerprint",
      ],
      `fixture descriptor ${index}`,
    );
    requireCondition(
      typeof descriptor["fixtureId"] === "string" &&
        (BASELINE_VALIDATION_FIXTURE_IDS as readonly string[]).includes(
          descriptor["fixtureId"],
        ),
      `unknown fixture ID: ${String(descriptor["fixtureId"])}`,
    );
    ids.push(descriptor["fixtureId"]);
    requireCondition(
      descriptor["fixtureVersion"] === "1.0.0",
      `fixture ${descriptor["fixtureId"]} version mismatch`,
    );
    requireCondition(
      typeof descriptor["purpose"] === "string" &&
        descriptor["purpose"].trim().length > 0,
      `fixture ${descriptor["fixtureId"]} purpose must be non-empty`,
    );
    requireCondition(
      Array.isArray(descriptor["evidenceCategories"]) &&
        descriptor["evidenceCategories"].length > 0,
      `fixture ${descriptor["fixtureId"]} evidence categories must be non-empty`,
    );
    for (const category of descriptor["evidenceCategories"]) {
      requireCondition(
        typeof category === "string" &&
          (BASELINE_VALIDATION_REQUIRED_CHECKS as readonly string[]).includes(
            category,
          ),
        `fixture ${descriptor["fixtureId"]} has an unknown evidence category`,
      );
    }
    assertBaselineValidationFingerprint(
      descriptor["fixtureFingerprint"],
      `fixture ${descriptor["fixtureId"]} fingerprint`,
    );
    requireCondition(
      descriptor["fixtureFingerprint"] ===
        recomputeFixtureDescriptorFingerprint(
          descriptor as unknown as BaselineValidationFixtureDescriptor,
        ),
      `fixture fingerprint mismatch: ${descriptor["fixtureId"]}`,
    );
  }
  requireCondition(new Set(ids).size === ids.length, "duplicate fixture ID");
  assertBaselineValidationFingerprint(
    value["fixtureManifestFingerprint"],
    "fixture manifest fingerprint",
  );
  requireCondition(
    value["fixtureManifestFingerprint"] ===
      recomputeFixtureManifestFingerprint(
        value as unknown as BaselineValidationFixtureManifest,
      ),
    "fixture manifest fingerprint mismatch",
  );
  requireCondition(
    value["fixtureManifestFingerprint"] ===
      FROZEN_BASELINE_VALIDATION_FIXTURES.fixtureManifestFingerprint &&
      stableEvaluationJson(value) ===
        stableEvaluationJson(FROZEN_BASELINE_VALIDATION_FIXTURES),
    "frozen fixture manifest identity mismatch",
  );
  requireCondition(
    JSON.stringify(ids) === JSON.stringify(BASELINE_VALIDATION_FIXTURE_IDS),
    "fixture descriptor coverage or order mismatch",
  );
  return deepFreezeEvaluation(
    cloneJson(value) as unknown as BaselineValidationFixtureManifest,
  );
}
