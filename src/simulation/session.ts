import type { RuntimeCustomerState, RuntimeWorldState } from "./state.js";
import type { SharedRandomness } from "./kernel.js";
import type {
  ObservableSource,
  PerfectObservableJourneyEvent,
} from "./types.js";
import type { SimulationInterventionState } from "./interventions.js";
import {
  addToPersistentCart,
  chooseProduct,
  type ProductOffer,
} from "./commerce.js";

export type SessionPage =
  | "landing"
  | "collection"
  | "search_results"
  | "pdp"
  | "cart"
  | "checkout"
  | "ended";

export interface RuntimeSession {
  readonly sessionId: string;
  readonly customerId: string;
  readonly source: ObservableSource;
  readonly device: "mobile" | "desktop" | "tablet";
  readonly startedAtMs: number;
  currentPage: SessionPage;
  currentProductId?: string;
  step: number;
  ended: boolean;
  checkoutStarted: boolean;
}

export interface SessionStartResult {
  readonly session: RuntimeSession;
  readonly observableEvents: readonly PerfectObservableJourneyEvent[];
}

export interface SessionStepResult {
  readonly observableEvents: readonly PerfectObservableJourneyEvent[];
  readonly nextPage: SessionPage;
  readonly delayMs: number;
  readonly checkoutReady: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function eventId(sessionId: string, suffix: string): string {
  return `${sessionId}_${suffix}`;
}

function chooseDevice(
  customer: RuntimeCustomerState,
  randomness: SharedRandomness,
  key: string,
): "mobile" | "desktop" | "tablet" {
  return randomness.weightedPick(key, [
    {
      value: "mobile" as const,
      weight: customer.source.devicePreference.mobileProbability,
    },
    {
      value: "desktop" as const,
      weight: customer.source.devicePreference.desktopProbability,
    },
    {
      value: "tablet" as const,
      weight: customer.source.devicePreference.tabletProbability,
    },
  ]);
}

function chooseLandingType(
  source: ObservableSource,
  customer: RuntimeCustomerState,
  randomness: SharedRandomness,
  key: string,
): PerfectObservableJourneyEvent["landingType"] {
  if (source === "google_search" || source === "google_shopping") {
    return randomness.weightedPick(key, [
      { value: "pdp" as const, weight: 0.46 },
      { value: "search_results" as const, weight: 0.34 },
      { value: "collection" as const, weight: 0.16 },
      { value: "homepage" as const, weight: 0.04 },
    ]);
  }
  if (source === "organic_search") {
    return randomness.weightedPick(key, [
      { value: "search_results" as const, weight: 0.34 },
      { value: "pdp" as const, weight: 0.29 },
      { value: "collection" as const, weight: 0.27 },
      { value: "homepage" as const, weight: 0.1 },
    ]);
  }
  if (
    source === "meta" ||
    source === "pinterest" ||
    source === "affiliate"
  ) {
    return randomness.weightedPick(key, [
      { value: "campaign" as const, weight: 0.35 },
      { value: "pdp" as const, weight: 0.33 },
      { value: "collection" as const, weight: 0.25 },
      { value: "homepage" as const, weight: 0.07 },
    ]);
  }
  if (source === "email" || source === "sms") {
    return randomness.weightedPick(key, [
      { value: "pdp" as const, weight: 0.42 },
      { value: "campaign" as const, weight: 0.32 },
      { value: "collection" as const, weight: 0.19 },
      { value: "homepage" as const, weight: 0.07 },
    ]);
  }
  if (source === "direct") {
    return randomness.weightedPick(key, [
      { value: "homepage" as const, weight: 0.4 },
      { value: "pdp" as const, weight: 0.25 },
      { value: "collection" as const, weight: 0.25 },
      { value: "search_results" as const, weight: 0.1 },
    ]);
  }
  return randomness.weightedPick(key, [
    { value: "homepage" as const, weight: 0.34 },
    { value: "collection" as const, weight: 0.28 },
    { value: "pdp" as const, weight: 0.23 },
    { value: "search_results" as const, weight: 0.15 },
  ]);
}

function initialPage(
  landing: PerfectObservableJourneyEvent["landingType"],
): SessionPage {
  if (landing === "collection") return "collection";
  if (landing === "search_results") return "search_results";
  if (landing === "pdp") return "pdp";
  return "landing";
}

export function startSession(
  customer: RuntimeCustomerState,
  source: ObservableSource,
  timestampMs: number,
  sessionId: string,
  randomness: SharedRandomness,
): SessionStartResult {
  const device = chooseDevice(
    customer,
    randomness,
    `${sessionId}:device`,
  );
  const landingType = chooseLandingType(
    source,
    customer,
    randomness,
    `${sessionId}:landing`,
  );

  const session: RuntimeSession = {
    sessionId,
    customerId: customer.customerId,
    source,
    device,
    startedAtMs: timestampMs,
    currentPage: initialPage(landingType),
    step: 0,
    ended: false,
    checkoutStarted: false,
  };

  const events: PerfectObservableJourneyEvent[] = [
    {
      eventId: eventId(sessionId, "visit"),
      eventType: "visit",
      occurredAt: new Date(timestampMs).toISOString(),
      anonymousSubjectId: customer.customerId,
      sessionId,
      source,
      device,
    },
    {
      eventId: eventId(sessionId, "start"),
      eventType: "session_start",
      occurredAt: new Date(timestampMs).toISOString(),
      anonymousSubjectId: customer.customerId,
      sessionId,
      source,
      device,
    },
    {
      eventId: eventId(sessionId, "landing"),
      eventType: "landing_page_view",
      occurredAt: new Date(timestampMs + 250).toISOString(),
      anonymousSubjectId: customer.customerId,
      sessionId,
      source,
      device,
      landingType,
    },
  ];

  return { session, observableEvents: events };
}

function funnelProbability(
  runtime: RuntimeWorldState,
  from: string,
  to: string,
  fallback: number,
): number {
  const mechanism = runtime.merchantWorld.manifest.funnelMechanisms.find(
    (item) => item.from === from && item.to === to,
  );
  return clamp(
    Number(mechanism?.baseProbability ?? fallback),
    0.001,
    0.98,
  );
}

function productViewEvent(
  session: RuntimeSession,
  customer: RuntimeCustomerState,
  timestampMs: number,
  offer: ProductOffer,
  suffix: string,
): PerfectObservableJourneyEvent {
  return {
    eventId: eventId(session.sessionId, suffix),
    eventType: "product_view",
    occurredAt: new Date(timestampMs).toISOString(),
    anonymousSubjectId: customer.customerId,
    sessionId: session.sessionId,
    source: session.source,
    device: session.device,
    productId: offer.productId,
  };
}

export function advanceSession(
  runtime: RuntimeWorldState,
  customer: RuntimeCustomerState,
  session: RuntimeSession,
  timestampMs: number,
  intervention: SimulationInterventionState,
  randomness: SharedRandomness,
  maxSteps: number,
): SessionStepResult {
  if (session.ended || session.step >= maxSteps) {
    session.ended = true;
    session.currentPage = "ended";
    return {
      observableEvents: [
        {
          eventId: eventId(session.sessionId, `end_${session.step}`),
          eventType: "session_end",
          occurredAt: new Date(timestampMs).toISOString(),
          anonymousSubjectId: customer.customerId,
          sessionId: session.sessionId,
          source: session.source,
          device: session.device,
        },
      ],
      nextPage: "ended",
      delayMs: 0,
      checkoutReady: false,
    };
  }

  const stepKey = `${session.sessionId}:step:${session.step}`;
  session.step += 1;
  const events: PerfectObservableJourneyEvent[] = [];
  const intent = clamp(customer.intent, 0, 1);
  const need = clamp(customer.need, 0, 1);
  const stayProbability = clamp(
    0.25 + 0.36 * intent + 0.24 * need + 0.08 * customer.brandAffinity,
    0.12,
    0.92,
  );

  if (
    session.step > 1 &&
    !randomness.bool(`${stepKey}:stay`, stayProbability)
  ) {
    session.ended = true;
    session.currentPage = "ended";
    events.push({
      eventId: eventId(session.sessionId, `end_${session.step}`),
      eventType: "session_end",
      occurredAt: new Date(timestampMs).toISOString(),
      anonymousSubjectId: customer.customerId,
      sessionId: session.sessionId,
      source: session.source,
      device: session.device,
    });
    return {
      observableEvents: events,
      nextPage: "ended",
      delayMs: 0,
      checkoutReady: false,
    };
  }

  if (session.currentPage === "landing") {
    const next = randomness.weightedPick(`${stepKey}:landing-next`, [
      { value: "collection" as const, weight: 0.38 },
      { value: "search_results" as const, weight: 0.22 },
      { value: "pdp" as const, weight: 0.31 + intent * 0.25 },
      { value: "ended" as const, weight: 0.14 },
    ]);
    session.currentPage = next;
    if (next === "collection") {
      events.push({
        eventId: eventId(session.sessionId, `collection_${session.step}`),
        eventType: "collection_view",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
      });
    } else if (next === "search_results") {
      events.push({
        eventId: eventId(session.sessionId, `search_${session.step}`),
        eventType: "site_search",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
      });
    } else if (next === "ended") {
      session.ended = true;
      events.push({
        eventId: eventId(session.sessionId, `end_${session.step}`),
        eventType: "session_end",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
      });
    }
  }

  if (
    session.currentPage === "collection" ||
    session.currentPage === "search_results"
  ) {
    const toPdp =
      funnelProbability(
        runtime,
        "collection",
        "pdp",
        0.48,
      ) *
      (0.68 + intent * 0.5);

    if (
      randomness.bool(
        `${stepKey}:to-pdp`,
        clamp(toPdp, 0.05, 0.92),
      )
    ) {
      const offer = chooseProduct(
        runtime,
        customer,
        timestampMs,
        intervention,
        randomness,
        `${stepKey}:product`,
      );
      if (offer) {
        session.currentProductId = offer.productId;
        session.currentPage = "pdp";
        events.push(
          productViewEvent(
            session,
            customer,
            timestampMs,
            offer,
            `pdp_${session.step}`,
          ),
        );
      }
    } else if (
      randomness.bool(`${stepKey}:leave-list`, 0.3)
    ) {
      session.currentPage = "ended";
      session.ended = true;
    }
  }

  if (session.currentPage === "pdp") {
    let offer: ProductOffer | undefined;
    if (session.currentProductId) {
      offer = chooseProduct(
        runtime,
        customer,
        timestampMs,
        intervention,
        randomness,
        `${stepKey}:pdp-offer`,
      );
      if (offer && offer.productId !== session.currentProductId) {
        // Browsing can move to another preferred product.
        session.currentProductId = offer.productId;
      }
    } else {
      offer = chooseProduct(
        runtime,
        customer,
        timestampMs,
        intervention,
        randomness,
        `${stepKey}:pdp-product`,
      );
      if (offer) session.currentProductId = offer.productId;
    }

    if (offer) {
      const atcProbability =
        funnelProbability(runtime, "pdp", "add_to_cart", 0.1) *
        (0.45 + intent * 0.85) *
        (0.55 + need * 0.65) *
        offer.priceUtilityMultiplier *
        offer.promotionUtilityMultiplier;

      if (
        offer.availableUnits > 0 &&
        randomness.bool(
          `${stepKey}:atc`,
          clamp(atcProbability, 0.005, 0.82),
        )
      ) {
        addToPersistentCart(customer, offer, timestampMs);
        session.currentPage = "cart";
        events.push({
          eventId: eventId(session.sessionId, `atc_${session.step}`),
          eventType: "add_to_cart",
          occurredAt: new Date(timestampMs).toISOString(),
          anonymousSubjectId: customer.customerId,
          sessionId: session.sessionId,
          source: session.source,
          device: session.device,
          productId: offer.productId,
          quantity: 1,
          amountMinor: offer.finalPriceMinor,
        });
      } else if (
        randomness.bool(`${stepKey}:pdp-loop`, 0.36)
      ) {
        session.currentPage = randomness.bool(
          `${stepKey}:back-to-collection`,
          0.55,
        )
          ? "collection"
          : "pdp";
      } else {
        session.currentPage = "ended";
        session.ended = true;
      }
    } else {
      session.currentPage = "ended";
      session.ended = true;
    }
  }

  if (session.currentPage === "cart") {
    const checkoutProbability =
      funnelProbability(
        runtime,
        "add_to_cart",
        "checkout",
        0.52,
      ) *
      (0.55 + intent * 0.55);

    if (
      randomness.bool(
        `${stepKey}:checkout`,
        clamp(checkoutProbability, 0.08, 0.9),
      )
    ) {
      session.currentPage = "checkout";
      session.checkoutStarted = true;
      events.push({
        eventId: eventId(session.sessionId, `checkout_${session.step}`),
        eventType: "checkout_start",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
      });
    } else if (
      randomness.bool(`${stepKey}:continue-shopping`, 0.34)
    ) {
      session.currentPage = "collection";
    } else {
      session.currentPage = "ended";
      session.ended = true;
    }
  }

  const checkoutReady = session.currentPage === "checkout";
  const delayMs = randomness.integer(
    `${stepKey}:delay`,
    8_000,
    130_000,
  );

  return {
    observableEvents: events,
    nextPage: session.currentPage,
    delayMs,
    checkoutReady,
  };
}
