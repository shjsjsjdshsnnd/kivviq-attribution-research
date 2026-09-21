import { validateLatentCustomerPopulation } from "../customer_population/validation.js";
import type { MarketingChannel } from "../generation/config.js";
import { compileCrossChannelNetwork } from "../cross_channel/network.js";
import {
  applyPreparedInteraction,
  checkoutInteractionLift,
  conditionalResponseMultiplier,
  opportunityModifiers,
  paidExposureOpportunityMultiplier,
  prepareExposureInteractions,
} from "../cross_channel/runtime.js";
import type { InteractionCausalTruth } from "../cross_channel/types.js";
import type { Intervention } from "../ground_truth/interventions.js";
import {
  checkoutPurchaseProbability,
  completePurchase,
  markCartInventoryDemandAbandoned,
  promotionState,
  reserveCheckoutInventory,
} from "./commerce.js";
import {
  damageReturnedInventory,
  dispatchReorder,
  finalizeInventoryGodMode,
  legacyNetAvailableUnits,
  markReorderDelayed,
  placeReorder,
  receiveInventory,
  recordInventoryReturnTruth,
  recordReturnReceived,
  releaseReservation,
  reorderQuantity,
  restockReturnedInventory,
  setAvailableInventoryAdjustment,
  shouldReorder,
} from "../inventory_dynamics/state.js";
import {
  applyExposureLatentEffect,
  naturalVisitOpportunities,
  paidExposureProbability,
  recordMarketingExposure,
} from "./channels.js";
import {
  buildSimulationInterventionState,
} from "./interventions.js";
import {
  days,
  hours,
  SharedRandomness,
  SimulationClock,
  SimulationEventQueue,
  WORLD_SIMULATOR_VERSION,
  type SimulationEvent,
} from "./kernel.js";
import {
  createRuntimeWorldState,
  markNeedFormation,
  refreshLatentCustomerState,
  transitionLifecycleForInactivity,
  recordSiteVisitForFutureAudience,
  type RuntimeCustomerState,
} from "./state.js";
import {
  advanceSession,
  startSession,
  type RuntimeSession,
} from "./session.js";
import type {
  ExposureCausalTruth,
  PerfectObservableJourneyEvent,
  PlatformStyleChannelMetric,
  PurchaseCausalTruth,
  RealizedPurchase,
  SimulateWorldRequest,
  SimulationResult,
  ObservableSource,
} from "./types.js";

interface NeedPayload {
  readonly cycle: number;
  readonly repeat: boolean;
}

interface OpportunityPayload {
  readonly cycle: number;
  readonly ordinal: number;
}

interface ExposurePayload {
  readonly channel: MarketingChannel;
  readonly ordinal: number;
}

interface LatentEffectPayload {
  readonly channel: MarketingChannel;
  readonly exposureEventId: string;
  readonly effect: {
    readonly awarenessLift: number;
    readonly considerationLift: number;
    readonly purchaseProbabilityLift: number;
    readonly productPreferenceLift: number;
    readonly halfLifeMs: number;
  };
}

interface InteractionEffectPayload {
  readonly truth: InteractionCausalTruth;
}

interface VisitPayload {
  readonly source: ObservableSource;
  readonly reason: "natural" | "causal_exposure" | "return";
}

interface SessionStepPayload {
  readonly sessionId: string;
}

interface LifecyclePayload {
  readonly ordinal: number;
}

interface InventoryReplenishmentPayload {
  readonly productId: string;
  readonly units: number;
  readonly cadenceMs?: number;
  readonly ordinal: number;
  readonly reorderId?: string;
}

interface InventoryReservationExpiryPayload {
  readonly reservationId: string;
  readonly productId: string;
}

interface InventoryReorderCheckPayload {
  readonly productId: string;
  readonly ordinal: number;
}

interface SupplierShipmentPayload {
  readonly reorderId: string;
  readonly productId: string;
}

interface InventoryReturnReceivedPayload {
  readonly returnId: string;
  readonly orderId: string;
  readonly customerId: string;
  readonly productId: string;
  readonly returnedUnits: number;
  readonly damagedUnits: number;
  readonly restockAtMs: number;
}

interface InventoryReturnRestockedPayload {
  readonly returnId: string;
  readonly productId: string;
  readonly sellableUnits: number;
}

const DEFAULT_MAX_EVENTS = 500_000;
const DEFAULT_MAX_SESSION_STEPS = 18;
const DEFAULT_MAX_SESSIONS_PER_CUSTOMER = 24;
const DEFAULT_OPPORTUNITY_CADENCE_HOURS = 12;
const DEFAULT_LIFECYCLE_CHECK_DAYS = 30;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function monthKey(timestampMs: number): string {
  return [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ][new Date(timestampMs).getUTCMonth()]!;
}

function weekdayKey(timestampMs: number): string {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(timestampMs).getUTCDay()
  ]!;
}

function seasonalityMultiplier(
  request: SimulateWorldRequest,
  timestampMs: number,
): number {
  let multiplier = 1;
  for (const mechanism of request.merchantWorld.manifest.seasonality) {
    if (mechanism.kind === "month") {
      const entry = mechanism.multipliers.find(
        (item) => item.key === monthKey(timestampMs),
      );
      if (entry) multiplier *= Number(entry.multiplier);
    } else if (mechanism.kind === "weekday") {
      const entry = mechanism.multipliers.find(
        (item) => item.key === weekdayKey(timestampMs),
      );
      if (entry) multiplier *= Number(entry.multiplier);
    }
  }
  return clamp(multiplier, 0.15, 4);
}

function shockDemandMultiplier(
  request: SimulateWorldRequest,
  timestampMs: number,
): number {
  let multiplier = 1;
  for (const shock of request.merchantWorld.manifest.externalShocks) {
    const start = Date.parse(shock.start);
    const end =
      start + Number(shock.durationSeconds) * 1_000;
    if (timestampMs < start || timestampMs >= end) continue;
    if (
      !shock.affectedVariables.includes("demand.product_units") &&
      !shock.affectedVariables.includes("commerce.orders") &&
      !shock.affectedVariables.includes("funnel.purchase_probability")
    ) {
      continue;
    }

    const effect = shock.mechanism.effect;
    if (effect.scale === "relative") {
      multiplier *= 1 + effect.value;
    } else if (effect.scale === "multiplicative") {
      multiplier *= effect.value;
    } else if (effect.scale === "absolute") {
      multiplier *= 1 + effect.value * 0.01;
    }
  }
  return clamp(multiplier, 0.05, 6);
}

function needStrength(
  request: SimulateWorldRequest,
  customer: RuntimeCustomerState,
  timestampMs: number,
  randomness: SharedRandomness,
  cycle: number,
): number {
  const seasonal = seasonalityMultiplier(request, timestampMs);
  const shock = shockDemandMultiplier(request, timestampMs);
  const lifecycleMultiplier =
    customer.lifecycle === "dormant"
      ? 0.65
      : customer.lifecycle === "churned"
        ? 0.15
        : customer.lifecycle === "repeat_customer" ||
            customer.lifecycle === "subscriber"
          ? 1.16
          : 1;

  return clamp(
    (0.18 +
      customer.source.currentPurchaseNeed * 0.45 +
      customer.source.purchaseIntent * 0.2 +
      randomness.normal(
        `${customer.customerId}:need:${cycle}:noise`,
        0,
        0.12,
      )) *
      seasonal *
      shock *
      lifecycleMultiplier,
    0.02,
    1,
  );
}

function nextNeedDelayMs(
  customer: RuntimeCustomerState,
  randomness: SharedRandomness,
  cycle: number,
): number {
  const annualHazard = Math.max(
    0.05,
    customer.source.annualPurchaseHazard,
  );
  const ratePerMs =
    annualHazard / (365 * 86_400_000);

  const exponential = randomness.exponential(
    `${customer.customerId}:next-need:${cycle}`,
    ratePerMs,
  );

  const intervalAnchor = days(
    Math.max(4, customer.source.expectedPurchaseIntervalDays),
  );
  const blended =
    exponential * 0.55 +
    intervalAnchor *
      Math.exp(
        randomness.normal(
          `${customer.customerId}:need-interval:${cycle}`,
          0,
          0.32,
        ),
      ) *
      0.45;

  return Math.max(hours(6), blended);
}

function searchIntent(
  customer: RuntimeCustomerState,
  randomness: SharedRandomness,
  key: string,
  brandedSearchMultiplier = 1,
): "branded" | "category" | "product" {
  return randomness.weightedPick(key, [
    {
      value: "branded" as const,
      weight:
        (0.2 + customer.brandAffinity * 0.8) *
        Math.max(0.1, brandedSearchMultiplier),
    },
    {
      value: "category" as const,
      weight: 0.45 + customer.need * 0.35,
    },
    {
      value: "product" as const,
      weight: 0.3 + customer.intent * 0.6,
    },
  ]);
}

function observablePathForPurchase(
  observableEvents: readonly PerfectObservableJourneyEvent[],
  purchase: RealizedPurchase,
): readonly ObservableSource[] {
  const purchaseMs = Date.parse(purchase.occurredAt);
  const lookback = days(30);
  const sources = observableEvents
    .filter(
      (event) =>
        event.anonymousSubjectId === purchase.customerId &&
        event.source !== undefined &&
        Date.parse(event.occurredAt) <= purchaseMs &&
        Date.parse(event.occurredAt) >= purchaseMs - lookback &&
        event.eventType !== "session_end",
    )
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) -
        Date.parse(right.occurredAt),
    )
    .map((event) => event.source!);

  const compact: ObservableSource[] = [];
  for (const source of sources) {
    if (compact[compact.length - 1] !== source) {
      compact.push(source);
    }
  }
  return compact;
}

function purchaseTruthFor(
  observableEvents: readonly PerfectObservableJourneyEvent[],
  exposureTruth: readonly ExposureCausalTruth[],
  purchase: RealizedPurchase,
): PurchaseCausalTruth {
  const purchaseMs = Date.parse(purchase.occurredAt);
  const lookback = days(30);
  const relevant = exposureTruth.filter(
    (truth) =>
      truth.customerId === purchase.customerId &&
      Date.parse(truth.occurredAt) <= purchaseMs &&
      Date.parse(truth.occurredAt) >= purchaseMs - lookback,
  );

  return {
    orderId: purchase.orderId,
    customerId: purchase.customerId,
    observablePath: observablePathForPurchase(
      observableEvents,
      purchase,
    ),
    causalChannels: [
      ...new Set(
        relevant
          .filter((truth) => truth.appliedEffect !== 0)
          .map((truth) => truth.channelId),
      ),
    ],
    zeroEffectExposures: [
      ...new Set(
        relevant
          .filter((truth) => truth.appliedEffect === 0)
          .map((truth) => truth.channelId),
      ),
    ],
    purchaseProbabilityLiftAtPurchase: relevant.reduce(
      (sum, truth) =>
        sum +
        (truth.effectKinds.includes("purchase_probability")
          ? truth.appliedEffect
          : 0),
      0,
    ),
  };
}

function buildPlatformMetrics(
  request: SimulateWorldRequest,
  observableEvents: readonly PerfectObservableJourneyEvent[],
  purchases: readonly RealizedPurchase[],
): readonly PlatformStyleChannelMetric[] {
  const weightByCustomer = new Map(
    request.latentPopulation.customers.map(
      (customer) => [customer.customerId, customer.populationWeight] as const,
    ),
  );
  const sources = new Set<ObservableSource>();

  for (const event of observableEvents) {
    if (event.source) sources.add(event.source);
  }

  const purchaseAttributed = new Map<
    ObservableSource,
    { purchases: number; revenue: number }
  >();

  for (const purchase of purchases) {
    const purchaseMs = Date.parse(purchase.occurredAt);
    const lastTouch = [...observableEvents]
      .filter(
        (event) =>
          event.anonymousSubjectId === purchase.customerId &&
          event.source !== undefined &&
          Date.parse(event.occurredAt) <= purchaseMs &&
          event.eventType !== "purchase" &&
          event.eventType !== "session_end",
      )
      .sort(
        (left, right) =>
          Date.parse(right.occurredAt) -
          Date.parse(left.occurredAt),
      )[0];

    if (!lastTouch?.source) continue;
    sources.add(lastTouch.source);
    const weight = weightByCustomer.get(purchase.customerId) ?? 1;
    const current =
      purchaseAttributed.get(lastTouch.source) ??
      { purchases: 0, revenue: 0 };
    current.purchases += weight;
    current.revenue += purchase.netRevenueMinor * weight;
    purchaseAttributed.set(lastTouch.source, current);
  }

  return [...sources]
    .sort()
    .map((source) => {
      let exposures = 0;
      let sessions = 0;
      const touchedCustomers = new Set<string>();

      for (const event of observableEvents) {
        if (event.source !== source) continue;
        const weight =
          weightByCustomer.get(event.anonymousSubjectId) ?? 1;
        if (
          event.eventType === "impression" ||
          event.eventType === "email_open" ||
          event.eventType === "sms_open" ||
          event.eventType === "search"
        ) {
          exposures += weight;
          touchedCustomers.add(event.anonymousSubjectId);
        }
        if (event.eventType === "session_start") {
          sessions += weight;
          touchedCustomers.add(event.anonymousSubjectId);
        }
      }

      const attributed =
        purchaseAttributed.get(source) ??
        { purchases: 0, revenue: 0 };
      const denominator = Math.max(
        1,
        exposures > 0 ? exposures : sessions,
      );

      return {
        channel: source,
        exposures,
        sessions,
        purchases: attributed.purchases,
        attributedRevenueMinor: attributed.revenue,
        observedPurchaseRateAfterTouch:
          attributed.purchases / denominator,
      };
    });
}

function inventoryAvailabilityRatio(
  runtime: ReturnType<typeof createRuntimeWorldState>,
): number {
  let current = 0;
  let initial = 0;
  for (const [productId, starting] of runtime.initialInventory.entries()) {
    initial += Math.max(0, starting);
    current += Math.max(0, runtime.inventory.get(productId) ?? 0);
  }
  return initial > 0 ? clamp(current / initial, 0, 1) : 1;
}

function applyInventoryOverride(
  request: SimulateWorldRequest,
  timestampMs: number,
  runtime: ReturnType<typeof createRuntimeWorldState>,
): void {
  const state = buildSimulationInterventionState(
    request.merchantWorld,
    request.interventions ?? [],
    timestampMs,
  );
  if (state.inventoryOverrideUnits === undefined) return;
  for (const productId of runtime.inventory.keys()) {
    if (request.commercePolicy?.enableInventoryDynamics === true) {
      setAvailableInventoryAdjustment(
        runtime.inventoryEconomy,
        productId,
        state.inventoryOverrideUnits,
        timestampMs,
        "inventory-intervention",
      );
      runtime.inventory.set(
        productId,
        legacyNetAvailableUnits(
          runtime.inventoryEconomy,
          productId,
        ),
      );
    } else {
      runtime.inventory.set(
        productId,
        state.inventoryOverrideUnits,
      );
    }
  }
}

function physicalReturnQuantity(
  quantity: number,
  probability: number,
  randomness: SharedRandomness,
  key: string,
): number {
  let returned = 0;
  for (let unit = 0; unit < quantity; unit += 1) {
    if (
      randomness.bool(
        `${key}:unit:${unit}`,
        clamp(probability, 0, 0.75),
      )
    ) {
      returned += 1;
    }
  }
  return returned;
}

function damagedReturnQuantity(
  quantity: number,
  probability: number,
  randomness: SharedRandomness,
  key: string,
): number {
  let damaged = 0;
  for (let unit = 0; unit < quantity; unit += 1) {
    if (
      randomness.bool(
        `${key}:damage:${unit}`,
        clamp(probability, 0, 1),
      )
    ) {
      damaged += 1;
    }
  }
  return damaged;
}

function realizedSupplierLeadMs(
  request: SimulateWorldRequest,
  productId: string,
  expectedLeadMs: number,
  placedAtMs: number,
  randomness: SharedRandomness,
): number {
  const inventory = request.merchantWorld.manifest.inventoryMechanisms.find(
    (candidate) => candidate.productId === productId,
  );
  const profile = request.merchantWorld.summary.inventoryProfile;
  const volatility =
    profile === "long_lead_time"
      ? 0.32
      : profile === "stockout_prone"
        ? 0.26
        : profile === "replenishment_friendly"
          ? 0.1
          : 0.18;
  let factor = Math.max(
    0.55,
    1 +
      randomness.normal(
        `inventory-lead:${productId}:${placedAtMs}`,
        0,
        volatility,
      ),
  );

  for (const shock of request.merchantWorld.manifest.externalShocks) {
    if (shock.kind !== "supplier_disruption") continue;
    const start = Date.parse(shock.start);
    const end =
      start + Number(shock.durationSeconds) * 1_000;
    if (placedAtMs < start || placedAtMs >= end) continue;
    const effect = shock.mechanism.effect;
    if (effect.scale === "relative") {
      factor *= Math.max(0.1, 1 + effect.value);
    } else if (effect.scale === "multiplicative") {
      factor *= Math.max(0.1, effect.value);
    }
  }

  const declared =
    Number(inventory?.supplierLeadTimeSeconds ?? 0) * 1_000;
  const baseline = Math.max(expectedLeadMs, declared);
  return Math.max(hours(1), baseline * factor);
}

export function simulateWorld(
  request: SimulateWorldRequest,
): SimulationResult {
  validateLatentCustomerPopulation(
    request.latentPopulation,
    request.merchantWorld,
  );

  const clock = new SimulationClock({
    startTime: request.startTime,
    endTime: request.endTime,
  });
  const randomness = new SharedRandomness(
    request.simulationSeed,
    `${WORLD_SIMULATOR_VERSION}:${request.merchantWorld.manifest.worldId}`,
  );
  const queue = new SimulationEventQueue();
  const runtime = createRuntimeWorldState(
    request.merchantWorld,
    request.latentPopulation,
    clock.startMs,
  );
  const interactionNetwork = compileCrossChannelNetwork(
    request.merchantWorld,
  );

  applyInventoryOverride(request, clock.startMs, runtime);

  const observableEvents: PerfectObservableJourneyEvent[] = [];
  const exposureTruth: ExposureCausalTruth[] = [];
  const interactionTruth: InteractionCausalTruth[] = [];
  const purchases: RealizedPurchase[] = [];
  const sessions = new Map<string, RuntimeSession>();
  const sessionCount = new Map<string, number>();
  const opportunityCount = new Map<string, number>();
  const purchaseCount = new Map<string, number>();

  const maxEvents =
    request.config?.maxEvents ?? DEFAULT_MAX_EVENTS;
  const maxSessionSteps =
    request.config?.maxStepsPerSession ??
    DEFAULT_MAX_SESSION_STEPS;
  const maxSessions =
    request.config?.maxSessionsPerCustomer ??
    DEFAULT_MAX_SESSIONS_PER_CUSTOMER;
  const opportunityCadenceMs = hours(
    request.config?.opportunityCadenceHours ??
      DEFAULT_OPPORTUNITY_CADENCE_HOURS,
  );
  const lifecycleCadenceMs = days(
    request.config?.lifecycleCheckDays ??
      DEFAULT_LIFECYCLE_CHECK_DAYS,
  );

  let scheduledCounter = 0;
  const schedule = <T>(
    event: Omit<SimulationEvent<T>, "sequence">,
  ): void => {
    if (!clock.contains(event.timestampMs)) return;
    queue.schedule(event);
  };

  if (request.commercePolicy?.executeInventoryLifecycle === true) {
    if (request.commercePolicy.enableInventoryDynamics === true) {
      for (const inventory of request.merchantWorld.manifest.inventoryMechanisms) {
        schedule<InventoryReorderCheckPayload>({
          id: `inventory-reorder-check:${inventory.productId}:0`,
          kind: "inventory_reorder_check",
          timestampMs: clock.startMs,
          priority: 4,
          payload: {
            productId: inventory.productId,
            ordinal: 0,
          },
        });
      }
    } else {
      // Frozen Step 7 replenishment behavior remains unchanged unless the
      // explicit Step 9 feature flag is enabled.
      for (const inventory of request.merchantWorld.manifest.inventoryMechanisms) {
        const units = Math.max(
          0,
          Math.floor(Number(inventory.replenishmentUnits)),
        );
        if (units <= 0) continue;

        const leadMs =
          Number(inventory.supplierLeadTimeSeconds) * 1_000;
        const cadenceMs =
          inventory.replenishmentEverySeconds === undefined
            ? undefined
            : Number(inventory.replenishmentEverySeconds) * 1_000;

        schedule<InventoryReplenishmentPayload>({
          id: `inventory-replenishment:${inventory.productId}:0`,
          kind: "inventory_replenishment",
          timestampMs: clock.startMs + Math.max(0, leadMs),
          priority: 5,
          payload: {
            productId: inventory.productId,
            units,
            ...(cadenceMs === undefined ? {} : { cadenceMs }),
            ordinal: 0,
          },
        });
      }
    }
  }

  for (const customer of runtime.customers.values()) {
    const initialDelay =
      customer.need > 0.45
        ? randomness.uniform(
            `${customer.customerId}:initial-need-delay`,
          ) *
          hours(18)
        : nextNeedDelayMs(
            customer,
            randomness,
            0,
          );

    schedule<NeedPayload>({
      id: `need:${customer.customerId}:0`,
      kind: "need_formation",
      timestampMs: clock.startMs + initialDelay,
      priority: 10,
      customerId: customer.customerId,
      payload: { cycle: 0, repeat: false },
    });

    schedule<LifecyclePayload>({
      id: `lifecycle:${customer.customerId}:0`,
      kind: "lifecycle_check",
      timestampMs: clock.startMs + lifecycleCadenceMs,
      priority: 90,
      customerId: customer.customerId,
      payload: { ordinal: 0 },
    });
  }

  while (queue.size > 0) {
    if (scheduledCounter++ >= maxEvents) {
      throw new RangeError(
        `simulation exceeded maxEvents=${maxEvents}`,
      );
    }

    const event = queue.pop()!;
    if (!clock.contains(event.timestampMs)) continue;
    clock.advanceTo(event.timestampMs);

    if (event.kind === "inventory_reservation_expired") {
      const payload =
        event.payload as InventoryReservationExpiryPayload;
      if (request.commercePolicy?.enableInventoryDynamics === true) {
        releaseReservation(
          runtime.inventoryEconomy,
          payload.reservationId,
          event.timestampMs,
          event.id,
        );
        runtime.inventory.set(
          payload.productId,
          legacyNetAvailableUnits(
            runtime.inventoryEconomy,
            payload.productId,
          ),
        );
      }
      continue;
    }

    if (event.kind === "inventory_reorder_check") {
      const payload =
        event.payload as InventoryReorderCheckPayload;
      if (
        request.commercePolicy?.enableInventoryDynamics === true &&
        request.commercePolicy.executeInventoryLifecycle === true
      ) {
        const position =
          runtime.inventoryEconomy.positions.get(
            payload.productId,
          );
        const interventionState =
          buildSimulationInterventionState(
            request.merchantWorld,
            request.interventions ?? [],
            event.timestampMs,
          );

        if (
          position &&
          interventionState.inventoryOverrideUnits === undefined &&
          shouldReorder(position)
        ) {
          const units = reorderQuantity(position);
          if (units > 0) {
            const expectedLeadMs = Math.max(
              hours(1),
              position.supplierLeadTimeDays * 86_400_000,
            );
            const realizedLeadMs = realizedSupplierLeadMs(
              request,
              payload.productId,
              expectedLeadMs,
              event.timestampMs,
              randomness,
            );
            const expectedArrivalAtMs =
              event.timestampMs + expectedLeadMs;
            const realizedArrivalAtMs =
              event.timestampMs + realizedLeadMs;
            const reorderId =
              `reorder:${payload.productId}:${payload.ordinal}`;

            const reorder = placeReorder(
              runtime.inventoryEconomy,
              {
                reorderId,
                skuId: payload.productId,
                quantity: units,
                placedAtMs: event.timestampMs,
                expectedArrivalAtMs,
                realizedArrivalAtMs,
                sourceEventId: event.id,
              },
            );

            if (reorder) {
              const dispatchAt = Math.min(
                realizedArrivalAtMs,
                event.timestampMs +
                  Math.max(hours(1), expectedLeadMs * 0.12),
              );
              schedule<SupplierShipmentPayload>({
                id: `supplier-shipment-dispatched:${reorderId}`,
                kind: "supplier_shipment_dispatched",
                timestampMs: dispatchAt,
                priority: 5,
                payload: {
                  reorderId,
                  productId: payload.productId,
                },
              });

              if (realizedArrivalAtMs > expectedArrivalAtMs) {
                schedule<SupplierShipmentPayload>({
                  id: `supplier-shipment-delayed:${reorderId}`,
                  kind: "supplier_shipment_delayed",
                  timestampMs: expectedArrivalAtMs,
                  priority: 5,
                  payload: {
                    reorderId,
                    productId: payload.productId,
                  },
                });
              }

              schedule<InventoryReplenishmentPayload>({
                id: `inventory-replenishment:${reorderId}`,
                kind: "inventory_replenishment",
                timestampMs: realizedArrivalAtMs,
                priority: 5,
                payload: {
                  productId: payload.productId,
                  units,
                  ordinal: payload.ordinal,
                  reorderId,
                },
              });
            }
          }
        }

        schedule<InventoryReorderCheckPayload>({
          id: `inventory-reorder-check:${payload.productId}:${payload.ordinal + 1}`,
          kind: "inventory_reorder_check",
          timestampMs: event.timestampMs + days(1),
          priority: 4,
          payload: {
            productId: payload.productId,
            ordinal: payload.ordinal + 1,
          },
        });
      }
      continue;
    }

    if (event.kind === "supplier_shipment_dispatched") {
      const payload =
        event.payload as SupplierShipmentPayload;
      if (request.commercePolicy?.enableInventoryDynamics === true) {
        dispatchReorder(
          runtime.inventoryEconomy,
          payload.reorderId,
          event.timestampMs,
          event.id,
        );
      }
      continue;
    }

    if (event.kind === "supplier_shipment_delayed") {
      const payload =
        event.payload as SupplierShipmentPayload;
      if (request.commercePolicy?.enableInventoryDynamics === true) {
        markReorderDelayed(
          runtime.inventoryEconomy,
          payload.reorderId,
          event.timestampMs,
          event.id,
        );
      }
      continue;
    }

    if (event.kind === "inventory_replenishment") {
      const payload =
        event.payload as InventoryReplenishmentPayload;
      const interventionState =
        buildSimulationInterventionState(
          request.merchantWorld,
          request.interventions ?? [],
          event.timestampMs,
        );

      if (request.commercePolicy?.enableInventoryDynamics === true) {
        if (interventionState.inventoryOverrideUnits !== undefined) {
          setAvailableInventoryAdjustment(
            runtime.inventoryEconomy,
            payload.productId,
            interventionState.inventoryOverrideUnits,
            event.timestampMs,
            event.id,
          );
        } else {
          receiveInventory(
            runtime.inventoryEconomy,
            payload.productId,
            payload.units,
            event.timestampMs,
            event.id,
          );
          if (payload.reorderId !== undefined) {
            const reorder =
              runtime.inventoryEconomy.reorders.get(
                payload.reorderId,
              );
            if (reorder) {
              reorder.receivedUnits = Math.min(
                reorder.quantity,
                reorder.receivedUnits + payload.units,
              );
            }
          }
        }
        runtime.inventory.set(
          payload.productId,
          legacyNetAvailableUnits(
            runtime.inventoryEconomy,
            payload.productId,
          ),
        );
      } else {
        if (interventionState.inventoryOverrideUnits !== undefined) {
          runtime.inventory.set(
            payload.productId,
            interventionState.inventoryOverrideUnits,
          );
        } else {
          runtime.inventory.set(
            payload.productId,
            (runtime.inventory.get(payload.productId) ?? 0) +
              payload.units,
          );
        }

        if (payload.cadenceMs !== undefined) {
          schedule<InventoryReplenishmentPayload>({
            id: `inventory-replenishment:${payload.productId}:${payload.ordinal + 1}`,
            kind: "inventory_replenishment",
            timestampMs:
              event.timestampMs + payload.cadenceMs,
            priority: 5,
            payload: {
              productId: payload.productId,
              units: payload.units,
              cadenceMs: payload.cadenceMs,
              ordinal: payload.ordinal + 1,
            },
          });
        }
      }
      continue;
    }

    if (!event.customerId) continue;
    const customer = runtime.customers.get(event.customerId);
    if (!customer || customer.churned) continue;

    if (event.kind === "need_formation" || event.kind === "repeat_need") {
      const payload = event.payload as NeedPayload;
      const strength = needStrength(
        request,
        customer,
        event.timestampMs,
        randomness,
        payload.cycle,
      );

      if (event.timestampMs >= customer.nextNeedEligibleMs) {
        markNeedFormation(
          customer,
          strength,
          event.timestampMs,
        );

        schedule<OpportunityPayload>({
          id: `opportunity:${customer.customerId}:${payload.cycle}:0`,
          kind: "channel_opportunity",
          timestampMs:
            event.timestampMs +
            randomness.integer(
              `${customer.customerId}:opportunity-delay:${payload.cycle}`,
              30_000,
              30 * 60_000,
            ),
          priority: 20,
          customerId: customer.customerId,
          payload: { cycle: payload.cycle, ordinal: 0 },
        });
      }

      const nextCycle = payload.cycle + 1;
      const nextNeedMs =
        event.timestampMs +
        nextNeedDelayMs(
          customer,
          randomness,
          nextCycle,
        );

      schedule<NeedPayload>({
        id: `need:${customer.customerId}:${nextCycle}`,
        kind: payload.repeat ? "repeat_need" : "need_formation",
        timestampMs: nextNeedMs,
        priority: 10,
        customerId: customer.customerId,
        payload: {
          cycle: nextCycle,
          repeat: customer.purchaseCount > 0,
        },
      });
      continue;
    }

    if (event.kind === "channel_opportunity") {
      const payload = event.payload as OpportunityPayload;
      refreshLatentCustomerState(
        customer,
        event.timestampMs,
      );

      const interventionState =
        buildSimulationInterventionState(
          request.merchantWorld,
          request.interventions ?? [],
          event.timestampMs,
        );
      const promotion = promotionState(
        request.merchantWorld,
        interventionState,
        event.timestampMs,
        randomness,
      );
      const interactionContext = {
        timestampMs: event.timestampMs,
        promotionActive: promotion.active,
        inventoryAvailabilityRatio:
          inventoryAvailabilityRatio(runtime),
        interventionState,
      };
      const crossModifiers = opportunityModifiers(
        interactionNetwork,
        customer,
        interactionContext,
      );

      const ordinal =
        opportunityCount.get(customer.customerId) ?? 0;
      opportunityCount.set(customer.customerId, ordinal + 1);

      const natural = naturalVisitOpportunities(
        customer,
        crossModifiers,
      );
      for (const opportunity of natural) {
        const key = `${customer.customerId}:natural:${payload.cycle}:${payload.ordinal}:${opportunity.source}`;
        if (
          !randomness.bool(key, opportunity.probability)
        ) {
          continue;
        }

        if (
          opportunity.source === "google_search" ||
          opportunity.source === "google_shopping" ||
          opportunity.source === "organic_search"
        ) {
          observableEvents.push({
            eventId: `search:${customer.customerId}:${payload.cycle}:${payload.ordinal}:${opportunity.source}`,
            eventType: "search",
            occurredAt: new Date(event.timestampMs).toISOString(),
            anonymousSubjectId: customer.customerId,
            source: opportunity.source,
            ...(opportunity.channel === undefined
              ? {}
              : { channel: opportunity.channel }),
            searchIntent: searchIntent(
              customer,
              randomness,
              `${key}:intent`,
              crossModifiers.brandedSearchMultiplier,
            ),
          });
        } else if (
          opportunity.source === "email" ||
          opportunity.source === "sms"
        ) {
          observableEvents.push({
            eventId: `owned-open:${customer.customerId}:${payload.cycle}:${payload.ordinal}:${opportunity.source}`,
            eventType:
              opportunity.source === "email"
                ? "email_open"
                : "sms_open",
            occurredAt: new Date(event.timestampMs).toISOString(),
            anonymousSubjectId: customer.customerId,
            source: opportunity.source,
            channel: opportunity.source,
          });
        }

        schedule<VisitPayload>({
          id: `natural-visit:${customer.customerId}:${payload.cycle}:${payload.ordinal}:${opportunity.source}`,
          kind: "visit",
          timestampMs:
            event.timestampMs +
            randomness.integer(
              `${key}:visit-delay`,
              5_000,
              45 * 60_000,
            ),
          priority: 35,
          customerId: customer.customerId,
          payload: {
            source: opportunity.source,
            reason: "natural",
          },
        });
      }

      for (const channel of request.merchantWorld.summary.activeChannels) {
        const exposureProbability =
          paidExposureProbability(
            request.merchantWorld,
            customer,
            channel,
            interventionState,
            paidExposureOpportunityMultiplier(
              interactionNetwork,
              customer,
              channel,
              interactionContext,
            ),
          );

        const exposureKey = `${customer.customerId}:exposure:${payload.cycle}:${payload.ordinal}:${channel}`;
        if (
          !randomness.bool(
            exposureKey,
            exposureProbability,
          )
        ) {
          continue;
        }

        schedule<ExposurePayload>({
          id: `marketing-exposure:${customer.customerId}:${payload.cycle}:${payload.ordinal}:${channel}`,
          kind: "marketing_exposure",
          timestampMs: event.timestampMs,
          priority: 25,
          customerId: customer.customerId,
          payload: { channel, ordinal },
        });
      }

      if (
        payload.ordinal < 12 &&
        customer.need > 0.08 &&
        !customer.churned
      ) {
        schedule<OpportunityPayload>({
          id: `opportunity:${customer.customerId}:${payload.cycle}:${payload.ordinal + 1}`,
          kind: "channel_opportunity",
          timestampMs:
            event.timestampMs + opportunityCadenceMs,
          priority: 20,
          customerId: customer.customerId,
          payload: {
            cycle: payload.cycle,
            ordinal: payload.ordinal + 1,
          },
        });
      }
      continue;
    }

    if (event.kind === "marketing_exposure") {
      const payload = event.payload as ExposurePayload;
      const interventionState =
        buildSimulationInterventionState(
          request.merchantWorld,
          request.interventions ?? [],
          event.timestampMs,
        );

      const promotion = promotionState(
        request.merchantWorld,
        interventionState,
        event.timestampMs,
        randomness,
      );
      const interactionContext = {
        timestampMs: event.timestampMs,
        promotionActive: promotion.active,
        inventoryAvailabilityRatio:
          inventoryAvailabilityRatio(runtime),
        interventionState,
      };
      const responseMultiplier =
        conditionalResponseMultiplier(
          interactionNetwork,
          customer,
          payload.channel,
          interactionContext,
        );

      const recorded = recordMarketingExposure(
        request.merchantWorld,
        customer,
        payload.channel,
        event.timestampMs,
        event.id,
        randomness,
        interventionState,
        responseMultiplier,
      );

      observableEvents.push(recorded.observableEvent);
      exposureTruth.push(recorded.truth);

      const preparedInteractions =
        prepareExposureInteractions(
          interactionNetwork,
          customer,
          payload.channel,
          interactionContext,
        );
      for (const prepared of preparedInteractions) {
        schedule<InteractionEffectPayload>({
          id: `interaction-effect:${prepared.truth.mechanismId}:${event.id}`,
          kind: "interaction_effect",
          timestampMs: prepared.applyAtMs,
          priority: 31,
          customerId: customer.customerId,
          payload: { truth: prepared.truth },
        });
      }

      schedule<LatentEffectPayload>({
        id: `latent-effect:${event.id}`,
        kind: "latent_effect",
        timestampMs: recorded.applyAtMs,
        priority: 30,
        customerId: customer.customerId,
        payload: {
          channel: payload.channel,
          exposureEventId: event.id,
          effect: recorded.latentEffect,
        },
      });

      // Exposure can create an additional visit only through non-zero causal
      // response. Natural visits are scheduled independently above.
      if (recorded.truth.appliedEffect > 0) {
        const visitProbability = clamp(
          recorded.truth.appliedEffect * 1.6,
          0,
          0.55,
        );
        if (
          randomness.bool(
            `${event.id}:causal-visit`,
            visitProbability,
          )
        ) {
          schedule<VisitPayload>({
            id: `causal-visit:${event.id}`,
            kind: "visit",
            timestampMs:
              recorded.applyAtMs +
              randomness.integer(
                `${event.id}:causal-visit-delay`,
                10_000,
                8 * 60 * 60_000,
              ),
            priority: 35,
            customerId: customer.customerId,
            payload: {
              source: payload.channel,
              reason: "causal_exposure",
            },
          });
        }
      }
      continue;
    }

    if (event.kind === "latent_effect") {
      const payload = event.payload as LatentEffectPayload;
      applyExposureLatentEffect(
        customer,
        payload.channel,
        event.timestampMs,
        payload.effect,
      );
      continue;
    }

    if (event.kind === "interaction_effect") {
      const payload =
        event.payload as InteractionEffectPayload;
      applyPreparedInteraction(
        interactionNetwork,
        customer,
        payload.truth,
        event.timestampMs,
      );
      interactionTruth.push({
        ...payload.truth,
        occurredAt: new Date(event.timestampMs).toISOString(),
      });
      continue;
    }

    if (event.kind === "visit" || event.kind === "return_visit") {
      const payload = event.payload as VisitPayload;
      const count =
        sessionCount.get(customer.customerId) ?? 0;
      if (count >= maxSessions) continue;
      const nextCount = count + 1;
      sessionCount.set(customer.customerId, nextCount);

      refreshLatentCustomerState(
        customer,
        event.timestampMs,
      );
      recordSiteVisitForFutureAudience(
        customer,
        payload.source,
        event.timestampMs,
      );

      const sessionId = `session:${customer.customerId}:${nextCount}`;
      const started = startSession(
        customer,
        payload.source,
        event.timestampMs,
        sessionId,
        randomness,
      );
      sessions.set(sessionId, started.session);
      observableEvents.push(...started.observableEvents);

      schedule<SessionStepPayload>({
        id: `session-step:${sessionId}:0`,
        kind: "session_step",
        timestampMs: event.timestampMs + 2_000,
        priority: 40,
        customerId: customer.customerId,
        payload: { sessionId },
      });
      continue;
    }

    if (event.kind === "session_step") {
      const payload = event.payload as SessionStepPayload;
      const session = sessions.get(payload.sessionId);
      if (!session || session.ended) continue;

      const interventionState =
        buildSimulationInterventionState(
          request.merchantWorld,
          request.interventions ?? [],
          event.timestampMs,
        );

      const step = advanceSession(
        runtime,
        customer,
        session,
        event.timestampMs,
        interventionState,
        randomness,
        maxSessionSteps,
        request.commercePolicy,
      );
      observableEvents.push(...step.observableEvents);

      if (step.checkoutReady) {
        const promotion = promotionState(
          request.merchantWorld,
          interventionState,
          event.timestampMs,
          randomness,
        );
        const interactionContext = {
          timestampMs: event.timestampMs,
          promotionActive: promotion.active,
          inventoryAvailabilityRatio:
            inventoryAvailabilityRatio(runtime),
          interventionState,
        };
        if (request.commercePolicy?.enableInventoryDynamics === true) {
          const timeoutMinutes =
            request.commercePolicy.inventoryReservationTimeoutMinutes ??
            20;
          const reservationIds = reserveCheckoutInventory(
            runtime,
            customer,
            session.sessionId,
            event.timestampMs,
            timeoutMinutes,
          );
          for (const reservationId of reservationIds) {
            const reservation =
              runtime.inventoryEconomy.reservations.get(
                reservationId,
              );
            if (!reservation) continue;
            schedule<InventoryReservationExpiryPayload>({
              id: `inventory-reservation-expired:${reservationId}`,
              kind: "inventory_reservation_expired",
              timestampMs: Date.parse(
                reservation.expiresAt,
              ),
              priority: 6,
              payload: {
                reservationId,
                productId: reservation.skuId,
              },
            });
          }
        }

        const purchaseProbability =
          checkoutPurchaseProbability(
            runtime,
            customer,
            event.timestampMs,
            session.device,
            interventionState,
            randomness,
            checkoutInteractionLift(
              interactionNetwork,
              customer,
              interactionContext,
            ),
            request.commercePolicy,
          );

        const ordinal =
          purchaseCount.get(customer.customerId) ?? 0;
        const purchaseKey = `${session.sessionId}:purchase:${ordinal}`;

        if (
          randomness.bool(
            purchaseKey,
            purchaseProbability,
          )
        ) {
          const orderId = `order:${customer.customerId}:${ordinal + 1}`;
          const purchase = completePurchase(
            runtime,
            customer,
            session.sessionId,
            session.source,
            event.timestampMs,
            orderId,
            interventionState,
            randomness,
            request.commercePolicy,
          );
          if (purchase) {
            purchaseCount.set(
              customer.customerId,
              ordinal + 1,
            );
            purchases.push(purchase);
            observableEvents.push({
              eventId: `purchase:${orderId}`,
              eventType: "purchase",
              occurredAt: purchase.occurredAt,
              anonymousSubjectId: customer.customerId,
              sessionId: session.sessionId,
              source: session.source,
              device: session.device,
              orderId,
              amountMinor: purchase.netRevenueMinor,
            });

            session.ended = true;
            session.currentPage = "ended";

            const repeatDelay =
              days(
                customer.source.expectedPurchaseIntervalDays *
                  Math.exp(
                    randomness.normal(
                      `${customer.customerId}:repeat-delay:${ordinal}`,
                      0,
                      0.28,
                    ),
                  ),
              );

            schedule<NeedPayload>({
              id: `repeat-need:${customer.customerId}:${ordinal + 1}`,
              kind: "repeat_need",
              timestampMs:
                event.timestampMs +
                Math.max(days(2), repeatDelay),
              priority: 10,
              customerId: customer.customerId,
              payload: {
                cycle: 10_000 + ordinal + 1,
                repeat: true,
              },
            });
          }
        } else {
          if (request.commercePolicy?.enableInventoryDynamics === true) {
            markCartInventoryDemandAbandoned(
              runtime,
              customer,
            );
          }
          observableEvents.push({
            eventId: `checkout-abandon:${session.sessionId}:${session.step}`,
            eventType: "checkout_abandon",
            occurredAt: new Date(event.timestampMs).toISOString(),
            anonymousSubjectId: customer.customerId,
            sessionId: session.sessionId,
            source: session.source,
            device: session.device,
          });
          session.ended = true;
          session.currentPage = "ended";

          const returnProbability = clamp(
            0.12 +
              customer.intent * 0.3 +
              customer.consideration * 0.24,
            0.05,
            0.72,
          );
          if (
            randomness.bool(
              `${session.sessionId}:return-after-abandon`,
              returnProbability,
            )
          ) {
            schedule<VisitPayload>({
              id: `return-visit:${session.sessionId}`,
              kind: "return_visit",
              timestampMs:
                event.timestampMs +
                days(
                  0.5 +
                    randomness.uniform(
                      `${session.sessionId}:return-delay`,
                    ) *
                      Math.min(
                        12,
                        customer.source.expectedPurchaseIntervalDays *
                          0.12,
                      ),
                ),
              priority: 35,
              customerId: customer.customerId,
              payload: {
                source: randomness.bool(
                  `${session.sessionId}:return-direct`,
                  0.58,
                )
                  ? "direct"
                  : "organic_search",
                reason: "return",
              },
            });
          }
        }
        continue;
      }

      if (!session.ended && step.nextPage !== "ended") {
        schedule<SessionStepPayload>({
          id: `session-step:${session.sessionId}:${session.step}`,
          kind: "session_step",
          timestampMs:
            event.timestampMs + step.delayMs,
          priority: 40,
          customerId: customer.customerId,
          payload: { sessionId: session.sessionId },
        });
      } else if (session.ended) {
        observableEvents.push({
          eventId: `session-end:${session.sessionId}:${session.step}`,
          eventType: "session_end",
          occurredAt: new Date(event.timestampMs).toISOString(),
          anonymousSubjectId: customer.customerId,
          sessionId: session.sessionId,
          source: session.source,
          device: session.device,
        });
      }
      continue;
    }

    if (event.kind === "lifecycle_check") {
      const payload = event.payload as LifecyclePayload;
      transitionLifecycleForInactivity(
        customer,
        event.timestampMs,
      );

      if (!customer.churned) {
        schedule<LifecyclePayload>({
          id: `lifecycle:${customer.customerId}:${payload.ordinal + 1}`,
          kind: "lifecycle_check",
          timestampMs:
            event.timestampMs + lifecycleCadenceMs,
          priority: 90,
          customerId: customer.customerId,
          payload: {
            ordinal: payload.ordinal + 1,
          },
        });
      }
    }
  }

  observableEvents.sort(
    (left, right) =>
      Date.parse(left.occurredAt) -
        Date.parse(right.occurredAt) ||
      left.eventId.localeCompare(right.eventId),
  );
  purchases.sort(
    (left, right) =>
      Date.parse(left.occurredAt) -
      Date.parse(right.occurredAt),
  );

  const purchaseTruth: PurchaseCausalTruth[] =
    purchases.map((purchase) =>
      purchaseTruthFor(
        observableEvents,
        exposureTruth,
        purchase,
      ),
    );

  const weightByCustomer = new Map(
    request.latentPopulation.customers.map(
      (customer) => [customer.customerId, customer.populationWeight] as const,
    ),
  );

  const representedOrders = purchases.reduce(
    (sum, purchase) =>
      sum + (weightByCustomer.get(purchase.customerId) ?? 1),
    0,
  );
  const representedRevenueMinor = purchases.reduce(
    (sum, purchase) =>
      sum +
      purchase.netRevenueMinor *
        (weightByCustomer.get(purchase.customerId) ?? 1),
    0,
  );
  const representedContributionProfitMinor =
    purchases.reduce(
      (sum, purchase) =>
        sum +
        purchase.contributionProfitMinor *
          (weightByCustomer.get(purchase.customerId) ?? 1),
      0,
    );

  return {
    observableEvents,
    purchases,
    platformMetrics: buildPlatformMetrics(
      request,
      observableEvents,
      purchases,
    ),
    totals: {
      representedPurchases: representedOrders,
      representedOrders,
      representedRevenueMinor,
      representedContributionProfitMinor,
      observableEventCount: observableEvents.length,
    },
    godMode: {
      exposureEffects: exposureTruth,
      ...(request.commercePolicy?.enableInventoryDynamics === true
        ? {
            inventory: finalizeInventoryGodMode(
              runtime.inventoryEconomy,
            ),
          }
        : {}),
      interactionEffects: interactionTruth,
      purchaseTruth,
      customerFinalStates: [...runtime.customers.values()].map(
        (customer) => ({
          customerId: customer.customerId,
          lifecycle: customer.lifecycle,
          purchaseCount: customer.purchaseCount,
          finalNeed: customer.need,
          finalIntent: customer.intent,
          finalAwareness: customer.awareness,
          finalConsideration: customer.consideration,
          finalRetargetingEligibility:
            customer.futureAudience.retargetingEligibility,
          finalEmailEligibility:
            customer.futureAudience.emailEligibility,
          finalBrandedSearchReadiness:
            customer.futureAudience.brandedSearchReadiness,
          finalRecentSiteVisitScore:
            customer.futureAudience.recentSiteVisitScore,
          interactionMemory: [
            ...customer.interactionMemory.values(),
          ].map((memory) => ({
            mechanismId: memory.mechanismId,
            value: memory.value,
          })),
          churned: customer.churned,
        }),
      ),
    },
    provenance: {
      simulatorVersion: WORLD_SIMULATOR_VERSION,
      merchantWorldId: request.merchantWorld.manifest.worldId,
      merchantWorldSeed: request.merchantWorld.manifest.seed,
      customerPopulationSeed: request.latentPopulation.populationSeed,
      simulationSeed: request.simulationSeed,
      startTime: request.startTime,
      endTime: request.endTime,
      interventions: request.interventions ?? [],
      sharedRandomness: true,
    },
  };
}
