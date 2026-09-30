import { createHash } from "node:crypto";
import { z } from "zod";
import { BUSINESS_STATE_VERSION, businessStateSnapshotSchema, type BusinessStateSnapshot } from "../business_state/schema.js";
import { metricRegistry } from "../business_state/metric-registry.js";
import { INPUT_VERSION, METRIC_IDS, type DiagnosisInput, type MetricId, type MetricSeries, type Observation } from "../diagnosis/contract.js";
import { AUTHORITY, diagnose } from "../diagnosis/engine.js";
import { EXPECTED_UNIT, parseDiagnosisInput } from "../diagnosis/validate.js";
import { CALENDAR_VERSION, describeCalendarComparison, validateCalendar } from "../diagnosis/engine.js";

export const ADAPTER_VERSION = "business-state-diagnosis/0.1.0" as const;
const text = z.string().trim().min(1).max(512);
const windowSchema = z.object({ start: z.string().datetime(), end: z.string().datetime() }).strict();
const materiality = z.object({ absolute: z.number().finite().nonnegative(), relative: z.number().min(0).max(1) }).strict();
const kindSchema = z.enum(["CURRENT", "PREVIOUS", "YOY", "SEASONAL_BASELINE"]);
const directIdSchema = z.enum(["revenue_net", "orders", "sessions"]);
type DirectId = z.infer<typeof directIdSchema>;
const directIds: readonly DirectId[] = ["revenue_net", "orders", "sessions"];
const encoding = z.enum(["MAJOR_UNITS", "MINOR_UNITS", "NATIVE"]);

/** Source-verifiable metadata omitted by Business State v1, keyed to atomic evidence. */
const metadataSchema = z.object({
  evidenceId: text, metadataEvidenceId: text, metricId: directIdSchema, periodKind: kindSchema,
  merchantId: text, source: z.enum(["SHOPIFY", "GA4", "META_ADS", "GOOGLE_ADS", "PINTEREST_ADS", "DERIVED"]),
  observedAt: z.string().datetime(), periodStart: z.string().datetime(), periodEnd: z.string().datetime(),
  scopeId: text, populationId: text, definitionId: text, measurementId: text,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), valueEncoding: encoding,
  dataThrough: z.string().datetime().nullable(), coverage: z.number().min(0).max(1).nullable(),
  complete: z.boolean(), sourceScanComplete: z.boolean(),
}).strict();
export type DiagnosisEvidenceMetadata = z.infer<typeof metadataSchema>;
export const projectionContextSchema = z.object({
  version: z.literal(ADAPTER_VERSION), snapshotId: text, merchantId: text, asOf: z.string().datetime(),
  currency: z.string().regex(/^[A-Z]{3}$/), minorUnitsPerMajor: z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]),
  scopeId: text, populationId: text, moneyEncoding: z.enum(["MAJOR_UNITS", "MINOR_UNITS"]),
  comparisonKind: z.enum(["PREVIOUS", "YOY", "SEASONAL_BASELINE"]), current: windowSchema, reference: windowSchema,
  calendar: z.object({ version: z.literal(CALENDAR_VERSION), timezone: text,
    alignment: z.enum(["LOCAL_CALENDAR_DATES", "LOCAL_52_WEEKS"]) }).strict(),
  metadata: z.array(metadataSchema).max(10),
  policy: z.object({
    materiality: z.object({ revenue_net: materiality, orders: materiality, aov: materiality, sessions: materiality, cvr: materiality }).strict(),
    minimumCoverage: z.number().min(0).max(1), maxAgeSeconds: z.number().finite().nonnegative(), identityToleranceMinorUnits: z.number().min(0).max(1),
  }).strict(),
}).strict();
export type BusinessStateProjectionContext = z.infer<typeof projectionContextSchema>;
export interface ProjectionIssue { readonly metricId: MetricId; readonly period: "reference" | "current"; readonly code: string; readonly evidenceNeeded: string }
export interface ProjectionLineage { readonly evidenceId: string; readonly metadataEvidenceIds: readonly string[]; readonly operandEvidenceIds: readonly string[]; readonly calculation: string | null }
export class BusinessStateProjectionError extends Error { override readonly name = "BusinessStateProjectionError"; }
function fail(message: string): never { throw new BusinessStateProjectionError(message); }
const sameTime = (a: string, b: string): boolean => Date.parse(a) === Date.parse(b);
const sameWindow = (a: { start: string; end: string }, b: { start: string; end: string }): boolean => sameTime(a.start, b.start) && sameTime(a.end, b.end);

/** Reject executable/accessor input and hidden fields before schema parsing. */
function plainData(value: unknown, depth = 0, budget = { remaining: 20_000 }): void {
  if (--budget.remaining < 0 || depth > 14) fail("Projection input exceeds bounded data limits");
  if (value === null || typeof value === "string" || typeof value === "boolean" || value === undefined) return;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("Non-finite projection data"); return; }
  if (typeof value !== "object") fail("Projection requires plain observable data");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) ? prototype !== Array.prototype : ![Object.prototype, null].includes(prototype)) fail("Projection requires plain objects");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("Symbol metadata is forbidden");
    if (Array.isArray(value) && key !== "length" && !/^(0|[1-9]\d*)$/.test(key)) fail("Unexpected array metadata");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) fail("Accessor input is forbidden");
    plainData(descriptor.value, depth + 1, budget);
  }
}
export function assertDiagnosisRegistryConformance(): void {
  for (const id of METRIC_IDS) {
    const definition = metricRegistry[id];
    if (definition.id !== id || definition.unit !== EXPECTED_UNIT[id] || definition.authoritativeSources.length !== 1 || definition.authoritativeSources[0] !== AUTHORITY[id]) fail(`Canonical registry drift: ${id}`);
    const expected = id === "aov" ? ["revenue_net", "orders"] : id === "cvr" ? ["orders", "sessions"] : undefined;
    if (JSON.stringify(definition.derivedFrom) !== JSON.stringify(expected)) fail(`Canonical dependency drift: ${id}`);
    if (id === "aov" && definition.derivation !== "revenue_net / orders") fail("Canonical AOV formula drift");
    if (id === "cvr" && definition.derivation !== "orders / sessions") fail("Canonical CVR formula drift");
  }
}
function numericValue(snapshot: BusinessStateSnapshot, id: MetricId, period: "reference" | "current", context: BusinessStateProjectionContext): number | null {
  const metric = snapshot.metrics.find(row => row.metricId === id);
  if (!metric) return null;
  const field = period === "current" ? "current" : context.comparisonKind === "PREVIOUS" ? "previous" : context.comparisonKind === "YOY" ? "yoy" : "seasonalBaseline";
  return metric[field] ?? null;
}
function canonicalDefinition(id: MetricId): string { return `${id}@${BUSINESS_STATE_VERSION}`; }
function monetaryTotal(value: number, context: BusinessStateProjectionContext): number | null {
  const scaled = value * (context.moneyEncoding === "MAJOR_UNITS" ? context.minorUnitsPerMajor : 1);
  const rounded = Math.round(scaled);
  const tolerance = Math.min(1e-4, 1e-8 + Math.abs(scaled) * Number.EPSILON * 4);
  if (!Number.isSafeInteger(rounded) || Math.abs(rounded) > Number.MAX_SAFE_INTEGER / 32 || Math.abs(scaled - rounded) > tolerance) return null;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function projectBusinessState(rawSnapshot: unknown, rawContext: unknown) {
  plainData(rawSnapshot); plainData(rawContext);
  const parsedSnapshot = businessStateSnapshotSchema.safeParse(rawSnapshot), parsedContext = projectionContextSchema.safeParse(rawContext);
  if (!parsedSnapshot.success) fail("Invalid canonical Business State snapshot; unknown fields are forbidden");
  if (!parsedContext.success) fail("Invalid projection context; source metadata must be explicit");
  const snapshot = parsedSnapshot.data, context = parsedContext.data;
  assertDiagnosisRegistryConformance();
  const calendar = validateCalendar(context.calendar);
  if (snapshot.snapshotId !== context.snapshotId || snapshot.merchantId !== context.merchantId || !sameTime(snapshot.asOf, context.asOf) || snapshot.currency !== context.currency || snapshot.timezone !== calendar.timezone) fail("Snapshot/request binding mismatch");
  if (!sameWindow({ start: snapshot.periodStart, end: snapshot.periodEnd }, context.current)) fail("Snapshot current window does not match the requested window");
  const metadataIds = context.metadata.map(row => row.evidenceId);
  if (new Set(metadataIds).size !== metadataIds.length) fail("Duplicate atomic metadata evidence ID");
  const allEvidence = snapshot.metrics.flatMap(row => row.evidence);
  if (new Set(allEvidence.map(row => row.evidenceId)).size !== allEvidence.length) fail("Snapshot reuses an atomic evidence ID");
  if (context.metadata.some(row => !allEvidence.some(e => e.evidenceId === row.evidenceId))) fail("Metadata is not bound to snapshot evidence");
  const issues: ProjectionIssue[] = [], lineage: ProjectionLineage[] = [];
  const issue = (id: MetricId, period: "reference" | "current", code: string): void => { issues.push({ metricId: id, period, code,
    evidenceNeeded: `Reconciled ${id} source evidence and metadata for the requested merchant, scope, definition and ${period} window (${code}).` }); };
  const empty = (id: MetricId, period: "reference" | "current"): Observation => ({ value: null, merchantId: context.merchantId,
    scopeId: context.scopeId, populationId: context.populationId, definitionId: canonicalDefinition(id), measurementId: "unresolved",
    source: null, evidenceId: null, observedAt: null, dataThrough: null, coverage: null, complete: false, sourceScanComplete: false,
    window: { ...context[period] }, currency: EXPECTED_UNIT[id] === "MONEY" ? context.currency : null });
  const direct = (id: DirectId, period: "reference" | "current"): Observation => {
    const unavailable = (reason: string): Observation => { issue(id, period, reason); return empty(id, period); };
    const state = snapshot.metrics.find(row => row.metricId === id);
    if (!state) return unavailable("metric_missing");
    if (state.unit !== metricRegistry[id].unit || state.domain !== metricRegistry[id].domain) return unavailable("canonical_metric_contract_mismatch");
    if (state.confidence === "UNKNOWN" || state.confidence === "UNCERTAIN") return unavailable("snapshot_metric_unresolved");
    const kind = period === "current" ? "CURRENT" : context.comparisonKind;
    const matches = state.evidence.filter(row => row.periodKind === kind);
    if (matches.length !== 1) return unavailable(matches.length ? "ambiguous_source_evidence" : "period_evidence_missing");
    const evidence = matches[0]!;
    if (evidence.source !== AUTHORITY[id]) return unavailable("non_authoritative_source");
    if (!sameWindow({ start: evidence.periodStart, end: evidence.periodEnd }, context[period])) return unavailable("source_period_mismatch");
    if (numericValue(snapshot, id, period, context) !== evidence.value) return unavailable("snapshot_source_value_disagreement");
    const meta = context.metadata.find(row => row.evidenceId === evidence.evidenceId);
    if (!meta) return unavailable("source_metadata_missing");
    if (meta.merchantId !== context.merchantId || meta.source !== evidence.source || meta.metricId !== id || meta.periodKind !== kind || !sameTime(meta.observedAt, evidence.observedAt)
      || !sameWindow({ start: meta.periodStart, end: meta.periodEnd }, context[period])) return unavailable("metadata_evidence_binding_mismatch");
    if (meta.scopeId !== context.scopeId || meta.populationId !== context.populationId) return unavailable("requested_scope_or_population_mismatch");
    if (meta.definitionId !== canonicalDefinition(id)) return unavailable("canonical_definition_mismatch");
    if (meta.currency !== (id === "revenue_net" ? context.currency : null) || meta.valueEncoding !== (id === "revenue_net" ? context.moneyEncoding : "NATIVE")) return unavailable("currency_or_encoding_mismatch");
    if (evidence.coverage !== undefined && evidence.coverage !== meta.coverage) return unavailable("coverage_disagreement");
    if (evidence.freshnessSeconds !== undefined && evidence.freshnessSeconds > context.policy.maxAgeSeconds) return unavailable("source_data_stale");
    const sampleMinimum = metricRegistry[id].minimumSampleSize;
    if (sampleMinimum !== undefined && (evidence.sampleSize === undefined || evidence.sampleSize < sampleMinimum)) return unavailable("insufficient_source_sample");
    const value = id === "revenue_net" ? monetaryTotal(evidence.value, context) : evidence.value;
    if (value === null || !Number.isSafeInteger(value) || (id !== "revenue_net" && value < 0) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 32) return unavailable("invalid_numeric_precision_or_range");
    lineage.push({ evidenceId: evidence.evidenceId, metadataEvidenceIds: [meta.metadataEvidenceId], operandEvidenceIds: [], calculation: null });
    return { value, merchantId: context.merchantId, scopeId: meta.scopeId, populationId: meta.populationId, definitionId: meta.definitionId,
      measurementId: meta.measurementId, source: evidence.source, evidenceId: evidence.evidenceId,
      observedAt: evidence.observedAt, dataThrough: meta.dataThrough, coverage: meta.coverage,
      complete: meta.complete, sourceScanComplete: meta.sourceScanComplete, window: { ...context[period] }, currency: meta.currency };
  };
  const metrics: MetricSeries[] = directIds.map(metricId => ({ metricId, unit: EXPECTED_UNIT[metricId], reference: direct(metricId, "reference"), current: direct(metricId, "current") }));
  const inputBase = { version: INPUT_VERSION, snapshotId: snapshot.snapshotId, merchantId: snapshot.merchantId, asOf: snapshot.asOf,
    currency: snapshot.currency, minorUnitsPerMajor: context.minorUnitsPerMajor, comparisonKind: context.comparisonKind, metrics, policy: context.policy } satisfies DiagnosisInput;
  const preliminary = diagnose(parseDiagnosisInput(inputBase), calendar);
  const directChanges = new Map(preliminary.changes.map(row => [row.metricId, row]));
  for (let i = 0; i < metrics.length; i++) {
    const series = metrics[i]!, assessed = directChanges.get(series.metricId)!;
    const quarantine = (period: "reference" | "current"): Observation => {
      if (series[period].value !== null && assessed[period] === null) {
        for (const reason of assessed.reasons) issue(series.metricId, period, reason);
        return empty(series.metricId, period);
      }
      return series[period];
    };
    metrics[i] = { ...series, reference: quarantine("reference"), current: quarantine("current") };
  }
  const retainedEvidence = new Set(metrics.flatMap(row => [row.reference.evidenceId, row.current.evidenceId]));
  for (let i = lineage.length - 1; i >= 0; i--) if (!retainedEvidence.has(lineage[i]!.evidenceId)) lineage.splice(i, 1);
  for (const [id, numeratorId, denominatorId] of [["aov", "revenue_net", "orders"], ["cvr", "orders", "sessions"]] as const) {
    const derive = (period: "reference" | "current"): Observation => {
      const unavailable = (reason: string): Observation => { issue(id, period, reason); return empty(id, period); };
      if ([numeratorId, denominatorId].some(key => directChanges.get(key)?.status === "unknown")) return unavailable("derived_operands_not_comparable");
      const numerator = metrics.find(row => row.metricId === numeratorId)![period], denominator = metrics.find(row => row.metricId === denominatorId)![period];
      if (numerator.value === null || denominator.value === null || denominator.value <= 0) return unavailable("derived_denominator_or_operand_unavailable");
      const value = numerator.value / denominator.value;
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 32) return unavailable("derived_value_out_of_range");
      const existing = snapshot.metrics.find(row => row.metricId === id);
      if (existing) {
        if (existing.unit !== metricRegistry[id].unit || existing.domain !== metricRegistry[id].domain) return unavailable("canonical_metric_contract_mismatch");
        const raw = numericValue(snapshot, id, period, context);
        const stored = raw === null ? null : raw * (id === "aov" && context.moneyEncoding === "MAJOR_UNITS" ? context.minorUnitsPerMajor : 1);
        if (stored === null || Math.abs(stored - value) > 1e-8 * Math.max(1, Math.abs(value))) return unavailable("snapshot_derived_value_disagreement");
      }
      const operands = [numerator.evidenceId!, denominator.evidenceId!];
      const hash = (data: unknown): string => createHash("sha256").update(JSON.stringify(data)).digest("hex");
      const evidenceId = `diagnosis-derived:${id}:${hash([snapshot.snapshotId, period, snapshot.asOf, operands, value])}`;
      const measurementId = `diagnosis-derived:${id}:${hash([numerator.measurementId, denominator.measurementId])}`;
      lineage.push({ evidenceId, metadataEvidenceIds: [], operandEvidenceIds: operands, calculation: metricRegistry[id].derivation! });
      return { value, merchantId: context.merchantId, scopeId: context.scopeId, populationId: context.populationId,
        definitionId: canonicalDefinition(id), measurementId, source: "DERIVED", evidenceId,
        observedAt: [numerator.observedAt!, denominator.observedAt!].sort((a, b) => Date.parse(a) - Date.parse(b))[1]!,
        dataThrough: [numerator.dataThrough!, denominator.dataThrough!].sort((a, b) => Date.parse(a) - Date.parse(b))[0]!,
        coverage: Math.min(numerator.coverage!, denominator.coverage!), complete: true, sourceScanComplete: true,
        window: { ...context[period] }, currency: id === "aov" ? context.currency : null };
    };
    metrics.push({ metricId: id, unit: EXPECTED_UNIT[id], reference: derive("reference"), current: derive("current") });
  }
  const input = parseDiagnosisInput(inputBase);
  return { version: ADAPTER_VERSION, input, calendar,
    issues: issues.sort((a, b) => `${a.metricId}:${a.period}:${a.code}`.localeCompare(`${b.metricId}:${b.period}:${b.code}`, "en")),
    lineage: lineage.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId, "en")),
    timeContext: describeCalendarComparison(context.reference, context.current, context.comparisonKind, calendar) };
}
export function diagnoseBusinessState(snapshot: unknown, context: unknown) {
  const projection = projectBusinessState(snapshot, context);
  return { version: ADAPTER_VERSION, sourceSnapshotId: projection.input.snapshotId,
    diagnosis: diagnose(projection.input, projection.calendar), projectionIssues: projection.issues,
    lineage: projection.lineage, timeContext: projection.timeContext,
    limitations: ["Source metadata must be supplied by a governed collector; the adapter does not fetch live providers or cryptographically verify attestations.",
      "Only canonical revenue, orders, AOV, sessions and CVR are supported. Other domain diagnoses remain outside this increment.",
      "Calendar alignment is not seasonal adjustment, statistical significance or causal identification."] };
}
