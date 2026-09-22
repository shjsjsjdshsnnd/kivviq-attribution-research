import type { Intervention } from "../ground_truth/interventions.js";
import type {
  CheckoutExperience,
  PageExperience,
  PagePerformance,
  ProductPresentation,
  WebsiteCausalEvent,
  WebsiteComponentName,
  WebsiteCustomerContext,
  WebsiteDevice,
  WebsiteFrictionKind,
  WebsiteScenario,
  WebsiteState,
} from "./types.js";

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, value));

const componentNames = [
  "homepage",
  "navigation",
  "collection",
  "search",
  "pdp",
  "cart",
  "checkout",
] as const;

function assertUnitInterval(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${path} must be in [0, 1]`);
  }
}

function validatePerformance(
  performance: PagePerformance,
  path: string,
): void {
  if (!Number.isFinite(performance.latencyMs) || performance.latencyMs < 0) {
    throw new RangeError(`${path}.latencyMs must be non-negative`);
  }
  if (
    !Number.isFinite(performance.interactionDelayMs) ||
    performance.interactionDelayMs < 0
  ) {
    throw new RangeError(
      `${path}.interactionDelayMs must be non-negative`,
    );
  }
  if (
    !Number.isFinite(performance.assetWeightProxy) ||
    performance.assetWeightProxy < 0
  ) {
    throw new RangeError(
      `${path}.assetWeightProxy must be non-negative`,
    );
  }
  assertUnitInterval(
    performance.loadSuccessProbability,
    `${path}.loadSuccessProbability`,
  );
  assertUnitInterval(performance.responsiveness, `${path}.responsiveness`);
}

function validateState(state: WebsiteState): void {
  if (!state.versionId) {
    throw new RangeError("website state versionId is required");
  }
  const deployedAt = Date.parse(state.deployedAt);
  if (!Number.isFinite(deployedAt)) {
    throw new RangeError("website state deployedAt must be an ISO timestamp");
  }

  for (const componentName of componentNames) {
    const component = state[componentName];
    if (!component.componentVersion) {
      throw new RangeError(
        `${componentName}.componentVersion is required`,
      );
    }
    for (const device of ["mobile", "desktop", "tablet"] as const) {
      validatePerformance(
        component.performance[device],
        `${componentName}.performance.${device}`,
      );
    }
  }

  const unitValues: readonly [number, string][] = [
    [state.homepage.discoveryQuality, "homepage.discoveryQuality"],
    [state.homepage.merchandisingRelevance, "homepage.merchandisingRelevance"],
    [state.homepage.navigationClarity, "homepage.navigationClarity"],
    [state.homepage.promotionalClarity, "homepage.promotionalClarity"],
    [state.homepage.visibility, "homepage.visibility"],
    [state.navigation.categoryDiscoverability, "navigation.categoryDiscoverability"],
    [state.navigation.hierarchyClarity, "navigation.hierarchyClarity"],
    [state.navigation.pathEfficiency, "navigation.pathEfficiency"],
    [state.navigation.mobileMenuUsability, "navigation.mobileMenuUsability"],
    [state.collection.rankingQuality, "collection.rankingQuality"],
    [state.collection.filteringUsability, "collection.filteringUsability"],
    [state.collection.sortingUsability, "collection.sortingUsability"],
    [state.collection.productDensity, "collection.productDensity"],
    [state.collection.relevance, "collection.relevance"],
    [state.collection.availabilityVisibility, "collection.availabilityVisibility"],
    [state.search.relevance, "search.relevance"],
    [state.search.synonymCoverage, "search.synonymCoverage"],
    [state.search.zeroResultBaseProbability, "search.zeroResultBaseProbability"],
    [state.search.reformulationSupport, "search.reformulationSupport"],
    [state.search.alternativeDiscovery, "search.alternativeDiscovery"],
    [state.pdp.imageryQuality, "pdp.imageryQuality"],
    [state.pdp.informationCompleteness, "pdp.informationCompleteness"],
    [state.pdp.priceClarity, "pdp.priceClarity"],
    [state.pdp.variantSelectionUsability, "pdp.variantSelectionUsability"],
    [state.pdp.inventoryClarity, "pdp.inventoryClarity"],
    [state.pdp.deliveryClarity, "pdp.deliveryClarity"],
    [state.pdp.trust, "pdp.trust"],
    [state.pdp.socialProof, "pdp.socialProof"],
    [state.pdp.ctaUsability, "pdp.ctaUsability"],
    [state.cart.clarity, "cart.clarity"],
    [state.cart.shippingVisibility, "cart.shippingVisibility"],
    [state.cart.promotionVisibility, "cart.promotionVisibility"],
    [state.cart.couponReliability, "cart.couponReliability"],
    [state.cart.crossSellRelevance, "cart.crossSellRelevance"],
    [state.cart.quantityEditingUsability, "cart.quantityEditingUsability"],
    [state.cart.persistenceProbability, "cart.persistenceProbability"],
    [state.checkout.contactUsability, "checkout.contactUsability"],
    [state.checkout.shippingUsability, "checkout.shippingUsability"],
    [state.checkout.paymentUsability, "checkout.paymentUsability"],
    [state.checkout.reviewUsability, "checkout.reviewUsability"],
    [state.checkout.formUsability, "checkout.formUsability"],
    [state.checkout.mobileUsability, "checkout.mobileUsability"],
    [state.checkout.accountRequirementFriction, "checkout.accountRequirementFriction"],
    [state.checkout.addressValidationReliability, "checkout.addressValidationReliability"],
    [state.checkout.paymentReliability, "checkout.paymentReliability"],
    [state.checkout.excessiveSteps, "checkout.excessiveSteps"],
  ];

  for (const [value, path] of unitValues) assertUnitInterval(value, path);

  for (const product of state.productPresentation ?? []) {
    if (!product.productId) {
      throw new RangeError("productPresentation.productId is required");
    }
    for (const [key, value] of Object.entries(product)) {
      if (key === "productId" || value === undefined) continue;
      assertUnitInterval(
        Number(value),
        `productPresentation[${product.productId}].${key}`,
      );
    }
  }

  for (const category of state.categorySensitivity ?? []) {
    if (!category.categoryId) {
      throw new RangeError("categorySensitivity.categoryId is required");
    }
    assertUnitInterval(category.imageryImportance, "imageryImportance");
    assertUnitInterval(category.informationImportance, "informationImportance");
    assertUnitInterval(category.trustImportance, "trustImportance");
    assertUnitInterval(category.deliveryImportance, "deliveryImportance");
  }
}

export function validateWebsiteScenario(scenario: WebsiteScenario): void {
  if (!scenario.scenarioId) {
    throw new RangeError("website scenarioId is required");
  }
  if (scenario.states.length === 0) {
    throw new RangeError("website scenario requires at least one state");
  }

  const versions = new Set<string>();
  let previous = Number.NEGATIVE_INFINITY;
  for (const state of scenario.states) {
    validateState(state);
    if (versions.has(state.versionId)) {
      throw new RangeError(`duplicate website version ${state.versionId}`);
    }
    versions.add(state.versionId);
    const deployedAt = Date.parse(state.deployedAt);
    if (deployedAt <= previous) {
      throw new RangeError(
        "website states must be strictly ordered by deployedAt",
      );
    }
    previous = deployedAt;
  }
}

function activeAt(
  intervention: Intervention,
  timestampMs: number,
): boolean {
  if (intervention.effectiveAt === undefined) return true;
  const start = Date.parse(intervention.effectiveAt);
  if (!Number.isFinite(start) || timestampMs < start) return false;
  if (intervention.durationSeconds === undefined) return true;
  return timestampMs < start + Number(intervention.durationSeconds) * 1_000;
}

function populationMatches(
  intervention: Intervention,
  device: WebsiteDevice,
  productId?: string,
  categoryId?: string,
): boolean {
  const population = intervention.population;
  if (!population) return true;
  if (
    population.devices !== undefined &&
    !population.devices.includes(device)
  ) {
    return false;
  }
  if (
    population.productIds !== undefined &&
    productId !== undefined &&
    !population.productIds.includes(productId)
  ) {
    return false;
  }
  if (
    population.categoryIds !== undefined &&
    categoryId !== undefined &&
    !population.categoryIds.includes(categoryId)
  ) {
    return false;
  }
  return true;
}

function setNumber(
  target: Record<string, unknown>,
  key: string,
  intervention: Intervention,
  min = 0,
  max = 1,
): void {
  if (intervention.value.kind !== "number") {
    throw new RangeError(
      `${intervention.variable} must use a numeric intervention value`,
    );
  }
  target[key] = Math.min(
    max,
    Math.max(min, intervention.value.value),
  );
}

function applyIntervention(
  state: WebsiteState,
  intervention: Intervention,
  device: WebsiteDevice,
): void {
  const mutable = state as unknown as {
    pdp: {
      imageryQuality: number;
      informationCompleteness: number;
      deliveryClarity: number;
      performance: Record<WebsiteDevice, PagePerformance>;
    };
    search: { relevance: number };
    checkout: {
      formUsability: number;
      mobileUsability: number;
      addressValidationReliability: number;
      paymentReliability: number;
    };
    cart: { couponReliability: number; shippingVisibility: number };
    collection: { rankingQuality: number };
  };

  switch (intervention.variable) {
    case "website.pdp.mobile.latency_ms": {
      if (intervention.value.kind !== "number") {
        throw new RangeError("website.pdp.mobile.latency_ms must be numeric");
      }
      mutable.pdp.performance.mobile = {
        ...mutable.pdp.performance.mobile,
        latencyMs: Math.max(0, intervention.value.value),
      };
      return;
    }
    case "website.pdp.imagery_quality":
      setNumber(
        mutable.pdp as unknown as Record<string, unknown>,
        "imageryQuality",
        intervention,
      );
      return;
    case "website.pdp.information_completeness":
      setNumber(
        mutable.pdp as unknown as Record<string, unknown>,
        "informationCompleteness",
        intervention,
      );
      return;
    case "website.pdp.delivery_clarity":
      setNumber(
        mutable.pdp as unknown as Record<string, unknown>,
        "deliveryClarity",
        intervention,
      );
      return;
    case "website.search.relevance":
      setNumber(
        mutable.search as unknown as Record<string, unknown>,
        "relevance",
        intervention,
      );
      return;
    case "website.collection.ranking_quality":
      setNumber(
        mutable.collection as unknown as Record<string, unknown>,
        "rankingQuality",
        intervention,
      );
      return;
    case "website.cart.coupon_reliability":
      setNumber(
        mutable.cart as unknown as Record<string, unknown>,
        "couponReliability",
        intervention,
      );
      return;
    case "website.cart.shipping_visibility":
      setNumber(
        mutable.cart as unknown as Record<string, unknown>,
        "shippingVisibility",
        intervention,
      );
      return;
    case "website.checkout.form_usability":
      setNumber(
        mutable.checkout as unknown as Record<string, unknown>,
        "formUsability",
        intervention,
      );
      return;
    case "website.checkout.mobile_usability":
      setNumber(
        mutable.checkout as unknown as Record<string, unknown>,
        "mobileUsability",
        intervention,
      );
      return;
    case "website.checkout.address_validation_reliability":
      setNumber(
        mutable.checkout as unknown as Record<string, unknown>,
        "addressValidationReliability",
        intervention,
      );
      return;
    case "website.checkout.payment_reliability":
      setNumber(
        mutable.checkout as unknown as Record<string, unknown>,
        "paymentReliability",
        intervention,
      );
      return;
    default:
      throw new RangeError(
        `unsupported Step 12 website intervention target ${intervention.variable}`,
      );
  }
}

export function resolveWebsiteState(
  scenario: WebsiteScenario,
  timestampMs: number,
  device: WebsiteDevice,
  productId?: string,
  categoryId?: string,
): WebsiteState {
  const eligible = scenario.states.filter(
    (state) => Date.parse(state.deployedAt) <= timestampMs,
  );
  const source = eligible[eligible.length - 1] ?? scenario.states[0]!;
  const resolved = structuredClone(source) as WebsiteState;

  for (const intervention of scenario.interventions ?? []) {
    if (!activeAt(intervention, timestampMs)) continue;
    if (
      !populationMatches(
        intervention,
        device,
        productId,
        categoryId,
      )
    ) {
      continue;
    }
    applyIntervention(resolved, intervention, device);
  }

  return resolved;
}

function productPresentation(
  state: WebsiteState,
  productId?: string,
): ProductPresentation | undefined {
  if (productId === undefined) return undefined;
  return state.productPresentation?.find(
    (candidate) => candidate.productId === productId,
  );
}

function nonlinearQualityMultiplier(quality: number): number {
  const q = clamp(quality);
  // Terrible -> acceptable has much larger marginal effect than good -> excellent.
  return 0.45 + 0.72 * (1 - Math.exp(-2.7 * q));
}

function performanceExperience(
  performance: PagePerformance,
  customer: WebsiteCustomerContext,
  device: WebsiteDevice,
): {
  readonly continuationMultiplier: number;
  readonly latencyMultiplier: number;
  readonly loadFailureProbability: number;
  readonly latencyFriction: boolean;
} {
  const patienceMs =
    850 +
    customer.intent * 1_900 +
    customer.need * 1_200 +
    customer.brandAffinity * 700 +
    (device === "desktop" ? 500 : device === "tablet" ? 220 : 0);
  const excessLatency = Math.max(
    0,
    performance.latencyMs - patienceMs,
  );
  const latencyHazard =
    1 - Math.exp(-excessLatency / 2_400);
  const intentResilience =
    1 - 0.42 * customer.intent - 0.18 * customer.need;
  const latencyMultiplier = clamp(
    1 - 0.78 * latencyHazard * intentResilience,
    0.08,
    1,
  );
  const responsivenessMultiplier =
    0.72 + performance.responsiveness * 0.28;

  return {
    continuationMultiplier:
      latencyMultiplier * responsivenessMultiplier,
    latencyMultiplier,
    loadFailureProbability:
      clamp(1 - performance.loadSuccessProbability),
    latencyFriction: excessLatency > 250,
  };
}

function componentQuality(
  state: WebsiteState,
  component: WebsiteComponentName,
  device: WebsiteDevice,
  customer: WebsiteCustomerContext,
  productId?: string,
  categoryId?: string,
): {
  readonly quality: number;
  readonly frictions: WebsiteFrictionKind[];
} {
  const frictions: WebsiteFrictionKind[] = [];

  if (component === "homepage") {
    const value =
      state.homepage.discoveryQuality * 0.28 +
      state.homepage.merchandisingRelevance * 0.24 +
      state.homepage.navigationClarity * 0.2 +
      state.homepage.promotionalClarity * 0.12 +
      state.homepage.visibility * 0.16;
    if (value < 0.55) frictions.push("poor_navigation");
    return { quality: value, frictions };
  }

  if (component === "navigation") {
    const mobileWeight = device === "mobile" ? 0.32 : 0.08;
    const value =
      state.navigation.categoryDiscoverability * 0.3 +
      state.navigation.hierarchyClarity * 0.28 +
      state.navigation.pathEfficiency * (0.42 - mobileWeight) +
      state.navigation.mobileMenuUsability * mobileWeight;
    if (value < 0.55) frictions.push("poor_navigation");
    return { quality: value, frictions };
  }

  if (component === "collection") {
    const value =
      state.collection.rankingQuality * 0.3 +
      state.collection.filteringUsability * 0.15 +
      state.collection.sortingUsability * 0.14 +
      state.collection.productDensity * 0.09 +
      state.collection.relevance * 0.24 +
      state.collection.availabilityVisibility * 0.08;
    if (state.collection.rankingQuality < 0.52) {
      frictions.push("poor_collection_ranking");
    }
    return { quality: value, frictions };
  }

  if (component === "search") {
    const value =
      state.search.relevance * 0.46 +
      state.search.synonymCoverage * 0.22 +
      state.search.reformulationSupport * 0.15 +
      state.search.alternativeDiscovery * 0.17;
    if (
      state.search.relevance < 0.58 ||
      state.search.synonymCoverage < 0.52
    ) {
      frictions.push("search_relevance");
    }
    return { quality: value, frictions };
  }

  if (component === "pdp") {
    const presentation = productPresentation(state, productId);
    const category = state.categorySensitivity?.find(
      (candidate) => candidate.categoryId === categoryId,
    );
    const imagery =
      presentation?.imageryQuality ?? state.pdp.imageryQuality;
    const information =
      presentation?.informationCompleteness ??
      state.pdp.informationCompleteness;
    const delivery =
      presentation?.deliveryClarity ?? state.pdp.deliveryClarity;
    const imageryImportance = category?.imageryImportance ?? 0.72;
    const infoImportance = category?.informationImportance ?? 0.72;
    const trustImportance = category?.trustImportance ?? 0.62;
    const deliveryImportance = category?.deliveryImportance ?? 0.6;
    const informationNeed = clamp(
      0.35 +
        customer.priceSensitivityMultiplier * 0.15 +
        (1 - customer.brandAffinity) * 0.28,
    );
    const weighted =
      imagery * (0.12 + 0.11 * imageryImportance) +
      information *
        (0.12 + 0.13 * infoImportance * informationNeed) +
      state.pdp.priceClarity * 0.09 +
      state.pdp.variantSelectionUsability * 0.08 +
      state.pdp.inventoryClarity * 0.07 +
      delivery * (0.08 + 0.1 * deliveryImportance) +
      state.pdp.trust * (0.08 + 0.08 * trustImportance) +
      state.pdp.socialProof * 0.05 +
      state.pdp.ctaUsability * 0.08;
    const denominator =
      (0.12 + 0.11 * imageryImportance) +
      (0.12 + 0.13 * infoImportance * informationNeed) +
      0.09 +
      0.08 +
      0.07 +
      (0.08 + 0.1 * deliveryImportance) +
      (0.08 + 0.08 * trustImportance) +
      0.05 +
      0.08;
    if (imagery < 0.52) frictions.push("weak_imagery");
    if (information < 0.52) frictions.push("missing_information");
    if (delivery < 0.52) frictions.push("unclear_delivery");
    return { quality: weighted / denominator, frictions };
  }

  if (component === "cart") {
    const value =
      state.cart.clarity * 0.25 +
      state.cart.shippingVisibility * 0.2 +
      state.cart.promotionVisibility * 0.12 +
      state.cart.quantityEditingUsability * 0.12 +
      state.cart.persistenceProbability * 0.12 +
      state.cart.crossSellRelevance * 0.07 +
      state.cart.couponReliability * 0.12;
    if (value < 0.58) frictions.push("cart_friction");
    if (state.cart.couponReliability < 0.6) {
      frictions.push("broken_coupon");
    }
    return { quality: value, frictions };
  }

  const mobileUsability =
    device === "mobile" ? state.checkout.mobileUsability : 1;
  const value =
    state.checkout.contactUsability * 0.12 +
    state.checkout.shippingUsability * 0.14 +
    state.checkout.paymentUsability * 0.16 +
    state.checkout.reviewUsability * 0.08 +
    state.checkout.formUsability * 0.18 +
    mobileUsability * 0.14 +
    (1 - state.checkout.accountRequirementFriction) * 0.08 +
    (1 - state.checkout.excessiveSteps) * 0.1;
  if (value < 0.62) frictions.push("checkout_friction");
  return { quality: value, frictions };
}

export function websitePageExperience(input: {
  readonly scenario?: WebsiteScenario;
  readonly timestampMs: number;
  readonly component: WebsiteComponentName;
  readonly device: WebsiteDevice;
  readonly customer: WebsiteCustomerContext;
  readonly productId?: string;
  readonly categoryId?: string;
}): PageExperience | undefined {
  if (input.scenario === undefined) return undefined;
  const state = resolveWebsiteState(
    input.scenario,
    input.timestampMs,
    input.device,
    input.productId,
    input.categoryId,
  );
  const component = state[input.component];
  const performance = component.performance[input.device];
  const performanceResult = performanceExperience(
    performance,
    input.customer,
    input.device,
  );
  const quality = componentQuality(
    state,
    input.component,
    input.device,
    input.customer,
    input.productId,
    input.categoryId,
  );
  const frictions = [...quality.frictions];
  if (performanceResult.latencyFriction) frictions.push("latency");
  if (performanceResult.loadFailureProbability > 0.02) {
    frictions.push("load_failure");
  }

  const transitionMultiplier =
    nonlinearQualityMultiplier(quality.quality) *
    performanceResult.latencyMultiplier;

  return {
    component: input.component,
    componentVersion: component.componentVersion,
    websiteVersionId: state.versionId,
    continuationMultiplier: clamp(
      performanceResult.continuationMultiplier *
        (0.78 + 0.22 * nonlinearQualityMultiplier(quality.quality)),
      0.04,
      1.18,
    ),
    transitionMultiplier: clamp(
      transitionMultiplier,
      0.08,
      1.18,
    ),
    latencyMs: performance.latencyMs,
    interactionDelayMs: performance.interactionDelayMs,
    loadFailureProbability: performanceResult.loadFailureProbability,
    frictions: [...new Set(frictions)],
  };
}

export function websiteProductDiscoveryMultiplier(input: {
  readonly scenario?: WebsiteScenario;
  readonly timestampMs: number;
  readonly device: WebsiteDevice;
  readonly surface: "collection" | "search_results" | "pdp";
  readonly productId: string;
  readonly latentPreference: number;
}): number {
  if (input.scenario === undefined || input.surface === "pdp") return 1;
  const state = resolveWebsiteState(
    input.scenario,
    input.timestampMs,
    input.device,
    input.productId,
  );
  const presentation = productPresentation(state, input.productId);

  if (input.surface === "collection") {
    const placement =
      presentation?.collectionVisibility ??
      state.collection.rankingQuality;
    const discoverability =
      0.08 +
      1.45 *
        clamp(placement) *
        (0.28 + 0.72 * state.collection.rankingQuality);
    const preferenceRescue =
      1 + Math.min(0.3, Math.max(0, input.latentPreference) * 0.15);
    return clamp(discoverability * preferenceRescue, 0.04, 1.7);
  }

  const searchability =
    presentation?.searchability ?? state.search.relevance;
  return clamp(
    0.04 +
      1.5 *
        searchability *
        (0.35 + 0.65 * state.search.relevance) *
        (0.55 + 0.45 * state.search.synonymCoverage),
    0.03,
    1.7,
  );
}

export function zeroResultSearchProbability(input: {
  readonly scenario?: WebsiteScenario;
  readonly timestampMs: number;
  readonly device: WebsiteDevice;
  readonly intent: number;
}): number {
  if (input.scenario === undefined) return 0;
  const state = resolveWebsiteState(
    input.scenario,
    input.timestampMs,
    input.device,
  );
  const qualityFailure =
    (1 - state.search.relevance) * 0.42 +
    (1 - state.search.synonymCoverage) * 0.28;
  const highIntentRescue = input.intent * state.search.reformulationSupport * 0.18;
  return clamp(
    state.search.zeroResultBaseProbability +
      qualityFailure -
      highIntentRescue,
    0,
    0.92,
  );
}

export interface CheckoutRandomness {
  bool(key: string, probability: number): boolean;
}

export function resolveCheckoutExperience(input: {
  readonly scenario?: WebsiteScenario;
  readonly timestampMs: number;
  readonly device: WebsiteDevice;
  readonly customer: WebsiteCustomerContext;
  readonly randomness: CheckoutRandomness;
  readonly key: string;
  readonly actualShippingChargeMinor: number;
  readonly cartValueMinor: number;
  readonly expectedAovMinor: number;
  readonly promotionExpected: boolean;
}): CheckoutExperience | undefined {
  if (input.scenario === undefined) return undefined;

  const state = resolveWebsiteState(
    input.scenario,
    input.timestampMs,
    input.device,
  );
  const page = websitePageExperience({
    scenario: input.scenario,
    timestampMs: input.timestampMs,
    component: "checkout",
    device: input.device,
    customer: input.customer,
  })!;

  const couponFailureProbability = input.promotionExpected
    ? clamp(
        (1 - state.cart.couponReliability) *
          (0.35 +
            0.45 *
              clamp(
                input.customer.promotionSensitivityMultiplier / 2,
              )),
      )
    : 0;

  const paymentFailureProbability = clamp(
    (1 - state.checkout.paymentReliability) *
      (input.device === "mobile" ? 1.15 : 1),
  );
  const addressFailureProbability = clamp(
    (1 - state.checkout.addressValidationReliability) *
      (input.device === "mobile" ? 1.22 : 1),
  );
  const lateShipping =
    state.checkout.shippingCostVisibility === "checkout_shipping" ||
    state.checkout.shippingCostVisibility === "checkout_review";
  const shippingBurden =
    input.actualShippingChargeMinor <= 0
      ? 0
      : input.actualShippingChargeMinor /
        Math.max(1, input.expectedAovMinor);
  const shippingSurpriseProbability =
    input.actualShippingChargeMinor > 0 && lateShipping
      ? clamp(
          shippingBurden *
            input.customer.priceSensitivityMultiplier *
            (1.25 +
              (1 - state.cart.shippingVisibility) * 0.75),
          0,
          0.92,
        )
      : 0;

  const couponFailed = input.randomness.bool(
    `${input.key}:coupon-failure`,
    couponFailureProbability,
  );
  const paymentFailed = input.randomness.bool(
    `${input.key}:payment-failure`,
    paymentFailureProbability,
  );
  const addressValidationFailed = input.randomness.bool(
    `${input.key}:address-failure`,
    addressFailureProbability,
  );
  const shippingSurprise = input.randomness.bool(
    `${input.key}:shipping-surprise`,
    shippingSurpriseProbability,
  );

  const quality = componentQuality(
    state,
    "checkout",
    input.device,
    input.customer,
  ).quality;
  let completionMultiplier =
    nonlinearQualityMultiplier(quality) *
    page.continuationMultiplier;

  if (couponFailed) {
    completionMultiplier *= clamp(
      0.28 +
        (1 -
          clamp(
            input.customer.promotionSensitivityMultiplier / 2,
          )) *
          0.38,
      0.15,
      0.72,
    );
  }
  if (paymentFailed) completionMultiplier *= 0.22;
  if (addressValidationFailed) completionMultiplier *= 0.28;
  if (shippingSurprise) {
    const tolerance =
      0.2 +
      input.customer.intent * 0.4 +
      input.customer.brandAffinity * 0.22;
    completionMultiplier *= clamp(0.28 + tolerance, 0.28, 0.9);
  }

  const frictions: WebsiteFrictionKind[] = [...page.frictions];
  if (couponFailed) frictions.push("broken_coupon");
  if (paymentFailed) frictions.push("payment_failure");
  if (addressValidationFailed) {
    frictions.push("address_validation_failure");
  }
  if (shippingSurprise) frictions.push("shipping_surprise");

  return {
    componentVersion: state.checkout.componentVersion,
    websiteVersionId: state.versionId,
    completionMultiplier: clamp(completionMultiplier, 0.02, 1.15),
    couponFailed,
    paymentFailed,
    addressValidationFailed,
    shippingSurprise,
    frictions: [...new Set(frictions)],
  };
}

export function websiteCustomerContext(input: {
  readonly customerId: string;
  readonly intent: number;
  readonly need: number;
  readonly brandAffinity: number;
  readonly priceSensitivityMultiplier: number;
  readonly promotionSensitivityMultiplier: number;
  readonly purchaseCount: number;
}): WebsiteCustomerContext {
  return { ...input };
}

export function pageCausalEvents(input: {
  readonly experience?: PageExperience;
  readonly scenario?: WebsiteScenario;
  readonly customerId: string;
  readonly sessionId: string;
  readonly timestampMs: number;
  readonly device: WebsiteDevice;
  readonly transition:
    | "landing_to_browse"
    | "browse_to_pdp"
    | "pdp_to_atc"
    | "atc_to_checkout";
  readonly source?: import("../simulation/types.js").ObservableSource;
  readonly productId?: string;
}): readonly WebsiteCausalEvent[] {
  if (input.experience === undefined || input.scenario === undefined) return [];
  return input.experience.frictions.map((friction, index) => ({
    eventId:
      `website:${input.sessionId}:${input.transition}:${input.timestampMs}:${index}`,
    customerId: input.customerId,
    sessionId: input.sessionId,
    occurredAt: new Date(input.timestampMs).toISOString(),
    scenarioId: input.scenario!.scenarioId,
    websiteVersionId: input.experience!.websiteVersionId,
    component: input.experience!.component,
    componentVersion: input.experience!.componentVersion,
    device: input.device,
    transition: input.transition,
    friction,
    probabilityMultiplier:
      input.experience!.transitionMultiplier,
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.productId === undefined ? {} : { productId: input.productId }),
  }));
}

export function checkoutCausalEvents(input: {
  readonly experience?: CheckoutExperience;
  readonly scenario?: WebsiteScenario;
  readonly customerId: string;
  readonly sessionId: string;
  readonly timestampMs: number;
  readonly device: WebsiteDevice;
  readonly source?: import("../simulation/types.js").ObservableSource;
}): readonly WebsiteCausalEvent[] {
  if (input.experience === undefined || input.scenario === undefined) return [];
  return input.experience.frictions.map((friction, index) => ({
    eventId:
      `website:${input.sessionId}:checkout_to_purchase:${input.timestampMs}:${index}`,
    customerId: input.customerId,
    sessionId: input.sessionId,
    occurredAt: new Date(input.timestampMs).toISOString(),
    scenarioId: input.scenario!.scenarioId,
    websiteVersionId: input.experience!.websiteVersionId,
    component: "checkout",
    componentVersion: input.experience!.componentVersion,
    device: input.device,
    transition: "checkout_to_purchase",
    friction,
    probabilityMultiplier:
      input.experience!.completionMultiplier,
    ...(input.source === undefined ? {} : { source: input.source }),
  }));
}
