import { describe, expect, it } from "vitest";
import { nonNegative } from "../../src/core/units.js";
import { generateMerchantWorldRecord } from "../../src/generation/generator.js";
import {
  availableToSellUnits,
  commitAndSellReservations,
  createBackorder,
  damageReturnedInventory,
  createInventoryEconomyState,
  finalizeInventoryGodMode,
  legacyNetAvailableUnits,
  receiveInventory,
  recordReturnReceived,
  releaseReservation,
  reserveInventory,
  restockReturnedInventory,
  writeOffDamagedInventory,
} from "../../src/inventory_dynamics/state.js";

describe("Step 9 authoritative inventory state", () => {
  it("reserves the last unit without allowing a second checkout to consume it", () => {
    const world = generateMerchantWorldRecord({
      seed: 190001,
      archetype: "specialty_retail",
      scale: "small",
      complexity: "normal",
      inventoryProfile: "deep",
    });
    const skuId =
      world.manifest.inventoryMechanisms[0]!.productId;
    const state = createInventoryEconomyState(
      world,
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
    const starting =
      availableToSellUnits(state, skuId);
    expect(starting).toBeGreaterThan(0);

    const first = reserveInventory(state, {
      reservationId: "r1",
      skuId,
      customerId: "c1",
      requestedUnits: starting,
      timestampMs: Date.parse("2026-01-01T00:01:00.000Z"),
      expiresAtMs: Date.parse("2026-01-01T00:21:00.000Z"),
      sourceEventId: "checkout-1",
    });
    expect(first?.quantity).toBe(starting);
    expect(availableToSellUnits(state, skuId)).toBe(0);

    const second = reserveInventory(state, {
      reservationId: "r2",
      skuId,
      customerId: "c2",
      requestedUnits: 1,
      timestampMs: Date.parse("2026-01-01T00:02:00.000Z"),
      expiresAtMs: Date.parse("2026-01-01T00:22:00.000Z"),
      sourceEventId: "checkout-2",
    });
    expect(second).toBeUndefined();

    releaseReservation(
      state,
      "r1",
      Date.parse("2026-01-01T00:21:00.000Z"),
      "reservation-expiry",
    );
    expect(availableToSellUnits(state, skuId)).toBe(starting);

    const truth = finalizeInventoryGodMode(state);
    expect(
      truth.reconciliation.every(
        (row) => row.reconcilesExactly,
      ),
    ).toBe(true);
  });

  it("keeps backorders explicit and authoritative inventory non-negative", () => {
    const base = generateMerchantWorldRecord({
      seed: 190002,
      archetype: "furniture",
      scale: "small",
      complexity: "normal",
    });
    const world = structuredClone(base);
    const mechanism =
      world.manifest.inventoryMechanisms[0]!;
    const mutable = mechanism as unknown as {
      initialAvailableUnits: number;
      initialReservedUnits: number;
      allowBackorders: boolean;
      stockoutBehavior:
        | "lost_demand"
        | "substitute"
        | "backorder";
    };
    mutable.initialAvailableUnits = nonNegative(0);
    mutable.initialReservedUnits = nonNegative(0);
    mutable.allowBackorders = true;
    mutable.stockoutBehavior = "backorder";

    const startMs =
      Date.parse("2026-01-01T00:00:00.000Z");
    const state = createInventoryEconomyState(
      world,
      startMs,
    );
    const skuId = mechanism.productId;

    const obligation = createBackorder(state, {
      backorderId: "b1",
      skuId,
      customerId: "c1",
      quantity: 2,
      timestampMs: startMs + 60_000,
      sourceEventId: "order-1",
    });

    expect(obligation?.quantity).toBe(2);
    expect(
      state.positions.get(skuId)!.onHandUnits,
    ).toBe(0);
    expect(
      state.positions.get(skuId)!.backorderedUnits,
    ).toBe(2);
    expect(
      legacyNetAvailableUnits(state, skuId),
    ).toBe(0);

    receiveInventory(
      state,
      skuId,
      2,
      startMs + 86_400_000,
      "supplier-receipt",
    );

    const position = state.positions.get(skuId)!;
    expect(position.onHandUnits).toBe(0);
    expect(position.backorderedUnits).toBe(0);
    expect(position.cumulativeSoldUnits).toBe(2);

    const truth = finalizeInventoryGodMode(state);
    expect(
      truth.reconciliation.find(
        (row) => row.skuId === skuId,
      )?.reconcilesExactly,
    ).toBe(true);
  });

  it("moves physical returns through quarantine, damage and delayed restock without creating stock", () => {
    const world = generateMerchantWorldRecord({
      seed: 190004,
      archetype: "fashion_apparel",
      scale: "small",
      complexity: "normal",
      inventoryProfile: "deep",
    });
    const skuId =
      world.manifest.inventoryMechanisms[0]!.productId;
    const startMs =
      Date.parse("2026-01-01T00:00:00.000Z");
    const state =
      createInventoryEconomyState(world, startMs);
    const opening =
      state.positions.get(skuId)!.onHandUnits;

    recordReturnReceived(
      state,
      skuId,
      2,
      startMs + 86_400_000,
      "return-received",
    );
    let position = state.positions.get(skuId)!;
    expect(position.onHandUnits).toBe(opening + 2);
    expect(position.quarantinedReturnUnits).toBe(2);

    damageReturnedInventory(
      state,
      skuId,
      1,
      startMs + 86_400_000,
      "return-inspection",
    );
    restockReturnedInventory(
      state,
      skuId,
      1,
      startMs + 2 * 86_400_000,
      "return-restock",
    );

    position = state.positions.get(skuId)!;
    expect(position.quarantinedReturnUnits).toBe(0);
    expect(position.damagedUnits).toBe(1);

    writeOffDamagedInventory(
      state,
      skuId,
      1,
      startMs + 3 * 86_400_000,
      "damage-writeoff",
    );

    const truth = finalizeInventoryGodMode(state);
    const reconciliation =
      truth.reconciliation.find(
        (row) => row.skuId === skuId,
      )!;
    expect(reconciliation.returnedUnits).toBe(2);
    expect(reconciliation.writtenOffUnits).toBe(1);
    expect(reconciliation.actualClosingOnHandUnits).toBe(
      opening + 1,
    );
    expect(reconciliation.reconcilesExactly).toBe(true);
  });

  it("converts reserved inventory into committed and sold stock exactly", () => {
    const world = generateMerchantWorldRecord({
      seed: 190003,
      archetype: "specialty_retail",
      scale: "small",
      complexity: "normal",
      inventoryProfile: "deep",
    });
    const skuId =
      world.manifest.inventoryMechanisms[0]!.productId;
    const startMs =
      Date.parse("2026-01-01T00:00:00.000Z");
    const state =
      createInventoryEconomyState(world, startMs);
    const openingPosition =
      state.positions.get(skuId)!;
    const opening =
      openingPosition.onHandUnits;
    const openingReserved =
      openingPosition.reservedUnits;

    reserveInventory(state, {
      reservationId: "r1",
      skuId,
      customerId: "c1",
      requestedUnits: 1,
      timestampMs: startMs + 1_000,
      expiresAtMs: startMs + 1_200_000,
      sourceEventId: "checkout-1",
    });

    const sold = commitAndSellReservations(
      state,
      "checkout-1",
      skuId,
      1,
      startMs + 2_000,
    );

    expect(sold).toBe(1);
    const position = state.positions.get(skuId)!;
    expect(position.onHandUnits).toBe(opening - 1);
    expect(position.reservedUnits).toBe(
      openingReserved,
    );
    expect(position.committedUnits).toBe(0);
    expect(position.cumulativeSoldUnits).toBe(1);

    expect(
      finalizeInventoryGodMode(state)
        .reconciliation.find(
          (row) => row.skuId === skuId,
        )?.reconcilesExactly,
    ).toBe(true);
  });
});
