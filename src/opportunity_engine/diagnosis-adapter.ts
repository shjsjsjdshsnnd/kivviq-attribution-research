import { z } from "zod";

const changeSchema = z.object({
  id: z.string().min(1),
  metricId: z.string().min(1),
  status: z.enum(["material", "immaterial", "unknown"]),
  reference: z.number().finite().nullable().optional(),
  current: z.number().finite().nullable().optional(),
  delta: z.number().finite().nullable().optional(),
  relativeDelta: z.number().finite().nullable().optional(),
  evidenceIds: z.array(z.string().min(1)).default([]),
}).passthrough();

const driverSchema = z.object({
  id: z.string().min(1),
  metricId: z.string().min(1),
  effectMinorUnits: z.number().finite(),
  evidenceIds: z.array(z.string().min(1)).default([]),
}).passthrough();

export const diagnosisProjectionSchema = z.object({
  merchantId: z.string().min(1),
  status: z.enum(["diagnosed", "partial", "unknown"]).optional(),
  changes: z.array(changeSchema).default([]),
  revenue: z.object({ drivers: z.array(driverSchema).default([]) }).passthrough().optional(),
  unknowns: z.array(z.object({
    id: z.string().min(1),
    whatIsKnown: z.string().min(1).optional(),
    whatIsUnknown: z.string().min(1),
    evidenceNeeded: z.array(z.string().min(1)).default([]),
  }).passthrough()).default([]),
}).passthrough();

export type DiagnosisProjection = z.infer<typeof diagnosisProjectionSchema>;

export interface NormalizedDiagnosisSignal {
  readonly diagnosisRef: string;
  readonly code: string;
  readonly metricId: string;
  readonly direction: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
  readonly material: boolean;
  readonly magnitude: number | null;
  readonly evidenceRefs: readonly string[];
  readonly unresolved: readonly string[];
}

function direction(delta: number | null | undefined): NormalizedDiagnosisSignal["direction"] {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "UNKNOWN";
  if (delta > 0) return "UP";
  if (delta < 0) return "DOWN";
  return "FLAT";
}

export function normalizeDiagnosis(raw: unknown): NormalizedDiagnosisSignal[] {
  const report = diagnosisProjectionSchema.parse(raw);
  const signals: NormalizedDiagnosisSignal[] = report.changes.map((change) => ({
    diagnosisRef: change.id,
    code: change.status === "unknown" ? "diagnosis_unknown" : "metric_change",
    metricId: change.metricId,
    direction: direction(change.delta),
    material: change.status === "material",
    magnitude: change.delta ?? null,
    evidenceRefs: change.evidenceIds,
    unresolved: change.status === "unknown"
      ? report.unknowns.filter((item) => item.id.includes(change.metricId) || item.whatIsUnknown.includes(change.metricId)).flatMap((item) => item.evidenceNeeded)
      : [],
  }));
  for (const unknown of report.unknowns) {
    if (signals.some((signal) => signal.diagnosisRef === unknown.id)) continue;
    signals.push({
      diagnosisRef: unknown.id,
      code: "diagnosis_unknown",
      metricId: "unknown",
      direction: "UNKNOWN",
      material: false,
      magnitude: null,
      evidenceRefs: [],
      unresolved: unknown.evidenceNeeded.length > 0 ? unknown.evidenceNeeded : [unknown.whatIsUnknown],
    });
  }
  return signals;
}
