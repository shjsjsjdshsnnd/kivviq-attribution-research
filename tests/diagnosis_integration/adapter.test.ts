import { describe, it, expect, vi } from "vitest";
import { collectBusinessState } from "../../src/business_state/collector.js";
import { BUSINESS_STATE_VERSION, type BusinessStateSnapshot, type BusinessStateEvidenceProvider, type CanonicalMetricId } from "../../src/business_state/schema.js";
import { diagnose, lastCompleteLocalDays } from "../../src/diagnosis/engine.js";
import { ADAPTER_VERSION, BusinessStateProjectionError, assertDiagnosisRegistryConformance, diagnoseBusinessState, projectBusinessState, type BusinessStateProjectionContext } from "../../src/diagnosis_integration/business-state.js";

type Pair = { snapshot: BusinessStateSnapshot; context: BusinessStateProjectionContext };
async function fixture(asOf = "2026-03-10T16:00:00Z", kind: "PREVIOUS" | "YOY" = "PREVIOUS", moneyEncoding: "MAJOR_UNITS" | "MINOR_UNITS" = "MAJOR_UNITS"): Promise<Pair> {
  const periods = lastCompleteLocalDays(asOf, "America/Toronto", 7, kind);
  const metadata: BusinessStateProjectionContext["metadata"] = [];
  const provider: BusinessStateEvidenceProvider = {
    async getEvidence(request) {
      const id = request.metricId;
      if (id !== "revenue_net" && id !== "orders" && id !== "sessions") return null;
      const current = request.periodKind === "CURRENT";
      const source = id === "sessions" ? "GA4" : "SHOPIFY";
      const value = id === "revenue_net" ? (current ? 12500 : 10000) * (moneyEncoding === "MINOR_UNITS" ? 100 : 1) : id === "orders" ? 100 : 10000;
      const evidenceId = `${id}:${request.periodKind}`;
      metadata.push({ evidenceId, metadataEvidenceId: `metadata:${evidenceId}`, metricId: id, periodKind: request.periodKind,
        merchantId: request.merchantId, source, observedAt: asOf, periodStart: request.periodStart, periodEnd: request.periodEnd,
        scopeId: "online-store", populationId: "governed-storefront", definitionId: `${id}@${BUSINESS_STATE_VERSION}`, measurementId: `${id}@v1`,
        currency: id === "revenue_net" ? "CAD" : null, valueEncoding: id === "revenue_net" ? moneyEncoding : "NATIVE",
        dataThrough: request.periodEnd, coverage: 1, complete: true, sourceScanComplete: true });
      return { evidenceId, metricId: id, source, periodKind: request.periodKind, observedAt: asOf, periodStart: request.periodStart, periodEnd: request.periodEnd,
        value, sampleSize: 10000, coverage: 1, freshnessSeconds: 0, provenance: "synthetic observed fixture" };
    },
  };
  const snapshot = await collectBusinessState({ merchantId: "synthetic-merchant", asOf, currency: "CAD", timezone: "America/Toronto",
    periods: { current: periods.current, ...(kind === "PREVIOUS" ? { previous: periods.reference } : { yoy: periods.reference }) },
    domains: ["COMMERCIAL", "ACQUISITION"], includeOptionalMetrics: false }, provider);
  return { snapshot, context: { version: ADAPTER_VERSION, snapshotId: snapshot.snapshotId, merchantId: snapshot.merchantId, asOf,
    currency: "CAD", minorUnitsPerMajor: 100, scopeId: "online-store", populationId: "governed-storefront", moneyEncoding,
    ...periods, metadata, policy: { minimumCoverage: 0.95, maxAgeSeconds: 86400, identityToleranceMinorUnits: 1,
      materiality: { revenue_net: { absolute: 10000, relative: 0.03 }, orders: { absolute: 5, relative: 0.03 }, aov: { absolute: 100, relative: 0.03 },
        sessions: { absolute: 100, relative: 0.03 }, cvr: { absolute: 0.001, relative: 0 } } } } };
}
function state(pair: Pair, id: CanonicalMetricId) { return pair.snapshot.metrics.find(row => row.metricId === id)!; }
function meta(pair: Pair, id: "revenue_net" | "orders" | "sessions" = "revenue_net") { return pair.context.metadata.find(row => row.metricId === id && row.periodKind === "CURRENT")!; }
function source(pair: Pair, id: CanonicalMetricId = "revenue_net") { return state(pair, id).evidence.find(row => row.periodKind === "CURRENT")!; }
function report(pair: Pair) { return diagnoseBusinessState(pair.snapshot, pair.context); }
function change(pair: Pair, id: CanonicalMetricId = "revenue_net") { return report(pair).diagnosis.changes.find(row => row.metricId === id)!; }

describe("Business State diagnosis integration", () => {
  it("checks the supported metric IDs, units, sources and derivation formulas against the canonical registry", () => {
    expect(() => assertDiagnosisRegistryConformance()).not.toThrow();
  });
  it("runs the real collector through the adapter and identifies pure AOV growth", async () => {
    const pair = await fixture(), output = report(pair);
    expect(output.projectionIssues).toEqual([]);
    expect(output.diagnosis.status).toBe("diagnosed");
    expect(output.diagnosis.revenue.observedDeltaMinorUnits).toBe(250000);
    expect(output.diagnosis.revenue.drivers.find(row => row.metricId === "aov")?.effectMinorUnits).toBe(250000);
    expect(output.diagnosis.revenue.arithmeticResidualMinorUnits).toBe(0);
    expect(output.timeContext.status).toBe("aligned");
    expect(output.timeContext.current?.elapsedHours).toBe(167);
  });
  it("retains original DST evidence timestamps in the final graph", async () => {
    const pair = await fixture(), original = structuredClone(pair), output = report(pair);
    expect(output.diagnosis.evidenceGraph.nodes.find(row => row.id === "source:revenue_net:current")?.window).toEqual(pair.context.current);
    expect(pair).toEqual(original);
    expect(output.diagnosis.calendar).toEqual(pair.context.calendar);
  });
  it("does not weaken legacy elapsed-time checks when calendar context is omitted", async () => {
    const pair = await fixture(), projection = projectBusinessState(pair.snapshot, pair.context);
    expect(diagnose(projection.input).changes.find(row => row.metricId === "revenue_net")?.reasons).toContain("period_durations_differ");
    expect(diagnose(projection.input, projection.calendar).revenue.status).toBe("explained_arithmetically");
  });
  it("supports a 169-hour fall-back week without rewriting timestamps", async () => {
    const output = report(await fixture("2026-11-03T16:00:00Z"));
    expect(output.timeContext.current?.elapsedHours).toBe(169);
    expect(output.diagnosis.revenue.observedDeltaMinorUnits).toBe(250000);
  });
  it("projects actual YoY source evidence, not the previous-week series", async () => {
    const output = report(await fixture("2026-09-30T16:00:00Z", "YOY"));
    expect(output.diagnosis.comparisonKind).toBe("YOY");
    expect(output.diagnosis.revenue.status).toBe("explained_arithmetically");
    expect(output.lineage.some(row => row.evidenceId === "revenue_net:YOY")).toBe(true);
  });
  it("explicit major and minor currency encodings produce the same economic results", async () => {
    const major = report(await fixture()), minor = report(await fixture("2026-03-10T16:00:00Z", "PREVIOUS", "MINOR_UNITS"));
    expect(major.diagnosis.revenue).toEqual(minor.diagnosis.revenue);
  });
  it("accepts binary floating error in a valid cent amount but rejects actual sub-cent totals", async () => {
    const pair = await fixture();
    for (const value of [29.29, 29.291]) {
      state(pair, "revenue_net").current = value; source(pair).value = value; state(pair, "aov").current = value / 100;
      const output = report(pair);
      if (value === 29.29) expect(output.diagnosis.changes.find(row => row.metricId === "revenue_net")?.current).toBe(2929);
      else expect(output.projectionIssues.some(row => row.code === "invalid_numeric_precision_or_range")).toBe(true);
    }
  });
  it("does not turn whole-snapshot completeness into source completeness", async () => {
    const pair = await fixture(); pair.snapshot.evidenceComplete = true; meta(pair).sourceScanComplete = false;
    expect(change(pair).status).toBe("unknown");
  });
  it("does not invent metadata when the sidecar is missing", async () => {
    const pair = await fixture(); pair.context.metadata = [];
    const output = report(pair);
    expect(output.diagnosis.status).toBe("unknown");
    expect(output.projectionIssues.some(row => row.code === "source_metadata_missing")).toBe(true);
  });
  for (const [name, mutate] of [
    ["wrong merchant", (pair: Pair) => { meta(pair).merchantId = "another-merchant"; }],
    ["wrong scope", (pair: Pair) => { meta(pair).scopeId = "all-channels"; }],
    ["wrong population", (pair: Pair) => { meta(pair).populationId = "consented-only"; }],
    ["wrong definition", (pair: Pair) => { meta(pair).definitionId = "gross-sales"; }],
    ["wrong currency", (pair: Pair) => { meta(pair).currency = "USD"; }],
    ["wrong encoding", (pair: Pair) => { meta(pair).valueEncoding = "MINOR_UNITS"; }],
    ["source disagreement", (pair: Pair) => { source(pair).source = "META_ADS"; }],
    ["summary disagreement", (pair: Pair) => { state(pair, "revenue_net").current = 987654321; }],
    ["wrong period", (pair: Pair) => { source(pair).periodStart = "2026-03-04T05:00:00Z"; }],
    ["coverage disagreement", (pair: Pair) => { source(pair).coverage = 0.5; }],
    ["stale source data", (pair: Pair) => { source(pair).freshnessSeconds = 172800; }],
    ["incomplete period", (pair: Pair) => { meta(pair).complete = false; }],
    ["partial source scan", (pair: Pair) => { meta(pair).sourceScanComplete = false; }],
    ["immature data", (pair: Pair) => { meta(pair).dataThrough = "2026-03-09T04:00:00Z"; }],
    ["unknown coverage", (pair: Pair) => { delete source(pair).coverage; meta(pair).coverage = null; }],
    ["canonical unit mismatch", (pair: Pair) => { state(pair, "revenue_net").unit = "COUNT"; }],
    ["canonical domain mismatch", (pair: Pair) => { state(pair, "revenue_net").domain = "CUSTOMER"; }],
    ["uncertain snapshot", (pair: Pair) => { state(pair, "revenue_net").confidence = "UNCERTAIN"; }],
  ] as const) it(`abstains on ${name}`, async () => {
    const pair = await fixture(); mutate(pair);
    expect(change(pair).status).toBe("unknown");
    expect(report(pair).diagnosis.revenue.drivers).toEqual([]);
  });
  it("future evidence cannot leak directly, via a derived ratio or through the projection API", async () => {
    const pair = await fixture();
    state(pair, "revenue_net").current = 987654321; source(pair).value = 987654321;
    source(pair).observedAt = "2026-03-11T16:00:00Z"; meta(pair).observedAt = source(pair).observedAt;
    state(pair, "aov").current = 9876543.21;
    expect(JSON.stringify(report(pair))).not.toContain("9876543");
    expect(JSON.stringify(projectBusinessState(pair.snapshot, pair.context))).not.toContain("9876543");
    expect(change(pair, "aov").current).toBeNull();
  });
  it("the core also quarantines derived values whose source lineage is unsafe", async () => {
    const pair = await fixture(), projection = projectBusinessState(pair.snapshot, pair.context);
    const value = { ...projection.input, metrics: projection.input.metrics.map(row => ({ ...row })) };
    value.metrics.find(row => row.metricId === "revenue_net")!.current = { ...value.metrics.find(row => row.metricId === "revenue_net")!.current, observedAt: "2026-03-11T16:00:00Z" };
    value.metrics.find(row => row.metricId === "aov")!.current = { ...value.metrics.find(row => row.metricId === "aov")!.current, value: 9876543.21 };
    expect(JSON.stringify(diagnose(value, projection.calendar))).not.toContain("9876543");
  });
  it("low session sample quality does not erase reliable Shopify revenue", async () => {
    const pair = await fixture(); source(pair, "sessions").sampleSize = 10;
    expect(change(pair).delta).toBe(250000);
    expect(change(pair, "cvr").status).toBe("unknown");
    expect(report(pair).diagnosis.revenue.partitionId).toBe("orders_x_aov");
  });
  it("conflicting derived snapshot values are not accepted just because the source says DERIVED", async () => {
    const pair = await fixture(); state(pair, "aov").current = 99999;
    expect(change(pair, "aov").status).toBe("unknown");
    expect(report(pair).projectionIssues.some(row => row.code === "snapshot_derived_value_disagreement")).toBe(true);
  });
  it("missing derived snapshot rows can be calculated only from verified canonical operands", async () => {
    const pair = await fixture(); pair.snapshot.metrics = pair.snapshot.metrics.filter(row => row.metricId !== "aov" && row.metricId !== "cvr");
    expect(report(pair).diagnosis.revenue.status).toBe("explained_arithmetically");
    expect(report(pair).lineage.filter(row => row.calculation !== null)).toHaveLength(4);
  });
  it("zero orders preserve the observed revenue change but do not invent AOV", async () => {
    const pair = await fixture(); state(pair, "orders").current = 0; source(pair, "orders").value = 0;
    state(pair, "aov").current = null; state(pair, "aov").confidence = "UNKNOWN";
    expect(change(pair).delta).toBe(250000);
    expect(change(pair, "aov").status).toBe("unknown");
  });
  it("source method changes also block comparisons of derived ratios", async () => {
    const pair = await fixture(); meta(pair).measurementId = "new-net-sales-method";
    expect(change(pair).reasons).toContain("measurementId_changed");
    expect(change(pair, "aov").status).toBe("unknown");
  });
  it("ambiguous multiple evidence rows are not summed or silently selected", async () => {
    const pair = await fixture(); state(pair, "revenue_net").evidence.push({ ...source(pair), evidenceId: "extra-revenue" });
    expect(report(pair).projectionIssues.some(row => row.code === "ambiguous_source_evidence")).toBe(true);
  });
  it("coverage degrades derived confidence rather than being reset to 100%", async () => {
    const pair = await fixture(); source(pair).coverage = 0.97; meta(pair).coverage = 0.97; state(pair, "revenue_net").confidence = "PARTIAL";
    expect(change(pair, "aov").confidence.level).toBe("MEDIUM");
    expect(report(pair).diagnosis.revenue.confidence.level).toBe("MEDIUM");
  });
  for (const [name, mutate] of [
    ["request merchant", (pair: Pair) => { pair.context.merchantId = "wrong"; }],
    ["request snapshot", (pair: Pair) => { pair.context.snapshotId = "wrong"; }],
    ["request asOf", (pair: Pair) => { pair.context.asOf = "2026-03-11T16:00:00Z"; }],
    ["request timezone", (pair: Pair) => { pair.context.calendar.timezone = "UTC"; }],
    ["request current window", (pair: Pair) => { pair.context.current.start = "2026-03-02T05:00:00Z"; }],
    ["duplicate metadata", (pair: Pair) => { pair.context.metadata.push({ ...meta(pair) }); }],
    ["duplicate source IDs", (pair: Pair) => { state(pair, "revenue_net").evidence.push({ ...source(pair) }); }],
    ["unbound metadata", (pair: Pair) => { meta(pair).evidenceId = "not-a-snapshot-evidence-id"; }],
  ] as const) it(`rejects ${name} before producing a report`, async () => {
    const pair = await fixture(); mutate(pair);
    expect(() => report(pair)).toThrow(BusinessStateProjectionError);
  });
  it("rejects hidden truth in snapshot, metadata, context and policy", async () => {
    for (const target of ["snapshot", "context", "metadata", "policy"] as const) {
      const pair = await fixture();
      const object = target === "snapshot" ? pair.snapshot : target === "metadata" ? meta(pair) : target === "policy" ? pair.context.policy : pair.context;
      Object.assign(object, { groundTruth: { actualBestDriver: "discount" } });
      expect(() => report(pair)).toThrow(BusinessStateProjectionError);
    }
  });
  it("rejects accessor execution before parsing", async () => {
    const pair = await fixture(); const get = vi.fn(() => "secret");
    Object.defineProperty(pair.context, "merchantId", { get });
    expect(() => report(pair)).toThrow(BusinessStateProjectionError); expect(get).not.toHaveBeenCalled();
  });
  it("keeps source, metadata and calculated operand lineage resolvable", async () => {
    const pair = await fixture(), output = report(pair);
    const lineIds = new Set(output.lineage.map(row => row.evidenceId));
    expect(output.lineage.every(row => row.operandEvidenceIds.every(id => lineIds.has(id)))).toBe(true);
    expect(output.lineage.filter(row => row.calculation === null).every(row => row.metadataEvidenceIds.length === 1)).toBe(true);
    const graphIds = new Set(output.diagnosis.evidenceGraph.nodes.map(row => row.id));
    expect(output.diagnosis.evidenceGraph.edges.every(row => graphIds.has(row.from) && graphIds.has(row.to))).toBe(true);
  });
  it("replays deterministically with reordered metadata and snapshot metrics", async () => {
    const pair = await fixture(), original = JSON.stringify(report(pair));
    pair.snapshot.metrics.reverse(); pair.context.metadata.reverse();
    for (const row of pair.snapshot.metrics) row.evidence.reverse();
    expect(JSON.stringify(report(pair))).toBe(original);
  });
});
