import {
  deepFreezeEvaluation,
  evaluationFingerprint,
} from "../evaluation/baseline-contract.js";
import {
  BASELINE_VALIDATION_FINGERPRINT_PATTERN,
  type BaselineValidationCheckResult,
  type BaselineValidationIssue,
} from "./contract.js";

export interface RecordedFingerprintEvidence {
  readonly label: string;
  readonly value: unknown;
  readonly recordedFingerprint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssues(
  left: BaselineValidationIssue,
  right: BaselineValidationIssue,
): number {
  return (
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.path, right.path) ||
    compareCodeUnits(left.message, right.message)
  );
}

function result(
  issues: readonly BaselineValidationIssue[],
  fingerprints: readonly string[],
): BaselineValidationCheckResult {
  return deepFreezeEvaluation({
    checkId: "provenance_integrity",
    status: issues.length === 0 ? "PASS" : "FAIL",
    evidenceFingerprints: [...fingerprints].sort(compareCodeUnits),
    issues: [...issues].sort(compareIssues),
  });
}

function addIssue(
  issues: BaselineValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function isStrictDeterministicJson(
  value: unknown,
  ancestors = new Set<object>(),
): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;

  const object = value as object;
  if (ancestors.has(object)) return false;
  ancestors.add(object);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)),
        )
      ) {
        return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor) ||
          !isStrictDeterministicJson(descriptor.value, ancestors)
        ) {
          return false;
        }
      }
      return true;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor) ||
        !isStrictDeterministicJson(descriptor.value, ancestors)
      ) {
        return false;
      }
    }
    return true;
  } finally {
    ancestors.delete(object);
  }
}

export function validateRecordedFingerprint(
  input: RecordedFingerprintEvidence,
): BaselineValidationCheckResult {
  return validateProvenanceEvidence([input]);
}

export function validateProvenanceEvidence(
  evidence: readonly RecordedFingerprintEvidence[],
): BaselineValidationCheckResult {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return result(
      [
        {
          code: "EMPTY_PROVENANCE_EVIDENCE",
          path: "evidence",
          message: "provenance evidence must not be empty",
        },
      ],
      [],
    );
  }

  const issues: BaselineValidationIssue[] = [];
  const fingerprints: string[] = [];
  const seenLabels = new Set<string>();
  const expectedKeys = new Set(["label", "value", "recordedFingerprint"]);

  for (const [index, raw] of evidence.entries()) {
    const indexPath = `evidence[${index}]`;
    if (!isRecord(raw)) {
      addIssue(
        issues,
        "INVALID_EVIDENCE_ENTRY",
        indexPath,
        "provenance evidence entry must be an object",
      );
      continue;
    }

    const labelValue = raw["label"];
    const validLabel =
      typeof labelValue === "string" && labelValue.trim().length > 0;
    const path = validLabel ? `evidence.${labelValue}` : indexPath;
    if (!validLabel) {
      addIssue(
        issues,
        "INVALID_EVIDENCE_LABEL",
        `${indexPath}.label`,
        "provenance evidence label must be a non-empty string",
      );
    } else if (seenLabels.has(labelValue)) {
      addIssue(
        issues,
        "DUPLICATE_EVIDENCE_LABEL",
        `${path}.label`,
        `duplicate provenance evidence label: ${labelValue}`,
      );
    } else {
      seenLabels.add(labelValue);
    }

    for (const key of Object.keys(raw)) {
      if (!expectedKeys.has(key)) {
        addIssue(
          issues,
          "UNKNOWN_EVIDENCE_KEY",
          `${path}.${key}`,
          `unknown provenance evidence key: ${key}`,
        );
      }
    }
    if (!("value" in raw)) {
      addIssue(
        issues,
        "MISSING_EVIDENCE_VALUE",
        `${path}.value`,
        "provenance evidence value is required",
      );
    }

    let computedFingerprint: string | undefined;
    if ("value" in raw) {
      if (!isStrictDeterministicJson(raw["value"])) {
        addIssue(
          issues,
          "INVALID_PROVENANCE_VALUE",
          `${path}.value`,
          "provenance evidence value must be strict deterministic JSON",
        );
      } else {
        computedFingerprint = evaluationFingerprint(raw["value"]);
        fingerprints.push(computedFingerprint);
      }
    }

    const recordedFingerprint = raw["recordedFingerprint"];
    if (
      typeof recordedFingerprint !== "string" ||
      !BASELINE_VALIDATION_FINGERPRINT_PATTERN.test(recordedFingerprint)
    ) {
      addIssue(
        issues,
        "MALFORMED_RECORDED_FINGERPRINT",
        `${path}.recordedFingerprint`,
        "recorded fingerprint must match fnv1a64:<16 lowercase hexadecimal digits>",
      );
    } else if (
      computedFingerprint !== undefined &&
      recordedFingerprint !== computedFingerprint
    ) {
      addIssue(
        issues,
        "FINGERPRINT_MISMATCH",
        `${path}.recordedFingerprint`,
        "recorded fingerprint does not match the independently recomputed value",
      );
    }
  }

  return result(issues, fingerprints);
}
