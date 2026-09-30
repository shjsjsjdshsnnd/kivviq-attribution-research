import { actionDependencySchema, type ActionDependency } from "./schema.js";

/** One-way adapter for already-typed legacy gates. Unknown expressions are retained by the caller. */
export function adaptLegacyDependency(input: unknown): ActionDependency | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  if (value["kind"] !== "EXACT_LOCAL_GATE" || typeof value["dependencyId"] !== "string" || typeof value["checkId"] !== "string") return undefined;
  const evaluationBoundary = value["evaluationBoundary"];
  if (!(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"] as unknown[]).includes(evaluationBoundary)) return undefined;
  if (value["whenUnknown"] !== "UNKNOWN" && value["whenUnknown"] !== "BLOCKED") return undefined;
  const parsed = actionDependencySchema.safeParse({
    dependencyId: value["dependencyId"], kind: "ELIGIBILITY_CHECK_GATE",
    evaluationBoundary: evaluationBoundary as ActionDependency["evaluationBoundary"],
    checkId: value["checkId"], requiredStatus: "SATISFIED",
    whenUnknown: value["whenUnknown"],
  });
  return parsed.success ? parsed.data : undefined;
}
