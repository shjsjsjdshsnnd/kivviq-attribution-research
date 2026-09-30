import { z } from "zod";
import type { SimulateWorldRequest, SimulationResult } from "../simulation/types.js";
import type { Intervention } from "../ground_truth/interventions.js";
import { validateIntervention } from "../ground_truth/interventions.js";
import { buildProductEconomicProfiles, resolveEcommercePolicy } from "../ecommerce_economics/products.js";
import { buildOrderEconomics, aggregatePeriodWaterfall } from "../ecommerce_economics/waterfall.js";
import type { PerfectObservableWorld } from "../measurement_corruption/index.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { oracleContribution, type OracleEconomics } from "./finite-decision-oracle.js";

export const SCENARIO_SPEND_VERSION = "scenario-period-spend/1.0.0" as const;
export const SCENARIO_PAID_CHANNELS = ["meta", "google_search", "google_shopping", "pinterest", "affiliate"] as const;
export type ScenarioPaidChannel = typeof SCENARIO_PAID_CHANNELS[number];
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const allocationSchema = z.object({ meta: money, google_search: money, google_shopping: money,
  pinterest: money, affiliate: money }).strict();
export type ScenarioAllocation = z.infer<typeof allocationSchema>;
export const spendPlanSchema = z.object({
  version: z.literal(SCENARIO_SPEND_VERSION),
  periodStart: observationTimeSchema, periodEnd: observationTimeSchema,
  /** Explicit synthetic assumption: the declared allocation is spent in full over this period. */
  execution: z.literal("fully_spent_period_allocation"),
  scope: z.literal("explicit_simulated_agents"),
  allocation: allocationSchema,
}).strict();
export type ScenarioSpendPlan = z.infer<typeof spendPlanSchema>;
export interface ScenarioSpendEntry { readonly id: string; readonly channel: ScenarioPaidChannel;
  readonly occurredAt: string; readonly amountMinor: number }

function sumMoney(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new RangeError("scenario spend exceeds integer range");
  return total;
}
export function validateScenarioSpend(input: unknown): ScenarioSpendPlan {
  const plan = spendPlanSchema.parse(input);
  if (Date.parse(plan.periodEnd) <= Date.parse(plan.periodStart)) throw new RangeError("spend period must increase");
  sumMoney(Object.values(plan.allocation));
  return plan;
}
/** A debit schedule independent of purchases, attribution, or the random draw sequence. */
export function scenarioSpendLedger(input: unknown): readonly ScenarioSpendEntry[] {
  const plan = validateScenarioSpend(input);
  const start = Date.parse(plan.periodStart), end = Date.parse(plan.periodEnd);
  const day = 86400000;
  const count = Math.ceil((end - start) / day);
  if (count > 3660) throw new RangeError("spend horizon exceeds ten years");
  const entries: ScenarioSpendEntry[] = [];
  for (const channel of SCENARIO_PAID_CHANNELS) {
    const amount = plan.allocation[channel];
    // Cumulative allocation prevents rounding drift, including a fractional last day.
    let allocated = 0;
    for (let index = 0; index < count; index += 1) {
      const boundary = Math.min(end, start + (index + 1) * day);
      const cumulative = boundary === end ? amount : Math.floor(amount * ((boundary - start) / (end - start)));
      const portion = cumulative - allocated;
      allocated = cumulative;
      if (portion > 0) entries.push({ id: `spend:${channel}:${index}`, channel,
        occurredAt: new Date(start + index * day).toISOString(), amountMinor: portion });
    }
    if (allocated !== amount) throw new RangeError("spend ledger did not reconcile");
  }
  return entries;
}
export function measurementSpendLedger(input: unknown): PerfectObservableWorld["spend"] {
  return scenarioSpendLedger(input).flatMap(entry => {
    const platform = entry.channel === "meta" ? "meta" as const
      : entry.channel === "google_search" || entry.channel === "google_shopping" ? "google" as const : undefined;
    return platform === undefined ? [] : [{ id: entry.id, platform,
      occurredAt: entry.occurredAt, amountMinor: entry.amountMinor }];
  });
}
/** Preserve the existing simulator's period-allocation convention; do not reinterpret as daily budget. */
export function requestWithScenarioSpend(requestInput: SimulateWorldRequest, input: unknown): SimulateWorldRequest {
  const request = structuredClone(requestInput), plan = validateScenarioSpend(input);
  if (request.startTime !== plan.periodStart || request.endTime !== plan.periodEnd) throw new RangeError("spend/request windows differ");
  const active = new Set(request.merchantWorld.summary.activeChannels);
  for (const channel of SCENARIO_PAID_CHANNELS) {
    if (!active.has(channel) && plan.allocation[channel] !== 0) throw new RangeError("spend assigned to inactive channel");
  }
  if ((request.interventions ?? []).some(i => /^marketing\..*\.spend$/.test(i.variable))) {
    throw new RangeError("spend has two competing authorities");
  }
  const spendInterventions: Intervention[] = SCENARIO_PAID_CHANNELS.filter(c => active.has(c)).map(channel => ({
    variable: `marketing.${channel}.spend`, operation: "set",
    value: { kind: "number", value: plan.allocation[channel], unit: "money_minor" },
  }));
  for (const intervention of spendInterventions) validateIntervention(request.merchantWorld.manifest.causalGraph, intervention);
  return { ...request, interventions: [...(request.interventions ?? []), ...spendInterventions] };
}

/**
 * Narrow, explicit booked-contribution adapter, not full lifetime/return-adjusted profit.
 * Reuses product-level Step 7 accounting. No order-revenue-rate advertising proxy.
 * The fixture disables customer shipping receipts, gifts, coupon costs and loyalty.
 */
export function scenarioBookedEconomics(request: SimulateWorldRequest, result: SimulationResult,
  input: unknown, actionCostMinor = 0): { readonly economics: OracleEconomics;
    readonly coverage: "booked_product_costs_no_returns_no_clv_no_overhead" } {
  const plan = validateScenarioSpend(input);
  money.parse(actionCostMinor);
  if (request.startTime !== plan.periodStart || request.endTime !== plan.periodEnd ||
      result.provenance.startTime !== request.startTime || result.provenance.endTime !== request.endTime ||
      result.provenance.simulationSeed !== request.simulationSeed ||
      result.provenance.merchantWorldId !== request.merchantWorld.manifest.worldId) throw new RangeError("economic inputs are not the same world/window");
  if (JSON.stringify(result.provenance.interventions) !== JSON.stringify(request.interventions ?? [])) {
    throw new RangeError("economic result belongs to a different intervention history");
  }
  for (const channel of SCENARIO_PAID_CHANNELS) {
    if (!request.merchantWorld.summary.activeChannels.includes(channel) && plan.allocation[channel] !== 0) {
      throw new RangeError("economic spend assigned to inactive channel");
    }
  }
  // This narrow adapter must not silently omit later-step economic mechanisms.
  const policy = request.commercePolicy;
  if (policy?.pricingPromotionScenario || policy?.retentionScenario || policy?.externalRealityEnvironment ||
      policy?.executeInventoryLifecycle || policy?.enableInventoryDynamics ||
      (policy?.customerShippingChargeMinor ?? 0) !== 0) throw new RangeError("scenario booked adapter does not cover enabled economics");
  const configured = new Map((request.interventions ?? []).filter(i => /^marketing\..*\.spend$/.test(i.variable)).map(i => [i.variable, i]));
  for (const channel of SCENARIO_PAID_CHANNELS.filter(c => request.merchantWorld.summary.activeChannels.includes(c))) {
    const i = configured.get(`marketing.${channel}.spend`);
    if (!i || i.value.kind !== "number" || i.value.value !== plan.allocation[channel] ||
        i.effectiveAt !== undefined || i.durationSeconds !== undefined || i.population !== undefined) throw new RangeError("simulated spend and economic ledger differ");
  }
  const profiles = new Map(buildProductEconomicProfiles(request.merchantWorld).map(p => [p.productId, p]));
  const economicPolicy = resolveEcommercePolicy(request.merchantWorld, { customerShippingChargeMinor: 0,
    giftWithPurchaseCostMinor: 0, loyaltyCreditRate: 0, couponOperationalCostMinor: 0 });
  const purchases = result.purchases.filter(p => Date.parse(p.occurredAt) < Date.parse(request.endTime));
  const orders = purchases.map(p => buildOrderEconomics(request.merchantWorld, p, economicPolicy, profiles));
  const paid = sumMoney(scenarioSpendLedger(plan).map(e => e.amountMinor));
  // Empty weight map deliberately means one real simulated order, not population expansion.
  const waterfall = aggregatePeriodWaterfall(request.merchantWorld, orders, paid);
  const net = sumMoney(purchases.map(p => p.netRevenueMinor));
  if (net !== waterfall.netRevenueMinor || waterfall.customerShippingRevenueMinor !== 0 || waterfall.returnsRefundsMinor !== 0) {
    throw new RangeError("booked order accounting did not reconcile");
  }
  const economics: OracleEconomics = { netSalesMinor: waterfall.netRevenueMinor, cogsMinor: waterfall.cogsMinor,
    paymentFeesMinor: waterfall.paymentFeesMinor, fulfillmentMinor: waterfall.fulfillmentCostMinor,
    shippingCostMinor: waterfall.merchantShippingCostMinor,
    variableOperatingCostMinor: waterfall.variableOperatingCostsMinor + waterfall.promotionalCostsMinor,
    paidSpendMinor: paid, actionCostMinor };
  if (oracleContribution(economics) !== waterfall.contributionProfitMinor - actionCostMinor) throw new RangeError("oracle/accounting mismatch");
  return { economics, coverage: "booked_product_costs_no_returns_no_clv_no_overhead" };
}
