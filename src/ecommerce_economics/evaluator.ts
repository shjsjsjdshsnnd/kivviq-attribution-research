import type { Intervention } from "../ground_truth/interventions.js";
import {
  defaultAdvertisingAllocation,
} from "../advertising_economics/evaluator.js";
import {
  allocationSpendMinor,
} from "../advertising_economics/oracle.js";
import { isPaidMarketingChannel } from "../advertising_economics/types.js";
import { simulateWorld } from "../simulation/simulator.js";
import type { OrderEconomics, EcommerceEconomicReport, EcommerceEvaluationRequest, EconomicDecompositionRow, CustomerEconomicSummary } from "./types.js";
import {
  ECOMMERCE_ECONOMICS_VERSION,
} from "./types.js";
import {
  applyProductEconomicOverrides,
  buildProductEconomicProfiles,
  resolveEcommercePolicy,
} from "./products.js";
import {
  aggregatePeriodWaterfall,
  applyReturnsToOrder,
  buildOrderEconomics,
  customerSegmentEconomics,
} from "./waterfall.js";
import { simulateReturnEconomics } from "./returns.js";

function customerWeights(
  request: EcommerceEvaluationRequest,
): ReadonlyMap<string, number> {
  return new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
}

function paidSpendOverrides(
  interventions: readonly Intervention[],
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const intervention of interventions) {
    const match = /^marketing\.([a-z_]+)\.spend$/.exec(
      intervention.variable,
    );
    if (
      !match ||
      intervention.value.kind !== "number"
    ) {
      continue;
    }
    map.set(match[1]!, intervention.value.value);
  }
  return map;
}

export function resolvedAdvertisingSpendMinor(
  request: EcommerceEvaluationRequest,
): number {
  if (request.advertisingSpendMinor !== undefined) {
    if (
      !Number.isSafeInteger(request.advertisingSpendMinor) ||
      request.advertisingSpendMinor < 0
    ) {
      throw new RangeError(
        "advertisingSpendMinor must be a non-negative safe integer",
      );
    }
    return request.advertisingSpendMinor;
  }

  const allocation = defaultAdvertisingAllocation(
    request.merchantWorld,
    request.periodStart,
    request.periodEnd,
  );
  const spend = {
    ...allocation.spendMinorByChannel,
  };
  const overrides = paidSpendOverrides(
    request.interventions ?? [],
  );

  for (const [channel, value] of overrides) {
    if (isPaidMarketingChannel(channel)) {
      spend[channel] = Math.max(0, Math.round(value));
    }
  }

  return Math.round(
    allocationSpendMinor({
      ...allocation,
      spendMinorByChannel: spend,
    }),
  );
}

function allocateInteger(
  total: number,
  weights: readonly number[],
): readonly number[] {
  if (weights.length === 0) return [];
  if (total === 0) return weights.map(() => 0);

  const denominator = weights.reduce(
    (sum, weight) => sum + Math.max(0, weight),
    0,
  );
  if (denominator <= 0) {
    const base = Math.trunc(total / weights.length);
    const result = weights.map(() => base);
    let remaining =
      total - base * weights.length;
    for (
      let index = 0;
      remaining !== 0;
      index = (index + 1) % result.length
    ) {
      result[index]! += remaining > 0 ? 1 : -1;
      remaining += remaining > 0 ? -1 : 1;
    }
    return result;
  }

  const exact = weights.map(
    (weight) =>
      (total * Math.max(0, weight)) / denominator,
  );
  const floors = exact.map((value) =>
    total >= 0 ? Math.floor(value) : Math.ceil(value),
  );
  let remaining =
    total - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({
      index,
      remainder: Math.abs(value - floors[index]!),
    }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder ||
        left.index - right.index,
    );

  let cursor = 0;
  while (remaining !== 0 && order.length > 0) {
    const index = order[cursor % order.length]!.index;
    floors[index]! += remaining > 0 ? 1 : -1;
    remaining += remaining > 0 ? -1 : 1;
    cursor += 1;
  }

  return floors;
}

interface MutableRow {
  orders: number;
  units: number;
  grossRevenueMinor: number;
  netRevenueMinor: number;
  grossProfitMinor: number;
  contributionProfitBeforeAdvertisingMinor: number;
  returnsRefundsMinor: number;
}

function emptyRow(): MutableRow {
  return {
    orders: 0,
    units: 0,
    grossRevenueMinor: 0,
    netRevenueMinor: 0,
    grossProfitMinor: 0,
    contributionProfitBeforeAdvertisingMinor: 0,
    returnsRefundsMinor: 0,
  };
}

function add(
  map: Map<string, MutableRow>,
  key: string,
  delta: Partial<MutableRow>,
): void {
  const row = map.get(key) ?? emptyRow();
  for (const [field, value] of Object.entries(delta)) {
    const record = row as unknown as Record<string, number>;
    record[field] = (record[field] ?? 0) + (value ?? 0);
  }
  map.set(key, row);
}

function decompositionRows(
  request: EcommerceEvaluationRequest,
  orders: readonly OrderEconomics[],
  returns: EcommerceEconomicReport["returns"],
): {
  readonly byProduct: readonly EconomicDecompositionRow[];
  readonly byCategory: readonly EconomicDecompositionRow[];
  readonly byCustomerType: readonly EconomicDecompositionRow[];
  readonly byPromotion: readonly EconomicDecompositionRow[];
} {
  const weights = customerWeights(request);
  const byProduct = new Map<string, MutableRow>();
  const byCategory = new Map<string, MutableRow>();
  const byCustomerType = new Map<string, MutableRow>();
  const byPromotion = new Map<string, MutableRow>();

  const returnByOrderProduct = new Map<
    string,
    {
      refundedRevenueMinor: number;
      recoveredCogsMinor: number;
      returnCostsMinor: number;
    }
  >();
  const returnCostsByOrder = new Map<string, number>();

  for (const returned of returns) {
    returnCostsByOrder.set(
      returned.orderId,
      (returnCostsByOrder.get(returned.orderId) ?? 0) +
        returned.incrementalReturnCostsMinor,
    );

    for (const line of returned.lines) {
      const key = `${returned.orderId}|${line.productId}`;
      const current =
        returnByOrderProduct.get(key) ?? {
          refundedRevenueMinor: 0,
          recoveredCogsMinor: 0,
          returnCostsMinor: 0,
        };

      current.refundedRevenueMinor +=
        line.refundedRevenueMinor;
      current.recoveredCogsMinor +=
        line.recoveredCogsMinor;
      current.returnCostsMinor +=
        line.returnShippingCostMinor +
        line.returnHandlingCostMinor +
        line.restockingCostMinor;

      returnByOrderProduct.set(key, current);
    }
  }

  for (const order of orders) {
    const weight =
      weights.get(order.customerId) ?? 1;
    const lineWeights = order.lines.map(
      (line) => line.netSalesBeforeReturnsMinor,
    );

    const totalReturnCosts =
      returnCostsByOrder.get(order.orderId) ?? 0;
    const baseVariableOperatingCosts = Math.max(
      0,
      order.variableOperatingCostsMinor -
        totalReturnCosts,
    );

    const allocatedPayment = allocateInteger(
      order.paymentFeesMinor,
      lineWeights,
    );
    const allocatedShipping = allocateInteger(
      order.shippingSubsidyMinor,
      lineWeights,
    );
    const allocatedBaseVariable = allocateInteger(
      baseVariableOperatingCosts,
      lineWeights,
    );
    const allocatedPromotion = allocateInteger(
      order.promotionalCostsMinor,
      lineWeights,
    );

    for (let index = 0; index < order.lines.length; index += 1) {
      const line = order.lines[index]!;
      const returnKey =
        `${order.orderId}|${line.productId}`;
      const returned =
        returnByOrderProduct.get(returnKey) ?? {
          refundedRevenueMinor: 0,
          recoveredCogsMinor: 0,
          returnCostsMinor: 0,
        };

      const net =
        line.netSalesBeforeReturnsMinor -
        returned.refundedRevenueMinor;
      const adjustedCogs =
        line.cogsMinor -
        returned.recoveredCogsMinor;
      const grossProfit =
        net - adjustedCogs;
      const contribution =
        grossProfit -
        allocatedPayment[index]! -
        allocatedShipping[index]! -
        line.fulfillmentCostMinor -
        allocatedBaseVariable[index]! -
        allocatedPromotion[index]! -
        returned.returnCostsMinor;

      const delta = {
        orders: weight,
        units: line.quantity * weight,
        grossRevenueMinor:
          line.grossMerchandiseRevenueMinor * weight,
        netRevenueMinor: net * weight,
        grossProfitMinor: grossProfit * weight,
        contributionProfitBeforeAdvertisingMinor:
          contribution * weight,
        returnsRefundsMinor:
          returned.refundedRevenueMinor * weight,
      };

      add(byProduct, line.productId, delta);
      add(byCategory, line.categoryId, delta);
      add(
        byCustomerType,
        order.repeatPurchase ? "repeat" : "new",
        delta,
      );
      add(
        byPromotion,
        order.discountsMinor > 0 ? "promoted" : "full_price",
        delta,
      );
    }
  }

  const finalize = (
    map: Map<string, MutableRow>,
  ): readonly EconomicDecompositionRow[] =>
    [...map.entries()]
      .map(([key, row]) => ({
        key,
        orders: row.orders,
        units: row.units,
        grossRevenueMinor: Math.round(row.grossRevenueMinor),
        netRevenueMinor: Math.round(row.netRevenueMinor),
        grossProfitMinor: Math.round(row.grossProfitMinor),
        contributionProfitBeforeAdvertisingMinor: Math.round(
          row.contributionProfitBeforeAdvertisingMinor,
        ),
        returnsRefundsMinor: Math.round(
          row.returnsRefundsMinor,
        ),
      }))
      .sort((left, right) => left.key.localeCompare(right.key));

  return {
    byProduct: finalize(byProduct),
    byCategory: finalize(byCategory),
    byCustomerType: finalize(byCustomerType),
    byPromotion: finalize(byPromotion),
  };
}

function customerEconomicSummaries(
  request: EcommerceEvaluationRequest,
  orders: readonly OrderEconomics[],
): readonly CustomerEconomicSummary[] {
  const ordersByCustomer = new Map<string, OrderEconomics[]>();
  for (const order of orders) {
    const list =
      ordersByCustomer.get(order.customerId) ?? [];
    list.push(order);
    ordersByCustomer.set(order.customerId, list);
  }

  return request.latentPopulation.customers
    .filter((customer) =>
      ordersByCustomer.has(customer.customerId),
    )
    .map((customer) => {
      const customerOrders =
        ordersByCustomer.get(customer.customerId) ?? [];
      const realizedContribution = customerOrders.reduce(
        (sum, order) =>
          sum +
          order.contributionProfitBeforeAdvertisingMinor,
        0,
      );

      const baselineFuturePurchases = Math.max(
        0,
        customer.expectedFuturePurchases,
      );
      const remainingFuturePurchases = Math.max(
        0,
        baselineFuturePurchases - customerOrders.length,
      );
      const remainingFutureFraction =
        baselineFuturePurchases > 0
          ? remainingFuturePurchases /
            baselineFuturePurchases
          : 0;
      const expectedFutureContribution = Math.round(
        customer.expectedLifetimeValueMinor *
          remainingFutureFraction,
      );
      const clvMechanism =
        request.merchantWorld.manifest.clvMechanisms[0];

      return {
        customerId: customer.customerId,
        customerType:
          customerOrders.some((order) => order.repeatPurchase)
            ? "repeat"
            : "new",
        realizedOrders: customerOrders.length,
        realizedGrossRevenueMinor: customerOrders.reduce(
          (sum, order) =>
            sum + order.grossMerchandiseRevenueMinor,
          0,
        ),
        realizedNetRevenueMinor: customerOrders.reduce(
          (sum, order) => sum + order.netRevenueMinor,
          0,
        ),
        realizedGrossProfitMinor: customerOrders.reduce(
          (sum, order) => sum + order.grossProfitMinor,
          0,
        ),
        realizedContributionProfitBeforeAdvertisingMinor:
          realizedContribution,
        expectedFutureContributionMinor:
          expectedFutureContribution,
        valuationHorizonDays: Number(
          clvMechanism?.horizonDays ?? 365,
        ),
        expectedTotalEconomicValueMinor:
          realizedContribution +
          expectedFutureContribution,
      };
    });
}

export function evaluateEcommerceEconomics(
  request: EcommerceEvaluationRequest,
): EcommerceEconomicReport {
  const policy = resolveEcommercePolicy(
    request.merchantWorld,
    request.policy,
  );
  const baseProfiles =
    buildProductEconomicProfiles(request.merchantWorld);
  const productProfiles = applyProductEconomicOverrides(
    baseProfiles,
    request.productEconomicsOverrides,
  );
  const profileMap = new Map(
    productProfiles.map(
      (profile) => [profile.productId, profile] as const,
    ),
  );

  const simulation = simulateWorld({
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    startTime: request.periodStart,
    endTime: request.periodEnd,
    interventions: request.interventions ?? [],
    commercePolicy: {
      freeShippingThresholdMinor:
        policy.freeShippingThresholdMinor,
      customerShippingChargeMinor:
        policy.customerShippingChargeMinor,
      enableProductRelationships: true,
      enableEnhancedBasketEconomics: true,
      executeInventoryLifecycle: true,
      ...(request.enableInventoryDynamics === true
        ? {
            enableInventoryDynamics: true,
            inventoryReturnProfiles: Object.fromEntries(
              productProfiles.map((profile) => [
                profile.productId,
                {
                  returnProbability:
                    profile.returnProbability,
                  nonRecoverableValueRate:
                    profile.nonRecoverableValueRate,
                  oversized: profile.oversized,
                },
              ]),
            ),
          }
        : {}),
    },
    ...(request.simulationConfig === undefined
      ? {}
      : { config: request.simulationConfig }),
  });

  const returns = simulateReturnEconomics(
    request.merchantWorld,
    request.latentPopulation,
    simulation.purchases,
    request.periodEnd,
    request.simulationSeed,
    profileMap,
    request.enableInventoryDynamics === true
      ? simulation.godMode.inventory?.returnTruth
      : undefined,
  );

  const rawOrders = simulation.purchases.map((purchase) =>
    buildOrderEconomics(
      request.merchantWorld,
      purchase,
      policy,
      profileMap,
    ),
  );
  const orders = rawOrders.map((order) =>
    applyReturnsToOrder(order, returns),
  );

  const weights = customerWeights(request);
  const advertisingCostMinor =
    resolvedAdvertisingSpendMinor(request);
  const waterfall = aggregatePeriodWaterfall(
    request.merchantWorld,
    orders,
    advertisingCostMinor,
    weights,
  );

  const segments = customerSegmentEconomics(
    orders,
    returns,
    request.latentPopulation,
    advertisingCostMinor,
  );

  const customers = customerEconomicSummaries(
    request,
    orders,
  );
  const newCustomerIds = new Set(
    orders
      .filter((order) => !order.repeatPurchase)
      .map((order) => order.customerId),
  );
  const populationWeightByCustomer = new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
  const expectedFutureNew = customers
    .filter((customer) =>
      newCustomerIds.has(customer.customerId),
    )
    .reduce(
      (sum, customer) =>
        sum +
        Math.round(
          customer.expectedFutureContributionMinor *
            (populationWeightByCustomer.get(customer.customerId) ?? 1),
        ),
      0,
    );

  const newCustomer = {
    ...segments.newCustomer,
    expectedFutureContributionMinor:
      expectedFutureNew,
    expectedTotalEconomicValueMinor:
      segments.newCustomer
        .firstOrderContributionProfitBeforeAdvertisingMinor -
      segments.newCustomer.acquisitionCostMinor +
      expectedFutureNew,
  };

  const decomposition = decompositionRows(
    request,
    orders,
    returns,
  );

  return {
    version: ECOMMERCE_ECONOMICS_VERSION,
    policy,
    productProfiles,
    orders,
    returns,
    waterfall,
    newCustomer,
    repeatCustomer: segments.repeatCustomer,
    customerEconomics: customers,
    ...decomposition,
    simulation,
  };
}
