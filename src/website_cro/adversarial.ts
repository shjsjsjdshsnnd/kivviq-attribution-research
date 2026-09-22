import type { Intervention } from "../ground_truth/interventions.js";
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
      priceConfidenceSensitivity: 0.45,
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
      futureAffinityImpact: 0,
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

export function deviceNeutralWebsiteScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  const neutral: DevicePerformance = {
    mobile: performance(700, 0.96),
    desktop: performance(700, 0.96),
    tablet: performance(700, 0.96),
  };
  return {
    scenarioId: "device-neutral-control",
    states: [
      {
        ...state,
        homepage: {
          ...state.homepage,
          performance: structuredClone(neutral),
        },
        navigation: {
          ...state.navigation,
          performance: structuredClone(neutral),
        },
        collection: {
          ...state.collection,
          performance: structuredClone(neutral),
        },
        search: {
          ...state.search,
          performance: structuredClone(neutral),
        },
        pdp: {
          ...state.pdp,
          performance: structuredClone(neutral),
        },
        cart: {
          ...state.cart,
          performance: structuredClone(neutral),
        },
        checkout: {
          ...state.checkout,
          performance: structuredClone(neutral),
          mobileUsability: 0.93,
        },
      },
    ],
  };
}

export function slowMobilePdpScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  return {
    scenarioId: "slow-mobile-pdp-trap",
    states: [
      {
        ...state,
        pdp: {
          ...state.pdp,
          componentVersion: "pdp_slow_mobile_v1",
          performance: {
            ...state.pdp.performance,
            mobile: {
              ...state.pdp.performance.mobile,
              latencyMs: 7_200,
              interactionDelayMs: 1_650,
              responsiveness: 0.42,
              assetWeightProxy: 7.4,
            },
          },
        },
      },
    ],
  };
}

export function badSearchScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  return {
    scenarioId: "bad-search-trap",
    states: [
      {
        ...state,
        search: {
          ...state.search,
          componentVersion: "search_bad_v1",
          relevance: 0.12,
          synonymCoverage: 0.16,
          zeroResultBaseProbability: 0.34,
          reformulationSupport: 0.38,
          alternativeDiscovery: 0.25,
        },
      },
    ],
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
  const state = healthyWebsiteState(
    deployedAt,
    "website_bad_sorting",
    presentation,
  );
  return {
    scenarioId: "poor-collection-sorting-trap",
    states: [
      {
        ...state,
        collection: {
          ...state.collection,
          componentVersion: "collection_bad_sorting_v1",
          rankingQuality: 0.08,
        },
      },
    ],
  };
}

export function brokenCouponScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  return {
    scenarioId: "broken-coupon-trap",
    states: [
      {
        ...state,
        cart: {
          ...state.cart,
          componentVersion: "cart_coupon_defect_v1",
          couponReliability: 0.03,
          promotionVisibility: 0.96,
        },
      },
    ],
  };
}

export function shippingSurpriseScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  return {
    scenarioId: "shipping-surprise-trap",
    states: [
      {
        ...state,
        pdp: {
          ...state.pdp,
          componentVersion: "pdp_hidden_shipping_v1",
          deliveryClarity: 0.3,
        },
        cart: {
          ...state.cart,
          componentVersion: "cart_hidden_shipping_v1",
          shippingVisibility: 0.12,
        },
        checkout: {
          ...state.checkout,
          componentVersion: "checkout_late_shipping_v1",
          shippingCostVisibility: "checkout_review",
          futureAffinityImpact: 0.035,
        },
      },
    ],
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
  const baselineAfter = healthyWebsiteState(
    regressionDeployedAt,
    "website_checkout_regression",
  );
  const after: WebsiteState = {
    ...baselineAfter,
    checkout: {
      ...baselineAfter.checkout,
      componentVersion: "checkout_v2",
      mobileUsability: 0.25,
      formUsability: 0.55,
      addressValidationReliability: 0.34,
      performance: {
        ...baselineAfter.checkout.performance,
        mobile: {
          ...baselineAfter.checkout.performance.mobile,
          interactionDelayMs: 1_900,
          responsiveness: 0.48,
        },
      },
    },
  };

  return {
    scenarioId: "checkout-regression-trap",
    states: [before, after],
  };
}

export function bottleneckSizeScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  return {
    scenarioId: "bottleneck-size-trap",
    states: [
      {
        ...state,
        search: {
          ...state.search,
          componentVersion:
            "search_visually_bad_low_volume",
          relevance: 0.28,
          synonymCoverage: 0.32,
          zeroResultBaseProbability: 0.42,
        },
        checkout: {
          ...state.checkout,
          componentVersion:
            "checkout_moderate_high_volume",
          formUsability: 0.62,
          mobileUsability: 0.6,
          excessiveSteps: 0.26,
      futureAffinityImpact: 0.02,
        },
      },
    ],
  };
}

export function weakPdpInformationScenario(
  deployedAt: string,
): WebsiteScenario {
  const state = healthyWebsiteState(deployedAt);
  return {
    scenarioId: "weak-pdp-content",
    states: [
      {
        ...state,
        pdp: {
          ...state.pdp,
          componentVersion: "pdp_weak_content_v1",
          imageryQuality: 0.38,
          informationCompleteness: 0.34,
          deliveryClarity: 0.48,
          trust: 0.52,
        },
      },
    ],
  };
}


export const FIX_SLOW_MOBILE_PDP: Intervention = {
  variable: "website.pdp.mobile.latency_seconds",
  operation: "set",
  value: {
    kind: "number",
    value: 1,
    unit: "seconds",
  },
  population: { devices: ["mobile"] },
};

export const FIX_SEARCH_RELEVANCE: Intervention = {
  variable: "website.search.relevance",
  operation: "set",
  value: {
    kind: "number",
    value: 0.96,
    unit: "dimensionless",
  },
};

export const FIX_COLLECTION_RANKING: Intervention = {
  variable: "website.collection.ranking_quality",
  operation: "set",
  value: {
    kind: "number",
    value: 0.96,
    unit: "dimensionless",
  },
};

export const FIX_COUPON_FUNCTIONALITY: Intervention = {
  variable: "website.cart.coupon_reliability",
  operation: "set",
  value: {
    kind: "number",
    value: 0.998,
    unit: "dimensionless",
  },
};

export const FIX_CHECKOUT_DEFECT: Intervention = {
  variable: "website.checkout.fix_defect",
  operation: "set",
  value: {
    kind: "boolean",
    value: true,
  },
};

export const CLARIFY_SHIPPING_EARLIER: Intervention = {
  variable: "website.checkout.shipping_cost_visibility",
  operation: "set",
  value: {
    kind: "category",
    value: "cart",
  },
};

export const IMPROVE_PDP_IMAGERY: Intervention = {
  variable: "website.pdp.imagery_quality",
  operation: "set",
  value: {
    kind: "number",
    value: 0.96,
    unit: "dimensionless",
  },
};
