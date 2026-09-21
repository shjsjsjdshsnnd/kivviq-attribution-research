import type { LatentCustomer } from "../customer_population/types.js";
import type {
  GeneratedMerchantWorld,
} from "../generation/config.js";
import {
  priceResponseTruth,
  promotionDepthResponseMultiplier,
  promotionPullForwardDays,
  stockpilingMultiplier,
} from "./response.js";
import type {
  AuthoritativePriceState,
  PricingPromotionScenario,
  PromotionDefinition,
  ResolvedCartLinePricing,
  ResolvedCartShippingTerms,
  ResolvedProductOffer,
} from "./runtime-types.js";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

type MutableCartLinePricing = {
  -readonly [Key in keyof ResolvedCartLinePricing]:
    ResolvedCartLinePricing[Key];
};

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function stableProbability(key: string): number {
  return fnv1a32(key) / 0xffffffff;
}

export interface PricingCustomerContext {
  readonly source: LatentCustomer;
  readonly purchaseCount: number;
  readonly lifecycle: string;
  readonly need: number;
  readonly brandAffinity: number;
}

export interface CartPricingInputLine {
  readonly productId: string;
  readonly quantity: number;
  readonly fallbackBasePriceMinor: number;
}

function isActive(
  start: string,
  end: string,
  timestampMs: number,
): boolean {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return (
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    timestampMs >= startMs &&
    timestampMs < endMs
  );
}

function categoryForProduct(
  world: GeneratedMerchantWorld,
  productId: string,
): string | undefined {
  return world.manifest.productDemandMechanisms.find(
    (candidate) => candidate.productId === productId,
  )?.categoryId;
}

function membershipContains(
  membership: Readonly<Record<string, readonly string[]>> | undefined,
  groupIds: readonly string[] | undefined,
  productId: string,
): boolean {
  if (!membership || !groupIds || groupIds.length === 0) return false;
  return groupIds.some((groupId) =>
    membership[groupId]?.includes(productId) === true,
  );
}

export function promotionScopeMatches(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario,
  promotion: PromotionDefinition,
  productId: string,
): boolean {
  const scope = promotion.scope;
  if (scope.kind === "sitewide") return true;
  if (scope.kind === "sku_set") {
    return scope.productIds?.includes(productId) === true;
  }
  if (scope.kind === "category") {
    const categoryId = categoryForProduct(world, productId);
    return (
      categoryId !== undefined &&
      scope.categoryIds?.includes(categoryId) === true
    );
  }
  if (scope.kind === "collection") {
    return membershipContains(
      scenario.collectionMembership,
      scope.collectionIds,
      productId,
    );
  }
  return membershipContains(
    scenario.productFamilyMembership,
    scope.productFamilyIds,
    productId,
  );
}

function targetingEligible(
  promotion: PromotionDefinition,
  customer: PricingCustomerContext,
): boolean {
  const targeting = promotion.targeting;
  if (!targeting) return true;
  if (
    targeting.minimumPriorPurchases !== undefined &&
    customer.purchaseCount < targeting.minimumPriorPurchases
  ) {
    return false;
  }

  switch (targeting.customerState ?? "all") {
    case "all":
      return true;
    case "new":
      return customer.purchaseCount === 0;
    case "repeat":
      return customer.purchaseCount > 0;
    case "member":
      return customer.lifecycle === "subscriber";
  }
}

export function promotionAwarenessProbability(
  promotion: PromotionDefinition,
  customer: PricingCustomerContext,
): number {
  const declared = clamp(
    promotion.awarenessProbability ?? 0.72,
    0,
    1,
  );
  if (declared === 0 || declared === 1) {
    return declared;
  }
  return clamp(
    declared *
      (0.72 +
        customer.source.latentFactors.marketingReceptivity * 0.34 +
        customer.source.latentFactors.dealOrientation * 0.2),
    0,
    1,
  );
}

export function customerAwareOfPromotion(
  promotion: PromotionDefinition,
  customer: PricingCustomerContext,
): boolean {
  return (
    stableProbability(
      "step10-awareness|" +
        customer.source.customerId +
        "|" +
        promotion.promotionId,
    ) <
    promotionAwarenessProbability(promotion, customer)
  );
}

function couponRedeemed(
  promotion: PromotionDefinition,
  customer: PricingCustomerContext,
): boolean {
  if (!customerAwareOfPromotion(promotion, customer)) return false;
  const declared = clamp(
    promotion.redemptionProbability ?? 0.5,
    0,
    1,
  );
  const probability =
    declared === 0 || declared === 1
      ? declared
      : clamp(
          declared *
            (0.58 +
              customer.source.latentFactors.dealOrientation *
                0.52 +
              customer.source.promotionSensitivityMultiplier *
                0.18),
          0,
          1,
        );
  return (
    stableProbability(
      "step10-redemption|" +
        customer.source.customerId +
        "|" +
        promotion.promotionId,
    ) < probability
  );
}

function activeApplicablePromotions(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario,
  customer: PricingCustomerContext,
  productId: string,
  timestampMs: number,
): readonly PromotionDefinition[] {
  return scenario.promotions.filter((promotion) => {
    if (!isActive(promotion.start, promotion.end, timestampMs)) return false;
    if (!promotionScopeMatches(world, scenario, promotion, productId)) {
      return false;
    }
    if (!targetingEligible(promotion, customer)) return false;
    if (promotion.mechanic === "coupon") {
      return couponRedeemed(promotion, customer);
    }
    return true;
  });
}

export function anyPromotionActive(
  scenario: PricingPromotionScenario | undefined,
  timestampMs: number,
): boolean {
  return (
    scenario?.promotions.some((promotion) =>
      isActive(promotion.start, promotion.end, timestampMs),
    ) === true
  );
}

export function majorEventDemandMultiplier(
  scenario: PricingPromotionScenario | undefined,
  timestampMs: number,
): number {
  if (!scenario?.majorEvents) return 1;
  return clamp(
    scenario.majorEvents.reduce(
      (multiplier, event) =>
        isActive(event.start, event.end, timestampMs)
          ? multiplier * event.baselineDemandMultiplier
          : multiplier,
      1,
    ),
    0.2,
    8,
  );
}

export function marketingCompetitionMultiplier(
  scenario: PricingPromotionScenario | undefined,
  timestampMs: number,
): number {
  if (!scenario?.majorEvents) return 1;
  return clamp(
    scenario.majorEvents.reduce(
      (multiplier, event) =>
        isActive(event.start, event.end, timestampMs)
          ? multiplier * (event.marketingCompetitionMultiplier ?? 1)
          : multiplier,
      1,
    ),
    0.2,
    5,
  );
}

export function activePriceState(
  scenario: PricingPromotionScenario,
  productId: string,
  timestampMs: number,
  fallbackBasePriceMinor: number,
): AuthoritativePriceState {
  const state = scenario.priceStates.find((candidate) => {
    if (candidate.productId !== productId) return false;
    if (
      candidate.effectiveStart !== undefined &&
      timestampMs < Date.parse(candidate.effectiveStart)
    ) {
      return false;
    }
    if (
      candidate.effectiveEnd !== undefined &&
      timestampMs >= Date.parse(candidate.effectiveEnd)
    ) {
      return false;
    }
    return true;
  });

  if (state) return state;

  const regular = Math.max(1, Math.round(fallbackBasePriceMinor));
  return {
    productId,
    regularPriceMinor: regular,
    currentSellingPriceMinor: regular,
    discountAmountMinor: 0,
    discountPercentage: 0,
    effectivePriceMinor: regular,
    currency: scenario.currency,
  };
}

function previousPromotionExposureCount(
  scenario: PricingPromotionScenario,
  customer: PricingCustomerContext,
  timestampMs: number,
): number {
  return scenario.promotions.reduce((count, promotion) => {
    const ended = Date.parse(promotion.end);
    if (!Number.isFinite(ended) || ended >= timestampMs) return count;
    if ((promotion.habituationStrength ?? 0) <= 0) return count;
    return customerAwareOfPromotion(promotion, customer)
      ? count + 1
      : count;
  }, 0);
}

function habituationMultiplier(
  scenario: PricingPromotionScenario,
  customer: PricingCustomerContext,
  timestampMs: number,
): number {
  let cumulative = 0;
  for (const promotion of scenario.promotions) {
    if ((promotion.habituationStrength ?? 0) <= 0) continue;
    if (Date.parse(promotion.end) >= timestampMs) continue;
    if (!customerAwareOfPromotion(promotion, customer)) continue;
    cumulative += promotion.habituationStrength ?? 0;
  }
  return clamp(1 + cumulative * 0.08, 1, 1.75);
}

function automaticUnitDiscount(
  promotion: PromotionDefinition,
  unitPriceMinor: number,
): number {
  if (
    promotion.mechanic === "percentage_discount" ||
    promotion.mechanic === "loyalty_percentage" ||
    promotion.mechanic === "clearance" ||
    promotion.mechanic === "member_price"
  ) {
    return Math.round(
      unitPriceMinor * clamp(promotion.percentageOff ?? 0, 0, 0.95),
    );
  }

  if (
    (promotion.mechanic === "fixed_discount" ||
      promotion.mechanic === "loyalty_fixed_credit" ||
      promotion.mechanic === "coupon") &&
    promotion.fixedDiscountAllocation === "per_eligible_unit"
  ) {
    return Math.min(
      unitPriceMinor - 1,
      Math.max(0, Math.round(promotion.fixedAmountMinor ?? 0)),
    );
  }

  if (
    promotion.mechanic === "coupon" &&
    promotion.percentageOff !== undefined
  ) {
    return Math.round(
      unitPriceMinor * clamp(promotion.percentageOff, 0, 0.95),
    );
  }

  return 0;
}

function discountRate(
  unitPriceMinor: number,
  discountMinor: number,
): number {
  return unitPriceMinor > 0
    ? clamp(discountMinor / unitPriceMinor, 0, 0.99)
    : 0;
}

export function resolveProductOffer(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario,
  customer: PricingCustomerContext,
  productId: string,
  timestampMs: number,
  fallbackBasePriceMinor: number,
): ResolvedProductOffer {
  const priceState = activePriceState(
    scenario,
    productId,
    timestampMs,
    fallbackBasePriceMinor,
  );
  const listPriceMinor = Math.max(
    1,
    Math.round(priceState.currentSellingPriceMinor),
  );
  const applicable = activeApplicablePromotions(
    world,
    scenario,
    customer,
    productId,
    timestampMs,
  );

  const automaticCandidates = applicable
    .filter(
      (promotion) =>
        (promotion.minimumSpendMinor ?? 0) <= 0,
    )
    .map((promotion) => ({
      promotion,
      discountMinor: automaticUnitDiscount(
        promotion,
        listPriceMinor,
      ),
    }))
    .filter((entry) => entry.discountMinor > 0);

  const exclusive = automaticCandidates
    .filter((entry) => entry.promotion.stacking !== "stackable")
    .sort(
      (left, right) =>
        right.discountMinor - left.discountMinor ||
        left.promotion.promotionId.localeCompare(
          right.promotion.promotionId,
        ),
    )[0];
  const stackable = automaticCandidates.filter(
    (entry) => entry.promotion.stacking === "stackable",
  );
  const applied = [
    ...(exclusive ? [exclusive] : []),
    ...stackable,
  ];

  const promotionDiscount = Math.min(
    listPriceMinor - 1,
    applied.reduce(
      (sum, entry) => sum + entry.discountMinor,
      0,
    ),
  );
  const prePromotionPrice = Math.max(
    1,
    Math.round(priceState.effectivePriceMinor),
  );
  const effectivePriceMinor = Math.max(
    1,
    Math.min(
      prePromotionPrice,
      listPriceMinor - promotionDiscount,
    ),
  );
  const totalDiscountMinor =
    Math.max(0, listPriceMinor - effectivePriceMinor);
  const depth = discountRate(
    priceState.regularPriceMinor,
    Math.max(
      0,
      priceState.regularPriceMinor - effectivePriceMinor,
    ),
  );
  const memory = habituationMultiplier(
    scenario,
    customer,
    timestampMs,
  );
  const priorExposures = previousPromotionExposureCount(
    scenario,
    customer,
    timestampMs,
  );
  const awareApplicable = applicable.filter((promotion) =>
    customerAwareOfPromotion(promotion, customer),
  );
  const promotionUtility =
    awareApplicable.length > 0
      ? promotionDepthResponseMultiplier(
          customer.source,
          depth,
          memory,
        )
      : priorExposures > 0
        ? clamp(
            1 -
              Math.min(
                0.42,
                (memory - 1) *
                  customer.source.naturalSelection
                    .promotionWaitingProbability,
              ),
            0.5,
            1,
          )
        : 1;

  const channelResponseMultiplier = awareApplicable.reduce(
    (value, promotion) => {
      const multipliers =
        promotion.channelResponseMultiplierByChannel;
      if (!multipliers) return value;
      const values = Object.values(multipliers).filter(
        (candidate): candidate is number =>
          typeof candidate === "number" && Number.isFinite(candidate),
      );
      if (values.length === 0) return value;
      return value * Math.max(...values);
    },
    1,
  );
  const returnProbabilityMultiplier = applied.reduce(
    (value, entry) =>
      value *
      (entry.promotion.returnProbabilityMultiplier ?? 1),
    1,
  );
  const stockpile = applied.reduce(
    (value, entry) =>
      Math.max(
        value,
        stockpilingMultiplier(
          customer.source,
          depth,
          entry.promotion.stockpilingEligible === true,
        ),
      ),
    1,
  );

  return {
    priceState,
    basePriceMinor: priceState.regularPriceMinor,
    listPriceMinor,
    effectivePriceMinor,
    discountMinor: totalDiscountMinor,
    priceResponse: priceResponseTruth(
      world,
      scenario,
      customer.source,
      productId,
      priceState.regularPriceMinor,
      effectivePriceMinor,
      timestampMs,
    ),
    promotion: {
      promotionIds: awareApplicable.map(
        (promotion) => promotion.promotionId,
      ),
      priceDiscountMinorPerUnit: totalDiscountMinor,
      freeShipping: awareApplicable.some(
        (promotion) => promotion.mechanic === "free_shipping",
      ),
      ...(awareApplicable
        .filter(
          (promotion) =>
            promotion.mechanic === "free_shipping_threshold" &&
            promotion.freeShippingThresholdMinor !== undefined,
        )
        .sort(
          (left, right) =>
            (left.freeShippingThresholdMinor ?? Number.MAX_SAFE_INTEGER) -
            (right.freeShippingThresholdMinor ?? Number.MAX_SAFE_INTEGER),
        )[0]?.freeShippingThresholdMinor === undefined
        ? {}
        : {
            freeShippingThresholdMinor: awareApplicable
              .filter(
                (promotion) =>
                  promotion.mechanic === "free_shipping_threshold" &&
                  promotion.freeShippingThresholdMinor !== undefined,
              )
              .reduce(
                (minimum, promotion) =>
                  Math.min(
                    minimum,
                    promotion.freeShippingThresholdMinor ??
                      Number.MAX_SAFE_INTEGER,
                  ),
                Number.MAX_SAFE_INTEGER,
              ),
          }),
      promotionUtilityMultiplier: promotionUtility,
      channelResponseMultiplier: clamp(
        channelResponseMultiplier,
        0.2,
        5,
      ),
      returnProbabilityMultiplier: clamp(
        returnProbabilityMultiplier,
        0.2,
        5,
      ),
      stockpilingMultiplier: stockpile,
      habituationMultiplier: memory,
    },
  };
}

function allocateFixedDiscount(
  lines: MutableCartLinePricing[],
  eligibleProductIds: ReadonlySet<string>,
  amountMinor: number,
): void {
  const eligible = lines.filter(
    (line) =>
      eligibleProductIds.has(line.productId) &&
      line.effectiveUnitPriceMinor * line.quantity > 0,
  );
  const total = eligible.reduce(
    (sum, line) =>
      sum + line.effectiveUnitPriceMinor * line.quantity,
    0,
  );
  if (total <= 0 || amountMinor <= 0) return;
  let remaining = Math.min(amountMinor, Math.max(0, total - 1));

  for (let index = 0; index < eligible.length; index += 1) {
    const line = eligible[index]!;
    const gross = line.effectiveUnitPriceMinor * line.quantity;
    const allocation =
      index === eligible.length - 1
        ? remaining
        : Math.min(
            remaining,
            Math.round((Math.min(amountMinor, total - 1) * gross) / total),
          );
    if (allocation <= 0) continue;
    const unitAllocation = Math.min(
      line.effectiveUnitPriceMinor - 1,
      Math.floor(allocation / Math.max(1, line.quantity)),
    );
    const realized = unitAllocation * line.quantity;
    line.effectiveUnitPriceMinor -= unitAllocation;
    line.discountMinor += realized;
    remaining -= realized;
    if (remaining <= 0) break;
  }
}

export function resolveCartLinePricing(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario,
  customer: PricingCustomerContext,
  timestampMs: number,
  inputLines: readonly CartPricingInputLine[],
): readonly ResolvedCartLinePricing[] {
  const lines: MutableCartLinePricing[] = inputLines.map((line) => {
    const offer = resolveProductOffer(
      world,
      scenario,
      customer,
      line.productId,
      timestampMs,
      line.fallbackBasePriceMinor,
    );
    return {
      productId: line.productId,
      quantity: Math.max(0, Math.floor(line.quantity)),
      listPriceMinor: offer.listPriceMinor,
      effectiveUnitPriceMinor: offer.effectivePriceMinor,
      discountMinor: offer.discountMinor * Math.max(0, Math.floor(line.quantity)),
      promotionIds: [...offer.promotion.promotionIds],
      returnProbabilityMultiplier:
        offer.promotion.returnProbabilityMultiplier,
    };
  });

  const cartValueBeforeOrderCredits = lines.reduce(
    (sum, line) =>
      sum + line.effectiveUnitPriceMinor * line.quantity,
    0,
  );

  const active = scenario.promotions.filter(
    (promotion) =>
      isActive(promotion.start, promotion.end, timestampMs) &&
      targetingEligible(promotion, customer) &&
      (promotion.mechanic !== "coupon" ||
        couponRedeemed(promotion, customer)) &&
      cartValueBeforeOrderCredits >=
        (promotion.minimumSpendMinor ?? 0),
  );

  for (const promotion of active) {
    const minimumSpendQualified =
      (promotion.minimumSpendMinor ?? 0) > 0;
    const orderPercentage =
      minimumSpendQualified &&
      promotion.percentageOff !== undefined &&
      (promotion.mechanic === "coupon" ||
        promotion.mechanic === "percentage_discount" ||
        promotion.mechanic === "loyalty_percentage" ||
        promotion.mechanic === "clearance");

    if (orderPercentage) {
      const depth = clamp(
        promotion.percentageOff ?? 0,
        0,
        0.95,
      );
      for (const line of lines) {
        if (
          !promotionScopeMatches(
            world,
            scenario,
            promotion,
            line.productId,
          )
        ) {
          continue;
        }
        const perUnit = Math.min(
          line.effectiveUnitPriceMinor - 1,
          Math.round(
            line.effectiveUnitPriceMinor * depth,
          ),
        );
        line.effectiveUnitPriceMinor -= perUnit;
        line.discountMinor += perUnit * line.quantity;
        line.returnProbabilityMultiplier *=
          promotion.returnProbabilityMultiplier ?? 1;
        if (!line.promotionIds.includes(promotion.promotionId)) {
          line.promotionIds = [
            ...line.promotionIds,
            promotion.promotionId,
          ];
        }
      }
      continue;
    }

    if (promotion.mechanic === "bundle" && promotion.bundle) {
      const present = new Set(
        lines
          .filter((line) => line.quantity > 0)
          .map((line) => line.productId),
      );
      if (
        !promotion.bundle.requiredProductIds.every((productId) =>
          present.has(productId),
        )
      ) {
        continue;
      }
      const discountedIds = new Set(
        promotion.bundle.discountedProductIds ??
          promotion.bundle.requiredProductIds,
      );
      if (promotion.bundle.percentageOff !== undefined) {
        const depth = clamp(promotion.bundle.percentageOff, 0, 0.95);
        for (const line of lines) {
          if (!discountedIds.has(line.productId)) continue;
          const perUnit = Math.min(
            line.effectiveUnitPriceMinor - 1,
            Math.round(line.effectiveUnitPriceMinor * depth),
          );
          line.effectiveUnitPriceMinor -= perUnit;
          line.discountMinor += perUnit * line.quantity;
          if (!line.promotionIds.includes(promotion.promotionId)) {
            line.promotionIds = [
              ...line.promotionIds,
              promotion.promotionId,
            ];
          }
        }
      }
      if (promotion.bundle.fixedAmountMinor !== undefined) {
        allocateFixedDiscount(
          lines,
          discountedIds,
          promotion.bundle.fixedAmountMinor,
        );
        for (const line of lines) {
          if (
            discountedIds.has(line.productId) &&
            !line.promotionIds.includes(promotion.promotionId)
          ) {
            line.promotionIds = [
              ...line.promotionIds,
              promotion.promotionId,
            ];
          }
        }
      }
      continue;
    }

    const orderFixed =
      promotion.fixedAmountMinor !== undefined &&
      promotion.fixedAmountMinor > 0 &&
      promotion.fixedDiscountAllocation !== "per_eligible_unit" &&
      (promotion.mechanic === "fixed_discount" ||
        promotion.mechanic === "coupon" ||
        promotion.mechanic === "loyalty_fixed_credit");
    if (!orderFixed) continue;

    const eligibleIds = new Set(
      lines
        .filter((line) =>
          promotionScopeMatches(
            world,
            scenario,
            promotion,
            line.productId,
          ),
        )
        .map((line) => line.productId),
    );
    allocateFixedDiscount(
      lines,
      eligibleIds,
      promotion.fixedAmountMinor ?? 0,
    );
    for (const line of lines) {
      if (
        eligibleIds.has(line.productId) &&
        !line.promotionIds.includes(promotion.promotionId)
      ) {
        line.promotionIds = [
          ...line.promotionIds,
          promotion.promotionId,
        ];
      }
    }
  }

  return lines;
}

export function effectiveFreeShippingThreshold(
  scenario: PricingPromotionScenario | undefined,
  customer: PricingCustomerContext,
  timestampMs: number,
  baselineThresholdMinor: number | null | undefined,
): number | null | undefined {
  if (!scenario) return baselineThresholdMinor;
  const thresholds = scenario.promotions
    .filter(
      (promotion) =>
        promotion.mechanic === "free_shipping_threshold" &&
        promotion.freeShippingThresholdMinor !== undefined &&
        isActive(promotion.start, promotion.end, timestampMs) &&
        targetingEligible(promotion, customer) &&
        customerAwareOfPromotion(promotion, customer),
    )
    .sort(
      (left, right) =>
        Date.parse(right.start) - Date.parse(left.start) ||
        left.promotionId.localeCompare(right.promotionId),
    );
  if (thresholds.length === 0) return baselineThresholdMinor;
  // A threshold intervention replaces the prior threshold. This explicitly
  // supports both $100 -> $125 and $150 -> $100 counterfactuals.
  return thresholds[0]!.freeShippingThresholdMinor!;
}

export function resolveCartShippingTerms(
  scenario: PricingPromotionScenario | undefined,
  customer: PricingCustomerContext,
  timestampMs: number,
  cartMerchandiseMinor: number,
  baselineThresholdMinor: number | null | undefined,
): ResolvedCartShippingTerms {
  if (!scenario) {
    return {
      freeShipping:
        baselineThresholdMinor !== undefined &&
        baselineThresholdMinor !== null &&
        cartMerchandiseMinor >= baselineThresholdMinor,
      qualifyingPromotionIds: [],
    };
  }

  const qualifying = scenario.promotions.filter(
    (promotion) => {
      if (!isActive(promotion.start, promotion.end, timestampMs)) return false;
      if (!targetingEligible(promotion, customer)) return false;
      if (!customerAwareOfPromotion(promotion, customer)) return false;
      if (promotion.mechanic === "coupon" && !couponRedeemed(promotion, customer)) {
        return false;
      }
      if (cartMerchandiseMinor < (promotion.minimumSpendMinor ?? 0)) return false;
      return (
        promotion.mechanic === "free_shipping" ||
        promotion.mechanic === "free_shipping_threshold"
      );
    },
  );

  const unconditional = qualifying.some(
    (promotion) => promotion.mechanic === "free_shipping",
  );
  const threshold = effectiveFreeShippingThreshold(
    scenario,
    customer,
    timestampMs,
    baselineThresholdMinor,
  );
  const qualifiesByThreshold =
    threshold !== undefined &&
    threshold !== null &&
    cartMerchandiseMinor >= threshold;
  const freeShipping = unconditional || qualifiesByThreshold;

  return {
    ...(freeShipping
      ? { customerShippingChargeOverrideMinor: 0 }
      : {}),
    freeShipping,
    qualifyingPromotionIds: qualifying.map(
      (promotion) => promotion.promotionId,
    ),
  };
}

export interface BundleAttachmentOpportunity {
  readonly promotionId: string;
  readonly productId: string;
  readonly probability: number;
}

export function bundleAttachmentOpportunity(
  scenario: PricingPromotionScenario | undefined,
  customer: PricingCustomerContext,
  timestampMs: number,
  cartProductIds: readonly string[],
): BundleAttachmentOpportunity | undefined {
  if (!scenario) return undefined;
  const present = new Set(cartProductIds);
  const candidates: BundleAttachmentOpportunity[] = [];

  for (const promotion of scenario.promotions) {
    if (
      promotion.mechanic !== "bundle" ||
      promotion.bundle === undefined ||
      !isActive(promotion.start, promotion.end, timestampMs) ||
      !targetingEligible(promotion, customer) ||
      !customerAwareOfPromotion(promotion, customer)
    ) {
      continue;
    }

    const required = promotion.bundle.requiredProductIds;
    const presentRequired = required.filter((productId) =>
      present.has(productId),
    );
    const missing = required.filter(
      (productId) => !present.has(productId),
    );
    if (
      presentRequired.length === 0 ||
      missing.length !== 1
    ) {
      continue;
    }

    const depth =
      promotion.bundle.percentageOff ??
      (promotion.bundle.fixedAmountMinor !== undefined
        ? 0.1
        : 0);
    const probability = clamp(
      0.04 +
        customer.source.promotionSensitivityMultiplier *
          Math.max(0.02, depth) *
          1.45 +
        customer.source.latentFactors.dealOrientation * 0.08 +
        customer.source.complementAffinity * 0.06,
      0.03,
      0.78,
    );

    candidates.push({
      promotionId: promotion.promotionId,
      productId: missing[0]!,
      probability,
    });
  }

  return candidates.sort(
    (left, right) =>
      right.probability - left.probability ||
      left.promotionId.localeCompare(right.promotionId) ||
      left.productId.localeCompare(right.productId),
  )[0];
}

export function promotionChannelResponseMultiplier(
  scenario: PricingPromotionScenario | undefined,
  customer: PricingCustomerContext,
  timestampMs: number,
  channel: string | undefined,
): number {
  if (!scenario || channel === undefined) return 1;
  let multiplier = 1;
  for (const promotion of scenario.promotions) {
    if (!isActive(promotion.start, promotion.end, timestampMs)) continue;
    if (!targetingEligible(promotion, customer)) continue;
    if (!customerAwareOfPromotion(promotion, customer)) continue;
    const channelMap =
      promotion.channelResponseMultiplierByChannel as
        | Readonly<Record<string, number | undefined>>
        | undefined;
    multiplier *= channelMap?.[channel] ?? 1;
  }
  return clamp(multiplier, 0.2, 5);
}

export function promotionReturnMultiplierForProduct(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario | undefined,
  customer: PricingCustomerContext,
  productId: string,
  timestampMs: number,
): number {
  if (!scenario) return 1;
  return clamp(
    activeApplicablePromotions(
      world,
      scenario,
      customer,
      productId,
      timestampMs,
    ).reduce(
      (value, promotion) =>
        value * (promotion.returnProbabilityMultiplier ?? 1),
      1,
    ),
    0.2,
    5,
  );
}

export function promotionTimingDeferralMultiplier(
  world: GeneratedMerchantWorld,
  scenario: PricingPromotionScenario | undefined,
  customer: PricingCustomerContext,
  timestampMs: number,
  purchasedProductIds: readonly string[],
): number {
  if (!scenario) return 1;
  let deferralDays = 0;
  for (const productId of purchasedProductIds) {
    const offer = resolveProductOffer(
      world,
      scenario,
      customer,
      productId,
      timestampMs,
      activePriceState(scenario, productId, timestampMs, 1)
        .regularPriceMinor,
    );
    const depth =
      offer.basePriceMinor > 0
        ? (offer.basePriceMinor - offer.effectivePriceMinor) /
          offer.basePriceMinor
        : 0;
    deferralDays = Math.max(
      deferralDays,
      promotionPullForwardDays(customer.source, depth),
    );
    if (offer.promotion.stockpilingMultiplier > 1) {
      deferralDays = Math.max(
        deferralDays,
        customer.source.expectedPurchaseIntervalDays *
          (offer.promotion.stockpilingMultiplier - 1) *
          0.65,
      );
    }
  }
  const baselineNeedResetDays =
    Math.max(
      1,
      customer.source.expectedPurchaseIntervalDays * 0.35,
    );
  // transitionAfterPurchase schedules the frozen baseline at
  // 0.35 * expected interval. Divide by that same baseline so an explicit
  // X-day pull-forward/stockpile deferral adds approximately X real days,
  // rather than only 35% of X.
  return clamp(
    1 + deferralDays / baselineNeedResetDays,
    1,
    4.5,
  );
}
