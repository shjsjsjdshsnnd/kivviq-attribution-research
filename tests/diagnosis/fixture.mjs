/** Synthetic evidence only. No real merchant data and no simulator truth input. */
export function fixture({ orders0 = 100, orders1 = 100, aov0 = 10000, aov1 = 12500,
  sessions0 = 10000, sessions1 = 10000, traffic = false } = {}) {
  const values = { revenue_net: [Math.round(orders0 * aov0), Math.round(orders1 * aov1)], orders: [orders0, orders1],
    aov: [aov0, aov1], sessions: [sessions0, sessions1], cvr: [sessions0 === 0 ? 0 : orders0 / sessions0, sessions1 === 0 ? 0 : orders1 / sessions1] };
  const units = { revenue_net: "MONEY", orders: "COUNT", aov: "MONEY", sessions: "COUNT", cvr: "RATIO" };
  const sources = { revenue_net: "SHOPIFY", orders: "SHOPIFY", aov: "DERIVED", sessions: "GA4", cvr: "DERIVED" };
  const windows = [{ start: "2026-09-01T00:00:00Z", end: "2026-09-08T00:00:00Z" },
    { start: "2026-09-08T00:00:00Z", end: "2026-09-15T00:00:00Z" }];
  const observation = (id, period) => ({ value: values[id][period], merchantId: "synthetic-merchant", scopeId: "online-store", populationId: "eligible-storefront-orders",
    definitionId: `${id}@business-state/1.0.0`, measurementId: `${id}@method-v1`, source: sources[id],
    evidenceId: `${id}:${period}`, observedAt: "2026-09-15T11:00:00Z", dataThrough: windows[period].end,
    coverage: 1, complete: true, sourceScanComplete: true, window: { ...windows[period] }, currency: units[id] === "MONEY" ? "CAD" : null });
  return { version: "diagnosis-input/0.1.0", snapshotId: "synthetic-snapshot", merchantId: "synthetic-merchant",
    asOf: "2026-09-15T12:00:00Z", currency: "CAD", minorUnitsPerMajor: 100, comparisonKind: "PREVIOUS",
    metrics: (traffic ? Object.keys(values) : ["revenue_net", "orders", "aov"]).map(id => ({ metricId: id, unit: units[id], reference: observation(id, 0), current: observation(id, 1) })),
    policy: { minimumCoverage: 0.95, maxAgeSeconds: 86400, identityToleranceMinorUnits: 1,
      materiality: { revenue_net: { absolute: 10000, relative: 0.03 }, orders: { absolute: 5, relative: 0.03 },
        aov: { absolute: 100, relative: 0.03 }, sessions: { absolute: 100, relative: 0.03 }, cvr: { absolute: 0.001, relative: 0 } } } };
}
export function metric(input, id) { return input.metrics.find(row => row.metricId === id); }
