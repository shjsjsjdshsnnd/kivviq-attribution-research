import {
  BUSINESS_STATE_VERSION,
  businessStateSnapshotSchema,
  type BusinessConstraint,
  type BusinessStateSnapshot,
  type DerivedSignalCode,
  type MetricState,
  type StateDomain,
  type MetricUnit,
} from "../../src/business_state/schema.js";

const START = "2026-09-01T00:00:00.000Z";
const END = "2026-10-01T00:00:00.000Z";

const sourceFor = (domain: StateDomain) =>
  domain === "ACQUISITION" ? "GA4" as const
  : domain === "LIFECYCLE" ? "OMNISEND" as const
  : "DERIVED" as const;

function metric(
  metricId: MetricState["metricId"],
  domain: StateDomain,
  unit: MetricUnit,
  current: number,
  previous: number = current,
  trend: MetricState["trend"] = "FLAT",
): MetricState {
  const evidenceId = "ev_" + metricId;
  return {
    metricId,
    domain,
    unit,
    current,
    previous,
    deltaVsPrevious: current - previous,
    deltaPctVsPrevious: previous === 0 ? null : (current - previous) / Math.abs(previous),
    trend,
    confidence: "KNOWN",
    evidence: [{
      evidenceId,
      metricId,
      source: sourceFor(domain),
      periodKind: "CURRENT",
      observedAt: END,
      periodStart: START,
      periodEnd: END,
      value: current,
      coverage: 1,
    }],
    unknownReasons: [],
  };
}

const defaults: MetricState[] = [
  metric("revenue_net", "COMMERCIAL", "MONEY", 100000, 90000, "RISING"),
  metric("orders", "COMMERCIAL", "COUNT", 100, 90, "RISING"),
  metric("aov", "COMMERCIAL", "MONEY", 1000, 1000),
  metric("discount_rate", "COMMERCIAL", "RATIO", 0.1, 0.08, "RISING"),
  metric("return_rate", "PROFITABILITY", "RATIO", 0.05, 0.04, "FLAT"),
  metric("returns_cost", "PROFITABILITY", "MONEY", 5000, 4000, "RISING"),
  metric("gross_margin", "PROFITABILITY", "RATIO", 0.45, 0.46, "FLAT"),
  metric("shipping_fulfillment_cost", "PROFITABILITY", "MONEY", 7000, 6500, "FLAT"),
  metric("contribution_profit", "PROFITABILITY", "MONEY", 25000, 24000, "RISING"),
  metric("sessions", "ACQUISITION", "COUNT", 1000, 1000),
  metric("cvr", "ACQUISITION", "RATIO", 0.1, 0.1),
  metric("new_customers", "ACQUISITION", "COUNT", 50, 48),
  metric("cac", "ACQUISITION", "MONEY", 120, 110, "RISING"),
  metric("incremental_paid_contribution", "ACQUISITION", "MONEY", 9000, 8500),
  metric("average_product_margin", "MERCHANDISING", "RATIO", 0.5, 0.49),
  metric("inventory_days_cover_min", "MERCHANDISING", "DAYS", 20, 25, "FALLING"),
  metric("inventory_at_risk_value", "MERCHANDISING", "MONEY", 0, 0),
  metric("product_momentum", "MERCHANDISING", "SCORE", 0.5, 0.5),
  metric("repeat_rate", "CUSTOMER", "RATIO", 0.22, 0.21),
  metric("retention_rate_90d", "CUSTOMER", "RATIO", 0.32, 0.31),
  metric("customer_value_90d", "CUSTOMER", "MONEY", 400, 390),
  metric("automation_coverage", "LIFECYCLE", "RATIO", 0.8, 0.75),
  metric("attribution_quality", "MEASUREMENT", "SCORE", 0.8, 0.8),
  metric("journey_coverage", "MEASUREMENT", "RATIO", 0.9, 0.9),
  metric("incrementality_measured_rate", "MEASUREMENT", "RATIO", 0.5, 0.5),
];

export interface SnapshotOptions {
  readonly signals?: readonly DerivedSignalCode[];
  readonly metricPatches?: Readonly<Record<string, Partial<MetricState>>>;
  readonly evidenceComplete?: boolean;
  readonly constraints?: readonly BusinessConstraint[];
}

export function makeSnapshot(options: SnapshotOptions = {}): BusinessStateSnapshot {
  const patches = options.metricPatches ?? {};
  const metrics = defaults.map((row) => ({ ...row, ...(patches[row.metricId] ?? {}) }));
  const signals = (options.signals ?? []).map((code) => ({
    code,
    active: true,
    confidence: "KNOWN" as const,
    evidenceMetricIds: ["cvr" as const],
    evidenceIds: ["ev_cvr"],
    explanation: code,
  }));
  return businessStateSnapshotSchema.parse({
    version: BUSINESS_STATE_VERSION,
    snapshotId: "snapshot-opportunity-test",
    merchantId: "merchant-1",
    asOf: END,
    currency: "CAD",
    timezone: "America/Toronto",
    periodStart: START,
    periodEnd: END,
    metrics,
    signals,
    constraints: options.constraints ?? [],
    measurement: {
      cogsCoverage: 1,
      journeyCoverage: 0.9,
      identityQuality: 0.9,
      providerAvailabilityScore: 1,
      freshnessSeconds: 0,
      attributionQuality: 0.8,
      incrementalityMeasuredRate: 0.5,
      sampleAdequacy: 1,
    },
    overallConfidence: "KNOWN",
    requestedDomains: ["COMMERCIAL", "PROFITABILITY", "ACQUISITION", "CUSTOMER", "MERCHANDISING", "LIFECYCLE", "MEASUREMENT"],
    collectorVersion: "test",
    evidenceComplete: options.evidenceComplete ?? true,
  });
}

export const causalCheckoutEvidence = {
  templateId: "cro.checkout_fix",
  incrementalEffect: {
    metric: "incremental_revenue",
    unit: "MONEY",
    low: 4000,
    base: 7000,
    high: 10000,
    evidenceRefs: ["experiment.checkout"],
    method: "EXPERIMENT",
  },
  addressableUpside: {
    metric: "revenue_net",
    unit: "MONEY",
    low: 8000,
    base: 12000,
    high: 18000,
    evidenceRefs: ["analysis.checkout_headroom"],
    method: "OBSERVATIONAL_BOUND",
  },
  grossMarginRate: 0.45,
  contributionMarginRate: 0.3,
  executionCost: {
    low: 200,
    base: 500,
    high: 1000,
    currency: "CAD",
    evidenceRefs: ["cost.checkout"],
  },
  timeToImpactDays: {
    low: 3,
    base: 7,
    high: 14,
    evidenceRefs: ["history.checkout"],
  },
} as const;
