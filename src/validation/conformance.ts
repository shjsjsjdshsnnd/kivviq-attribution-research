import { actionFingerprint } from "../action_ontology/semantics.js";
import { evaluationFingerprint, stableEvaluationJson } from "../evaluation/baseline-contract.js";
import { assertCanonicalOperatorInputV2, canonicalInputFingerprint, ensureCanonicalOperatorV2, validateCanonicalDecisionEnvelope, type CanonicalOperatorInputV2, type CanonicalOperatorV2 } from "../operator/canonical-interface.js";
import type { CanonicalOperator } from "../operator/types.js";
import { FROZEN_BASELINE_VALIDATION_FIXTURES } from "./fixtures.js";
import type { BaselineValidationCheckId, BaselineValidationCheckResult } from "./contract.js";
import { hasExactKeys, isFingerprint, isNonEmptyString, isRecord, issue, result } from "./shared.js";

export type ExecutableProbeCheckId = "policy_semantics" | "permitted_information_sensitivity" | "prohibited_information_invariance" | "tie_breaking" | "missing_data_behavior" | "zero_action_behavior" | "multi_action_behavior";
export type DeclarativeProbeExpectation = { readonly kind: "exact"; readonly expectedDecisionFingerprints: readonly string[]; readonly expectedActionFingerprints: readonly (readonly string[])[] } | { readonly kind: "invariant" } | { readonly kind: "sensitive" } | { readonly kind: "zero_actions" } | { readonly kind: "multi_action" };
export interface DeclarativeProbeInvocation { readonly fixtureId: string; readonly canonicalInput: CanonicalOperatorInputV2; readonly inputFingerprint: string; }
/** Historical name retained for API compatibility; this type is declarative and has no callback. */
export interface ExecutableConformanceProbe { readonly probeId: string; readonly checkId: ExecutableProbeCheckId; readonly operatorId: string; readonly configurationFingerprint: string; readonly caseFingerprint: string; readonly invocations: readonly DeclarativeProbeInvocation[]; readonly expectation: DeclarativeProbeExpectation; }

const PROBE_KEYS = ["probeId", "checkId", "operatorId", "configurationFingerprint", "caseFingerprint", "invocations", "expectation"] as const;
const INVOCATION_KEYS = ["fixtureId", "canonicalInput", "inputFingerprint"] as const;
const EXPECTED_KIND: Record<ExecutableProbeCheckId, DeclarativeProbeExpectation["kind"]> = { policy_semantics: "exact", permitted_information_sensitivity: "sensitive", prohibited_information_invariance: "invariant", tie_breaking: "exact", missing_data_behavior: "exact", zero_action_behavior: "zero_actions", multi_action_behavior: "multi_action" };

export function baselineValidationCaseFingerprint(caseId: string, operatorId: string): string { return evaluationFingerprint({ caseId, operatorId }); }
export function canonicalProbeDecisionFingerprint(actionFingerprints: readonly string[]): string { return evaluationFingerprint(actionFingerprints); }

function bindings(input: CanonicalOperatorInputV2) {
  return { opportunityId: input.opportunityId, decisionTime: input.decisionTime, decisionContext: input.decisionContext, observationRecords: input.observation.records, legalActionSpace: input.legalActionSpace, constraints: input.constraints, evaluationContractFingerprint: input.provenance.evaluationContractFingerprint, evaluationContractVersion: input.provenance.evaluationContractVersion, observationFingerprint: input.provenance.observationFingerprint, legalActionSpaceFingerprint: input.provenance.legalActionSpaceFingerprint, actionOntologyVersion: input.provenance.actionOntologyVersion };
}

export function runExecutableConformanceProbe(operatorValue: CanonicalOperator | CanonicalOperatorV2, value: unknown, expectedCheckId: ExecutableProbeCheckId, caseId: string): BaselineValidationCheckResult {
  const fail = (code: string, message: string) => result(expectedCheckId, [issue(code, `evidence.${expectedCheckId}`, message)], []);
  let operator: CanonicalOperatorV2;
  try { operator = ensureCanonicalOperatorV2(operatorValue); } catch { return fail("INVALID_OPERATOR", "operator cannot be canonicalized"); }
  if (!isRecord(value) || !hasExactKeys(value, PROBE_KEYS)) return fail("INVALID_PROBE_EVIDENCE", "probe must have the exact declarative evidence shape");
  if (!isNonEmptyString(value["probeId"]) || value["checkId"] !== expectedCheckId || value["operatorId"] !== operator.metadata.operatorId || value["configurationFingerprint"] !== operator.metadata.configurationFingerprint || value["caseFingerprint"] !== baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId)) return fail("PROBE_BINDING_MISMATCH", "probe is not bound to the operator, configuration, case, and check");
  const expectation = value["expectation"];
  const expectedKind = EXPECTED_KIND[expectedCheckId];
  if (!isRecord(expectation) || expectation["kind"] !== expectedKind || (expectedKind === "exact" ? !hasExactKeys(expectation, ["kind", "expectedDecisionFingerprints", "expectedActionFingerprints"]) || !Array.isArray(expectation["expectedDecisionFingerprints"]) || !expectation["expectedDecisionFingerprints"].every(isFingerprint) || !Array.isArray(expectation["expectedActionFingerprints"]) || !expectation["expectedActionFingerprints"].every((entry) => Array.isArray(entry) && entry.every(isFingerprint)) : !hasExactKeys(expectation, ["kind"]))) return fail("INVALID_PROBE_EXPECTATION", "probe expectation is malformed or unsuitable for this check");
  if (!Array.isArray(value["invocations"]) || value["invocations"].length === 0) return fail("INVALID_PROBE_EVIDENCE", "probe requires canonical input invocations");
  const allowedFixtures = new Set(FROZEN_BASELINE_VALIDATION_FIXTURES.fixtures.map((entry) => entry.fixtureId));
  const observed: Array<{ actionFingerprints: readonly string[]; decisionFingerprint: string; inputFingerprint: string; fixtureId: string }> = [];
  for (const raw of value["invocations"]) {
    if (!isRecord(raw) || !hasExactKeys(raw, INVOCATION_KEYS) || !allowedFixtures.has(raw["fixtureId"] as never) || !isFingerprint(raw["inputFingerprint"])) return fail("INVALID_PROBE_INVOCATION", "probe invocation has invalid keys, fixture, or fingerprint");
    try {
      const input = assertCanonicalOperatorInputV2(raw["canonicalInput"], bindings(raw["canonicalInput"] as CanonicalOperatorInputV2));
      if (canonicalInputFingerprint(input) !== raw["inputFingerprint"]) return fail("PROBE_INPUT_FINGERPRINT_MISMATCH", "probe input fingerprint could not be recomputed");
      if (input.provenance.observationFingerprint !== evaluationFingerprint({ opportunityId: input.opportunityId, decisionTime: input.decisionTime, records: input.observation.records }) || input.provenance.legalActionSpaceFingerprint !== evaluationFingerprint({ opportunityId: input.opportunityId, rules: input.legalActionSpace.rules, mutualExclusionGroups: input.legalActionSpace.mutualExclusionGroups }) || input.provenance.evaluationContractFingerprint !== operator.metadata.supportedEvaluationContract.contractFingerprint || input.provenance.evaluationContractVersion !== operator.metadata.supportedEvaluationContract.contractVersion || input.provenance.actionOntologyVersion !== operator.metadata.supportedActionOntologyVersion) return fail("PROBE_INPUT_PROVENANCE_MISMATCH", "probe input provenance could not be independently recomputed or cross-bound");
      const decision = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      const actionFingerprints = decision.actions.map(actionFingerprint);
      observed.push({ actionFingerprints, decisionFingerprint: canonicalProbeDecisionFingerprint(actionFingerprints), inputFingerprint: raw["inputFingerprint"], fixtureId: raw["fixtureId"] as string });
    } catch { return fail("OPERATOR_INVOCATION_FAILED", "operator invocation or canonical decision validation failed"); }
  }
  const fingerprints = observed.map((entry) => entry.decisionFingerprint);
  let matches = false;
  if (expectedKind === "exact") matches = stableEvaluationJson(fingerprints) === stableEvaluationJson(expectation["expectedDecisionFingerprints"]) && stableEvaluationJson(observed.map((entry) => entry.actionFingerprints)) === stableEvaluationJson(expectation["expectedActionFingerprints"]);
  else if (expectedKind === "invariant") matches = new Set(fingerprints).size === 1 && observed.length >= 2;
  else if (expectedKind === "sensitive") matches = new Set(fingerprints).size > 1 && observed.length >= 2;
  else if (expectedKind === "zero_actions") matches = observed.every((entry) => entry.actionFingerprints.length === 0);
  else matches = observed.some((entry) => entry.actionFingerprints.length > 1);
  const evidenceFingerprint = evaluationFingerprint({ probeId: value["probeId"], checkId: expectedCheckId, operatorId: operator.metadata.operatorId, configurationFingerprint: operator.metadata.configurationFingerprint, caseFingerprint: value["caseFingerprint"], expectation, observed });
  return result(expectedCheckId, matches ? [] : [issue("PROBE_EXPECTATION_FAILED", `evidence.${expectedCheckId}`, "operator decisions did not satisfy the declared frozen expectation")], [evidenceFingerprint]);
}

export function failedValidationCheck(checkId: BaselineValidationCheckId, code: string, message: string): BaselineValidationCheckResult { return result(checkId, [issue(code, `checks.${checkId}`, message)], []); }
