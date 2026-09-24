import type { Action } from "../action_ontology/types.js";
import { actionFingerprint } from "../action_ontology/semantics.js";
import { assertValidAction } from "../action_ontology/validation.js";
import { deepFreezeEvaluation, evaluationFingerprint } from "../evaluation/baseline-contract.js";
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
  return deepFreezeEvaluation({ checkId, status: sortedIssues.length === 0 ? "PASS" : "FAIL", evidenceFingerprints: [...fingerprints].sort(compareCodeUnits), issues: sortedIssues });
}

export function issue(code: string, path: string, message: string): BaselineValidationIssue {
  return { code, path, message };
}

export function safeFingerprint(value: unknown): string | undefined {
  return isStrictJson(value) ? evaluationFingerprint(value) : undefined;
}

export type { Action };
