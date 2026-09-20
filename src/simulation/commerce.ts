import type { GeneratedMerchantWorld } from "../generation/config.js";
import type { SharedRandomness } from "./kernel.js";
import type { SimulationInterventionState } from "./interventions.js";
import type {
  PersistentCart,
  RuntimeCustomerState,
  RuntimeWorldState,
} from "./state.js";
import {
  refreshLatentCustomerState,
  totalMemoryLift,
  transitionAfterPurchase,
} from "./state.js";
import type {
  PurchaseLine,
  RealizedPurchase,
} from "./types.js";

export interface ProductOffer {
  readonly productId: string;
  readonly unitPriceMinor: number;
  readonly discountMinor: number;
  readonly finalPriceMinor: number;
  readonly availableUnits: number;
  readonly priceUtilityMultiplier: number;
  readonly promotionUtilityMultiplier: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function productRank(
  world: GeneratedMerchantWorld,
  productId: string,
): number {
  const ranked = [...world.manifest.productDemandMechanisms].sort(
    (left, right) =>
      Number(right.baseLatentDemandUnits) -
      Number(left.baseLatentDemandUnits),
  );
  const index = ranked.findIndex((item) => item.productId === productId);
  return index < 0 ? ranked.length : index;
}

export function baselineProductPriceMinor(
  world: GeneratedMerchantWorld,
  productId: string,
): number {
  // Step 2 intentionally kept exact generated product prices outside the
  // frozen GroundTruth v1 schema. Step 4 therefore derives a deterministic
  // simulation price from frozen merchant AOV/catalog diagnostics and product
  // rank rather than inventing hidden metadata.
  const rank = productRank(world, productId);
  const count = Math.max(1, world.summary.skuCount);
  const percentile = rank / Math.max(1, count - 1);
  const median = Math.max(100, world.summary.catalogMedianPriceMinor);
  const spread =
    world.summary.catalogMaxPriceMinor -
    world.summary.catalogMinPriceMinor;

  const rankAdjustment =
    0.72 + (1 - percentile) * Math.min(1.1, spread / Math.max(1, median)) * 0.3;

  return Math.max(
    100,
    Math.round(
      median *
        rankAdjustment *
        (world.summary.expectedAovMinor /
          Math.max(
            100,
            world.summary.catalogMedianPriceMinor *
              world.summary.expectedUnitsPerOrder,
          )),
    ),
  );
}

function promotionProbability(
  world: GeneratedMerchantWorld,
): number {
  switch (world.summary.promotionProfile) {
    case "full_price_dominant":
      return 0.04;
    case "light_promotion":
      return 0.1;
    case "promotion_sensitive":
      return 0.18;
    case "promotion_heavy":
      return 0.32;
    case "clearance_heavy":
      return 0.42;
  }
}

export function promotionState(
  world: GeneratedMerchantWorld,
  intervention: SimulationInterventionState,
  timestampMs: number,
  randomness: SharedRandomness,
): { readonly active: boolean; readonly discountRate: number } {
  if (intervention.promotionActive !== undefined) {
    return {
      active: intervention.promotionActive,
      discountRate: intervention.promotionActive
        ? clamp(world.summary.expectedDiscountRate * 1.7, 0.03, 0.45)
        : 0,
    };
  }

  const day = Math.floor(timestampMs / 86_400_000);
  const active = randomness.bool(
    `promotion-day:${day}`,
    promotionProbability(world),
  );

  return {
    active,
    discountRate: active
      ? clamp(world.summary.expectedDiscountRate * 1.7, 0.03, 0.45)
      : 0,
  };
}

function productElasticity(
  world: GeneratedMerchantWorld,
  productId: string,
): number {
  const mechanism = world.manifest.priceElasticities.find(
    (item) =>
      item.kind === "own_price" &&
      item.sourceProductId === productId &&
      item.targetProductId === productId,
  );

  if (!mechanism) return -1;
  if (mechanism.form === "constant") {
    return mechanism.elasticity ?? -1;
  }
  const first = mechanism.points?.[0];
  if (!first || first.relativePriceChange === 0) return -1;
  return first.relativeDemandChange / first.relativePriceChange;
}

export function offerForProduct(
  runtime: RuntimeWorldState,
  customer: RuntimeCustomerState,
  productId: string,
  timestampMs: number,
  intervention: SimulationInterventionState,
  randomness: SharedRandomness,
): ProductOffer {
  const world = runtime.merchantWorld;
  const baselinePrice = baselineProductPriceMinor(world, productId);
  const unitPriceMinor =
    intervention.priceOverrideMinor ?? baselinePrice;

  const promotion = promotionState(
    world,
    intervention,
    timestampMs,
    randomness,
  );
  const discountMinor = promotion.active
    ? Math.round(unitPriceMinor * promotion.discountRate)
    : 0;
  const finalPriceMinor = Math.max(1, unitPriceMinor - discountMinor);

  const relativePriceChange =
    (finalPriceMinor - baselinePrice) / baselinePrice;
  const elasticity = productElasticity(world, productId);
  const customerElasticity =
    elasticity * customer.source.priceSensitivityMultiplier;
  const expectedDemandChange =
    customerElasticity * relativePriceChange;

  const priceUtilityMultiplier = clamp(
    1 + expectedDemandChange,
    0.05,
    3,
  );
  const promotionUtilityMultiplier = promotion.active
    ? clamp(
        1 +
          promotion.discountRate *
            customer.source.promotionSensitivityMultiplier *
            2.5,
        0.2,
        3,
      )
    : clamp(
        1 -
          customer.source.naturalSelection.promotionWaitingProbability *
            0.28,
        0.55,
        1,
      );

  return {
    productId,
    unitPriceMinor,
    discountMinor,
    finalPriceMinor,
    availableUnits: Math.max(
      0,
      runtime.inventory.get(productId) ?? 0,
    ),
    priceUtilityMultiplier,
    promotionUtilityMultiplier,
  };
}

function fallbackProducts(
  world: GeneratedMerchantWorld,
): readonly string[] {
  return [...world.manifest.productDemandMechanisms]
    .sort(
      (left, right) =>
        Number(right.baseLatentDemandUnits) -
        Number(left.baseLatentDemandUnits),
    )
    .slice(0, 12)
    .map((item) => item.productId);
}

export function chooseProduct(
  runtime: RuntimeWorldState,
  customer: RuntimeCustomerState,
  timestampMs: number,
  intervention: SimulationInterventionState,
  randomness: SharedRandomness,
  key: string,
): ProductOffer | undefined {
  const preferred = customer.source.productPreferences.map(
    (preference) => preference.productId,
  );
  const candidates = [...new Set([...preferred, ...fallbackProducts(runtime.merchantWorld)])];

  const weighted = candidates
    .map((productId, index) => {
      const preference =
        customer.source.productPreferences.find(
          (item) => item.productId === productId,
        )?.affinity ?? 0.18 / (index + 1);
      const demand =
        runtime.merchantWorld.manifest.productDemandMechanisms.find(
          (item) => item.productId === productId,
        );
      const offer = offerForProduct(
        runtime,
        customer,
        productId,
        timestampMs,
        intervention,
        randomness,
      );

      const inventoryMultiplier =
        offer.availableUnits > 0 ? 1 : 0.04;
      const memory = totalMemoryLift(customer);
      const weight =
        Math.max(1e-9, preference) *
        Math.max(1e-9, Number(demand?.baseLatentDemandUnits ?? 1)) **
          0.25 *
        offer.priceUtilityMultiplier *
        offer.promotionUtilityMultiplier *
        inventoryMultiplier *
        (1 + memory.productPreference);

      return { value: offer, weight };
    })
    .filter((entry) => entry.weight > 0);

  if (weighted.length === 0) return undefined;
  return randomness.weightedPick(key, weighted);
}

export function addToPersistentCart(
  customer: RuntimeCustomerState,
  offer: ProductOffer,
  timestampMs: number,
): PersistentCart {
  const cart =
    customer.cart ??
    {
      lines: [],
      updatedAtMs: timestampMs,
      expiresAtMs: timestampMs + 30 * 86_400_000,
    };

  const existing = cart.lines.find(
    (line) => line.productId === offer.productId,
  );
  if (existing) {
    existing.quantity += 1;
    existing.unitPriceMinor = offer.finalPriceMinor;
  } else {
    cart.lines.push({
      productId: offer.productId,
      quantity: 1,
      unitPriceMinor: offer.finalPriceMinor,
    });
  }
  cart.updatedAtMs = timestampMs;
  cart.expiresAtMs = timestampMs + 30 * 86_400_000;
  customer.cart = cart;
  return cart;
}

export function checkoutPurchaseProbability(
  runtime: RuntimeWorldState,
  customer: RuntimeCustomerState,
  timestampMs: number,
  device: "mobile" | "desktop" | "tablet",
  intervention: SimulationInterventionState,
  randomness: SharedRandomness,
): number {
  refreshLatentCustomerState(customer, timestampMs);
  const memory = totalMemoryLift(customer);
  const promotion = promotionState(
    runtime.merchantWorld,
    intervention,
    timestampMs,
    randomness,
  );

  const checkoutMechanism =
    runtime.merchantWorld.manifest.funnelMechanisms.find(
      (item) =>
        item.from === "checkout" && item.to === "purchase",
    );
  const base = Number(checkoutMechanism?.baseProbability ?? 0.55);

  const deviceEffect =
    runtime.merchantWorld.manifest.deviceEffects.find(
      (item) =>
        item.device === device &&
        item.outcome === "conversion_probability",
    )?.effect.value ?? 0;

  const cartValue =
    customer.cart?.lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPriceMinor,
      0,
    ) ?? 0;
  const expectedAov = Math.max(
    1,
    runtime.merchantWorld.summary.expectedAovMinor,
  );
  const valueFriction = clamp(
    (cartValue / expectedAov - 1) *
      customer.source.priceSensitivityMultiplier *
      0.12,
    -0.3,
    0.35,
  );

  const probability =
    base *
    (0.35 + customer.intent * 0.65) *
    (0.45 + customer.need * 0.55) *
    (1 + Number(deviceEffect)) *
    (1 - valueFriction) *
    (promotion.active
      ? 1 +
        0.18 *
          customer.source.promotionSensitivityMultiplier
      : 1) +
    memory.purchaseProbability;

  return clamp(probability, 0.005, 0.98);
}

function allocatedMarketingSpendMinor(
  world: GeneratedMerchantWorld,
  netRevenueMinor: number,
): number {
  return Math.max(
    0,
    Math.round(
      netRevenueMinor * world.summary.marketingSpendRate,
    ),
  );
}

export function completePurchase(
  runtime: RuntimeWorldState,
  customer: RuntimeCustomerState,
  sessionId: string,
  source: RealizedPurchase["source"],
  timestampMs: number,
  orderId: string,
  intervention: SimulationInterventionState,
  randomness: SharedRandomness,
): RealizedPurchase | undefined {
  if (!customer.cart || customer.cart.lines.length === 0) return undefined;

  const lines: PurchaseLine[] = [];

  for (const cartLine of customer.cart.lines) {
    const available = runtime.inventory.get(cartLine.productId) ?? 0;
    if (available < cartLine.quantity) continue;

    const offer = offerForProduct(
      runtime,
      customer,
      cartLine.productId,
      timestampMs,
      intervention,
      randomness,
    );

    const quantity = Math.min(cartLine.quantity, available);
    if (quantity <= 0) continue;

    const gross = offer.unitPriceMinor * quantity;
    const discount = offer.discountMinor * quantity;
    const revenue = Math.max(0, gross - discount);

    lines.push({
      productId: cartLine.productId,
      quantity,
      unitPriceMinor: offer.unitPriceMinor,
      discountMinor: discount,
      revenueMinor: revenue,
      estimatedCogsMinor: Math.round(
        revenue * runtime.merchantWorld.summary.expectedCogsRate,
      ),
      fulfillmentMinor: Math.round(
        revenue * runtime.merchantWorld.summary.fulfillmentRate,
      ),
    });
  }

  if (lines.length === 0) return undefined;

  const grossRevenueMinor = lines.reduce(
    (sum, line) => sum + line.unitPriceMinor * line.quantity,
    0,
  );
  const discountMinor = lines.reduce(
    (sum, line) => sum + line.discountMinor,
    0,
  );
  const netRevenueMinor = lines.reduce(
    (sum, line) => sum + line.revenueMinor,
    0,
  );
  const estimatedCogsMinor = lines.reduce(
    (sum, line) => sum + line.estimatedCogsMinor,
    0,
  );
  const fulfillmentMinor = lines.reduce(
    (sum, line) => sum + line.fulfillmentMinor,
    0,
  );
  const paymentFeeMinor = Math.round(
    netRevenueMinor *
      runtime.merchantWorld.summary.paymentFeeRate,
  );
  const shippingSubsidyMinor = Math.round(
    netRevenueMinor *
      runtime.merchantWorld.summary.shippingSubsidyRate,
  );
  const allocatedMarketing = allocatedMarketingSpendMinor(
    runtime.merchantWorld,
    netRevenueMinor,
  );

  const contributionProfitMinor =
    netRevenueMinor -
    estimatedCogsMinor -
    paymentFeeMinor -
    shippingSubsidyMinor -
    fulfillmentMinor -
    allocatedMarketing;

  for (const line of lines) {
    runtime.inventory.set(
      line.productId,
      Math.max(
        0,
        (runtime.inventory.get(line.productId) ?? 0) - line.quantity,
      ),
    );
  }

  const repeatPurchase = customer.purchaseCount > 0;
  customer.cart = undefined;
  transitionAfterPurchase(customer, timestampMs);

  return {
    orderId,
    customerId: customer.customerId,
    sessionId,
    occurredAt: new Date(timestampMs).toISOString(),
    source,
    lines,
    grossRevenueMinor,
    discountMinor,
    netRevenueMinor,
    paymentFeeMinor,
    shippingSubsidyMinor,
    fulfillmentMinor,
    estimatedCogsMinor,
    allocatedMarketingSpendMinor: allocatedMarketing,
    contributionProfitMinor,
    repeatPurchase,
  };
}
