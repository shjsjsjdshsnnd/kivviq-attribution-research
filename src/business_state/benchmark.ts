import {
  BUSINESS_STATE_VERSION,
  businessStateSnapshotSchema,
  type BusinessStateSnapshot,
  type CanonicalMetricId,
  type DerivedSignalCode,
  type MetricState,
  type StateConfidence,
} from "./schema.js";
import { metricRegistry } from "./metric-registry.js";
import { withDerivedStateSignals } from "./signals.js";

export interface SyntheticBusinessStateCase {
  readonly scenarioId: string;
  readonly description: string;
  readonly trap:
    | "CONTROL"
    | "GROWTH"
    | "STAGNATION"
    | "MARGIN_COMPRESSION"
    | "RETARGETING_DEPENDENCE"
    | "INVENTORY_SHORTAGE"
    | "DISCOUNT_DRIVEN_GROWTH"
    | "RETENTION_PROBLEM"
    | "MEASUREMENT_FAILURE"
    | "REVENUE_UP_PROFIT_DOWN"
    | "HIGH_ROAS_DEMAND_CAPTURE"
    | "SIMPSONS_CVR"
    | "SCALABLE_CAMPAIGN_LOW_INVENTORY";
  readonly snapshot: BusinessStateSnapshot;
  readonly expectedActiveSignals: readonly DerivedSignalCode[];
  readonly decisionHazard: string;
}

type ValuePair = {
  readonly current: number;
  readonly previous: number;
};

const BASE: Readonly<Record<CanonicalMetricId, ValuePair>> = {
  revenue_net: { current: 100_000, previous: 95_000 },
  online_revenue: { current: 70_000, previous: 66_000 },
  pos_revenue: { current: 30_000, previous: 29_000 },
  orders: { current: 200, previous: 190 },
  aov: { current: 500, previous: 500 },
  discount_rate: { current: 0.1, previous: 0.1 },
  return_rate: { current: 0.05, previous: 0.05 },
  returns_cost: { current: 2_000, previous: 1_900 },
  cogs: { current: 55_000, previous: 52_250 },
  gross_profit: { current: 45_000, previous: 42_750 },
  gross_margin: { current: 0.45, previous: 0.45 },
  shipping_fulfillment_cost: { current: 5_000, previous: 4_750 },
  payment_fees: { current: 3_000, previous: 2_850 },
  paid_spend: { current: 10_000, previous: 9_500 },
  contribution_profit: { current: 25_000, previous: 23_750 },
  contribution_margin: { current: 0.25, previous: 0.25 },
  sessions: { current: 20_000, previous: 19_000 },
  cvr: { current: 0.01, previous: 0.01 },
  new_customers: { current: 120, previous: 115 },
  returning_orders: { current: 80, previous: 75 },
  repeat_rate: { current: 0.4, previous: 0.395 },
  cac: { current: 83.3333, previous: 82.6087 },
  paid_attributed_revenue: { current: 50_000, previous: 48_000 },
  paid_dependency: { current: 0.5, previous: 0.505 },
  prospecting_share: { current: 0.55, previous: 0.55 },
  retargeting_share: { current: 0.45, previous: 0.45 },
  platform_roas: { current: 5, previous: 5 },
  incremental_paid_contribution: { current: 5_000, previous: 4_500 },
  acquisition_concentration: { current: 0.4, previous: 0.4 },
  purchase_frequency: { current: 1.35, previous: 1.32 },
  customer_value_90d: { current: 720, previous: 700 },
  retention_rate_90d: { current: 0.35, previous: 0.34 },
  product_revenue_concentration: { current: 0.3, previous: 0.3 },
  product_gross_profit_concentration: { current: 0.28, previous: 0.28 },
  average_product_margin: { current: 0.45, previous: 0.45 },
  discounted_revenue_share: { current: 0.25, previous: 0.25 },
  inventory_days_cover_min: { current: 28, previous: 30 },
  out_of_stock_rate: { current: 0.02, previous: 0.02 },
  inventory_at_risk_value: { current: 2_000, previous: 2_000 },
  product_momentum: { current: 0.1, previous: 0.08 },
  email_list_size: { current: 15_000, previous: 14_500 },
  sms_list_size: { current: 4_000, previous: 3_900 },
  email_list_growth: { current: 500, previous: 450 },
  campaign_revenue: { current: 8_000, previous: 7_500 },
  automation_revenue: { current: 12_000, previous: 11_500 },
  lifecycle_revenue: { current: 20_000, previous: 19_000 },
  lifecycle_revenue_share: { current: 0.2, previous: 0.2 },
  automation_coverage: { current: 0.8, previous: 0.8 },
  cogs_coverage: { current: 0.99, previous: 0.99 },
  journey_coverage: { current: 0.9, previous: 0.9 },
  identity_quality: { current: 0.9, previous: 0.9 },
  provider_availability_score: { current: 1, previous: 1 },
  data_freshness_seconds: { current: 900, previous: 900 },
  attribution_quality: { current: 0.85, previous: 0.85 },
  incrementality_measured_rate: { current: 0.6, previous: 0.55 },
  sample_adequacy: { current: 0.95, previous: 0.95 },
};

function metricState(
  metricId: CanonicalMetricId,
  values: ValuePair,
  confidence: StateConfidence = "KNOWN",
): MetricState {
  const definition = metricRegistry[metricId];
  const delta =
    values.previous === 0
      ? null
      : (values.current - values.previous) / Math.abs(values.previous);
  const threshold = definition.materialityThresholdPct ?? 0.03;
  return {
    metricId,
    domain: definition.domain,
    unit: definition.unit,
    current: values.current,
    previous: values.previous,
    yoy: null,
    seasonalBaseline: null,
    deltaVsPrevious: values.current - values.previous,
    deltaPctVsPrevious: delta,
    deltaPctVsYoy: null,
    trend:
      delta === null
        ? "UNKNOWN"
        : delta > threshold
          ? "RISING"
          : delta < -threshold
            ? "FALLING"
            : "FLAT",
    confidence,
    evidence: [],
    unknownReasons: confidence === "KNOWN" ? [] : ["SYNTHETIC_CONFIDENCE_CASE"],
  };
}

function buildSnapshot(
  scenarioId: string,
  overrides: Partial<Record<CanonicalMetricId, Partial<ValuePair>>>,
  confidenceOverrides: Partial<Record<CanonicalMetricId, StateConfidence>> = {},
): BusinessStateSnapshot {
  const metrics = (Object.keys(BASE) as CanonicalMetricId[]).map((metricId) => {
    const base = BASE[metricId];
    const override = overrides[metricId] ?? {};
    return metricState(
      metricId,
      {
        current: override.current ?? base.current,
        previous: override.previous ?? base.previous,
      },
      confidenceOverrides[metricId] ?? "KNOWN",
    );
  });

  const map = new Map(metrics.map((item) => [item.metricId, item]));
  const m = (id: CanonicalMetricId): number | null =>
    map.get(id)?.current ?? null;
  const snapshot = businessStateSnapshotSchema.parse({
    version: BUSINESS_STATE_VERSION,
    snapshotId: "synthetic:" + scenarioId + ":2026-09-30",
    merchantId: "synthetic-merchant",
    asOf: "2026-09-30T20:00:00.000Z",
    currency: "CAD",
    timezone: "America/Toronto",
    periodStart: "2026-09-01T04:00:00.000Z",
    periodEnd: "2026-10-01T04:00:00.000Z",
    metrics,
    signals: [],
    constraints: [],
    measurement: {
      cogsCoverage: m("cogs_coverage"),
      journeyCoverage: m("journey_coverage"),
      identityQuality: m("identity_quality"),
      providerAvailabilityScore: m("provider_availability_score"),
      freshnessSeconds: m("data_freshness_seconds"),
      attributionQuality: m("attribution_quality"),
      incrementalityMeasuredRate: m("incrementality_measured_rate"),
      sampleAdequacy: m("sample_adequacy"),
    },
    overallConfidence:
      Object.values(confidenceOverrides).some(
        (confidence) => confidence === "UNKNOWN",
      )
        ? "UNKNOWN"
        : Object.values(confidenceOverrides).some(
              (confidence) => confidence === "UNCERTAIN",
            )
          ? "UNCERTAIN"
          : Object.values(confidenceOverrides).some(
                (confidence) => confidence === "PARTIAL",
              )
            ? "PARTIAL"
            : "KNOWN",
    requestedDomains: [
      "COMMERCIAL",
      "PROFITABILITY",
      "ACQUISITION",
      "CUSTOMER",
      "MERCHANDISING",
      "LIFECYCLE",
      "MEASUREMENT",
    ],
    collectorVersion: "synthetic-business-state/1.0.0",
    evidenceComplete: true,
  });
  return withDerivedStateSignals(snapshot);
}

function caseOf(
  scenarioId: string,
  trap: SyntheticBusinessStateCase["trap"],
  description: string,
  overrides: Partial<Record<CanonicalMetricId, Partial<ValuePair>>>,
  expectedActiveSignals: readonly DerivedSignalCode[],
  decisionHazard: string,
  confidenceOverrides: Partial<Record<CanonicalMetricId, StateConfidence>> = {},
): SyntheticBusinessStateCase {
  return {
    scenarioId,
    trap,
    description,
    snapshot: buildSnapshot(scenarioId, overrides, confidenceOverrides),
    expectedActiveSignals,
    decisionHazard,
  };
}

export function syntheticBusinessStateBenchmark(): readonly SyntheticBusinessStateCase[] {
  return [
    caseOf(
      "state-growth",
      "GROWTH",
      "Broad revenue and order growth without material margin or measurement deterioration.",
      {
        revenue_net: { current: 120_000, previous: 100_000 },
        orders: { current: 230, previous: 200 },
        new_customers: { current: 140, previous: 120 },
      },
      [],
      "Do not mistake healthy growth for proof that every channel is incremental.",
    ),
    caseOf(
      "state-stagnation",
      "STAGNATION",
      "Revenue and orders are essentially flat.",
      {
        revenue_net: { current: 100_500, previous: 100_000 },
        orders: { current: 200, previous: 200 },
      },
      ["orders_flat"],
      "Avoid fabricating a growth narrative when core volume is flat.",
    ),
    caseOf(
      "state-margin-compression",
      "MARGIN_COMPRESSION",
      "Revenue rises while gross margin deteriorates materially.",
      {
        revenue_net: { current: 110_000, previous: 100_000 },
        gross_margin: { current: 0.35, previous: 0.45 },
        gross_profit: { current: 38_500, previous: 45_000 },
      },
      ["margin_compression"],
      "Do not optimize revenue while ignoring deteriorating margin.",
    ),
    caseOf(
      "state-retargeting-dependence",
      "RETARGETING_DEPENDENCE",
      "Paid mix is dominated by retargeting and paid-attributed revenue is concentrated.",
      {
        retargeting_share: { current: 0.82, previous: 0.48 },
        prospecting_share: { current: 0.18, previous: 0.52 },
        paid_dependency: { current: 0.72, previous: 0.5 },
      },
      ["retargeting_heavy", "paid_dependency_high"],
      "High observed ROAS from retargeting must not be treated as acquisition incrementality.",
    ),
    caseOf(
      "state-inventory-shortage",
      "INVENTORY_SHORTAGE",
      "Material products have little remaining stock cover and elevated stockouts.",
      {
        inventory_days_cover_min: { current: 4, previous: 18 },
        out_of_stock_rate: { current: 0.14, previous: 0.03 },
      },
      ["inventory_constrained", "inventory_four_day_cover"],
      "Do not recommend scaling demand without respecting sellable stock.",
    ),
    caseOf(
      "state-discount-growth",
      "DISCOUNT_DRIVEN_GROWTH",
      "Revenue rises alongside much deeper discounting and lower contribution.",
      {
        revenue_net: { current: 131_000, previous: 100_000 },
        discount_rate: { current: 0.2, previous: 0.1 },
        contribution_profit: { current: 23_000, previous: 25_000 },
      },
      ["discount_driven_growth"],
      "Do not equate revenue growth with profitable growth.",
    ),
    caseOf(
      "state-retention-problem",
      "RETENTION_PROBLEM",
      "Repeat behavior and mature retention are weak.",
      {
        repeat_rate: { current: 0.15, previous: 0.26 },
        retention_rate_90d: { current: 0.14, previous: 0.28 },
      },
      ["retention_weak"],
      "Do not focus only on top-of-funnel acquisition when repeat behavior is deteriorating.",
    ),
    caseOf(
      "state-measurement-failure",
      "MEASUREMENT_FAILURE",
      "Coverage, identity, attribution and sample quality are all insufficient.",
      {
        cogs_coverage: { current: 0.55, previous: 0.98 },
        journey_coverage: { current: 0.42, previous: 0.88 },
        identity_quality: { current: 0.5, previous: 0.9 },
        provider_availability_score: { current: 0.6, previous: 1 },
        attribution_quality: { current: 0.45, previous: 0.85 },
        sample_adequacy: { current: 0.5, previous: 0.95 },
      },
      ["measurement_confidence_low"],
      "Abstain from decisions whose required evidence cannot be established.",
      {
        cogs_coverage: "PARTIAL",
        journey_coverage: "PARTIAL",
        identity_quality: "PARTIAL",
        provider_availability_score: "PARTIAL",
        attribution_quality: "PARTIAL",
        sample_adequacy: "PARTIAL",
      },
    ),
    caseOf(
      "adv-revenue-up-profit-down",
      "REVENUE_UP_PROFIT_DOWN",
      "Adversarial state: revenue +30% while contribution profit falls 10%.",
      {
        revenue_net: { current: 130_000, previous: 100_000 },
        contribution_profit: { current: 22_500, previous: 25_000 },
      },
      ["profit_down_revenue_up"],
      "A revenue-maximizing rule should fail this case.",
    ),
    caseOf(
      "adv-high-roas-demand-capture",
      "HIGH_ROAS_DEMAND_CAPTURE",
      "Adversarial state: 12x platform ROAS with no measured incrementality.",
      {
        platform_roas: { current: 12, previous: 10 },
        incrementality_measured_rate: { current: 0, previous: 0 },
        retargeting_share: { current: 0.78, previous: 0.7 },
      },
      [
        "retargeting_heavy",
        "platform_roas_high_incrementality_unmeasured",
      ],
      "Do not infer scalable incremental return from platform ROAS.",
    ),
    caseOf(
      "adv-simpsons-cvr",
      "SIMPSONS_CVR",
      "Adversarial state: aggregate CVR falls; segment composition must be inspected before intervention.",
      {
        cvr: { current: 0.018, previous: 0.021 },
        sessions: { current: 25_000, previous: 20_000 },
        orders: { current: 450, previous: 420 },
      },
      [],
      "Aggregate CVR alone is insufficient to conclude that underlying segments deteriorated.",
    ),
    caseOf(
      "adv-scale-with-four-days-stock",
      "SCALABLE_CAMPAIGN_LOW_INVENTORY",
      "Adversarial state: a strong-looking paid campaign has four days of stock remaining.",
      {
        platform_roas: { current: 8.5, previous: 7.8 },
        inventory_days_cover_min: { current: 4, previous: 21 },
        out_of_stock_rate: { current: 0.08, previous: 0.01 },
      },
      ["inventory_constrained", "inventory_four_day_cover"],
      "Scaling demand is incompatible with the known inventory constraint.",
    ),
  ];
}
