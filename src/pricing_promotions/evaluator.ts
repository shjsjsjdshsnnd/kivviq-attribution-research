import type { LatentCustomer } from "../customer_population/types.js";
import {
  evaluateEcommerceEconomics,
} from "../ecommerce_economics/evaluator.js";
import type {
  EcommerceEconomicReport,
  EcommerceEvaluationRequest,
} from "../ecommerce_economics/types.js";
import {
  buildProductEconomicProfiles,
} from "../ecommerce_economics/products.js";
import {
  evaluateInventoryDynamics,
} from "../inventory_dynamics/evaluator.js";
import type {
  InventoryDynamicsEvaluationRequest,
} from "../inventory_dynamics/types.js";
import {
  customerAwareOfPromotion,
  promotionScopeMatches,
  type PricingCustomerContext,
} from "./runtime.js";
import {
  PRICING_PROMOTIONS_VERSION,
  type AuthoritativePriceState,
  type PricingPromotionScenario,
  type PromotionDefinition,
} from "./runtime-types.js";
import type {
  ClearanceCounterfactual,
  EventPromotionDecomposition,
  IncrementalPromotionEconomics,
  OracleGridAnswer,
  PriceResponseCurvePoint,
  PricingPromotionEvaluationRequest,
  PricingPromotionReport,
  PromotionAttributionDiagnostics,
  PromotionResponseCurvePoint,
} from "./types.js";

const HOUR_MS = 3_600_000;

function customerWeightMap(
  request: PricingPromotionEvaluationRequest,
): ReadonlyMap<string, number> {
  return new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
}

function customerContext(
  customer: LatentCustomer,
): PricingCustomerContext {
  return {
    source: customer,
    purchaseCount:
      customer.lifecycle.preSimulationHistory === "none" ? 0 : 1,
    lifecycle:
      customer.lifecycle.state === "abstract_subscriber"
        ? "subscriber"
        : customer.lifecycle.state,
    need: customer.currentPurchaseNeed,
    brandAffinity: customer.brandAffinity,
  };
}

function assertFiniteNonNegative(
  value: number,
  label: string,
): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(label + " must be finite and non-negative");
  }
}

function validatePriceState(
  state: AuthoritativePriceState,
): void {
  assertFiniteNonNegative(
    state.regularPriceMinor,
    "regularPriceMinor",
  );
  assertFiniteNonNegative(
    state.currentSellingPriceMinor,
    "currentSellingPriceMinor",
  );
  assertFiniteNonNegative(
    state.discountAmountMinor,
    "discountAmountMinor",
  );
  assertFiniteNonNegative(
    state.discountPercentage,
    "discountPercentage",
  );
  assertFiniteNonNegative(
    state.effectivePriceMinor,
    "effectivePriceMinor",
  );
  if (
    !Number.isSafeInteger(state.regularPriceMinor) ||
    state.regularPriceMinor <= 0 ||
    !Number.isSafeInteger(state.currentSellingPriceMinor) ||
    state.currentSellingPriceMinor <= 0 ||
    !Number.isSafeInteger(state.effectivePriceMinor) ||
    state.effectivePriceMinor <= 0
  ) {
    throw new RangeError(
      "Step 10 prices must be positive safe-integer minor units",
    );
  }
  const expectedDiscount = Math.max(
    0,
    state.currentSellingPriceMinor -
      state.effectivePriceMinor,
  );
  if (state.discountAmountMinor !== expectedDiscount) {
    throw new RangeError(
      "discountAmountMinor must reconcile current selling price to effective price",
    );
  }
  const expectedPercentage =
    state.currentSellingPriceMinor > 0
      ? expectedDiscount / state.currentSellingPriceMinor
      : 0;
  if (
    Math.abs(
      state.discountPercentage - expectedPercentage,
    ) > 1e-9
  ) {
    throw new RangeError(
      "discountPercentage must reconcile exactly to current selling price",
    );
  }
}

function baselinePriceState(
  productId: string,
  priceMinor: number,
  currency: PricingPromotionScenario["currency"],
): AuthoritativePriceState {
  const price = Math.max(1, Math.round(priceMinor));
  return {
    productId,
    regularPriceMinor: price,
    currentSellingPriceMinor: price,
    discountAmountMinor: 0,
    discountPercentage: 0,
    effectivePriceMinor: price,
    currency,
  };
}

export function hydratePricingPromotionScenario(
  request: PricingPromotionEvaluationRequest,
): PricingPromotionScenario {
  const profiles = buildProductEconomicProfiles(
    request.merchantWorld,
  );
  const supplied = request.scenario.priceStates;
  const suppliedProducts = new Set(
    supplied.map((state) => state.productId),
  );
  const states = [
    ...supplied,
    ...profiles
      .filter(
        (profile) =>
          !suppliedProducts.has(profile.productId),
      )
      .map((profile) =>
        baselinePriceState(
          profile.productId,
          profile.listPriceMinor,
          request.scenario.currency,
        ),
      ),
  ];

  for (const state of states) {
    validatePriceState(state);
    if (state.currency !== request.scenario.currency) {
      throw new RangeError(
        "all Step 10 price states must use scenario currency",
      );
    }
  }

  for (const promotion of request.scenario.promotions) {
    const start = Date.parse(promotion.start);
    const end = Date.parse(promotion.end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    ) {
      throw new RangeError(
        "promotion start/end must form a valid positive interval",
      );
    }
    if (
      promotion.percentageOff !== undefined &&
      (promotion.percentageOff < 0 ||
        promotion.percentageOff >= 1)
    ) {
      throw new RangeError(
        "promotion percentageOff must be in [0, 1)",
      );
    }
  }

  return {
    ...request.scenario,
    version: PRICING_PROMOTIONS_VERSION,
    priceStates: states,
  };
}

function ecommerceRequest(
  request: PricingPromotionEvaluationRequest,
  scenario: PricingPromotionScenario,
): EcommerceEvaluationRequest {
  return {
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    ...(request.interventions === undefined
      ? {}
      : { interventions: request.interventions }),
    ...(request.simulationConfig === undefined
      ? {}
      : { simulationConfig: request.simulationConfig }),
    ...(request.policy === undefined
      ? {}
      : { policy: request.policy }),
    ...(request.productEconomicsOverrides === undefined
      ? {}
      : {
          productEconomicsOverrides:
            request.productEconomicsOverrides,
        }),
    ...(request.advertisingSpendMinor === undefined
      ? {}
      : {
          advertisingSpendMinor:
            request.advertisingSpendMinor,
        }),
    enableInventoryDynamics: true,
    pricingPromotionScenario: scenario,
  };
}

function representedUnits(
  request: PricingPromotionEvaluationRequest,
  report: EcommerceEconomicReport,
): number {
  const weights = customerWeightMap(request);
  return report.orders.reduce(
    (sum, order) =>
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          lineSum +
          line.quantity *
            (weights.get(order.customerId) ?? 1),
        0,
      ),
    0,
  );
}

function expectedFutureContribution(
  request: PricingPromotionEvaluationRequest,
  report: EcommerceEconomicReport,
): number {
  const weights = customerWeightMap(request);
  return Math.round(
    report.customerEconomics.reduce(
      (sum, customer) =>
        sum +
        customer.expectedFutureContributionMinor *
          (weights.get(customer.customerId) ?? 1),
      0,
    ),
  );
}

function noPromotionScenario(
  scenario: PricingPromotionScenario,
): PricingPromotionScenario {
  return {
    ...scenario,
    promotions: [],
  };
}

function incrementalEconomics(
  request: PricingPromotionEvaluationRequest,
  factual: EcommerceEconomicReport,
  baseline: EcommerceEconomicReport,
): IncrementalPromotionEconomics {
  return {
    incrementalUnits:
      representedUnits(request, factual) -
      representedUnits(request, baseline),
    incrementalOrders:
      factual.simulation.totals.representedOrders -
      baseline.simulation.totals.representedOrders,
    incrementalGrossRevenueMinor:
      factual.waterfall.grossMerchandiseRevenueMinor -
      baseline.waterfall.grossMerchandiseRevenueMinor,
    incrementalNetRevenueMinor:
      factual.waterfall.netRevenueMinor -
      baseline.waterfall.netRevenueMinor,
    incrementalGrossProfitMinor:
      factual.waterfall.grossProfitMinor -
      baseline.waterfall.grossProfitMinor,
    incrementalContributionProfitMinor:
      factual.waterfall.contributionProfitMinor -
      baseline.waterfall.contributionProfitMinor,
    incrementalNewCustomers:
      factual.newCustomer.representedNewCustomers -
      baseline.newCustomer.representedNewCustomers,
    incrementalFutureContributionMinor:
      expectedFutureContribution(request, factual) -
      expectedFutureContribution(request, baseline),
  };
}

interface ComparableOrder {
  readonly occurredAtMs: number;
  readonly productIds: ReadonlySet<string>;
}

function baselineOrdersByCustomer(
  report: EcommerceEconomicReport,
): ReadonlyMap<string, readonly ComparableOrder[]> {
  const map = new Map<string, ComparableOrder[]>();
  for (const order of report.orders) {
    const list = map.get(order.customerId) ?? [];
    list.push({
      occurredAtMs: Date.parse(order.occurredAt),
      productIds: new Set(
        order.lines.map((line) => line.productId),
      ),
    });
    map.set(order.customerId, list);
  }
  for (const list of map.values()) {
    list.sort(
      (left, right) =>
        left.occurredAtMs - right.occurredAtMs,
    );
  }
  return map;
}

function promotionAttribution(
  request: PricingPromotionEvaluationRequest,
  scenario: PricingPromotionScenario,
  factual: EcommerceEconomicReport,
  baseline: EcommerceEconomicReport,
): PromotionAttributionDiagnostics {
  const weights = customerWeightMap(request);
  const customerById = new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer] as const,
    ),
  );
  const baselineByCustomer =
    baselineOrdersByCustomer(baseline);

  let purchasesDuringPromotion = 0;
  let promotionExposedPurchases = 0;
  let promotionRedemptionPurchases = 0;
  let trueIncrementalPromotionPurchases = 0;
  let acceleratedPurchases = 0;
  let wouldHavePurchasedAnyway = 0;
  let switchedProductPurchases = 0;
  let discountCostOnIncrementalPurchasesMinor = 0;
  let discountCostOnAcceleratedPurchasesMinor = 0;
  let discountCostOnWouldHavePurchasedAnywayMinor = 0;
  let discountCostOnSwitchedPurchasesMinor = 0;

  for (const order of factual.orders) {
    const orderMs = Date.parse(order.occurredAt);
    const weight = weights.get(order.customerId) ?? 1;
    const customer = customerById.get(order.customerId);
    const treatmentProducts = new Set(
      order.lines.map((line) => line.productId),
    );
    const activePromotions = scenario.promotions.filter(
      (promotion) =>
        orderMs >= Date.parse(promotion.start) &&
        orderMs < Date.parse(promotion.end),
    );
    if (activePromotions.length > 0) {
      purchasesDuringPromotion += weight;
    }

    const exposed =
      customer !== undefined &&
      activePromotions.some((promotion) => {
        const ctx = customerContext(customer);
        return (
          customerAwareOfPromotion(promotion, ctx) &&
          order.lines.some((line) =>
            promotionScopeMatches(
              request.merchantWorld,
              scenario,
              promotion,
              line.productId,
            ),
          )
        );
      });
    if (exposed) {
      promotionExposedPurchases += weight;
    }

    const redeemed =
      order.discountsMinor > 0 ||
      (order.freeShippingPromotionIds?.length ?? 0) > 0 ||
      order.lines.some(
        (line) => (line.promotionIds?.length ?? 0) > 0,
      );
    if (redeemed) {
      promotionRedemptionPurchases += weight;
    }

    const candidates =
      baselineByCustomer.get(order.customerId) ?? [];
    const sameProduct = candidates
      .filter((candidate) =>
        [...treatmentProducts].some((productId) =>
          candidate.productIds.has(productId),
        ),
      )
      .sort(
        (left, right) =>
          Math.abs(left.occurredAtMs - orderMs) -
          Math.abs(right.occurredAtMs - orderMs),
      )[0];
    const anyBaseline = candidates
      .slice()
      .sort(
        (left, right) =>
          Math.abs(left.occurredAtMs - orderMs) -
          Math.abs(right.occurredAtMs - orderMs),
      )[0];
    const weightedDiscount =
      order.discountsMinor * weight;

    if (!anyBaseline) {
      trueIncrementalPromotionPurchases += weight;
      discountCostOnIncrementalPurchasesMinor +=
        weightedDiscount;
    } else if (!sameProduct) {
      switchedProductPurchases += weight;
      discountCostOnSwitchedPurchasesMinor +=
        weightedDiscount;
    } else if (
      sameProduct.occurredAtMs - orderMs >
      12 * HOUR_MS
    ) {
      acceleratedPurchases += weight;
      discountCostOnAcceleratedPurchasesMinor +=
        weightedDiscount;
    } else {
      wouldHavePurchasedAnyway += weight;
      discountCostOnWouldHavePurchasedAnywayMinor +=
        weightedDiscount;
    }
  }

  return {
    purchasesDuringPromotion,
    promotionExposedPurchases,
    promotionRedemptionPurchases,
    trueIncrementalPromotionPurchases,
    acceleratedPurchases,
    wouldHavePurchasedAnyway,
    switchedProductPurchases,
    discountCostOnIncrementalPurchasesMinor:
      Math.round(discountCostOnIncrementalPurchasesMinor),
    discountCostOnAcceleratedPurchasesMinor:
      Math.round(discountCostOnAcceleratedPurchasesMinor),
    discountCostOnWouldHavePurchasedAnywayMinor:
      Math.round(
        discountCostOnWouldHavePurchasedAnywayMinor,
      ),
    discountCostOnSwitchedPurchasesMinor:
      Math.round(discountCostOnSwitchedPurchasesMinor),
  };
}

export function evaluatePricingPromotionEconomics(
  request: PricingPromotionEvaluationRequest,
): PricingPromotionReport {
  const scenario = hydratePricingPromotionScenario(
    request,
  );
  const factual = evaluateEcommerceEconomics(
    ecommerceRequest(request, scenario),
  );
  const noPromotionCounterfactual =
    evaluateEcommerceEconomics(
      ecommerceRequest(
        request,
        noPromotionScenario(scenario),
      ),
    );

  return {
    version: PRICING_PROMOTIONS_VERSION,
    merchantWorldId:
      request.merchantWorld.manifest.worldId,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    authoritativePriceStates: scenario.priceStates,
    factual,
    noPromotionCounterfactual,
    incremental: incrementalEconomics(
      request,
      factual,
      noPromotionCounterfactual,
    ),
    attribution: promotionAttribution(
      request,
      scenario,
      factual,
      noPromotionCounterfactual,
    ),
    godModeOnly: true,
  };
}

function reportPoint(
  request: PricingPromotionEvaluationRequest,
  report: EcommerceEconomicReport,
  discountDepth: number,
): PromotionResponseCurvePoint {
  return {
    discountDepth,
    representedUnits: representedUnits(
      request,
      report,
    ),
    representedOrders:
      report.simulation.totals.representedOrders,
    grossRevenueMinor:
      report.waterfall.grossMerchandiseRevenueMinor,
    netRevenueMinor: report.waterfall.netRevenueMinor,
    grossProfitMinor: report.waterfall.grossProfitMinor,
    contributionProfitMinor:
      report.waterfall.contributionProfitMinor,
    inventoryConsumptionUnits: representedUnits(
      request,
      report,
    ),
    expectedFutureContributionMinor:
      expectedFutureContribution(request, report),
  };
}

function wholePeriodPromotion(
  request: PricingPromotionEvaluationRequest,
  depth: number,
): PromotionDefinition {
  return {
    promotionId:
      "step10-response-curve-" +
      String(Math.round(depth * 10_000)),
    mechanic: "percentage_discount",
    scope: { kind: "sitewide" },
    start: request.periodStart,
    end: request.periodEnd,
    percentageOff: depth,
    awarenessProbability: 1,
    stacking: "exclusive",
  };
}

export function evaluatePromotionResponseCurve(
  request: PricingPromotionEvaluationRequest,
  depths: readonly number[] = [0, 0.05, 0.1, 0.15, 0.2, 0.25],
): readonly PromotionResponseCurvePoint[] {
  const base = hydratePricingPromotionScenario(request);
  return depths.map((depth) => {
    const normalized = Math.max(0, Math.min(0.95, depth));
    const scenario: PricingPromotionScenario = {
      ...base,
      promotions:
        normalized === 0
          ? []
          : [wholePeriodPromotion(request, normalized)],
    };
    const report = evaluateEcommerceEconomics(
      ecommerceRequest(request, scenario),
    );
    return reportPoint(request, report, normalized);
  });
}

export function evaluatePriceResponseCurve(
  request: PricingPromotionEvaluationRequest,
  productId: string,
  relativeChanges: readonly number[] = [-0.1, -0.05, 0, 0.05, 0.1],
): readonly PriceResponseCurvePoint[] {
  const base = hydratePricingPromotionScenario(request);
  const baseState = base.priceStates.find(
    (state) => state.productId === productId,
  );
  if (!baseState) {
    throw new RangeError(
      "unknown productId for Step 10 price curve",
    );
  }

  return relativeChanges.map((relativePriceChange) => {
    const priceMinor = Math.max(
      1,
      Math.round(
        baseState.regularPriceMinor *
          (1 + relativePriceChange),
      ),
    );
    const scenario: PricingPromotionScenario = {
      ...base,
      promotions: [],
      priceStates: base.priceStates.map((state) =>
        state.productId !== productId
          ? state
          : {
              ...state,
              currentSellingPriceMinor: priceMinor,
              effectivePriceMinor: priceMinor,
              discountAmountMinor: 0,
              discountPercentage: 0,
            },
      ),
    };
    const report = evaluateEcommerceEconomics(
      ecommerceRequest(request, scenario),
    );
    return {
      relativePriceChange,
      priceMinor,
      representedUnits: representedUnits(
        request,
        report,
      ),
      representedOrders:
        report.simulation.totals.representedOrders,
      grossRevenueMinor:
        report.waterfall.grossMerchandiseRevenueMinor,
      grossProfitMinor:
        report.waterfall.grossProfitMinor,
      contributionProfitMinor:
        report.waterfall.contributionProfitMinor,
    };
  });
}

function maximizingByContribution<
  T extends { readonly contributionProfitMinor: number },
>(
  points: readonly T[],
): T {
  if (points.length === 0) {
    throw new RangeError("oracle grid must contain at least one point");
  }
  return [...points].sort(
    (left, right) =>
      right.contributionProfitMinor -
      left.contributionProfitMinor,
  )[0]!;
}

export function evaluatePromotionOracleGrid(
  request: PricingPromotionEvaluationRequest,
  depths: readonly number[] = [0, 0.05, 0.1, 0.15, 0.2, 0.25],
): OracleGridAnswer<PromotionResponseCurvePoint> {
  const points = evaluatePromotionResponseCurve(
    request,
    depths,
  );
  return {
    godModeOnly: true,
    objective: "contribution_profit",
    horizonStart: request.periodStart,
    horizonEnd: request.periodEnd,
    evaluatedPoints: points,
    maximizingPoint: maximizingByContribution(points),
  };
}

export function evaluatePriceOracleGrid(
  request: PricingPromotionEvaluationRequest,
  productId: string,
  relativeChanges: readonly number[] = [-0.1, -0.05, 0, 0.05, 0.1],
): OracleGridAnswer<PriceResponseCurvePoint> {
  const points = evaluatePriceResponseCurve(
    request,
    productId,
    relativeChanges,
  );
  return {
    godModeOnly: true,
    objective: "contribution_profit",
    horizonStart: request.periodStart,
    horizonEnd: request.periodEnd,
    evaluatedPoints: points,
    maximizingPoint: maximizingByContribution(points),
  };
}

export function evaluateEventPromotionDecomposition(
  request: PricingPromotionEvaluationRequest,
): EventPromotionDecomposition {
  const scenario = hydratePricingPromotionScenario(request);
  const eventDemandAndPromotion =
    evaluateEcommerceEconomics(
      ecommerceRequest(request, scenario),
    );
  const eventDemandWithoutMerchantPromotion =
    evaluateEcommerceEconomics(
      ecommerceRequest(
        request,
        {
          ...scenario,
          promotions: [],
        },
      ),
    );
  const baselineWithoutEventOrPromotion =
    evaluateEcommerceEconomics(
      ecommerceRequest(
        request,
        {
          ...scenario,
          promotions: [],
          majorEvents: [],
        },
      ),
    );

  return {
    eventDemandAndPromotion,
    eventDemandWithoutMerchantPromotion,
    baselineWithoutEventOrPromotion,
    eventDemandEffectRevenueMinor:
      eventDemandWithoutMerchantPromotion.waterfall
        .netRevenueMinor -
      baselineWithoutEventOrPromotion.waterfall
        .netRevenueMinor,
    merchantPromotionEffectRevenueMinor:
      eventDemandAndPromotion.waterfall.netRevenueMinor -
      eventDemandWithoutMerchantPromotion.waterfall
        .netRevenueMinor,
    eventDemandEffectContributionMinor:
      eventDemandWithoutMerchantPromotion.waterfall
        .contributionProfitMinor -
      baselineWithoutEventOrPromotion.waterfall
        .contributionProfitMinor,
    merchantPromotionEffectContributionMinor:
      eventDemandAndPromotion.waterfall
        .contributionProfitMinor -
      eventDemandWithoutMerchantPromotion.waterfall
        .contributionProfitMinor,
  };
}

export function evaluateClearanceCounterfactual(
  request: PricingPromotionEvaluationRequest,
  productId: string,
  clearanceDepth: number,
): ClearanceCounterfactual {
  const scenario = hydratePricingPromotionScenario(request);
  const clearancePromotion: PromotionDefinition = {
    promotionId: "step10-clearance-" + productId,
    mechanic: "clearance",
    scope: {
      kind: "sku_set",
      productIds: [productId],
    },
    start: request.periodStart,
    end: request.periodEnd,
    percentageOff: Math.max(
      0,
      Math.min(0.95, clearanceDepth),
    ),
    awarenessProbability: 1,
  };

  const inventoryBase = {
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    ...(request.interventions === undefined
      ? {}
      : { interventions: request.interventions }),
    ...(request.simulationConfig === undefined
      ? {}
      : { simulationConfig: request.simulationConfig }),
    ...(request.policy === undefined
      ? {}
      : { policy: request.policy }),
    ...(request.productEconomicsOverrides === undefined
      ? {}
      : {
          productEconomicsOverrides:
            request.productEconomicsOverrides,
        }),
    ...(request.advertisingSpendMinor === undefined
      ? {}
      : {
          advertisingSpendMinor:
            request.advertisingSpendMinor,
        }),
    enableInventoryDynamics: true as const,
  };

  const clearance = evaluateInventoryDynamics({
    ...inventoryBase,
    pricingPromotionScenario: {
      ...scenario,
      promotions: [
        ...scenario.promotions,
        clearancePromotion,
      ],
    },
  } as InventoryDynamicsEvaluationRequest);
  const waitForFullPrice = evaluateInventoryDynamics({
    ...inventoryBase,
    pricingPromotionScenario: {
      ...scenario,
      promotions: scenario.promotions.filter(
        (promotion) =>
          promotion.promotionId !==
          clearancePromotion.promotionId,
      ),
    },
  } as InventoryDynamicsEvaluationRequest);

  return {
    productId,
    clearance,
    waitForFullPrice,
    immediateContributionDeltaMinor:
      clearance.baseContributionProfitMinor -
      waitForFullPrice.baseContributionProfitMinor,
    carryingCostDeltaMinor:
      clearance.inventoryCarryingCostMinor -
      waitForFullPrice.inventoryCarryingCostMinor,
    obsolescenceLossDeltaMinor:
      clearance.obsolescenceEconomicLossMinor -
      waitForFullPrice.obsolescenceEconomicLossMinor,
    horizonEconomicValueDeltaMinor:
      clearance.contributionProfitAfterInventoryCarryingMinor -
      clearance.obsolescenceEconomicLossMinor -
      (waitForFullPrice
        .contributionProfitAfterInventoryCarryingMinor -
        waitForFullPrice.obsolescenceEconomicLossMinor),
  };
}
