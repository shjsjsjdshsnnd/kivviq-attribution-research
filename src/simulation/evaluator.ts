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


export interface ObservationalTouchCohort {
  readonly channel: string;
  readonly touchedRepresentedCustomers: number;
  readonly untouchedRepresentedCustomers: number;
  readonly touchedPurchaseRate: number;
  readonly untouchedPurchaseRate: number;
  readonly touchedRevenuePerCustomerMinor: number;
  readonly untouchedRevenuePerCustomerMinor: number;
  readonly touchedRepeatBuyerRate: number;
  readonly untouchedRepeatBuyerRate: number;
}

export function observationalTouchCohort(
  result: SimulationResult,
  population: {
    readonly customers: readonly {
      readonly customerId: string;
      readonly populationWeight: number;
    }[];
  },
  channel: string,
): ObservationalTouchCohort {
  const touched = new Set(
    result.observableEvents
      .filter(
        (event) =>
          event.source === channel || event.channel === channel,
      )
      .map((event) => event.anonymousSubjectId),
  );
  const purchasesByCustomer = new Map<
    string,
    { count: number; revenue: number }
  >();
  for (const purchase of result.purchases) {
    const current = purchasesByCustomer.get(purchase.customerId) ?? {
      count: 0,
      revenue: 0,
    };
    current.count += 1;
    current.revenue += purchase.netRevenueMinor;
    purchasesByCustomer.set(purchase.customerId, current);
  }

  let touchedWeight = 0;
  let untouchedWeight = 0;
  let touchedBuyerWeight = 0;
  let untouchedBuyerWeight = 0;
  let touchedRepeatWeight = 0;
  let untouchedRepeatWeight = 0;
  let touchedRevenue = 0;
  let untouchedRevenue = 0;

  for (const customer of population.customers) {
    const outcome = purchasesByCustomer.get(customer.customerId) ?? {
      count: 0,
      revenue: 0,
    };
    if (touched.has(customer.customerId)) {
      touchedWeight += customer.populationWeight;
      touchedRevenue += outcome.revenue * customer.populationWeight;
      if (outcome.count > 0) touchedBuyerWeight += customer.populationWeight;
      if (outcome.count > 1) touchedRepeatWeight += customer.populationWeight;
    } else {
      untouchedWeight += customer.populationWeight;
      untouchedRevenue += outcome.revenue * customer.populationWeight;
      if (outcome.count > 0) untouchedBuyerWeight += customer.populationWeight;
      if (outcome.count > 1) untouchedRepeatWeight += customer.populationWeight;
    }
  }

  return {
    channel,
    touchedRepresentedCustomers: touchedWeight,
    untouchedRepresentedCustomers: untouchedWeight,
    touchedPurchaseRate:
      touchedWeight > 0 ? touchedBuyerWeight / touchedWeight : 0,
    untouchedPurchaseRate:
      untouchedWeight > 0 ? untouchedBuyerWeight / untouchedWeight : 0,
    touchedRevenuePerCustomerMinor:
      touchedWeight > 0 ? touchedRevenue / touchedWeight : 0,
    untouchedRevenuePerCustomerMinor:
      untouchedWeight > 0 ? untouchedRevenue / untouchedWeight : 0,
    touchedRepeatBuyerRate:
      touchedWeight > 0 ? touchedRepeatWeight / touchedWeight : 0,
    untouchedRepeatBuyerRate:
      untouchedWeight > 0 ? untouchedRepeatWeight / untouchedWeight : 0,
  };
}

export interface PromotionSelectionSummary {
  readonly discountedBuyerCount: number;
  readonly fullPriceBuyerCount: number;
  readonly discountedBuyerMeanPromotionSensitivity: number;
  readonly fullPriceBuyerMeanPromotionSensitivity: number;
}

export function promotionSelectionSummary(
  result: SimulationResult,
  population: {
    readonly customers: readonly {
      readonly customerId: string;
      readonly promotionSensitivityMultiplier: number;
    }[];
  },
): PromotionSelectionSummary {
  const sensitivity = new Map(
    population.customers.map(
      (customer) =>
        [
          customer.customerId,
          customer.promotionSensitivityMultiplier,
        ] as const,
    ),
  );
  const discounted = new Set<string>();
  const fullPrice = new Set<string>();

  for (const purchase of result.purchases) {
    if (purchase.discountMinor > 0) {
      discounted.add(purchase.customerId);
    } else {
      fullPrice.add(purchase.customerId);
    }
  }

  const mean = (ids: ReadonlySet<string>): number => {
    const values = [...ids]
      .map((id) => sensitivity.get(id))
      .filter((value): value is number => value !== undefined);
    return values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    discountedBuyerCount: discounted.size,
    fullPriceBuyerCount: fullPrice.size,
    discountedBuyerMeanPromotionSensitivity: mean(discounted),
    fullPriceBuyerMeanPromotionSensitivity: mean(fullPrice),
  };
}
