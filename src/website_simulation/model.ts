import {
  WEBSITE_MODEL_VERSION,
  WEBSITE_SCHEMA_VERSION,
  type CanonicalWebsiteDevice,
  type DeviceExperienceState,
  type WebsiteScenarioId,
  type WebsiteState,
  type WebsiteSurface,
} from "./types.js";

const score = (value: number): number => value;

const healthyDeviceExperience = (
  device: CanonicalWebsiteDevice,
): DeviceExperienceState => {
  const mobile = device === "mobile";
  return {
    homepage: {
      loadTimeMs: mobile ? 1450 : 950,
      usabilityScore: mobile ? 0.88 : 0.93,
      layoutStability: 0.93,
    },
    collections: {
      loadTimeMs: mobile ? 1550 : 1050,
      usabilityScore: mobile ? 0.87 : 0.93,
      layoutStability: 0.92,
    },
    pdp: {
      loadTimeMs: mobile ? 1650 : 1100,
      usabilityScore: mobile ? 0.88 : 0.94,
      layoutStability: 0.92,
    },
    cart: {
      loadTimeMs: mobile ? 1250 : 900,
      usabilityScore: mobile ? 0.9 : 0.95,
      layoutStability: 0.95,
    },
    checkout: {
      loadTimeMs: mobile ? 1400 : 1000,
      usabilityScore: mobile ? 0.9 : 0.95,
      layoutStability: 0.95,
    },
    search: {
      loadTimeMs: mobile ? 1200 : 800,
      usabilityScore: mobile ? 0.88 : 0.94,
      layoutStability: 0.94,
    },
    navigation: {
      loadTimeMs: mobile ? 250 : 120,
      usabilityScore: mobile ? 0.87 : 0.95,
      layoutStability: 0.97,
    },
  };
};

export function createHealthyWebsiteState(): WebsiteState {
  return {
    version: WEBSITE_MODEL_VERSION,
    schemaVersion: WEBSITE_SCHEMA_VERSION,
    homepage: {
      loadTimeMs: 1100,
      heroRelevance: score(0.9),
      promotionalClarity: score(0.9),
      valuePropositionClarity: score(0.9),
      navigationClarity: score(0.91),
      merchandisingQuality: score(0.89),
      trustSignalStrength: score(0.9),
      mobileUsability: score(0.88),
      visualQuality: score(0.91),
    },
    collections: {
      loadTimeMs: 1200,
      sortQuality: score(0.9),
      filterQuality: score(0.88),
      productRankingRelevance: score(0.9),
      productCardInformationQuality: score(0.9),
      imageryQuality: score(0.9),
      promotionalVisibility: score(0.88),
      stockVisibility: score(0.9),
      priceVisibility: score(0.95),
      mobileUsability: score(0.87),
    },
    pdp: {
      loadTimeMs: 1250,
      imageQuality: score(0.93),
      imageQuantity: 6,
      productDescriptionQuality: score(0.9),
      priceClarity: score(0.96),
      variantSelectionUsability: score(0.9),
      stockClarity: score(0.9),
      deliveryInformationClarity: score(0.88),
      returnsInformationClarity: score(0.88),
      trustStrength: score(0.9),
      reviewsStrength: score(0.85),
      recommendationQuality: score(0.82),
      mobileUsability: score(0.88),
      ctaVisibility: score(0.94),
    },
    cart: {
      loadTimeMs: 950,
      priceClarity: score(0.96),
      shippingVisibility: score(0.9),
      discountCodeUsability: score(0.9),
      upsellQuality: score(0.78),
      cartEditUsability: score(0.92),
      checkoutCtaClarity: score(0.96),
      trustSignals: score(0.9),
      mobileUsability: score(0.9),
    },
    checkout: {
      loadTimeMs: 1050,
      formComplexity: score(0.2),
      paymentOptions: 4,
      shippingCostSurprise: score(0.08),
      shippingSpeedClarity: score(0.9),
      errorRate: score(0.015),
      couponReliability: score(0.985),
      trust: score(0.94),
      mobileUsability: score(0.9),
      numberOfSteps: 2,
    },
    search: {
      searchSpeedMs: 650,
      resultRelevance: score(0.91),
      typoTolerance: score(0.9),
      synonymHandling: score(0.88),
      zeroResultRate: score(0.025),
      filteringQuality: score(0.87),
      merchandisingQuality: score(0.84),
      mobileUsability: score(0.88),
    },
    navigation: {
      hierarchyClarity: score(0.92),
      categoryDiscoverability: score(0.9),
      depth: 2,
      mobileMenuQuality: score(0.88),
      brokenLinkRate: score(0.002),
      namingClarity: score(0.94),
    },
    deviceExperience: {
      mobile: healthyDeviceExperience("mobile"),
      desktop: healthyDeviceExperience("desktop"),
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertFiniteInRange(
  name: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and within [${min}, ${max}]`);
  }
}

function validateScoreObject(
  prefix: string,
  value: Record<string, unknown>,
  numericExceptions: Readonly<Record<string, readonly [number, number]>> = {},
): void {
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "number") continue;
    const range = numericExceptions[key] ?? ([0, 1] as const);
    assertFiniteInRange(`${prefix}.${key}`, raw, range[0], range[1]);
  }
}

export function validateWebsiteState(state: WebsiteState): void {
  if (state.version !== WEBSITE_MODEL_VERSION) {
    throw new RangeError(`unsupported website model version: ${state.version}`);
  }
  if (state.schemaVersion !== WEBSITE_SCHEMA_VERSION) {
    throw new RangeError(`unsupported website schema version: ${state.schemaVersion}`);
  }

  validateScoreObject("homepage", state.homepage as unknown as Record<string, unknown>, {
    loadTimeMs: [0, 30_000],
  });
  validateScoreObject("collections", state.collections as unknown as Record<string, unknown>, {
    loadTimeMs: [0, 30_000],
  });
  validateScoreObject("pdp", state.pdp as unknown as Record<string, unknown>, {
    loadTimeMs: [0, 30_000],
    imageQuantity: [1, 20],
  });
  validateScoreObject("cart", state.cart as unknown as Record<string, unknown>, {
    loadTimeMs: [0, 30_000],
  });
  validateScoreObject("checkout", state.checkout as unknown as Record<string, unknown>, {
    loadTimeMs: [0, 30_000],
    paymentOptions: [1, 12],
    numberOfSteps: [1, 10],
  });
  validateScoreObject("search", state.search as unknown as Record<string, unknown>, {
    searchSpeedMs: [0, 30_000],
  });
  validateScoreObject("navigation", state.navigation as unknown as Record<string, unknown>, {
    depth: [1, 8],
  });

  for (const device of ["mobile", "desktop"] as const) {
    for (const [surface, experience] of Object.entries(state.deviceExperience[device])) {
      assertFiniteInRange(
        `deviceExperience.${device}.${surface}.loadTimeMs`,
        experience.loadTimeMs,
        0,
        30_000,
      );
      assertFiniteInRange(
        `deviceExperience.${device}.${surface}.usabilityScore`,
        experience.usabilityScore,
        0,
        1,
      );
      assertFiniteInRange(
        `deviceExperience.${device}.${surface}.layoutStability`,
        experience.layoutStability,
        0,
        1,
      );
    }
  }
}

function withDeviceSurface(
  state: WebsiteState,
  device: CanonicalWebsiteDevice,
  surface: keyof DeviceExperienceState,
  patch: Partial<DeviceExperienceState[keyof DeviceExperienceState]>,
): WebsiteState {
  const next = clone(state);
  const current = next.deviceExperience[device][surface];
  (next.deviceExperience[device] as unknown as Record<string, unknown>)[surface] = {
    ...current,
    ...patch,
  };
  return next;
}

export function createWebsiteScenario(
  scenario: WebsiteScenarioId,
): WebsiteState {
  let state = createHealthyWebsiteState();

  switch (scenario) {
    case "healthy_website":
      break;
    case "slow_mobile_pdp":
      state = withDeviceSurface(state, "mobile", "pdp", {
        loadTimeMs: 6800,
        usabilityScore: 0.72,
        layoutStability: 0.55,
      });
      break;
    case "poor_checkout": {
      const next = clone(state);
      (next as { checkout: WebsiteState["checkout"] }).checkout = {
        ...next.checkout,
        formComplexity: 0.72,
        paymentOptions: 2,
        shippingSpeedClarity: 0.58,
        errorRate: 0.12,
        trust: 0.66,
        numberOfSteps: 6,
      };
      state = withDeviceSurface(next, "mobile", "checkout", {
        loadTimeMs: 3700,
        usabilityScore: 0.62,
        layoutStability: 0.76,
      });
      state = withDeviceSurface(state, "desktop", "checkout", {
        loadTimeMs: 2600,
        usabilityScore: 0.72,
        layoutStability: 0.84,
      });
      break;
    }
    case "bad_search": {
      const next = clone(state);
      (next as { search: WebsiteState["search"] }).search = {
        ...next.search,
        searchSpeedMs: 2400,
        resultRelevance: 0.45,
        typoTolerance: 0.35,
        synonymHandling: 0.4,
        zeroResultRate: 0.28,
        filteringQuality: 0.5,
        merchandisingQuality: 0.48,
      };
      state = next;
      break;
    }
    case "weak_product_imagery": {
      const next = clone(state);
      (next as { pdp: WebsiteState["pdp"] }).pdp = {
        ...next.pdp,
        imageQuality: 0.42,
        imageQuantity: 2,
        recommendationQuality: 0.7,
      };
      state = next;
      break;
    }
    case "shipping_surprise": {
      const next = clone(state);
      (next as { cart: WebsiteState["cart"] }).cart = {
        ...next.cart,
        shippingVisibility: 0.35,
      };
      (next as { checkout: WebsiteState["checkout"] }).checkout = {
        ...next.checkout,
        shippingCostSurprise: 0.88,
        shippingSpeedClarity: 0.46,
      };
      state = next;
      break;
    }
    case "broken_coupon": {
      const next = clone(state);
      (next as { cart: WebsiteState["cart"] }).cart = {
        ...next.cart,
        discountCodeUsability: 0.5,
      };
      (next as { checkout: WebsiteState["checkout"] }).checkout = {
        ...next.checkout,
        couponReliability: 0.34,
        errorRate: 0.055,
      };
      state = next;
      break;
    }
    case "poor_collection_sorting": {
      const next = clone(state);
      (next as { collections: WebsiteState["collections"] }).collections = {
        ...next.collections,
        sortQuality: 0.34,
        productRankingRelevance: 0.4,
        stockVisibility: 0.58,
        filterQuality: 0.66,
      };
      state = next;
      break;
    }
    case "multiple_cro_issues": {
      state = createWebsiteScenario("slow_mobile_pdp");
      const next = clone(state);
      const poorCheckout = createWebsiteScenario("poor_checkout");
      const badSearch = createWebsiteScenario("bad_search");
      const shipping = createWebsiteScenario("shipping_surprise");
      const sorting = createWebsiteScenario("poor_collection_sorting");
      (next as { checkout: WebsiteState["checkout"] }).checkout = poorCheckout.checkout;
      (next as { search: WebsiteState["search"] }).search = badSearch.search;
      (next as { cart: WebsiteState["cart"] }).cart = shipping.cart;
      (next as { collections: WebsiteState["collections"] }).collections = sorting.collections;
      (next.deviceExperience as { mobile: DeviceExperienceState; desktop: DeviceExperienceState }).mobile.checkout =
        poorCheckout.deviceExperience.mobile.checkout;
      (next.deviceExperience as { mobile: DeviceExperienceState; desktop: DeviceExperienceState }).desktop.checkout =
        poorCheckout.deviceExperience.desktop.checkout;
      state = next;
      break;
    }
    case "subtle_mobile_checkout_drag": {
      const next = clone(state);
      (next as { homepage: WebsiteState["homepage"] }).homepage = {
        ...next.homepage,
        heroRelevance: 0.97,
        promotionalClarity: 0.97,
        merchandisingQuality: 0.94,
      };
      (next as { checkout: WebsiteState["checkout"] }).checkout = {
        ...next.checkout,
        formComplexity: 0.33,
        shippingCostSurprise: 0.22,
        errorRate: 0.035,
      };
      state = withDeviceSurface(next, "mobile", "checkout", {
        loadTimeMs: 2850,
        usabilityScore: 0.78,
        layoutStability: 0.83,
      });
      break;
    }
  }

  validateWebsiteState(state);
  return state;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function serializeWebsiteState(state: WebsiteState): string {
  validateWebsiteState(state);
  return JSON.stringify(canonicalize(state));
}

export function websiteStateFingerprint(state: WebsiteState): string {
  return `${WEBSITE_MODEL_VERSION}:${fnv1a32(serializeWebsiteState(state))}`;
}

export function websiteSurfaceLoadTimeMs(
  state: WebsiteState,
  deviceInput: "mobile" | "desktop" | "tablet",
  surface: WebsiteSurface,
): number {
  const device = deviceInput === "mobile" ? "mobile" : "desktop";
  if (surface === "navigation") {
    return state.deviceExperience[device].navigation.loadTimeMs;
  }
  return state.deviceExperience[device][surface].loadTimeMs;
}

export function measuredWebsiteLoadTimeMs(
  state: WebsiteState,
  device: "mobile" | "desktop" | "tablet",
  surface: WebsiteSurface,
  noiseUnit: number,
): number {
  const base = websiteSurfaceLoadTimeMs(state, device, surface);
  const boundedNoise = Math.max(0, Math.min(1, noiseUnit));
  return Math.max(1, Math.round(base * (0.9 + boundedNoise * 0.2)));
}
