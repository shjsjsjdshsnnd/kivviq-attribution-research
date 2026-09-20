import type { ResponseCurve } from "../ground_truth/ontology.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import type {
  ChannelEconomicCurve,
  ChannelEconomicCurvePoint,
  PaidMarketingChannel,
  ResponseEvaluation,
} from "./types.js";

export class AdvertisingResponseError extends Error {}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function assertSpend(spendMinor: number): void {
  if (!Number.isFinite(spendMinor) || spendMinor < 0) {
    throw new AdvertisingResponseError(
      "spend must be finite and non-negative",
    );
  }
}

function piecewiseOutcome(
  curve: Extract<ResponseCurve, { kind: "piecewise" }>,
  spendMinor: number,
): number {
  const points = curve.points;
  if (points.length < 2) {
    throw new AdvertisingResponseError(
      "piecewise response curve requires at least two points",
    );
  }

  if (spendMinor <= Number(points[0]!.spend)) {
    const first = points[0]!;
    const second = points[1]!;
    const dx = Number(second.spend) - Number(first.spend);
    if (dx <= 0) return first.outcome;
    const slope = (second.outcome - first.outcome) / dx;
    return first.outcome +
      slope * (spendMinor - Number(first.spend));
  }

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    const leftSpend = Number(left.spend);
    const rightSpend = Number(right.spend);
    if (spendMinor <= rightSpend) {
      const fraction =
        (spendMinor - leftSpend) /
        Math.max(1, rightSpend - leftSpend);
      return left.outcome +
        fraction * (right.outcome - left.outcome);
    }
  }

  const left = points[points.length - 2]!;
  const right = points[points.length - 1]!;
  const dx = Number(right.spend) - Number(left.spend);
  if (dx <= 0) return right.outcome;
  const slope = (right.outcome - left.outcome) / dx;
  return right.outcome +
    slope * (spendMinor - Number(right.spend));
}

export function evaluateResponseCurve(
  curve: ResponseCurve,
  spendMinor: number,
): number {
  assertSpend(spendMinor);

  if (curve.kind === "linear") {
    const effectiveSpend =
      curve.maxSpend === undefined
        ? spendMinor
        : Math.min(spendMinor, Number(curve.maxSpend));
    return curve.slopePerMoneyMinor * effectiveSpend;
  }

  if (curve.kind === "hill") {
    if (spendMinor === 0) return 0;
    const h = Number(curve.hillCoefficient);
    const half = Number(curve.halfSaturationSpend);
    const numerator = Math.pow(spendMinor, h);
    const denominator = Math.pow(half, h) + numerator;
    return Number(curve.maxIncrementalOutcome) *
      (denominator === 0 ? 0 : numerator / denominator);
  }

  if (curve.kind === "threshold") {
    const threshold = Number(curve.thresholdSpend);
    const belowSpend = Math.min(spendMinor, threshold);
    const aboveSpend = Math.max(0, spendMinor - threshold);
    let outcome =
      belowSpend * curve.belowThresholdSlope +
      aboveSpend * curve.aboveThresholdSlope;

    if (curve.maximumOutcome !== undefined) {
      outcome = Math.min(
        outcome,
        Number(curve.maximumOutcome),
      );
    }
    return outcome;
  }

  return piecewiseOutcome(curve, spendMinor);
}

export function marginalResponsePerSpendMinor(
  curve: ResponseCurve,
  spendMinor: number,
  blockMinor: number,
): number | null {
  assertSpend(spendMinor);
  if (!Number.isFinite(blockMinor) || blockMinor <= 0) {
    throw new AdvertisingResponseError(
      "marginal block must be finite and positive",
    );
  }

  const low = Math.max(0, spendMinor - blockMinor / 2);
  const high = spendMinor + blockMinor / 2;
  const deltaSpend = high - low;
  if (deltaSpend <= 0) return null;

  const deltaOutcome =
    evaluateResponseCurve(curve, high) -
    evaluateResponseCurve(curve, low);

  return deltaOutcome / deltaSpend;
}

export function responseEvaluation(
  curve: ResponseCurve,
  spendMinor: number,
  marginalBlockMinor = 10_000,
): ResponseEvaluation {
  const totalOutcome = evaluateResponseCurve(curve, spendMinor);
  return {
    spendMinor,
    totalOutcome,
    averageOutcomePerSpendMinor:
      spendMinor > 0 ? totalOutcome / spendMinor : null,
    marginalOutcomePerSpendMinor:
      marginalResponsePerSpendMinor(
        curve,
        spendMinor,
        marginalBlockMinor,
      ),
  };
}

export function saturationSpendMinor(
  curve: ResponseCurve,
): number | null {
  if (curve.kind === "hill") {
    const h = Number(curve.hillCoefficient);
    const half = Number(curve.halfSaturationSpend);
    // 95% of asymptotic response.
    return Math.round(
      half * Math.pow(0.95 / 0.05, 1 / h),
    );
  }

  if (curve.kind === "threshold") {
    if (
      curve.maximumOutcome === undefined ||
      curve.aboveThresholdSlope <= 0
    ) {
      return null;
    }

    const threshold = Number(curve.thresholdSpend);
    const atThreshold =
      threshold * curve.belowThresholdSlope;
    const remaining =
      Number(curve.maximumOutcome) - atThreshold;
    if (remaining <= 0) return threshold;

    return Math.round(
      threshold + remaining / curve.aboveThresholdSlope,
    );
  }

  if (curve.kind === "linear") {
    return curve.maxSpend === undefined
      ? null
      : Number(curve.maxSpend);
  }

  for (let index = 1; index < curve.points.length; index += 1) {
    const left = curve.points[index - 1]!;
    const right = curve.points[index]!;
    const dx = Number(right.spend) - Number(left.spend);
    if (dx <= 0) continue;
    const slope = (right.outcome - left.outcome) / dx;
    if (slope <= 0) return Number(left.spend);
  }

  return null;
}

export function referenceResponseCurveForChannel(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
): ResponseCurve {
  const mechanism =
    world.manifest.channelIncrementality.find(
      (candidate) => candidate.channelId === channel,
    );
  if (!mechanism?.responseCurveId) {
    throw new AdvertisingResponseError(
      `channel ${channel} has no response curve`,
    );
  }
  const curve = world.manifest.responseCurves.find(
    (candidate) =>
      candidate.id === mechanism.responseCurveId,
  );
  if (!curve) {
    throw new AdvertisingResponseError(
      `unknown response curve ${mechanism.responseCurveId}`,
    );
  }
  return curve;
}

export function acquisitionResponseCurveForChannel(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
): ResponseCurve | undefined {
  const cac = world.manifest.cacMechanisms.find(
    (candidate) => candidate.channelId === channel,
  );
  if (!cac) return undefined;

  return world.manifest.responseCurves.find(
    (candidate) => candidate.id === cac.marginalCACCurveId,
  );
}

function preMarketingContributionRate(
  world: GeneratedMerchantWorld,
): number {
  return (
    world.summary.grossMarginRate -
    world.summary.expectedDiscountRate -
    world.summary.expectedReturnRate *
      world.summary.grossMarginRate -
    world.summary.paymentFeeRate -
    world.summary.shippingSubsidyRate -
    world.summary.fulfillmentRate
  );
}

export function breakEvenRevenueRoas(
  world: GeneratedMerchantWorld,
): number | null {
  const rate = preMarketingContributionRate(world);
  return rate > 0 ? 1 / rate : null;
}

export function buildAnalyticChannelEconomicCurve(
  world: GeneratedMerchantWorld,
  channel: PaidMarketingChannel,
  options: {
    readonly maxSpendMinor?: number;
    readonly stepMinor?: number;
    readonly marginalBlockMinor?: number;
  } = {},
): ChannelEconomicCurve {
  const responseCurve =
    referenceResponseCurveForChannel(world, channel);
  const acquisitionCurve =
    acquisitionResponseCurveForChannel(world, channel);

  const saturation =
    saturationSpendMinor(responseCurve);
  const defaultMax = Math.max(
    100_000,
    saturation ?? 0,
    world.summary.annualRevenuePotentialMinor *
      world.summary.marketingSpendRate /
      12 /
      Math.max(1, world.summary.activeChannels.length) *
      4,
  );

  const maxSpend = Math.max(
    1,
    Math.round(options.maxSpendMinor ?? defaultMax),
  );
  const step = Math.max(
    1,
    Math.round(
      options.stepMinor ??
        Math.max(5_000, maxSpend / 40),
    ),
  );
  const marginalBlock = Math.max(
    1,
    Math.round(
      options.marginalBlockMinor ?? step,
    ),
  );

  const preMarketingRate =
    preMarketingContributionRate(world);
  const expectedAov = Math.max(
    1,
    world.summary.expectedAovMinor,
  );

  const points: ChannelEconomicCurvePoint[] = [];
  let bestSpend: number | null = null;
  let bestContribution =
    Number.NEGATIVE_INFINITY;
  let maximumRationalSpend: number | null = null;

  for (
    let spend = 0;
    spend <= maxSpend;
    spend += step
  ) {
    const incrementalOrders =
      evaluateResponseCurve(responseCurve, spend);
    const incrementalRevenue =
      incrementalOrders * expectedAov;
    const incrementalContribution =
      incrementalRevenue * preMarketingRate - spend;

    const marginalOrdersPerMinor =
      marginalResponsePerSpendMinor(
        responseCurve,
        spend,
        marginalBlock,
      );
    const marginalRevenuePerMinor =
      marginalOrdersPerMinor === null
        ? null
        : marginalOrdersPerMinor * expectedAov;

    const acquisitionCustomers =
      acquisitionCurve === undefined
        ? null
        : evaluateResponseCurve(acquisitionCurve, spend);
    const marginalCustomersPerMinor =
      acquisitionCurve === undefined
        ? null
        : marginalResponsePerSpendMinor(
            acquisitionCurve,
            spend,
            marginalBlock,
          );

    const point: ChannelEconomicCurvePoint = {
      spendMinor: spend,
      expectedIncrementalOrders: incrementalOrders,
      expectedIncrementalRevenueMinor:
        incrementalRevenue,
      expectedIncrementalContributionProfitMinor:
        incrementalContribution,
      averageIncrementalRoas:
        spend > 0
          ? incrementalRevenue / spend
          : null,
      marginalIncrementalRoas:
        marginalRevenuePerMinor,
      averageIncrementalCacMinor:
        acquisitionCustomers !== null &&
        acquisitionCustomers > 0 &&
        spend > 0
          ? spend / acquisitionCustomers
          : null,
      marginalIncrementalCacMinor:
        marginalCustomersPerMinor !== null &&
        marginalCustomersPerMinor > 0
          ? 1 / marginalCustomersPerMinor
          : null,
    };
    points.push(point);

    if (incrementalContribution > bestContribution) {
      bestContribution = incrementalContribution;
      bestSpend = spend;
    }

    if (
      point.marginalIncrementalRoas !== null &&
      point.marginalIncrementalRoas *
        preMarketingRate >=
        1
    ) {
      maximumRationalSpend = spend;
    }
  }

  return {
    channel,
    responseCurveId: responseCurve.id,
    points,
    saturationSpendMinor: saturation,
    breakEvenRevenueRoas:
      breakEvenRevenueRoas(world),
    contributionProfitMaximizingSpendMinor:
      bestSpend,
    maximumEconomicallyRationalSpendMinor:
      maximumRationalSpend,
  };
}
