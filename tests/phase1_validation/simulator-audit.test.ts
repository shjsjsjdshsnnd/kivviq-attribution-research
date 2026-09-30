import { beforeAll, describe, expect, it } from "vitest";
import { auditSimulatorBundle, compareEmpiricalDistributions } from "../../src/evaluation/simulator-audit.js";
import { measurementControl } from "../../src/evaluation/simulate-cli.js";
import { runMeasuredWorld, type EvaluatorWorldBundle } from "../../src/evaluation/measured-world.js";

describe("independent simulator invariant auditor", () => {
  let bundle: EvaluatorWorldBundle;
  beforeAll(() => { const f = measurementControl(88213); bundle = runMeasuredWorld({ ...f.request,
    commercePolicy: { executeInventoryLifecycle: true, enableInventoryDynamics: true } }, f.options); }, 45000);
  it("checks executed orders and every enabled physical inventory transition, not just final aggregates", () => {
    const report = auditSimulatorBundle(bundle);
    expect(report.checkedOrders).toBeGreaterThan(0); expect(report.passed).toBe(true);
    expect(report.checks.find(c => c.checkId === "inventory_never_negative")!.checked).toBeGreaterThan(bundle.latentTruth.simulation.godMode.inventory!.positions.length);
    expect(report.checks.find(c => c.checkId === "sales_have_stock")!.status).toBe("PASS");
  });
  it("detects a revenue mismatch and does not repair or silently accept it", () => {
    const corrupted = structuredClone(bundle);
    (corrupted.latentTruth.simulation.purchases[0] as { netRevenueMinor: number }).netRevenueMinor += 1;
    const report = auditSimulatorBundle(corrupted); expect(report.passed).toBe(false);
    expect(report.checks.find(c => c.checkId === "line_and_order_revenue")!.violations).toBe(1);
  });
  it("detects purchases before customer existence and unknown customer identities", () => {
    const corrupted = structuredClone(bundle);
    (corrupted.latentTruth.simulation.purchases[0] as { occurredAt: string; customerId: string }).occurredAt = "2025-12-01T00:00:00.000Z";
    (corrupted.latentTruth.simulation.purchases[0] as { customerId: string }).customerId = "uncreated";
    expect(auditSimulatorBundle(corrupted).checks.find(c => c.checkId === "customers_exist_before_purchases")!.status).toBe("FAIL");
  });
  it("detects negative stock even when an engine's own reconciliation boolean still says true", () => {
    const corrupted = structuredClone(bundle), inventory = corrupted.latentTruth.simulation.godMode.inventory!;
    (inventory.positions[0] as { onHandUnits: number }).onHandUnits = -1;
    (inventory.reconciliation[0] as { actualClosingOnHandUnits: number }).actualClosingOnHandUnits = -1;
    const report = auditSimulatorBundle(corrupted);
    expect(report.checks.find(c => c.checkId === "inventory_never_negative")!.status).toBe("FAIL");
    expect(report.checks.find(c => c.checkId === "inventory_conservation")!.status).toBe("FAIL");
  });
  it("reports absent inventory execution as unmeasured, never as proof of no impossible states", () => {
    const corrupted = structuredClone(bundle); delete (corrupted.latentTruth.simulation.godMode as { inventory?: unknown }).inventory;
    expect(auditSimulatorBundle(corrupted).checks.find(c => c.checkId === "inventory_conservation")!.status).toBe("NOT_MEASURED");
  });
  it("detects an event delivered after the observation cutoff", () => {
    const corrupted = structuredClone(bundle);
    (corrupted.corruptedObservation.orders[0] as { receivedAt: string }).receivedAt = "2026-03-01T00:00:00.000Z";
    expect(auditSimulatorBundle(corrupted).checks.find(c => c.checkId === "observed_schema_and_time")!.status).toBe("FAIL");
  });
  it("handles ties in empirical distributions and detects material distribution shifts", () => {
    const a = Array.from({ length: 200 }, (_, i) => i % 10);
    expect(compareEmpiricalDistributions(a, [...a].reverse()).distance).toBe(0);
    expect(compareEmpiricalDistributions(a, a.map(x => x + 100)).compatibleAtRegisteredThreshold).toBe(false);
    expect(compareEmpiricalDistributions(a, a).externalRealismEstablished).toBe(false);
    expect(() => compareEmpiricalDistributions([], a)).toThrow();
    expect(() => compareEmpiricalDistributions([NaN, 1], a)).toThrow();
  });
});
