import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { deepFreezeEvaluation, evaluationFingerprint, stableEvaluationJson } from "../evaluation/baseline-contract.js";
import type { BaselineValidationCheckId, BaselineValidationCheckResult } from "./contract.js";
import { hasExactKeys, isNonEmptyString, isRecord, isStrictJson, issue, result } from "./shared.js";

export type ExecutableProbeCheckId =
  | "policy_semantics"
  | "permitted_information_sensitivity"
  | "tie_breaking"
  | "missing_data_behavior"
  | "zero_action_behavior"
  | "multi_action_behavior";

export type ExecutableProbeExpectation = "equal" | "different" | "zero_actions" | "multiple_actions";

export interface ExecutableProbeObservation {
  readonly beforeActions: readonly unknown[];
  readonly afterActions: readonly unknown[];
}

export interface ExecutableConformanceProbe {
  readonly probeId: string;
  readonly checkId: ExecutableProbeCheckId;
  readonly operatorId: string;
  readonly caseFingerprint: string;
  readonly expectation: ExecutableProbeExpectation;
  execute(): ExecutableProbeObservation;
}

const EXPECTATION_BY_CHECK: Readonly<Record<ExecutableProbeCheckId, ExecutableProbeExpectation>> = {
  policy_semantics: "equal",
  permitted_information_sensitivity: "different",
  tie_breaking: "equal",
  missing_data_behavior: "equal",
  zero_action_behavior: "zero_actions",
  multi_action_behavior: "multiple_actions",
};

export function baselineValidationCaseFingerprint(caseId: string, operatorId: string): string {
  return evaluationFingerprint({ caseId, operatorId });
}

export function runExecutableConformanceProbe(
  value: unknown,
  expectedCheckId: ExecutableProbeCheckId,
  caseId: string,
  operatorId: string,
): BaselineValidationCheckResult {
  const invalid = (code: string, message: string) => result(expectedCheckId, [issue(code, `evidence.${expectedCheckId}`, message)], []);
  if (!isRecord(value) || !hasExactKeys(value, ["probeId", "checkId", "operatorId", "caseFingerprint", "expectation", "execute"])) return invalid("INVALID_PROBE_EVIDENCE", "probe must have the exact executable evidence shape");
  if (!isNonEmptyString(value["probeId"]) || value["checkId"] !== expectedCheckId || value["operatorId"] !== operatorId || value["caseFingerprint"] !== baselineValidationCaseFingerprint(caseId, operatorId) || value["expectation"] !== EXPECTATION_BY_CHECK[expectedCheckId] || typeof value["execute"] !== "function") return invalid("PROBE_BINDING_MISMATCH", "probe is not cross-bound to the operator, case, check, and required expectation");

  let observed: unknown;
  try { observed = (value["execute"] as () => unknown)(); } catch (error) {
    return invalid("PROBE_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(observed) || !hasExactKeys(observed, ["beforeActions", "afterActions"]) || !isStrictJson(observed) || !Array.isArray(observed["beforeActions"]) || !Array.isArray(observed["afterActions"])) return invalid("INVALID_PROBE_RESULT", "probe result must be exact-key strict JSON containing Action arrays");
  let before: readonly string[];
  let after: readonly string[];
  try {
    before = observed["beforeActions"].map((entry) => actionFingerprint(assertValidAction(entry as never)));
    after = observed["afterActions"].map((entry) => actionFingerprint(assertValidAction(entry as never)));
  } catch (error) {
    return invalid("INVALID_PROBE_ACTION", error instanceof Error ? error.message : String(error));
  }
  const expectation = value["expectation"] as ExecutableProbeExpectation;
  const matches = expectation === "equal" ? stableEvaluationJson(before) === stableEvaluationJson(after)
    : expectation === "different" ? stableEvaluationJson(before) !== stableEvaluationJson(after)
      : expectation === "zero_actions" ? before.length === 0 && after.length === 0
        : before.length > 1 || after.length > 1;
  const evidence = { probeId: value["probeId"], checkId: expectedCheckId, operatorId, caseFingerprint: value["caseFingerprint"], expectation, beforeActionFingerprints: before, afterActionFingerprints: after };
  return deepFreezeEvaluation(result(expectedCheckId, matches ? [] : [issue("PROBE_EXPECTATION_FAILED", `evidence.${expectedCheckId}`, "observed decisions do not satisfy the required executable probe expectation")], [evaluationFingerprint(evidence)]));
}

export function failedValidationCheck(checkId: BaselineValidationCheckId, code: string, message: string): BaselineValidationCheckResult {
  return result(checkId, [issue(code, `checks.${checkId}`, message)], []);
}
