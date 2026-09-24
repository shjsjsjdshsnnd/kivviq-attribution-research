import {
  deepFreezeEvaluation,
  evaluationFingerprint,
  stableEvaluationJson,
} from "../evaluation/baseline-contract.js";
import {
  BASELINE_VALIDATION_CONTRACT,
  BASELINE_VALIDATION_REQUIRED_CHECKS,
  BaselineValidationError,
  assertBaselineValidationFingerprint,
  type BaselineValidationCheckId,
  type BaselineValidationCheckResult,
  type BaselineValidationIssue,
  type BaselineValidationStatus,
} from "./contract.js";
import {
  BASELINE_CONFORMANCE_REPORT_SCHEMA_VERSION,
  BASELINE_VALIDATION_SUITE_VERSION,
} from "./version.js";

export interface BaselineValidationOperatorIdentity {
  readonly operatorId: string;
  readonly operatorVersion: string;
  readonly implementationFingerprint: string;
  readonly configurationFingerprint: string;
}

export interface BaselineConformanceEvidence {
  readonly operator: BaselineValidationOperatorIdentity;
  readonly checks: readonly BaselineValidationCheckResult[];
}

export interface BaselineConformanceReportBody {
  readonly kind: "baseline_conformance_report";
  readonly schemaVersion: typeof BASELINE_CONFORMANCE_REPORT_SCHEMA_VERSION;
  readonly validationSuiteVersion: typeof BASELINE_VALIDATION_SUITE_VERSION;
  readonly validationContractFingerprint: string;
  readonly operator: BaselineValidationOperatorIdentity;
  readonly checks: readonly BaselineValidationCheckResult[];
  readonly overall: BaselineValidationStatus;
  readonly evidenceFingerprint: string;
}

export interface BaselineConformanceReport extends BaselineConformanceReportBody {
  readonly reportFingerprint: string;
}

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
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

function requiredIndex(checkId: BaselineValidationCheckId): number {
  return BASELINE_VALIDATION_REQUIRED_CHECKS.indexOf(checkId);
}

function validateIssue(value: unknown): asserts value is BaselineValidationIssue {
  requireCondition(isRecord(value), "validation issue must be an object");
  assertExactKeys(value, ["code", "path", "message"], "validation issue");
  for (const field of ["code", "path", "message"] as const) {
    requireCondition(
      typeof value[field] === "string" && value[field].trim().length > 0,
      `validation issue ${field} must be a non-empty string`,
    );
  }
}

function normalizeIssue(issue: BaselineValidationIssue): BaselineValidationIssue {
  validateIssue(issue);
  return {
    code: issue.code,
    path: issue.path,
    message: issue.message,
  };
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

function normalizeCheck(value: unknown): BaselineValidationCheckResult {
  requireCondition(isRecord(value), "validation check result must be an object");
  assertExactKeys(
    value,
    ["checkId", "status", "evidenceFingerprints", "issues"],
    "validation check result",
  );
  const checkId = value["checkId"];
  requireCondition(
    typeof checkId === "string" &&
      (BASELINE_VALIDATION_REQUIRED_CHECKS as readonly string[]).includes(checkId),
    `unknown checkId: ${String(checkId)}`,
  );
  requireCondition(
    value["status"] === "PASS" || value["status"] === "FAIL",
    `invalid status for ${checkId}`,
  );
  requireCondition(
    Array.isArray(value["evidenceFingerprints"]),
    `evidenceFingerprints for ${checkId} must be an array`,
  );
  const evidenceFingerprints = [...value["evidenceFingerprints"]];
  for (const fingerprint of evidenceFingerprints) {
    assertBaselineValidationFingerprint(fingerprint, `${checkId} evidence fingerprint`);
  }
  requireCondition(
    Array.isArray(value["issues"]),
    `issues for ${checkId} must be an array`,
  );
  const issues = value["issues"].map(normalizeIssue).sort(compareIssues);
  return {
    checkId: checkId as BaselineValidationCheckId,
    status: value["status"] as BaselineValidationStatus,
    evidenceFingerprints: evidenceFingerprints.sort(),
    issues,
  };
}

function normalizeOperator(value: unknown): BaselineValidationOperatorIdentity {
  requireCondition(isRecord(value), "operator identity must be an object");
  assertExactKeys(
    value,
    [
      "operatorId",
      "operatorVersion",
      "implementationFingerprint",
      "configurationFingerprint",
    ],
    "operator identity",
  );
  requireCondition(
    typeof value["operatorId"] === "string" && value["operatorId"].trim().length > 0,
    "operatorId must be a non-empty string",
  );
  requireCondition(
    typeof value["operatorVersion"] === "string" &&
      value["operatorVersion"].trim().length > 0,
    "operatorVersion must be a non-empty string",
  );
  assertBaselineValidationFingerprint(
    value["implementationFingerprint"],
    "implementation fingerprint",
  );
  assertBaselineValidationFingerprint(
    value["configurationFingerprint"],
    "configuration fingerprint",
  );
  return {
    operatorId: value["operatorId"],
    operatorVersion: value["operatorVersion"],
    implementationFingerprint: value["implementationFingerprint"],
    configurationFingerprint: value["configurationFingerprint"],
  } as BaselineValidationOperatorIdentity;
}

function normalizeCompleteChecks(
  values: readonly unknown[],
): readonly BaselineValidationCheckResult[] {
  const normalized = values.map(normalizeCheck);
  const seen = new Set<BaselineValidationCheckId>();
  for (const check of normalized) {
    requireCondition(
      !seen.has(check.checkId),
      `duplicate check result: ${check.checkId}`,
    );
    seen.add(check.checkId);
  }

  const byId = new Map(normalized.map((check) => [check.checkId, check]));
  return BASELINE_VALIDATION_REQUIRED_CHECKS.map(
    (checkId): BaselineValidationCheckResult =>
      byId.get(checkId) ?? {
        checkId,
        status: "FAIL",
        evidenceFingerprints: [],
        issues: [
          {
            code: "MISSING_REQUIRED_EVIDENCE",
            path: `checks.${checkId}`,
            message: "required validation evidence is absent",
          },
        ],
      },
  );
}

function evidenceBody(report: {
  readonly operator: BaselineValidationOperatorIdentity;
  readonly checks: readonly BaselineValidationCheckResult[];
}): object {
  return {
    operator: report.operator,
    checks: report.checks,
  };
}

export function baselineConformanceEvidenceFingerprint(
  report: Pick<BaselineConformanceReport, "operator" | "checks">,
): string {
  return evaluationFingerprint(evidenceBody(report));
}

export function baselineConformanceReportFingerprint(
  report: BaselineConformanceReportBody | BaselineConformanceReport,
): string {
  const { reportFingerprint: _omitted, ...body } = report as
    BaselineConformanceReport & Record<string, unknown>;
  return evaluationFingerprint(body);
}

export function stableBaselineConformanceReportJson(
  report: BaselineConformanceReport,
): string {
  return stableEvaluationJson(report);
}

export function createBaselineConformanceReport(
  evidence: BaselineConformanceEvidence,
): BaselineConformanceReport {
  requireCondition(isRecord(evidence), "conformance evidence must be an object");
  assertExactKeys(evidence, ["operator", "checks"], "conformance evidence");
  requireCondition(Array.isArray(evidence.checks), "checks must be an array");
  const operator = normalizeOperator(evidence.operator);
  const checks = normalizeCompleteChecks(evidence.checks);
  const overall = checks.every((check) => check.status === "PASS")
    ? "PASS"
    : "FAIL";
  const body: BaselineConformanceReportBody = {
    kind: "baseline_conformance_report",
    schemaVersion: BASELINE_CONFORMANCE_REPORT_SCHEMA_VERSION,
    validationSuiteVersion: BASELINE_VALIDATION_SUITE_VERSION,
    validationContractFingerprint:
      BASELINE_VALIDATION_CONTRACT.contractFingerprint,
    operator,
    checks,
    overall,
    evidenceFingerprint: evaluationFingerprint(evidenceBody({ operator, checks })),
  };
  return deepFreezeEvaluation({
    ...body,
    reportFingerprint: evaluationFingerprint(body),
  });
}

export function validateBaselineConformanceReport(
  value: unknown,
): BaselineConformanceReport {
  requireCondition(isRecord(value), "conformance report must be an object");
  assertExactKeys(
    value,
    [
      "kind",
      "schemaVersion",
      "validationSuiteVersion",
      "validationContractFingerprint",
      "operator",
      "checks",
      "overall",
      "evidenceFingerprint",
      "reportFingerprint",
    ],
    "conformance report",
  );
  requireCondition(
    value["kind"] === "baseline_conformance_report",
    "report kind mismatch",
  );
  requireCondition(
    value["schemaVersion"] === BASELINE_CONFORMANCE_REPORT_SCHEMA_VERSION,
    "report schema version mismatch",
  );
  requireCondition(
    value["validationSuiteVersion"] === BASELINE_VALIDATION_SUITE_VERSION,
    "validation suite version mismatch",
  );
  requireCondition(
    value["validationContractFingerprint"] ===
      BASELINE_VALIDATION_CONTRACT.contractFingerprint,
    "validation contract fingerprint mismatch",
  );
  const operator = normalizeOperator(value["operator"]);
  requireCondition(Array.isArray(value["checks"]), "checks must be an array");
  const rawChecks = value["checks"];
  const normalizedChecks = rawChecks.map(normalizeCheck);
  const ids = normalizedChecks.map((check) => check.checkId);
  requireCondition(
    new Set(ids).size === ids.length,
    "duplicate check result in conformance report",
  );
  requireCondition(
    ids.length === BASELINE_VALIDATION_REQUIRED_CHECKS.length &&
      BASELINE_VALIDATION_REQUIRED_CHECKS.every((checkId) => ids.includes(checkId)),
    "required check coverage mismatch",
  );
  requireCondition(
    normalizedChecks.every(
      (check, index) => requiredIndex(check.checkId) === index,
    ),
    "checks must be in contract order",
  );
  requireCondition(
    stableEvaluationJson(rawChecks) === stableEvaluationJson(normalizedChecks),
    "checks are not canonically normalized",
  );
  const expectedOverall = normalizedChecks.every(
    (check) => check.status === "PASS",
  )
    ? "PASS"
    : "FAIL";
  requireCondition(
    value["overall"] === expectedOverall,
    "overall status mismatch",
  );
  assertBaselineValidationFingerprint(
    value["evidenceFingerprint"],
    "evidence fingerprint",
  );
  const expectedEvidenceFingerprint = evaluationFingerprint(
    evidenceBody({ operator, checks: normalizedChecks }),
  );
  requireCondition(
    value["evidenceFingerprint"] === expectedEvidenceFingerprint,
    "evidence fingerprint mismatch",
  );
  assertBaselineValidationFingerprint(
    value["reportFingerprint"],
    "report fingerprint",
  );
  requireCondition(
    value["reportFingerprint"] ===
      baselineConformanceReportFingerprint(
        value as unknown as BaselineConformanceReport,
      ),
    "report fingerprint mismatch",
  );
  return deepFreezeEvaluation(
    cloneJson(value) as unknown as BaselineConformanceReport,
  );
}
