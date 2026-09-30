import { z } from "zod";
import {
  decisionIdSchema as id,
  investigationWhatSchema,
} from "../decision_forms/index.js";
const actionSchema = z
  .object({
    actionId: id,
    actionFingerprint: id,
    what: investigationWhatSchema,
  })
  .strict();
export const investigationResultSchema = z
  .object({
    actionId: id,
    actionFingerprint: id,
    status: z.enum(["RESOLVED", "PARTIALLY_RESOLVED", "UNRESOLVED", "FAILED"]),
    evidenceCollected: z.array(
      z.object({ evidenceId: id, artifactRef: id }).strict(),
    ),
    coverage: z.array(
      z.object({ evidenceId: id, fraction: z.number().min(0).max(1) }).strict(),
    ),
    findings: z.array(
      z
        .object({ findingId: id, evidenceIds: z.array(id).min(1), code: id })
        .strict(),
    ),
    unresolvedEvidenceIds: z.array(id),
    completedAt: z.string().datetime(),
    provenance: z
      .object({ sourceRef: id, recordedAt: z.string().datetime() })
      .strict(),
  })
  .strict();
export type InvestigationResult = z.infer<typeof investigationResultSchema>;
export function validateInvestigationResult(
  action: unknown,
  result: unknown,
): { ok: boolean; issues: string[] } {
  const a = actionSchema.safeParse(action),
    r = investigationResultSchema.safeParse(result);
  if (!a.success || !r.success)
    return { ok: false, issues: ["INVALID_CONTRACT"] };
  const issues: string[] = [],
    v = r.data,
    w = a.data.what;
  if (
    v.actionId !== a.data.actionId ||
    v.actionFingerprint !== a.data.actionFingerprint
  )
    issues.push("ACTION_IDENTITY_MISMATCH");
  const required = new Set(w.requiredEvidence.map((e) => e.evidenceId)),
    collected = new Set(v.evidenceCollected.map((e) => e.evidenceId)),
    coverage = new Map(v.coverage.map((e) => [e.evidenceId, e.fraction]));
  if (
    collected.size !== v.evidenceCollected.length ||
    coverage.size !== v.coverage.length ||
    new Set(v.unresolvedEvidenceIds).size !== v.unresolvedEvidenceIds.length ||
    new Set(v.findings.map((f) => f.findingId)).size !== v.findings.length
  )
    issues.push("DUPLICATE_RESULT_IDENTITY");
  if (
    [...collected, ...coverage.keys(), ...v.unresolvedEvidenceIds].some(
      (e) => !required.has(e),
    )
  )
    issues.push("UNKNOWN_EVIDENCE");
  if (
    v.coverage.some((e) => e.fraction > 0 && !collected.has(e.evidenceId)) ||
    v.findings.some((f) => f.evidenceIds.some((e) => !collected.has(e)))
  )
    issues.push("UNSUPPORTED_FINDING_OR_COVERAGE");
  const criteriaMet = w.successCriteria.every((c) =>
    c.evidenceIds.every((e) => (coverage.get(e) ?? 0) >= c.minimumCoverage),
  );
  const missing = [...required].filter((e) => (coverage.get(e) ?? 0) < 1);
  if (
    v.status === "RESOLVED" &&
    (!criteriaMet || missing.length > 0 || v.unresolvedEvidenceIds.length > 0)
  )
    issues.push("FALSE_RESOLUTION");
  if (
    v.status === "PARTIALLY_RESOLVED" &&
    (!v.coverage.some((e) => e.fraction > 0) ||
      v.unresolvedEvidenceIds.length === 0)
  )
    issues.push("INVALID_PARTIAL_RESOLUTION");
  if (
    v.status !== "RESOLVED" &&
    missing.some((e) => !v.unresolvedEvidenceIds.includes(e))
  )
    issues.push("UNREPORTED_UNRESOLVED_EVIDENCE");
  if (Date.parse(v.provenance.recordedAt) < Date.parse(v.completedAt))
    issues.push("INVALID_RESULT_CHRONOLOGY");
  return { ok: issues.length === 0, issues };
}
export const investigationDependencySchema = z
  .object({
    relation: z.literal("REQUIRES"),
    actionId: id,
    actionFingerprint: id,
    requiredStatus: z.enum(["RESOLVED", "COMPLETED"]),
  })
  .strict();
export function checkInvestigationDependency(
  dependency: unknown,
  action: unknown,
  result: unknown,
): { satisfied: boolean; reason: string } {
  const d = investigationDependencySchema.safeParse(dependency),
    a = actionSchema.safeParse(action),
    r = investigationResultSchema.safeParse(result);
  if (!d.success || !a.success || !r.success)
    return { satisfied: false, reason: "MISSING_OR_INVALID_CONTEXT" };
  if (
    d.data.actionId !== a.data.actionId ||
    d.data.actionFingerprint !== a.data.actionFingerprint ||
    !validateInvestigationResult(action, result).ok
  )
    return { satisfied: false, reason: "INVALID_RESULT_REFERENCE" };
  const satisfied =
    d.data.requiredStatus === "RESOLVED"
      ? r.data.status === "RESOLVED"
      : r.data.status !== "FAILED";
  return {
    satisfied,
    reason: satisfied ? "SATISFIED" : "REQUIRED_STATUS_NOT_MET",
  };
}
const readinessContextSchema = z
  .object({
    existingTargetRefs: z.array(id).optional(),
    availableSourceRefs: z.array(id).optional(),
    permissions: z.enum(["GRANTED", "DENIED", "UNKNOWN"]).optional(),
    observationWindowValid: z.boolean().optional(),
    definedMetricRefs: z.array(id).optional(),
    definedEventRefs: z.array(id).optional(),
    definedFactRefs: z.array(id).optional(),
    registeredCustomCategories: z
      .array(z.object({ registryRef: id, code: id }).strict())
      .optional(),
  })
  .strict();
export function checkInvestigationReadiness(action: unknown, context: unknown) {
  const a = actionSchema.safeParse(action),
    c = readinessContextSchema.safeParse(context);
  type Gate = "READY" | "BLOCKED" | "UNKNOWN";
  const gates: Record<string, Gate> = {
    target: "UNKNOWN",
    source: "UNKNOWN",
    permissions: "UNKNOWN",
    observationWindow: "UNKNOWN",
    metric: "UNKNOWN",
    taxonomy: "UNKNOWN",
    event: "UNKNOWN",
  };
  if (!a.success || !c.success)
    return { status: "BLOCKED" as const, gates, issues: ["INVALID_CONTRACT"] };
  const w = a.data.what,
    x = c.data;
  const check = (refs: string[], available: string[] | undefined): Gate =>
    refs.length === 0
      ? "READY"
      : available === undefined
        ? "UNKNOWN"
        : refs.every((r) => available.includes(r))
          ? "READY"
          : "BLOCKED";
  gates["target"] = check(
    w.targets.map((t) => t.ref),
    x.existingTargetRefs,
  );
  gates["source"] = check(
    [
      ...w.targets.filter((t) => t.kind === "DATA_SOURCE").map((t) => t.ref),
      ...(w.tracking ? [w.tracking.sourceRef] : []),
    ],
    x.availableSourceRefs,
  );
  gates["event"] = check(
    w.tracking ? [w.tracking.eventRef] : [],
    x.definedEventRefs,
  );
  gates["permissions"] =
    x.permissions === "GRANTED"
      ? "READY"
      : x.permissions === "DENIED"
        ? "BLOCKED"
        : "UNKNOWN";
  gates["observationWindow"] =
    x.observationWindowValid === undefined
      ? "UNKNOWN"
      : x.observationWindowValid
        ? "READY"
        : "BLOCKED";
  const metric = check(
      [
        ...w.requiredEvidence
          .filter((e) => e.reference.kind === "METRIC")
          .map((e) => e.reference.ref),
        ...w.targets.filter((t) => t.kind === "METRIC").map((t) => t.ref),
        ...(w.observedAnomaly ? [w.observedAnomaly.metricRef] : []),
      ],
      x.definedMetricRefs,
    ),
    fact = check(
      w.requiredEvidence
        .filter((e) => e.reference.kind === "FACT")
        .map((e) => e.reference.ref),
      x.definedFactRefs,
    );
  gates["metric"] = [metric, fact].includes("BLOCKED")
    ? "BLOCKED"
    : [metric, fact].includes("UNKNOWN")
      ? "UNKNOWN"
      : "READY";
  const cat = w.category;
  gates["taxonomy"] =
    cat.kind !== "CUSTOM"
      ? "READY"
      : x.registeredCustomCategories === undefined
        ? "UNKNOWN"
        : x.registeredCustomCategories.some(
              (v) => v.registryRef === cat.registryRef && v.code === cat.code,
            )
          ? "READY"
          : "BLOCKED";
  const values = Object.values(gates);
  return {
    status: values.includes("BLOCKED")
      ? ("BLOCKED" as const)
      : values.includes("UNKNOWN")
        ? ("UNKNOWN" as const)
        : ("READY" as const),
    gates,
    issues: [],
  };
}
