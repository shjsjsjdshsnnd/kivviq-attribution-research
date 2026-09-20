import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
  MarketingChannel,
} from "../generation/config.js";
import {
  referenceSpendMinor,
} from "../advertising_economics/evaluator.js";
import { isPaidMarketingChannel } from "../advertising_economics/types.js";
import type {
  EcommerceEconomicReport,
  EcommercePolicy,
  ProductEconomicProfile,
} from "./types.js";
import {
  buildProductEconomicProfiles,
  resolveEcommercePolicy,
} from "./products.js";

export interface ProductOpportunityRow {
  readonly productId: string;
  readonly categoryId: string;
  readonly listPriceMinor: number;
  readonly expectedRevenuePerUnitMinor: number;
  readonly expectedContributionPerUnitMinor: number;
  readonly expectedReturnDragPerUnitMinor: number;
  readonly initialAvailableUnits: number;
  readonly thirtyDayDemandUnits: number;
  readonly revenueOpportunityMinor: number;
  readonly contributionOpportunityMinor: number;
}

function expectedUnitContribution(
  profile: ProductEconomicProfile,
  policy: EcommercePolicy,
): {
  readonly revenue: number;
  readonly contribution: number;
  readonly returnDrag: number;
} {
  const revenue = profile.listPriceMinor;
  const paymentFees =
    Math.round(revenue * policy.paymentFeeRate) +
    policy.paymentFeeFixedMinor;
  const shippingSubsidy =
    profile.shippingCostPerUnitMinor -
    policy.customerShippingChargeMinor;
  const variableOperating =
    Math.round(
      revenue * policy.variableOperatingCostRate,
    );

  const expectedRefund =
    Math.round(revenue * profile.returnProbability);
  const expectedRecoveredCogs =
    Math.round(
      profile.cogsPerUnitMinor *
        profile.returnProbability *
        (1 - profile.nonRecoverableValueRate),
    );
  const expectedReturnCosts =
    Math.round(
      profile.returnProbability *
        (profile.returnShippingCostMinor +
          profile.returnHandlingCostMinor +
          profile.restockingCostMinor),
    );
  const returnDrag =
    expectedRefund -
    expectedRecoveredCogs +
    expectedReturnCosts;

  return {
    revenue,
    returnDrag,
    contribution:
      revenue -
      profile.cogsPerUnitMinor -
      paymentFees -
      shippingSubsidy -
      profile.fulfillmentCostPerUnitMinor -
      variableOperating -
      returnDrag,
  };
}

export function productOpportunityRows(
  world: GeneratedMerchantWorld,
  options: {
    readonly policy?: Partial<EcommercePolicy>;
    readonly profiles?: readonly ProductEconomicProfile[];
  } = {},
): readonly ProductOpportunityRow[] {
  const policy = resolveEcommercePolicy(
    world,
    options.policy,
  );
  const profiles =
    options.profiles ??
    buildProductEconomicProfiles(world);
  const profileById = new Map(
    profiles.map(
      (profile) => [profile.productId, profile] as const,
    ),
  );
  const inventoryById = new Map(
    world.manifest.inventoryMechanisms.map(
      (inventory) =>
        [inventory.productId, inventory] as const,
    ),
  );

  return world.manifest.productDemandMechanisms.map(
    (demand) => {
      const profile = profileById.get(demand.productId);
      if (!profile) {
        throw new RangeError(
          `missing economic profile for ${demand.productId}`,
        );
      }
      const inventory = inventoryById.get(demand.productId);
      const available = Math.max(
        0,
        Number(inventory?.initialAvailableUnits ?? 0) -
          Number(inventory?.initialReservedUnits ?? 0),
      );
      const thirtyDayDemand =
        Number(demand.baseLatentDemandUnits) *
        (demand.cadence === "hour"
          ? 24 * 30
          : demand.cadence === "week"
            ? 30 / 7
            : 30);
      const unitsOpportunity = Math.max(
        0,
        Math.min(available, thirtyDayDemand),
      );
      const unit = expectedUnitContribution(
        profile,
        policy,
      );

      return {
        productId: profile.productId,
        categoryId: profile.categoryId,
        listPriceMinor: profile.listPriceMinor,
        expectedRevenuePerUnitMinor: unit.revenue,
        expectedContributionPerUnitMinor:
          unit.contribution,
        expectedReturnDragPerUnitMinor:
          unit.returnDrag,
        initialAvailableUnits: available,
        thirtyDayDemandUnits: thirtyDayDemand,
        revenueOpportunityMinor:
          Math.round(unitsOpportunity * unit.revenue),
        contributionOpportunityMinor:
          Math.round(
            unitsOpportunity * unit.contribution,
          ),
      };
    },
  );
}

export interface AcquisitionSourceEconomics {
  readonly source: string;
  readonly representedNewCustomers: number;
  readonly acquisitionSpendMinor: number;
  readonly cacMinor: number | null;
  readonly firstOrderRevenueMinor: number;
  readonly firstOrderContributionMinor: number;
  readonly expectedFutureContributionMinor: number;
  readonly expectedTotalEconomicValueMinor: number;
}

export function acquisitionEconomicsBySource(
  report: EcommerceEconomicReport,
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
): readonly AcquisitionSourceEconomics[] {
  const customer = new Map(
    population.customers.map(
      (entry) => [entry.customerId, entry] as const,
    ),
  );

  const rows = new Map<
    string,
    {
      customerIds: Set<string>;
      representedNewCustomers: number;
      revenue: number;
      contribution: number;
      future: number;
    }
  >();

  for (const order of report.orders) {
    if (order.repeatPurchase) continue;
    const entry = customer.get(order.customerId);
    const weight = entry?.populationWeight ?? 1;
    const row =
      rows.get(order.source) ?? {
        customerIds: new Set<string>(),
        representedNewCustomers: 0,
        revenue: 0,
        contribution: 0,
        future: 0,
      };

    if (!row.customerIds.has(order.customerId)) {
      row.customerIds.add(order.customerId);
      row.representedNewCustomers += weight;
      row.future +=
        Math.round(
          (entry?.expectedLifetimeValueMinor ?? 0) *
            weight,
        );
    }

    row.revenue += order.netRevenueMinor * weight;
    row.contribution +=
      order.contributionProfitBeforeAdvertisingMinor *
      weight;
    rows.set(order.source, row);
  }

  return [...rows.entries()]
    .map(([source, row]) => {
      let acquisitionSpendMinor = 0;
      if (
        isPaidMarketingChannel(source as MarketingChannel)
      ) {
        acquisitionSpendMinor = referenceSpendMinor(
          world,
          source as never,
        );
      }

      const paidAcquisition =
        isPaidMarketingChannel(source as MarketingChannel);

      return {
        source,
        representedNewCustomers:
          row.representedNewCustomers,
        acquisitionSpendMinor,
        cacMinor:
          paidAcquisition &&
          row.representedNewCustomers > 0
            ? acquisitionSpendMinor /
              row.representedNewCustomers
            : null,
        firstOrderRevenueMinor:
          Math.round(row.revenue),
        firstOrderContributionMinor:
          Math.round(row.contribution),
        expectedFutureContributionMinor:
          Math.round(row.future),
        expectedTotalEconomicValueMinor:
          Math.round(
            row.contribution -
              acquisitionSpendMinor +
              row.future,
          ),
      };
    })
    .sort(
      (left, right) =>
        right.expectedTotalEconomicValueMinor -
        left.expectedTotalEconomicValueMinor,
    );
}
