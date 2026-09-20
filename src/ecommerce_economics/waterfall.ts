import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { RealizedPurchase } from "../simulation/types.js";
import {
  productEconomicProfileMap,
  resolveEcommercePolicy,
} from "./products.js";
import type {
  EcommercePolicy,
  NewCustomerEconomics,
  OrderEconomics,
  OrderLineEconomics,
  PeriodEconomicWaterfall,
  ProductEconomicProfile,
  RepeatCustomerEconomics,
  ReturnEconomics,
} from "./types.js";

export class EcommerceAccountingError extends Error {}

function assertIntegerMoney(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new EcommerceAccountingError(
      `${label} must be a safe integer minor-unit amount; received ${value}`,
    );
  }
  return value;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new EcommerceAccountingError("money calculation must be finite");
  }
  return Math.round(value);
}

function customerShippingRevenueMinor(
  merchandiseRevenueMinor: number,
  policy: EcommercePolicy,
): number {
  if (policy.customerShippingChargeMinor <= 0) return 0;
  if (policy.freeShippingThresholdMinor === null) {
    return policy.customerShippingChargeMinor;
  }
  return merchandiseRevenueMinor >= policy.freeShippingThresholdMinor
    ? 0
    : policy.customerShippingChargeMinor;
}

function promotionalCostsMinor(
  purchase: RealizedPurchase,
  revenueAfterDiscountsMinor: number,
  policy: EcommercePolicy,
): number {
  const discounted = purchase.discountMinor > 0;
  const giftCost = discounted ? policy.giftWithPurchaseCostMinor : 0;
  const loyaltyCredit = roundMoney(
    revenueAfterDiscountsMinor * policy.loyaltyCreditRate,
  );
  const couponCost =
    discounted && policy.couponOperationalCostMinor > 0
      ? policy.couponOperationalCostMinor
      : 0;

  // Price discounts are already represented above the revenue line and are
  // deliberately excluded here to avoid double counting.
  return giftCost + loyaltyCredit + couponCost;
}

export function buildOrderEconomics(
  world: GeneratedMerchantWorld,
  purchase: RealizedPurchase,
  policyInput: Partial<EcommercePolicy> = {},
  profilesInput?: ReadonlyMap<string, ProductEconomicProfile>,
): OrderEconomics {
  const policy = resolveEcommercePolicy(world, policyInput);
  const profiles = profilesInput ?? productEconomicProfileMap(world);

  const lines: OrderLineEconomics[] = purchase.lines.map((line) => {
    const profile = profiles.get(line.productId);
    if (!profile) {
      throw new EcommerceAccountingError(
        `missing economic profile for product ${line.productId}`,
      );
    }

    const quantity = Math.max(0, Math.floor(line.quantity));
    const grossMerchandiseRevenueMinor = assertIntegerMoney(
      line.unitPriceMinor * quantity,
      "line gross merchandise revenue",
    );
    const discountMinor = assertIntegerMoney(
      line.discountMinor,
      "line discount",
    );
    const netSalesBeforeReturnsMinor =
      grossMerchandiseRevenueMinor - discountMinor;

    const cogsMinor = assertIntegerMoney(
      profile.cogsPerUnitMinor * quantity,
      "line COGS",
    );
    const grossProfitBeforeReturnsMinor =
      netSalesBeforeReturnsMinor - cogsMinor;

    return {
      productId: line.productId,
      categoryId: profile.categoryId,
      quantity,
      listPriceMinor: profile.listPriceMinor,
      grossMerchandiseRevenueMinor,
      discountMinor,
      netSalesBeforeReturnsMinor,
      cogsMinor,
      grossProfitBeforeReturnsMinor,
      shippingCostMinor:
        profile.shippingCostPerUnitMinor * quantity,
      fulfillmentCostMinor:
        profile.fulfillmentCostPerUnitMinor * quantity,
      expectedReturnProbability: profile.returnProbability,
    };
  });

  const grossMerchandiseRevenueMinor = lines.reduce(
    (sum, line) => sum + line.grossMerchandiseRevenueMinor,
    0,
  );
  const discountsMinor = lines.reduce(
    (sum, line) => sum + line.discountMinor,
    0,
  );
  const revenueAfterDiscountsMinor =
    grossMerchandiseRevenueMinor - discountsMinor;

  const cogsMinor = lines.reduce(
    (sum, line) => sum + line.cogsMinor,
    0,
  );
  const merchantShippingCostMinor = lines.reduce(
    (sum, line) => sum + line.shippingCostMinor,
    0,
  );
  const customerShippingRevenue =
    customerShippingRevenueMinor(
      revenueAfterDiscountsMinor,
      policy,
    );
  const shippingSubsidyMinor =
    merchantShippingCostMinor - customerShippingRevenue;
  const fulfillmentCostMinor = lines.reduce(
    (sum, line) => sum + line.fulfillmentCostMinor,
    0,
  );

  const paymentFeesMinor =
    roundMoney(
      revenueAfterDiscountsMinor * policy.paymentFeeRate,
    ) + policy.paymentFeeFixedMinor;

  const promotionalCosts =
    promotionalCostsMinor(
      purchase,
      revenueAfterDiscountsMinor,
      policy,
    );

  const variableOperatingCostsMinor =
    policy.variableOperatingCostPerOrderMinor +
    roundMoney(
      revenueAfterDiscountsMinor *
        policy.variableOperatingCostRate,
    );

  const grossProfitMinor =
    revenueAfterDiscountsMinor - cogsMinor;

  const contributionProfitBeforeAdvertisingMinor =
    revenueAfterDiscountsMinor -
    cogsMinor -
    paymentFeesMinor -
    shippingSubsidyMinor -
    fulfillmentCostMinor -
    variableOperatingCostsMinor -
    promotionalCosts;

  return {
    orderId: purchase.orderId,
    customerId: purchase.customerId,
    occurredAt: purchase.occurredAt,
    source: purchase.source,
    repeatPurchase: purchase.repeatPurchase,
    lines,

    grossMerchandiseRevenueMinor,
    discountsMinor,
    revenueAfterDiscountsMinor,

    realizedReturnsMinor: 0,
    realizedRefundsMinor: 0,
    netRevenueMinor: revenueAfterDiscountsMinor,

    cogsMinor,
    grossProfitMinor,

    paymentFeesMinor,
    customerShippingRevenueMinor: customerShippingRevenue,
    merchantShippingCostMinor,
    shippingSubsidyMinor,
    fulfillmentCostMinor,
    variableOperatingCostsMinor,
    promotionalCostsMinor: promotionalCosts,
    attributableAdvertisingCostMinor: null,

    contributionProfitBeforeAdvertisingMinor,
  };
}

export function applyReturnsToOrder(
  order: OrderEconomics,
  returns: readonly ReturnEconomics[],
): OrderEconomics {
  const relevant = returns.filter(
    (entry) => entry.orderId === order.orderId,
  );

  const realizedRefundsMinor = relevant.reduce(
    (sum, entry) => sum + entry.refundedRevenueMinor,
    0,
  );
  const recoveredCogsMinor = relevant.reduce(
    (sum, entry) => sum + entry.recoveredCogsMinor,
    0,
  );
  const returnCostsMinor = relevant.reduce(
    (sum, entry) => sum + entry.incrementalReturnCostsMinor,
    0,
  );

  const netRevenueMinor =
    order.revenueAfterDiscountsMinor -
    realizedRefundsMinor;
  const adjustedCogsMinor =
    order.cogsMinor - recoveredCogsMinor;
  const grossProfitMinor =
    netRevenueMinor - adjustedCogsMinor;

  return {
    ...order,
    realizedReturnsMinor: relevant
      .filter((entry) => entry.disposition === "return_refund")
      .reduce((sum, entry) => sum + entry.refundedRevenueMinor, 0),
    realizedRefundsMinor,
    netRevenueMinor,
    cogsMinor: adjustedCogsMinor,
    grossProfitMinor,
    variableOperatingCostsMinor:
      order.variableOperatingCostsMinor + returnCostsMinor,
    contributionProfitBeforeAdvertisingMinor:
      netRevenueMinor -
      adjustedCogsMinor -
      order.paymentFeesMinor -
      order.shippingSubsidyMinor -
      order.fulfillmentCostMinor -
      order.variableOperatingCostsMinor -
      returnCostsMinor -
      order.promotionalCostsMinor,
  };
}

export function aggregatePeriodWaterfall(
  world: GeneratedMerchantWorld,
  orders: readonly OrderEconomics[],
  advertisingCostMinor: number,
): PeriodEconomicWaterfall {
  const sum = (
    selector: (order: OrderEconomics) => number,
  ): number => orders.reduce((total, order) => total + selector(order), 0);

  const grossMerchandiseRevenueMinor = sum(
    (order) => order.grossMerchandiseRevenueMinor,
  );
  const discountsMinor = sum(
    (order) => order.discountsMinor,
  );
  const revenueAfterDiscountsMinor =
    grossMerchandiseRevenueMinor - discountsMinor;
  const returnsRefundsMinor = sum(
    (order) => order.realizedRefundsMinor,
  );
  const netRevenueMinor =
    revenueAfterDiscountsMinor - returnsRefundsMinor;
  const cogsMinor = sum((order) => order.cogsMinor);
  const grossProfitMinor = netRevenueMinor - cogsMinor;
  const paymentFeesMinor = sum(
    (order) => order.paymentFeesMinor,
  );
  const customerShippingRevenueMinor = sum(
    (order) => order.customerShippingRevenueMinor,
  );
  const merchantShippingCostMinor = sum(
    (order) => order.merchantShippingCostMinor,
  );
  const shippingSubsidyMinor =
    merchantShippingCostMinor -
    customerShippingRevenueMinor;
  const fulfillmentCostMinor = sum(
    (order) => order.fulfillmentCostMinor,
  );
  const variableOperatingCostsMinor = sum(
    (order) => order.variableOperatingCostsMinor,
  );
  const promotionalCostsMinor = sum(
    (order) => order.promotionalCostsMinor,
  );

  assertIntegerMoney(advertisingCostMinor, "advertising cost");

  // Step 1 contribution_profit_v1 is authoritative. Step 7 promotional costs
  // are an explicit subcomponent of variable operating economics, shown
  // separately here but subtracted exactly once.
  const contributionProfitMinor =
    netRevenueMinor -
    cogsMinor -
    paymentFeesMinor -
    shippingSubsidyMinor -
    fulfillmentCostMinor -
    variableOperatingCostsMinor -
    promotionalCostsMinor -
    advertisingCostMinor;

  return {
    currency: world.manifest.marginEconomics.currency,
    grossMerchandiseRevenueMinor,
    discountsMinor,
    revenueAfterDiscountsMinor,
    returnsRefundsMinor,
    netRevenueMinor,
    cogsMinor,
    grossProfitMinor,
    paymentFeesMinor,
    customerShippingRevenueMinor,
    merchantShippingCostMinor,
    shippingSubsidyMinor,
    fulfillmentCostMinor,
    variableOperatingCostsMinor,
    promotionalCostsMinor,
    advertisingCostMinor,
    contributionProfitMinor,
  };
}

export function customerSegmentEconomics(
  orders: readonly OrderEconomics[],
  returns: readonly ReturnEconomics[],
  population: LatentCustomerPopulation,
  advertisingCostMinor: number,
): {
  readonly newCustomer: NewCustomerEconomics;
  readonly repeatCustomer: RepeatCustomerEconomics;
} {
  void returns;
  const weights = new Map(
    population.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );

  const firstOrders = orders.filter((order) => !order.repeatPurchase);
  const repeatOrders = orders.filter((order) => order.repeatPurchase);

  const weighted = (
    source: readonly OrderEconomics[],
    selector: (order: OrderEconomics) => number,
  ): number =>
    source.reduce(
      (sum, order) =>
        sum +
        selector(order) *
          (weights.get(order.customerId) ?? 1),
      0,
    );

  const representedNewCustomers = firstOrders.reduce(
    (sum, order) =>
      sum + (weights.get(order.customerId) ?? 1),
    0,
  );

  return {
    newCustomer: {
      representedNewCustomers,
      firstOrderRevenueMinor: weighted(
        firstOrders,
        (order) => order.netRevenueMinor,
      ),
      firstOrderGrossProfitMinor: weighted(
        firstOrders,
        (order) => order.grossProfitMinor,
      ),
      firstOrderContributionProfitBeforeAdvertisingMinor: weighted(
        firstOrders,
        (order) => order.contributionProfitBeforeAdvertisingMinor,
      ),
      acquisitionCostMinor: advertisingCostMinor,
      expectedFutureContributionMinor: 0,
      expectedTotalEconomicValueMinor:
        weighted(
          firstOrders,
          (order) => order.contributionProfitBeforeAdvertisingMinor,
        ) - advertisingCostMinor,
    },
    repeatCustomer: {
      representedRepeatOrders: repeatOrders.reduce(
        (sum, order) =>
          sum + (weights.get(order.customerId) ?? 1),
        0,
      ),
      repeatRevenueMinor: weighted(
        repeatOrders,
        (order) => order.netRevenueMinor,
      ),
      repeatGrossProfitMinor: weighted(
        repeatOrders,
        (order) => order.grossProfitMinor,
      ),
      repeatContributionProfitBeforeAdvertisingMinor: weighted(
        repeatOrders,
        (order) => order.contributionProfitBeforeAdvertisingMinor,
      ),
    },
  };
}
