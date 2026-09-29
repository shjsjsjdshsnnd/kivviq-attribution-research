import type { SimulateWorldRequest, SimulationResult } from "../simulation/types.js";
import { buildProductEconomicProfiles, resolveEcommercePolicy } from "../ecommerce_economics/products.js";
import { buildOrderEconomics, aggregatePeriodWaterfall } from "../ecommerce_economics/waterfall.js";
import { observationTimeSchema } from "../observation/corrupted-world.js";
import { oracleContribution, type OracleEconomics } from "./finite-decision-oracle.js";
import { requestWithScheduledSpend, scheduledSpendLedger, validateScheduledSpend } from "./scheduled-spend.js";
import { sha256 } from "./replay-manifest.js";

export const SCHEDULED_ECONOMICS_VERSION = "scheduled-booked-economics/1.0.0" as const;
/**
 * Narrow evaluator ledger. No returns/CLV/overhead or predicted value is silently
 * labelled as booked contribution. Costs include all paid channels and nonbuyers.
 * Only completed daily expense buckets and orders through asOf are recognized.
 */
export function scheduledBookedEconomics(request: SimulateWorldRequest, result: SimulationResult,
  rawPlan: unknown, asOf = request.endTime, actionCostMinor = 0) {
  const plan = validateScheduledSpend(rawPlan);
  observationTimeSchema.parse(asOf);
  const cutoff = Date.parse(asOf), start = Date.parse(request.startTime), end = Date.parse(request.endTime);
  if (cutoff < start || cutoff > end || !Number.isSafeInteger(actionCostMinor) || actionCostMinor < 0) throw new RangeError("invalid scheduled economic cutoff or action cost");
  if (result.provenance.merchantWorldId !== request.merchantWorld.manifest.worldId ||
      result.provenance.simulationSeed !== request.simulationSeed ||
      result.provenance.startTime !== request.startTime || result.provenance.endTime !== request.endTime ||
      sha256(result.provenance.interventions) !== sha256(request.interventions ?? [])) throw new RangeError("scheduled economic result/provenance mismatch");
  const initial = { ...request, interventions: (request.interventions ?? []).filter(i => !/^marketing\..*\.spend$/.test(i.variable)) };
  const expected = requestWithScheduledSpend(initial, plan);
  if (sha256(expected.interventions) !== sha256(request.interventions)) throw new RangeError("scheduled economic rate and simulated budget history differ");
  const policy = request.commercePolicy;
  if (policy?.pricingPromotionScenario || policy?.retentionScenario || policy?.externalRealityEnvironment ||
      policy?.executeInventoryLifecycle || policy?.enableInventoryDynamics ||
      (policy?.customerShippingChargeMinor ?? 0) !== 0) throw new RangeError("scheduled booked adapter does not cover enabled economics");
  const profiles = new Map(buildProductEconomicProfiles(request.merchantWorld).map(p => [p.productId, p]));
  const economicPolicy = resolveEcommercePolicy(request.merchantWorld, { customerShippingChargeMinor: 0,
    giftWithPurchaseCostMinor: 0, loyaltyCreditRate: 0, couponOperationalCostMinor: 0 });
  const purchases = result.purchases.filter(p => Date.parse(p.occurredAt) <= cutoff && Date.parse(p.occurredAt) < end);
  const orders = purchases.map(p => buildOrderEconomics(request.merchantWorld, p, economicPolicy, profiles));
  const debits = scheduledSpendLedger(plan).filter(r => Date.parse(r.occurredAt) <= cutoff);
  const paid = debits.reduce((sum, r) => sum + r.amountMinor, 0);
  const waterfall = aggregatePeriodWaterfall(request.merchantWorld, orders, paid);
  if (waterfall.netRevenueMinor !== purchases.reduce((sum, p) => sum + p.netRevenueMinor, 0) ||
      waterfall.customerShippingRevenueMinor !== 0 || waterfall.returnsRefundsMinor !== 0) throw new RangeError("scheduled booked orders do not reconcile");
  const economics: OracleEconomics = { netSalesMinor: waterfall.netRevenueMinor, cogsMinor: waterfall.cogsMinor,
    paymentFeesMinor: waterfall.paymentFeesMinor, fulfillmentMinor: waterfall.fulfillmentCostMinor,
    shippingCostMinor: waterfall.merchantShippingCostMinor,
    variableOperatingCostMinor: waterfall.variableOperatingCostsMinor + waterfall.promotionalCostsMinor,
    paidSpendMinor: paid, actionCostMinor };
  const contributionMinor = oracleContribution(economics);
  if (contributionMinor !== waterfall.contributionProfitMinor - actionCostMinor) throw new RangeError("scheduled contribution reconciliation failed");
  return { access: "evaluator_only" as const, version: SCHEDULED_ECONOMICS_VERSION,
    scope: "explicit_agents_booked_contribution_closed_daily_expenses" as const,
    coverage: "no_returns_no_clv_no_overhead" as const, asOf,
    currency: request.merchantWorld.manifest.merchant.currency, orders: purchases.length,
    economics, contributionMinor };
}
