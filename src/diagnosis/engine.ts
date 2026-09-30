import { DIAGNOSIS_VERSION } from "./contract.js";
import type { Change, Confidence, ConfidenceLevel, DiagnosisInput, DiagnosisReport, Driver, EvidenceEdge, EvidenceNode, MetricId, MetricSeries, Observation, RevenueDecomposition, Source, Unknown } from "./contract.js";
import { allocateProductChange, roundEffects } from "./math.js";
import { parseDiagnosisInput } from "./validate.js";

const AUTHORITY: Readonly<Record<MetricId, Source>> = {
  revenue_net: "SHOPIFY", orders: "SHOPIFY", aov: "DERIVED", sessions: "GA4", cvr: "DERIVED",
};
const LABEL: Readonly<Record<MetricId, string>> = {
  revenue_net: "net revenue", orders: "order volume", aov: "average order value", sessions: "sessions", cvr: "conversion rate",
};
const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();
const near = (a: number, b: number, tolerance: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
function confidence(level: ConfidenceLevel, reasons: readonly string[]): Confidence {
  return { level, basis: "deterministic_evidence_rubric_not_probability", reasons: unique(reasons), statisticalSignificance: "not_assessed" };
}
function seriesEvidence(series: readonly MetricSeries[]): string[] {
  return unique(series.flatMap(metric => [metric.reference.evidenceId, metric.current.evidenceId]).filter((id): id is string => id !== null));
}
function date(value: string): number { return Date.parse(value); }
function equalWindow(a: Observation, b: Observation): boolean {
  return date(a.window.start) === date(b.window.start) && date(a.window.end) === date(b.window.end);
}
function observationProblems(observation: Observation, series: MetricSeries, input: DiagnosisInput): string[] {
  const problems: string[] = [];
  if (observation.value === null) problems.push("value_missing");
  if (observation.merchantId !== input.merchantId) problems.push("merchant_mismatch");
  if (observation.source !== AUTHORITY[series.metricId]) problems.push("non_authoritative_source");
  if (observation.evidenceId === null) problems.push("evidence_reference_missing");
  if (!observation.complete) problems.push("period_incomplete");
  if (!observation.sourceScanComplete) problems.push("source_scan_incomplete");
  if (observation.coverage === null) problems.push("coverage_unknown");
  else if (observation.coverage < input.policy.minimumCoverage) problems.push("coverage_below_threshold");
  if (series.unit === "MONEY" && observation.currency !== input.currency) problems.push("currency_mismatch");
  if (date(observation.window.end) > date(input.asOf)) problems.push("period_not_closed_at_as_of");
  if (observation.observedAt === null) problems.push("observation_timestamp_missing");
  else {
    const age = (date(input.asOf) - date(observation.observedAt)) / 1000;
    if (age < 0) problems.push("future_evidence");
    else if (age > input.policy.maxAgeSeconds) problems.push("stale_evidence");
  }
  if (observation.dataThrough === null) problems.push("data_latency_unknown");
  else {
    if (date(observation.dataThrough) < date(observation.window.end)) problems.push("data_not_mature");
    if (observation.observedAt !== null && date(observation.dataThrough) > date(observation.observedAt)) problems.push("data_through_after_observation");
  }
  return problems;
}
function compare(series: MetricSeries, input: DiagnosisInput): Change {
  const a = series.reference, b = series.current;
  const referenceProblems = observationProblems(a, series, input), currentProblems = observationProblems(b, series, input);
  const problems = [...referenceProblems, ...currentProblems];
  for (const field of ["scopeId", "populationId", "definitionId", "measurementId"] as const) {
    if (a[field] !== b[field]) problems.push(`${field}_changed`);
  }
  if (a.source !== b.source) problems.push("source_changed");
  if ((date(a.window.end) - date(a.window.start)) !== (date(b.window.end) - date(b.window.start))) problems.push("period_durations_differ");
  if (date(a.window.end) > date(b.window.start)) problems.push("reference_overlaps_or_follows_current");
  if (input.comparisonKind === "PREVIOUS" && date(a.window.end) !== date(b.window.start)) problems.push("previous_period_not_adjacent");
  if (input.comparisonKind === "YOY") {
    for (const boundary of ["start", "end"] as const) {
      const currentDate = new Date(b.window[boundary]);
      const expected = new Date(currentDate);
      expected.setUTCFullYear(currentDate.getUTCFullYear() - 1);
      if (expected.getUTCMonth() !== currentDate.getUTCMonth() || expected.getUTCDate() !== currentDate.getUTCDate() || expected.getTime() !== date(a.window[boundary])) problems.push("yoy_period_alignment_unverified");
    }
  }
  const reasons = unique(problems);
  const evidenceIds = [referenceProblems.length === 0 ? a.evidenceId : null, currentProblems.length === 0 ? b.evidenceId : null].filter((id): id is string => id !== null).sort();
  const shared = { id: `change:${series.metricId}`, metricId: series.metricId, unit: series.unit, evidenceClass: "observed_change" as const,
    reference: referenceProblems.length === 0 ? a.value : null, current: currentProblems.length === 0 ? b.value : null, evidenceIds };
  if (reasons.length > 0) return { ...shared, status: "unknown", delta: null, relativeDelta: null, reasons,
    confidence: confidence("UNKNOWN", reasons) };
  const delta = b.value! - a.value!;
  const ratio = a.value === 0 ? null : delta / Math.abs(a.value!);
  const relativeDelta = ratio !== null && Number.isFinite(ratio) ? ratio : null;
  const rule = input.policy.materiality[series.metricId]!;
  const material = delta !== 0 && Math.abs(delta) >= rule.absolute && (a.value === 0 || Math.abs(delta) >= rule.relative * Math.abs(a.value!));
  const fullCoverage = a.coverage === 1 && b.coverage === 1;
  const score = confidence(fullCoverage ? "HIGH" : "MEDIUM", fullCoverage
    ? ["authoritative_complete_comparable_observations", "statistical_significance_not_assessed"]
    : ["coverage_passes_policy_but_is_not_complete", "statistical_significance_not_assessed"]);
  return { ...shared, status: material ? "material" : "immaterial", delta, relativeDelta, reasons: a.value === 0 ? ["zero_reference_percentage_undefined"] : relativeDelta === null ? ["relative_change_out_of_range"] : [], confidence: score };
}
function compatible(series: readonly MetricSeries[]): boolean {
  const first = series[0];
  if (!first) return false;
  return series.every(metric => (["reference", "current"] as const).every(period => {
    const a = first[period], b = metric[period];
    return equalWindow(a, b) && a.scopeId === b.scopeId && a.populationId === b.populationId && a.merchantId === b.merchantId;
  }));
}
/** Derived observations are not authoritative merely because they say DERIVED. */
function validateDerivedLineage(input: DiagnosisInput, initial: readonly Change[]): Change[] {
  const byId = new Map(input.metrics.map(metric => [metric.metricId, metric]));
  const compared = new Map(initial.map(change => [change.metricId, change]));
  for (const [id, numeratorId, denominatorId] of [["aov", "revenue_net", "orders"], ["cvr", "orders", "sessions"]] as const) {
    const change = compared.get(id);
    if (!change || change.status === "unknown") continue;
    const value = byId.get(id)!, numerator = byId.get(numeratorId), denominator = byId.get(denominatorId);
    let reason: string | null = null;
    if (!numerator || !denominator || compared.get(numeratorId)?.status === "unknown" || compared.get(denominatorId)?.status === "unknown") reason = "derived_lineage_missing_or_unusable";
    else if (!compatible([value, numerator, denominator])) reason = "derived_scope_or_period_mismatch";
    else if (denominator.reference.value! <= 0 || denominator.current.value! <= 0) reason = "derived_denominator_zero";
    else if ((["reference", "current"] as const).some(period => !near(numerator[period].value!, denominator[period].value! * value[period].value!, id === "aov" ? input.policy.identityToleranceMinorUnits : 1e-8))) reason = "derived_identity_failed";
    if (reason !== null) compared.set(id, { ...change, status: "unknown", delta: null, relativeDelta: null, reasons: unique([...change.reasons, reason]), confidence: confidence("UNKNOWN", [reason]) });
    else {
      const full = [value, numerator!, denominator!].every(metric => metric.reference.coverage === 1 && metric.current.coverage === 1);
      compared.set(id, { ...change, evidenceIds: seriesEvidence([value, numerator!, denominator!]), confidence: confidence(full ? "HIGH" : "MEDIUM", ["derived_lineage_and_identity_verified", ...(full ? [] : ["dependency_coverage_incomplete"]), "statistical_significance_not_assessed"]) });
    }
  }
  return [...compared.values()];
}
function decomposeRevenue(input: DiagnosisInput, changes: readonly Change[]): RevenueDecomposition {
  const byId = new Map(input.metrics.map(metric => [metric.metricId, metric]));
  const compared = new Map(changes.map(change => [change.metricId, change]));
  const totalDelta = compared.get("revenue_net")?.delta ?? null;
  const unknown = (reason: string): RevenueDecomposition => ({ status: "unknown", method: null, partitionId: null,
    observedDeltaMinorUnits: totalDelta, allocatedDeltaMinorUnits: 0, arithmeticResidualMinorUnits: totalDelta,
    causalExplanation: "not_established", causallyExplainedMinorUnits: null, drivers: [], reasons: [reason], confidence: confidence("UNKNOWN", [reason]) });
  if (totalDelta === null) return unknown("revenue_comparison_unavailable");
  const basicIds = ["revenue_net", "orders", "aov"] as const;
  if (basicIds.some(id => !byId.has(id) || compared.get(id)?.delta === null)) return unknown("revenue_orders_aov_evidence_required");
  const basic = basicIds.map(id => byId.get(id)!);
  if (!compatible(basic)) return unknown("revenue_orders_aov_scope_or_period_mismatch");
  const revenue = byId.get("revenue_net")!, orders = byId.get("orders")!, aov = byId.get("aov")!;
  if (orders.reference.value! <= 0 || orders.current.value! <= 0) return unknown("aov_undefined_for_zero_orders");
  const tolerance = input.policy.identityToleranceMinorUnits;
  for (const period of ["reference", "current"] as const) {
    if (!near(revenue[period].value!, orders[period].value! * aov[period].value!, tolerance)) return unknown("revenue_orders_aov_identity_failed");
  }
  let factorIds: MetricId[] = ["orders", "aov"];
  let partitionId: "orders_x_aov" | "sessions_x_cvr_x_aov" = "orders_x_aov";
  const reasons: string[] = [];
  const sessions = byId.get("sessions"), cvr = byId.get("cvr");
  if (sessions && cvr && compared.get("sessions")?.delta !== null && compared.get("cvr")?.delta !== null) {
    if (!compatible([...basic, sessions, cvr])) reasons.push("traffic_conversion_partition_scope_or_period_mismatch");
    else if (sessions.reference.value! <= 0 || sessions.current.value! <= 0) reasons.push("conversion_undefined_for_zero_sessions");
    else if ((["reference", "current"] as const).some(period => !near(orders[period].value!, sessions[period].value! * cvr[period].value!, 1e-8))) {
      reasons.push("orders_sessions_cvr_identity_failed");
    } else {
      factorIds = ["sessions", "cvr", "aov"];
      partitionId = "sessions_x_cvr_x_aov";
    }
  } else reasons.push("traffic_conversion_partition_evidence_unavailable");
  const factors = factorIds.map(id => byId.get(id)!);
  const effects = roundEffects(allocateProductChange(factors.map(metric => metric.reference.value!), factors.map(metric => metric.current.value!)));
  const allocated = effects.reduce((sum, value) => sum + value, 0);
  const residual = totalDelta - allocated;
  const driverEvidence = seriesEvidence([...basic, ...factors]);
  const drivers: Driver[] = factorIds.map((id, index): Driver => ({ id: `driver:${partitionId}:${id}`, metricId: id, evidenceClass: "associated_driver",
    interpretation: "arithmetic_allocation_not_causation", partitionId, effectMinorUnits: effects[index]!,
    signedShareOfNetChange: totalDelta === 0 ? null : effects[index]! / totalDelta, evidenceIds: driverEvidence }))
    .sort((a, b) => Math.abs(b.effectMinorUnits) - Math.abs(a.effectMinorUnits) || a.metricId.localeCompare(b.metricId, "en"));
  if (residual !== 0) reasons.push("nonzero_arithmetic_residual_retained");
  const completeCoverage = [...basic, ...factors].every(metric => metric.reference.coverage === 1 && metric.current.coverage === 1);
  return { status: residual === 0 ? "explained_arithmetically" : "partial", method: "symmetric_product_allocation", partitionId,
    observedDeltaMinorUnits: totalDelta, allocatedDeltaMinorUnits: allocated, arithmeticResidualMinorUnits: residual,
    causalExplanation: "not_established", causallyExplainedMinorUnits: null, drivers, reasons,
    confidence: confidence(completeCoverage && residual === 0 ? "HIGH" : "MEDIUM", ["validated_accounting_identity", "interaction_terms_allocated_once", "not_causal_evidence", ...(completeCoverage ? [] : ["dependency_coverage_incomplete"]), ...(residual !== 0 ? ["nonzero_arithmetic_residual_retained"] : [])]) };
}
function evidenceNeeded(reason: string): string {
  if (/scope|population|merchant/.test(reason)) return "Same-merchant, same-scope, same-population evidence for both periods.";
  if (/measurement|definition|source_changed/.test(reason)) return "A reconciled comparison under the same versioned definition and measurement method.";
  if (/authority|authoritative/.test(reason)) return "The canonical source observation, not platform-attributed revenue substituted for store revenue.";
  if (/period|overlap|as_of/.test(reason)) return "Closed, nonoverlapping and explicitly aligned comparison windows.";
  if (/coverage|scan/.test(reason)) return "Complete source scans and verified coverage denominators for both periods.";
  if (/stale|timestamp|future|latency|mature|data_through/.test(reason)) return "Source evidence available by asOf, refreshed and mature through each period end.";
  if (/identity/.test(reason)) return "Reconciled numerator/denominator inputs with matching scopes and unrounded ratios.";
  if (/zero_orders/.test(reason)) return "A nonzero-order comparison or an alternative decomposition that does not use undefined AOV.";
  if (/currency/.test(reason)) return "Same-currency observations with explicit and consistent minor-unit scaling.";
  return "Authoritative revenue, orders, AOV and, for the traffic split, matched storefront sessions and CVR evidence.";
}
function buildUnknowns(changes: readonly Change[], revenue: RevenueDecomposition): Unknown[] {
  const unknowns: Unknown[] = changes.filter(change => change.status === "unknown").map(change => ({
    id: `unknown:${change.metricId}`, whatIsKnown: `The supplied ${LABEL[change.metricId]} observations failed comparability or quality checks.`,
    whatIsUnknown: `A defensible ${LABEL[change.metricId]} change cannot be established: ${change.reasons.join(", ")}.`,
    evidenceNeeded: unique(change.reasons.map(evidenceNeeded)),
  }));
  if (revenue.status === "unknown") unknowns.push({ id: "unknown:revenue_allocation",
    whatIsKnown: revenue.observedDeltaMinorUnits === null ? "A comparable revenue change is unavailable." : `Observed revenue change is ${revenue.observedDeltaMinorUnits} minor units.`,
    whatIsUnknown: `Revenue driver allocation is unresolved: ${revenue.reasons.join(", ")}.`, evidenceNeeded: unique(revenue.reasons.map(evidenceNeeded)) });
  if (revenue.reasons.some(reason => reason.startsWith("traffic_") || reason.startsWith("orders_sessions") || reason.startsWith("conversion_"))) {
    unknowns.push({ id: "unknown:traffic_partition", whatIsKnown: "The orders/AOV allocation can be evaluated independently of the traffic split.",
      whatIsUnknown: "The traffic/CVR allocation is unavailable or incompatible.", evidenceNeeded: unique(revenue.reasons.map(evidenceNeeded)) });
  }
  unknowns.push({ id: "unknown:causal_explanation", whatIsKnown: "Observed changes and arithmetic contributions do not establish causal effects.",
    whatIsUnknown: "Why these factors changed, and how much change any intervention caused, remain unidentified.",
    evidenceNeeded: ["Candidate-specific additional evidence; causal claims require a valid experiment or an identified causal design with documented assumptions."] });
  return unknowns;
}
function graph(input: DiagnosisInput, changes: readonly Change[], revenue: RevenueDecomposition, unknowns: readonly Unknown[]): DiagnosisReport["evidenceGraph"] {
  const nodes: EvidenceNode[] = [], edges: EvidenceEdge[] = [];
  for (const change of changes) {
    const series = input.metrics.find(metric => metric.metricId === change.metricId)!;
    nodes.push({ id: change.id, kind: "change", metricId: change.metricId, label: `${LABEL[change.metricId]}: ${change.status}`, ...(change.delta !== null ? { value: change.delta } : {}) });
    for (const period of ["reference", "current"] as const) {
      const observation = series[period];
      if (observation.evidenceId === null || observationProblems(observation, series, input).length > 0) continue;
      const id = `source:${change.metricId}:${period}`;
      nodes.push({ id, kind: "source", label: `${change.metricId}:${period}`, metricId: change.metricId, evidenceId: observation.evidenceId,
        window: { ...observation.window }, scopeId: observation.scopeId, populationId: observation.populationId,
        definitionId: observation.definitionId, measurementId: observation.measurementId,
        ...(observation.value !== null ? { value: observation.value } : {}), ...(observation.source !== null ? { source: observation.source } : {}),
        ...(observation.observedAt !== null ? { observedAt: observation.observedAt } : {}), ...(observation.coverage !== null ? { coverage: observation.coverage } : {}) });
      edges.push({ from: id, to: change.id, relation: "supports" });
    }
    nodes.push({ id: `confidence:${change.metricId}`, kind: "confidence", label: change.confidence.level });
    edges.push({ from: `confidence:${change.metricId}`, to: change.id, relation: "qualifies" });
  }
  for (const [derived, operands] of [["aov", ["revenue_net", "orders"]], ["cvr", ["orders", "sessions"]]] as const) {
    if (!changes.some(change => change.metricId === derived && change.status !== "unknown")) continue;
    for (const period of ["reference", "current"] as const) for (const operand of operands) {
      edges.push({ from: `source:${operand}:${period}`, to: `source:${derived}:${period}`, relation: "computed_from" });
    }
  }
  if (revenue.partitionId !== null) {
    const calculationId = `calculation:${revenue.partitionId}`;
    nodes.push({ id: calculationId, kind: "calculation", label: "Permutation-average product-change identity; equal allocation of interaction terms", value: revenue.allocatedDeltaMinorUnits });
    const used = new Set<MetricId>(["revenue_net", "orders", "aov", ...revenue.drivers.map(driver => driver.metricId)]);
    for (const id of used) edges.push({ from: `change:${id}`, to: calculationId, relation: "computed_from" });
    nodes.push({ id: "confidence:revenue_allocation", kind: "confidence", label: `${revenue.confidence.level}; arithmetic, not causal` });
    edges.push({ from: "confidence:revenue_allocation", to: calculationId, relation: "qualifies" });
    for (const driver of revenue.drivers) {
      nodes.push({ id: driver.id, kind: "driver", metricId: driver.metricId, label: LABEL[driver.metricId], value: driver.effectMinorUnits });
      edges.push({ from: calculationId, to: driver.id, relation: "supports" });
    }
  }
  for (const unknown of unknowns) {
    nodes.push({ id: unknown.id, kind: "uncertainty", label: unknown.whatIsUnknown });
    const relatedId = unknown.id.replace("unknown:", "change:");
    if (nodes.some(node => node.id === relatedId)) edges.push({ from: unknown.id, to: relatedId, relation: "qualifies" });
    else if (nodes.some(node => node.id === "change:revenue_net")) edges.push({ from: unknown.id, to: "change:revenue_net", relation: "qualifies" });
  }
  return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id, "en")), edges: edges.sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`, "en")) };
}
function render(input: DiagnosisInput, changes: readonly Change[], revenue: RevenueDecomposition): string {
  const change = changes.find(row => row.metricId === "revenue_net");
  if (!change || change.delta === null) return "A reliable revenue comparison is unavailable. The report lists what is missing and the evidence needed; no driver is asserted.";
  const decimals = Math.log10(input.minorUnitsPerMajor);
  const money = (value: number): string => `${input.currency} ${(Math.abs(value) / input.minorUnitsPerMajor).toFixed(decimals)}`;
  const comparison = input.comparisonKind === "PREVIOUS" ? "previous period" : input.comparisonKind === "YOY" ? "year-over-year reference" : "seasonal baseline";
  let sentence = change.delta === 0 ? `Net revenue was unchanged versus the ${comparison}.`
    : `Net revenue ${change.delta > 0 ? "increased" : "decreased"} by ${money(change.delta)} versus the ${comparison}`
      + (change.reference! > 0 && change.relativeDelta !== null ? ` (${Math.abs(change.relativeDelta * 100).toFixed(1)}%).` : ". Percentage growth is not reported for a zero or negative reference.");
  if (change.status === "immaterial" && change.delta !== 0) sentence += " The change is below the configured commercial materiality thresholds.";
  if (revenue.status === "unknown") return sentence + " The evidence does not support a reconciled driver breakdown. Statistical significance and causal explanations have not been established.";
  sentence += " Arithmetic allocation: " + revenue.drivers.map(driver => `${LABEL[driver.metricId]} ${driver.effectMinorUnits < 0 ? "−" : "+"}${money(driver.effectMinorUnits)}`).join("; ") + ".";
  if (revenue.arithmeticResidualMinorUnits !== 0) sentence += ` Unallocated arithmetic residual: ${revenue.arithmeticResidualMinorUnits! < 0 ? "−" : "+"}${money(revenue.arithmeticResidualMinorUnits!)}.`;
  return sentence + " This reconciles the numbers, not why the factors changed. Statistical significance has not been assessed.";
}

/** Entry point consumes an explicit observed-evidence projection, NEVER simulator truth. */
export function diagnose(raw: unknown): DiagnosisReport {
  const input = parseDiagnosisInput(raw);
  const changes = validateDerivedLineage(input, input.metrics.map(metric => compare(metric, input))).sort((a, b) => a.metricId.localeCompare(b.metricId, "en"));
  const revenue = decomposeRevenue(input, changes);
  const unknowns = buildUnknowns(changes, revenue);
  const status = changes.every(change => change.status === "unknown") ? "unknown"
    : revenue.status !== "explained_arithmetically" || changes.some(change => change.status === "unknown") ? "partial" : "diagnosed";
  return { version: DIAGNOSIS_VERSION, snapshotId: input.snapshotId, merchantId: input.merchantId, asOf: input.asOf,
    comparisonKind: input.comparisonKind, currency: input.currency, minorUnitsPerMajor: input.minorUnitsPerMajor,
    status, changes, revenue, unknowns, evidenceGraph: graph(input, changes, revenue, unknowns), explanation: render(input, changes, revenue),
    limitations: ["Draft foundation: supports net revenue, orders, AOV, sessions and CVR only.",
      "Confidence is a rule-based evidence-quality label, not a probability or causal confidence.",
      "Commercial materiality is assessed; statistical significance, trend and calendar adjustment are not.",
      "Equal-duration windows are required. Previous periods must be adjacent; YoY must match UTC calendar dates. DST, leap-day and weekday-aligned comparisons need the planned time-context adapter.",
      "The Business State adapter, domain diagnoses and hypothesis retrieval are not implemented in this increment."] };
}

/** Reproducible output is derived from evidence; no ungrounded language-model claims. */
export function serializeDiagnosis(input: unknown): string {
  return JSON.stringify(diagnose(input), null, 2);
}
