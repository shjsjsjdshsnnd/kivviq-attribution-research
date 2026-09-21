import type { LatentCustomer } from "../customer_population/types.js";
import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { PriceElasticityMechanism } from "../ground_truth/ontology.js";
import type {
  AuthoritativePriceState,
  PriceResponseTruth,
  PricingPromotionScenario,
} from "./runtime-types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unitHash(value: string): number {
  return fnv1a32(value) / 0xffffffff;
}

function linearInterpolate(
  points: readonly {
    readonly relativePriceChange: number;
    readonly relativeDemandChange: number;
  }[],
  relativePriceChange: number,
): number {
  if (points.length === 0) return 0;
  const sorted = [...points].sort(
    (left, right) =>
      left.relativePriceChange - right.relativePriceChange,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (relativePriceChange <= first.relativePriceChange) {
    return first.relativeDemandChange;
  }
  if (relativePriceChange >= last.relativePriceChange) {
    return last.relativeDemandChange;
  }

  for (let index = 1; index < sorted.length; index += 1) {
    const upper = sorted[index]!;
    const lower = sorted[index - 1]!;
    if (relativePriceChange > upper.relativePriceChange) continue;
    const width =
      upper.relativePriceChange - lower.relativePriceChange;
    if (Math.abs(width) < 1e-12) {
      return upper.relativeDemandChange;
    }
    const fraction =
      (relativePriceChange - lower.relativePriceChange) / width;
    return (
      lower.relativeDemandChange +
      fraction *
        (upper.relativeDemandChange - lower.relativeDemandChange)
    );
  }

  return last.relativeDemandChange;
}

function mechanismDemandMultiplier(
  mechanism: PriceElasticityMechanism,
  priceRatio: number,
): number {
  const safeRatio = clamp(priceRatio, 0.05, 20);
  const relativePriceChange = safeRatio - 1;

  if (mechanism.form === "constant") {
    const elasticity = mechanism.elasticity ?? 0;
    // Constant-elasticity demand: Q1/Q0 = (P1/P0)^e.
    // Unlike a fixed conversion lift, this is coherent for both price
    // increases and decreases and is intrinsically nonlinear in price.
    return clamp(Math.pow(safeRatio, elasticity), 0.02, 25);
  }

  const demandChange = linearInterpolate(
    mechanism.points ?? [],
    relativePriceChange,
  );
  return clamp(1 + demandChange, 0.02, 25);
}

function impliedElasticity(
  mechanism: PriceElasticityMechanism | undefined,
  relativePriceChange: number,
): number {
  if (!mechanism) return -1;
  if (mechanism.form === "constant") {
    return mechanism.elasticity ?? -1;
  }
  if (Math.abs(relativePriceChange) < 1e-9) {
    const points = mechanism.points ?? [];
    const negative = [...points]
      .filter((point) => point.relativePriceChange < 0)
      .sort((a, b) => b.relativePriceChange - a.relativePriceChange)[0];
    const positive = [...points]
      .filter((point) => point.relativePriceChange > 0)
      .sort((a, b) => a.relativePriceChange - b.relativePriceChange)[0];
    if (negative && positive) {
      const dx =
        positive.relativePriceChange - negative.relativePriceChange;
      return dx === 0
        ? -1
        : (positive.relativeDemandChange -
            negative.relativeDemandChange) /
            dx;
    }
    return -1;
  }
  const demandChange = linearInterpolate(
    mechanism.points ?? [],
    relativePriceChange,
  );
  return demandChange / relativePriceChange;
}

export function customerPriceElasticityMultiplier(
  customer: LatentCustomer,
): number {
  const urgencyResistance =
    1 - 0.34 * clamp(customer.latentFactors.purchaseUrgency, 0, 1);
  const needResistance =
    1 - 0.2 * clamp(customer.currentPurchaseNeed, 0, 1);
  const brandResistance =
    1 - 0.28 * clamp(customer.brandAffinity, 0, 1);
  const dealAmplifier =
    0.78 + 0.48 * clamp(customer.latentFactors.dealOrientation, 0, 1);

  return clamp(
    customer.priceSensitivityMultiplier *
      urgencyResistance *
      needResistance *
      brandResistance *
      dealAmplifier,
    0.12,
    3.5,
  );
}

export function customerReservationPriceMultiplier(
  customer: LatentCustomer,
  productId: string,
  priceRatio: number,
): number {
  // A stable customer/product reservation-price frontier adds threshold-like
  // behavior without exposing any future outcome to the Operator.
  const threshold =
    0.82 +
    unitHash(
      `step10-reservation|${customer.customerId}|${productId}`,
    ) *
      0.56 +
    customer.brandAffinity * 0.12 +
    customer.currentPurchaseNeed * 0.08 -
    customer.latentFactors.dealOrientation * 0.08;

  const slope =
    7 +
    customer.priceSensitivityMultiplier * 2.5;
  const logistic = 1 / (1 + Math.exp(slope * (priceRatio - threshold)));
  const baselineLogistic =
    1 / (1 + Math.exp(slope * (1 - threshold)));

  return clamp(
    logistic / Math.max(0.02, baselineLogistic),
    0.12,
    4.5,
  );
}

function activePriceState(
  scenario: PricingPromotionScenario,
  productId: string,
  timestampMs: number,
): AuthoritativePriceState | undefined {
  return scenario.priceStates.find((state) => {
    if (state.productId !== productId) return false;
    if (
      state.effectiveStart !== undefined &&
      timestampMs < Date.parse(state.effectiveStart)
    ) {
      return false;
    }
    if (
      state.effectiveEnd !== undefined &&
      timestampMs >= Date.parse(state.effectiveEnd)
    ) {
      return false;
    }
    return true;
  });
}

export function crossPriceDemandMultiplier(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario,
  targetProductId: string,
  timestampMs: number,
): number {
  let multiplier = 1;

  for (const mechanism of world.manifest.priceElasticities) {
    if (
      mechanism.kind !== "cross_price" ||
      mechanism.targetProductId !== targetProductId
    ) {
      continue;
    }

    const sourceState = activePriceState(
      scenario,
      mechanism.sourceProductId,
      timestampMs,
    );
    if (!sourceState || sourceState.regularPriceMinor <= 0) continue;

    const sourcePriceRatio =
      sourceState.effectivePriceMinor /
      sourceState.regularPriceMinor;
    multiplier *= mechanismDemandMultiplier(
      mechanism,
      sourcePriceRatio,
    );
  }

  return clamp(multiplier, 0.05, 8);
}

export function priceResponseTruth(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario,
  customer: LatentCustomer,
  productId: string,
  baselinePriceMinor: number,
  effectivePriceMinor: number,
  timestampMs: number,
): PriceResponseTruth {
  const priceRatio =
    effectivePriceMinor / Math.max(1, baselinePriceMinor);
  const relativePriceChange = priceRatio - 1;
  const mechanism = world.manifest.priceElasticities.find(
    (candidate) =>
      candidate.kind === "own_price" &&
      candidate.sourceProductId === productId &&
      candidate.targetProductId === productId,
  );
  const merchantDemandMultiplier = mechanism
    ? mechanismDemandMultiplier(mechanism, priceRatio)
    : Math.pow(clamp(priceRatio, 0.05, 20), -1);
  const customerMultiplier =
    customerPriceElasticityMultiplier(customer);

  // Customer heterogeneity acts on log demand so a merchant-level response
  // of exactly 1 stays exactly 1 and response remains positive.
  const customerDemandMultiplier = Math.exp(
    Math.log(Math.max(0.02, merchantDemandMultiplier)) *
      customerMultiplier,
  );
  const reservationMultiplier =
    customerReservationPriceMultiplier(
      customer,
      productId,
      priceRatio,
    );
  const crossMultiplier = crossPriceDemandMultiplier(
    world,
    scenario,
    productId,
    timestampMs,
  );

  // The reservation component is deliberately partial: it creates thresholds
  // while retaining the manifest elasticity as the primary structural curve.
  const nonlinearDemandMultiplier = clamp(
    Math.pow(customerDemandMultiplier, 0.78) *
      Math.pow(reservationMultiplier, 0.22),
    0.03,
    12,
  );
  const combinedDemandMultiplier = clamp(
    nonlinearDemandMultiplier * crossMultiplier,
    0.02,
    16,
  );

  return {
    productId,
    baselinePriceMinor,
    effectivePriceMinor,
    relativePriceChange,
    merchantElasticity: impliedElasticity(
      mechanism,
      relativePriceChange,
    ),
    customerElasticityMultiplier: customerMultiplier,
    nonlinearDemandMultiplier,
    crossPriceDemandMultiplier: crossMultiplier,
    reservationPriceMultiplier: reservationMultiplier,
    combinedDemandMultiplier,
  };
}

export function promotionDepthResponseMultiplier(
  customer: LatentCustomer,
  discountRate: number,
  habituationMultiplier = 1,
): number {
  const depth = clamp(discountRate, 0, 0.9);
  if (depth <= 0) return 1;

  // Smooth saturating response with customer-specific threshold. This makes
  // 20% off materially different from 2x the 10% response.
  const threshold =
    0.035 +
    (1 - clamp(customer.latentFactors.dealOrientation, 0, 1)) * 0.13;
  const steepness =
    11 + customer.promotionSensitivityMultiplier * 4;
  const activated =
    1 / (1 + Math.exp(-steepness * (depth - threshold)));
  const atZero =
    1 / (1 + Math.exp(steepness * threshold));
  const normalizedActivation =
    (activated - atZero) / Math.max(1e-6, 1 - atZero);
  const saturation =
    1 -
    Math.exp(
      -depth *
        (4.5 + customer.promotionSensitivityMultiplier * 2.2),
    );

  return clamp(
    1 +
      normalizedActivation *
        saturation *
        customer.promotionSensitivityMultiplier *
        0.9 *
        habituationMultiplier,
    1,
    4.5,
  );
}

export function promotionPullForwardDays(
  customer: LatentCustomer,
  discountRate: number,
): number {
  const depth = clamp(discountRate, 0, 0.8);
  return clamp(
    customer.expectedPurchaseIntervalDays *
      depth *
      customer.promotionSensitivityMultiplier *
      (0.22 + customer.latentFactors.dealOrientation * 0.42) *
      (1 - customer.currentPurchaseNeed * 0.35),
    0,
    customer.expectedPurchaseIntervalDays * 0.65,
  );
}

export function stockpilingMultiplier(
  customer: LatentCustomer,
  discountRate: number,
  eligible: boolean,
): number {
  if (!eligible || discountRate <= 0) return 1;
  const replenishmentOrientation =
    customer.derivedSegments.includes("replenishment_oriented") ? 1 : 0.2;
  return clamp(
    1 +
      discountRate *
        customer.promotionSensitivityMultiplier *
        (0.8 + replenishmentOrientation * 1.4),
    1,
    2.8,
  );
}
