import { investigationWhatSchema, type InvestigationWhat } from "./index.js";
const duration = {
  kind: "CALENDAR" as const,
  amount: 2,
  unit: "DAY" as const,
  anchor: "REQUESTED_START" as const,
};
function example(
  kind: string,
  targetKind: string,
  ref: string,
  fact: string,
  extra: Record<string, unknown> = {},
): InvestigationWhat {
  return investigationWhatSchema.parse({
    actionType: "investigation.inspect",
    category: { kind },
    targets: [{ kind: targetKind, ref }],
    requiredEvidence: [
      {
        evidenceId: "requested-evidence",
        reference: { kind: "FACT", ref: fact },
        targetRef: ref,
      },
    ],
    successCriteria: [
      {
        kind: "EVIDENCE_COVERAGE",
        evidenceIds: ["requested-evidence"],
        minimumCoverage: 1,
      },
    ],
    observationWindow: {
      start: "2026-08-27T00:00:00Z",
      end: "2026-09-25T00:00:00Z",
    },
    expectedDuration: duration,
    maximumInvestigationHorizon: duration,
    costs: {
      analyst: { state: "UNKNOWN" },
      engineering: { state: "UNKNOWN" },
      externalService: { state: "UNKNOWN" },
    },
    requiredResources: [],
    ...extra,
  });
}
const tracking = (
  sourceRef: string,
  eventRef: string,
  suspectedIssueClass = "UNKNOWN",
) => ({ tracking: { sourceRef, eventRef, suspectedIssueClass } });
const anomaly = (ref: string, metricRef: string, direction: string) => ({
  observedAnomaly: {
    targetRef: ref,
    metricRef,
    direction,
    observationWindow: {
      start: "2026-09-20T00:00:00Z",
      end: "2026-09-25T00:00:00Z",
    },
    comparison: {
      kind: "WINDOW",
      window: { start: "2026-09-15T00:00:00Z", end: "2026-09-20T00:00:00Z" },
    },
  },
});
export const investigationExamples = {
  missingCogs: example("MISSING_DATA_REQUEST", "SKU", "sku-a", "unit_cogs"),
  supplierLeadTime: example(
    "MISSING_DATA_REQUEST",
    "INVENTORY_FACT",
    "supplier-a",
    "supplier_lead_time",
  ),
  customerConsent: example(
    "MISSING_DATA_REQUEST",
    "POPULATION",
    "envelope-population",
    "email_consent_evidence",
  ),
  oversizedShippingCost: example(
    "MISSING_DATA_REQUEST",
    "PRODUCT",
    "oversized-products",
    "shipping_cost",
  ),
  metaTracking: example(
    "TRACKING_AUDIT",
    "TRACKING_IMPLEMENTATION",
    "meta-pixel",
    "purchase_event_trace",
    tracking("meta", "purchase"),
  ),
  ga4Duplicates: example(
    "TRACKING_AUDIT",
    "DATA_SOURCE",
    "ga4",
    "purchase_event_trace",
    tracking("ga4", "purchase", "DUPLICATION"),
  ),
  pinterestMapping: example(
    "MEASUREMENT_VALIDATION",
    "CHANNEL",
    "pinterest",
    "attribution_event_mapping",
    tracking("pinterest", "purchase", "ATTRIBUTION_MAPPING"),
  ),
  lifecycleTracking: example(
    "TRACKING_AUDIT",
    "CHANNEL",
    "email",
    "conversion_event_trace",
    tracking("lifecycle", "conversion"),
  ),
  checkoutDecline: example(
    "ANOMALY_DIAGNOSIS",
    "FUNNEL_STAGE",
    "checkout",
    "funnel_diagnostics",
    anomaly("checkout", "checkout_conversion_rate", "DECREASE"),
  ),
  aovIncrease: example(
    "ANOMALY_DIAGNOSIS",
    "METRIC",
    "average-order-value",
    "order_value_breakdown",
    anomaly("average-order-value", "aov", "INCREASE"),
  ),
  inventoryDiscrepancy: example(
    "ANOMALY_DIAGNOSIS",
    "INVENTORY_FACT",
    "sku-a-stock",
    "inventory_ledger",
    anomaly("sku-a-stock", "inventory_count", "DISCREPANCY"),
  ),
  channelRevenueSpike: example(
    "ANOMALY_DIAGNOSIS",
    "CHANNEL",
    "pinterest",
    "attribution_trace",
    anomaly("pinterest", "channel_revenue", "INCREASE"),
  ),
  revenueReconciliation: example(
    "METRIC_RECONCILIATION",
    "DATA_SOURCE",
    "shopify",
    "payment_reconciliation",
  ),
};
export const noOpExamples = {
  global: { actionType: "no_op.do_nothing", scope: { kind: "GLOBAL" } },
  paidMedia: {
    actionType: "no_op.do_nothing",
    scope: { kind: "FAMILY", family: "PAID_MEDIA" },
  },
  skuPricing: {
    actionType: "no_op.do_nothing",
    scope: { kind: "SKU", ref: "sku-a", family: "PRICING" },
  },
  populationLifecycle: {
    actionType: "no_op.do_nothing",
    scope: { kind: "POPULATION", family: "LIFECYCLE" },
  },
  googleShopping: {
    actionType: "no_op.do_nothing",
    scope: { kind: "CHANNEL", ref: "google-shopping" },
  },
} as const;
