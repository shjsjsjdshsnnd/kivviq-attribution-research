import { z } from "zod";

export const BUSINESS_STATE_VERSION = "business-state/1.0.0" as const;

export const stateDomainSchema = z.enum([
  "COMMERCIAL",
  "PROFITABILITY",
  "ACQUISITION",
  "CUSTOMER",
  "MERCHANDISING",
  "LIFECYCLE",
  "MEASUREMENT",
]);
export type StateDomain = z.infer<typeof stateDomainSchema>;

export const stateConfidenceSchema = z.enum([
  "KNOWN",
  "PARTIAL",
  "UNCERTAIN",
  "UNKNOWN",
]);
export type StateConfidence = z.infer<typeof stateConfidenceSchema>;

export const metricTrendSchema = z.enum([
  "RISING",
  "FALLING",
  "FLAT",
  "MIXED",
  "UNKNOWN",
]);
export type MetricTrend = z.infer<typeof metricTrendSchema>;

export const authoritativeSourceSchema = z.enum([
  "SHOPIFY",
  "GA4",
  "GOOGLE_ADS",
  "META_ADS",
  "PINTEREST_ADS",
  "OMNISEND",
  "KLAVIYO",
  "FIRST_PARTY",
  "MERCHANT_CONFIG",
  "DERIVED",
]);
export type AuthoritativeSource = z.infer<typeof authoritativeSourceSchema>;

export const metricUnitSchema = z.enum([
  "MONEY",
  "COUNT",
  "RATIO",
  "PERCENTAGE",
  "SECONDS",
  "DAYS",
  "SCORE",
]);
export type MetricUnit = z.infer<typeof metricUnitSchema>;

export const canonicalMetricIdSchema = z.enum([
  "revenue_net",
  "online_revenue",
  "pos_revenue",
  "orders",
  "aov",
  "discount_rate",
  "return_rate",
  "returns_cost",
  "cogs",
  "gross_profit",
  "gross_margin",
  "shipping_fulfillment_cost",
  "payment_fees",
  "paid_spend",
  "contribution_profit",
  "contribution_margin",
  "sessions",
  "cvr",
  "new_customers",
  "returning_orders",
  "repeat_rate",
  "cac",
  "paid_attributed_revenue",
  "paid_dependency",
  "prospecting_share",
  "retargeting_share",
  "platform_roas",
  "incremental_paid_contribution",
  "acquisition_concentration",
  "purchase_frequency",
  "customer_value_90d",
  "retention_rate_90d",
  "product_revenue_concentration",
  "product_gross_profit_concentration",
  "average_product_margin",
  "discounted_revenue_share",
  "inventory_days_cover_min",
  "out_of_stock_rate",
  "inventory_at_risk_value",
  "product_momentum",
  "email_list_size",
  "sms_list_size",
  "email_list_growth",
  "campaign_revenue",
  "automation_revenue",
  "lifecycle_revenue",
  "lifecycle_revenue_share",
  "automation_coverage",
  "cogs_coverage",
  "journey_coverage",
  "identity_quality",
  "provider_availability_score",
  "data_freshness_seconds",
  "attribution_quality",
  "incrementality_measured_rate",
  "sample_adequacy",
]);
export type CanonicalMetricId = z.infer<typeof canonicalMetricIdSchema>;

export const periodKindSchema = z.enum([
  "CURRENT",
  "PREVIOUS",
  "YOY",
  "SEASONAL_BASELINE",
]);
export type PeriodKind = z.infer<typeof periodKindSchema>;

export const evidenceRefSchema = z
  .object({
    evidenceId: z.string().min(1),
    metricId: canonicalMetricIdSchema,
    source: authoritativeSourceSchema,
    periodKind: periodKindSchema,
    observedAt: z.string().datetime(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    value: z.number().finite(),
    sampleSize: z.number().int().nonnegative().optional(),
    coverage: z.number().min(0).max(1).optional(),
    freshnessSeconds: z.number().nonnegative().finite().optional(),
    provenance: z.string().min(1).optional(),
  })
  .strict();
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const metricStateSchema = z
  .object({
    metricId: canonicalMetricIdSchema,
    domain: stateDomainSchema,
    unit: metricUnitSchema,
    current: z.number().finite().nullable(),
    previous: z.number().finite().nullable().optional(),
    yoy: z.number().finite().nullable().optional(),
    seasonalBaseline: z.number().finite().nullable().optional(),
    deltaVsPrevious: z.number().finite().nullable().optional(),
    deltaPctVsPrevious: z.number().finite().nullable().optional(),
    deltaPctVsYoy: z.number().finite().nullable().optional(),
    trend: metricTrendSchema,
    confidence: stateConfidenceSchema,
    evidence: z.array(evidenceRefSchema),
    unknownReasons: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((metric, ctx) => {
    if (metric.confidence === "KNOWN" && metric.current === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["current"],
        message: "KNOWN metric must have a current value",
      });
    }
    for (const evidence of metric.evidence) {
      if (evidence.metricId !== metric.metricId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidence"],
          message: "Evidence metricId must match MetricState metricId",
        });
      }
    }
  });
export type MetricState = z.infer<typeof metricStateSchema>;

export const constraintKindSchema = z.enum([
  "BUDGET_LIMIT",
  "INVENTORY_LIMIT",
  "MARGIN_FLOOR",
  "MEASUREMENT_MINIMUM",
  "SAMPLE_MINIMUM",
  "CHANNEL_SATURATION",
  "MERCHANT_POLICY",
  "OPERATIONAL_CAPACITY",
]);
export type ConstraintKind = z.infer<typeof constraintKindSchema>;

export const constraintStatusSchema = z.enum([
  "SATISFIED",
  "VIOLATED",
  "UNKNOWN",
]);
export type ConstraintStatus = z.infer<typeof constraintStatusSchema>;

export const businessConstraintSchema = z
  .object({
    constraintId: z.string().min(1),
    kind: constraintKindSchema,
    status: constraintStatusSchema,
    metricId: canonicalMetricIdSchema.optional(),
    comparator: z.enum(["LTE", "GTE", "EQ"]).optional(),
    threshold: z.number().finite().optional(),
    observedValue: z.number().finite().nullable().optional(),
    unit: metricUnitSchema.optional(),
    evidenceMetricIds: z.array(canonicalMetricIdSchema),
    reason: z.string().min(1),
  })
  .strict();
export type BusinessConstraint = z.infer<typeof businessConstraintSchema>;

export const derivedSignalCodeSchema = z.enum([
  "orders_flat",
  "AOV_rising",
  "retargeting_heavy",
  "new_customer_growth_weak",
  "inventory_constrained",
  "measurement_confidence_low",
  "discount_driven_growth",
  "margin_compression",
  "retention_weak",
  "paid_dependency_high",
  "profit_down_revenue_up",
  "platform_roas_high_incrementality_unmeasured",
  "inventory_four_day_cover",
]);
export type DerivedSignalCode = z.infer<typeof derivedSignalCodeSchema>;

export const derivedStateSignalSchema = z
  .object({
    code: derivedSignalCodeSchema,
    active: z.boolean(),
    confidence: stateConfidenceSchema,
    evidenceMetricIds: z.array(canonicalMetricIdSchema).min(1),
    evidenceIds: z.array(z.string().min(1)),
    explanation: z.string().min(1),
  })
  .strict();
export type DerivedStateSignal = z.infer<typeof derivedStateSignalSchema>;

export const measurementCoverageSchema = z
  .object({
    cogsCoverage: z.number().min(0).max(1).nullable(),
    journeyCoverage: z.number().min(0).max(1).nullable(),
    identityQuality: z.number().min(0).max(1).nullable(),
    providerAvailabilityScore: z.number().min(0).max(1).nullable(),
    freshnessSeconds: z.number().nonnegative().finite().nullable(),
    attributionQuality: z.number().min(0).max(1).nullable(),
    incrementalityMeasuredRate: z.number().min(0).max(1).nullable(),
    sampleAdequacy: z.number().min(0).max(1).nullable(),
  })
  .strict();
export type MeasurementCoverage = z.infer<typeof measurementCoverageSchema>;

export const businessStateSnapshotSchema = z
  .object({
    version: z.literal(BUSINESS_STATE_VERSION),
    snapshotId: z.string().min(1),
    merchantId: z.string().min(1),
    asOf: z.string().datetime(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    metrics: z.array(metricStateSchema),
    signals: z.array(derivedStateSignalSchema),
    constraints: z.array(businessConstraintSchema),
    measurement: measurementCoverageSchema,
    overallConfidence: stateConfidenceSchema,
    requestedDomains: z.array(stateDomainSchema).min(1),
    collectorVersion: z.string().min(1),
    evidenceComplete: z.boolean(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (Date.parse(snapshot.periodStart) >= Date.parse(snapshot.periodEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "periodEnd must be after periodStart",
      });
    }

    const ids = new Set<string>();
    snapshot.metrics.forEach((metric, index) => {
      if (ids.has(metric.metricId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metrics", index, "metricId"],
          message: "Metric IDs must be unique in a snapshot",
        });
      }
      ids.add(metric.metricId);
    });
  });
export type BusinessStateSnapshot = z.infer<typeof businessStateSnapshotSchema>;

export interface EvidenceRequest {
  readonly merchantId: string;
  readonly metricId: CanonicalMetricId;
  readonly sourceCandidates: readonly AuthoritativeSource[];
  readonly periodKind: PeriodKind;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOf: string;
  readonly currency: string;
  readonly timezone: string;
}

export interface BusinessStateEvidenceProvider {
  getEvidence(request: EvidenceRequest): Promise<EvidenceRef | null>;
}

export interface CollectionPeriods {
  readonly current: { readonly start: string; readonly end: string };
  readonly previous?: { readonly start: string; readonly end: string };
  readonly yoy?: { readonly start: string; readonly end: string };
  readonly seasonalBaseline?: { readonly start: string; readonly end: string };
}

export interface BusinessStateCollectionRequest {
  readonly merchantId: string;
  readonly asOf: string;
  readonly currency: string;
  readonly timezone: string;
  readonly periods: CollectionPeriods;
  readonly domains?: readonly StateDomain[];
  readonly includeOptionalMetrics?: boolean;
}

export function metricById(
  snapshot: BusinessStateSnapshot,
  metricId: CanonicalMetricId,
): MetricState | undefined {
  return snapshot.metrics.find((metric) => metric.metricId === metricId);
}

export function signalByCode(
  snapshot: BusinessStateSnapshot,
  code: DerivedSignalCode,
): DerivedStateSignal | undefined {
  return snapshot.signals.find((signal) => signal.code === code);
}
