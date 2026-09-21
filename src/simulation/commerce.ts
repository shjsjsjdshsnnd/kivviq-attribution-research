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
import {
  availableToSellUnits as step9AvailableToSellUnits,
  commitAndSellReservations,
  createBackorder,
  legacyNetAvailableUnits,
  markInventoryDemandOutcome,
  recordInventoryDemand,
  reserveInventory,
  reservationQuantity,
  sellAvailableInventory,
} from "../inventory_dynamics/state.js";
import type {
  PurchaseLine,
  RealizedPurchase,
  SimulationCommercePolicy,
} from "./types.js";

export interface ProductOffer {
  readonly productId: string;
  readonly unitPriceMinor: number;
  readonly discountMinor: number;
  readonly finalPriceMinor: number;
  readonly availableUnits: number;
  readonly priceUtilityMultiplier: number;
  readonly promotionUtilityMultiplier: number;
  readonly demandTruthId?: string;
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
  commercePolicy?: SimulationCommercePolicy,
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
    availableUnits:
      commercePolicy?.enableInventoryDynamics === true
        ? step9AvailableToSellUnits(
            runtime.inventoryEconomy,
            productId,
          )
        : Math.max(
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
  commercePolicy?: SimulationCommercePolicy,
): ProductOffer | undefined {
  const preferred = customer.source.productPreferences.map(
    (preference) => preference.productId,
  );
  const candidates = [
    ...new Set([
      ...preferred,
      ...fallbackProducts(runtime.merchantWorld),
    ]),
  ];

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
        commercePolicy,
      );

      const inventoryMechanism =
        runtime.merchantWorld.manifest.inventoryMechanisms.find(
          (item) => item.productId === productId,
        );
      const inventoryMultiplier =
        offer.availableUnits > 0
          ? 1
          : commercePolicy?.executeInventoryLifecycle === true &&
              inventoryMechanism?.allowBackorders
            ? 0.35
            : 0.04;
      const cartProductIds = new Set(
        customer.cart?.lines.map((line) => line.productId) ?? [],
      );
      const complementMultiplier =
        commercePolicy?.enableProductRelationships === true &&
        [...cartProductIds].some(
          (cartProductId) =>
            runtime.merchantWorld.manifest.productDemandMechanisms
              .find((item) => item.productId === cartProductId)
              ?.complementaryProductIds?.includes(productId) ?? false,
        )
          ? 2.4
          : 1;
      const memory = totalMemoryLift(customer);
      const latentWeight =
        Math.max(1e-9, preference) *
        Math.max(
          1e-9,
          Number(demand?.baseLatentDemandUnits ?? 1),
        ) **
          0.25 *
        offer.priceUtilityMultiplier *
        offer.promotionUtilityMultiplier *
        complementMultiplier *
        (1 + memory.productPreference);

      return {
        value: offer,
        weight: latentWeight * inventoryMultiplier,
        latentWeight,
      };
    })
    .filter((entry) => entry.weight > 0);

  if (weighted.length === 0) return undefined;

  if (commercePolicy?.enableInventoryDynamics !== true) {
    const selected = randomness.weightedPick(key, weighted);
    if (
      selected.availableUnits > 0 ||
      commercePolicy?.enableProductRelationships !== true
    ) {
      return selected;
    }

    const inventoryMechanism =
      runtime.merchantWorld.manifest.inventoryMechanisms.find(
        (item) => item.productId === selected.productId,
      );
    const substitutes = [
      ...(inventoryMechanism?.substituteProductIds ?? []),
      ...(runtime.merchantWorld.manifest.productDemandMechanisms.find(
        (item) => item.productId === selected.productId,
      )?.substitutionProductIds ?? []),
    ];

    const availableSubstitutes = [...new Set(substitutes)]
      .map((productId) =>
        offerForProduct(
          runtime,
          customer,
          productId,
          timestampMs,
          intervention,
          randomness,
          commercePolicy,
        ),
      )
      .filter((offer) => offer.availableUnits > 0);

    return availableSubstitutes.length > 0
      ? randomness.pick(
          `${key}:substitute`,
          availableSubstitutes,
        )
      : selected;
  }

  const selected = randomness.weightedPick(
    `${key}:latent-choice`,
    weighted.map((entry) => ({
      value: entry.value,
      weight: entry.latentWeight,
    })),
  );
  const demandId = `inventory-demand:${key}`;
  const position =
    runtime.inventoryEconomy.positions.get(
      selected.productId,
    );
  const expectedReplenishmentAt =
    position?.expectedArrivalAt ??
    (position !== undefined
      ? new Date(
          timestampMs +
            position.supplierLeadTimeDays *
              86_400_000,
        ).toISOString()
      : undefined);

  if (selected.availableUnits > 0) {
    recordInventoryDemand(runtime.inventoryEconomy, {
      demandId,
      customerId: customer.customerId,
      representedWeight: customer.populationWeight,
      occurredAtMs: timestampMs,
      requestedSkuId: selected.productId,
      requestedUnits: 1,
      inventoryDisposition: "available",
      fulfilledSkuId: selected.productId,
      sourceEventId: key,
      ...(expectedReplenishmentAt === undefined
        ? {}
        : { expectedReplenishmentAt }),
    });
    return {
      ...selected,
      demandTruthId: demandId,
    };
  }

  const inventoryMechanism =
    runtime.merchantWorld.manifest.inventoryMechanisms.find(
      (item) => item.productId === selected.productId,
    );
  const demandMechanism =
    runtime.merchantWorld.manifest.productDemandMechanisms.find(
      (item) => item.productId === selected.productId,
    );
  const requestedCategory =
    demandMechanism?.categoryId;
  const substitutes = [
    ...(inventoryMechanism?.substituteProductIds ?? []),
    ...(demandMechanism?.substitutionProductIds ?? []),
  ];

  const substitutionCandidates = [
    ...new Set(substitutes),
  ]
    .map((productId) => {
      const offer = offerForProduct(
        runtime,
        customer,
        productId,
        timestampMs,
        intervention,
        randomness,
        commercePolicy,
      );
      const preference =
        customer.source.productPreferences.find(
          (candidate) =>
            candidate.productId === productId,
        )?.affinity ?? 0.12;
      const substituteCategory =
        runtime.merchantWorld.manifest.productDemandMechanisms.find(
          (candidate) =>
            candidate.productId === productId,
        )?.categoryId;
      const sameCategory =
        substituteCategory !== undefined &&
        substituteCategory === requestedCategory;
      const priceGap =
        Math.abs(
          offer.finalPriceMinor -
            selected.finalPriceMinor,
        ) /
        Math.max(1, selected.finalPriceMinor);
      const similarityMultiplier =
        sameCategory ? 1.45 : 0.72;
      const priceMultiplier = clamp(
        1.2 - priceGap,
        0.15,
        1.2,
      );
      const weight =
        Math.max(1e-6, preference) *
        similarityMultiplier *
        priceMultiplier *
        (0.75 + customer.need * 0.5) *
        (0.8 + customer.brandAffinity * 0.35);
      return { offer, weight };
    })
    .filter(
      (entry) =>
        entry.offer.availableUnits > 0 &&
        entry.weight > 0,
    );

  if (substitutionCandidates.length > 0) {
    const bestWeight = Math.max(
      ...substitutionCandidates.map(
        (entry) => entry.weight,
      ),
    );
    const substitutionProbability = clamp(
      0.18 +
        customer.need * 0.24 +
        customer.brandAffinity * 0.16 +
        Math.min(0.28, bestWeight * 0.22),
      0.08,
      0.88,
    );

    if (
      randomness.bool(
        `${key}:accept-substitute`,
        substitutionProbability,
      )
    ) {
      const substitute = randomness.weightedPick(
        `${key}:substitute-choice`,
        substitutionCandidates.map((entry) => ({
          value: entry.offer,
          weight: entry.weight,
        })),
      );
      recordInventoryDemand(runtime.inventoryEconomy, {
        demandId,
        customerId: customer.customerId,
        representedWeight: customer.populationWeight,
        occurredAtMs: timestampMs,
        requestedSkuId: selected.productId,
        requestedUnits: 1,
        inventoryDisposition: "substituted",
        fulfilledSkuId: substitute.productId,
        substituteSkuId: substitute.productId,
        sourceEventId: key,
        ...(expectedReplenishmentAt === undefined
          ? {}
          : { expectedReplenishmentAt }),
      });
      return {
        ...substitute,
        demandTruthId: demandId,
      };
    }
  }

  const leadDays =
    position?.supplierLeadTimeDays ?? 365;
  const urgencyToleranceDays =
    3 + (1 - customer.need) * 42;

  if (
    inventoryMechanism?.allowBackorders === true &&
    inventoryMechanism.stockoutBehavior === "backorder"
  ) {
    const acceptanceProbability = clamp(
      0.72 +
        customer.brandAffinity * 0.18 -
        customer.need * 0.18 -
        leadDays * 0.008,
      0.04,
      0.92,
    );

    if (
      randomness.bool(
        `${key}:accept-backorder`,
        acceptanceProbability,
      )
    ) {
      recordInventoryDemand(runtime.inventoryEconomy, {
        demandId,
        customerId: customer.customerId,
        representedWeight: customer.populationWeight,
        occurredAtMs: timestampMs,
        requestedSkuId: selected.productId,
        requestedUnits: 1,
        inventoryDisposition: "backordered",
        fulfilledSkuId: selected.productId,
        sourceEventId: key,
        ...(expectedReplenishmentAt === undefined
          ? {}
          : { expectedReplenishmentAt }),
      });
      return {
        ...selected,
        demandTruthId: demandId,
      };
    }
  }

  if (
    expectedReplenishmentAt !== undefined &&
    leadDays <= urgencyToleranceDays &&
    randomness.bool(
      `${key}:wait-for-replenishment`,
      clamp(
        0.22 +
          customer.brandAffinity * 0.32 -
          customer.need * 0.16,
        0.05,
        0.75,
      ),
    )
  ) {
    recordInventoryDemand(runtime.inventoryEconomy, {
      demandId,
      customerId: customer.customerId,
      representedWeight: customer.populationWeight,
      occurredAtMs: timestampMs,
      requestedSkuId: selected.productId,
      requestedUnits: 1,
      inventoryDisposition: "delayed",
      sourceEventId: key,
      expectedReplenishmentAt,
    });
    customer.intent = clamp(
      customer.intent + 0.04,
      0,
      1,
    );
    return undefined;
  }

  const exitsMerchant = randomness.bool(
    `${key}:merchant-exit`,
    clamp(
      0.1 +
        (1 - customer.brandAffinity) * 0.34 +
        customer.need * 0.16,
      0.05,
      0.72,
    ),
  );

  recordInventoryDemand(runtime.inventoryEconomy, {
    demandId,
    customerId: customer.customerId,
    representedWeight: customer.populationWeight,
    occurredAtMs: timestampMs,
    requestedSkuId: selected.productId,
    requestedUnits: 1,
    inventoryDisposition: exitsMerchant
      ? "merchant_exit"
      : "permanently_lost",
    sourceEventId: key,
    ...(expectedReplenishmentAt === undefined
      ? {}
      : { expectedReplenishmentAt }),
  });

  const requestedComplements =
    demandMechanism?.complementaryProductIds ?? [];
  const cartHasComplement =
    customer.cart?.lines.some((line) => {
      const cartDemand =
        runtime.merchantWorld.manifest.productDemandMechanisms.find(
          (candidate) =>
            candidate.productId === line.productId,
        );
      return (
        requestedComplements.includes(line.productId) ||
        cartDemand?.complementaryProductIds?.includes(
          selected.productId,
        ) === true
      );
    }) ?? false;

  if (
    cartHasComplement &&
    randomness.bool(
      `${key}:complement-cart-abandon`,
      clamp(
        0.35 + customer.need * 0.28,
        0.2,
        0.82,
      ),
    )
  ) {
    for (const line of customer.cart?.lines ?? []) {
      markInventoryDemandOutcome(
        runtime.inventoryEconomy,
        line.demandTruthId,
        "abandoned",
      );
    }
    delete customer.cart;
  }

  if (exitsMerchant) {
    customer.brandAffinity = clamp(
      customer.brandAffinity - 0.025,
      0,
      1,
    );
  }

  return undefined;
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
    if (offer.demandTruthId !== undefined) {
      existing.demandTruthId = offer.demandTruthId;
    }
  } else {
    cart.lines.push({
      productId: offer.productId,
      quantity: 1,
      unitPriceMinor: offer.finalPriceMinor,
      ...(offer.demandTruthId === undefined
        ? {}
        : { demandTruthId: offer.demandTruthId }),
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
  interactionLift = 0,
  commercePolicy?: SimulationCommercePolicy,
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

  const threshold =
    commercePolicy?.freeShippingThresholdMinor;
  const shippingCharge =
    commercePolicy?.customerShippingChargeMinor ?? 0;
  const shippingFriction =
    threshold !== undefined &&
    threshold !== null &&
    cartValue < threshold &&
    shippingCharge > 0
      ? clamp(
          (shippingCharge / expectedAov) *
            customer.source.priceSensitivityMultiplier *
            0.9,
          0,
          0.45,
        )
      : 0;

  const probability =
    base *
    (0.35 + customer.intent * 0.65) *
    (0.45 + customer.need * 0.55) *
    (1 + Number(deviceEffect)) *
    (1 - valueFriction) *
    (1 - shippingFriction) *
    (promotion.active
      ? 1 +
        0.18 *
          customer.source.promotionSensitivityMultiplier
      : 1) +
    memory.purchaseProbability +
    interactionLift;

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
  commercePolicy?: SimulationCommercePolicy,
): RealizedPurchase | undefined {
  if (!customer.cart || customer.cart.lines.length === 0) return undefined;

  const lines: PurchaseLine[] = [];

  for (const cartLine of customer.cart.lines) {
    const available = runtime.inventory.get(cartLine.productId) ?? 0;
    const inventoryMechanism =
      runtime.merchantWorld.manifest.inventoryMechanisms.find(
        (item) => item.productId === cartLine.productId,
      );
    const allowBackorders =
      intervention.inventoryOverrideUnits === undefined &&
      commercePolicy?.executeInventoryLifecycle === true &&
      inventoryMechanism?.allowBackorders === true &&
      inventoryMechanism.stockoutBehavior === "backorder";

    if (available < cartLine.quantity && !allowBackorders) continue;

    const offer = offerForProduct(
      runtime,
      customer,
      cartLine.productId,
      timestampMs,
      intervention,
      randomness,
      commercePolicy,
    );

    const quantity = allowBackorders
      ? cartLine.quantity
      : Math.min(cartLine.quantity, available);
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
    const mechanism =
      runtime.merchantWorld.manifest.inventoryMechanisms.find(
        (item) => item.productId === line.productId,
      );
    const next =
      (runtime.inventory.get(line.productId) ?? 0) -
      line.quantity;
    runtime.inventory.set(
      line.productId,
      commercePolicy?.executeInventoryLifecycle === true &&
        mechanism?.allowBackorders === true &&
        mechanism.stockoutBehavior === "backorder"
        ? next
        : Math.max(0, next),
    );
  }

  const repeatPurchase = customer.purchaseCount > 0;
  delete customer.cart;
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
