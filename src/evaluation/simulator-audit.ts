import type { EvaluatorWorldBundle } from "./measured-world.js";
import { parseOperatorObservation } from "../observation/corrupted-world.js";
import { validateGroundTruthManifest } from "../ground_truth/manifest.js";
import type { InventorySnapshot } from "../inventory_dynamics/types.js";

export interface AuditCheck { readonly checkId: string; readonly checked: number; readonly violations: number; readonly status: "PASS" | "FAIL" | "NOT_MEASURED" }
const safe = (v: number) => Number.isSafeInteger(v);
const sum = (v: readonly number[]) => v.reduce((a, b) => a + BigInt(b), 0n);
/** Independent integer reconciliation of an executed simulator bundle. No platform sums. */
export function auditSimulatorBundle(bundle: EvaluatorWorldBundle) {
  const { request, simulation } = bundle.latentTruth;
  const start = Date.parse(request.startTime), end = Date.parse(request.endTime), asOf = Date.parse(bundle.corruptedObservation.asOf);
  const customers = new Set(request.latentPopulation.customers.map(c => c.customerId));
  const checks: AuditCheck[] = [];
  const record = (checkId: string, results: readonly boolean[]) => checks.push({ checkId, checked: results.length,
    violations: results.filter(r => !r).length, status: results.length === 0 ? "NOT_MEASURED" : results.every(Boolean) ? "PASS" : "FAIL" });
  record("customers_exist_before_purchases", simulation.purchases.map(p => customers.has(p.customerId) && Date.parse(p.occurredAt) >= start && Date.parse(p.occurredAt) <= end));
  record("unique_order_identity", [new Set(simulation.purchases.map(p => p.orderId)).size === simulation.purchases.length]);
  record("line_and_order_revenue", simulation.purchases.map(p => {
    if (![p.grossRevenueMinor, p.discountMinor, p.netRevenueMinor, ...p.lines.flatMap(l => [l.quantity, l.unitPriceMinor, l.discountMinor, l.revenueMinor])].every(safe)) return false;
    return BigInt(p.grossRevenueMinor) - BigInt(p.discountMinor) === BigInt(p.netRevenueMinor) &&
      sum(p.lines.map(l => l.revenueMinor)) === BigInt(p.netRevenueMinor) &&
      p.lines.every(l => l.quantity > 0 && l.unitPriceMinor >= 0 && l.discountMinor >= 0 && l.revenueMinor >= 0 && BigInt(l.unitPriceMinor) * BigInt(l.quantity) - BigInt(l.discountMinor) === BigInt(l.revenueMinor));
  }));
  record("per_order_booked_profit", simulation.purchases.map(p => {
    const values = [p.netRevenueMinor, p.estimatedCogsMinor, p.paymentFeeMinor, p.shippingSubsidyMinor, p.fulfillmentMinor, p.allocatedMarketingSpendMinor, p.contributionProfitMinor];
    return values.every(safe) && BigInt(p.netRevenueMinor) - sum(values.slice(1, 6)) === BigInt(p.contributionProfitMinor);
  }));
  // The inherited per-order allocation is NOT all paid spend; this check does not certify whole-store contribution.
  const visiblePurchases = simulation.purchases.filter(p => Date.parse(p.occurredAt) <= asOf && Date.parse(p.occurredAt) < end);
  const serverOrders = bundle.perfectObservableTruth.events.filter(e => e.origin === "server" && e.eventType === "purchase" && Date.parse(e.occurredAt) <= asOf);
  record("perfect_server_orders_reconcile", [serverOrders.length === visiblePurchases.length &&
    new Set(serverOrders.map(e => e.orderId)).size === serverOrders.length &&
    sum(serverOrders.map(e => e.amountMinor ?? 0)) === sum(visiblePurchases.map(p => p.netRevenueMinor))]);
  try { parseOperatorObservation(bundle.corruptedObservation); record("observed_schema_and_time", [true]); }
  catch { record("observed_schema_and_time", [false]); }
  try { validateGroundTruthManifest(request.merchantWorld.manifest); record("causal_graph_and_parameters_retained", [simulation.godMode.purchaseTruth.length === simulation.purchases.length]); }
  catch { record("causal_graph_and_parameters_retained", [false]); }
  const inventory = simulation.godMode.inventory;
  const validPosition = (p: InventorySnapshot) => {
    const quantities = [p.onHandUnits, p.availableToSellUnits, p.reservedUnits, p.committedUnits, p.damagedUnits, p.quarantinedReturnUnits, p.inboundUnits, p.backorderedUnits];
    return quantities.every(n => safe(n) && n >= 0) && p.availableToSellUnits === p.onHandUnits - p.reservedUnits - p.committedUnits - p.damagedUnits - p.quarantinedReturnUnits;
  };
  record("inventory_never_negative", inventory === undefined ? [] : [...inventory.positions,
    ...inventory.ledger.flatMap(m => [m.before, m.after])].map(validPosition));
  record("inventory_conservation", inventory?.reconciliation.map(r => {
    const values = [r.openingOnHandUnits, r.receivedUnits, r.returnedUnits, r.explicitAdjustmentUnits, r.soldUnits, r.writtenOffUnits, r.actualClosingOnHandUnits];
    return values.every(safe) && sum(values.slice(0, 4)) - sum(values.slice(4, 6)) === BigInt(r.actualClosingOnHandUnits) && r.actualClosingOnHandUnits >= 0;
  }) ?? []);
  record("sales_have_stock", inventory?.ledger.filter(m => m.movementType === "sale").map(m =>
    m.quantity > 0 && m.before.onHandUnits >= m.quantity && m.before.onHandUnits - m.quantity === m.after.onHandUnits) ?? []);
  return { access: "evaluator_only" as const, version: "simulator-independent-audit/1.0.0" as const,
    scope: "explicit_agents_order_accounting_and_enabled_physical_inventory" as const,
    checkedOrders: simulation.purchases.length, checks,
    passed: checks.every(c => c.status !== "FAIL"), unmeasured: checks.filter(c => c.status === "NOT_MEASURED").map(c => c.checkId) };
}

/** Two-sample ECDF distance; useful for stationarity checks, not proof of external realism. */
export function compareEmpiricalDistributions(left: readonly number[], right: readonly number[], alpha = 0.001) {
  if (left.length < 2 || right.length < 2 || [...left, ...right].some(x => !Number.isFinite(x)) || !(alpha > 0 && alpha < 1)) {
    throw new RangeError("two finite nonempty samples and a valid preregistered alpha are required");
  }
  const a = [...left].sort((x, y) => x - y), b = [...right].sort((x, y) => x - y);
  let i = 0, j = 0, distance = 0;
  while (i < a.length || j < b.length) {
    const value = Math.min(a[i] ?? Infinity, b[j] ?? Infinity);
    while (i < a.length && a[i]! <= value) i += 1;
    while (j < b.length && b[j]! <= value) j += 1;
    distance = Math.max(distance, Math.abs(i / a.length - j / b.length));
  }
  // Conservative union of two one-sample DKW bands. No independence of observations
  // within a sample is established here; callers must sample independent worlds.
  const threshold = Math.sqrt(Math.log(4 / alpha) / (2 * a.length)) + Math.sqrt(Math.log(4 / alpha) / (2 * b.length));
  return { statistic: "two_sample_ecdf_distance" as const, distance, threshold, alpha, leftCount: a.length, rightCount: b.length,
    compatibleAtRegisteredThreshold: distance <= threshold, externalRealismEstablished: false as const };
}
