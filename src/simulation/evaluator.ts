import type { MarketingChannel } from "../generation/config.js";
import type {
  PlatformStyleChannelMetric,
  SimulationResult,
} from "./types.js";
import type { CounterfactualReplayResult } from "./types.js";

export interface ChannelObservationVsTruth {
  readonly channel: string;
  readonly attributedRevenueMinor: number;
  readonly observedPurchases: number;
  readonly observedPurchaseRateAfterTouch: number;
  readonly trueMerchantEffect: number | null;
}

export interface ZeroPaidEffectAcceptance {
  readonly paidMerchantEffectsAllZero: boolean;
  readonly trueIncrementalPaidRevenueMinor: number;
  readonly observedPaidAttributedRevenueMinor: number;
  readonly paidChannelsLookingEffective: readonly string[];
  readonly realisticPaidTouchedPurchasePaths: readonly string[];
}

const PAID = new Set<string>([
  "meta",
  "google_search",
  "google_shopping",
  "pinterest",
  "affiliate",
]);

export function compareObservationToMerchantTruth(
  result: SimulationResult,
  merchantEffects: readonly {
    readonly channelId: string;
    readonly effect: { readonly value: number };
  }[],
): readonly ChannelObservationVsTruth[] {
  const effectByChannel = new Map(
    merchantEffects.map(
      (effect) => [effect.channelId, effect.effect.value] as const,
    ),
  );

  return result.platformMetrics.map((metric) => ({
    channel: metric.channel,
    attributedRevenueMinor: metric.attributedRevenueMinor,
    observedPurchases: metric.purchases,
    observedPurchaseRateAfterTouch:
      metric.observedPurchaseRateAfterTouch,
    trueMerchantEffect:
      effectByChannel.get(metric.channel) ?? null,
  }));
}

function paidAttributedRevenue(
  metrics: readonly PlatformStyleChannelMetric[],
): number {
  return metrics
    .filter((metric) => PAID.has(metric.channel))
    .reduce(
      (sum, metric) => sum + metric.attributedRevenueMinor,
      0,
    );
}

function paidTouchedPaths(
  result: SimulationResult,
): readonly string[] {
  return result.godMode.purchaseTruth
    .map((truth) => truth.observablePath.join(" -> "))
    .filter((path) =>
      [...PAID].some((channel) => path.includes(channel)),
    );
}

export function evaluateZeroPaidEffectAcceptance(
  replay: CounterfactualReplayResult,
  merchantEffects: readonly {
    readonly channelId: string;
    readonly effect: { readonly value: number };
  }[],
): ZeroPaidEffectAcceptance {
  const paidEffects = merchantEffects.filter((effect) =>
    PAID.has(effect.channelId),
  );
  const observational = replay.factual.platformMetrics.filter(
    (metric) => PAID.has(metric.channel),
  );

  return {
    paidMerchantEffectsAllZero: paidEffects.every(
      (effect) => effect.effect.value === 0,
    ),
    trueIncrementalPaidRevenueMinor:
      replay.delta.representedRevenueMinor,
    observedPaidAttributedRevenueMinor: paidAttributedRevenue(
      replay.factual.platformMetrics,
    ),
    paidChannelsLookingEffective: observational
      .filter(
        (metric) =>
          metric.attributedRevenueMinor > 0 &&
          metric.purchases > 0,
      )
      .map((metric) => metric.channel),
    realisticPaidTouchedPurchasePaths: [
      ...new Set(paidTouchedPaths(replay.factual)),
    ],
  };
}

export function individualChannelCounterfactualSummary(
  replay: CounterfactualReplayResult,
  channel: MarketingChannel,
): {
  readonly channel: MarketingChannel;
  readonly customersWithChangedPurchaseCount: number;
  readonly customersWithChangedRevenue: number;
} {
  void channel;
  return {
    channel,
    customersWithChangedPurchaseCount:
      replay.individualPurchaseChanges.filter(
        (change) =>
          change.factualPurchases !==
          change.counterfactualPurchases,
      ).length,
    customersWithChangedRevenue:
      replay.individualPurchaseChanges.filter(
        (change) =>
          change.factualRevenueMinor !==
          change.counterfactualRevenueMinor,
      ).length,
  };
}
