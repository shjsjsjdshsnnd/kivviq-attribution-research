import type {
  CartBehaviorEffect,
  CollectionBehaviorEffect,
  CheckoutBehaviorEffect,
  HomepageBehaviorEffect,
  PDPBehaviorEffect,
  SearchBehaviorEffect,
  WebsiteBehaviorContext,
  WebsiteDevice,
  WebsiteState,
  WebsiteSurface,
} from "./types.js";
import { measuredWebsiteLoadTimeMs } from "./model.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function deviceKey(device: WebsiteDevice): "mobile" | "desktop" {
  return device === "mobile" ? "mobile" : "desktop";
}

function experience(
  state: WebsiteState,
  device: WebsiteDevice,
  surface: WebsiteSurface,
) {
  return state.deviceExperience[deviceKey(device)][surface];
}

function latencyPenalty(loadTimeMs: number): number {
  return clamp((loadTimeMs - 1_500) / 6_000, 0, 0.72);
}

function scoreMultiplier(
  score: number,
  sensitivity = 1,
): number {
  return clamp(1 + (score - 0.88) * sensitivity, 0.35, 1.22);
}

function measured(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  surface: WebsiteSurface,
  noiseUnit: number,
): number {
  return measuredWebsiteLoadTimeMs(
    state,
    context.device,
    surface,
    noiseUnit,
  );
}

export function homepageBehavior(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  noiseUnit = 0.5,
): HomepageBehaviorEffect {
  const device = experience(state, context.device, "homepage");
  const navigation = experience(state, context.device, "navigation");
  const navigationQuality =
    (state.homepage.navigationClarity +
      state.navigation.hierarchyClarity +
      state.navigation.categoryDiscoverability +
      state.navigation.namingClarity +
      navigation.usabilityScore) /
    5;
  const relevance =
    (state.homepage.heroRelevance +
      state.homepage.merchandisingQuality +
      state.homepage.visualQuality +
      state.homepage.valuePropositionClarity) /
    4;
  const trust =
    (state.homepage.trustSignalStrength +
      state.homepage.promotionalClarity +
      device.usabilityScore +
      device.layoutStability) /
    4;
  const latency = latencyPenalty(
    Math.max(state.homepage.loadTimeMs, device.loadTimeMs),
  );

  return {
    collectionWeightMultiplier: clamp(
      scoreMultiplier(
        navigationQuality * 0.55 + relevance * 0.45,
        1.15,
      ) *
        (1 - latency * 0.28),
      0.45,
      1.35,
    ),
    searchWeightMultiplier: clamp(
      scoreMultiplier(
        state.navigation.categoryDiscoverability * 0.35 +
          state.search.mobileUsability * 0.15 +
          navigationQuality * 0.5,
        0.75,
      ) *
        (1 + (1 - navigationQuality) * 0.22),
      0.55,
      1.45,
    ),
    pdpWeightMultiplier: clamp(
      scoreMultiplier(relevance * 0.72 + trust * 0.28, 1.05) *
        (1 - latency * 0.22),
      0.45,
      1.35,
    ),
    exitWeightMultiplier: clamp(
      0.72 +
        (1 - relevance) * 0.9 +
        (1 - trust) * 0.65 +
        latency * 1.25,
      0.45,
      2.4,
    ),
    measuredLoadTimeMs: measured(
      state,
      context,
      "homepage",
      noiseUnit,
    ),
  };
}

export function collectionBehavior(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  noiseUnit = 0.5,
): CollectionBehaviorEffect {
  const device = experience(state, context.device, "collections");
  const assortmentSize = Math.max(1, context.assortmentSize ?? 24);
  const breadthPressure = clamp((assortmentSize - 24) / 140, 0, 0.8);
  const sorting =
    state.collections.sortQuality * 0.43 +
    state.collections.productRankingRelevance * 0.42 +
    state.collections.filterQuality * 0.15;
  const discovery =
    state.collections.productCardInformationQuality * 0.2 +
    state.collections.imageryQuality * 0.2 +
    state.collections.stockVisibility * 0.13 +
    state.collections.priceVisibility * 0.14 +
    state.collections.promotionalVisibility * 0.08 +
    device.usabilityScore * 0.15 +
    device.layoutStability * 0.1;
  const latency = latencyPenalty(
    Math.max(state.collections.loadTimeMs, device.loadTimeMs),
  );
  const broadAssortmentPenalty =
    (1 - sorting) * breadthPressure * 0.75;

  return {
    toPdpMultiplier: clamp(
      scoreMultiplier(
        sorting * 0.52 + discovery * 0.48,
        1.35,
      ) *
        (1 - latency * 0.42) *
        (1 - broadAssortmentPenalty),
      0.28,
      1.35,
    ),
    exitProbabilityMultiplier: clamp(
      0.72 +
        (1 - sorting) * (0.72 + breadthPressure * 0.7) +
        (1 - discovery) * 0.48 +
        latency * 0.9,
      0.45,
      2.35,
    ),
    searchUsageMultiplier: clamp(
      0.85 +
        (1 - sorting) * (0.35 + breadthPressure * 0.5) +
        (1 - state.collections.filterQuality) * 0.25,
      0.7,
      1.8,
    ),
    measuredLoadTimeMs: measured(
      state,
      context,
      "collections",
      noiseUnit,
    ),
  };
}

export function searchBehavior(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  noiseUnit = 0.5,
): SearchBehaviorEffect {
  const device = experience(state, context.device, "search");
  const quality =
    state.search.resultRelevance * 0.38 +
    state.search.typoTolerance * 0.16 +
    state.search.synonymHandling * 0.16 +
    state.search.filteringQuality * 0.12 +
    state.search.merchandisingQuality * 0.1 +
    device.usabilityScore * 0.08;
  const latency = latencyPenalty(
    Math.max(state.search.searchSpeedMs, device.loadTimeMs),
  );
  const zeroResultProbability = clamp(
    state.search.zeroResultRate *
      (1 +
        (1 - state.search.typoTolerance) * 0.35 +
        (1 - state.search.synonymHandling) * 0.35),
    0,
    0.92,
  );

  return {
    toPdpMultiplier: clamp(
      scoreMultiplier(quality, 1.55) *
        (1 - latency * 0.38) *
        (1 - zeroResultProbability * 0.85),
      0.18,
      1.35,
    ),
    exitProbabilityMultiplier: clamp(
      0.68 +
        (1 - quality) * 1.15 +
        zeroResultProbability * 1.3 +
        latency * 0.75,
      0.45,
      2.6,
    ),
    refinementMultiplier: clamp(
      0.82 +
        (1 - quality) * 0.55 +
        zeroResultProbability * 0.75,
      0.7,
      2,
    ),
    zeroResultProbability,
    measuredLoadTimeMs: measured(
      state,
      context,
      "search",
      noiseUnit,
    ),
  };
}

export function pdpBehavior(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  noiseUnit = 0.5,
): PDPBehaviorEffect {
  const device = experience(state, context.device, "pdp");
  const considerationWeight = context.highConsideration === true ? 1.45 : 1;
  const imagery =
    clamp(
      state.pdp.imageQuality *
        (0.72 + Math.min(10, state.pdp.imageQuantity) / 10 * 0.28),
      0,
      1,
    );
  const productConfidence =
    (state.pdp.productDescriptionQuality +
      state.pdp.priceClarity +
      state.pdp.variantSelectionUsability +
      state.pdp.stockClarity +
      state.pdp.deliveryInformationClarity +
      state.pdp.returnsInformationClarity +
      state.pdp.trustStrength +
      state.pdp.reviewsStrength +
      state.pdp.ctaVisibility) /
    9;
  const latency = latencyPenalty(
    Math.max(state.pdp.loadTimeMs, device.loadTimeMs),
  );
  const imageryPenalty =
    (1 - imagery) * 0.48 * considerationWeight;

  return {
    addToCartMultiplier: clamp(
      scoreMultiplier(
        imagery * 0.34 + productConfidence * 0.52 + device.usabilityScore * 0.14,
        1.45,
      ) *
        (1 - latency * 0.58) *
        (1 - imageryPenalty * 0.62),
      0.2,
      1.4,
    ),
    exitProbabilityMultiplier: clamp(
      0.68 +
        latency * 1.25 +
        imageryPenalty * 0.8 +
        (1 - productConfidence) * 0.8 +
        (1 - device.layoutStability) * 0.5,
      0.42,
      2.8,
    ),
    comparisonMultiplier: clamp(
      0.82 +
        (1 - productConfidence) * 0.6 +
        (1 - imagery) * 0.32,
      0.72,
      1.75,
    ),
    measuredLoadTimeMs: measured(
      state,
      context,
      "pdp",
      noiseUnit,
    ),
  };
}

export function cartBehavior(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  noiseUnit = 0.5,
): CartBehaviorEffect {
  const device = experience(state, context.device, "cart");
  const clarity =
    state.cart.priceClarity * 0.18 +
    state.cart.shippingVisibility * 0.22 +
    state.cart.discountCodeUsability * 0.1 +
    state.cart.cartEditUsability * 0.12 +
    state.cart.checkoutCtaClarity * 0.18 +
    state.cart.trustSignals * 0.12 +
    device.usabilityScore * 0.08;
  const latency = latencyPenalty(
    Math.max(state.cart.loadTimeMs, device.loadTimeMs),
  );

  return {
    checkoutMultiplier: clamp(
      scoreMultiplier(clarity, 1.25) * (1 - latency * 0.42),
      0.35,
      1.35,
    ),
    abandonmentProbabilityMultiplier: clamp(
      0.72 +
        (1 - clarity) * 1.25 +
        latency * 0.9,
      0.45,
      2.35,
    ),
    measuredLoadTimeMs: measured(
      state,
      context,
      "cart",
      noiseUnit,
    ),
  };
}

export function checkoutBehavior(
  state: WebsiteState,
  context: WebsiteBehaviorContext,
  noiseUnit = 0.5,
): CheckoutBehaviorEffect {
  const device = experience(state, context.device, "checkout");
  const checkout = state.checkout;
  const latency = latencyPenalty(
    Math.max(checkout.loadTimeMs, device.loadTimeMs),
  );
  const relativeShippingCost =
    context.expectedAovMinor !== undefined &&
    context.expectedAovMinor > 0 &&
    context.shippingCostMinor !== undefined
      ? clamp(
          context.shippingCostMinor / context.expectedAovMinor,
          0,
          1,
        )
      : 0;
  const shippingPenalty =
    checkout.shippingCostSurprise *
    relativeShippingCost *
    1.8;
  const formPenalty =
    checkout.formComplexity * 0.34 +
    Math.max(0, checkout.numberOfSteps - 2) * 0.055;
  const paymentBreadth = clamp(checkout.paymentOptions / 4, 0.45, 1.2);
  const confidence =
    checkout.trust * 0.34 +
    checkout.shippingSpeedClarity * 0.2 +
    checkout.couponReliability * 0.12 +
    device.usabilityScore * 0.22 +
    device.layoutStability * 0.12;
  const paidTrafficAmplifier =
    context.paidTraffic === true
      ? 1 + (formPenalty + latency) * 0.08
      : 1;
  const rawMultiplier =
    scoreMultiplier(confidence, 1.25) *
    paymentBreadth *
    (1 - clamp(formPenalty, 0, 0.72)) *
    (1 - latency * 0.52) *
    (1 - clamp(shippingPenalty, 0, 0.72)) *
    (1 - checkout.errorRate * 1.9);

  const couponAttemptProbability =
    context.promotionActive === true
      ? clamp(
          0.48 +
            (1 - state.cart.discountCodeUsability) * 0.14 +
            (1 - checkout.couponReliability) * 0.08,
          0.2,
          0.88,
        )
      : 0.04;

  const couponFailureProbability =
    context.promotionActive === true
      ? clamp(
          (1 - checkout.couponReliability) * 0.92 +
            checkout.errorRate * 0.2,
          0,
          0.9,
        )
      : clamp((1 - checkout.couponReliability) * 0.08, 0, 0.12);

  const paymentFailureProbability = clamp(
    checkout.errorRate *
      (1.2 - Math.min(8, checkout.paymentOptions) * 0.045) *
      paidTrafficAmplifier,
    0,
    0.72,
  );

  return {
    purchaseMultiplier: clamp(
      rawMultiplier / paidTrafficAmplifier,
      0.18,
      1.35,
    ),
    abandonmentProbabilityMultiplier: clamp(
      0.7 +
        formPenalty * 1.2 +
        latency * 0.95 +
        shippingPenalty * 1.1 +
        (1 - confidence) * 0.85 +
        checkout.errorRate * 1.6,
      0.45,
      3,
    ),
    couponAttemptProbability,
    couponFailureProbability,
    paymentFailureProbability,
    measuredLoadTimeMs: measured(
      state,
      context,
      "checkout",
      noiseUnit,
    ),
  };
}
