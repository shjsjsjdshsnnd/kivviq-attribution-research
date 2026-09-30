import type { EligibilityCheck } from "./schema.js";

interface EligibilityAssessmentProjection {
  readonly actionId: string;
  readonly actionFingerprint: string;
  readonly evaluatedAt: string;
  readonly evaluationBoundary: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
  readonly status: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  readonly checks: readonly EligibilityCheck[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function fingerprintEligibilityAssessment(value: EligibilityAssessmentProjection): string {
  let hash = 0xcbf29ce484222325n;
  const serialized = canonical(value);
  for (let index = 0; index < serialized.length; index += 1)
    hash = ((hash ^ BigInt(serialized.charCodeAt(index))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

export function hasValidEligibilityAssessmentFingerprint(
  value: EligibilityAssessmentProjection & { readonly assessmentFingerprint: string },
): boolean {
  const { assessmentFingerprint: _ignored, ...projection } = value;
  return value.assessmentFingerprint === fingerprintEligibilityAssessment(projection);
}
