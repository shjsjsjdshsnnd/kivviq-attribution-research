import type { LatentCustomer } from "../customer_population/types.js";
import {
  evaluateEcommerceEconomics,
} from "../ecommerce_economics/evaluator.js";
import type {
  EcommerceEconomicReport,
  EcommerceEvaluationRequest,
} from "../ecommerce_economics/types.js";
import {
  applyProductEconomicOverrides,
  buildProductEconomicProfiles,
} from "../ecommerce_economics/products.js";
import {
  evaluateInventoryDynamics,
} from "../inventory_dynamics/evaluator.js";
import type {
  InventoryDynamicsEvaluationRequest,
} from "../inventory_dynamics/types.js";
import {
  activePriceState,
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
  ProductPromotionEconomics,
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

function validatePriceStateIntervals(
  states: readonly AuthoritativePriceState[],
): void {
  const grouped = new Map<
    string,
    Array<{
      readonly state: AuthoritativePriceState;
      readonly start: number;
      readonly end: number;
    }>
  >();

  for (const state of states) {
    const start =
      state.effectiveStart === undefined
        ? Number.NEGATIVE_INFINITY
        : Date.parse(state.effectiveStart);
    const end =
      state.effectiveEnd === undefined
        ? Number.POSITIVE_INFINITY
        : Date.parse(state.effectiveEnd);
    if (!Number.isFinite(start) && start !== Number.NEGATIVE_INFINITY) {
      throw new RangeError(
        "price-state effectiveStart must be a valid timestamp",
      );
    }
    if (!Number.isFinite(end) && end !== Number.POSITIVE_INFINITY) {
      throw new RangeError(
        "price-state effectiveEnd must be a valid timestamp",
      );
    }
    if (end <= start) {
      throw new RangeError(
        "price-state effective interval must have positive duration",
      );
    }

    const key =
      state.productId + "::" + (state.variantId ?? "");
    const list = grouped.get(key) ?? [];
    list.push({ state, start, end });
    grouped.set(key, list);
  }

  for (const [key, intervals] of grouped) {
    intervals.sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end,
    );
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1]!;
      const current = intervals[index]!;
      if (current.start < previous.end) {
        throw new RangeError(
          "overlapping authoritative price states for " + key,
        );
      }
    }
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
  const profiles = applyProductEconomicOverrides(
    buildProductEconomicProfiles(request.merchantWorld),
    request.productEconomicsOverrides,
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
  validatePriceStateIntervals(states);

  const categoryTendencies =
    request.scenario
      .categoryElasticityMultiplierByCategory;
  if (categoryTendencies !== undefined) {
    if (
      request.scenario.categoryElasticitySource !==
      "step10_explicit_synthetic_tendency"
    ) {
      throw new RangeError(
        "category elasticity tendencies require explicit Step 10 synthetic provenance",
      );
    }
    for (const [categoryId, multiplier] of Object.entries(
      categoryTendencies,
    )) {
      if (
        categoryId.length === 0 ||
        !Number.isFinite(multiplier) ||
        multiplier <= 0 ||
        multiplier > 5
      ) {
        throw new RangeError(
          "category elasticity multipliers must be finite in (0, 5]",
        );
      }
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

function representedUnitsForProduct(
  request: PricingPromotionEvaluationRequest,
  report: EcommerceEconomicReport,
  productId: string,
): number {
  const weights = customerWeightMap(request);
  return report.orders.reduce(
    (sum, order) =>
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          line.productId === productId
            ? lineSum +
              line.quantity *
                (weights.get(order.customerId) ?? 1)
            : lineSum,
        0,
      ),
    0,
  );
}

function representedPhysicalInventoryConsumption(
  report: EcommerceEconomicReport,
): number {
  const inventory = report.simulation.godMode.inventory;
  if (!inventory) {
    throw new RangeError(
      "Step 10 response curves require Step 9 inventory truth",
    );
  }
  return inventory.demandTruth.reduce(
    (sum, demand) =>
      sum +
      demand.physicallyFulfilledUnits *
        demand.representedWeight,
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

interface MutableProductEconomics {
  productId: string;
  representedUnits: number;
  grossRevenueMinor: number;
  discountsMinor: number;
  allocatedNetRevenueMinor: number;
  allocatedGrossProfitMinor: number;
  allocatedContributionProfitMinor: number;
}

function productEconomics(
  request: PricingPromotionEvaluationRequest,
  report: EcommerceEconomicReport,
): readonly ProductPromotionEconomics[] {
  const weights = customerWeightMap(request);
  const rows = new Map<string, MutableProductEconomics>();

  const rowFor = (productId: string): MutableProductEconomics => {
    const existing = rows.get(productId);
    if (existing) return existing;
    const created: MutableProductEconomics = {
      productId,
      representedUnits: 0,
      grossRevenueMinor: 0,
      discountsMinor: 0,
      allocatedNetRevenueMinor: 0,
      allocatedGrossProfitMinor: 0,
      allocatedContributionProfitMinor: 0,
    };
    rows.set(productId, created);
    return created;
  };

  for (const order of report.orders) {
    const weight = weights.get(order.customerId) ?? 1;
    const lineBasis = order.lines.map((line) =>
      Math.max(0, line.netSalesBeforeReturnsMinor),
    );
    const basisTotal = lineBasis.reduce(
      (sum, value) => sum + value,
      0,
    );
    let remainingNet = order.netRevenueMinor;
    let remainingGrossProfit = order.grossProfitMinor;
    let remainingContribution =
      order.contributionProfitBeforeAdvertisingMinor;

    for (
      let lineIndex = 0;
      lineIndex < order.lines.length;
      lineIndex += 1
    ) {
      const line = order.lines[lineIndex]!;
      const row = rowFor(line.productId);
      const isLast =
        lineIndex === order.lines.length - 1;
      const share =
        basisTotal > 0
          ? lineBasis[lineIndex]! / basisTotal
          : 1 / Math.max(1, order.lines.length);
      const allocatedNet = isLast
        ? remainingNet
        : Math.round(order.netRevenueMinor * share);
      const allocatedGrossProfit = isLast
        ? remainingGrossProfit
        : Math.round(order.grossProfitMinor * share);
      const allocatedContribution = isLast
        ? remainingContribution
        : Math.round(
            order.contributionProfitBeforeAdvertisingMinor *
              share,
          );

      remainingNet -= allocatedNet;
      remainingGrossProfit -= allocatedGrossProfit;
      remainingContribution -= allocatedContribution;

      row.representedUnits +=
        line.quantity * weight;
      row.grossRevenueMinor +=
        line.grossMerchandiseRevenueMinor * weight;
      row.discountsMinor +=
        line.discountMinor * weight;
      row.allocatedNetRevenueMinor +=
        allocatedNet * weight;
      row.allocatedGrossProfitMinor +=
        allocatedGrossProfit * weight;
      row.allocatedContributionProfitMinor +=
        allocatedContribution * weight;
    }
  }

  const sorted = [...rows.values()].sort(
    (left, right) =>
      left.productId.localeCompare(right.productId),
  );
  const totalNet = sorted.reduce(
    (sum, row) => sum + row.allocatedNetRevenueMinor,
    0,
  );
  const totalContributionBeforeAds = sorted.reduce(
    (sum, row) =>
      sum + row.allocatedContributionProfitMinor,
    0,
  );

  for (const row of sorted) {
    const share =
      totalNet > 0
        ? row.allocatedNetRevenueMinor / totalNet
        : sorted.length > 0
          ? 1 / sorted.length
          : 0;
    row.allocatedContributionProfitMinor -=
      report.waterfall.advertisingCostMinor * share;
  }

  const rounded: ProductPromotionEconomics[] = sorted.map(
    (row) => ({
      productId: row.productId,
      representedUnits: row.representedUnits,
      grossRevenueMinor: Math.round(row.grossRevenueMinor),
      discountsMinor: Math.round(row.discountsMinor),
      allocatedNetRevenueMinor: Math.round(
        row.allocatedNetRevenueMinor,
      ),
      allocatedGrossProfitMinor: Math.round(
        row.allocatedGrossProfitMinor,
      ),
      allocatedContributionProfitMinor: Math.round(
        row.allocatedContributionProfitMinor,
      ),
    }),
  );

  if (rounded.length > 0) {
    const last = rounded[rounded.length - 1]!;
    const netResidual =
      report.waterfall.netRevenueMinor -
      rounded.reduce(
        (sum, row) => sum + row.allocatedNetRevenueMinor,
        0,
      );
    const grossProfitResidual =
      report.waterfall.grossProfitMinor -
      rounded.reduce(
        (sum, row) => sum + row.allocatedGrossProfitMinor,
        0,
      );
    const contributionResidual =
      report.waterfall.contributionProfitMinor -
      rounded.reduce(
        (sum, row) =>
          sum + row.allocatedContributionProfitMinor,
        0,
      );
    rounded[rounded.length - 1] = {
      ...last,
      allocatedNetRevenueMinor:
        last.allocatedNetRevenueMinor + netResidual,
      allocatedGrossProfitMinor:
        last.allocatedGrossProfitMinor +
        grossProfitResidual,
      allocatedContributionProfitMinor:
        last.allocatedContributionProfitMinor +
        contributionResidual,
    };
  }

  void totalContributionBeforeAds;
  return rounded;
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
  readonly orderId: string;
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
      orderId: order.orderId,
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
  const purchaseByOrderId = new Map(
    factual.simulation.purchases.map(
      (purchase) => [purchase.orderId, purchase] as const,
    ),
  );
  const usedBaselineOrderIdsByCustomer =
    new Map<string, Set<string>>();

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

    const messageAware =
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

    const purchase = purchaseByOrderId.get(order.orderId);
    const redeemed =
      (purchase?.freeShippingPromotionIds?.length ?? 0) > 0 ||
      (purchase?.lines.some(
        (line) => (line.promotionIds?.length ?? 0) > 0,
      ) ?? false);
    // A realized automatic sale/credit necessarily exposes the purchaser to
    // the offer even if they were not previously aware through a promotional
    // message. This keeps "exposed" distinct from message awareness while
    // preserving redemption as the stricter realized-offer subset.
    if (messageAware || redeemed) {
      promotionExposedPurchases += weight;
    }
    if (redeemed) {
      promotionRedemptionPurchases += weight;
    }

    const usedBaselineOrderIds =
      usedBaselineOrderIdsByCustomer.get(order.customerId) ??
      new Set<string>();
    if (
      !usedBaselineOrderIdsByCustomer.has(order.customerId)
    ) {
      usedBaselineOrderIdsByCustomer.set(
        order.customerId,
        usedBaselineOrderIds,
      );
    }
    const candidates = (
      baselineByCustomer.get(order.customerId) ?? []
    ).filter(
      (candidate) =>
        !usedBaselineOrderIds.has(candidate.orderId),
    );
    const productMatched = candidates.filter((candidate) =>
      [...treatmentProducts].some((productId) =>
        candidate.productIds.has(productId),
      ),
    );
    // Pull-forward is directional: a promoted purchase is accelerated only
    // when the same customer buys an overlapping product later in the
    // no-promotion replay. Choosing the nearest baseline order by absolute
    // time can incorrectly pair a treated purchase to an earlier baseline
    // order and erase real acceleration.
    const futureSameProduct = productMatched
      .filter(
        (candidate) =>
          candidate.occurredAtMs - orderMs > 12 * HOUR_MS,
      )
      .sort(
        (left, right) =>
          left.occurredAtMs - right.occurredAtMs,
      )[0];
    const sameProduct = productMatched
      .slice()
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
    const promotionDiscountMinor = order.lines.reduce(
      (sum, line) => {
        const purchaseLine = purchase?.lines.find(
          (candidate) =>
            candidate.productId === line.productId &&
            (candidate.promotionIds?.length ?? 0) > 0,
        );
        if (!purchaseLine) return sum;

        const priceState = activePriceState(
          scenario,
          line.productId,
          orderMs,
          line.listPriceMinor,
        );
        const authoritativePriceStateDiscount =
          priceState.discountAmountMinor * line.quantity;
        return (
          sum +
          Math.max(
            0,
            line.discountMinor -
              authoritativePriceStateDiscount,
          )
        );
      },
      0,
    );
    const weightedDiscount =
      promotionDiscountMinor * weight;

    let matchedBaseline: ComparableOrder | undefined;
    if (!anyBaseline) {
      trueIncrementalPromotionPurchases += weight;
      discountCostOnIncrementalPurchasesMinor +=
        weightedDiscount;
    } else if (!sameProduct) {
      switchedProductPurchases += weight;
      discountCostOnSwitchedPurchasesMinor +=
        weightedDiscount;
      matchedBaseline = anyBaseline;
    } else if (futureSameProduct !== undefined) {
      acceleratedPurchases += weight;
      discountCostOnAcceleratedPurchasesMinor +=
        weightedDiscount;
      matchedBaseline = futureSameProduct;
    } else {
      wouldHavePurchasedAnyway += weight;
      discountCostOnWouldHavePurchasedAnywayMinor +=
        weightedDiscount;
      matchedBaseline = sameProduct;
    }
    if (matchedBaseline !== undefined) {
      usedBaselineOrderIds.add(matchedBaseline.orderId);
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
    factualProductEconomics: productEconomics(
      request,
      factual,
    ),
    noPromotionProductEconomics: productEconomics(
      request,
      noPromotionCounterfactual,
    ),
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
    inventoryConsumptionUnits:
      representedPhysicalInventoryConsumption(report),
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
    const targetProduct = productEconomics(
      request,
      report,
    ).find(
      (row) => row.productId === productId,
    );
    return {
      relativePriceChange,
      priceMinor,
      representedUnits: representedUnits(
        request,
        report,
      ),
      targetProductRepresentedUnits:
        representedUnitsForProduct(
          request,
          report,
          productId,
        ),
      representedOrders:
        report.simulation.totals.representedOrders,
      grossRevenueMinor:
        report.waterfall.grossMerchandiseRevenueMinor,
      grossProfitMinor:
        report.waterfall.grossProfitMinor,
      contributionProfitMinor:
        report.waterfall.contributionProfitMinor,
      targetProductGrossRevenueMinor:
        targetProduct?.grossRevenueMinor ?? 0,
      targetProductGrossProfitMinor:
        targetProduct?.allocatedGrossProfitMinor ?? 0,
      targetProductContributionProfitMinor:
        targetProduct?.allocatedContributionProfitMinor ?? 0,
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
