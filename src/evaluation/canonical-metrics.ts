import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type {
  RealizedPurchase,
  SimulationResult,
} from "../simulation/types.js";
import type {
  BaselineEvaluationContract,
  EvaluationHorizonTimestamps,
  MetricResult,
} from "./baseline-contract.js";
import { deepFreezeEvaluation } from "./baseline-contract.js";

export interface CanonicalMetricCalculationContext {
  readonly actionCostMinor?: number;
}

function inWindow(
  timestamp: string,
  start: string,
  end: string,
): boolean {
  const value = Date.parse(timestamp);
  return value >= Date.parse(start) && value < Date.parse(end);
}

function customerWeights(
  population: LatentCustomerPopulation,
): ReadonlyMap<string, number> {
  return new Map(
    population.customers.map(
      (customer) =>
        [customer.customerId, customer.populationWeight] as const,
    ),
  );
}

function weightedPurchases(
  result: SimulationResult,
  population: LatentCustomerPopulation,
  start: string,
  end: string,
): readonly {
  readonly purchase: RealizedPurchase;
  readonly weight: number;
}[] {
  const weights = customerWeights(population);
  return result.purchases
    .filter((purchase) => inWindow(purchase.occurredAt, start, end))
    .map((purchase) => ({
      purchase,
      weight: weights.get(purchase.customerId) ?? 1,
    }));
}

function weightedDistinctCustomers(
  rows: readonly {
    readonly purchase: RealizedPurchase;
    readonly weight: number;
  }[],
  predicate: (purchase: RealizedPurchase) => boolean,
): number {
  const byCustomer = new Map<string, number>();
  for (const row of rows) {
    if (!predicate(row.purchase)) continue;
    if (!byCustomer.has(row.purchase.customerId)) {
      byCustomer.set(row.purchase.customerId, row.weight);
    }
  }
  return [...byCustomer.values()].reduce(
    (sum, weight) => sum + weight,
    0,
  );
}

export function calculateCanonicalSimulationMetrics(
  contract: BaselineEvaluationContract,
  horizon: EvaluationHorizonTimestamps,
  result: SimulationResult,
  population: LatentCustomerPopulation,
  context: CanonicalMetricCalculationContext = {},
): readonly MetricResult[] {
  const rows = weightedPurchases(
    result,
    population,
    horizon.outcomeMeasurementStart,
    horizon.outcomeMeasurementEnd,
  );

  const orders = rows.reduce((sum, row) => sum + row.weight, 0);
  const revenue = rows.reduce(
    (sum, row) =>
      sum + row.purchase.netRevenueMinor * row.weight,
    0,
  );
  const grossProfit = rows.reduce(
    (sum, row) =>
      sum +
      (row.purchase.netRevenueMinor -
        row.purchase.estimatedCogsMinor) *
        row.weight,
    0,
  );
  const contributionProfit = rows.reduce(
    (sum, row) =>
      sum +
      row.purchase.contributionProfitMinor * row.weight,
    0,
  );
  const unitsSold = rows.reduce(
    (sum, row) =>
      sum +
      row.purchase.lines.reduce(
        (lineSum, line) => lineSum + line.quantity,
        0,
      ) *
        row.weight,
    0,
  );
  const discountCost = rows.reduce(
    (sum, row) =>
      sum + row.purchase.discountMinor * row.weight,
    0,
  );
  const shippingCost = rows.reduce(
    (sum, row) =>
      sum +
      (row.purchase.fulfillmentMinor +
        row.purchase.shippingSubsidyMinor) *
        row.weight,
    0,
  );
  const newCustomers = weightedDistinctCustomers(
    rows,
    (purchase) => !purchase.repeatPurchase,
  );
  const repeatCustomers = weightedDistinctCustomers(
    rows,
    (purchase) => purchase.repeatPurchase,
  );

  const supported = new Map<string, number | null>([
    ["revenue", revenue],
    ["gross_profit", grossProfit],
    ["contribution_profit", contributionProfit],
    ["orders", orders],
    ["units_sold", unitsSold],
    ["aov", orders > 0 ? revenue / orders : null],
    ["cac", null],
    ["roas", null],
    ["advertising_spend", null],
    ["new_customers", newCustomers],
    ["repeat_customers", repeatCustomers],
    ["retention", null],
    ["clv", null],
    ["inventory_remaining", null],
    ["stockouts", null],
    ["lost_demand", null],
    ["returns", null],
    ["discount_cost", discountCost],
    ["shipping_cost", shippingCost],
    [
      "action_cost",
      context.actionCostMinor === undefined
        ? null
        : context.actionCostMinor,
    ],
    ["true_incremental_profit", null],
    ["causal_lift", null],
    ["counterfactual_regret", null],
  ]);

  return deepFreezeEvaluation(
    contract.metrics.map((metric) => ({
      metricId: metric.metricId,
      value: supported.get(metric.metricId) ?? null,
    })),
  );
}
