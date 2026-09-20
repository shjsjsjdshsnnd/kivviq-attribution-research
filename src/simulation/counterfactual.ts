import type { GeneratedMerchantWorld, MarketingChannel } from "../generation/config.js";
import type { Intervention } from "../ground_truth/interventions.js";
import { simulateWorld } from "./simulator.js";
import type {
  CounterfactualReplayRequest,
  CounterfactualReplayResult,
  SimulationResult,
} from "./types.js";

const PAID_CHANNELS = new Set<MarketingChannel>([
  "meta",
  "google_search",
  "google_shopping",
  "pinterest",
  "affiliate",
]);

export function zeroPaidSpendInterventions(
  world: GeneratedMerchantWorld,
): readonly Intervention[] {
  return world.summary.activeChannels
    .filter((channel) => PAID_CHANNELS.has(channel))
    .map(
      (channel): Intervention => ({
        variable: `marketing.${channel}.spend`,
        operation: "set",
        value: {
          kind: "number",
          value: 0,
          unit: "money_minor",
        },
      }),
    );
}

function purchasesByCustomer(
  result: SimulationResult,
): Map<string, { count: number; revenue: number }> {
  const map = new Map<string, { count: number; revenue: number }>();
  for (const purchase of result.purchases) {
    const current = map.get(purchase.customerId) ?? {
      count: 0,
      revenue: 0,
    };
    current.count += 1;
    current.revenue += purchase.netRevenueMinor;
    map.set(purchase.customerId, current);
  }
  return map;
}

export function replayCounterfactual(
  request: CounterfactualReplayRequest,
): CounterfactualReplayResult {
  const factual = simulateWorld({
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    startTime: request.startTime,
    endTime: request.endTime,
    config: request.config,
    interventions: [],
  });

  const counterfactual = simulateWorld({
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    startTime: request.startTime,
    endTime: request.endTime,
    config: request.config,
    interventions: request.interventions,
  });

  const factualByCustomer = purchasesByCustomer(factual);
  const counterfactualByCustomer = purchasesByCustomer(counterfactual);
  const customerIds = new Set([
    ...factualByCustomer.keys(),
    ...counterfactualByCustomer.keys(),
  ]);

  return {
    factual,
    counterfactual,
    delta: {
      representedOrders:
        factual.totals.representedOrders -
        counterfactual.totals.representedOrders,
      representedRevenueMinor:
        factual.totals.representedRevenueMinor -
        counterfactual.totals.representedRevenueMinor,
      representedContributionProfitMinor:
        factual.totals.representedContributionProfitMinor -
        counterfactual.totals.representedContributionProfitMinor,
    },
    individualPurchaseChanges: [...customerIds]
      .sort()
      .map((customerId) => {
        const left = factualByCustomer.get(customerId) ?? {
          count: 0,
          revenue: 0,
        };
        const right = counterfactualByCustomer.get(customerId) ?? {
          count: 0,
          revenue: 0,
        };
        return {
          customerId,
          factualPurchases: left.count,
          counterfactualPurchases: right.count,
          factualRevenueMinor: left.revenue,
          counterfactualRevenueMinor: right.revenue,
        };
      }),
  };
}

export function replayPaidMediaOff(
  request: Omit<CounterfactualReplayRequest, "interventions">,
): CounterfactualReplayResult {
  return replayCounterfactual({
    ...request,
    interventions: zeroPaidSpendInterventions(request.merchantWorld),
  });
}
