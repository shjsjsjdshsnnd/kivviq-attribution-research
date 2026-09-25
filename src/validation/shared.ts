import type { Action } from "../action_ontology/types.js";
import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import {
  buildActionAvailabilitySnapshot,
  buildOperatorObservationSnapshot,
  deepFreezeEvaluation,
  evaluationFingerprint,
  stableEvaluationJson,
  type ActionAvailabilitySnapshot,
  type BaselineEvaluationContract,
  type DecisionOpportunity,
} from "../evaluation/baseline-contract.js";
import {
  assertCanonicalOperatorInputV2,
  canonicalInputFingerprint,
  type CanonicalOperatorInputV2,
} from "../operator/canonical-interface.js";
import { BASELINE_VALIDATION_FINGERPRINT_PATTERN, type BaselineValidationCheckId, type BaselineValidationCheckResult, type BaselineValidationIssue } from "./contract.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.every((key) => typeof key === "string") &&
    actual.length === keys.length &&
    [...actual as string[]].sort(compareCodeUnits).every((key, index) => key === [...keys].sort(compareCodeUnits)[index]);
}

export function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && BASELINE_VALIDATION_FINGERPRINT_PATTERN.test(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

export function isStrictJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)))) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor) || !isStrictJson(descriptor.value, ancestors)) return false;
      }
      return true;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor) || !isStrictJson(descriptor.value, ancestors)) return false;
    }
    return true;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalActionFingerprints(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return value.map((action) => actionFingerprint(assertValidAction(action))) as readonly string[];
  } catch {
    return undefined;
  }
}

export function result(checkId: BaselineValidationCheckId, issues: readonly BaselineValidationIssue[], fingerprints: readonly string[]): BaselineValidationCheckResult {
  const sortedIssues = [...issues].sort((left, right) => compareCodeUnits(left.code, right.code) || compareCodeUnits(left.path, right.path) || compareCodeUnits(left.message, right.message));
  const uniqueFingerprints = [...new Set(fingerprints)].sort(compareCodeUnits);
  return deepFreezeEvaluation({ checkId, status: sortedIssues.length === 0 ? "PASS" : "FAIL", evidenceFingerprints: uniqueFingerprints, issues: sortedIssues });
}

export function issue(code: string, path: string, message: string): BaselineValidationIssue {
  return { code, path, message };
}

export function safeFingerprint(value: unknown): string | undefined {
  return isStrictJson(value) ? evaluationFingerprint(value) : undefined;
}

interface CanonicalInputIntegrityResult {
  readonly issues: readonly BaselineValidationIssue[];
  readonly inputFingerprint?: string;
  readonly observationFingerprint?: string;
  readonly availabilityFingerprint?: string;
}

/** Internal validation adapter: Step 3.1 reconstructs bindings, Step 3.10 validates the input. */
export function canonicalInputIntegrity(
  value: unknown,
  contract: BaselineEvaluationContract,
  opportunity: DecisionOpportunity,
  availability: ActionAvailabilitySnapshot,
  path: string,
): CanonicalInputIntegrityResult {
  if (!isRecord(value) || !isRecord(value["observation"]) || !Array.isArray(value["observation"]["records"]) ||
    !isRecord(value["legalActionSpace"]) || !Array.isArray(value["legalActionSpace"]["rules"]) ||
    !Array.isArray(value["legalActionSpace"]["mutualExclusionGroups"])) {
    return deepFreezeEvaluation({ issues: [issue("INVALID_INPUT_SCHEMA", path, "canonical operator input must match the exact Step 3.10 schema")] });
  }

  let observation;
  try {
    observation = buildOperatorObservationSnapshot(contract, opportunity, value["observation"]["records"] as never);
  } catch (error) {
    return deepFreezeEvaluation({ issues: [issue("OBSERVATION_INTEGRITY", `${path}.observation`, error instanceof Error ? error.message : String(error))] });
  }
  let actionSpace;
  try {
    actionSpace = buildActionAvailabilitySnapshot(
      contract,
      opportunity,
      value["legalActionSpace"]["rules"] as ActionAvailabilitySnapshot["rules"],
      value["legalActionSpace"]["mutualExclusionGroups"] as ActionAvailabilitySnapshot["mutualExclusionGroups"],
    );
  } catch (error) {
    return deepFreezeEvaluation({ issues: [issue("ACTION_SPACE_INTEGRITY", `${path}.legalActionSpace`, error instanceof Error ? error.message : String(error))] });
  }

  const constraints = {
    dimensions: contract.businessConstraints.dimensions,
    evaluationBoundary: contract.businessConstraints.evaluationBoundary,
    invalidActionHandling: contract.businessConstraints.invalidActionHandling,
    infeasibleActionHandling: contract.businessConstraints.infeasibleActionHandling,
    partialFeasibilityHandling: contract.businessConstraints.partialFeasibilityHandling,
    conflictHandling: contract.businessConstraints.conflictHandling,
    silentModificationForbidden: contract.businessConstraints.silentModificationForbidden,
  };
  let input: CanonicalOperatorInputV2;
  try {
    input = assertCanonicalOperatorInputV2(value, {
      opportunityId: opportunity.opportunityId,
      decisionTime: opportunity.at,
      decisionContext: { sequence: opportunity.sequence, trigger: opportunity.trigger },
      observationRecords: observation.records as CanonicalOperatorInputV2["observation"]["records"],
      legalActionSpace: { rules: actionSpace.rules, mutualExclusionGroups: actionSpace.mutualExclusionGroups },
      constraints,
      evaluationContractFingerprint: contract.contractFingerprint,
      evaluationContractVersion: contract.contractVersion,
      observationFingerprint: observation.observationFingerprint,
      legalActionSpaceFingerprint: actionSpace.availabilityFingerprint,
      actionOntologyVersion: contract.actionSpace.ontologySchemaVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /fields are malformed|schema or provenance version/.test(message) ? "INVALID_INPUT_SCHEMA"
      : /observation binding/.test(message) ? "OBSERVATION_INTEGRITY"
        : /legal Action-space binding/.test(message) ? "ACTION_SPACE_INTEGRITY"
          : /constraint binding/.test(message) ? "CONSTRAINT_INTEGRITY"
            : /provenance binding/.test(message) ? "PROVENANCE_INTEGRITY"
              : "INPUT_BINDING_MISMATCH";
    return deepFreezeEvaluation({ issues: [issue(code, path, message)] });
  }

  const issues: BaselineValidationIssue[] = [];
  if (stableEvaluationJson(actionSpace) !== stableEvaluationJson(availability)) {
    issues.push(issue("ACTION_SPACE_INTEGRITY", `${path}.legalActionSpace`, "canonical input Action space differs from the bound evaluator availability"));
  }
  return deepFreezeEvaluation({
    issues,
    inputFingerprint: canonicalInputFingerprint(input),
    observationFingerprint: observation.observationFingerprint,
    availabilityFingerprint: actionSpace.availabilityFingerprint,
  });
}

export type { Action };
