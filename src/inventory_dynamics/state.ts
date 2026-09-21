import type { GeneratedMerchantWorld } from "../generation/config.js";
import {
  DEFAULT_INVENTORY_LOCATION_ID,
  INVENTORY_DYNAMICS_VERSION,
  type BackorderObligation,
  type InventoryCommerceOutcome,
  type InventoryDemandDisposition,
  type InventoryDemandTruthRecord,
  type InventoryEconomyRuntime,
  type InventoryGodModeTruth,
  type InventoryMovement,
  type InventoryMovementType,
  type InventoryReconciliation,
  type InventoryReorder,
  type InventoryReservation,
  type InventorySnapshot,
  type MutableInventoryPosition,
  type ReorderPolicyKind,
} from "./types.js";

const DAY_MS = 86_400_000;

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("inventory quantity must be finite");
  }
  return Math.max(0, Math.floor(value));
}

function dailyDemandFor(
  world: GeneratedMerchantWorld,
  productId: string,
): number {
  const demand = world.manifest.productDemandMechanisms.find(
    (candidate) => candidate.productId === productId,
  );
  if (!demand) return 0;
  const base = Number(demand.baseLatentDemandUnits);
  if (demand.cadence === "hour") return base * 24;
  if (demand.cadence === "week") return base / 7;
  return base;
}

function policyKindFor(
  world: GeneratedMerchantWorld,
): ReorderPolicyKind {
  switch (world.summary.inventoryProfile) {
    case "replenishment_friendly":
    case "short_lead_time":
      return "order_up_to";
    case "shallow":
    case "stockout_prone":
      return "fixed_quantity";
    default:
      return "reorder_point";
  }
}

function safetyFactorFor(
  world: GeneratedMerchantWorld,
): number {
  switch (world.summary.inventoryProfile) {
    case "shallow":
      return 0.08;
    case "stockout_prone":
      return 0.05;
    case "long_lead_time":
      return 0.28;
    case "replenishment_friendly":
      return 0.18;
    case "short_lead_time":
      return 0.12;
    case "deep":
      return 0.32;
  }
}

function carryingRateFor(
  world: GeneratedMerchantWorld,
): number {
  const base =
    world.summary.archetype === "furniture" ||
    world.summary.archetype === "home_furnishings_decor"
      ? 0.00042
      : world.summary.archetype === "fashion_apparel" ||
          world.summary.archetype === "consumer_electronics"
        ? 0.00072
        : 0.00048;

  const inventoryMultiplier =
    world.summary.inventoryProfile === "deep"
      ? 1.3
      : world.summary.inventoryProfile === "long_lead_time"
        ? 1.15
        : world.summary.inventoryProfile === "replenishment_friendly"
          ? 0.82
          : 1;

  return base * inventoryMultiplier;
}

function obsolescenceRateFor(
  world: GeneratedMerchantWorld,
): number {
  switch (world.summary.archetype) {
    case "fashion_apparel":
      return 0.0012;
    case "consumer_electronics":
      return 0.0009;
    case "beauty_cosmetics":
      return 0.00035;
    default:
      return 0;
  }
}

function snapshot(
  position: MutableInventoryPosition,
): InventorySnapshot {
  const availableToSellUnits = Math.max(
    0,
    position.onHandUnits -
      position.reservedUnits -
      position.committedUnits -
      position.damagedUnits -
      position.quarantinedReturnUnits,
  );

  return {
    skuId: position.skuId,
    productId: position.productId,
    ...(position.variantId === undefined
      ? {}
      : { variantId: position.variantId }),
    locationId: position.locationId,
    onHandUnits: position.onHandUnits,
    availableToSellUnits,
    reservedUnits: position.reservedUnits,
    committedUnits: position.committedUnits,
    damagedUnits: position.damagedUnits,
    quarantinedReturnUnits:
      position.quarantinedReturnUnits,
    inboundUnits: position.inboundUnits,
    backorderedUnits: position.backorderedUnits,
    safetyStockUnits: position.safetyStockUnits,
    reorderPointUnits: position.reorderPointUnits,
    reorderState: position.reorderState,
    ...(position.expectedArrivalAt === undefined
      ? {}
      : { expectedArrivalAt: position.expectedArrivalAt }),
    ...(position.realizedArrivalAt === undefined
      ? {}
      : { realizedArrivalAt: position.realizedArrivalAt }),
    oldestInventoryReceivedAt: new Date(
      position.oldestInventoryReceivedAtMs,
    ).toISOString(),
    carryingCostRatePerCogsValuePerDay:
      position.carryingCostRatePerCogsValuePerDay,
    obsolescenceRatePerDay:
      position.obsolescenceRatePerDay,
  };
}

export function inventorySnapshot(
  state: InventoryEconomyRuntime,
  skuId: string,
): InventorySnapshot {
  const position = state.positions.get(skuId);
  if (!position) {
    throw new RangeError("unknown inventory SKU: " + skuId);
  }
  return snapshot(position);
}

export function availableToSellUnits(
  state: InventoryEconomyRuntime,
  skuId: string,
): number {
  return inventorySnapshot(state, skuId).availableToSellUnits;
}

export function legacyNetAvailableUnits(
  state: InventoryEconomyRuntime,
  skuId: string,
): number {
  const current = inventorySnapshot(state, skuId);
  return current.availableToSellUnits - current.backorderedUnits;
}

function assertPosition(position: MutableInventoryPosition): void {
  const fields: readonly (keyof MutableInventoryPosition)[] = [
    "onHandUnits",
    "reservedUnits",
    "committedUnits",
    "damagedUnits",
    "quarantinedReturnUnits",
    "inboundUnits",
    "backorderedUnits",
  ];
  for (const field of fields) {
    const value = position[field];
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value < 0)
    ) {
      throw new RangeError(
        position.skuId + " has invalid " + String(field),
      );
    }
  }

  if (
    position.reservedUnits +
      position.committedUnits +
      position.damagedUnits +
      position.quarantinedReturnUnits >
    position.onHandUnits
  ) {
    throw new RangeError(
      position.skuId +
        " reserved + committed + damaged + quarantined returns exceeds physical on-hand stock",
    );
  }
}

export function assertInventoryInvariant(
  state: InventoryEconomyRuntime,
): void {
  for (const position of state.positions.values()) {
    assertPosition(position);
  }
}

function movement(
  state: InventoryEconomyRuntime,
  position: MutableInventoryPosition,
  movementType: InventoryMovementType,
  quantity: number,
  timestampMs: number,
  sourceEventId: string,
  mutate: () => void,
): InventoryMovement {
  const before = snapshot(position);
  mutate();
  assertPosition(position);
  const after = snapshot(position);

  const record: InventoryMovement = {
    movementId:
      "inventory-movement:" +
      String(state.nextMovementOrdinal++).padStart(8, "0"),
    skuId: position.skuId,
    productId: position.productId,
    occurredAt: new Date(timestampMs).toISOString(),
    movementType,
    quantity,
    sourceEventId,
    before,
    after,
  };
  state.ledger.push(record);

  if (
    before.availableToSellUnits > 0 &&
    after.availableToSellUnits === 0
  ) {
    position.stockoutStartedAtMs = timestampMs;
    const stockoutSnapshot = snapshot(position);
    state.ledger.push({
      movementId:
        "inventory-movement:" +
        String(state.nextMovementOrdinal++).padStart(8, "0"),
      skuId: position.skuId,
      productId: position.productId,
      occurredAt: new Date(timestampMs).toISOString(),
      movementType: "stockout_started",
      quantity: 0,
      sourceEventId,
      before: stockoutSnapshot,
      after: stockoutSnapshot,
    });
  } else if (
    before.availableToSellUnits === 0 &&
    after.availableToSellUnits > 0
  ) {
    delete position.stockoutStartedAtMs;
    const stockoutSnapshot = snapshot(position);
    state.ledger.push({
      movementId:
        "inventory-movement:" +
        String(state.nextMovementOrdinal++).padStart(8, "0"),
      skuId: position.skuId,
      productId: position.productId,
      occurredAt: new Date(timestampMs).toISOString(),
      movementType: "stockout_ended",
      quantity: 0,
      sourceEventId,
      before: stockoutSnapshot,
      after: stockoutSnapshot,
    });
  }

  return record;
}

export function createInventoryEconomyState(
  world: GeneratedMerchantWorld,
  startMs: number,
): InventoryEconomyRuntime {
  if (!Number.isFinite(startMs)) {
    throw new RangeError("inventory start time must be finite");
  }

  const positions = new Map<string, MutableInventoryPosition>();
  const ledger: InventoryMovement[] = [];
  const policyKind = policyKindFor(world);
  const agingEnabled =
    world.summary.archetype === "fashion_apparel" ||
    world.summary.archetype === "consumer_electronics" ||
    world.summary.archetype === "beauty_cosmetics";

  for (const mechanism of world.manifest.inventoryMechanisms) {
    const onHand = nonNegativeInteger(
      Number(mechanism.initialAvailableUnits),
    );
    const reserved = Math.min(
      onHand,
      nonNegativeInteger(
        Number(mechanism.initialReservedUnits),
      ),
    );
    const leadDays = Math.max(
      0,
      Number(mechanism.supplierLeadTimeSeconds) /
        (24 * 60 * 60),
    );
    const dailyDemand = dailyDemandFor(
      world,
      mechanism.productId,
    );
    const safetyStock = Math.max(
      0,
      Math.ceil(
        dailyDemand *
          Math.max(1, leadDays) *
          safetyFactorFor(world),
      ),
    );
    const reorderPoint = Math.max(
      safetyStock,
      Math.ceil(dailyDemand * leadDays + safetyStock),
    );
    const declaredReplenishment = nonNegativeInteger(
      Number(mechanism.replenishmentUnits),
    );
    const fixedQuantity = Math.max(
      1,
      declaredReplenishment,
      Math.ceil(
        dailyDemand * Math.max(1, leadDays) * 0.5,
      ),
    );
    const orderUpTo = Math.max(
      onHand,
      reorderPoint + fixedQuantity,
    );
    const minimumOrder = Math.max(
      1,
      Math.floor(fixedQuantity * 0.4),
    );

    const openingAgeDays = agingEnabled
      ? 7 +
        ((world.manifest.seed +
          mechanism.productId.length * 17) %
          75)
      : 0;

    const position: MutableInventoryPosition = {
      skuId: mechanism.productId,
      productId: mechanism.productId,
      locationId: DEFAULT_INVENTORY_LOCATION_ID,
      onHandUnits: onHand,
      reservedUnits: reserved,
      committedUnits: 0,
      damagedUnits: 0,
      quarantinedReturnUnits: 0,
      inboundUnits: 0,
      backorderedUnits: 0,
      openingOnHandUnits: onHand,
      safetyStockUnits: safetyStock,
      reorderPointUnits: reorderPoint,
      orderUpToLevelUnits: orderUpTo,
      fixedReorderQuantityUnits: fixedQuantity,
      minimumOrderQuantityUnits: minimumOrder,
      reorderPolicyKind: policyKind,
      reorderState: "idle",
      allowBackorders: mechanism.allowBackorders,
      stockoutBehavior: mechanism.stockoutBehavior,
      supplierLeadTimeDays: leadDays,
      ...(mechanism.allowBackorders
        ? {
            maximumBackorderDelayDays: Math.max(
              3,
              leadDays * 1.35,
            ),
          }
        : {}),
      agingEnabled,
      oldestInventoryReceivedAtMs:
        startMs - openingAgeDays * DAY_MS,
      carryingCostRatePerCogsValuePerDay:
        carryingRateFor(world),
      obsolescenceRatePerDay:
        obsolescenceRateFor(world),
      cumulativeReceivedUnits: 0,
      cumulativeReturnedUnits: 0,
      cumulativeSoldUnits: 0,
      cumulativeWriteOffUnits: 0,
      cumulativeExplicitAdjustmentUnits: 0,
      ...(onHand - reserved <= 0
        ? { stockoutStartedAtMs: startMs }
        : {}),
    };
    assertPosition(position);
    positions.set(position.skuId, position);
  }

  const state: InventoryEconomyRuntime = {
    version: INVENTORY_DYNAMICS_VERSION,
    positions,
    reservations: new Map(),
    backorders: new Map(),
    reorders: new Map(),
    ledger,
    demandTruth: [],
    returnTruth: [],
    nextMovementOrdinal: 0,
  };

  for (const position of state.positions.values()) {
    const opening = snapshot(position);
    state.ledger.push({
      movementId:
        "inventory-movement:" +
        String(state.nextMovementOrdinal++).padStart(8, "0"),
      skuId: position.skuId,
      productId: position.productId,
      occurredAt: new Date(startMs).toISOString(),
      movementType: "opening_balance",
      quantity: position.openingOnHandUnits,
      sourceEventId: "simulation_opening_state",
      before: {
        ...opening,
        onHandUnits: 0,
        availableToSellUnits: 0,
        reservedUnits: 0,
      },
      after: opening,
    });

    if (opening.availableToSellUnits === 0) {
      state.ledger.push({
        movementId:
          "inventory-movement:" +
          String(state.nextMovementOrdinal++).padStart(8, "0"),
        skuId: position.skuId,
        productId: position.productId,
        occurredAt: new Date(startMs).toISOString(),
        movementType: "stockout_started",
        quantity: 0,
        sourceEventId: "simulation_opening_state",
        before: opening,
        after: opening,
      });
    }
  }

  return state;
}

export function reserveInventory(
  state: InventoryEconomyRuntime,
  input: {
    readonly reservationId: string;
    readonly skuId: string;
    readonly customerId: string;
    readonly requestedUnits: number;
    readonly timestampMs: number;
    readonly expiresAtMs: number;
    readonly sourceEventId: string;
  },
): InventoryReservation | undefined {
  const position = state.positions.get(input.skuId);
  if (!position) return undefined;
  const quantity = Math.min(
    nonNegativeInteger(input.requestedUnits),
    availableToSellUnits(state, input.skuId),
  );
  if (quantity <= 0) return undefined;

  movement(
    state,
    position,
    "reservation",
    quantity,
    input.timestampMs,
    input.sourceEventId,
    () => {
      position.reservedUnits += quantity;
    },
  );

  const reservation: InventoryReservation = {
    reservationId: input.reservationId,
    skuId: input.skuId,
    customerId: input.customerId,
    sourceEventId: input.sourceEventId,
    createdAt: new Date(input.timestampMs).toISOString(),
    expiresAt: new Date(input.expiresAtMs).toISOString(),
    quantity,
    active: true,
  };
  state.reservations.set(
    reservation.reservationId,
    reservation,
  );
  return reservation;
}

export function releaseReservation(
  state: InventoryEconomyRuntime,
  reservationId: string,
  timestampMs: number,
  sourceEventId: string,
): number {
  const reservation =
    state.reservations.get(reservationId);
  if (!reservation || !reservation.active) return 0;
  const position = state.positions.get(reservation.skuId);
  if (!position) return 0;
  const quantity = Math.min(
    reservation.quantity,
    position.reservedUnits,
  );
  if (quantity <= 0) {
    reservation.active = false;
    return 0;
  }

  movement(
    state,
    position,
    "reservation_released",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.reservedUnits -= quantity;
    },
  );
  reservation.active = false;
  return quantity;
}

export function reservationQuantity(
  state: InventoryEconomyRuntime,
  sourceEventId: string,
  skuId: string,
): number {
  let total = 0;
  for (const reservation of state.reservations.values()) {
    if (
      reservation.active &&
      reservation.sourceEventId === sourceEventId &&
      reservation.skuId === skuId
    ) {
      total += reservation.quantity;
    }
  }
  return total;
}

export function commitAndSellReservations(
  state: InventoryEconomyRuntime,
  sourceEventId: string,
  skuId: string,
  requestedUnits: number,
  timestampMs: number,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  let remaining = nonNegativeInteger(requestedUnits);
  let sold = 0;

  const reservations = [...state.reservations.values()]
    .filter(
      (reservation) =>
        reservation.active &&
        reservation.sourceEventId === sourceEventId &&
        reservation.skuId === skuId,
    )
    .sort((left, right) =>
      left.reservationId.localeCompare(right.reservationId),
    );

  for (const reservation of reservations) {
    if (remaining <= 0) break;
    const quantity = Math.min(
      remaining,
      reservation.quantity,
      position.reservedUnits,
    );
    if (quantity <= 0) continue;

    movement(
      state,
      position,
      "commitment",
      quantity,
      timestampMs,
      sourceEventId,
      () => {
        position.reservedUnits -= quantity;
        position.committedUnits += quantity;
      },
    );

    movement(
      state,
      position,
      "sale",
      quantity,
      timestampMs,
      sourceEventId,
      () => {
        position.committedUnits -= quantity;
        position.onHandUnits -= quantity;
        position.cumulativeSoldUnits += quantity;
      },
    );

    reservation.quantity -= quantity;
    reservation.active = reservation.quantity > 0;
    sold += quantity;
    remaining -= quantity;
  }

  return sold;
}

export function sellAvailableInventory(
  state: InventoryEconomyRuntime,
  skuId: string,
  requestedUnits: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = Math.min(
    nonNegativeInteger(requestedUnits),
    availableToSellUnits(state, skuId),
  );
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "sale",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.onHandUnits -= quantity;
      position.cumulativeSoldUnits += quantity;
    },
  );
  return quantity;
}

export function createBackorder(
  state: InventoryEconomyRuntime,
  input: {
    readonly backorderId: string;
    readonly skuId: string;
    readonly customerId: string;
    readonly quantity: number;
    readonly timestampMs: number;
    readonly sourceEventId: string;
    readonly maximumAcceptableArrivalAtMs?: number;
  },
): BackorderObligation | undefined {
  const position = state.positions.get(input.skuId);
  if (
    !position ||
    !position.allowBackorders ||
    position.stockoutBehavior !== "backorder"
  ) {
    return undefined;
  }
  const quantity = nonNegativeInteger(input.quantity);
  if (quantity <= 0) return undefined;

  movement(
    state,
    position,
    "backorder_created",
    quantity,
    input.timestampMs,
    input.sourceEventId,
    () => {
      position.backorderedUnits += quantity;
    },
  );

  const obligation: BackorderObligation = {
    backorderId: input.backorderId,
    skuId: input.skuId,
    customerId: input.customerId,
    sourceEventId: input.sourceEventId,
    createdAt: new Date(input.timestampMs).toISOString(),
    ...(input.maximumAcceptableArrivalAtMs === undefined
      ? {}
      : {
          maximumAcceptableArrivalAt: new Date(
            input.maximumAcceptableArrivalAtMs,
          ).toISOString(),
        }),
    quantity,
    fulfilledUnits: 0,
    cancelledUnits: 0,
  };
  state.backorders.set(
    obligation.backorderId,
    obligation,
  );
  return obligation;
}

export function cancelBackorder(
  state: InventoryEconomyRuntime,
  backorderId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const obligation = state.backorders.get(backorderId);
  if (!obligation) return 0;
  const position = state.positions.get(obligation.skuId);
  if (!position) return 0;

  const open =
    obligation.quantity -
    obligation.fulfilledUnits -
    obligation.cancelledUnits;
  const quantity = Math.min(
    open,
    nonNegativeInteger(quantityInput),
  );
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "backorder_cancelled",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.backorderedUnits -= quantity;
    },
  );
  obligation.cancelledUnits += quantity;
  return quantity;
}

export function fulfillBackordersFromAvailable(
  state: InventoryEconomyRuntime,
  skuId: string,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  let available = availableToSellUnits(state, skuId);
  if (available <= 0 || position.backorderedUnits <= 0) {
    return 0;
  }

  let total = 0;
  const obligations = [...state.backorders.values()]
    .filter((item) => item.skuId === skuId)
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.backorderId.localeCompare(right.backorderId),
    );

  for (const obligation of obligations) {
    if (available <= 0) break;
    const open =
      obligation.quantity -
      obligation.fulfilledUnits -
      obligation.cancelledUnits;
    if (open <= 0) continue;
    const quantity = Math.min(open, available);

    movement(
      state,
      position,
      "backorder_fulfilled",
      quantity,
      timestampMs,
      sourceEventId,
      () => {
        position.backorderedUnits -= quantity;
        position.onHandUnits -= quantity;
        position.cumulativeSoldUnits += quantity;
      },
    );

    obligation.fulfilledUnits += quantity;
    total += quantity;
    available -= quantity;
  }

  return total;
}

export function receiveInventory(
  state: InventoryEconomyRuntime,
  skuId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = nonNegativeInteger(quantityInput);
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "supplier_receipt",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.inboundUnits = Math.max(
        0,
        position.inboundUnits - quantity,
      );
      position.onHandUnits += quantity;
      position.cumulativeReceivedUnits += quantity;
      position.reorderState = "idle";
      position.realizedArrivalAt =
        new Date(timestampMs).toISOString();
      position.oldestInventoryReceivedAtMs =
        Math.min(
          position.oldestInventoryReceivedAtMs,
          timestampMs,
        );
    },
  );

  fulfillBackordersFromAvailable(
    state,
    skuId,
    timestampMs,
    sourceEventId + ":backorder-fulfillment",
  );
  return quantity;
}

export function recordReturnReceived(
  state: InventoryEconomyRuntime,
  skuId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = nonNegativeInteger(quantityInput);
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "return_received",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.onHandUnits += quantity;
      position.quarantinedReturnUnits += quantity;
      position.cumulativeReturnedUnits += quantity;
    },
  );
  return quantity;
}

export function restockReturnedInventory(
  state: InventoryEconomyRuntime,
  skuId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = Math.min(
    nonNegativeInteger(quantityInput),
    position.quarantinedReturnUnits,
  );
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "return_restocked",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.quarantinedReturnUnits -= quantity;
    },
  );
  fulfillBackordersFromAvailable(
    state,
    skuId,
    timestampMs,
    sourceEventId + ":backorder-fulfillment",
  );
  return quantity;
}

export function damageReturnedInventory(
  state: InventoryEconomyRuntime,
  skuId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = Math.min(
    nonNegativeInteger(quantityInput),
    position.quarantinedReturnUnits,
  );
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "damage",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.quarantinedReturnUnits -= quantity;
      position.damagedUnits += quantity;
    },
  );
  return quantity;
}

export function damageInventory(
  state: InventoryEconomyRuntime,
  skuId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = Math.min(
    nonNegativeInteger(quantityInput),
    availableToSellUnits(state, skuId),
  );
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "damage",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.damagedUnits += quantity;
    },
  );
  return quantity;
}

export function writeOffDamagedInventory(
  state: InventoryEconomyRuntime,
  skuId: string,
  quantityInput: number,
  timestampMs: number,
  sourceEventId: string,
): number {
  const position = state.positions.get(skuId);
  if (!position) return 0;
  const quantity = Math.min(
    nonNegativeInteger(quantityInput),
    position.damagedUnits,
  );
  if (quantity <= 0) return 0;

  movement(
    state,
    position,
    "write_off",
    quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.damagedUnits -= quantity;
      position.onHandUnits -= quantity;
      position.cumulativeWriteOffUnits += quantity;
    },
  );
  return quantity;
}

export function setAvailableInventoryAdjustment(
  state: InventoryEconomyRuntime,
  skuId: string,
  targetAvailableInput: number,
  timestampMs: number,
  sourceEventId: string,
): void {
  const position = state.positions.get(skuId);
  if (!position) return;
  const targetAvailable =
    nonNegativeInteger(targetAvailableInput);
  const currentAvailable =
    availableToSellUnits(state, skuId);
  const delta = targetAvailable - currentAvailable;
  if (delta === 0) return;

  movement(
    state,
    position,
    "explicit_adjustment",
    Math.abs(delta),
    timestampMs,
    sourceEventId,
    () => {
      const beforeOnHand = position.onHandUnits;
      position.onHandUnits = Math.max(
        position.reservedUnits +
          position.committedUnits +
          position.damagedUnits +
          position.quarantinedReturnUnits,
        position.onHandUnits + delta,
      );
      position.cumulativeExplicitAdjustmentUnits +=
        position.onHandUnits - beforeOnHand;
    },
  );
}

export function reorderQuantity(
  position: MutableInventoryPosition,
): number {
  const inventoryPosition =
    availableToSellUnitsForPosition(position) +
    position.inboundUnits;

  if (position.reorderPolicyKind === "fixed_quantity") {
    return Math.max(
      position.minimumOrderQuantityUnits,
      position.fixedReorderQuantityUnits,
    );
  }

  if (position.reorderPolicyKind === "order_up_to") {
    return Math.max(
      0,
      Math.max(
        position.minimumOrderQuantityUnits,
        position.orderUpToLevelUnits -
          inventoryPosition,
      ),
    );
  }

  return inventoryPosition <= position.reorderPointUnits
    ? Math.max(
        position.minimumOrderQuantityUnits,
        position.fixedReorderQuantityUnits,
      )
    : 0;
}

function availableToSellUnitsForPosition(
  position: MutableInventoryPosition,
): number {
  return Math.max(
    0,
    position.onHandUnits -
      position.reservedUnits -
      position.committedUnits -
      position.damagedUnits,
  );
}

export function shouldReorder(
  position: MutableInventoryPosition,
): boolean {
  return (
    position.reorderState === "idle" &&
    availableToSellUnitsForPosition(position) +
      position.inboundUnits <=
      position.reorderPointUnits
  );
}

export function placeReorder(
  state: InventoryEconomyRuntime,
  input: {
    readonly reorderId: string;
    readonly skuId: string;
    readonly quantity: number;
    readonly placedAtMs: number;
    readonly expectedArrivalAtMs: number;
    readonly realizedArrivalAtMs: number;
    readonly sourceEventId: string;
  },
): InventoryReorder | undefined {
  const position = state.positions.get(input.skuId);
  if (!position || position.reorderState !== "idle") {
    return undefined;
  }
  const quantity = Math.max(
    position.minimumOrderQuantityUnits,
    nonNegativeInteger(input.quantity),
  );
  if (quantity <= 0) return undefined;

  movement(
    state,
    position,
    "reorder_placed",
    quantity,
    input.placedAtMs,
    input.sourceEventId,
    () => {
      position.inboundUnits += quantity;
      position.reorderState = "ordered";
      position.expectedArrivalAt = new Date(
        input.expectedArrivalAtMs,
      ).toISOString();
      position.realizedArrivalAt = new Date(
        input.realizedArrivalAtMs,
      ).toISOString();
    },
  );

  const reorder: InventoryReorder = {
    reorderId: input.reorderId,
    skuId: input.skuId,
    placedAt: new Date(input.placedAtMs).toISOString(),
    quantity,
    policyKind: position.reorderPolicyKind,
    expectedArrivalAt: new Date(
      input.expectedArrivalAtMs,
    ).toISOString(),
    realizedArrivalAt: new Date(
      input.realizedArrivalAtMs,
    ).toISOString(),
    delayed:
      input.realizedArrivalAtMs >
      input.expectedArrivalAtMs,
    receivedUnits: 0,
  };
  state.reorders.set(reorder.reorderId, reorder);
  return reorder;
}

export function dispatchReorder(
  state: InventoryEconomyRuntime,
  reorderId: string,
  timestampMs: number,
  sourceEventId: string,
): void {
  const reorder = state.reorders.get(reorderId);
  if (!reorder) return;
  const position = state.positions.get(reorder.skuId);
  if (!position) return;

  movement(
    state,
    position,
    "shipment_dispatched",
    reorder.quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.reorderState = "dispatched";
      reorder.dispatchedAt =
        new Date(timestampMs).toISOString();
    },
  );
}

export function markReorderDelayed(
  state: InventoryEconomyRuntime,
  reorderId: string,
  timestampMs: number,
  sourceEventId: string,
): void {
  const reorder = state.reorders.get(reorderId);
  if (!reorder || !reorder.delayed) return;
  const position = state.positions.get(reorder.skuId);
  if (!position) return;

  movement(
    state,
    position,
    "shipment_delayed",
    reorder.quantity,
    timestampMs,
    sourceEventId,
    () => {
      position.reorderState = "delayed";
    },
  );
}

export function recordInventoryDemand(
  state: InventoryEconomyRuntime,
  input: {
    readonly demandId: string;
    readonly customerId: string;
    readonly representedWeight: number;
    readonly occurredAtMs: number;
    readonly requestedSkuId: string;
    readonly requestedUnits: number;
    readonly inventoryDisposition: InventoryDemandDisposition;
    readonly fulfilledSkuId?: string;
    readonly substituteSkuId?: string;
    readonly expectedReplenishmentAt?: string;
    readonly sourceEventId: string;
  },
): InventoryDemandTruthRecord {
  const existing = state.demandTruth.find(
    (record) => record.demandId === input.demandId,
  );
  if (existing) return existing;

  const record: InventoryDemandTruthRecord = {
    demandId: input.demandId,
    customerId: input.customerId,
    representedWeight: Math.max(
      0,
      input.representedWeight,
    ),
    occurredAt: new Date(
      input.occurredAtMs,
    ).toISOString(),
    requestedSkuId: input.requestedSkuId,
    requestedUnits: nonNegativeInteger(
      input.requestedUnits,
    ),
    inventoryDisposition:
      input.inventoryDisposition,
    ...(input.fulfilledSkuId === undefined
      ? {}
      : { fulfilledSkuId: input.fulfilledSkuId }),
    ...(input.substituteSkuId === undefined
      ? {}
      : { substituteSkuId: input.substituteSkuId }),
    ...(input.expectedReplenishmentAt === undefined
      ? {}
      : {
          expectedReplenishmentAt:
            input.expectedReplenishmentAt,
        }),
    sourceEventId: input.sourceEventId,
    commerceOutcome: "pending",
  };
  state.demandTruth.push(record);
  return record;
}

export function markInventoryDemandOutcome(
  state: InventoryEconomyRuntime,
  demandId: string | undefined,
  outcome: InventoryCommerceOutcome,
): void {
  if (demandId === undefined) return;
  const record = state.demandTruth.find(
    (candidate) => candidate.demandId === demandId,
  );
  if (record) record.commerceOutcome = outcome;
}

export function reconciliationFor(
  position: MutableInventoryPosition,
): InventoryReconciliation {
  const expectedClosing =
    position.openingOnHandUnits +
    position.cumulativeReceivedUnits +
    position.cumulativeReturnedUnits +
    position.cumulativeExplicitAdjustmentUnits -
    position.cumulativeSoldUnits -
    position.cumulativeWriteOffUnits;

  return {
    skuId: position.skuId,
    openingOnHandUnits: position.openingOnHandUnits,
    receivedUnits: position.cumulativeReceivedUnits,
    returnedUnits:
      position.cumulativeReturnedUnits,
    explicitAdjustmentUnits:
      position.cumulativeExplicitAdjustmentUnits,
    soldUnits: position.cumulativeSoldUnits,
    writtenOffUnits: position.cumulativeWriteOffUnits,
    expectedClosingOnHandUnits: expectedClosing,
    actualClosingOnHandUnits: position.onHandUnits,
    reconcilesExactly:
      expectedClosing === position.onHandUnits,
  };
}

export function finalizeInventoryGodMode(
  state: InventoryEconomyRuntime,
): InventoryGodModeTruth {
  assertInventoryInvariant(state);
  const reconciliation = [...state.positions.values()]
    .map(reconciliationFor)
    .sort((left, right) =>
      left.skuId.localeCompare(right.skuId),
    );

  for (const row of reconciliation) {
    if (!row.reconcilesExactly) {
      throw new RangeError(
        "inventory reconciliation failed for " +
          row.skuId,
      );
    }
  }

  return {
    version: INVENTORY_DYNAMICS_VERSION,
    positions: [...state.positions.values()]
      .map(snapshot)
      .sort((left, right) =>
        left.skuId.localeCompare(right.skuId),
      ),
    ledger: [...state.ledger].sort(
      (left, right) =>
        Date.parse(left.occurredAt) -
          Date.parse(right.occurredAt) ||
        left.movementId.localeCompare(
          right.movementId,
        ),
    ),
    demandTruth: [...state.demandTruth],
    returnTruth: [...state.returnTruth],
    reservations: [...state.reservations.values()].map(
      (reservation) => ({ ...reservation }),
    ),
    backorders: [...state.backorders.values()].map(
      (backorder) => ({ ...backorder }),
    ),
    reorders: [...state.reorders.values()].map(
      (reorder) => ({ ...reorder }),
    ),
    reconciliation,
  };
}
