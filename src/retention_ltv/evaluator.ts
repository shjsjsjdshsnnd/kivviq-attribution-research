import {
  defaultAdvertisingAllocation,
} from "../advertising_economics/evaluator.js";
import {
  buildPlatformChannelReport,
} from "../advertising_economics/platform.js";
import {
  isPaidMarketingChannel,
  type PaidMarketingChannel,
} from "../advertising_economics/types.js";
import type {
  LatentCustomer,
} from "../customer_population/types.js";
import {
  evaluateEcommerceEconomics,
} from "../ecommerce_economics/evaluator.js";
import type {
  EcommerceEvaluationRequest,
  EcommerceEconomicReport,
  OrderEconomics,
  ProductEconomicProfile,
} from "../ecommerce_economics/types.js";
import type {
  MarketingChannel,
  GeneratedMerchantWorld,
} from "../generation/config.js";
import type {
  Intervention,
} from "../ground_truth/interventions.js";
import type {
  ObservableSource,
} from "../simulation/types.js";
import {
  defaultRetentionLtvScenario,
  lifecycleMarketingMultipliers,
  productRetentionChoiceMultiplier,
  repeatPurchaseHazardMultiplier,
  validateRetentionLtvScenario,
  type RetentionCustomerContext,
} from "./runtime.js";
import {
  RETENTION_LTV_VERSION,
  type RetentionLtvScenario,
} from "./runtime-types.js";
import type {
  AcquisitionChannelCounterfactual,
  AcquisitionChannelEconomics,
  AcquisitionCounterfactualCustomerOutcome,
  CohortDimension,
  CustomerClvHorizon,
  CustomerCohortSummary,
  CustomerEconomicLedger,
  CustomerPurchaseLedgerEntry,
  CustomerValueForecast,
  FutureValueDiscounting,
  RetentionCurvePoint,
  RetentionLtvEvaluationRequest,
  RetentionLtvReport,
  TimeToSecondPurchaseSummary,
} from "./types.js";

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

const clamp = (
  value: number,
  min: number,
  max: number,
): number => Math.min(max, Math.max(min, value));

function assertTimestamp(
  value: string,
  label: string,
): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(
      label + " must be a valid timestamp",
    );
  }
  return parsed;
}

function normalizedHorizons(
  request: RetentionLtvEvaluationRequest,
): readonly number[] {
  const supplied =
    request.clvHorizonsDays ?? [
      30,
      60,
      90,
      180,
      365,
    ];
  const horizons = [
    ...new Set(
      supplied.map((value) => Math.round(value)),
    ),
  ].sort((left, right) => left - right);
  if (
    horizons.length === 0 ||
    horizons.some(
      (value) =>
        !Number.isFinite(value) || value <= 0,
    )
  ) {
    throw new RangeError(
      "CLV horizons must contain positive finite days",
    );
  }
  return horizons;
}

function resolvedDiscounting(
  request: RetentionLtvEvaluationRequest,
): FutureValueDiscounting {
  const policy =
    request.discounting ?? {
      annualDiscountRate: 0,
      method: "continuous" as const,
      timeUnit: "year" as const,
    };
  if (
    !Number.isFinite(policy.annualDiscountRate) ||
    policy.annualDiscountRate < 0 ||
    policy.annualDiscountRate > 5
  ) {
    throw new RangeError(
      "annualDiscountRate must be finite in [0,5]",
    );
  }
  return policy;
}

function discountFutureValue(
  value: number,
  daysFromNow: number,
  policy: FutureValueDiscounting,
): number {
  const years =
    Math.max(0, daysFromNow) / YEAR_DAYS;
  if (policy.annualDiscountRate === 0) {
    return value;
  }
  if (policy.method === "continuous") {
    return (
      value *
      Math.exp(
        -policy.annualDiscountRate * years,
      )
    );
  }
  return (
    value /
    (1 +
      policy.annualDiscountRate * years)
  );
}

function ecommerceRequest(
  request: RetentionLtvEvaluationRequest,
  periodEnd: string,
  scenario: RetentionLtvScenario,
): EcommerceEvaluationRequest {
  return {
    merchantWorld: request.merchantWorld,
    latentPopulation: request.latentPopulation,
    simulationSeed: request.simulationSeed,
    periodStart: request.periodStart,
    periodEnd,
    retentionScenario: scenario,
    ...(request.interventions === undefined
      ? {}
      : { interventions: request.interventions }),
    ...(request.simulationConfig === undefined
      ? {}
      : {
          simulationConfig:
            request.simulationConfig,
        }),
    ...(request.ecommercePolicy === undefined
      ? {}
      : { policy: request.ecommercePolicy }),
    ...(request.productEconomicsOverrides ===
    undefined
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
    ...(request.enableInventoryDynamics ===
    undefined
      ? {}
      : {
          enableInventoryDynamics:
            request.enableInventoryDynamics,
        }),
    ...(request.pricingPromotionScenario ===
    undefined
      ? {}
      : {
          pricingPromotionScenario:
            request.pricingPromotionScenario,
        }),
  };
}

function populationWeightMap(
  request: RetentionLtvEvaluationRequest,
): ReadonlyMap<string, number> {
  return new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [
          customer.customerId,
          customer.populationWeight,
        ] as const,
    ),
  );
}

function customerMap(
  request: RetentionLtvEvaluationRequest,
): ReadonlyMap<string, LatentCustomer> {
  return new Map(
    request.latentPopulation.customers.map(
      (customer) =>
        [customer.customerId, customer] as const,
    ),
  );
}

function sortedOrdersByCustomer(
  report: EcommerceEconomicReport,
): ReadonlyMap<string, readonly OrderEconomics[]> {
  const result = new Map<
    string,
    OrderEconomics[]
  >();
  for (const order of report.orders) {
    const list =
      result.get(order.customerId) ?? [];
    list.push(order);
    result.set(order.customerId, list);
  }
  for (const orders of result.values()) {
    orders.sort(
      (left, right) =>
        Date.parse(left.occurredAt) -
        Date.parse(right.occurredAt),
    );
  }
  return result;
}

function returnRefundsByOrder(
  report: EcommerceEconomicReport,
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const returned of report.returns) {
    map.set(
      returned.orderId,
      (map.get(returned.orderId) ?? 0) +
        returned.refundedRevenueMinor,
    );
  }
  return map;
}

function purchaseEntry(
  order: OrderEconomics,
  returnRefunds: ReadonlyMap<string, number>,
): CustomerPurchaseLedgerEntry {
  return {
    orderId: order.orderId,
    occurredAt: order.occurredAt,
    source: order.source,
    products: order.lines.map(
      (line) => line.productId,
    ),
    categories: [
      ...new Set(
        order.lines.map(
          (line) => line.categoryId,
        ),
      ),
    ],
    grossRevenueMinor:
      order.grossMerchandiseRevenueMinor,
    netRevenueMinor: order.netRevenueMinor,
    grossProfitMinor: order.grossProfitMinor,
    contributionProfitBeforeAdvertisingMinor:
      order
        .contributionProfitBeforeAdvertisingMinor,
    returnsRefundsMinor:
      returnRefunds.get(order.orderId) ?? 0,
    repeatPurchase: order.repeatPurchase,
  };
}

function finalStateByCustomer(
  report: EcommerceEconomicReport,
) {
  return new Map(
    report.simulation.godMode.customerFinalStates.map(
      (state) =>
        [state.customerId, state] as const,
    ),
  );
}

function purchaseTruthByOrder(
  report: EcommerceEconomicReport,
) {
  return new Map(
    report.simulation.godMode.purchaseTruth.map(
      (truth) => [truth.orderId, truth] as const,
    ),
  );
}

function retentionContext(
  customer: LatentCustomer,
  report: EcommerceEconomicReport,
  observedOrders: readonly OrderEconomics[],
): RetentionCustomerContext {
  const state =
    finalStateByCustomer(report).get(
      customer.customerId,
    );
  const retention = state?.retention;
  const lastPurchase =
    observedOrders[observedOrders.length - 1];

  return {
    source: customer,
    purchaseCount:
      state?.purchaseCount ??
      observedOrders.length,
    lifecycle:
      state?.lifecycle ??
      customer.lifecycle.state,
    brandAffinity:
      retention?.finalBrandAffinity ??
      customer.brandAffinity,
    need:
      state?.finalNeed ??
      customer.currentPurchaseNeed,
    ...(lastPurchase === undefined
      ? {}
      : {
          lastPurchaseMs: Date.parse(
            lastPurchase.occurredAt,
          ),
        }),
    repeatHazardQualityMultiplier:
      retention
        ?.repeatHazardQualityMultiplier ?? 1,
    promotionDependenceShift:
      retention?.promotionDependenceShift ?? 0,
    trueChurnState:
      retention?.trueChurnState ?? "active",
    ownedProductQuantities: new Map(
      Object.entries(
        retention?.ownedProductQuantities ?? {},
      ),
    ),
    categoryFamiliarity: new Map(
      Object.entries(
        retention?.categoryFamiliarity ?? {},
      ),
    ),
  };
}

function structuralProductDemand(
  world: GeneratedMerchantWorld,
  productId: string,
): number {
  return Number(
    world.manifest.productDemandMechanisms.find(
      (mechanism) =>
        mechanism.productId === productId,
    )?.baseLatentDemandUnits ?? 1,
  );
}

function expectedOrderEconomics(
  request: RetentionLtvEvaluationRequest,
  customer: LatentCustomer,
  context: RetentionCustomerContext,
  profiles: readonly ProductEconomicProfile[],
  policy: EcommerceEconomicReport["policy"],
): {
  readonly revenueMinor: number;
  readonly contributionMinor: number;
  readonly contributionVarianceMinorSquared: number;
} {
  const profileMap = new Map(
    profiles.map(
      (profile) =>
        [profile.productId, profile] as const,
    ),
  );
  const topProducts = [
    ...request.merchantWorld.manifest
      .productDemandMechanisms,
  ]
    .sort(
      (left, right) =>
        Number(right.baseLatentDemandUnits) -
        Number(left.baseLatentDemandUnits),
    )
    .slice(0, 8)
    .map((mechanism) => mechanism.productId);

  const candidateIds = [
    ...new Set([
      ...customer.productPreferences.map(
        (preference) =>
          preference.productId,
      ),
      ...topProducts,
    ]),
  ];

  const candidates = candidateIds
    .map((productId, index) => {
      const profile =
        profileMap.get(productId);
      if (!profile) return undefined;
      const preference =
        customer.productPreferences.find(
          (item) =>
            item.productId === productId,
        )?.affinity ??
        0.08 / (index + 1);
      const retentionChoice =
        productRetentionChoiceMultiplier(
          request.merchantWorld,
          context,
          productId,
        );
      const weight =
        Math.max(1e-8, preference) *
        Math.max(
          1,
          structuralProductDemand(
            request.merchantWorld,
            productId,
          ),
        ) **
          0.2 *
        retentionChoice;
      return { profile, weight };
    })
    .filter(
      (
        value,
      ): value is {
        profile: ProductEconomicProfile;
        weight: number;
      } => value !== undefined,
    );

  if (candidates.length === 0) {
    return {
      revenueMinor: 0,
      contributionMinor: 0,
      contributionVarianceMinorSquared: 0,
    };
  }

  const totalWeight = candidates.reduce(
    (sum, candidate) =>
      sum + candidate.weight,
    0,
  );
  const expectedUnits = Math.max(
    1,
    request.merchantWorld.summary
      .expectedUnitsPerOrder,
  );
  const discountRate = clamp(
    request.merchantWorld.summary
      .expectedDiscountRate *
      (1 +
        Math.max(
          0,
          context.promotionDependenceShift,
        ) *
          0.16),
    0,
    0.65,
  );

  const perUnit = candidates.map(
    ({ profile, weight }) => {
      const probability =
        weight / totalWeight;
      const salePrice =
        profile.listPriceMinor *
        (1 - discountRate);
      const returnProbability =
        clamp(
          profile.returnProbability,
          0,
          0.95,
        );
      const expectedNetRevenue =
        salePrice *
        (1 - returnProbability);
      const expectedNetCogs =
        profile.cogsPerUnitMinor *
        (1 -
          returnProbability *
            (1 -
              profile
                .nonRecoverableValueRate));
      const paymentFee =
        salePrice *
          policy.paymentFeeRate +
        policy.paymentFeeFixedMinor /
          expectedUnits;
      const variableOperating =
        policy.variableOperatingCostPerOrderMinor /
          expectedUnits +
        salePrice *
          policy.variableOperatingCostRate;
      const returnCosts =
        returnProbability *
        (profile.returnShippingCostMinor +
          profile.returnHandlingCostMinor +
          profile.restockingCostMinor);
      const contribution =
        expectedNetRevenue -
        expectedNetCogs -
        paymentFee -
        profile.shippingCostPerUnitMinor -
        profile.fulfillmentCostPerUnitMinor -
        variableOperating -
        returnCosts;

      return {
        probability,
        revenue: expectedNetRevenue,
        contribution,
      };
    },
  );

  const meanRevenuePerUnit =
    perUnit.reduce(
      (sum, item) =>
        sum +
        item.probability * item.revenue,
      0,
    );
  const meanContributionPerUnit =
    perUnit.reduce(
      (sum, item) =>
        sum +
        item.probability *
          item.contribution,
      0,
    );
  const variancePerUnit =
    perUnit.reduce(
      (sum, item) =>
        sum +
        item.probability *
          (item.contribution -
            meanContributionPerUnit) **
            2,
      0,
    );

  const merchandise =
    meanRevenuePerUnit * expectedUnits;
  const shippingRevenue =
    policy.freeShippingThresholdMinor ===
      null ||
    merchandise >=
      policy.freeShippingThresholdMinor
      ? 0
      : policy.customerShippingChargeMinor;

  return {
    revenueMinor:
      merchandise + shippingRevenue,
    contributionMinor:
      meanContributionPerUnit *
        expectedUnits +
      shippingRevenue,
    contributionVarianceMinorSquared:
      variancePerUnit * expectedUnits,
  };
}

function seasonalityAt(
  world: GeneratedMerchantWorld,
  timestampMs: number,
): number {
  const date = new Date(timestampMs);
  const month = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ][date.getUTCMonth()]!;
  const weekday = [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ][date.getUTCDay()]!;
  let multiplier = 1;
  for (const mechanism of world.manifest.seasonality) {
    if (mechanism.kind === "month") {
      const item = mechanism.multipliers.find(
        (candidate) =>
          candidate.key === month,
      );
      if (item) {
        multiplier *= Number(
          item.multiplier,
        );
      }
    } else if (
      mechanism.kind === "weekday"
    ) {
      const item = mechanism.multipliers.find(
        (candidate) =>
          candidate.key === weekday,
      );
      if (item) {
        multiplier *= Number(
          item.multiplier,
        );
      }
    }
  }

  for (const shock of world.manifest.externalShocks) {
    if (
      !shock.affectedVariables.includes(
        "demand.product_units",
      ) &&
      !shock.affectedVariables.includes(
        "commerce.orders",
      ) &&
      !shock.affectedVariables.includes(
        "funnel.purchase_probability",
      )
    ) {
      continue;
    }
    const start = Date.parse(shock.start);
    const end =
      start +
      Number(shock.durationSeconds) *
        1_000;
    if (
      timestampMs < start ||
      timestampMs >= end
    ) {
      continue;
    }
    const effect = Number(
      shock.mechanism.effect,
    );
    if (!Number.isFinite(effect)) continue;
    if (
      shock.mechanism.functionalForm ===
      "multiplicative"
    ) {
      multiplier *= Math.max(0, effect);
    } else {
      multiplier *= Math.max(
        0,
        1 + effect,
      );
    }
  }

  return clamp(multiplier, 0.1, 6);
}

function averageFutureDemandEnvironment(
  world: GeneratedMerchantWorld,
  startMs: number,
  endMs: number,
): number {
  if (endMs <= startMs) return 1;
  const step = 14 * DAY_MS;
  let sum = 0;
  let count = 0;
  for (
    let timestamp = startMs;
    timestamp < endMs;
    timestamp += step
  ) {
    sum += seasonalityAt(
      world,
      timestamp,
    );
    count += 1;
  }
  return count > 0 ? sum / count : 1;
}

function inventoryAvailabilityFactor(
  report: EcommerceEconomicReport,
  customer: LatentCustomer,
): number {
  const inventory =
    report.simulation.godMode.inventory;
  if (!inventory) return 1;
  const preferred = new Set(
    customer.productPreferences.map(
      (preference) =>
        preference.productId,
    ),
  );
  const positions = inventory.positions.filter(
    (position) =>
      preferred.size === 0 ||
      preferred.has(position.productId),
  );
  if (positions.length === 0) return 1;
  const availableShare =
    positions.filter(
      (position) =>
        position.availableToSellUnits > 0 ||
        position.inboundUnits > 0,
    ).length / positions.length;
  return clamp(
    0.72 + availableShare * 0.28,
    0.72,
    1,
  );
}

function lifecycleMarketingFactor(
  scenario: RetentionLtvScenario,
  context: RetentionCustomerContext,
  timestampMs: number,
): number {
  const channels = [
    ...new Set(
      (scenario.lifecycleMarketing ?? []).map(
        (campaign) => campaign.channel,
      ),
    ),
  ];
  if (channels.length === 0) return 1;
  const values = channels.map((channel) => {
    const multipliers =
      lifecycleMarketingMultipliers(
        scenario,
        context,
        timestampMs,
        channel,
      );
    return (
      multipliers.opportunity *
      multipliers.causalResponse
    );
  });
  const mean =
    values.reduce(
      (sum, value) => sum + value,
      0,
    ) / values.length;
  const receptivity = clamp(
    0.5 +
      context.source.latentFactors
        .marketingReceptivity *
        0.15,
    0.2,
    1.6,
  );
  return clamp(
    1 + (mean - 1) * 0.2 * receptivity,
    0.5,
    2,
  );
}

function expectedFutureValue(
  request: RetentionLtvEvaluationRequest,
  scenario: RetentionLtvScenario,
  discounting: FutureValueDiscounting,
  observedReport: EcommerceEconomicReport,
  customer: LatentCustomer,
  observedOrders: readonly OrderEconomics[],
): CustomerValueForecast {
  const asOfMs = Date.parse(request.asOf);
  const horizonDays =
    request.expectedLifetimeHorizonDays ??
    730;
  if (
    !Number.isFinite(horizonDays) ||
    horizonDays <= 0
  ) {
    throw new RangeError(
      "expectedLifetimeHorizonDays must be positive",
    );
  }
  const context = retentionContext(
    customer,
    observedReport,
    observedOrders,
  );
  const baseAnnualHazard =
    customer.annualPurchaseHazard *
    repeatPurchaseHazardMultiplier(
      request.merchantWorld,
      scenario,
      context,
    );
  const environment =
    averageFutureDemandEnvironment(
      request.merchantWorld,
      asOfMs,
      asOfMs + horizonDays * DAY_MS,
    );
  const inventory =
    inventoryAvailabilityFactor(
      observedReport,
      customer,
    );
  const marketing =
    lifecycleMarketingFactor(
      scenario,
      context,
      asOfMs,
    );
  const fullPriceWaitingPenalty = clamp(
    1 -
      Math.max(
        0,
        context.promotionDependenceShift,
      ) *
        0.1,
    0.35,
    1,
  );
  const annualHazard = Math.max(
    0,
    baseAnnualHazard *
      environment *
      inventory *
      marketing *
      fullPriceWaitingPenalty,
  );
  const years = horizonDays / YEAR_DAYS;
  const baseDecay =
    Math.max(
      0.02,
      (1 -
        customer.repeatPropensity) *
        0.7,
    );
  const subscriptionCancellation =
    request.merchantWorld.summary
      .businessModel === "subscription"
      ? scenario.subscription
          ?.cancellationProbabilityPerRenewal ??
        0
      : 0;
  const decayRate =
    baseDecay +
    subscriptionCancellation *
      Math.max(
        1,
        YEAR_DAYS /
          Math.max(
            1,
            customer
              .expectedPurchaseIntervalDays,
          ),
      );
  const expectedOrders =
    decayRate > 1e-12
      ? annualHazard *
        ((1 -
          Math.exp(-decayRate * years)) /
          decayRate)
      : annualHazard * years;

  const perOrder = expectedOrderEconomics(
    request,
    customer,
    context,
    observedReport.productProfiles,
    observedReport.policy,
  );
  const expectedRevenue =
    expectedOrders * perOrder.revenueMinor;
  const expectedContribution =
    expectedOrders *
    perOrder.contributionMinor;
  const midpointDays = horizonDays / 2;
  const discounted =
    discountFutureValue(
      expectedContribution,
      midpointDays,
      discounting,
    );
  const variance =
    expectedOrders *
    (perOrder
      .contributionVarianceMinorSquared +
      perOrder.contributionMinor ** 2);
  const standardDeviation = Math.sqrt(
    Math.max(0, variance),
  );
  const p10 =
    expectedContribution -
    1.2816 * standardDeviation;
  const p90 =
    expectedContribution +
    1.2816 * standardDeviation;
  const realized = observedOrders.reduce(
    (sum, order) =>
      sum +
      order
        .contributionProfitBeforeAdvertisingMinor,
    0,
  );
  const realizedRevenue =
    observedOrders.reduce(
      (sum, order) =>
        sum + order.netRevenueMinor,
      0,
    );

  return {
    horizonDays,
    annualRepeatHazard: annualHazard,
    expectedFutureOrders: expectedOrders,
    expectedFutureRevenueMinor: Math.round(
      expectedRevenue,
    ),
    expectedFutureContributionMinor:
      Math.round(expectedContribution),
    discountedExpectedFutureContributionMinor:
      Math.round(discounted),
    expectedTotalLifetimeContributionMinor:
      Math.round(
        realized + discounted,
      ),
    expectedRevenueLtvMinor: Math.round(
      realizedRevenue +
        expectedRevenue,
    ),
    uncertainty: {
      method:
        "step11_poisson_hazard_product_mix_approximation",
      expectedFutureOrders: expectedOrders,
      standardDeviationContributionMinor:
        Math.round(standardDeviation),
      p10ContributionMinor:
        Math.round(p10),
      p90ContributionMinor:
        Math.round(p90),
    },
  };
}

function channelSpendMap(
  request: RetentionLtvEvaluationRequest,
): ReadonlyMap<PaidMarketingChannel, number> {
  const allocation =
    defaultAdvertisingAllocation(
      request.merchantWorld,
      request.periodStart,
      request.asOf,
    );
  const spend = new Map<
    PaidMarketingChannel,
    number
  >();
  for (
    const [channel, value] of Object.entries(
      allocation.spendMinorByChannel,
    )
  ) {
    if (
      value !== undefined &&
      isPaidMarketingChannel(channel)
    ) {
      spend.set(channel, value);
    }
  }
  for (const intervention of request.interventions ?? []) {
    const match =
      /^marketing\.([a-z_]+)\.spend$/.exec(
        intervention.variable,
      );
    if (
      !match ||
      intervention.value.kind !== "number" ||
      !isPaidMarketingChannel(match[1]!)
    ) {
      continue;
    }
    spend.set(
      match[1]!,
      Math.max(
        0,
        Math.round(
          intervention.value.value,
        ),
      ),
    );
  }
  return spend;
}

function clvHorizonsForCustomer(
  request: RetentionLtvEvaluationRequest,
  fullOrders: readonly OrderEconomics[],
  acquisitionMs: number,
  simulationEndMs: number,
): readonly CustomerClvHorizon[] {
  return normalizedHorizons(request).map(
    (horizonDays) => {
      const end =
        acquisitionMs +
        horizonDays * DAY_MS;
      const orders = fullOrders.filter(
        (order) =>
          Date.parse(order.occurredAt) >=
            acquisitionMs &&
          Date.parse(order.occurredAt) <=
            Math.min(
              end,
              simulationEndMs,
            ),
      );
      return {
        horizonDays,
        eligibleForFullFollowup:
          end <= simulationEndMs,
        realizedRevenueMinor:
          orders.reduce(
            (sum, order) =>
              sum + order.netRevenueMinor,
            0,
          ),
        realizedContributionMinor:
          orders.reduce(
            (sum, order) =>
              sum +
              order
                .contributionProfitBeforeAdvertisingMinor,
            0,
          ),
        realizedRepeatContributionMinor:
          orders
            .slice(1)
            .reduce(
              (sum, order) =>
                sum +
                order
                  .contributionProfitBeforeAdvertisingMinor,
              0,
            ),
      };
    },
  );
}

function buildLedgers(
  request: RetentionLtvEvaluationRequest,
  scenario: RetentionLtvScenario,
  discounting: FutureValueDiscounting,
  observed: EcommerceEconomicReport,
  full: EcommerceEconomicReport,
): readonly CustomerEconomicLedger[] {
  const observedOrders =
    sortedOrdersByCustomer(observed);
  const fullOrders =
    sortedOrdersByCustomer(full);
  const observedReturns =
    returnRefundsByOrder(observed);
  const truth =
    purchaseTruthByOrder(observed);
  const state =
    finalStateByCustomer(observed);
  const spendMap =
    channelSpendMap(request);
  const weights =
    populationWeightMap(request);
  const acquiredWeightByChannel =
    new Map<string, number>();

  for (const customer of request.latentPopulation.customers) {
    if (
      customer.lifecycle.preSimulationHistory !==
      "none"
    ) {
      continue;
    }
    const first =
      observedOrders.get(customer.customerId)?.[0];
    if (!first) continue;
    acquiredWeightByChannel.set(
      first.source,
      (acquiredWeightByChannel.get(
        first.source,
      ) ?? 0) +
        customer.populationWeight,
    );
  }

  const asOfMs = Date.parse(request.asOf);
  const simulationEndMs =
    Date.parse(request.simulationEnd);

  return request.latentPopulation.customers.map(
    (customer) => {
      const history =
        observedOrders.get(
          customer.customerId,
        ) ?? [];
      const allOrders =
        fullOrders.get(
          customer.customerId,
        ) ?? [];
      const firstObserved =
        history[0];
      const acquired =
        customer.lifecycle
          .preSimulationHistory === "none" &&
        firstObserved !== undefined;
      const acquisitionMs =
        acquired
          ? Date.parse(
              firstObserved!.occurredAt,
            )
          : null;
      const firstTruth =
        firstObserved === undefined
          ? undefined
          : truth.get(
              firstObserved.orderId,
            );
      const lifecycle =
        state.get(customer.customerId);
      const expected =
        expectedFutureValue(
          request,
          scenario,
          discounting,
          observed,
          customer,
          history,
        );
      const source =
        acquired
          ? firstObserved!.source
          : null;
      const observedAcquisitionCost =
        source !== null &&
        isPaidMarketingChannel(source)
          ? (() => {
              const represented =
                acquiredWeightByChannel.get(
                  source,
                ) ?? 0;
              const spend =
                spendMap.get(source) ?? 0;
              return represented > 0
                ? spend / represented
                : null;
            })()
          : null;

      const realizedContribution =
        history.reduce(
          (sum, order) =>
            sum +
            order
              .contributionProfitBeforeAdvertisingMinor,
          0,
        );
      const futureRealized =
        allOrders
          .filter(
            (order) =>
              Date.parse(order.occurredAt) >
                asOfMs,
          )
          .reduce(
            (sum, order) =>
              sum +
              order
                .contributionProfitBeforeAdvertisingMinor,
            0,
          );

      const clvByHorizon =
        acquisitionMs === null
          ? []
          : clvHorizonsForCustomer(
              request,
              allOrders,
              acquisitionMs,
              simulationEndMs,
            );

      return {
        customerId: customer.customerId,
        populationWeight:
          weights.get(customer.customerId) ?? 1,
        origin: acquired
          ? "acquired_in_simulation"
          : customer.lifecycle
                .preSimulationHistory !== "none"
            ? "preexisting"
            : "never_purchased",
        acquisitionTimestamp:
          acquisitionMs === null
            ? null
            : new Date(
                acquisitionMs,
              ).toISOString(),
        acquisitionSource: source,
        acquisitionPath:
          firstTruth?.observablePath ?? [],
        causalAcquisitionChannels:
          lifecycle?.retention
            ?.causalAcquisitionChannels ??
          [],
        firstPurchase:
          firstObserved === undefined
            ? null
            : purchaseEntry(
                firstObserved,
                observedReturns,
              ),
        subsequentPurchases: history
          .slice(1)
          .map((order) =>
            purchaseEntry(
              order,
              observedReturns,
            ),
          ),
        realizedGrossRevenueMinor:
          history.reduce(
            (sum, order) =>
              sum +
              order
                .grossMerchandiseRevenueMinor,
            0,
          ),
        realizedNetRevenueMinor:
          history.reduce(
            (sum, order) =>
              sum + order.netRevenueMinor,
            0,
          ),
        realizedCogsMinor:
          history.reduce(
            (sum, order) =>
              sum + order.cogsMinor,
            0,
          ),
        realizedGrossProfitMinor:
          history.reduce(
            (sum, order) =>
              sum + order.grossProfitMinor,
            0,
          ),
        realizedContributionProfitBeforeAdvertisingMinor:
          realizedContribution,
        realizedReturnsRefundsMinor:
          history.reduce(
            (sum, order) =>
              sum +
              (observedReturns.get(
                order.orderId,
              ) ?? 0),
            0,
          ),
        repeatContributionMinor: history
          .slice(1)
          .reduce(
            (sum, order) =>
              sum +
              order
                .contributionProfitBeforeAdvertisingMinor,
            0,
          ),
        observedAcquisitionCostMinor:
          observedAcquisitionCost === null
            ? null
            : Math.round(
                observedAcquisitionCost,
              ),
        cumulativeRealizedContributionAfterObservedAcquisitionCostMinor:
          Math.round(
            realizedContribution -
              (observedAcquisitionCost ?? 0),
          ),
        lifecycleState:
          lifecycle?.lifecycle ??
          customer.lifecycle.state,
        trueChurnState:
          lifecycle?.retention
            ?.trueChurnState ??
          null,
        estimatedLapseRisk: clamp(
          1 -
            customer.repeatPropensity *
              (lifecycle?.retention
                ?.repeatHazardQualityMultiplier ??
                1) *
              0.55,
          0,
          1,
        ),
        clvByHorizon,
        expectedValue: expected,
        oracleFutureRealizedContributionMinor:
          futureRealized,
      };
    },
  );
}

function weightedQuantile(
  values: readonly {
    value: number;
    weight: number;
  }[],
  quantile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort(
    (left, right) =>
      left.value - right.value,
  );
  const total = sorted.reduce(
    (sum, item) =>
      sum + item.weight,
    0,
  );
  const target =
    total * clamp(quantile, 0, 1);
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) {
      return item.value;
    }
  }
  return sorted[sorted.length - 1]!.value;
}

function timeToSecondPurchase(
  ledgers: readonly CustomerEconomicLedger[],
  full: EcommerceEconomicReport,
): TimeToSecondPurchaseSummary {
  const ordersByCustomer =
    sortedOrdersByCustomer(full);
  const values: Array<{
    value: number;
    weight: number;
  }> = [];
  for (const ledger of ledgers) {
    if (
      ledger.origin !==
      "acquired_in_simulation"
    ) {
      continue;
    }
    const orders =
      ordersByCustomer.get(
        ledger.customerId,
      ) ?? [];
    if (orders.length < 2) continue;
    values.push({
      value:
        (Date.parse(
          orders[1]!.occurredAt,
        ) -
          Date.parse(
            orders[0]!.occurredAt,
          )) /
        DAY_MS,
      weight: ledger.populationWeight,
    });
  }
  const totalWeight = values.reduce(
    (sum, item) =>
      sum + item.weight,
    0,
  );
  return {
    representedCustomersWithSecondPurchase:
      totalWeight,
    meanDays:
      totalWeight > 0
        ? values.reduce(
            (sum, item) =>
              sum +
              item.value * item.weight,
            0,
          ) / totalWeight
        : null,
    medianDays:
      weightedQuantile(values, 0.5),
    p90Days:
      weightedQuantile(values, 0.9),
  };
}

function retentionCurve(
  request: RetentionLtvEvaluationRequest,
  ledgers: readonly CustomerEconomicLedger[],
  full: EcommerceEconomicReport,
): readonly RetentionCurvePoint[] {
  const ordersByCustomer =
    sortedOrdersByCustomer(full);
  const simulationEndMs =
    Date.parse(request.simulationEnd);

  return normalizedHorizons(request).map(
    (day) => {
      let eligible = 0;
      let repeated = 0;
      let active = 0;
      let repeatOrders = 0;
      let repeatRevenue = 0;
      let contribution = 0;

      for (const ledger of ledgers) {
        if (
          ledger.origin !==
            "acquired_in_simulation" ||
          ledger.acquisitionTimestamp === null
        ) {
          continue;
        }
        const acquisitionMs =
          Date.parse(
            ledger.acquisitionTimestamp,
          );
        const checkpoint =
          acquisitionMs + day * DAY_MS;
        if (checkpoint > simulationEndMs) {
          continue;
        }
        const weight =
          ledger.populationWeight;
        eligible += weight;
        const orders =
          (
            ordersByCustomer.get(
              ledger.customerId,
            ) ?? []
          ).filter(
            (order) =>
              Date.parse(order.occurredAt) <=
              checkpoint,
          );
        if (orders.length > 1) {
          repeated += weight;
        }
        repeatOrders +=
          Math.max(
            0,
            orders.length - 1,
          ) * weight;
        repeatRevenue +=
          orders
            .slice(1)
            .reduce(
              (sum, order) =>
                sum +
                order.netRevenueMinor,
              0,
            ) * weight;
        contribution +=
          orders.reduce(
            (sum, order) =>
              sum +
              order
                .contributionProfitBeforeAdvertisingMinor,
            0,
          ) * weight;

        const source =
          request.latentPopulation.customers.find(
            (customer) =>
              customer.customerId ===
              ledger.customerId,
          );
        const cadence =
          Math.max(
            7,
            source?.expectedPurchaseIntervalDays ??
              30,
          );
        const last =
          orders[orders.length - 1];
        if (
          last !== undefined &&
          checkpoint -
            Date.parse(last.occurredAt) <=
            cadence * 1.5 * DAY_MS
        ) {
          active += weight;
        }
      }

      return {
        day,
        eligibleCustomerWeight: eligible,
        repeatPurchaseProbability:
          eligible > 0
            ? repeated / eligible
            : null,
        activeCustomerProbability:
          eligible > 0
            ? active / eligible
            : null,
        cumulativeRepeatOrders:
          repeatOrders,
        cumulativeRepeatRevenueMinor:
          Math.round(repeatRevenue),
        cumulativeContributionMinor:
          Math.round(contribution),
      };
    },
  );
}

function repeatContributionWithin(
  fullOrders: readonly OrderEconomics[],
  acquisitionMs: number,
  days: number,
): number {
  const end =
    acquisitionMs + days * DAY_MS;
  return fullOrders
    .slice(1)
    .filter(
      (order) =>
        Date.parse(order.occurredAt) <= end,
    )
    .reduce(
      (sum, order) =>
        sum +
        order
          .contributionProfitBeforeAdvertisingMinor,
      0,
    );
}

function cohortKeys(
  request: RetentionLtvEvaluationRequest,
  ledger: CustomerEconomicLedger,
): readonly {
  dimension: CohortDimension;
  key: string;
}[] {
  if (
    ledger.origin !==
      "acquired_in_simulation" ||
    ledger.firstPurchase === null ||
    ledger.acquisitionTimestamp === null
  ) {
    return [];
  }
  const customer =
    request.latentPopulation.customers.find(
      (candidate) =>
        candidate.customerId ===
        ledger.customerId,
    );
  const first =
    ledger.firstPurchase;
  const firstContribution =
    first
      .contributionProfitBeforeAdvertisingMinor;
  const baseline = Math.max(
    1,
    request.merchantWorld.summary
      .expectedAovMinor *
      request.merchantWorld.summary
        .expectedContributionMarginRate,
  );
  const band =
    firstContribution < 0
      ? "negative"
      : firstContribution <
          baseline * 0.5
        ? "low"
        : firstContribution >
            baseline * 1.5
          ? "high"
          : "medium";
  const segment =
    customer?.derivedSegments[0] ??
    "unsegmented";

  return [
    {
      dimension: "acquisition_month",
      key: ledger.acquisitionTimestamp.slice(
        0,
        7,
      ),
    },
    {
      dimension: "acquisition_channel",
      key: String(
        ledger.acquisitionSource,
      ),
    },
    {
      dimension: "first_product",
      key:
        first.products[0] ??
        "unknown",
    },
    {
      dimension: "first_category",
      key:
        first.categories[0] ??
        "unknown",
    },
    {
      dimension: "promotion_status",
      key:
        first.grossRevenueMinor >
        first.netRevenueMinor
          ? "promoted"
          : "full_price",
    },
    {
      dimension: "customer_segment",
      key: segment,
    },
    {
      dimension:
        "first_order_contribution_band",
      key: band,
    },
  ];
}

function cohorts(
  request: RetentionLtvEvaluationRequest,
  ledgers: readonly CustomerEconomicLedger[],
): readonly CustomerCohortSummary[] {
  type Member = {
    ledger: CustomerEconomicLedger;
    weight: number;
  };
  const groups = new Map<
    string,
    {
      dimension: CohortDimension;
      key: string;
      members: Member[];
    }
  >();

  for (const ledger of ledgers) {
    for (const cohort of cohortKeys(
      request,
      ledger,
    )) {
      const id =
        cohort.dimension +
        "::" +
        cohort.key;
      const group =
        groups.get(id) ?? {
          ...cohort,
          members: [],
        };
      group.members.push({
        ledger,
        weight:
          ledger.populationWeight,
      });
      groups.set(id, group);
    }
  }

  const summarizeProbability = (
    members: readonly Member[],
    day: number,
  ): number | null => {
    let eligible = 0;
    let repeated = 0;
    for (const member of members) {
      const point =
        member.ledger.clvByHorizon.find(
          (candidate) =>
            candidate.horizonDays === day,
        );
      if (
        !point ||
        !point.eligibleForFullFollowup
      ) {
        continue;
      }
      eligible += member.weight;
      if (
        point
          .realizedRepeatContributionMinor !==
          0
      ) {
        repeated += member.weight;
      }
    }
    return eligible > 0
      ? repeated / eligible
      : null;
  };

  return [...groups.values()]
    .map((group) => {
      const represented =
        group.members.reduce(
          (sum, member) =>
            sum + member.weight,
          0,
        );
      const weighted = (
        getter: (
          ledger: CustomerEconomicLedger,
        ) => number,
      ): number =>
        represented > 0
          ? group.members.reduce(
              (sum, member) =>
                sum +
                getter(member.ledger) *
                  member.weight,
              0,
            ) / represented
          : 0;

      return {
        dimension: group.dimension,
        key: group.key,
        representedCustomers:
          represented,
        repeatPurchaseProbability90d:
          summarizeProbability(
            group.members,
            90,
          ),
        repeatPurchaseProbability365d:
          summarizeProbability(
            group.members,
            365,
          ),
        averageFirstOrderContributionMinor:
          Math.round(
            weighted(
              (ledger) =>
                ledger.firstPurchase
                  ?.contributionProfitBeforeAdvertisingMinor ??
                0,
            ),
          ),
        averageRealized365dContributionMinor:
          Math.round(
            weighted(
              (ledger) =>
                ledger.clvByHorizon.find(
                  (point) =>
                    point.horizonDays ===
                    365,
                )
                  ?.realizedContributionMinor ??
                0,
            ),
          ),
        averageExpectedRemainingContributionMinor:
          Math.round(
            weighted(
              (ledger) =>
                ledger.expectedValue
                  .discountedExpectedFutureContributionMinor,
            ),
          ),
      };
    })
    .sort(
      (left, right) =>
        left.dimension.localeCompare(
          right.dimension,
        ) ||
        left.key.localeCompare(right.key),
    );
}

function acquisitionChannelRows(
  request: RetentionLtvEvaluationRequest,
  ledgers: readonly CustomerEconomicLedger[],
  observed: EcommerceEconomicReport,
  full: EcommerceEconomicReport,
): readonly AcquisitionChannelEconomics[] {
  const acquired = ledgers.filter(
    (ledger) =>
      ledger.origin ===
        "acquired_in_simulation" &&
      ledger.acquisitionSource !== null,
  );
  const channelSet = new Set<ObservableSource>(
    acquired.map(
      (ledger) =>
        ledger.acquisitionSource!,
    ),
  );
  for (const channel of request.merchantWorld.summary.activeChannels) {
    if (isPaidMarketingChannel(channel)) {
      channelSet.add(channel);
    }
  }

  const groups = new Map<
    ObservableSource,
    CustomerEconomicLedger[]
  >();
  for (const channel of channelSet) {
    const paid =
      isPaidMarketingChannel(channel);
    const customers = acquired.filter(
      (ledger) =>
        ledger.acquisitionSource === channel ||
        (paid &&
          ledger.causalAcquisitionChannels.includes(
            channel,
          )),
    );
    if (customers.length > 0) {
      groups.set(channel, customers);
    }
  }

  const fullOrders =
    sortedOrdersByCustomer(full);
  const spendMap =
    channelSpendMap(request);
  const firstOrderIds = new Set(
    ledgers
      .filter(
        (ledger) =>
          ledger.origin ===
          "acquired_in_simulation" &&
          ledger.firstPurchase !== null,
      )
      .map(
        (ledger) =>
          ledger.firstPurchase!.orderId,
      ),
  );

  return [...groups.entries()]
    .map(([channel, customers]) => {
      const represented =
        customers.reduce(
          (sum, ledger) =>
            sum +
            ledger.populationWeight,
          0,
        );
      const paid =
        isPaidMarketingChannel(channel);
      const spend =
        paid
          ? spendMap.get(channel) ?? 0
          : null;
      let platformRoas: number | null =
        null;
      if (paid && spend !== null) {
        const platform =
          buildPlatformChannelReport(
            observed.simulation,
            request.latentPopulation,
            channel,
            spend,
          );
        const weights =
          populationWeightMap(request);
        const attributedFirstOrderRevenue =
          platform.claims
            .filter((claim) =>
              firstOrderIds.has(
                claim.orderId,
              ),
            )
            .reduce(
              (sum, claim) =>
                sum +
                claim
                  .attributedRevenueMinor *
                  (weights.get(
                    claim.customerId,
                  ) ?? 1),
              0,
            );
        platformRoas =
          spend > 0
            ? attributedFirstOrderRevenue /
              spend
            : null;
      }

      const weightedSum = (
        getter: (
          ledger: CustomerEconomicLedger,
        ) => number,
      ): number =>
        customers.reduce(
          (sum, ledger) =>
            sum +
            getter(ledger) *
              ledger.populationWeight,
          0,
        );

      const repeatAt = (
        days: number,
      ): number =>
        customers.reduce(
          (sum, ledger) => {
            if (
              ledger.acquisitionTimestamp ===
              null
            ) {
              return sum;
            }
            const orders =
              fullOrders.get(
                ledger.customerId,
              ) ?? [];
            return (
              sum +
              repeatContributionWithin(
                orders,
                Date.parse(
                  ledger.acquisitionTimestamp,
                ),
                days,
              ) *
                ledger.populationWeight
            );
          },
          0,
        );

      const firstRevenue = weightedSum(
        (ledger) =>
          ledger.firstPurchase
            ?.netRevenueMinor ?? 0,
      );
      const firstContribution = weightedSum(
        (ledger) =>
          ledger.firstPurchase
            ?.contributionProfitBeforeAdvertisingMinor ??
          0,
      );
      const expectedRemaining = weightedSum(
        (ledger) =>
          ledger.expectedValue
            .discountedExpectedFutureContributionMinor,
      );
      const realizedObserved = weightedSum(
        (ledger) =>
          ledger
            .realizedContributionProfitBeforeAdvertisingMinor,
      );

      return {
        channel,
        paidChannel: paid,
        spendMinor: spend,
        representedAcquiredCustomers:
          represented,
        observedFirstOrderCacMinor:
          spend !== null &&
          represented > 0
            ? spend / represented
            : null,
        firstOrderPlatformRoas:
          platformRoas,
        firstOrderRevenueMinor:
          Math.round(firstRevenue),
        firstOrderContributionMinor:
          Math.round(firstContribution),
        repeatContribution30dMinor:
          Math.round(repeatAt(30)),
        repeatContribution90dMinor:
          Math.round(repeatAt(90)),
        repeatContribution180dMinor:
          Math.round(repeatAt(180)),
        repeatContribution365dMinor:
          Math.round(repeatAt(365)),
        expectedRemainingContributionMinor:
          Math.round(
            expectedRemaining,
          ),
        expectedTotalContributionAfterObservedAcquisitionCostMinor:
          Math.round(
            realizedObserved +
              expectedRemaining -
              (spend ?? 0),
          ),
        causalTreatmentCustomerWeight:
          customers.reduce(
            (sum, ledger) =>
              sum +
              (paid &&
              ledger.causalAcquisitionChannels.includes(
                channel,
              )
                ? ledger.populationWeight
                : 0),
            0,
          ),
      };
    })
    .sort(
      (left, right) =>
        left.channel.localeCompare(
          right.channel,
        ),
    );
}

export function evaluateRetentionLtvEconomics(
  request: RetentionLtvEvaluationRequest,
): RetentionLtvReport {
  const startMs = assertTimestamp(
    request.periodStart,
    "periodStart",
  );
  const asOfMs = assertTimestamp(
    request.asOf,
    "asOf",
  );
  const endMs = assertTimestamp(
    request.simulationEnd,
    "simulationEnd",
  );
  if (
    !(startMs < asOfMs && asOfMs < endMs)
  ) {
    throw new RangeError(
      "Step 11 requires periodStart < asOf < simulationEnd",
    );
  }
  const scenario =
    request.retentionScenario ??
    defaultRetentionLtvScenario(
      request.merchantWorld,
    );
  validateRetentionLtvScenario(
    scenario,
  );
  const discounting =
    resolvedDiscounting(request);

  const observed =
    evaluateEcommerceEconomics(
      ecommerceRequest(
        request,
        request.asOf,
        scenario,
      ),
    );
  const full =
    evaluateEcommerceEconomics(
      ecommerceRequest(
        request,
        request.simulationEnd,
        scenario,
      ),
    );
  const customerLedger =
    buildLedgers(
      request,
      scenario,
      discounting,
      observed,
      full,
    );

  return {
    version: RETENTION_LTV_VERSION,
    merchantWorldId:
      request.merchantWorld.manifest.worldId,
    periodStart: request.periodStart,
    asOf: request.asOf,
    simulationEnd:
      request.simulationEnd,
    scenario,
    discounting,
    observedReport: observed,
    fullHorizonReport: full,
    customerLedger,
    retentionCurve: retentionCurve(
      request,
      customerLedger,
      full,
    ),
    timeToSecondPurchase:
      timeToSecondPurchase(
        customerLedger,
        full,
      ),
    cohorts: cohorts(
      request,
      customerLedger,
    ),
    acquisitionChannels:
      acquisitionChannelRows(
        request,
        customerLedger,
        observed,
        full,
      ),
    godModeOnly: true,
  };
}

function representedAcquiredCustomers(
  report: RetentionLtvReport,
): number {
  return report.customerLedger
    .filter(
      (ledger) =>
        ledger.origin ===
        "acquired_in_simulation",
    )
    .reduce(
      (sum, ledger) =>
        sum + ledger.populationWeight,
      0,
    );
}

function representedFirstOrderContribution(
  report: RetentionLtvReport,
): number {
  return report.customerLedger
    .filter(
      (ledger) =>
        ledger.origin ===
        "acquired_in_simulation",
    )
    .reduce(
      (sum, ledger) =>
        sum +
        (ledger.firstPurchase
          ?.contributionProfitBeforeAdvertisingMinor ??
          0) *
          ledger.populationWeight,
      0,
    );
}

function representedExpectedRemaining(
  report: RetentionLtvReport,
): number {
  return report.customerLedger.reduce(
    (sum, ledger) =>
      sum +
      ledger.expectedValue
        .discountedExpectedFutureContributionMinor *
        ledger.populationWeight,
    0,
  );
}

function representedObservedContribution(
  report: RetentionLtvReport,
): number {
  return report.customerLedger.reduce(
    (sum, ledger) =>
      sum +
      ledger
        .realizedContributionProfitBeforeAdvertisingMinor *
        ledger.populationWeight,
    0,
  );
}

function fullPreAdvertisingContribution(
  report: RetentionLtvReport,
): number {
  const weights = new Map(
    report.customerLedger.map(
      (ledger) =>
        [
          ledger.customerId,
          ledger.populationWeight,
        ] as const,
    ),
  );
  return report.fullHorizonReport.orders.reduce(
    (sum, order) =>
      sum +
      order
        .contributionProfitBeforeAdvertisingMinor *
        (weights.get(order.customerId) ?? 1),
    0,
  );
}

function firstOrderProductSet(
  ledger: CustomerEconomicLedger | undefined,
): ReadonlySet<string> {
  return new Set(
    ledger?.firstPurchase?.products ?? [],
  );
}

function counterfactualOutcomes(
  factual: RetentionLtvReport,
  counterfactual: RetentionLtvReport,
): readonly AcquisitionCounterfactualCustomerOutcome[] {
  const control = new Map(
    counterfactual.customerLedger.map(
      (ledger) =>
        [ledger.customerId, ledger] as const,
    ),
  );
  return factual.customerLedger
    .filter(
      (ledger) =>
        ledger.origin ===
        "acquired_in_simulation",
    )
    .map((ledger) => {
      const other =
        control.get(ledger.customerId);
      const factualAt =
        ledger.acquisitionTimestamp;
      const controlAt =
        other?.acquisitionTimestamp ??
        null;
      const factualProducts =
        firstOrderProductSet(ledger);
      const controlProducts =
        firstOrderProductSet(other);
      const sameProduct =
        [...factualProducts].some(
          (productId) =>
            controlProducts.has(productId),
        );
      const later =
        factualAt !== null &&
        controlAt !== null &&
        Date.parse(controlAt) >
          Date.parse(factualAt) +
            12 * 3_600_000;
      const otherChannel =
        ledger.acquisitionSource !== null &&
        other?.acquisitionSource !==
          null &&
        other?.acquisitionSource !==
          undefined &&
        ledger.acquisitionSource !==
          other.acquisitionSource;
      const factualCount =
        ledger.subsequentPurchases.length +
        (ledger.firstPurchase === null
          ? 0
          : 1);
      const controlCount =
        (other?.subsequentPurchases.length ??
          0) +
        (other?.firstPurchase === null ||
        other?.firstPurchase === undefined
          ? 0
          : 1);
      const factualValue =
        ledger
          .oracleFutureRealizedContributionMinor +
        ledger
          .realizedContributionProfitBeforeAdvertisingMinor;
      const controlValue =
        (other
          ?.oracleFutureRealizedContributionMinor ??
          0) +
        (other
          ?.realizedContributionProfitBeforeAdvertisingMinor ??
          0);
      return {
        customerId: ledger.customerId,
        populationWeight:
          ledger.populationWeight,
        factualFirstPurchaseAt: factualAt,
        counterfactualFirstPurchaseAt:
          controlAt,
        wouldNeverHavePurchasedOtherwise:
          controlAt === null,
        wouldHavePurchasedLater: later,
        wouldHavePurchasedThroughAnotherChannel:
          otherChannel,
        wouldHavePurchasedSameProductAnyway:
          sameProduct,
        interventionChangedOnlyTiming:
          later &&
          sameProduct &&
          factualCount === controlCount &&
          Math.abs(
            factualValue - controlValue,
          ) <
            Math.max(
              100,
              Math.abs(factualValue) *
                0.05,
            ),
        interventionChangedLongTermRelationship:
          factualCount !== controlCount ||
          Math.abs(
            factualValue - controlValue,
          ) >=
            Math.max(
              100,
              Math.abs(controlValue) *
                0.1,
            ),
      };
    });
}

function spendForChannel(
  request: RetentionLtvEvaluationRequest,
  channel: PaidMarketingChannel,
): number {
  return channelSpendMap(request).get(
    channel,
  ) ?? 0;
}

function zeroChannelInterventions(
  interventions: readonly Intervention[],
  channel: PaidMarketingChannel,
): readonly Intervention[] {
  const variable =
    `marketing.${channel}.spend`;
  return [
    ...interventions.filter(
      (intervention) =>
        intervention.variable !== variable,
    ),
    {
      variable,
      operation: "set" as const,
      value: {
        kind: "number" as const,
        value: 0,
        unit: "money_minor" as const,
      },
    },
  ];
}

export function evaluateAcquisitionChannelCounterfactual(
  request: RetentionLtvEvaluationRequest,
  channel: PaidMarketingChannel,
  factualReport?: RetentionLtvReport,
): AcquisitionChannelCounterfactual {
  const factual =
    factualReport ??
    evaluateRetentionLtvEconomics(
      request,
    );
  const factualSpend =
    spendForChannel(request, channel);
  const controlRequest: RetentionLtvEvaluationRequest =
    {
      ...request,
      interventions:
        zeroChannelInterventions(
          request.interventions ?? [],
          channel,
        ),
    };
  const counterfactual =
    evaluateRetentionLtvEconomics(
      controlRequest,
    );
  const counterfactualSpend =
    spendForChannel(
      controlRequest,
      channel,
    );
  const incrementalSpend =
    factualSpend - counterfactualSpend;
  const fullPreAdDelta =
    fullPreAdvertisingContribution(
      factual,
    ) -
    fullPreAdvertisingContribution(
      counterfactual,
    );
  const fullAfterAdDelta =
    factual.fullHorizonReport.waterfall
      .contributionProfitMinor -
    counterfactual.fullHorizonReport
      .waterfall
      .contributionProfitMinor;
  const expectedRemainingDelta =
    representedExpectedRemaining(
      factual,
    ) -
    representedExpectedRemaining(
      counterfactual,
    );
  const observedContributionDelta =
    representedObservedContribution(
      factual,
    ) -
    representedObservedContribution(
      counterfactual,
    );

  return {
    channel,
    factualSpendMinor:
      factualSpend,
    counterfactualSpendMinor:
      counterfactualSpend,
    incrementalSpendMinor:
      incrementalSpend,
    incrementalFirstOrders:
      representedAcquiredCustomers(
        factual,
      ) -
      representedAcquiredCustomers(
        counterfactual,
      ),
    incrementalFirstOrderCacMinor:
      representedAcquiredCustomers(
        factual,
      ) -
        representedAcquiredCustomers(
          counterfactual,
        ) >
      0
        ? incrementalSpend /
          (representedAcquiredCustomers(
            factual,
          ) -
            representedAcquiredCustomers(
              counterfactual,
            ))
        : null,
    incrementalFirstOrderContributionMinor:
      Math.round(
        representedFirstOrderContribution(
          factual,
        ) -
          representedFirstOrderContribution(
            counterfactual,
          ),
      ),
    incrementalLongTermContributionBeforeAcquisitionCostMinor:
      Math.round(fullPreAdDelta),
    incrementalLongTermContributionAfterAcquisitionCostMinor:
      Math.round(fullAfterAdDelta),
    incrementalExpectedRemainingContributionMinor:
      Math.round(
        expectedRemainingDelta,
      ),
    trueIncrementalCustomerValueMinor:
      Math.round(
        observedContributionDelta +
          expectedRemainingDelta -
          incrementalSpend,
      ),
    outcomes: counterfactualOutcomes(
      factual,
      counterfactual,
    ),
    factual,
    counterfactual,
    godModeOnly: true,
  };
}
