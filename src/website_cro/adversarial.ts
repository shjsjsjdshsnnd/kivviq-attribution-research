import type {
  DevicePerformance,
  PagePerformance,
  ProductPresentation,
  WebsiteScenario,
  WebsiteState,
} from "./types.js";

const performance = (
  latencyMs: number,
  responsiveness = 0.94,
): PagePerformance => ({
  latencyMs,
  loadSuccessProbability: 0.997,
  interactionDelayMs: Math.round(latencyMs * 0.08),
  responsiveness,
  assetWeightProxy: latencyMs / 1_000,
});

const healthyPerformance = (): DevicePerformance => ({
  mobile: performance(1_050, 0.92),
  desktop: performance(620, 0.97),
  tablet: performance(820, 0.94),
});

export function healthyWebsiteState(
  deployedAt: string,
  versionId = "website_v1",
  productPresentation?: readonly ProductPresentation[],
): WebsiteState {
  const shared = healthyPerformance();
  return {
    versionId,
    deployedAt,
    homepage: {
      componentVersion: `homepage_${versionId}`,
      performance: structuredClone(shared),
      discoveryQuality: 0.9,
      merchandisingRelevance: 0.9,
      navigationClarity: 0.91,
      promotionalClarity: 0.9,
      visibility: 0.9,
    },
    navigation: {
      componentVersion: `navigation_${versionId}`,
      performance: structuredClone(shared),
      categoryDiscoverability: 0.91,
      hierarchyClarity: 0.9,
      pathEfficiency: 0.91,
      mobileMenuUsability: 0.88,
    },
    collection: {
      componentVersion: `collection_${versionId}`,
      performance: structuredClone(shared),
      rankingQuality: 0.9,
      filteringUsability: 0.88,
      sortingUsability: 0.89,
      productDensity: 0.84,
      relevance: 0.91,
      availabilityVisibility: 0.9,
    },
    search: {
      componentVersion: `search_${versionId}`,
      performance: structuredClone(shared),
      relevance: 0.91,
      synonymCoverage: 0.9,
      zeroResultBaseProbability: 0.015,
      reformulationSupport: 0.9,
      alternativeDiscovery: 0.86,
    },
    pdp: {
      componentVersion: `pdp_${versionId}`,
      performance: structuredClone(shared),
      imageryQuality: 0.91,
      informationCompleteness: 0.91,
      priceClarity: 0.94,
      variantSelectionUsability: 0.9,
      inventoryClarity: 0.91,
      deliveryClarity: 0.9,
      trust: 0.92,
      socialProof: 0.86,
      ctaUsability: 0.93,
    },
    cart: {
      componentVersion: `cart_${versionId}`,
      performance: structuredClone(shared),
      clarity: 0.92,
      shippingVisibility: 0.91,
      promotionVisibility: 0.9,
      couponReliability: 0.995,
      crossSellRelevance: 0.78,
      quantityEditingUsability: 0.92,
      persistenceProbability: 0.96,
    },
    checkout: {
      componentVersion: `checkout_${versionId}`,
      performance: structuredClone(shared),
      contactUsability: 0.93,
      shippingUsability: 0.92,
      paymentUsability: 0.93,
      reviewUsability: 0.92,
      formUsability: 0.93,
      mobileUsability: 0.9,
      accountRequirementFriction: 0.04,
      addressValidationReliability: 0.997,
      paymentReliability: 0.997,
      shippingCostVisibility: "cart",
      excessiveSteps: 0.05,
    },
    ...(productPresentation === undefined
      ? {}
      : { productPresentation }),
  };
}

export function healthyWebsiteScenario(
  deployedAt: string,
): WebsiteScenario {
  return {
    scenarioId: "healthy-website",
    states: [healthyWebsiteState(deployedAt)],
  };
}

export function slowMobilePdpScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = structuredClone(
    healthyWebsiteState(deployedAt),
  );
  state.pdp.componentVersion = "pdp_slow_mobile_v1";
  state.pdp.performance.mobile = {
    ...state.pdp.performance.mobile,
    latencyMs: 7_200,
    interactionDelayMs: 1_650,
    responsiveness: 0.42,
    assetWeightProxy: 7.4,
  };
  return {
    scenarioId: "slow-mobile-pdp-trap",
    states: [state],
  };
}

export function badSearchScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = structuredClone(
    healthyWebsiteState(deployedAt),
  );
  state.search.componentVersion = "search_bad_v1";
  state.search.relevance = 0.12;
  state.search.synonymCoverage = 0.16;
  state.search.zeroResultBaseProbability = 0.34;
  state.search.reformulationSupport = 0.38;
  state.search.alternativeDiscovery = 0.25;
  return {
    scenarioId: "bad-search-trap",
    states: [state],
  };
}

export function poorCollectionSortingScenario(
  deployedAt: string,
  preferredProductId: string,
  promotedButWeakerProductId?: string,
): WebsiteScenario {
  const presentation: ProductPresentation[] = [
    {
      productId: preferredProductId,
      collectionVisibility: 0.015,
    },
  ];
  if (promotedButWeakerProductId !== undefined) {
    presentation.push({
      productId: promotedButWeakerProductId,
      collectionVisibility: 1,
    });
  }
  const state = structuredClone(
    healthyWebsiteState(
      deployedAt,
      "website_bad_sorting",
      presentation,
    ),
  );
  state.collection.componentVersion =
    "collection_bad_sorting_v1";
  state.collection.rankingQuality = 0.26;
  return {
    scenarioId: "poor-collection-sorting-trap",
    states: [state],
  };
}

export function brokenCouponScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = structuredClone(
    healthyWebsiteState(deployedAt),
  );
  state.cart.componentVersion = "cart_coupon_defect_v1";
  state.cart.couponReliability = 0.03;
  state.cart.promotionVisibility = 0.96;
  return {
    scenarioId: "broken-coupon-trap",
    states: [state],
  };
}

export function shippingSurpriseScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = structuredClone(
    healthyWebsiteState(deployedAt),
  );
  state.pdp.componentVersion = "pdp_hidden_shipping_v1";
  state.pdp.deliveryClarity = 0.3;
  state.cart.componentVersion = "cart_hidden_shipping_v1";
  state.cart.shippingVisibility = 0.12;
  state.checkout.componentVersion =
    "checkout_late_shipping_v1";
  state.checkout.shippingCostVisibility =
    "checkout_review";
  return {
    scenarioId: "shipping-surprise-trap",
    states: [state],
  };
}

export function checkoutRegressionScenario(
  initialDeployedAt: string,
  regressionDeployedAt: string,
): WebsiteScenario {
  const before = healthyWebsiteState(
    initialDeployedAt,
    "website_pre_regression",
  );
  const after = structuredClone(
    healthyWebsiteState(
      regressionDeployedAt,
      "website_checkout_regression",
    ),
  );
  after.checkout.componentVersion = "checkout_v2";
  after.checkout.mobileUsability = 0.25;
  after.checkout.formUsability = 0.55;
  after.checkout.addressValidationReliability = 0.34;
  after.checkout.performance.mobile = {
    ...after.checkout.performance.mobile,
    interactionDelayMs: 1_900,
    responsiveness: 0.48,
  };

  return {
    scenarioId: "checkout-regression-trap",
    states: [before, after],
  };
}

export function bottleneckSizeScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = structuredClone(
    healthyWebsiteState(deployedAt),
  );
  state.search.componentVersion =
    "search_visually_bad_low_volume";
  state.search.relevance = 0.28;
  state.search.synonymCoverage = 0.32;
  state.search.zeroResultBaseProbability = 0.42;
  state.checkout.componentVersion =
    "checkout_moderate_high_volume";
  state.checkout.formUsability = 0.62;
  state.checkout.mobileUsability = 0.6;
  state.checkout.excessiveSteps = 0.26;
  return {
    scenarioId: "bottleneck-size-trap",
    states: [state],
  };
}

export function weakPdpInformationScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = structuredClone(
    healthyWebsiteState(deployedAt),
  );
  state.pdp.componentVersion = "pdp_weak_content_v1";
  state.pdp.imageryQuality = 0.38;
  state.pdp.informationCompleteness = 0.34;
  state.pdp.deliveryClarity = 0.48;
  state.pdp.trust = 0.52;
  return {
    scenarioId: "weak-pdp-content",
    states: [state],
  };
}
