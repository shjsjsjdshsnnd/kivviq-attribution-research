import type { MarketingChannel } from "../generation/config.js";
import type { Intervention } from "../ground_truth/interventions.js";
import {
  buildPlatformChannelReport,
} from "../advertising_economics/platform.js";
import {
  evaluateMarginalTruePerformance,
  referenceSpendMinor,
} from "../advertising_economics/evaluator.js";
import {
  isPaidMarketingChannel,
  type PaidMarketingChannel,
} from "../advertising_economics/types.js";
import { simulateWorld } from "../simulation/simulator.js";
import type {
  SimulationResult,
} from "../simulation/types.js";
import type {
  ChannelRemovalEvaluation,
  HorizonEvaluation,
  InteractionDecomposition,
  PairwiseInteractionValue,
  PortfolioDelta,
  PortfolioEvaluation,
  PortfolioEvaluationRequest,
  PortfolioOutcome,
  ReallocationEvaluation,
  SourceMetricDelta,
  SourceMetricSnapshot,
} from "./types.js";

export class CrossChannelEvaluationError extends Error {}

function referenceIntensityMinor(
  request: PortfolioEvaluationRequest,
  channel: MarketingChannel,
): number {
  if (isPaidMarketingChannel(channel)) {
    return referenceSpendMinor(
      request.merchantWorld,
      channel,
    );
  }

  const mechanism =
    request.merchantWorld.manifest.channelIncrementality.find(
      (candidate) => candidate.channelId === channel,
    );
  const curve = mechanism?.responseCurveId
    ? request.merchantWorld.manifest.responseCurves.find(
        (candidate) =>
          candidate.id === mechanism.responseCurveId,
      )
    : undefined;

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
      Number(curve.maxSpend ?? 100_000),
    );
  }
  if (curve?.kind === "piecewise") {
    const point = curve.points.find(
      (candidate) => Number(candidate.spend) > 0,
    );
    if (point) return Math.max(1, Number(point.spend));
  }

  return Math.max(
    1,
    Math.round(
      (request.merchantWorld.summary.annualRevenuePotentialMinor *
        request.merchantWorld.summary.marketingSpendRate) /
        12 /
        Math.max(
          1,
          request.merchantWorld.summary.activeChannels.length,
        ),
    ),
  );
}

export function normalizedPortfolioSpend(
  request: PortfolioEvaluationRequest,
): Readonly<Record<MarketingChannel, number>> {
  const values = {} as Record<MarketingChannel, number>;

  for (const channel of request.merchantWorld.summary.activeChannels) {
    values[channel] =
      request.spendMinorByChannel[channel] ??
      referenceIntensityMinor(request, channel);
  }

  return values;
}

function spendInterventions(
  spend: Readonly<Record<MarketingChannel, number>>,
): readonly Intervention[] {
  return Object.entries(spend).map(
    ([channel, value]): Intervention => ({
      variable: `marketing.${channel}.spend`,
      operation: "set",
      value: {
        kind: "number",
        value: Math.max(0, value),
        unit: "money_minor",
      },
    }),
  );
}

function explicitPortfolioSpendMinor(
  spend: Readonly<Record<MarketingChannel, number>>,
): number {
  return Object.values(spend).reduce(
    (sum, value) => sum + value,
    0,
  );
}

function representedPreMarketingContributionMinor(
  result: SimulationResult,
  request: PortfolioEvaluationRequest,
): number {
  const weights = new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );

  return result.purchases.reduce((sum, purchase) => {
    const weight = weights.get(purchase.customerId) ?? 1;
    const beforeMarketing =
      purchase.netRevenueMinor -
      purchase.estimatedCogsMinor -
      purchase.paymentFeeMinor -
      purchase.shippingSubsidyMinor -
      purchase.fulfillmentMinor;
    return sum + beforeMarketing * weight;
  }, 0);
}

function weightedNewCustomers(
  result: SimulationResult,
  request: PortfolioEvaluationRequest,
): number {
  const weights = new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );

  return result.purchases
    .filter((purchase) => !purchase.repeatPurchase)
    .reduce(
      (sum, purchase) =>
        sum + (weights.get(purchase.customerId) ?? 1),
      0,
    );
}

function sourceMetrics(
  result: SimulationResult,
): readonly SourceMetricSnapshot[] {
  return result.platformMetrics.map((metric) => ({
    source: metric.channel,
    sessions: metric.sessions,
    purchases: metric.purchases,
    attributedRevenueMinor: metric.attributedRevenueMinor,
  }));
}

function futureAudienceFromSimulation(
  result: SimulationResult,
  request: PortfolioEvaluationRequest,
) {
  const weights = new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );

  let retargeting = 0;
  let email = 0;
  let branded = 0;
  let visitors = 0;

  for (const state of result.godMode.customerFinalStates) {
    const weight = weights.get(state.customerId) ?? 1;
    retargeting +=
      state.finalRetargetingEligibility * weight;
    email += state.finalEmailEligibility * weight;
    branded +=
      state.finalBrandedSearchReadiness * weight;
    visitors +=
      state.finalRecentSiteVisitScore * weight;
  }

  return {
    representedRetargetingEligible: retargeting,
    representedEmailEligible: email,
    representedBrandedSearchReady: branded,
    representedRecentVisitors: visitors,
  };
}

function platformAttributedRevenue(
  result: SimulationResult,
  request: PortfolioEvaluationRequest,
  spend: Readonly<Record<MarketingChannel, number>>,
): number {
  let total = 0;

  for (const channel of request.merchantWorld.summary.activeChannels) {
    if (!isPaidMarketingChannel(channel)) continue;
    total += buildPlatformChannelReport(
      result,
      request.latentPopulation,
      channel,
      spend[channel] ?? 0,
    ).attributedRevenueMinor;
  }

  return total;
}

export function evaluatePortfolio(
  request: PortfolioEvaluationRequest,
): PortfolioEvaluation {
  const spend = normalizedPortfolioSpend(request);
  const interventions = [
    ...spendInterventions(spend),
    ...(request.contextInterventions ?? []),
  ];

  const simulation = simulateWorld({
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    startTime: request.periodStart,
    endTime: request.periodEnd,
    interventions,
    ...(request.simulationConfig === undefined
      ? {}
      : { config: request.simulationConfig }),
  });

  const outcome: PortfolioOutcome = {
    representedOrders: simulation.totals.representedOrders,
    representedRevenueMinor:
      simulation.totals.representedRevenueMinor,
    representedContributionProfitMinor:
      representedPreMarketingContributionMinor(
        simulation,
        request,
      ) -
      explicitPortfolioSpendMinor(spend),
    representedNewCustomers:
      weightedNewCustomers(simulation, request),
    platformAttributedRevenueMinor:
      platformAttributedRevenue(
        simulation,
        request,
        spend,
      ),
    sourceMetrics: sourceMetrics(simulation),
    futureAudience: futureAudienceFromSimulation(
      simulation,
      request,
    ),
  };

  return {
    request: {
      ...request,
      spendMinorByChannel: spend,
    },
    simulation,
    outcome,
  };
}

function metricMap(
  metrics: readonly SourceMetricSnapshot[],
): ReadonlyMap<string, SourceMetricSnapshot> {
  return new Map(
    metrics.map((metric) => [metric.source, metric] as const),
  );
}

function sourceMetricDelta(
  counterfactual: readonly SourceMetricSnapshot[],
  factual: readonly SourceMetricSnapshot[],
): readonly SourceMetricDelta[] {
  const left = metricMap(counterfactual);
  const right = metricMap(factual);
  const sources = new Set([
    ...left.keys(),
    ...right.keys(),
  ]);

  return [...sources]
    .sort()
    .map((source) => {
      const a = left.get(source);
      const b = right.get(source);
      return {
        source,
        sessionsDelta:
          (a?.sessions ?? 0) - (b?.sessions ?? 0),
        purchasesDelta:
          (a?.purchases ?? 0) - (b?.purchases ?? 0),
        attributedRevenueMinorDelta:
          (a?.attributedRevenueMinor ?? 0) -
          (b?.attributedRevenueMinor ?? 0),
      };
    });
}

/**
 * Delta semantics are always counterfactual minus factual.
 */
export function portfolioDelta(
  counterfactual: PortfolioOutcome,
  factual: PortfolioOutcome,
): PortfolioDelta {
  return {
    representedOrders:
      counterfactual.representedOrders -
      factual.representedOrders,
    representedRevenueMinor:
      counterfactual.representedRevenueMinor -
      factual.representedRevenueMinor,
    representedContributionProfitMinor:
      counterfactual.representedContributionProfitMinor -
      factual.representedContributionProfitMinor,
    representedNewCustomers:
      counterfactual.representedNewCustomers -
      factual.representedNewCustomers,
    platformAttributedRevenueMinor:
      counterfactual.platformAttributedRevenueMinor -
      factual.platformAttributedRevenueMinor,
    sourceMetrics: sourceMetricDelta(
      counterfactual.sourceMetrics,
      factual.sourceMetrics,
    ),
    futureAudience: {
      representedRetargetingEligible:
        counterfactual.futureAudience
          .representedRetargetingEligible -
        factual.futureAudience
          .representedRetargetingEligible,
      representedEmailEligible:
        counterfactual.futureAudience
          .representedEmailEligible -
        factual.futureAudience
          .representedEmailEligible,
      representedBrandedSearchReady:
        counterfactual.futureAudience
          .representedBrandedSearchReady -
        factual.futureAudience
          .representedBrandedSearchReady,
      representedRecentVisitors:
        counterfactual.futureAudience
          .representedRecentVisitors -
        factual.futureAudience
          .representedRecentVisitors,
    },
  };
}

function requestWithSpend(
  request: PortfolioEvaluationRequest,
  spend: Readonly<
    Partial<Record<MarketingChannel, number>>
  >,
  endOverride?: string,
): PortfolioEvaluationRequest {
  return {
    ...request,
    spendMinorByChannel: spend,
    ...(endOverride === undefined
      ? {}
      : { periodEnd: endOverride }),
  };
}

export function evaluateChannelRemoval(
  request: PortfolioEvaluationRequest,
  channel: MarketingChannel,
): ChannelRemovalEvaluation {
  const baselineSpend = normalizedPortfolioSpend(request);
  const factual = evaluatePortfolio(
    requestWithSpend(request, baselineSpend),
  );
  const removedSpend = {
    ...baselineSpend,
    [channel]: 0,
  };
  const removed = evaluatePortfolio(
    requestWithSpend(request, removedSpend),
  );

  return {
    channel,
    factual,
    removed,
    delta: portfolioDelta(
      removed.outcome,
      factual.outcome,
    ),
  };
}

export function evaluateReallocation(
  request: PortfolioEvaluationRequest,
  spendDeltaByChannel: Readonly<
    Partial<Record<MarketingChannel, number>>
  >,
): ReallocationEvaluation {
  const baselineSpend = normalizedPortfolioSpend(request);
  const changed = { ...baselineSpend };

  for (const [channel, delta] of Object.entries(
    spendDeltaByChannel,
  )) {
    if (delta === undefined) continue;
    const current =
      changed[channel as MarketingChannel] ?? 0;
    changed[channel as MarketingChannel] = Math.max(
      0,
      current + delta,
    );
  }

  const factual = evaluatePortfolio(
    requestWithSpend(request, baselineSpend),
  );
  const reallocated = evaluatePortfolio(
    requestWithSpend(request, changed),
  );

  return {
    factual,
    reallocated,
    delta: portfolioDelta(
      reallocated.outcome,
      factual.outcome,
    ),
    spendDeltaByChannel,
  };
}

function endAfterDays(
  start: string,
  days: number,
): string {
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs) || days <= 0) {
    throw new CrossChannelEvaluationError(
      "invalid horizon",
    );
  }
  return new Date(
    startMs + days * 86_400_000,
  ).toISOString();
}

export function evaluateReallocationAcrossHorizons(
  request: PortfolioEvaluationRequest,
  spendDeltaByChannel: Readonly<
    Partial<Record<MarketingChannel, number>>
  >,
  horizonsDays: readonly number[],
): readonly HorizonEvaluation[] {
  const originalDurationDays = Math.max(
    1,
    (Date.parse(request.periodEnd) -
      Date.parse(request.periodStart)) /
      86_400_000,
  );
  const baseline = normalizedPortfolioSpend(request);

  return horizonsDays.map((horizonDays) => {
    const scale = horizonDays / originalDurationDays;
    const scaledBaseline = Object.fromEntries(
      Object.entries(baseline).map(([channel, spend]) => [
        channel,
        spend * scale,
      ]),
    ) as Partial<Record<MarketingChannel, number>>;
    const scaledDelta = Object.fromEntries(
      Object.entries(spendDeltaByChannel).map(
        ([channel, delta]) => [
          channel,
          (delta ?? 0) * scale,
        ],
      ),
    ) as Partial<Record<MarketingChannel, number>>;

    return {
      horizonDays,
      evaluation: evaluateReallocation(
        requestWithSpend(
          request,
          scaledBaseline,
          endAfterDays(request.periodStart, horizonDays),
        ),
        scaledDelta,
      ),
    };
  });
}

export function evaluatePairwiseInteraction(
  request: PortfolioEvaluationRequest,
  left: MarketingChannel,
  right: MarketingChannel,
): PairwiseInteractionValue {
  if (left === right) {
    throw new CrossChannelEvaluationError(
      "pairwise interaction requires distinct channels",
    );
  }

  const baseline = normalizedPortfolioSpend(request);
  const leftSpend = baseline[left] ?? 0;
  const rightSpend = baseline[right] ?? 0;

  const neither = evaluatePortfolio(
    requestWithSpend(request, {
      ...baseline,
      [left]: 0,
      [right]: 0,
    }),
  ).outcome;

  const leftOnly = evaluatePortfolio(
    requestWithSpend(request, {
      ...baseline,
      [left]: leftSpend,
      [right]: 0,
    }),
  ).outcome;

  const rightOnly = evaluatePortfolio(
    requestWithSpend(request, {
      ...baseline,
      [left]: 0,
      [right]: rightSpend,
    }),
  ).outcome;

  const both = evaluatePortfolio(
    requestWithSpend(request, baseline),
  ).outcome;

  return {
    left,
    right,
    neither,
    leftOnly,
    rightOnly,
    both,
    interactionRevenueMinor:
      both.representedRevenueMinor -
      leftOnly.representedRevenueMinor -
      rightOnly.representedRevenueMinor +
      neither.representedRevenueMinor,
    interactionOrders:
      both.representedOrders -
      leftOnly.representedOrders -
      rightOnly.representedOrders +
      neither.representedOrders,
    interactionContributionProfitMinor:
      both.representedContributionProfitMinor -
      leftOnly.representedContributionProfitMinor -
      rightOnly.representedContributionProfitMinor +
      neither.representedContributionProfitMinor,
    interactionNewCustomers:
      both.representedNewCustomers -
      leftOnly.representedNewCustomers -
      rightOnly.representedNewCustomers +
      neither.representedNewCustomers,
  };
}

function attributedRevenueForSource(
  outcome: PortfolioOutcome,
  source: string,
): number {
  return (
    outcome.sourceMetrics.find(
      (metric) => metric.source === source,
    )?.attributedRevenueMinor ?? 0
  );
}

export function decomposePairwiseInteraction(
  pair: PairwiseInteractionValue,
  observedMediatedSource: string,
): InteractionDecomposition {
  return {
    directLeftRevenueMinor:
      pair.leftOnly.representedRevenueMinor -
      pair.neither.representedRevenueMinor,
    directRightRevenueMinor:
      pair.rightOnly.representedRevenueMinor -
      pair.neither.representedRevenueMinor,
    interactionRevenueMinor:
      pair.interactionRevenueMinor,
    totalJointRevenueMinor:
      pair.both.representedRevenueMinor -
      pair.neither.representedRevenueMinor,
    observedMediatedRevenueShiftMinor:
      attributedRevenueForSource(
        pair.both,
        observedMediatedSource,
      ) -
      attributedRevenueForSource(
        pair.rightOnly,
        observedMediatedSource,
      ),
  };
}

export function evaluatePortfolioSurface(
  request: PortfolioEvaluationRequest,
  allocations: readonly Readonly<
    Partial<Record<MarketingChannel, number>>
  >[],
): readonly PortfolioEvaluation[] {
  return allocations.map((allocation) =>
    evaluatePortfolio(
      requestWithSpend(
        request,
        allocation,
      ),
    ),
  );
}

export function conditionalMarginalIroas(
  request: PortfolioEvaluationRequest,
  targetChannel: PaidMarketingChannel,
  conditioningChannel: MarketingChannel,
  conditioningSpendMinor: number,
  blockMinor: number,
): number | null {
  const spend = {
    ...normalizedPortfolioSpend(request),
    [conditioningChannel]:
      conditioningSpendMinor,
  };

  return evaluateMarginalTruePerformance(
    {
      merchantWorld: request.merchantWorld,
      latentPopulation: request.latentPopulation,
      simulationSeed: request.simulationSeed,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd,
      spendMinorByChannel: Object.fromEntries(
        Object.entries(spend).filter(
          ([channel]) =>
            isPaidMarketingChannel(channel),
        ),
      ),
      ...(request.contextInterventions === undefined
        ? {}
        : {
            contextInterventions:
              request.contextInterventions,
          }),
      ...(request.simulationConfig === undefined
        ? {}
        : {
            simulationConfig:
              request.simulationConfig,
          }),
    },
    targetChannel,
    blockMinor,
  ).trueIncrementalRoas;
}
