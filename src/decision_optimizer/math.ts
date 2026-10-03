import { INPUT_METRICS, type DistributionSummary, type Metric, type Metrics, type Objective } from "./types.js";

export function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid finite number: ${label}`);
}
export function nonnegative(value: unknown, label: string): asserts value is number {
  finite(value, label); if (value < 0) throw new Error(`Negative ${label}`);
}
export function need(metrics: Metrics, key: keyof Metrics): number {
  const value = metrics[key]; finite(value, `metric ${key}`); return value;
}
export function metricValue(metrics: Metrics, metric: Metric): number {
  if (metric === "contributionProfit") {
    return need(metrics, "netRevenue") - need(metrics, "costOfGoods") - need(metrics, "fulfillmentCost")
      - need(metrics, "paidMediaCost") - need(metrics, "otherVariableCost") - need(metrics, "interventionCost");
  }
  if (["grossMarginRate", "retentionRate", "conversionRate", "cac"].includes(metric)) {
    const [numerator, denominator] = metric === "grossMarginRate"
      ? [need(metrics, "netRevenue") - need(metrics, "costOfGoods"), need(metrics, "netRevenue")]
      : metric === "retentionRate" ? [need(metrics, "retainedCustomers"), need(metrics, "eligibleCustomers")]
      : metric === "conversionRate" ? [need(metrics, "orders"), need(metrics, "sessions")]
      : [need(metrics, "paidMediaCost"), need(metrics, "newCustomers")];
    if (!(denominator > 0)) throw new Error(`Undefined denominator for ${metric}`);
    return numerator / denominator;
  }
  return need(metrics, metric as keyof Metrics);
}
export function validateMetrics(metrics: Metrics): void {
  for (const [key, value] of Object.entries(metrics)) {
    if (!(INPUT_METRICS as readonly string[]).includes(key)) throw new Error(`Unknown metric ${key}`);
    finite(value, key);
    if (!["netRevenue", "netCash", "attributedRevenue"].includes(key) && value < 0) throw new Error(`Negative total ${key}`);
  }
  if (metrics.retainedCustomers !== undefined && metrics.eligibleCustomers !== undefined && metrics.retainedCustomers > metrics.eligibleCustomers)
    throw new Error("Retained customers exceed eligible customers");
}
/** Recompute ratios from segment totals; never average segment CVR/CAC/retention rates. */
export function aggregateMetricTotals(segments: readonly Metrics[]): Metrics {
  if (!segments.length) throw new Error("Segments required");
  const result: Metrics = {};
  for (const part of segments) validateMetrics(part);
  for (const key of INPUT_METRICS) {
    if (key === "reportedRoas") continue;
    if (segments.every(part => part[key] !== undefined)) result[key] = segments.reduce((total, part) => total + need(part, key), 0);
  }
  validateMetrics(result); return result;
}
export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  if (values.length !== weights.length || !values.length) throw new Error("Mismatched distribution");
  let mass = 0; let offset = 0; let correction = 0;
  const anchor = values[0]!;
  for (let i = 0; i < values.length; i++) {
    finite(values[i], "sample"); nonnegative(weights[i], "probability"); mass += weights[i]!;
    // Centering preserves exact constants; compensated summation limits cancellation.
    const term = (values[i]! - anchor) * weights[i]! - correction;
    const next = offset + term; correction = (next - offset) - term; offset = next;
  }
  if (!(mass > 0) || Math.abs(mass - 1) > 1e-10) throw new Error("Invalid probability mass");
  const total = anchor + offset / mass;
  finite(total, "weighted result"); return total;
}
export function distribution(values: readonly number[], weights: readonly number[], tail: number): DistributionSummary {
  if (!(tail > 0 && tail < 0.5)) throw new Error("Tail probability must be between zero and one half");
  for (const value of values) finite(value, "sample");
  const mean = weightedMean(values, weights);
  const sorted = values.map((value, index) => ({ value, weight: weights[index]! })).sort((a, b) => a.value - b.value);
  const quantile = (probability: number): number => {
    let cumulative = 0;
    for (const sample of sorted) { cumulative += sample.weight; if (cumulative + 1e-12 >= probability) return sample.value; }
    return sorted[sorted.length - 1]!.value;
  };
  let remaining = tail; let tailTotal = 0;
  for (const sample of sorted) {
    const mass = Math.min(remaining, sample.weight); tailTotal += mass * sample.value; remaining -= mass;
    if (remaining <= 1e-12) break;
  }
  return { mean, standardDeviation: Math.sqrt(weightedMean(values.map(value => (value - mean) ** 2), weights)),
    low: quantile(tail), high: quantile(1 - tail), lowerTailMean: tailTotal / tail };
}
export function incrementalUtility(after: Metrics, before: Metrics, objective: Objective): number {
  const value = objective.terms.reduce((total, term) => total + (term.direction === "MAXIMIZE" ? 1 : -1)
    * term.weight * (metricValue(after, term.metric) - metricValue(before, term.metric)) / term.scale, 0);
  finite(value, "utility"); return value;
}
/** Controlled vocabulary only. Complex/ambiguous natural language is not silently interpreted. */
export function objectiveFromIntent(intent: string, scale = 1): Objective {
  const key = intent.trim().toLowerCase().replace(/\s+/g, " ");
  const aliases: Record<string, Objective["terms"][number]> = {
    "maximize contribution profit": { metric: "contributionProfit", direction: "MAXIMIZE", weight: 1, scale },
    "maximize revenue": { metric: "netRevenue", direction: "MAXIMIZE", weight: 1, scale },
    "acquire new customers": { metric: "newCustomers", direction: "MAXIMIZE", weight: 1, scale },
    "reduce inventory": { metric: "inventoryUnits", direction: "MINIMIZE", weight: 1, scale },
    "improve retention": { metric: "retentionRate", direction: "MAXIMIZE", weight: 1, scale },
    "generate cash": { metric: "netCash", direction: "MAXIMIZE", weight: 1, scale },
  };
  const term = Object.hasOwn(aliases, key) ? aliases[key] : undefined;
  if (!term) throw new Error("Unresolved intent: supply explicit objective terms and hard constraints");
  finite(scale, "objective scale"); if (scale <= 0) throw new Error("Positive objective scale required");
  return { intent, terms: [term] };
}
