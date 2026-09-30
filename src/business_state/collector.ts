import {
  BUSINESS_STATE_VERSION,
  businessStateSnapshotSchema,
  businessStateDetailsSchema,
  evidenceRefSchema,
  type BusinessStateCollectionRequest,
  type BusinessStateEvidenceProvider,
  type BusinessStateSnapshot,
  type CanonicalMetricId,
  type EvidenceRef,
  type MetricState,
  type PeriodKind,
  type StateConfidence,
  type StateDomain,
} from "./schema.js";
import {
  isAuthoritativeEvidenceSource,
  metricRegistry,
  metricsForDomains,
  requiredMetricClosure,
} from "./metric-registry.js";

export const BUSINESS_STATE_COLLECTOR_VERSION =
  "business-state-collector/1.0.0" as const;

const ALL_DOMAINS: readonly StateDomain[] = [
  "COMMERCIAL",
  "PROFITABILITY",
  "ACQUISITION",
  "CUSTOMER",
  "MERCHANDISING",
  "LIFECYCLE",
  "MEASUREMENT",
];

interface PeriodSpec {
  readonly kind: PeriodKind;
  readonly start: string;
  readonly end: string;
}

function periodSpecs(
  request: BusinessStateCollectionRequest,
): readonly PeriodSpec[] {
  const periods: PeriodSpec[] = [
    {
      kind: "CURRENT",
      start: request.periods.current.start,
      end: request.periods.current.end,
    },
  ];
  if (request.periods.previous !== undefined) {
    periods.push({
      kind: "PREVIOUS",
      start: request.periods.previous.start,
      end: request.periods.previous.end,
    });
  }
  if (request.periods.yoy !== undefined) {
    periods.push({
      kind: "YOY",
      start: request.periods.yoy.start,
      end: request.periods.yoy.end,
    });
  }
  if (request.periods.seasonalBaseline !== undefined) {
    periods.push({
      kind: "SEASONAL_BASELINE",
      start: request.periods.seasonalBaseline.start,
      end: request.periods.seasonalBaseline.end,
    });
  }
  return periods;
}

function confidenceRank(confidence: StateConfidence): number {
  switch (confidence) {
    case "KNOWN":
      return 0;
    case "PARTIAL":
      return 1;
    case "UNCERTAIN":
      return 2;
    case "UNKNOWN":
      return 3;
  }
}

function worstConfidence(
  confidences: readonly StateConfidence[],
): StateConfidence {
  if (confidences.length === 0) return "UNKNOWN";
  return confidences.reduce<StateConfidence>((worst, current) =>
    confidenceRank(current) > confidenceRank(worst) ? current : worst,
  "KNOWN");
}

function confidenceForEvidence(
  metricId: CanonicalMetricId,
  evidence: EvidenceRef | undefined,
): { confidence: StateConfidence; reasons: string[] } {
  if (evidence === undefined) {
    return {
      confidence: "UNKNOWN",
      reasons: ["MISSING_CURRENT_EVIDENCE"],
    };
  }

  const definition = metricRegistry[metricId];
  const reasons: string[] = [];
  let confidence: StateConfidence = "KNOWN";

  if (
    definition.minimumCoverage !== undefined &&
    (evidence.coverage === undefined ||
      evidence.coverage < definition.minimumCoverage)
  ) {
    reasons.push("INSUFFICIENT_COVERAGE");
    confidence = "PARTIAL";
  } else if (evidence.coverage !== undefined && evidence.coverage < 1) {
    reasons.push("PARTIAL_COVERAGE");
    confidence = "PARTIAL";
  }

  if (
    definition.minimumSampleSize !== undefined &&
    (evidence.sampleSize === undefined ||
      evidence.sampleSize < definition.minimumSampleSize)
  ) {
    reasons.push("INSUFFICIENT_SAMPLE");
    confidence =
      confidenceRank(confidence) >= confidenceRank("UNCERTAIN")
        ? confidence
        : "UNCERTAIN";
  }

  if (
    evidence.freshnessSeconds !== undefined &&
    evidence.freshnessSeconds > 48 * 60 * 60
  ) {
    reasons.push("STALE_EVIDENCE");
    confidence =
      confidenceRank(confidence) >= confidenceRank("PARTIAL")
        ? confidence
        : "PARTIAL";
  }

  return { confidence, reasons };
}

function valueForKind(
  evidence: ReadonlyMap<PeriodKind, EvidenceRef>,
  kind: PeriodKind,
): number | null {
  return evidence.get(kind)?.value ?? null;
}

function pctChange(
  current: number | null,
  baseline: number | null,
): number | null {
  if (current === null || baseline === null || baseline === 0) return null;
  return (current - baseline) / Math.abs(baseline);
}

function computeTrend(
  metricId: CanonicalMetricId,
  current: number | null,
  previous: number | null,
  yoy: number | null,
): MetricState["trend"] {
  if (current === null) return "UNKNOWN";
  const definition = metricRegistry[metricId];
  const threshold = definition.materialityThresholdPct ?? 0.03;
  const previousChange = pctChange(current, previous);
  const yoyChange = pctChange(current, yoy);

  const classify = (change: number | null): "RISING" | "FALLING" | "FLAT" | null => {
    if (change === null) return null;
    if (change > threshold) return "RISING";
    if (change < -threshold) return "FALLING";
    return "FLAT";
  };

  const a = classify(previousChange);
  const b = classify(yoyChange);
  if (a !== null && b !== null && a !== b && a !== "FLAT" && b !== "FLAT") {
    return "MIXED";
  }
  return a ?? b ?? "UNKNOWN";
}

function directMetricState(
  metricId: CanonicalMetricId,
  evidence: ReadonlyMap<PeriodKind, EvidenceRef>,
  extraReasons: readonly string[],
): MetricState {
  const definition = metricRegistry[metricId];
  const currentEvidence = evidence.get("CURRENT");
  const current = currentEvidence?.value ?? null;
  const previous = valueForKind(evidence, "PREVIOUS");
  const yoy = valueForKind(evidence, "YOY");
  const seasonalBaseline = valueForKind(evidence, "SEASONAL_BASELINE");
  const confidenceResult = confidenceForEvidence(metricId, currentEvidence);
  const confidence =
    extraReasons.length > 0 && confidenceResult.confidence === "KNOWN"
      ? "UNKNOWN"
      : confidenceResult.confidence;

  return {
    metricId,
    domain: definition.domain,
    unit: definition.unit,
    current,
    previous,
    yoy,
    seasonalBaseline,
    deltaVsPrevious:
      current === null || previous === null ? null : current - previous,
    deltaPctVsPrevious: pctChange(current, previous),
    deltaPctVsYoy: pctChange(current, yoy),
    trend: computeTrend(metricId, current, previous, yoy),
    confidence,
    evidence: [...evidence.values()],
    unknownReasons: [...confidenceResult.reasons, ...extraReasons],
  };
}

function safeDivide(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function derivedValue(
  metricId: CanonicalMetricId,
  get: (id: CanonicalMetricId) => number | null,
): number | null {
  switch (metricId) {
    case "aov":
      return safeDivide(get("revenue_net"), get("orders"));
    case "gross_profit": {
      const revenue = get("revenue_net");
      const cogs = get("cogs");
      return revenue === null || cogs === null ? null : revenue - cogs;
    }
    case "gross_margin":
      return safeDivide(get("gross_profit"), get("revenue_net"));
    case "contribution_profit": {
      const values = [
        get("gross_profit"),
        get("paid_spend"),
        get("shipping_fulfillment_cost"),
        get("payment_fees"),
        get("returns_cost"),
      ] as const;
      if (values.some((value) => value === null)) return null;
      return (
        (values[0] as number) -
        (values[1] as number) -
        (values[2] as number) -
        (values[3] as number) -
        (values[4] as number)
      );
    }
    case "contribution_margin":
      return safeDivide(get("contribution_profit"), get("revenue_net"));
    case "cvr":
      return safeDivide(get("orders"), get("sessions"));
    case "repeat_rate":
      return safeDivide(get("returning_orders"), get("orders"));
    case "cac":
      return safeDivide(get("paid_spend"), get("new_customers"));
    case "paid_dependency":
      return safeDivide(get("paid_attributed_revenue"), get("revenue_net"));
    case "lifecycle_revenue": {
      const campaign = get("campaign_revenue");
      const automation = get("automation_revenue");
      return campaign === null || automation === null
        ? null
        : campaign + automation;
    }
    case "lifecycle_revenue_share":
      return safeDivide(get("lifecycle_revenue"), get("revenue_net"));
    default:
      return null;
  }
}

function periodValue(
  state: MetricState | undefined,
  kind: PeriodKind,
): number | null {
  if (state === undefined) return null;
  switch (kind) {
    case "CURRENT":
      return state.current;
    case "PREVIOUS":
      return state.previous ?? null;
    case "YOY":
      return state.yoy ?? null;
    case "SEASONAL_BASELINE":
      return state.seasonalBaseline ?? null;
  }
}

function periodForKind(
  request: BusinessStateCollectionRequest,
  kind: PeriodKind,
): { start: string; end: string } | undefined {
  switch (kind) {
    case "CURRENT":
      return request.periods.current;
    case "PREVIOUS":
      return request.periods.previous;
    case "YOY":
      return request.periods.yoy;
    case "SEASONAL_BASELINE":
      return request.periods.seasonalBaseline;
  }
}

function derivedMetricState(
  metricId: CanonicalMetricId,
  states: ReadonlyMap<CanonicalMetricId, MetricState>,
  request: BusinessStateCollectionRequest,
): MetricState {
  const definition = metricRegistry[metricId];
  const dependencies = definition.derivedFrom ?? [];
  const values = new Map<PeriodKind, number | null>();

  for (const kind of [
    "CURRENT",
    "PREVIOUS",
    "YOY",
    "SEASONAL_BASELINE",
  ] as const) {
    values.set(
      kind,
      derivedValue(metricId, (id) => periodValue(states.get(id), kind)),
    );
  }

  const current = values.get("CURRENT") ?? null;
  const previous = values.get("PREVIOUS") ?? null;
  const yoy = values.get("YOY") ?? null;
  const seasonalBaseline = values.get("SEASONAL_BASELINE") ?? null;
  const dependencyStates = dependencies.map((id) => states.get(id));
  const missingDependencies = dependencies.filter(
    (id) => states.get(id)?.current === null || states.get(id) === undefined,
  );
  const dependencyConfidence = worstConfidence(
    dependencyStates.map((state) => state?.confidence ?? "UNKNOWN"),
  );
  const confidence: StateConfidence =
    current === null ? "UNKNOWN" : dependencyConfidence;
  const unknownReasons =
    missingDependencies.length > 0
      ? missingDependencies.map((id) => "MISSING_DEPENDENCY:" + id)
      : dependencyStates.flatMap((state) => state?.unknownReasons ?? []);

  const evidence: EvidenceRef[] = [];
  for (const kind of [
    "CURRENT",
    "PREVIOUS",
    "YOY",
    "SEASONAL_BASELINE",
  ] as const) {
    const value = values.get(kind) ?? null;
    const period = periodForKind(request, kind);
    if (value === null || period === undefined) continue;
    const dependencyEvidenceIds = dependencyStates.flatMap((state) =>
      state === undefined
        ? []
        : state.evidence
            .filter((item) => item.periodKind === kind)
            .map((item) => item.evidenceId),
    );
    evidence.push({
      evidenceId:
        "derived:" +
        metricId +
        ":" +
        kind.toLowerCase() +
        ":" +
        request.asOf,
      merchantId: request.merchantId,
      metricId,
      source: "DERIVED",
      periodKind: kind,
      observedAt: request.asOf,
      periodStart: period.start,
      periodEnd: period.end,
      value,
      ...(definition.unit === "MONEY" ? { currency: request.currency } : {}),
      provenance:
        "Derived from " +
        dependencies.join(",") +
        "; evidence=" +
        dependencyEvidenceIds.join(","),
    });
  }

  return {
    metricId,
    domain: definition.domain,
    unit: definition.unit,
    current,
    previous,
    yoy,
    seasonalBaseline,
    deltaVsPrevious:
      current === null || previous === null ? null : current - previous,
    deltaPctVsPrevious: pctChange(current, previous),
    deltaPctVsYoy: pctChange(current, yoy),
    trend: computeTrend(metricId, current, previous, yoy),
    confidence,
    evidence,
    unknownReasons,
  };
}

function measurementValue(
  states: ReadonlyMap<CanonicalMetricId, MetricState>,
  metricId: CanonicalMetricId,
): number | null {
  return states.get(metricId)?.current ?? null;
}

function buildMeasurementCoverage(
  states: ReadonlyMap<CanonicalMetricId, MetricState>,
): BusinessStateSnapshot["measurement"] {
  return {
    cogsCoverage: measurementValue(states, "cogs_coverage"),
    journeyCoverage: measurementValue(states, "journey_coverage"),
    identityQuality: measurementValue(states, "identity_quality"),
    providerAvailabilityScore: measurementValue(
      states,
      "provider_availability_score",
    ),
    freshnessSeconds: measurementValue(states, "data_freshness_seconds"),
    attributionQuality: measurementValue(states, "attribution_quality"),
    incrementalityMeasuredRate: measurementValue(
      states,
      "incrementality_measured_rate",
    ),
    sampleAdequacy: measurementValue(states, "sample_adequacy"),
  };
}

function makeSnapshotId(request: BusinessStateCollectionRequest): string {
  return [
    "business-state",
    request.merchantId,
    request.periods.current.end,
    request.asOf,
  ]
    .join(":")
    .replace(/[^A-Za-z0-9:._-]/g, "_");
}

export async function collectBusinessState(
  request: BusinessStateCollectionRequest,
  provider: BusinessStateEvidenceProvider,
): Promise<BusinessStateSnapshot> {
  const domains = [...(request.domains ?? ALL_DOMAINS)];
  const detailsPromise = provider.getDetails === undefined
    ? Promise.resolve({
        acquisitionChannels: [],
        customerCohorts: [],
        journeyCharacteristics: [],
        merchandisingEntities: [],
        lifecyclePrograms: [],
      })
    : provider.getDetails(request);
  const requestedMetricIds = metricsForDomains(
    domains,
    request.includeOptionalMetrics ?? true,
  );
  const metricIds = requiredMetricClosure(requestedMetricIds);
  const directMetricIds = metricIds.filter(
    (metricId) => metricRegistry[metricId].derivedFrom === undefined,
  );

  const directEvidence = new Map<
    CanonicalMetricId,
    Map<PeriodKind, EvidenceRef>
  >();
  const invalidReasons = new Map<CanonicalMetricId, string[]>();

  const jobs: Promise<void>[] = [];
  for (const metricId of directMetricIds) {
    const definition = metricRegistry[metricId];
    for (const period of periodSpecs(request)) {
      jobs.push(
        (async () => {
          const raw = await provider.getEvidence({
            merchantId: request.merchantId,
            metricId,
            sourceCandidates: definition.authoritativeSources.filter(
              (source) => source !== "DERIVED",
            ),
            periodKind: period.kind,
            periodStart: period.start,
            periodEnd: period.end,
            asOf: request.asOf,
            currency: request.currency,
            timezone: request.timezone,
          });
          if (raw === null) return;

          let parsed: EvidenceRef;
          try {
            parsed = evidenceRefSchema.parse(raw);
          } catch {
            const reasons = invalidReasons.get(metricId) ?? [];
            reasons.push("MALFORMED_EVIDENCE:" + period.kind);
            invalidReasons.set(metricId, reasons);
            return;
          }

          const moneyCurrencyMismatch =
            definition.unit === "MONEY" &&
            parsed.currency !== request.currency;
          const futureEvidence =
            Date.parse(parsed.observedAt) > Date.parse(request.asOf);
          if (
            parsed.merchantId !== request.merchantId ||
            parsed.metricId !== metricId ||
            parsed.periodKind !== period.kind ||
            parsed.periodStart !== period.start ||
            parsed.periodEnd !== period.end ||
            moneyCurrencyMismatch ||
            futureEvidence ||
            !isAuthoritativeEvidenceSource(metricId, parsed.source)
          ) {
            const reasons = invalidReasons.get(metricId) ?? [];
            reasons.push("NON_AUTHORITATIVE_OR_MISBOUND_EVIDENCE:" + period.kind);
            invalidReasons.set(metricId, reasons);
            return;
          }

          const byPeriod = directEvidence.get(metricId) ?? new Map();
          byPeriod.set(period.kind, parsed);
          directEvidence.set(metricId, byPeriod);
        })(),
      );
    }
  }

  const [, rawDetails] = await Promise.all([
    Promise.all(jobs),
    detailsPromise,
  ]);
  const details = businessStateDetailsSchema.parse(rawDetails);

  const states = new Map<CanonicalMetricId, MetricState>();
  for (const metricId of directMetricIds) {
    states.set(
      metricId,
      directMetricState(
        metricId,
        directEvidence.get(metricId) ?? new Map(),
        invalidReasons.get(metricId) ?? [],
      ),
    );
  }

  const remaining = new Set(
    metricIds.filter(
      (metricId) => metricRegistry[metricId].derivedFrom !== undefined,
    ),
  );
  let progress = true;
  while (remaining.size > 0 && progress) {
    progress = false;
    for (const metricId of [...remaining]) {
      const dependencies = metricRegistry[metricId].derivedFrom ?? [];
      if (dependencies.every((dependency) => states.has(dependency))) {
        states.set(metricId, derivedMetricState(metricId, states, request));
        remaining.delete(metricId);
        progress = true;
      }
    }
  }

  for (const metricId of remaining) {
    const definition = metricRegistry[metricId];
    states.set(metricId, {
      metricId,
      domain: definition.domain,
      unit: definition.unit,
      current: null,
      previous: null,
      yoy: null,
      seasonalBaseline: null,
      deltaVsPrevious: null,
      deltaPctVsPrevious: null,
      deltaPctVsYoy: null,
      trend: "UNKNOWN",
      confidence: "UNKNOWN",
      evidence: [],
      unknownReasons: ["UNRESOLVED_DERIVATION_DEPENDENCY"],
    });
  }

  const finalMetrics = requestedMetricIds
    .map((metricId) => states.get(metricId))
    .filter((metric): metric is MetricState => metric !== undefined);
  const requiredMetrics = finalMetrics.filter(
    (metric) => metricRegistry[metric.metricId].requiredForDomain,
  );
  const overallConfidence = worstConfidence(
    requiredMetrics.map((metric) => metric.confidence),
  );
  const evidenceComplete = requiredMetrics.every(
    (metric) => metric.current !== null && metric.confidence !== "UNKNOWN",
  );

  return businessStateSnapshotSchema.parse({
    version: BUSINESS_STATE_VERSION,
    snapshotId: makeSnapshotId(request),
    merchantId: request.merchantId,
    asOf: request.asOf,
    currency: request.currency,
    timezone: request.timezone,
    periodStart: request.periods.current.start,
    periodEnd: request.periods.current.end,
    metrics: finalMetrics,
    signals: [],
    constraints: [],
    measurement: buildMeasurementCoverage(states),
    details,
    overallConfidence,
    requestedDomains: domains,
    collectorVersion: BUSINESS_STATE_COLLECTOR_VERSION,
    evidenceComplete,
  });
}

export class InMemoryEvidenceProvider
  implements BusinessStateEvidenceProvider
{
  readonly #records: readonly EvidenceRef[];

  constructor(records: readonly EvidenceRef[]) {
    this.#records = records.map((record) => evidenceRefSchema.parse(record));
  }

  async getEvidence(
    request: Parameters<BusinessStateEvidenceProvider["getEvidence"]>[0],
  ): Promise<EvidenceRef | null> {
    const matches = this.#records.filter(
      (record) =>
        record.merchantId === request.merchantId &&
        record.metricId === request.metricId &&
        record.periodKind === request.periodKind &&
        request.sourceCandidates.includes(record.source) &&
        record.periodStart === request.periodStart &&
        record.periodEnd === request.periodEnd &&
        (metricRegistry[record.metricId].unit !== "MONEY" ||
          record.currency === request.currency),
    );
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new RangeError(
        "Ambiguous governed evidence for " +
          request.metricId +
          "/" +
          request.periodKind,
      );
    }
    return matches[0] ?? null;
  }
}
