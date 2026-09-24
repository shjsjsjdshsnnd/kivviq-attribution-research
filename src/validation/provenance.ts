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
      try {
        computedFingerprint = evaluationFingerprint(raw["value"]);
        fingerprints.push(computedFingerprint);
      } catch {
        addIssue(
          issues,
          "UNFINGERPRINTABLE_EVIDENCE_VALUE",
          `${path}.value`,
          "provenance evidence value must be deterministic JSON",
        );
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
