import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { Intervention } from "../ground_truth/interventions.js";
import { simulateWorld } from "../simulation/simulator.js";
import type {
  SimulationConfig,
  SimulationResult,
} from "../simulation/types.js";
import {
  audienceCompositionAtSpend,
  deliveryAtSpend,
  deliveryProfileForChannel,
} from "./delivery.js";
import {
  buildPlatformChannelReport,
  observedTouchPerformance,
} from "./platform.js";
import type {
  AdvertisingAllocation,
  AdvertisingEvaluationRequest,
  AdvertisingPerformanceReport,
  AdvertisingPerformanceRow,
  MarginalIncrementalPerformance,
  PaidMarketingChannel,
  SpendCounterfactualPair,
  TrueIncrementalPerformance,
} from "./types.js";
import {
  ADVERTISING_ECONOMICS_VERSION,
  isPaidMarketingChannel,
} from "./types.js";

function responseCurveForChannel(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
) {
  const mechanism =
    world.manifest.channelIncrementality.find(
      (candidate) => candidate.channelId === channel,
    );
  if (!mechanism?.responseCurveId) return undefined;
  return world.manifest.responseCurves.find(
    (curve) => curve.id === mechanism.responseCurveId,
  );
}

export function referenceSpendMinor(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
): number {
  const curve = responseCurveForChannel(world, channel);

  if (curve?.kind === "hill") {
    return Math.max(
      1,
      Number(curve.halfSaturationSpend),
    );
  }

  if (curve?.kind === "threshold") {
    return Math.max(
      1,
      Number(curve.thresholdSpend),
    );
  }

  if (curve?.kind === "linear") {
    return Math.max(
      1,
      Number(
        curve.maxSpend ??
          Math.round(
            (world.summary.annualRevenuePotentialMinor *
              world.summary.marketingSpendRate) /
              12 /
              Math.max(
                1,
                world.summary.activeChannels.length,
              ),
          ),
      ),
    );
  }

  if (curve?.kind === "piecewise") {
    const positive = curve.points.find(
      (point) => Number(point.spend) > 0,
    );
    if (positive) {
      return Math.max(1, Number(positive.spend));
    }
  }

  return Math.max(
    1,
    Math.round(
      (world.summary.annualRevenuePotentialMinor *
        world.summary.marketingSpendRate) /
        12 /
        Math.max(
          1,
          world.summary.activeChannels.length,
        ),
    ),
  );
}

export function defaultAdvertisingAllocation(
  world: GeneratedMerchantWorld,
  periodStart: string,
  periodEnd: string,
): AdvertisingAllocation {
  const spendMinorByChannel: Partial<
    Record<PaidMarketingChannel, number>
  > = {};

  for (const channel of world.summary.activeChannels) {
    if (!isPaidMarketingChannel(channel)) continue;
    spendMinorByChannel[channel] =
      referenceSpendMinor(world, channel);
  }

  return {
    spendMinorByChannel,
    periodStart,
    periodEnd,
  };
}

function mergedAllocation(
  request: AdvertisingEvaluationRequest,
): AdvertisingAllocation {
  const base = defaultAdvertisingAllocation(
    request.merchantWorld,
    request.periodStart,
    request.periodEnd,
  );

  return {
    ...base,
    spendMinorByChannel: {
      ...base.spendMinorByChannel,
      ...(request.spendMinorByChannel ?? {}),
    },
  };
}

function spendInterventions(
  allocation: AdvertisingAllocation,
): readonly Intervention[] {
  return Object.entries(
    allocation.spendMinorByChannel,
  )
    .filter(
      (
        entry,
      ): entry is [
        PaidMarketingChannel,
        number,
      ] => entry[1] !== undefined,
    )
    .map(([channel, spendMinor]) => ({
      variable: `marketing.${channel}.spend`,
      operation: "set" as const,
      value: {
        kind: "number" as const,
        value: Math.max(0, spendMinor),
        unit: "money_minor" as const,
      },
    }));
}

function simulateAllocation(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
  simulationSeed: number,
  allocation: AdvertisingAllocation,
  config?: SimulationConfig,
  contextInterventions: readonly Intervention[] = [],
): SimulationResult {
  return simulateWorld({
    merchantWorld: world,
    latentPopulation: population,
    simulationSeed,
    startTime: allocation.periodStart,
    endTime: allocation.periodEnd,
    interventions: [
      ...spendInterventions(allocation),
      ...contextInterventions,
    ],
    ...(config === undefined ? {} : { config }),
  });
}

function totalAllocationSpendMinor(
  allocation: AdvertisingAllocation,
): number {
  return Object.values(
    allocation.spendMinorByChannel,
  ).reduce(
    (sum, spend) => sum + (spend ?? 0),
    0,
  );
}

function populationWeights(
  population: LatentCustomerPopulation,
): ReadonlyMap<string, number> {
  return new Map(
    population.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
}

interface EconomicTotals {
  readonly representedOrders: number;
  readonly representedNewCustomers: number;
  readonly representedGrossRevenueMinor: number;
  readonly representedRevenueMinor: number;
  readonly representedGrossProfitMinor: number;
  readonly preMarketingContributionMinor: number;
  readonly afterAdvertisingContributionMinor: number;
}

function economicTotals(
  result: SimulationResult,
  population: LatentCustomerPopulation,
  allocation: AdvertisingAllocation,
): EconomicTotals {
  const weights = populationWeights(population);
  let orders = 0;
  let newCustomers = 0;
  let grossRevenue = 0;
  let revenue = 0;
  let grossProfit = 0;
  let preMarketingContribution = 0;

  for (const purchase of result.purchases) {
    const weight =
      weights.get(purchase.customerId) ?? 1;
    orders += weight;
    if (!purchase.repeatPurchase) {
      newCustomers += weight;
    }
    grossRevenue += purchase.grossRevenueMinor * weight;
    revenue += purchase.netRevenueMinor * weight;
    grossProfit +=
      (purchase.netRevenueMinor -
        purchase.estimatedCogsMinor) *
      weight;

    const beforeMarketing =
      purchase.netRevenueMinor -
      purchase.estimatedCogsMinor -
      purchase.paymentFeeMinor -
      purchase.shippingSubsidyMinor -
      purchase.fulfillmentMinor;

    preMarketingContribution +=
      beforeMarketing * weight;
  }

  return {
    representedOrders: orders,
    representedNewCustomers: newCustomers,
    representedGrossRevenueMinor: grossRevenue,
    representedRevenueMinor: revenue,
    representedGrossProfitMinor: grossProfit,
    preMarketingContributionMinor:
      preMarketingContribution,
    afterAdvertisingContributionMinor:
      preMarketingContribution -
      totalAllocationSpendMinor(allocation),
  };
}

function allocationWithSpend(
  base: AdvertisingAllocation,
  channel: PaidMarketingChannel,
  spendMinor: number,
): AdvertisingAllocation {
  return {
    ...base,
    spendMinorByChannel: {
      ...base.spendMinorByChannel,
      [channel]: Math.max(0, spendMinor),
    },
  };
}

export function evaluateSpendPair(
  request: AdvertisingEvaluationRequest,
  channel: PaidMarketingChannel,
  highSpendMinor: number,
  lowSpendMinor: number,
  highSimulation?: SimulationResult,
): {
  readonly pair: SpendCounterfactualPair;
  readonly performance: TrueIncrementalPerformance;
} {
  if (
    !Number.isFinite(highSpendMinor) ||
    !Number.isFinite(lowSpendMinor) ||
    highSpendMinor < lowSpendMinor ||
    lowSpendMinor < 0
  ) {
    throw new RangeError(
      "spend pair must be finite with high >= low >= 0",
    );
  }

  const base = mergedAllocation(request);
  const highAllocation = allocationWithSpend(
    base,
    channel,
    highSpendMinor,
  );
  const lowAllocation = allocationWithSpend(
    base,
    channel,
    lowSpendMinor,
  );

  const high =
    highSimulation ??
    simulateAllocation(
      request.merchantWorld,
      request.latentPopulation,
      request.simulationSeed,
      highAllocation,
      request.simulationConfig,
      request.contextInterventions ?? [],
    );

  const low = simulateAllocation(
    request.merchantWorld,
    request.latentPopulation,
    request.simulationSeed,
    lowAllocation,
    request.simulationConfig,
    request.contextInterventions ?? [],
  );

  const highEconomics = economicTotals(
    high,
    request.latentPopulation,
    highAllocation,
  );
  const lowEconomics = economicTotals(
    low,
    request.latentPopulation,
    lowAllocation,
  );

  const incrementalSpend =
    highSpendMinor - lowSpendMinor;
  const incrementalGrossRevenue =
    highEconomics.representedGrossRevenueMinor -
    lowEconomics.representedGrossRevenueMinor;
  const incrementalRevenue =
    highEconomics.representedRevenueMinor -
    lowEconomics.representedRevenueMinor;
  const incrementalGrossProfit =
    highEconomics.representedGrossProfitMinor -
    lowEconomics.representedGrossProfitMinor;
  const incrementalOrders =
    highEconomics.representedOrders -
    lowEconomics.representedOrders;
  const incrementalCustomers =
    highEconomics.representedNewCustomers -
    lowEconomics.representedNewCustomers;
  const incrementalContribution =
    highEconomics.afterAdvertisingContributionMinor -
    lowEconomics.afterAdvertisingContributionMinor;

  const performance: TrueIncrementalPerformance = {
    channel,
    highSpendMinor,
    lowSpendMinor,
    incrementalSpendMinor: incrementalSpend,
    incrementalOrders,
    incrementalGrossRevenueMinor: incrementalGrossRevenue,
    incrementalRevenueMinor: incrementalRevenue,
    incrementalGrossProfitMinor: incrementalGrossProfit,
    incrementalContributionProfitMinor:
      incrementalContribution,
    trueIncrementalRoas:
      incrementalSpend > 0
        ? incrementalRevenue / incrementalSpend
        : null,
    incrementalCacMinor:
      incrementalCustomers > 0 &&
      incrementalSpend > 0
        ? incrementalSpend / incrementalCustomers
        : null,
  };

  return {
    pair: {
      high,
      low,
      highSpendMinor,
      lowSpendMinor,
      totalHighAllocationSpendMinor:
        totalAllocationSpendMinor(highAllocation),
      totalLowAllocationSpendMinor:
        totalAllocationSpendMinor(lowAllocation),
    },
    performance,
  };
}

export function evaluateAverageTruePerformance(
  request: AdvertisingEvaluationRequest,
  channel: PaidMarketingChannel,
  currentSimulation?: SimulationResult,
): TrueIncrementalPerformance {
  const allocation = mergedAllocation(request);
  const currentSpend =
    allocation.spendMinorByChannel[channel] ?? 0;

  return evaluateSpendPair(
    request,
    channel,
    currentSpend,
    0,
    currentSimulation,
  ).performance;
}

export function evaluateMarginalTruePerformance(
  request: AdvertisingEvaluationRequest,
  channel: PaidMarketingChannel,
  marginalBlockMinor: number,
  currentSimulation?: SimulationResult,
): MarginalIncrementalPerformance {
  if (
    !Number.isFinite(marginalBlockMinor) ||
    marginalBlockMinor <= 0
  ) {
    throw new RangeError(
      "marginal block must be finite and positive",
    );
  }

  const allocation = mergedAllocation(request);
  const currentSpend =
    allocation.spendMinorByChannel[channel] ?? 0;
  const lowSpend = Math.max(
    0,
    currentSpend - marginalBlockMinor,
  );

  const result = evaluateSpendPair(
    request,
    channel,
    currentSpend,
    lowSpend,
    currentSimulation,
  ).performance;

  return {
    ...result,
    referenceSpendMinor: currentSpend,
    evaluatedBlockMinor:
      currentSpend - lowSpend,
  };
}

function activePaidChannels(
  world: GeneratedMerchantWorld,
): readonly PaidMarketingChannel[] {
  return world.summary.activeChannels.filter(
    isPaidMarketingChannel,
  );
}

export function buildAdvertisingPerformanceReport(
  request: AdvertisingEvaluationRequest,
): AdvertisingPerformanceReport {
  const allocation = mergedAllocation(request);
  const simulation = simulateAllocation(
    request.merchantWorld,
    request.latentPopulation,
    request.simulationSeed,
    allocation,
    request.simulationConfig,
    request.contextInterventions ?? [],
  );

  const rows: AdvertisingPerformanceRow[] = [];
  const marginalBlock = Math.max(
    1,
    request.marginalBlockMinor ?? 100_000,
  );

  for (const channel of activePaidChannels(
    request.merchantWorld,
  )) {
    const spend =
      allocation.spendMinorByChannel[channel] ?? 0;
    const profile = deliveryProfileForChannel(
      request.merchantWorld,
      channel,
    );
    const delivery = deliveryAtSpend(
      request.merchantWorld,
      request.latentPopulation,
      profile,
      spend,
    );
    const audience = audienceCompositionAtSpend(
      request.latentPopulation,
      channel,
      delivery,
    );
    const platform =
      buildPlatformChannelReport(
        simulation,
        request.latentPopulation,
        channel,
        spend,
      );
    const observed =
      observedTouchPerformance(
        simulation,
        request.latentPopulation,
        channel,
        spend,
      );
    const average =
      evaluateAverageTruePerformance(
        request,
        channel,
        simulation,
      );
    const marginal =
      evaluateMarginalTruePerformance(
        request,
        channel,
        marginalBlock,
        simulation,
      );

    rows.push({
      channel,
      spendMinor: spend,
      delivery,
      audience,
      platformAttributedRevenueMinor:
        platform.attributedRevenueMinor,
      platformRoas: platform.reportedRoas,
      platformReportedCacMinor:
        platform.reportedCacMinor,
      observedTouchRevenueMinor:
        observed.touchAssociatedRevenueMinor,
      observedRoas: observed.observedRoas,
      observedCacMinor: observed.observedCacMinor,
      trueIncrementalGrossRevenueMinor:
        average.incrementalGrossRevenueMinor,
      trueIncrementalRevenueMinor:
        average.incrementalRevenueMinor,
      trueIncrementalGrossProfitMinor:
        average.incrementalGrossProfitMinor,
      trueIncrementalRoas:
        average.trueIncrementalRoas,
      marginalIncrementalRoas:
        marginal.trueIncrementalRoas,
      averageIncrementalCacMinor:
        average.incrementalCacMinor,
      marginalIncrementalCacMinor:
        marginal.incrementalCacMinor,
      incrementalContributionProfitMinor:
        average.incrementalContributionProfitMinor,
    });
  }

  const merchantRevenueMinor =
    economicTotals(
      simulation,
      request.latentPopulation,
      allocation,
    ).representedRevenueMinor;

  const totalPlatformAttributedRevenueMinor =
    rows.reduce(
      (sum, row) =>
        sum + row.platformAttributedRevenueMinor,
      0,
    );

  return {
    version: ADVERTISING_ECONOMICS_VERSION,
    allocation,
    rows,
    merchantRevenueMinor,
    totalPlatformAttributedRevenueMinor,
    duplicateClaimExcessRevenueMinor:
      Math.max(
        0,
        totalPlatformAttributedRevenueMinor -
          merchantRevenueMinor,
      ),
    simulation,
  };
}
