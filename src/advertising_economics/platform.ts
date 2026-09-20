import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { SimulationResult } from "../simulation/types.js";
import type {
  ObservedChannelPerformance,
  PaidMarketingChannel,
  PlatformAttributedPurchaseClaim,
  PlatformChannelReport,
  SyntheticPlatformAttributionRule,
} from "./types.js";

const DAY_MS = 86_400_000;

export const SYNTHETIC_PLATFORM_RULES: Readonly<
  Record<PaidMarketingChannel, SyntheticPlatformAttributionRule>
> = {
  meta: {
    channel: "meta",
    clickWindowDays: 14,
    viewWindowDays: 5,
    allowViewThrough: true,
    claimFullRevenue: true,
    retargetingBias: 0.82,
  },
  google_search: {
    channel: "google_search",
    clickWindowDays: 30,
    viewWindowDays: 0,
    allowViewThrough: false,
    claimFullRevenue: true,
    retargetingBias: 0.58,
    brandedSearchBias: 0.88,
  },
  google_shopping: {
    channel: "google_shopping",
    clickWindowDays: 21,
    viewWindowDays: 1,
    allowViewThrough: true,
    claimFullRevenue: true,
    retargetingBias: 0.68,
  },
  pinterest: {
    channel: "pinterest",
    clickWindowDays: 30,
    viewWindowDays: 7,
    allowViewThrough: true,
    claimFullRevenue: true,
    retargetingBias: 0.45,
  },
  affiliate: {
    channel: "affiliate",
    clickWindowDays: 30,
    viewWindowDays: 0,
    allowViewThrough: false,
    claimFullRevenue: true,
    retargetingBias: 0.72,
  },
};

function customerWeightMap(
  population: LatentCustomerPopulation,
): ReadonlyMap<string, number> {
  return new Map(
    population.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
}

function isClickLike(
  event: SimulationResult["observableEvents"][number],
  channel: PaidMarketingChannel,
): boolean {
  if (event.source !== channel && event.channel !== channel) {
    return false;
  }

  return (
    event.eventType === "visit" ||
    event.eventType === "session_start" ||
    event.eventType === "search" ||
    event.eventType === "landing_page_view"
  );
}

function isViewLike(
  event: SimulationResult["observableEvents"][number],
  channel: PaidMarketingChannel,
): boolean {
  if (event.source !== channel && event.channel !== channel) {
    return false;
  }

  return event.eventType === "impression";
}

function searchClassForTouch(
  result: SimulationResult,
  customerId: string,
  purchaseMs: number,
): "brand" | "nonbrand" | undefined {
  const search = [...result.observableEvents]
    .filter(
      (event) =>
        event.anonymousSubjectId === customerId &&
        event.source === "google_search" &&
        event.eventType === "search" &&
        Date.parse(event.occurredAt) <= purchaseMs,
    )
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) -
        Date.parse(left.occurredAt),
    )[0];

  if (!search?.searchIntent) return undefined;
  return search.searchIntent === "branded"
    ? "brand"
    : "nonbrand";
}

function latestEligibleTouch(
  result: SimulationResult,
  purchase: SimulationResult["purchases"][number],
  rule: SyntheticPlatformAttributionRule,
): {
  readonly touchKind: "click_like" | "view_through";
  readonly occurredAt: string;
  readonly searchClass?: "brand" | "nonbrand";
} | undefined {
  const purchaseMs = Date.parse(purchase.occurredAt);

  const clickCutoff =
    purchaseMs - rule.clickWindowDays * DAY_MS;
  const clicks = result.observableEvents
    .filter(
      (event) =>
        event.anonymousSubjectId === purchase.customerId &&
        isClickLike(event, rule.channel) &&
        Date.parse(event.occurredAt) <= purchaseMs &&
        Date.parse(event.occurredAt) >= clickCutoff,
    )
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) -
        Date.parse(left.occurredAt),
    );

  if (clicks.length > 0) {
    const searchClass =
      rule.channel === "google_search"
        ? searchClassForTouch(
            result,
            purchase.customerId,
            purchaseMs,
          )
        : undefined;

    return {
      touchKind: "click_like",
      occurredAt: clicks[0]!.occurredAt,
      ...(searchClass === undefined
        ? {}
        : { searchClass }),
    };
  }

  if (!rule.allowViewThrough || rule.viewWindowDays <= 0) {
    return undefined;
  }

  const viewCutoff =
    purchaseMs - rule.viewWindowDays * DAY_MS;
  const views = result.observableEvents
    .filter(
      (event) =>
        event.anonymousSubjectId === purchase.customerId &&
        isViewLike(event, rule.channel) &&
        Date.parse(event.occurredAt) <= purchaseMs &&
        Date.parse(event.occurredAt) >= viewCutoff,
    )
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) -
        Date.parse(left.occurredAt),
    );

  if (views.length === 0) return undefined;

  return {
    touchKind: "view_through",
    occurredAt: views[0]!.occurredAt,
  };
}

export function platformClaims(
  result: SimulationResult,
  channel: PaidMarketingChannel,
  rule: SyntheticPlatformAttributionRule =
    SYNTHETIC_PLATFORM_RULES[channel],
): readonly PlatformAttributedPurchaseClaim[] {
  const claims: PlatformAttributedPurchaseClaim[] = [];

  for (const purchase of result.purchases) {
    const touch = latestEligibleTouch(
      result,
      purchase,
      rule,
    );
    if (!touch) continue;

    claims.push({
      channel,
      orderId: purchase.orderId,
      customerId: purchase.customerId,
      attributedRevenueMinor: rule.claimFullRevenue
        ? purchase.netRevenueMinor
        : Math.round(purchase.netRevenueMinor * 0.5),
      touchKind: touch.touchKind,
      touchOccurredAt: touch.occurredAt,
      purchaseOccurredAt: purchase.occurredAt,
      ...(touch.searchClass === undefined
        ? {}
        : { searchClass: touch.searchClass }),
    });
  }

  return claims;
}

export function buildPlatformChannelReport(
  result: SimulationResult,
  population: LatentCustomerPopulation,
  channel: PaidMarketingChannel,
  spendMinor: number,
  rule: SyntheticPlatformAttributionRule =
    SYNTHETIC_PLATFORM_RULES[channel],
): PlatformChannelReport {
  const weights = customerWeightMap(population);
  const claims = platformClaims(
    result,
    channel,
    rule,
  );

  const attributedRevenueMinor = claims.reduce(
    (sum, claim) =>
      sum +
      claim.attributedRevenueMinor *
        (weights.get(claim.customerId) ?? 1),
    0,
  );

  const attributedOrders = claims.reduce(
    (sum, claim) =>
      sum + (weights.get(claim.customerId) ?? 1),
    0,
  );

  return {
    channel,
    spendMinor,
    attributedOrders,
    attributedRevenueMinor,
    reportedRoas:
      spendMinor > 0
        ? attributedRevenueMinor / spendMinor
        : null,
    reportedCacMinor:
      attributedOrders > 0
        ? spendMinor / attributedOrders
        : null,
    claims,
  };
}

export function observedTouchPerformance(
  result: SimulationResult,
  population: LatentCustomerPopulation,
  channel: PaidMarketingChannel,
  spendMinor: number,
  lookbackDays = 30,
): ObservedChannelPerformance {
  const weights = customerWeightMap(population);
  const lookbackMs = lookbackDays * DAY_MS;
  const touchedBuyers = new Set<string>();
  let revenue = 0;

  for (const purchase of result.purchases) {
    const purchaseMs = Date.parse(purchase.occurredAt);
    const hasTouch = result.observableEvents.some(
      (event) =>
        event.anonymousSubjectId === purchase.customerId &&
        (event.source === channel ||
          event.channel === channel) &&
        Date.parse(event.occurredAt) <= purchaseMs &&
        Date.parse(event.occurredAt) >=
          purchaseMs - lookbackMs,
    );

    if (!hasTouch) continue;
    const weight =
      weights.get(purchase.customerId) ?? 1;
    touchedBuyers.add(purchase.customerId);
    revenue += purchase.netRevenueMinor * weight;
  }

  const buyerWeight = [...touchedBuyers].reduce(
    (sum, customerId) =>
      sum + (weights.get(customerId) ?? 1),
    0,
  );

  return {
    channel,
    spendMinor,
    touchAssociatedBuyers: buyerWeight,
    touchAssociatedRevenueMinor: revenue,
    observedRoas:
      spendMinor > 0 ? revenue / spendMinor : null,
    observedCacMinor:
      buyerWeight > 0
        ? spendMinor / buyerWeight
        : null,
  };
}

export interface GoogleSearchPlatformSplit {
  readonly brandAttributedRevenueMinor: number;
  readonly nonbrandAttributedRevenueMinor: number;
  readonly brandClaims: number;
  readonly nonbrandClaims: number;
}

export function googleSearchPlatformSplit(
  report: PlatformChannelReport,
  population: LatentCustomerPopulation,
): GoogleSearchPlatformSplit {
  if (report.channel !== "google_search") {
    throw new RangeError(
      "googleSearchPlatformSplit requires a Google Search report",
    );
  }

  const weights = customerWeightMap(population);
  let brandRevenue = 0;
  let nonbrandRevenue = 0;
  let brandClaims = 0;
  let nonbrandClaims = 0;

  for (const claim of report.claims) {
    const weight =
      weights.get(claim.customerId) ?? 1;
    if (claim.searchClass === "brand") {
      brandRevenue += claim.attributedRevenueMinor * weight;
      brandClaims += weight;
    } else if (claim.searchClass === "nonbrand") {
      nonbrandRevenue +=
        claim.attributedRevenueMinor * weight;
      nonbrandClaims += weight;
    }
  }

  return {
    brandAttributedRevenueMinor: brandRevenue,
    nonbrandAttributedRevenueMinor: nonbrandRevenue,
    brandClaims,
    nonbrandClaims,
  };
}
