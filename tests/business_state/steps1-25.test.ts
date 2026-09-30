import { describe, it, expect } from "vitest";
import {
  BUSINESS_STATE_VERSION,
  InMemoryBusinessStateHistory,
  InMemoryEvidenceProvider,
  assessActionCompatibility,
  assessDecisionAbstention,
  buildDecisionIntelligenceContext,
  businessStateSnapshotSchema,
  collectBusinessState,
  defaultBusinessConstraintDefinitions,
  deterministicSimulatorSeedJson,
  detectStateChanges,
  evaluateBusinessConstraint,
  metricRegistry,
  metricsForDomains,
  requiredMetricClosure,
  runBusinessStateShadowMode,
  snapshotToSimulatorSeed,
  syntheticBusinessStateBenchmark,
  withBusinessConstraints,
  withDerivedStateSignals,
  type AuthoritativeSource,
  type BusinessActionCandidate,
  type BusinessStateCollectionRequest,
  type CanonicalMetricId,
  type EvidenceRef,
  type PeriodKind,
} from "../../src/business_state/index.js";

const CURRENT = {
  start: "2026-09-01T04:00:00.000Z",
  end: "2026-10-01T04:00:00.000Z",
};
const PREVIOUS = {
  start: "2026-08-01T04:00:00.000Z",
  end: "2026-09-01T04:00:00.000Z",
};
const YOY = {
  start: "2025-09-01T04:00:00.000Z",
  end: "2025-10-01T04:00:00.000Z",
};
const AS_OF = "2026-09-30T20:00:00.000Z";

function sourceFor(metricId: CanonicalMetricId): AuthoritativeSource {
  const source = metricRegistry[metricId].authoritativeSources.find(
    (candidate) => candidate !== "DERIVED",
  );
  if (source === undefined) {
    throw new Error("Metric has no direct source: " + metricId);
  }
  return source;
}

function evidence(
  metricId: CanonicalMetricId,
  value: number,
  periodKind: PeriodKind,
  period: { start: string; end: string },
  options: {
    source?: AuthoritativeSource;
    coverage?: number;
    sampleSize?: number;
  } = {},
): EvidenceRef {
  return {
    evidenceId:
      metricId + ":" + periodKind.toLowerCase() + ":" + value.toString(),
    metricId,
    source: options.source ?? sourceFor(metricId),
    periodKind,
    observedAt: AS_OF,
    periodStart: period.start,
    periodEnd: period.end,
    value,
    ...(options.coverage === undefined
      ? {}
      : { coverage: options.coverage }),
    ...(options.sampleSize === undefined
      ? {}
      : { sampleSize: options.sampleSize }),
    freshnessSeconds: 60,
    provenance: "test-governed-evidence",
  };
}

function request(
  domains: BusinessStateCollectionRequest["domains"],
): BusinessStateCollectionRequest {
  return {
    merchantId: "merchant-1",
    asOf: AS_OF,
    currency: "CAD",
    timezone: "America/Toronto",
    periods: { current: CURRENT, previous: PREVIOUS, yoy: YOY },
    ...(domains === undefined ? {} : { domains }),
    includeOptionalMetrics: false,
  };
}

function commercialEvidence(): EvidenceRef[] {
  return [
    evidence("revenue_net", 1_000, "CURRENT", CURRENT),
    evidence("revenue_net", 900, "PREVIOUS", PREVIOUS),
    evidence("revenue_net", 800, "YOY", YOY),
    evidence("orders", 10, "CURRENT", CURRENT),
    evidence("orders", 9, "PREVIOUS", PREVIOUS),
    evidence("orders", 8, "YOY", YOY),
    evidence("discount_rate", 0.1, "CURRENT", CURRENT),
    evidence("discount_rate", 0.1, "PREVIOUS", PREVIOUS),
    evidence("discount_rate", 0.08, "YOY", YOY),
  ];
}

function caseById(id: string) {
  const found = syntheticBusinessStateBenchmark().find(
    (item) => item.scenarioId === id,
  );
  if (found === undefined) throw new Error("Missing benchmark case " + id);
  return found;
}

describe("Canonical Business State — Steps 1–25", () => {
  it("Step 1 defines one canonical business-state schema", () => {
    const snapshot = caseById("state-growth").snapshot;
    expect(snapshot.version).toBe(BUSINESS_STATE_VERSION);
    expect(
      businessStateSnapshotSchema.parse(snapshot).snapshotId,
    ).toBe(snapshot.snapshotId);
    expect(new Set(snapshot.metrics.map((metric) => metric.domain))).toEqual(
      new Set([
        "COMMERCIAL",
        "PROFITABILITY",
        "ACQUISITION",
        "CUSTOMER",
        "MERCHANDISING",
        "LIFECYCLE",
        "MEASUREMENT",
      ]),
    );
  });

  it("Step 2 precisely registers canonical metric definitions", () => {
    expect(metricRegistry.revenue_net.definition).toContain("Shopify");
    expect(metricRegistry.contribution_profit.derivedFrom).toEqual([
      "gross_profit",
      "paid_spend",
      "shipping_fulfillment_cost",
      "payment_fees",
      "returns_cost",
    ]);
    expect(metricRegistry.platform_roas.definition).toContain(
      "Never treated as incrementality",
    );
    expect(metricRegistry.cac.definition).toContain("not an incrementality");
  });

  it("Step 3 maps each metric to authoritative sources", () => {
    expect(metricRegistry.revenue_net.authoritativeSources).toEqual([
      "SHOPIFY",
    ]);
    expect(metricRegistry.sessions.authoritativeSources).toEqual(["GA4"]);
    expect(metricRegistry.journey_coverage.authoritativeSources).toEqual([
      "FIRST_PARTY",
    ]);
    expect(metricRegistry.automation_revenue.authoritativeSources).toEqual([
      "OMNISEND",
      "KLAVIYO",
    ]);
    expect(metricRegistry.paid_spend.authoritativeSources).toContain(
      "GOOGLE_ADS",
    );
  });

  it("Step 4 collects only the minimum direct evidence required for a requested state", async () => {
    const calls: CanonicalMetricId[] = [];
    const provider = {
      async getEvidence(
        evidenceRequest: Parameters<
          InMemoryEvidenceProvider["getEvidence"]
        >[0],
      ) {
        calls.push(evidenceRequest.metricId);
        return (
          commercialEvidence().find(
            (item) =>
              item.metricId === evidenceRequest.metricId &&
              item.periodKind === evidenceRequest.periodKind,
          ) ?? null
        );
      },
    };
    await collectBusinessState(request(["COMMERCIAL"]), provider);
    expect(new Set(calls)).toEqual(
      new Set(["revenue_net", "orders", "discount_rate"]),
    );
    expect(calls).toHaveLength(9);
  });

  it("Step 5 carries previous-period and YoY context into metric state", async () => {
    const snapshot = await collectBusinessState(
      request(["COMMERCIAL"]),
      new InMemoryEvidenceProvider(commercialEvidence()),
    );
    const revenue = snapshot.metrics.find(
      (metric) => metric.metricId === "revenue_net",
    );
    expect(revenue?.current).toBe(1_000);
    expect(revenue?.previous).toBe(900);
    expect(revenue?.yoy).toBe(800);
    expect(revenue?.deltaPctVsPrevious).toBeCloseTo(1 / 9);
    expect(revenue?.trend).toBe("RISING");
  });

  it("Step 6 builds commercial state with revenue orders AOV and discounting", async () => {
    const snapshot = await collectBusinessState(
      request(["COMMERCIAL"]),
      new InMemoryEvidenceProvider(commercialEvidence()),
    );
    const values = new Map(
      snapshot.metrics.map((metric) => [metric.metricId, metric.current]),
    );
    expect(values.get("revenue_net")).toBe(1_000);
    expect(values.get("orders")).toBe(10);
    expect(values.get("aov")).toBe(100);
    expect(values.get("discount_rate")).toBe(0.1);
  });

  it("Step 7 preserves unknown profitability costs instead of treating them as zero", async () => {
    const records = [
      evidence("revenue_net", 1_000, "CURRENT", CURRENT),
      evidence("cogs", 500, "CURRENT", CURRENT),
      evidence("shipping_fulfillment_cost", 100, "CURRENT", CURRENT),
      evidence("payment_fees", 30, "CURRENT", CURRENT),
      evidence("paid_spend", 100, "CURRENT", CURRENT),
    ];
    const snapshot = await collectBusinessState(
      {
        ...request(["PROFITABILITY"]),
        periods: { current: CURRENT },
      },
      new InMemoryEvidenceProvider(records),
    );
    const contribution = snapshot.metrics.find(
      (metric) => metric.metricId === "contribution_profit",
    );
    expect(contribution?.current).toBeNull();
    expect(contribution?.confidence).toBe("UNKNOWN");
    expect(contribution?.unknownReasons.join("|")).toContain("returns_cost");
  });

  it("Step 8 represents acquisition and marketing state separately from incrementality", () => {
    const snapshot = caseById("state-retargeting-dependence").snapshot;
    expect(
      snapshot.metrics.find((metric) => metric.metricId === "retargeting_share")
        ?.current,
    ).toBe(0.82);
    expect(
      snapshot.metrics.find(
        (metric) => metric.metricId === "incremental_paid_contribution",
      ),
    ).toBeDefined();
    expect(metricRegistry.platform_roas.definition).toContain(
      "platform's own reporting methodology",
    );
  });

  it("Step 9 represents new returning retention frequency and customer value", () => {
    const customerMetricIds = metricsForDomains(["CUSTOMER"]);
    expect(customerMetricIds).toEqual(
      expect.arrayContaining([
        "new_customers",
        "returning_orders",
        "repeat_rate",
        "purchase_frequency",
        "customer_value_90d",
        "retention_rate_90d",
      ]),
    );
  });

  it("Step 10 represents merchandising margin concentration inventory and momentum", () => {
    const ids = metricsForDomains(["MERCHANDISING"]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "product_revenue_concentration",
        "average_product_margin",
        "discounted_revenue_share",
        "inventory_days_cover_min",
        "out_of_stock_rate",
        "product_momentum",
      ]),
    );
  });

  it("Step 11 represents lifecycle list campaign automation and revenue coverage", () => {
    const ids = metricsForDomains(["LIFECYCLE"]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "email_list_size",
        "campaign_revenue",
        "automation_revenue",
        "lifecycle_revenue",
        "automation_coverage",
      ]),
    );
  });

  it("Step 12 explicitly represents measurement quality", () => {
    const snapshot = caseById("state-growth").snapshot;
    expect(snapshot.measurement.cogsCoverage).toBe(0.99);
    expect(snapshot.measurement.journeyCoverage).toBe(0.9);
    expect(snapshot.measurement.identityQuality).toBe(0.9);
    expect(snapshot.measurement.incrementalityMeasuredRate).toBe(0.6);
  });

  it("Step 13 represents constraints and keeps unknown constraints unknown", () => {
    const inventory = caseById("state-inventory-shortage").snapshot;
    const violated = evaluateBusinessConstraint(inventory, {
      constraintId: "inventory:seven-days",
      kind: "INVENTORY_LIMIT",
      metricId: "inventory_days_cover_min",
      comparator: "GTE",
      threshold: 7,
      unit: "DAYS",
      reason: "Require at least seven days of cover",
    });
    expect(violated.status).toBe("VIOLATED");

    const unknownSnapshot = {
      ...inventory,
      metrics: inventory.metrics.map((metric) =>
        metric.metricId === "inventory_days_cover_min"
          ? {
              ...metric,
              current: null,
              confidence: "UNKNOWN" as const,
              unknownReasons: ["missing"],
            }
          : metric,
      ),
    };
    const unknown = evaluateBusinessConstraint(unknownSnapshot, {
      constraintId: "inventory:seven-days",
      kind: "INVENTORY_LIMIT",
      metricId: "inventory_days_cover_min",
      comparator: "GTE",
      threshold: 7,
      unit: "DAYS",
      reason: "Require at least seven days of cover",
    });
    expect(unknown.status).toBe("UNKNOWN");
  });

  it("Step 14 derives factual signals while retaining supporting metrics", () => {
    const snapshot = caseById("adv-revenue-up-profit-down").snapshot;
    const signal = snapshot.signals.find(
      (item) => item.code === "profit_down_revenue_up",
    );
    expect(signal?.active).toBe(true);
    expect(signal?.evidenceMetricIds).toEqual([
      "revenue_net",
      "contribution_profit",
    ]);
  });

  it("Step 15 assigns explicit confidence and never manufactures missing state", async () => {
    const snapshot = await collectBusinessState(
      {
        ...request(["COMMERCIAL"]),
        periods: { current: CURRENT },
      },
      new InMemoryEvidenceProvider([
        evidence("orders", 10, "CURRENT", CURRENT),
        evidence("discount_rate", 0.1, "CURRENT", CURRENT),
      ]),
    );
    const revenue = snapshot.metrics.find(
      (metric) => metric.metricId === "revenue_net",
    );
    expect(revenue?.current).toBeNull();
    expect(revenue?.confidence).toBe("UNKNOWN");
    expect(snapshot.evidenceComplete).toBe(false);
  });

  it("Step 16 produces one validated canonical Business State Snapshot", () => {
    const snapshot = caseById("state-growth").snapshot;
    const parsed = businessStateSnapshotSchema.parse(snapshot);
    expect(parsed.metrics.length).toBeGreaterThan(40);
    expect(new Set(parsed.metrics.map((metric) => metric.metricId)).size).toBe(
      parsed.metrics.length,
    );
  });

  it("Step 17 stores historical snapshots in strict time order", () => {
    const first = caseById("state-growth").snapshot;
    const second = {
      ...caseById("state-stagnation").snapshot,
      snapshotId: "later",
      asOf: "2026-10-01T20:00:00.000Z",
    };
    const history = new InMemoryBusinessStateHistory();
    history.append(first);
    history.append(second);
    expect(history.list(first.merchantId)).toHaveLength(2);
    expect(history.latest(first.merchantId)?.snapshotId).toBe("later");
  });

  it("Step 18 detects meaningful state transitions rather than reporting every movement", () => {
    const previous = {
      ...caseById("state-growth").snapshot,
      asOf: "2026-09-29T20:00:00.000Z",
    };
    const current = {
      ...caseById("state-retargeting-dependence").snapshot,
      asOf: "2026-09-30T20:00:00.000Z",
    };
    const changes = detectStateChanges(previous, current);
    expect(
      changes.transitions.find(
        (transition) =>
          transition.code ===
          "balanced_acquisition_to_retargeting_dependence",
      )?.active,
    ).toBe(true);
  });

  it("Step 19 converts the canonical state into a deterministic simulator seed", () => {
    const snapshot = caseById("state-growth").snapshot;
    const seed = snapshotToSimulatorSeed(snapshot);
    expect(seed.sourceSnapshotId).toBe(snapshot.snapshotId);
    expect(seed.knownMetrics["revenue_net"]).toBe(120_000);
    expect(deterministicSimulatorSeedJson(snapshot)).toBe(
      deterministicSimulatorSeedJson(snapshot),
    );
  });

  it("Step 20 creates state → actions → consequences → constraints decision context", () => {
    const snapshot = withBusinessConstraints(
      caseById("state-growth").snapshot,
      defaultBusinessConstraintDefinitions(
        caseById("state-growth").snapshot,
      ),
    );
    const action: BusinessActionCandidate = {
      actionId: "increase-paid",
      description: "Increase paid budget",
      simulatorInterventionRef: "paid-budget:+1000",
      requiredMetrics: [
        { metricId: "contribution_profit", minimumConfidence: "PARTIAL" },
      ],
      requiredConstraintIds: ["measurement:cogs-coverage"],
      forbiddenSignals: ["inventory_constrained"],
      expectedConsequences: [
        {
          metricId: "contribution_profit",
          expectedDirection: "UNKNOWN",
          horizonDays: 30,
          confidence: "UNCERTAIN",
          measurementMethod: "paired simulator counterfactual",
        },
      ],
    };
    const context = buildDecisionIntelligenceContext(snapshot, [action]);
    expect(context.eligible.map((item) => item.actionId)).toEqual([
      "increase-paid",
    ]);
    expect(context.automaticDecisionAllowed).toBe(false);
  });

  it("Step 21 abstains when required state is insufficiently measured and names needed evidence", () => {
    const snapshot = caseById("state-measurement-failure").snapshot;
    const action: BusinessActionCandidate = {
      actionId: "profit-scale",
      description: "Scale only with strong COGS evidence",
      simulatorInterventionRef: "scale",
      requiredMetrics: [
        { metricId: "cogs_coverage", minimumConfidence: "KNOWN" },
      ],
      requiredConstraintIds: [],
      expectedConsequences: [
        {
          metricId: "contribution_profit",
          expectedDirection: "UNKNOWN",
          horizonDays: 30,
          confidence: "UNKNOWN",
          measurementMethod: "requires sufficient evidence first",
        },
      ],
    };
    const result = assessDecisionAbstention(snapshot, action);
    expect(result.mustAbstain).toBe(true);
    expect(result.evidenceNeeded).toContain("cogs_coverage");
  });

  it("Step 22 provides a synthetic Business-State benchmark across distinct business conditions", () => {
    const benchmark = syntheticBusinessStateBenchmark();
    expect(benchmark.length).toBeGreaterThanOrEqual(12);
    expect(new Set(benchmark.map((item) => item.scenarioId)).size).toBe(
      benchmark.length,
    );
    expect(benchmark.map((item) => item.trap)).toEqual(
      expect.arrayContaining([
        "GROWTH",
        "STAGNATION",
        "MARGIN_COMPRESSION",
        "RETARGETING_DEPENDENCE",
        "INVENTORY_SHORTAGE",
        "DISCOUNT_DRIVEN_GROWTH",
        "RETENTION_PROBLEM",
        "MEASUREMENT_FAILURE",
      ]),
    );
  });

  it("Step 23 includes adversarial revenue-profit ROAS and inventory traps", () => {
    const revenueProfit = caseById("adv-revenue-up-profit-down");
    const roas = caseById("adv-high-roas-demand-capture");
    const inventory = caseById("adv-scale-with-four-days-stock");
    expect(revenueProfit.expectedActiveSignals).toContain(
      "profit_down_revenue_up",
    );
    expect(roas.expectedActiveSignals).toContain(
      "platform_roas_high_incrementality_unmeasured",
    );
    expect(inventory.expectedActiveSignals).toContain(
      "inventory_four_day_cover",
    );
  });

  it("Step 24 blocks actions incompatible with known business-state constraints", () => {
    const raw = caseById("adv-scale-with-four-days-stock").snapshot;
    const snapshot = withBusinessConstraints(raw, [
      {
        constraintId: "inventory:seven-days",
        kind: "INVENTORY_LIMIT",
        metricId: "inventory_days_cover_min",
        comparator: "GTE",
        threshold: 7,
        unit: "DAYS",
        reason: "Scaling requires stock cover",
      },
    ]);
    const action: BusinessActionCandidate = {
      actionId: "scale-campaign",
      description: "Scale campaign",
      simulatorInterventionRef: "campaign-budget:+20%",
      requiredMetrics: [
        { metricId: "platform_roas", minimumConfidence: "PARTIAL" },
      ],
      requiredConstraintIds: ["inventory:seven-days"],
      forbiddenSignals: ["inventory_constrained"],
      expectedConsequences: [
        {
          metricId: "contribution_profit",
          expectedDirection: "UNKNOWN",
          horizonDays: 30,
          confidence: "UNCERTAIN",
          measurementMethod: "simulator",
        },
      ],
    };
    expect(assessActionCompatibility(snapshot, action).status).toBe("BLOCKED");
  });

  it("Step 25 runs governed real-data adapters in shadow mode without production decisions", async () => {
    const records = commercialEvidence().filter(
      (item) => item.periodKind === "CURRENT",
    );
    const result = await runBusinessStateShadowMode(
      {
        ...request(["COMMERCIAL"]),
        periods: { current: CURRENT },
      },
      new InMemoryEvidenceProvider(records),
      [
        {
          metricId: "revenue_net",
          expectedValue: 1_000,
          tolerance: 0,
          provenance: "governed-store-ledger",
        },
        {
          metricId: "aov",
          expectedValue: 100,
          tolerance: 0,
          provenance: "governed-derived-check",
        },
      ],
      [],
    );
    expect(result.shadowPassed).toBe(true);
    expect(result.automaticDecisionAllowed).toBe(false);
    expect(result.productionMutationAllowed).toBe(false);
    expect(result.mismatchCount).toBe(0);
  });
});
