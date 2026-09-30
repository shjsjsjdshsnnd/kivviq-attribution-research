import {
  businessStateSnapshotSchema,
  type BusinessStateSnapshot,
  type CanonicalMetricId,
  type DerivedStateSignal,
  type StateConfidence,
} from "./schema.js";

function metric(
  snapshot: BusinessStateSnapshot,
  metricId: CanonicalMetricId,
) {
  return snapshot.metrics.find((item) => item.metricId === metricId);
}

function evidenceIds(
  snapshot: BusinessStateSnapshot,
  metricIds: readonly CanonicalMetricId[],
): string[] {
  return metricIds.flatMap((metricId) =>
    metric(snapshot, metricId)?.evidence.map((item) => item.evidenceId) ?? [],
  );
}

function combineConfidence(
  snapshot: BusinessStateSnapshot,
  metricIds: readonly CanonicalMetricId[],
): StateConfidence {
  const rank: Record<StateConfidence, number> = {
    KNOWN: 0,
    PARTIAL: 1,
    UNCERTAIN: 2,
    UNKNOWN: 3,
  };
  let result: StateConfidence = "KNOWN";
  for (const metricId of metricIds) {
    const confidence = metric(snapshot, metricId)?.confidence ?? "UNKNOWN";
    if (rank[confidence] > rank[result]) result = confidence;
  }
  return result;
}

function signal(
  snapshot: BusinessStateSnapshot,
  code: DerivedStateSignal["code"],
  active: boolean,
  metricIds: readonly CanonicalMetricId[],
  explanation: string,
): DerivedStateSignal {
  return {
    code,
    active,
    confidence: combineConfidence(snapshot, metricIds),
    evidenceMetricIds: [...metricIds],
    evidenceIds: evidenceIds(snapshot, metricIds),
    explanation,
  };
}

function current(
  snapshot: BusinessStateSnapshot,
  metricId: CanonicalMetricId,
): number | null {
  return metric(snapshot, metricId)?.current ?? null;
}

function deltaPct(
  snapshot: BusinessStateSnapshot,
  metricId: CanonicalMetricId,
): number | null {
  return metric(snapshot, metricId)?.deltaPctVsPrevious ?? null;
}

function hasAll(
  snapshot: BusinessStateSnapshot,
  metricIds: readonly CanonicalMetricId[],
): boolean {
  return metricIds.every((metricId) => current(snapshot, metricId) !== null);
}

export function deriveStateSignals(
  snapshot: BusinessStateSnapshot,
): DerivedStateSignal[] {
  const signals: DerivedStateSignal[] = [];

  const orderDelta = deltaPct(snapshot, "orders");
  signals.push(
    signal(
      snapshot,
      "orders_flat",
      orderDelta !== null && Math.abs(orderDelta) <= 0.03,
      ["orders"],
      "Orders are within ±3% of the previous comparable period.",
    ),
  );

  const aovDelta = deltaPct(snapshot, "aov");
  signals.push(
    signal(
      snapshot,
      "AOV_rising",
      aovDelta !== null && aovDelta >= 0.05,
      ["aov"],
      "AOV is at least 5% above the previous comparable period.",
    ),
  );

  const retargetingShare = current(snapshot, "retargeting_share");
  signals.push(
    signal(
      snapshot,
      "retargeting_heavy",
      retargetingShare !== null && retargetingShare >= 0.6,
      ["retargeting_share"],
      "At least 60% of measured paid spend is classified as retargeting.",
    ),
  );

  const newCustomerDelta = deltaPct(snapshot, "new_customers");
  signals.push(
    signal(
      snapshot,
      "new_customer_growth_weak",
      newCustomerDelta !== null && newCustomerDelta <= -0.05,
      ["new_customers"],
      "Observed new customers are at least 5% below the previous comparable period.",
    ),
  );

  const daysCover = current(snapshot, "inventory_days_cover_min");
  const outOfStockRate = current(snapshot, "out_of_stock_rate");
  signals.push(
    signal(
      snapshot,
      "inventory_constrained",
      (daysCover !== null && daysCover <= 7) ||
        (outOfStockRate !== null && outOfStockRate >= 0.1),
      ["inventory_days_cover_min", "out_of_stock_rate"],
      "Material inventory has seven days of cover or less, or at least 10% of material products are out of stock.",
    ),
  );

  const measurementIds: readonly CanonicalMetricId[] = [
    "cogs_coverage",
    "journey_coverage",
    "identity_quality",
    "provider_availability_score",
    "attribution_quality",
    "sample_adequacy",
  ];
  const lowMeasurement =
    measurementIds.some((metricId) => {
      const value = current(snapshot, metricId);
      return value !== null && value < 0.7;
    }) ||
    measurementIds.some(
      (metricId) =>
        metric(snapshot, metricId)?.confidence === "UNKNOWN" ||
        metric(snapshot, metricId)?.confidence === "UNCERTAIN",
    );
  signals.push(
    signal(
      snapshot,
      "measurement_confidence_low",
      lowMeasurement,
      measurementIds,
      "One or more material measurement dimensions are weak, uncertain or unknown.",
    ),
  );

  const revenueDelta = deltaPct(snapshot, "revenue_net");
  const discountDelta = deltaPct(snapshot, "discount_rate");
  signals.push(
    signal(
      snapshot,
      "discount_driven_growth",
      revenueDelta !== null &&
        revenueDelta >= 0.1 &&
        discountDelta !== null &&
        discountDelta >= 0.1,
      ["revenue_net", "discount_rate"],
      "Revenue is up at least 10% while discount rate is also materially higher; this is descriptive and does not claim causality.",
    ),
  );

  const marginDelta = deltaPct(snapshot, "gross_margin");
  signals.push(
    signal(
      snapshot,
      "margin_compression",
      marginDelta !== null && marginDelta <= -0.05,
      ["gross_margin"],
      "Gross margin is at least 5% below the previous comparable period on a relative basis.",
    ),
  );

  const repeatRate = current(snapshot, "repeat_rate");
  const repeatDelta = deltaPct(snapshot, "repeat_rate");
  signals.push(
    signal(
      snapshot,
      "retention_weak",
      (repeatRate !== null && repeatRate < 0.2) ||
        (repeatDelta !== null && repeatDelta <= -0.1),
      ["repeat_rate", "retention_rate_90d"],
      "Repeat behavior is low or materially deteriorating.",
    ),
  );

  const paidDependency = current(snapshot, "paid_dependency");
  signals.push(
    signal(
      snapshot,
      "paid_dependency_high",
      paidDependency !== null && paidDependency >= 0.6,
      ["paid_dependency"],
      "At least 60% of store revenue is observed as paid-attributed under the governed method.",
    ),
  );

  const contributionDelta = deltaPct(snapshot, "contribution_profit");
  signals.push(
    signal(
      snapshot,
      "profit_down_revenue_up",
      revenueDelta !== null &&
        revenueDelta > 0.05 &&
        contributionDelta !== null &&
        contributionDelta < -0.05,
      ["revenue_net", "contribution_profit"],
      "Revenue is materially higher while contribution profit is materially lower.",
    ),
  );

  const roas = current(snapshot, "platform_roas");
  const incrementality = current(snapshot, "incrementality_measured_rate");
  signals.push(
    signal(
      snapshot,
      "platform_roas_high_incrementality_unmeasured",
      roas !== null &&
        roas >= 8 &&
        (incrementality === null || incrementality < 0.2),
      ["platform_roas", "incrementality_measured_rate"],
      "Platform ROAS is high while incrementality evidence is absent or sparse; no incremental-efficiency conclusion is implied.",
    ),
  );

  signals.push(
    signal(
      snapshot,
      "inventory_four_day_cover",
      daysCover !== null && daysCover <= 4,
      ["inventory_days_cover_min"],
      "At least one material product has four days of inventory cover or less.",
    ),
  );

  return signals;
}

export function withDerivedStateSignals(
  snapshot: BusinessStateSnapshot,
): BusinessStateSnapshot {
  return businessStateSnapshotSchema.parse({
    ...snapshot,
    signals: deriveStateSignals(snapshot),
  });
}
