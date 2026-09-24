import {
  deepFreezeEvaluation,
  evaluationFingerprint,
  stableEvaluationJson,
} from "../evaluation/baseline-contract.js";
import {
  BaselineValidationError,
  assertBaselineValidationFingerprint,
} from "./contract.js";
import {
  BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
  BASELINE_VALIDATION_SUITE_VERSION,
} from "./version.js";

export const BASELINE_VALIDATION_SEED_NAMESPACES = deepFreezeEvaluation([
  "merchant_generation",
  "customer_population",
  "baseline_warm_up",
  "shared_evaluation_environment",
  "operator_randomness",
] as const);

export type BaselineValidationSeedNamespace =
  (typeof BASELINE_VALIDATION_SEED_NAMESPACES)[number];

export const BASELINE_VALIDATION_WORLD_PROFILES = deepFreezeEvaluation([
  "small_balanced",
  "large_advertising_heavy",
  "inventory_constrained",
  "promotion_sensitive",
] as const);

export interface BaselineValidationSeeds {
  readonly merchant_generation: number;
  readonly customer_population: number;
  readonly baseline_warm_up: number;
  readonly shared_evaluation_environment: number;
  readonly operator_randomness: number;
}

export type BaselineValidationWorldProfile =
  (typeof BASELINE_VALIDATION_WORLD_PROFILES)[number];

export interface BaselineValidationSeedCase {
  readonly caseId: string;
  readonly worldProfile: BaselineValidationWorldProfile;
  readonly seeds: BaselineValidationSeeds;
}

export interface BaselineValidationSeedSetBody {
  readonly kind: "baseline_validation_seed_set";
  readonly schemaVersion: typeof BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION;
  readonly validationSuiteVersion: typeof BASELINE_VALIDATION_SUITE_VERSION;
  readonly seedSetId: "baseline-validation-seeds-v1";
  readonly cases: readonly BaselineValidationSeedCase[];
}

export interface BaselineValidationSeedSet extends BaselineValidationSeedSetBody {
  readonly seedSetFingerprint: string;
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

export function recomputeSeedSetFingerprint(
  seedSet: BaselineValidationSeedSetBody | BaselineValidationSeedSet,
): string {
  const { seedSetFingerprint: _omitted, ...body } = seedSet as
    BaselineValidationSeedSet & Record<string, unknown>;
  return evaluationFingerprint(body);
}

const SEED_SET_BODY = {
  kind: "baseline_validation_seed_set",
  schemaVersion: BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
  validationSuiteVersion: BASELINE_VALIDATION_SUITE_VERSION,
  seedSetId: "baseline-validation-seeds-v1",
  cases: [
    {
      caseId: "small-balanced-primary",
      worldProfile: "small_balanced",
      seeds: {
        merchant_generation: 104729,
        customer_population: 104759,
        baseline_warm_up: 104761,
        shared_evaluation_environment: 104773,
        operator_randomness: 104779,
      },
    },
    {
      caseId: "small-balanced-replica",
      worldProfile: "small_balanced",
      seeds: {
        merchant_generation: 130363,
        customer_population: 130367,
        baseline_warm_up: 130369,
        shared_evaluation_environment: 130379,
        operator_randomness: 130399,
      },
    },
    {
      caseId: "large-advertising-search",
      worldProfile: "large_advertising_heavy",
      seeds: {
        merchant_generation: 155921,
        customer_population: 155933,
        baseline_warm_up: 155947,
        shared_evaluation_environment: 155953,
        operator_randomness: 155969,
      },
    },
    {
      caseId: "large-advertising-social",
      worldProfile: "large_advertising_heavy",
      seeds: {
        merchant_generation: 181081,
        customer_population: 181087,
        baseline_warm_up: 181123,
        shared_evaluation_environment: 181141,
        operator_randomness: 181157,
      },
    },
    {
      caseId: "inventory-constrained-low-stock",
      worldProfile: "inventory_constrained",
      seeds: {
        merchant_generation: 205019,
        customer_population: 205031,
        baseline_warm_up: 205033,
        shared_evaluation_environment: 205043,
        operator_randomness: 205063,
      },
    },
    {
      caseId: "promotion-sensitive-mixed-catalog",
      worldProfile: "promotion_sensitive",
      seeds: {
        merchant_generation: 230003,
        customer_population: 230017,
        baseline_warm_up: 230047,
        shared_evaluation_environment: 230059,
        operator_randomness: 230077,
      },
    },
  ],
} as const satisfies BaselineValidationSeedSetBody;

export const FROZEN_BASELINE_VALIDATION_SEED_SET: BaselineValidationSeedSet =
  deepFreezeEvaluation({
    ...SEED_SET_BODY,
    seedSetFingerprint: evaluationFingerprint(SEED_SET_BODY),
  });

export function validateBaselineValidationSeedSet(
  value: unknown,
): BaselineValidationSeedSet {
  requireCondition(isRecord(value), "validation seed set must be an object");
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "validationSuiteVersion",
      "seedSetId",
      "cases",
      "seedSetFingerprint",
    ],
    "validation seed set",
  );
  requireCondition(value["kind"] === SEED_SET_BODY.kind, "seed-set kind mismatch");
  requireCondition(
    value["schemaVersion"] === BASELINE_VALIDATION_SEED_SET_SCHEMA_VERSION,
    "seed-set schema version mismatch",
  );
  requireCondition(
    value["validationSuiteVersion"] === BASELINE_VALIDATION_SUITE_VERSION,
    "validation suite version mismatch",
  );
  requireCondition(value["seedSetId"] === SEED_SET_BODY.seedSetId, "seed-set ID mismatch");
  requireCondition(Array.isArray(value["cases"]), "seed-set cases must be an array");
  requireCondition(value["cases"].length >= 6, "seed set requires at least six cases");

  const caseIds = new Set<string>();
  const profiles = new Set<string>();
  for (const [index, entry] of value["cases"].entries()) {
    requireCondition(isRecord(entry), `seed case ${index} must be an object`);
    assertExactKeys(entry, ["caseId", "worldProfile", "seeds"], `seed case ${index}`);
    requireCondition(
      typeof entry["caseId"] === "string" && entry["caseId"].trim().length > 0,
      `seed case ${index} ID must be a non-empty string`,
    );
    requireCondition(!caseIds.has(entry["caseId"]), `duplicate seed case ID: ${entry["caseId"]}`);
    caseIds.add(entry["caseId"]);
    requireCondition(
      typeof entry["worldProfile"] === "string" &&
        (BASELINE_VALIDATION_WORLD_PROFILES as readonly string[]).includes(
          entry["worldProfile"],
        ),
      `seed case ${index} has an unknown world profile`,
    );
    profiles.add(entry["worldProfile"]);
    requireCondition(isRecord(entry["seeds"]), `seed case ${index} seeds must be an object`);
    assertExactKeys(entry["seeds"], BASELINE_VALIDATION_SEED_NAMESPACES, `seed case ${index} seeds`);
    for (const namespace of BASELINE_VALIDATION_SEED_NAMESPACES) {
      requireCondition(
        Number.isSafeInteger(entry["seeds"][namespace]),
        `seed case ${index} ${namespace} seed must be a safe integer`,
      );
    }
  }
  requireCondition(profiles.size >= 3, "seed set requires at least three world profiles");
  assertBaselineValidationFingerprint(value["seedSetFingerprint"], "seed-set fingerprint");
  requireCondition(
    value["seedSetFingerprint"] ===
      recomputeSeedSetFingerprint(
        value as unknown as BaselineValidationSeedSet,
      ),
    "seed-set fingerprint mismatch",
  );
  return deepFreezeEvaluation(
    cloneJson(value) as unknown as BaselineValidationSeedSet,
  );
}
