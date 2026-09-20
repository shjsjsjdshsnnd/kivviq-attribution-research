import type { Intervention } from "../ground_truth/interventions.js";
import type { MarketingChannel } from "../generation/config.js";
import {
  referenceSpendMinor,
} from "../advertising_economics/evaluator.js";
import type {
  ChannelContributionEconomicResult,
  EcommerceEvaluationRequest,
  EconomicCounterfactualResult,
  InventoryOpportunityCostResult,
} from "./types.js";
import { evaluateEcommerceEconomics } from "./evaluator.js";

function appendInterventions(
  base: readonly Intervention[] | undefined,
  additions: readonly Intervention[],
): readonly Intervention[] {
  return [...(base ?? []), ...additions];
}

function expectedFutureValueMinor(
  report: ReturnType<typeof evaluateEcommerceEconomics>,
): number {
  return report.customerEconomics.reduce(
    (sum, customer) =>
      sum +
      customer.expectedFutureContributionMinor,
    0,
  );
}

export function evaluateEconomicCounterfactual(
  request: EcommerceEvaluationRequest,
  counterfactualInterventions: readonly Intervention[],
): EconomicCounterfactualResult {
  const factual = evaluateEcommerceEconomics(request);
  const counterfactual = evaluateEcommerceEconomics({
    ...request,
    interventions: appendInterventions(
      request.interventions,
      counterfactualInterventions,
    ),
  });

  return {
    factual,
    counterfactual,
    delta: {
      grossRevenueMinor:
        factual.waterfall.grossMerchandiseRevenueMinor -
        counterfactual.waterfall.grossMerchandiseRevenueMinor,
      netRevenueMinor:
        factual.waterfall.netRevenueMinor -
        counterfactual.waterfall.netRevenueMinor,
      grossProfitMinor:
        factual.waterfall.grossProfitMinor -
        counterfactual.waterfall.grossProfitMinor,
      contributionProfitMinor:
        factual.waterfall.contributionProfitMinor -
        counterfactual.waterfall.contributionProfitMinor,
      newCustomerContributionMinor:
        factual.newCustomer
          .firstOrderContributionProfitBeforeAdvertisingMinor -
        counterfactual.newCustomer
          .firstOrderContributionProfitBeforeAdvertisingMinor,
      repeatContributionMinor:
        factual.repeatCustomer
          .repeatContributionProfitBeforeAdvertisingMinor -
        counterfactual.repeatCustomer
          .repeatContributionProfitBeforeAdvertisingMinor,
      expectedFutureValueMinor:
        expectedFutureValueMinor(factual) -
        expectedFutureValueMinor(counterfactual),
    },
  };
}

function spendSetIntervention(
  channel: MarketingChannel,
  spendMinor: number,
): Intervention {
  return {
    variable: `marketing.${channel}.spend`,
    operation: "set",
    value: {
      kind: "number",
      value: Math.max(0, Math.round(spendMinor)),
      unit: "money_minor",
    },
  };
}

export function evaluateChannelContributionEconomics(
  request: EcommerceEvaluationRequest,
  channel: MarketingChannel,
  options: {
    readonly highSpendMinor?: number;
    readonly lowSpendMinor?: number;
    readonly marginalBlockMinor?: number;
  } = {},
): ChannelContributionEconomicResult {
  const reference =
    options.highSpendMinor ??
    (channel === "meta" ||
    channel === "google_search" ||
    channel === "google_shopping" ||
    channel === "pinterest" ||
    channel === "affiliate"
      ? referenceSpendMinor(request.merchantWorld, channel)
      : 100_000);

  const low =
    options.lowSpendMinor ?? 0;
  const marginalBlock = Math.max(
    1,
    options.marginalBlockMinor ?? Math.max(10_000, reference * 0.2),
  );

  const highReport = evaluateEcommerceEconomics({
    ...request,
    interventions: appendInterventions(
      request.interventions,
      [spendSetIntervention(channel, reference)],
    ),
  });
  const lowReport = evaluateEcommerceEconomics({
    ...request,
    interventions: appendInterventions(
      request.interventions,
      [spendSetIntervention(channel, low)],
    ),
  });

  const marginalLow = Math.max(
    0,
    reference - marginalBlock,
  );
  const marginalLowReport = evaluateEcommerceEconomics({
    ...request,
    interventions: appendInterventions(
      request.interventions,
      [spendSetIntervention(channel, marginalLow)],
    ),
  });

  return {
    channel,
    incrementalGrossRevenueMinor:
      highReport.waterfall.grossMerchandiseRevenueMinor -
      lowReport.waterfall.grossMerchandiseRevenueMinor,
    incrementalNetRevenueMinor:
      highReport.waterfall.netRevenueMinor -
      lowReport.waterfall.netRevenueMinor,
    incrementalGrossProfitMinor:
      highReport.waterfall.grossProfitMinor -
      lowReport.waterfall.grossProfitMinor,
    incrementalContributionProfitMinor:
      highReport.waterfall.contributionProfitMinor -
      lowReport.waterfall.contributionProfitMinor,
    marginalIncrementalContributionProfitMinor:
      reference > marginalLow
        ? highReport.waterfall.contributionProfitMinor -
          marginalLowReport.waterfall.contributionProfitMinor
        : null,
  };
}

export function evaluateInventoryOpportunityCost(
  request: EcommerceEvaluationRequest,
  productId: string,
  scarceUnits: number,
): InventoryOpportunityCostResult {
  const normalizedUnits = Math.max(
    0,
    Math.floor(scarceUnits),
  );

  const immediate = evaluateEcommerceEconomics({
    ...request,
    interventions: appendInterventions(
      request.interventions,
      [
        {
          variable: "inventory.available",
          operation: "set",
          value: {
            kind: "number",
            value: normalizedUnits,
            unit: "units",
          },
        },
      ],
    ),
  });

  const conserved = evaluateEcommerceEconomics({
    ...request,
    interventions: appendInterventions(
      request.interventions,
      [
        {
          variable: "inventory.available",
          operation: "set",
          value: {
            kind: "number",
            value: 0,
            unit: "units",
          },
        },
      ],
    ),
  });

  const immediateProduct =
    immediate.byProduct.find((row) => row.key === productId);
  const conservedProduct =
    conserved.byProduct.find((row) => row.key === productId);

  const immediateContribution =
    immediateProduct?.contributionProfitBeforeAdvertisingMinor ?? 0;
  const conservedContribution =
    conservedProduct?.contributionProfitBeforeAdvertisingMinor ?? 0;

  return {
    productId,
    scarceUnits: normalizedUnits,
    immediateContributionMinor: immediateContribution,
    conservedInventoryContributionMinor: conservedContribution,
    counterfactualOpportunityCostMinor:
      conservedContribution - immediateContribution,
    accountingAdjustmentMinor: 0,
  };
}
