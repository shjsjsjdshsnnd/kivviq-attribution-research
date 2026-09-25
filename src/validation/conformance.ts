import { actionFingerprint } from "../action_ontology/semantics.js";
import { evaluationFingerprint, stableEvaluationJson } from "../evaluation/baseline-contract.js";
import { assertCanonicalOperatorInputV2, canonicalInputFingerprint, ensureCanonicalOperatorV2, validateCanonicalDecisionEnvelope, type CanonicalOperatorInputV2, type CanonicalOperatorV2 } from "../operator/canonical-interface.js";
import type { CanonicalOperator } from "../operator/types.js";
import { FROZEN_BASELINE_VALIDATION_FIXTURES } from "./fixtures.js";
import { canonicalPolicyDecisionFingerprint, validateProhibitedInformationInvariance, type InformationIsolationPair } from "./leakage.js";
import type { BaselineValidationCheckId, BaselineValidationCheckResult } from "./contract.js";
import { hasExactKeys, isFingerprint, isNonEmptyString, isRecord, isStrictJson, issue, result } from "./shared.js";

export type ExecutableProbeCheckId = "policy_semantics" | "permitted_information_sensitivity" | "tie_breaking" | "missing_data_behavior" | "zero_action_behavior" | "multi_action_behavior";
export type DeclarativeProbeExpectation = { readonly kind: "exact"; readonly expectedDecisionFingerprints: readonly string[]; readonly expectedActionFingerprints: readonly (readonly string[])[] } | { readonly kind: "sensitive"; readonly observationKeys: readonly string[] } | { readonly kind: "zero_actions" } | { readonly kind: "multi_action" } | { readonly kind: "not_applicable"; readonly disposition: "NOT_APPLICABLE_BY_FROZEN_CAPABILITY"; readonly reasonCode: "ZERO_ACTION_CAPABILITY" | "MAXIMUM_ACTIONS_PER_DECISION_LE_ONE" | "FROZEN_SINGLE_EMISSION_SEMANTICS" };
export interface DeclarativeProbeInvocation { readonly fixtureId: string; readonly canonicalInput: CanonicalOperatorInputV2; readonly inputFingerprint: string; }
/** Historical name retained for API compatibility; this type is declarative and has no callback. */
export interface ExecutableConformanceProbe { readonly probeId: string; readonly checkId: ExecutableProbeCheckId; readonly operatorId: string; readonly configurationFingerprint: string; readonly caseFingerprint: string; readonly invocations: readonly DeclarativeProbeInvocation[]; readonly expectation: DeclarativeProbeExpectation; readonly probeFingerprint: string; }

const PROBE_KEYS = ["probeId", "checkId", "operatorId", "configurationFingerprint", "caseFingerprint", "invocations", "expectation", "probeFingerprint"] as const;
const INVOCATION_KEYS = ["fixtureId", "canonicalInput", "inputFingerprint"] as const;
const EXPECTED_KINDS: Record<ExecutableProbeCheckId, readonly DeclarativeProbeExpectation["kind"][]> = {
  policy_semantics: ["exact"],
  permitted_information_sensitivity: ["sensitive", "not_applicable"],
  tie_breaking: ["exact"],
  missing_data_behavior: ["exact"],
  zero_action_behavior: ["zero_actions"],
  multi_action_behavior: ["multi_action", "not_applicable"],
};

export interface ProhibitedInformationProbePair { readonly pairId: string; readonly leftFixtureId: string; readonly rightFixtureId: string; readonly leftInput: CanonicalOperatorInputV2; readonly rightInput: CanonicalOperatorInputV2; readonly leftWitness: object; readonly rightWitness: object; readonly leftWitnessFingerprint: string; readonly rightWitnessFingerprint: string; }
export interface ProhibitedInformationProbe { readonly probeId: string; readonly checkId: "prohibited_information_invariance"; readonly operatorId: string; readonly configurationFingerprint: string; readonly caseFingerprint: string; readonly pairs: readonly ProhibitedInformationProbePair[]; readonly probeFingerprint: string; }
const PROHIBITED_KEYS = ["probeId", "checkId", "operatorId", "configurationFingerprint", "caseFingerprint", "pairs", "probeFingerprint"] as const;
const PROHIBITED_PAIR_KEYS = ["pairId", "leftFixtureId", "rightFixtureId", "leftInput", "rightInput", "leftWitness", "rightWitness", "leftWitnessFingerprint", "rightWitnessFingerprint"] as const;

export function baselineValidationCaseFingerprint(caseId: string, operatorId: string): string { return evaluationFingerprint({ caseId, operatorId }); }
export function canonicalProbeDecisionFingerprint(actionFingerprints: readonly string[]): string { return evaluationFingerprint(actionFingerprints); }
export function declarativeProbeFingerprint(value: object): string { const { probeFingerprint: _omitted, ...body } = value as Record<string, unknown>; return evaluationFingerprint(body); }

const FIXTURE_CATEGORY: Record<ExecutableProbeCheckId, string> = { policy_semantics: "policy_semantics", permitted_information_sensitivity: "action_ontology_conformance", tie_breaking: "tie_breaking", missing_data_behavior: "missing_data_behavior", zero_action_behavior: "zero_action_behavior", multi_action_behavior: "multi_action_behavior" };
function compatibleFixture(fixtureId: unknown, category: string): boolean { return typeof fixtureId === "string" && FROZEN_BASELINE_VALIDATION_FIXTURES.fixtures.some((entry) => entry.fixtureId === fixtureId && (entry.evidenceCategories as readonly string[]).includes(category)); }

function bindings(input: CanonicalOperatorInputV2) {
  return { opportunityId: input.opportunityId, decisionTime: input.decisionTime, decisionContext: input.decisionContext, observationRecords: input.observation.records, legalActionSpace: input.legalActionSpace, constraints: input.constraints, evaluationContractFingerprint: input.provenance.evaluationContractFingerprint, evaluationContractVersion: input.provenance.evaluationContractVersion, observationFingerprint: input.provenance.observationFingerprint, legalActionSpaceFingerprint: input.provenance.legalActionSpaceFingerprint, actionOntologyVersion: input.provenance.actionOntologyVersion };
}

function sensitivityControlProjection(input: CanonicalOperatorInputV2): object {
  const { observationFingerprint: _observationFingerprint, ...controlProvenance } = input.provenance;
  return {
    schemaVersion: input.schemaVersion,
    opportunityId: input.opportunityId,
    decisionTime: input.decisionTime,
    decisionContext: input.decisionContext,
    legalActionSpace: input.legalActionSpace,
    constraints: input.constraints,
    provenance: controlProvenance,
  };
}

export function runExecutableConformanceProbe(operatorValue: CanonicalOperator | CanonicalOperatorV2, value: unknown, expectedCheckId: ExecutableProbeCheckId, caseId: string): BaselineValidationCheckResult {
  const fail = (code: string, message: string) => result(expectedCheckId, [issue(code, `evidence.${expectedCheckId}`, message)], []);
  let operator: CanonicalOperatorV2;
  try { operator = ensureCanonicalOperatorV2(operatorValue); } catch { return fail("INVALID_OPERATOR", "operator cannot be canonicalized"); }
  if (!isRecord(value) || !hasExactKeys(value, PROBE_KEYS)) return fail("INVALID_PROBE_EVIDENCE", "probe must have the exact declarative evidence shape");
  if (!isStrictJson(value)) return fail("INVALID_PROBE_EVIDENCE", "probe must contain strict JSON evidence");
  if (!isNonEmptyString(value["probeId"]) || value["checkId"] !== expectedCheckId || value["operatorId"] !== operator.metadata.operatorId || value["configurationFingerprint"] !== operator.metadata.configurationFingerprint || value["caseFingerprint"] !== baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId)) return fail("PROBE_BINDING_MISMATCH", "probe is not bound to the operator, configuration, case, and check");
  const expectation = value["expectation"];
  const expectedKind = isRecord(expectation) ? expectation["kind"] : undefined;
  const permittedKinds = EXPECTED_KINDS[expectedCheckId];
  if (!isRecord(expectation) || typeof expectedKind !== "string" || !permittedKinds.includes(expectedKind as DeclarativeProbeExpectation["kind"]) || (expectedKind === "exact" ? !hasExactKeys(expectation, ["kind", "expectedDecisionFingerprints", "expectedActionFingerprints"]) || !Array.isArray(expectation["expectedDecisionFingerprints"]) || !expectation["expectedDecisionFingerprints"].every(isFingerprint) || !Array.isArray(expectation["expectedActionFingerprints"]) || !expectation["expectedActionFingerprints"].every((entry) => Array.isArray(entry) && entry.every(isFingerprint)) : expectedKind === "sensitive" ? !hasExactKeys(expectation, ["kind", "observationKeys"]) || !Array.isArray(expectation["observationKeys"]) || expectation["observationKeys"].length === 0 || !expectation["observationKeys"].every(isNonEmptyString) || new Set(expectation["observationKeys"]).size !== expectation["observationKeys"].length : expectedKind === "not_applicable" ? !hasExactKeys(expectation, ["kind", "disposition", "reasonCode"]) || expectation["disposition"] !== "NOT_APPLICABLE_BY_FROZEN_CAPABILITY" || !["ZERO_ACTION_CAPABILITY", "MAXIMUM_ACTIONS_PER_DECISION_LE_ONE", "FROZEN_SINGLE_EMISSION_SEMANTICS"].includes(expectation["reasonCode"] as string) : !hasExactKeys(expectation, ["kind"]))) return fail("INVALID_PROBE_EXPECTATION", "probe expectation is malformed or unsuitable for this check");
  if (expectedKind === "not_applicable") {
    const authoritativeMaximum = operator.metadata.capabilities.maximumActionsPerDecision;
    const frozenSingleEmissionSemantics = new Set([
      "baseline.promotion.fixed_promotional_calendar",
    ]).has(operator.metadata.operatorId);
    const reasonCode = expectation["reasonCode"];
    const justified = expectedCheckId === "multi_action_behavior"
      ? authoritativeMaximum <= 1
        ? reasonCode === "MAXIMUM_ACTIONS_PER_DECISION_LE_ONE"
        : frozenSingleEmissionSemantics && reasonCode === "FROZEN_SINGLE_EMISSION_SEMANTICS"
      : expectedCheckId === "permitted_information_sensitivity" && authoritativeMaximum === 0 && reasonCode === "ZERO_ACTION_CAPABILITY";
    if (!justified) return fail("NOT_APPLICABLE_NOT_AUTHORIZED", "frozen operator capability does not make this check inapplicable");
  }
  if (!Array.isArray(value["invocations"]) || value["invocations"].length === 0) return fail("INVALID_PROBE_EVIDENCE", "probe requires canonical input invocations");
  for (const raw of value["invocations"]) {
    if (!isRecord(raw) || !hasExactKeys(raw, INVOCATION_KEYS) || !isRecord(raw["canonicalInput"]) || !compatibleFixture(raw["fixtureId"], FIXTURE_CATEGORY[expectedCheckId]) || !isFingerprint(raw["inputFingerprint"])) return fail("INVALID_PROBE_INVOCATION", "probe invocation has invalid keys or a fixture incompatible with this check");
  }
  try {
    if (!isFingerprint(value["probeFingerprint"]) || value["probeFingerprint"] !== declarativeProbeFingerprint(value)) return fail("PROBE_FINGERPRINT_MISMATCH", "probe evidence fingerprint could not be recomputed");
  } catch { return fail("PROBE_FINGERPRINT_MISMATCH", "probe evidence fingerprint could not be recomputed"); }
  const observed: Array<{ actionFingerprints: readonly string[]; decisionFingerprint: string; inputFingerprint: string; fixtureId: string }> = [];
  const validatedInputs: CanonicalOperatorInputV2[] = [];
  for (const raw of value["invocations"]) {
    try {
      const input = assertCanonicalOperatorInputV2(raw["canonicalInput"], bindings(raw["canonicalInput"] as CanonicalOperatorInputV2));
      if (canonicalInputFingerprint(input) !== raw["inputFingerprint"]) return fail("PROBE_INPUT_FINGERPRINT_MISMATCH", "probe input fingerprint could not be recomputed");
      if (input.provenance.observationFingerprint !== evaluationFingerprint({ opportunityId: input.opportunityId, decisionTime: input.decisionTime, records: input.observation.records }) || input.provenance.legalActionSpaceFingerprint !== evaluationFingerprint({ opportunityId: input.opportunityId, rules: input.legalActionSpace.rules, mutualExclusionGroups: input.legalActionSpace.mutualExclusionGroups }) || input.provenance.evaluationContractFingerprint !== operator.metadata.supportedEvaluationContract.contractFingerprint || input.provenance.evaluationContractVersion !== operator.metadata.supportedEvaluationContract.contractVersion || input.provenance.actionOntologyVersion !== operator.metadata.supportedActionOntologyVersion) return fail("PROBE_INPUT_PROVENANCE_MISMATCH", "probe input provenance could not be independently recomputed or cross-bound");
      const first = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      const second = validateCanonicalDecisionEnvelope(input, operator.metadata, operator.decide(input));
      const actionFingerprints = first.actions.map(actionFingerprint);
      if (canonicalProbeDecisionFingerprint(actionFingerprints) !== canonicalProbeDecisionFingerprint(second.actions.map(actionFingerprint))) return fail("NONDETERMINISTIC_PROBE_DECISION", "operator decision changed across repeated identical probe input");
      observed.push({ actionFingerprints, decisionFingerprint: canonicalProbeDecisionFingerprint(actionFingerprints), inputFingerprint: raw["inputFingerprint"], fixtureId: raw["fixtureId"] as string });
      validatedInputs.push(input);
    } catch { return fail("OPERATOR_INVOCATION_FAILED", "operator invocation or canonical decision validation failed"); }
  }
  const fingerprints = observed.map((entry) => entry.decisionFingerprint);
  const isPermittedInformationProbe = expectedCheckId === "permitted_information_sensitivity" && expectedKind !== "not_applicable";
  if (isPermittedInformationProbe && new Set(observed.map((entry) => entry.inputFingerprint)).size < 2) return fail("SENSITIVE_PROBE_REQUIRES_DISTINCT_INPUTS", "sensitivity evidence requires at least two distinct canonical inputs");
  if (isPermittedInformationProbe) {
    const controls = validatedInputs.map((entry) => stableEvaluationJson(sensitivityControlProjection(entry)));
    if (new Set(controls).size !== 1) return fail("SENSITIVE_PROBE_CONTROL_MISMATCH", "sensitivity evidence may vary only permitted observation data");
    if (new Set(validatedInputs.map((entry) => entry.provenance.observationFingerprint)).size < 2) return fail("SENSITIVE_PROBE_REQUIRES_OBSERVATION_VARIATION", "sensitivity evidence requires distinct permitted observations");
    const permittedKeys = new Set(expectation["observationKeys"] as string[]);
    const firstRecords = validatedInputs[0]!.observation.records;
    for (const candidate of validatedInputs.slice(1)) {
      if (candidate.observation.records.length !== firstRecords.length) return fail("SENSITIVE_PROBE_OBSERVATION_SCOPE_MISMATCH", "sensitivity evidence must preserve observation record structure");
      let changed = false;
      for (let index = 0; index < firstRecords.length; index += 1) {
        const left = firstRecords[index]!; const right = candidate.observation.records[index]!;
        const { value: leftValue, ...leftControl } = left; const { value: rightValue, ...rightControl } = right;
        if (stableEvaluationJson(leftControl) !== stableEvaluationJson(rightControl)) return fail("SENSITIVE_PROBE_OBSERVATION_SCOPE_MISMATCH", "sensitivity evidence may not vary observation identity or provenance");
        if (stableEvaluationJson(leftValue) !== stableEvaluationJson(rightValue)) {
          changed = true;
          if (!permittedKeys.has(left.observationKey)) return fail("SENSITIVE_PROBE_UNPERMITTED_OBSERVATION", "sensitivity evidence varied an undeclared observation");
        }
      }
      if (!changed) return fail("SENSITIVE_PROBE_REQUIRES_OBSERVATION_VARIATION", "sensitivity evidence requires a changed declared observation value");
    }
  }
  let matches = false;
  if (expectedKind === "exact") matches = stableEvaluationJson(fingerprints) === stableEvaluationJson(expectation["expectedDecisionFingerprints"]) && stableEvaluationJson(observed.map((entry) => entry.actionFingerprints)) === stableEvaluationJson(expectation["expectedActionFingerprints"]);
  else if (expectedKind === "sensitive") matches = new Set(fingerprints).size > 1 && observed.length >= 2;
  else if (expectedKind === "not_applicable") matches = true;
  else if (expectedKind === "zero_actions") matches = observed.every((entry) => entry.actionFingerprints.length === 0);
  else matches = observed.some((entry) => entry.actionFingerprints.length > 1);
  const evidenceFingerprint = evaluationFingerprint({ probeId: value["probeId"], checkId: expectedCheckId, operatorId: operator.metadata.operatorId, configurationFingerprint: operator.metadata.configurationFingerprint, caseFingerprint: value["caseFingerprint"], expectation, observed });
  return result(expectedCheckId, matches ? [] : [issue("PROBE_EXPECTATION_FAILED", `evidence.${expectedCheckId}`, "operator decisions did not satisfy the declared frozen expectation")], [evidenceFingerprint]);
}

export function runProhibitedInformationProbe(operatorValue: CanonicalOperator | CanonicalOperatorV2, value: unknown, caseId: string): BaselineValidationCheckResult {
  const fail = (code: string, message: string) => result("prohibited_information_invariance", [issue(code, "evidence.prohibited_information_invariance", message)], []);
  let operator: CanonicalOperatorV2;
  try { operator = ensureCanonicalOperatorV2(operatorValue); } catch { return fail("INVALID_OPERATOR", "operator cannot be canonicalized"); }
  if (!isRecord(value) || !hasExactKeys(value, PROHIBITED_KEYS) || !isStrictJson(value) || value["checkId"] !== "prohibited_information_invariance" || !isNonEmptyString(value["probeId"]) || value["operatorId"] !== operator.metadata.operatorId || value["configurationFingerprint"] !== operator.metadata.configurationFingerprint || value["caseFingerprint"] !== baselineValidationCaseFingerprint(caseId, operator.metadata.operatorId) || !Array.isArray(value["pairs"]) || value["pairs"].length === 0) return fail("INVALID_PAIRED_EVIDENCE", "paired probe shape or operator binding is invalid");
  const pairIds = new Set<string>();
  for (const raw of value["pairs"]) {
    if (!isRecord(raw) || !hasExactKeys(raw, PROHIBITED_PAIR_KEYS) || !isRecord(raw["leftInput"]) || !isRecord(raw["rightInput"]) || !isRecord(raw["leftWitness"]) || !isRecord(raw["rightWitness"]) || !isStrictJson(raw["leftWitness"]) || !isStrictJson(raw["rightWitness"]) || !isNonEmptyString(raw["pairId"]) || pairIds.has(raw["pairId"] as string) || !compatibleFixture(raw["leftFixtureId"], "prohibited_information_invariance") || !compatibleFixture(raw["rightFixtureId"], "prohibited_information_invariance") || !isFingerprint(raw["leftWitnessFingerprint"]) || !isFingerprint(raw["rightWitnessFingerprint"]) || raw["leftWitnessFingerprint"] !== evaluationFingerprint(raw["leftWitness"]) || raw["rightWitnessFingerprint"] !== evaluationFingerprint(raw["rightWitness"]) || raw["leftWitnessFingerprint"] === raw["rightWitnessFingerprint"]) return fail("INVALID_PAIRED_EVIDENCE", "pair keys, fixture bindings, identifiers, or witness fingerprints are invalid");
    pairIds.add(raw["pairId"]);
  }
  try {
    if (!isFingerprint(value["probeFingerprint"]) || value["probeFingerprint"] !== declarativeProbeFingerprint(value)) return fail("PROBE_FINGERPRINT_MISMATCH", "paired probe evidence fingerprint could not be recomputed");
  } catch { return fail("PROBE_FINGERPRINT_MISMATCH", "paired probe evidence fingerprint could not be recomputed"); }
  const generated: InformationIsolationPair[] = [];
  for (const raw of value["pairs"]) {
    try {
      const leftInput = assertCanonicalOperatorInputV2(raw["leftInput"], bindings(raw["leftInput"] as CanonicalOperatorInputV2));
      const rightInput = assertCanonicalOperatorInputV2(raw["rightInput"], bindings(raw["rightInput"] as CanonicalOperatorInputV2));
      const leftInputFingerprint = canonicalInputFingerprint(leftInput);
      const rightInputFingerprint = canonicalInputFingerprint(rightInput);
      if (leftInputFingerprint !== rightInputFingerprint || stableEvaluationJson(leftInput) !== stableEvaluationJson(rightInput)) return fail("INVALID_PAIRED_EVIDENCE", "paired visible canonical inputs must be identical");
      const leftDecision = validateCanonicalDecisionEnvelope(leftInput, operator.metadata, operator.decide(leftInput));
      const rightDecision = validateCanonicalDecisionEnvelope(rightInput, operator.metadata, operator.decide(rightInput));
      generated.push({ pairId: raw["pairId"], baseline: { visibleInputFingerprint: leftInputFingerprint, witness: raw["leftWitness"] as object, witnessFingerprint: raw["leftWitnessFingerprint"], decisionFingerprint: canonicalPolicyDecisionFingerprint(leftDecision.actions), actions: leftDecision.actions }, variant: { visibleInputFingerprint: rightInputFingerprint, witness: raw["rightWitness"] as object, witnessFingerprint: raw["rightWitnessFingerprint"], decisionFingerprint: canonicalPolicyDecisionFingerprint(rightDecision.actions), actions: rightDecision.actions } });
    } catch { return fail("OPERATOR_INVOCATION_FAILED", "operator invocation or paired canonical decision validation failed"); }
  }
  return validateProhibitedInformationInvariance(generated);
}

export function failedValidationCheck(checkId: BaselineValidationCheckId, code: string, message: string): BaselineValidationCheckResult { return result(checkId, [issue(code, `checks.${checkId}`, message)], []); }
