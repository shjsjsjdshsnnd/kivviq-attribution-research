import type { SimulateWorldRequest, SimulationResult, RealizedPurchase } from "../simulation/types.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { sha256 } from "./replay-manifest.js";

export const CUSTOMER_VALUE_LEDGER_VERSION = "fixed-episode-customer-value/1.0.0" as const;
export interface CustomerValueRow {
  readonly customerId: string;
  readonly firstObservedPurchaseAt: string | null;
  readonly orders: number;
  readonly repeatOrders: number;
  readonly netMerchandiseSalesMinor: number;
  readonly bookedContributionBeforeAdvertisingMinor: number;
}
function sum(values: readonly number[]): number {
  const total = values.reduce((n, value) => {
    if (!Number.isSafeInteger(value)) throw new RangeError("customer value requires safe-integer monetary entries");
    return n + BigInt(value);
  }, 0n);
  const result = Number(total);
  if (!Number.isSafeInteger(result)) throw new RangeError("customer value exceeds safe-integer range");
  return result;
}
function beforeAdvertising(purchase: RealizedPurchase): number {
  return sum([purchase.netRevenueMinor, -purchase.estimatedCogsMinor, -purchase.paymentFeeMinor,
    -purchase.shippingSubsidyMinor, -purchase.fulfillmentMinor]);
}
/**
 * Evaluator-only realized customer value from ONE fixed episode. This is not
 * predicted lifetime value, all-cost store contribution, or a new simulation.
 * Values are explicit/unweighted legacy booked order economics before ads,
 * returns, overhead and extra promotional/variable expenses. No future order
 * enters the asOf ledger; future realized truth is a separate named object.
 */
export function customerValueFromFixedEpisode(request: SimulateWorldRequest, result: SimulationResult, asOf: string) {
  const start = Date.parse(observationTimeSchema.parse(request.startTime));
  const end = Date.parse(observationTimeSchema.parse(request.endTime));
  const cutoff = Date.parse(observationTimeSchema.parse(asOf));
  if (end <= start || cutoff < start || cutoff > end) throw new RangeError("customer value cutoff outside the fixed episode");
  if (result.provenance.merchantWorldId !== request.merchantWorld.manifest.worldId ||
      result.provenance.simulationSeed !== request.simulationSeed ||
      result.provenance.merchantWorldSeed !== request.merchantWorld.manifest.seed ||
      result.provenance.customerPopulationSeed !== request.latentPopulation.populationSeed || result.provenance.startTime !== request.startTime ||
      result.provenance.endTime !== request.endTime || sha256(result.provenance.interventions) !== sha256(request.interventions ?? [])) {
    throw new RangeError("customer value request/provenance mismatch");
  }
  const customers = request.latentPopulation.customers.map(c => c.customerId).sort();
  const known = new Set(customers), orderIds = new Set<string>();
  if (known.size !== customers.length) throw new RangeError("duplicate customer identity");
  for (const p of result.purchases) {
    const time = Date.parse(observationTimeSchema.parse(p.occurredAt));
    if (!known.has(p.customerId) || orderIds.has(p.orderId) || time < start || time > end) {
      throw new RangeError("order has invalid identity or timing");
    }
    orderIds.add(p.orderId);
    if (sum(p.lines.map(l => l.revenueMinor)) !== p.netRevenueMinor ||
        sum([p.grossRevenueMinor, -p.discountMinor]) !== p.netRevenueMinor ||
        sum([beforeAdvertising(p), -p.allocatedMarketingSpendMinor]) !== p.contributionProfitMinor) {
      throw new RangeError("customer value input order does not reconcile");
    }
  }
  const through = result.purchases.filter(p => Date.parse(p.occurredAt) <= cutoff && Date.parse(p.occurredAt) < end);
  const future = result.purchases.filter(p => Date.parse(p.occurredAt) > cutoff && Date.parse(p.occurredAt) < end);
  const summarize = (purchases: readonly RealizedPurchase[]) => {
    const rows: CustomerValueRow[] = customers.map(customerId => {
      const selected = purchases.filter(p => p.customerId === customerId);
      const first = selected.map(p => p.occurredAt).sort()[0] ?? null;
      return { customerId, firstObservedPurchaseAt: first, orders: selected.length,
        repeatOrders: selected.filter(p => p.repeatPurchase).length,
        netMerchandiseSalesMinor: sum(selected.map(p => p.netRevenueMinor)),
        bookedContributionBeforeAdvertisingMinor: sum(selected.map(beforeAdvertising)) };
    });
    const totals = { orders: purchases.length, repeatOrders: rows.reduce((n, r) => n + r.repeatOrders, 0),
      netMerchandiseSalesMinor: sum(rows.map(r => r.netMerchandiseSalesMinor)),
      bookedContributionBeforeAdvertisingMinor: sum(rows.map(r => r.bookedContributionBeforeAdvertisingMinor)) };
    if (totals.netMerchandiseSalesMinor !== sum(purchases.map(p => p.netRevenueMinor)) ||
        totals.bookedContributionBeforeAdvertisingMinor !== sum(purchases.map(beforeAdvertising))) {
      throw new RangeError("customer and order ledgers disagree");
    }
    return { rows, totals };
  };
  return { access: "evaluator_only" as const, version: CUSTOMER_VALUE_LEDGER_VERSION,
    currency: request.merchantWorld.manifest.merchant.currency,
    scope: "explicit_unweighted_legacy_booked_customer_value_before_advertising" as const,
    excludes: ["returns", "overhead", "extra_promotional_costs", "variable_operating_costs", "forecast_value"] as const,
    asOf, episodeStart: request.startTime, episodeEndExclusive: request.endTime,
    realizedAtAsOf: summarize(through), futureRealizedTruthNotForecast: summarize(future) };
}
