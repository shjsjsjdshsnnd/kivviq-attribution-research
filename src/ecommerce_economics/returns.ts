import type { LatentCustomerPopulation } from "../customer_population/types.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { RealizedPurchase } from "../simulation/types.js";
import { SharedRandomness, days } from "../simulation/kernel.js";
import {
  productEconomicProfileMap,
} from "./products.js";
import type {
  ProductEconomicProfile,
  ReturnEconomics,
  ReturnLineEconomics,
  ReturnDisposition,
} from "./types.js";

interface PhysicalInventoryReturnTruth {
  readonly returnId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly skuId: string;
  readonly returnedUnits: number;
  readonly damagedUnits: number;
  readonly receivedAt: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function customerReturnMultiplier(
  population: LatentCustomerPopulation,
  customerId: string,
): number {
  const customer = population.customers.find(
    (candidate) => candidate.customerId === customerId,
  );
  if (!customer) return 1;

  return clamp(
    0.8 +
      customer.promotionSensitivityMultiplier * 0.12 +
      customer.priceSensitivityMultiplier * 0.05 -
      customer.brandAffinity * 0.08,
    0.55,
    1.55,
  );
}

function unitReturnQuantity(
  quantity: number,
  probability: number,
  randomness: SharedRandomness,
  key: string,
): number {
  let returned = 0;
  for (let unit = 0; unit < quantity; unit += 1) {
    if (randomness.bool(`${key}:unit:${unit}`, probability)) {
      returned += 1;
    }
  }
  return returned;
}

function returnDelayMs(
  profile: ProductEconomicProfile,
  randomness: SharedRandomness,
  key: string,
): number {
  const baselineDays =
    profile.oversized
      ? 12 + randomness.uniform(`${key}:base`) * 30
      : 3 + randomness.uniform(`${key}:base`) * 28;

  return days(
    Math.max(
      1,
      baselineDays *
        Math.exp(
          randomness.normal(`${key}:noise`, 0, 0.24),
        ),
    ),
  );
}

export function simulateReturnEconomics(
  world: GeneratedMerchantWorld,
  population: LatentCustomerPopulation,
  purchases: readonly RealizedPurchase[],
  periodEnd: string,
  simulationSeed: number,
  profilesInput?: ReadonlyMap<string, ProductEconomicProfile>,
  physicalReturnTruth?: readonly PhysicalInventoryReturnTruth[],
): readonly ReturnEconomics[] {
  const profiles =
    profilesInput ?? productEconomicProfileMap(world);
  if (physicalReturnTruth !== undefined) {
    const purchaseByOrder = new Map(
      purchases.map(
        (purchase) => [purchase.orderId, purchase] as const,
      ),
    );

    const returns = physicalReturnTruth
      .map((truth): ReturnEconomics | undefined => {
        const purchase =
          purchaseByOrder.get(truth.orderId);
        const line = purchase?.lines.find(
          (candidate) =>
            candidate.productId === truth.skuId,
        );
        const profile = profiles.get(truth.skuId);
        if (
          !purchase ||
          !line ||
          !profile ||
          truth.returnedUnits <= 0
        ) {
          return undefined;
        }

        const quantity = Math.min(
          line.quantity,
          Math.max(
            0,
            Math.floor(truth.returnedUnits),
          ),
        );
        if (quantity <= 0) return undefined;

        const damagedUnits = Math.min(
          quantity,
          Math.max(
            0,
            Math.floor(truth.damagedUnits),
          ),
        );
        const perUnitRevenue =
          line.quantity > 0
            ? Math.round(
                line.revenueMinor / line.quantity,
              )
            : 0;
        const refundedRevenueMinor =
          perUnitRevenue * quantity;
        const grossRecoveredCogs =
          profile.cogsPerUnitMinor * quantity;
        const nonRecoverableInventoryCostMinor =
          profile.cogsPerUnitMinor * damagedUnits;
        const recoveredCogsMinor = Math.max(
          0,
          grossRecoveredCogs -
            nonRecoverableInventoryCostMinor,
        );
        const returnShippingCostMinor =
          profile.returnShippingCostMinor * quantity;
        const returnHandlingCostMinor =
          profile.returnHandlingCostMinor * quantity;
        const restockingCostMinor =
          profile.restockingCostMinor * quantity;
        const incrementalReturnCostsMinor =
          returnShippingCostMinor +
          returnHandlingCostMinor +
          restockingCostMinor;

        const lineEconomics: ReturnLineEconomics = {
          productId: truth.skuId,
          quantity,
          refundedRevenueMinor,
          recoveredCogsMinor,
          returnShippingCostMinor,
          returnHandlingCostMinor,
          restockingCostMinor,
          nonRecoverableInventoryCostMinor,
        };

        return {
          returnId: truth.returnId,
          orderId: truth.orderId,
          customerId: truth.customerId,
          disposition:
            quantity < line.quantity
              ? "partial_refund"
              : "return_refund",
          occurredAt: truth.receivedAt,
          lines: [lineEconomics],
          refundedRevenueMinor,
          recoveredCogsMinor,
          incrementalReturnCostsMinor,
          contributionProfitImpactMinor:
            -refundedRevenueMinor +
            recoveredCogsMinor -
            incrementalReturnCostsMinor,
        };
      })
      .filter(
        (
          value,
        ): value is ReturnEconomics =>
          value !== undefined,
      )
      .sort(
        (left, right) =>
          Date.parse(left.occurredAt) -
            Date.parse(right.occurredAt) ||
          left.returnId.localeCompare(
            right.returnId,
          ),
      );

    return returns;
  }

  const randomness = new SharedRandomness(
    simulationSeed,
    `step7-returns:${world.manifest.worldId}`,
  );
  const endMs = Date.parse(periodEnd);
  if (!Number.isFinite(endMs)) {
    throw new RangeError("periodEnd must be a valid timestamp");
  }

  const returns: ReturnEconomics[] = [];

  for (const purchase of purchases) {
    const purchaseMs = Date.parse(purchase.occurredAt);
    const customerMultiplier = customerReturnMultiplier(
      population,
      purchase.customerId,
    );

    for (let lineIndex = 0; lineIndex < purchase.lines.length; lineIndex += 1) {
      const line = purchase.lines[lineIndex]!;
      const profile = profiles.get(line.productId);
      if (!profile) continue;

      const promotionMultiplier =
        line.discountMinor > 0
          ? 1 +
            Math.max(
              0,
              population.customers.find(
                (customer) =>
                  customer.customerId === purchase.customerId,
              )?.promotionSensitivityMultiplier ?? 1,
            ) *
              0.08
          : 1;

      const probability = clamp(
        profile.returnProbability *
          customerMultiplier *
          promotionMultiplier,
        0.001,
        0.6,
      );

      const returnedQuantity = unitReturnQuantity(
        line.quantity,
        probability,
        randomness,
        `${purchase.orderId}:line:${lineIndex}`,
      );

      const nonReturnRefund =
        returnedQuantity === 0 &&
        randomness.bool(
          `${purchase.orderId}:line:${lineIndex}:non-return-refund`,
          clamp(probability * 0.035, 0.001, 0.025),
        );

      if (returnedQuantity === 0 && !nonReturnRefund) continue;

      const delayMs = returnDelayMs(
        profile,
        randomness,
        `${purchase.orderId}:line:${lineIndex}`,
      );
      const occurredMs = purchaseMs + delayMs;
      if (occurredMs > endMs) continue;

      const disposition: ReturnDisposition =
        nonReturnRefund
          ? "non_return_refund"
          : returnedQuantity < line.quantity
            ? "partial_refund"
            : "return_refund";

      const quantity = nonReturnRefund
        ? 0
        : returnedQuantity;
      const perUnitRevenue =
        line.quantity > 0
          ? Math.round(line.revenueMinor / line.quantity)
          : 0;
      const refundQuantity = nonReturnRefund
        ? Math.max(1, Math.min(1, line.quantity))
        : quantity;

      const refundedRevenueMinor =
        perUnitRevenue * refundQuantity;

      const grossRecoveredCogs =
        profile.cogsPerUnitMinor * quantity;
      const nonRecoverableInventoryCostMinor =
        Math.round(
          grossRecoveredCogs *
            profile.nonRecoverableValueRate,
        );
      const recoveredCogsMinor =
        nonReturnRefund
          ? 0
          : Math.max(
              0,
              grossRecoveredCogs -
                nonRecoverableInventoryCostMinor,
            );

      const returnShippingCostMinor =
        nonReturnRefund
          ? 0
          : profile.returnShippingCostMinor * quantity;
      const returnHandlingCostMinor =
        nonReturnRefund
          ? 0
          : profile.returnHandlingCostMinor * quantity;
      const restockingCostMinor =
        nonReturnRefund
          ? 0
          : profile.restockingCostMinor * quantity;

      const lineEconomics: ReturnLineEconomics = {
        productId: line.productId,
        quantity,
        refundedRevenueMinor,
        recoveredCogsMinor,
        returnShippingCostMinor,
        returnHandlingCostMinor,
        restockingCostMinor,
        nonRecoverableInventoryCostMinor,
      };

      const incrementalReturnCostsMinor =
        returnShippingCostMinor +
        returnHandlingCostMinor +
        restockingCostMinor;

      returns.push({
        returnId: `return:${purchase.orderId}:${lineIndex}`,
        orderId: purchase.orderId,
        customerId: purchase.customerId,
        disposition,
        occurredAt: new Date(occurredMs).toISOString(),
        lines: [lineEconomics],
        refundedRevenueMinor,
        recoveredCogsMinor,
        incrementalReturnCostsMinor,
        contributionProfitImpactMinor:
          -refundedRevenueMinor +
          recoveredCogsMinor -
          incrementalReturnCostsMinor,
      });
    }
  }

  return returns.sort(
    (left, right) =>
      Date.parse(left.occurredAt) -
        Date.parse(right.occurredAt) ||
      left.returnId.localeCompare(right.returnId),
  );
}
