import type { RuntimeCustomerState, RuntimeWorldState } from "./state.js";
import type { SharedRandomness } from "./kernel.js";
import type {
  ObservableSource,
  PerfectObservableJourneyEvent,
  SimulationCommercePolicy,
} from "./types.js";
import type { SimulationInterventionState } from "./interventions.js";
import {
  addToPersistentCart,
  chooseProduct,
  offerForProduct,
  pricingCustomerContext,
  type ProductOffer,
} from "./commerce.js";
import {
  bundleAttachmentOpportunity,
  effectiveFreeShippingThreshold,
} from "../pricing_promotions/runtime.js";
import {
  cartBehavior,
  collectionBehavior,
  homepageBehavior,
  pdpBehavior,
  searchBehavior,
} from "../website_simulation/runtime.js";
import {
  measuredWebsiteLoadTimeMs,
} from "../website_simulation/model.js";
import type {
  WebsiteBehaviorContext,
  WebsiteState,
  WebsiteSurface,
} from "../website_simulation/types.js";

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
  searchZeroResults?: boolean;
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
): NonNullable<PerfectObservableJourneyEvent["landingType"]> {
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
  landing: NonNullable<PerfectObservableJourneyEvent["landingType"]>,
): SessionPage {
  if (landing === "collection") return "collection";
  if (landing === "search_results") return "search_results";
  if (landing === "pdp") return "pdp";
  return "landing";
}

function websiteSurfaceForPage(
  page: SessionPage,
): WebsiteSurface | undefined {
  if (page === "landing") return "homepage";
  if (page === "collection") return "collections";
  if (page === "search_results") return "search";
  if (page === "pdp") return "pdp";
  if (page === "cart") return "cart";
  if (page === "checkout") return "checkout";
  return undefined;
}

function websiteContext(
  runtime: RuntimeWorldState,
  session: RuntimeSession,
): WebsiteBehaviorContext {
  return {
    device: session.device,
    assortmentSize: runtime.merchantWorld.summary.skuCount,
    highConsideration:
      runtime.merchantWorld.summary.expectedAovMinor >
      runtime.merchantWorld.summary.catalogMedianPriceMinor * 1.8,
  };
}

export function startSession(
  customer: RuntimeCustomerState,
  source: ObservableSource,
  timestampMs: number,
  sessionId: string,
  randomness: SharedRandomness,
  websiteState?: WebsiteState,
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

  if (websiteState !== undefined) {
    const surface: WebsiteSurface =
      landingType === "collection"
        ? "collections"
        : landingType === "search_results"
          ? "search"
          : landingType === "pdp"
            ? "pdp"
            : "homepage";
    const measuredLoad = measuredWebsiteLoadTimeMs(
      websiteState,
      device,
      surface,
      randomness.uniform(`${sessionId}:landing-load`),
    );
    events[2] = {
      ...events[2]!,
      surface,
      pageLoadTimeMs: measuredLoad,
    };

    if (landingType === "homepage") {
      events.push({
        eventId: eventId(sessionId, "homepage"),
        eventType: "homepage_viewed",
        occurredAt: new Date(timestampMs + 251).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId,
        source,
        device,
        surface: "homepage",
        pageLoadTimeMs: measuredLoad,
      });
    } else if (landingType === "collection") {
      events.push({
        eventId: eventId(sessionId, "collection_landing"),
        eventType: "collection_view",
        occurredAt: new Date(timestampMs + 251).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId,
        source,
        device,
        surface: "collections",
        pageLoadTimeMs: measuredLoad,
      });
    } else if (landingType === "search_results") {
      const effect = searchBehavior(
        websiteState,
        { device },
        randomness.uniform(`${sessionId}:search-landing-load`),
      );
      const zero = randomness.bool(
        `${sessionId}:search-landing-zero`,
        effect.zeroResultProbability,
      );
      session.searchZeroResults = zero;
      events.push(
        {
          eventId: eventId(sessionId, "search_performed_landing"),
          eventType: "search_performed",
          occurredAt: new Date(timestampMs + 251).toISOString(),
          anonymousSubjectId: customer.customerId,
          sessionId,
          source,
          device,
          surface: "search",
          pageLoadTimeMs: effect.measuredLoadTimeMs,
        },
        {
          eventId: eventId(sessionId, "search_results_landing"),
          eventType: "search_results_viewed",
          occurredAt: new Date(timestampMs + 252).toISOString(),
          anonymousSubjectId: customer.customerId,
          sessionId,
          source,
          device,
          surface: "search",
          pageLoadTimeMs: effect.measuredLoadTimeMs,
          searchZeroResults: zero,
        },
      );
    }
  }

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
  commercePolicy?: SimulationCommercePolicy,
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
  const websiteState = commercePolicy?.websiteState;
  const webContext = websiteContext(runtime, session);
  let effectiveStayProbability = stayProbability;
  if (websiteState !== undefined) {
    const exitMultiplier =
      session.currentPage === "landing"
        ? homepageBehavior(
            websiteState,
            webContext,
            randomness.uniform(`${stepKey}:homepage-stay-load`),
          ).exitWeightMultiplier
        : session.currentPage === "collection"
          ? collectionBehavior(
              websiteState,
              webContext,
              randomness.uniform(`${stepKey}:collection-stay-load`),
            ).exitProbabilityMultiplier
          : session.currentPage === "search_results"
            ? searchBehavior(
                websiteState,
                webContext,
                randomness.uniform(`${stepKey}:search-stay-load`),
              ).exitProbabilityMultiplier
            : session.currentPage === "pdp"
              ? pdpBehavior(
                  websiteState,
                  webContext,
                  randomness.uniform(`${stepKey}:pdp-stay-load`),
                ).exitProbabilityMultiplier
              : session.currentPage === "cart"
                ? cartBehavior(
                    websiteState,
                    webContext,
                    randomness.uniform(`${stepKey}:cart-stay-load`),
                  ).abandonmentProbabilityMultiplier
                : 1;
    effectiveStayProbability = clamp(
      stayProbability / Math.max(0.45, exitMultiplier),
      0.04,
      0.95,
    );
  }

  if (
    session.step > 1 &&
    !randomness.bool(`${stepKey}:stay`, effectiveStayProbability)
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
    const homepageEffect =
      websiteState === undefined
        ? undefined
        : homepageBehavior(
            websiteState,
            webContext,
            randomness.uniform(`${stepKey}:homepage-load`),
          );
    const next = randomness.weightedPick(`${stepKey}:landing-next`, [
      {
        value: "collection" as const,
        weight:
          0.38 *
          (homepageEffect?.collectionWeightMultiplier ?? 1),
      },
      {
        value: "search_results" as const,
        weight:
          0.22 *
          (homepageEffect?.searchWeightMultiplier ?? 1),
      },
      {
        value: "pdp" as const,
        weight:
          (0.31 + intent * 0.25) *
          (homepageEffect?.pdpWeightMultiplier ?? 1),
      },
      {
        value: "ended" as const,
        weight:
          0.14 *
          (homepageEffect?.exitWeightMultiplier ?? 1),
      },
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
        ...(websiteState === undefined
          ? {}
          : {
              surface: "collections" as const,
              pageLoadTimeMs: measuredWebsiteLoadTimeMs(
                websiteState,
                session.device,
                "collections",
                randomness.uniform(`${stepKey}:collection-view-load`),
              ),
            }),
      });
    } else if (next === "search_results") {
      const searchEffect =
        websiteState === undefined
          ? undefined
          : searchBehavior(
              websiteState,
              webContext,
              randomness.uniform(`${stepKey}:search-load`),
            );
      const zero =
        searchEffect === undefined
          ? false
          : randomness.bool(
              `${stepKey}:search-zero`,
              searchEffect.zeroResultProbability,
            );
      session.searchZeroResults = zero;
      events.push({
        eventId: eventId(session.sessionId, `search_${session.step}`),
        eventType: "site_search",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
        ...(searchEffect === undefined
          ? {}
          : {
              surface: "search" as const,
              pageLoadTimeMs: searchEffect.measuredLoadTimeMs,
              searchZeroResults: zero,
            }),
      });
      if (searchEffect !== undefined) {
        events.push(
          {
            eventId: eventId(
              session.sessionId,
              `search_performed_${session.step}`,
            ),
            eventType: "search_performed",
            occurredAt: new Date(timestampMs).toISOString(),
            anonymousSubjectId: customer.customerId,
            sessionId: session.sessionId,
            source: session.source,
            device: session.device,
            surface: "search",
            pageLoadTimeMs: searchEffect.measuredLoadTimeMs,
          },
          {
            eventId: eventId(
              session.sessionId,
              `search_results_${session.step}`,
            ),
            eventType: "search_results_viewed",
            occurredAt: new Date(timestampMs + 1).toISOString(),
            anonymousSubjectId: customer.customerId,
            sessionId: session.sessionId,
            source: session.source,
            device: session.device,
            surface: "search",
            pageLoadTimeMs: searchEffect.measuredLoadTimeMs,
            searchZeroResults: zero,
          },
        );
      }
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
    const listEffect =
      websiteState === undefined
        ? undefined
        : session.currentPage === "search_results"
          ? searchBehavior(
              websiteState,
              webContext,
              randomness.uniform(`${stepKey}:list-search-load`),
            )
          : collectionBehavior(
              websiteState,
              webContext,
              randomness.uniform(`${stepKey}:list-collection-load`),
            );
    if (
      websiteState !== undefined &&
      session.currentPage === "search_results"
    ) {
      const searchEffect = listEffect as ReturnType<typeof searchBehavior>;
      const zero = randomness.bool(
        `${stepKey}:search-results-zero`,
        searchEffect.zeroResultProbability,
      );
      session.searchZeroResults = zero;
      events.push({
        eventId: eventId(
          session.sessionId,
          `search_results_view_${session.step}`,
        ),
        eventType: "search_results_viewed",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
        surface: "search",
        pageLoadTimeMs: searchEffect.measuredLoadTimeMs,
        searchZeroResults: zero,
      });
    }
    const toPdp =
      funnelProbability(
        runtime,
        "collection",
        "pdp",
        0.48,
      ) *
      (0.68 + intent * 0.5) *
      (listEffect === undefined
        ? 1
        : "toPdpMultiplier" in listEffect
          ? listEffect.toPdpMultiplier
          : 1) *
      (session.currentPage === "search_results" &&
      session.searchZeroResults === true
        ? 0.08
        : 1);

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
        commercePolicy,
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
      randomness.bool(
        `${stepKey}:leave-list`,
        clamp(
          0.3 *
            (listEffect === undefined
              ? 1
              : listEffect.exitProbabilityMultiplier),
          0.04,
          0.92,
        ),
      )
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
        commercePolicy,
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
        commercePolicy,
      );
      if (offer) session.currentProductId = offer.productId;
    }

    if (offer) {
      const pdpEffect =
        websiteState === undefined
          ? undefined
          : pdpBehavior(
              websiteState,
              webContext,
              randomness.uniform(`${stepKey}:pdp-effect-load`),
            );
      const atcProbability =
        funnelProbability(runtime, "pdp", "add_to_cart", 0.1) *
        (0.45 + intent * 0.85) *
        (0.55 + need * 0.65) *
        offer.priceUtilityMultiplier *
        offer.promotionUtilityMultiplier *
        (pdpEffect?.addToCartMultiplier ?? 1);

      const inventoryMechanism =
        runtime.merchantWorld.manifest.inventoryMechanisms.find(
          (item) => item.productId === offer.productId,
        );
      const backorderEligible =
        intervention.inventoryOverrideUnits === undefined &&
        commercePolicy?.executeInventoryLifecycle === true &&
        inventoryMechanism?.allowBackorders === true &&
        inventoryMechanism.stockoutBehavior === "backorder";

      if (
        (offer.availableUnits > 0 || backorderEligible) &&
        randomness.bool(
          `${stepKey}:atc`,
          clamp(atcProbability, 0.005, 0.82),
        )
      ) {
        addToPersistentCart(customer, offer, timestampMs);
        const extraUnitProbability = clamp(
          (runtime.merchantWorld.summary.expectedUnitsPerOrder - 1) *
            0.22 *
            (offer.stockpilingMultiplier ?? 1),
          0,
          commercePolicy?.pricingPromotionScenario === undefined
            ? 0.45
            : 0.78,
        );
        if (
          commercePolicy?.enableEnhancedBasketEconomics === true &&
          (offer.availableUnits > 1 || backorderEligible) &&
          randomness.bool(
            `${stepKey}:extra-unit`,
            extraUnitProbability,
          )
        ) {
          addToPersistentCart(customer, offer, timestampMs);
        }

        const bundleAttachment =
          bundleAttachmentOpportunity(
            commercePolicy?.pricingPromotionScenario,
            pricingCustomerContext(customer),
            timestampMs,
            customer.cart?.lines.map(
              (line) => line.productId,
            ) ?? [offer.productId],
          );
        if (
          bundleAttachment !== undefined &&
          randomness.bool(
            `${stepKey}:bundle-attachment:${bundleAttachment.promotionId}`,
            bundleAttachment.probability,
          )
        ) {
          const attachedOffer = offerForProduct(
            runtime,
            customer,
            bundleAttachment.productId,
            timestampMs,
            intervention,
            randomness,
            commercePolicy,
          );
          const attachedInventoryMechanism =
            runtime.merchantWorld.manifest.inventoryMechanisms.find(
              (item) =>
                item.productId === attachedOffer.productId,
            );
          const attachedBackorderEligible =
            intervention.inventoryOverrideUnits === undefined &&
            commercePolicy?.executeInventoryLifecycle === true &&
            attachedInventoryMechanism?.allowBackorders === true &&
            attachedInventoryMechanism.stockoutBehavior ===
              "backorder";

          if (
            attachedOffer.availableUnits > 0 ||
            attachedBackorderEligible
          ) {
            addToPersistentCart(
              customer,
              attachedOffer,
              timestampMs,
            );
            events.push({
              eventId: eventId(
                session.sessionId,
                `bundle_atc_${session.step}`,
              ),
              eventType: "add_to_cart",
              occurredAt: new Date(
                timestampMs,
              ).toISOString(),
              anonymousSubjectId:
                customer.customerId,
              sessionId: session.sessionId,
              source: session.source,
              device: session.device,
              productId: attachedOffer.productId,
              quantity: 1,
              amountMinor:
                attachedOffer.finalPriceMinor,
            });
          }
        }
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
        if (websiteState !== undefined) {
          events.push({
            eventId: eventId(
              session.sessionId,
              `cart_view_${session.step}`,
            ),
            eventType: "cart_viewed",
            occurredAt: new Date(timestampMs + 1).toISOString(),
            anonymousSubjectId: customer.customerId,
            sessionId: session.sessionId,
            source: session.source,
            device: session.device,
            surface: "cart",
            pageLoadTimeMs: cartBehavior(
              websiteState,
              webContext,
              randomness.uniform(`${stepKey}:cart-view-load`),
            ).measuredLoadTimeMs,
          });
        }
      } else if (
        randomness.bool(
          `${stepKey}:pdp-loop`,
          clamp(
            0.36 * (pdpEffect?.comparisonMultiplier ?? 1),
            0.05,
            0.82,
          ),
        )
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
    const cartValue =
      customer.cart?.lines.reduce(
        (sum, line) =>
          sum + line.quantity * line.unitPriceMinor,
        0,
      ) ?? 0;
    const threshold =
      effectiveFreeShippingThreshold(
        commercePolicy?.pricingPromotionScenario,
        pricingCustomerContext(customer),
        timestampMs,
        commercePolicy?.freeShippingThresholdMinor,
      );
    const shippingCharge =
      commercePolicy?.customerShippingChargeMinor ?? 0;
    const belowThreshold =
      threshold !== undefined &&
      threshold !== null &&
      cartValue < threshold &&
      shippingCharge > 0;
    const thresholdGap =
      belowThreshold && threshold !== undefined && threshold !== null
        ? threshold - cartValue
        : 0;
    const fillBasketMultiplier =
      belowThreshold &&
      threshold !== undefined &&
      threshold !== null &&
      thresholdGap <=
        Math.max(
          runtime.merchantWorld.summary.catalogMedianPriceMinor * 1.5,
          threshold * 0.35,
        )
        ? 0.82
        : 1;

    const cartEffect =
      websiteState === undefined
        ? undefined
        : cartBehavior(
            websiteState,
            webContext,
            randomness.uniform(`${stepKey}:cart-effect-load`),
          );
    const checkoutProbability =
      funnelProbability(
        runtime,
        "add_to_cart",
        "checkout",
        0.52,
      ) *
      (0.55 + intent * 0.55) *
      fillBasketMultiplier *
      (cartEffect?.checkoutMultiplier ?? 1);

    if (
      randomness.bool(
        `${stepKey}:checkout`,
        clamp(checkoutProbability, 0.05, 0.9),
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
        ...(websiteState === undefined
          ? {}
          : {
              surface: "checkout" as const,
              pageLoadTimeMs: measuredWebsiteLoadTimeMs(
                websiteState,
                session.device,
                "checkout",
                randomness.uniform(`${stepKey}:checkout-start-load`),
              ),
            }),
      });
    } else if (
      randomness.bool(
        `${stepKey}:continue-shopping`,
        belowThreshold && thresholdGap > 0
          ? 0.58
          : 0.34,
      )
    ) {
      session.currentPage = "collection";
    } else {
      session.currentPage = "ended";
      session.ended = true;
    }
  }

  const checkoutReady = session.currentPage === "checkout";
  const baseDelayMs = randomness.integer(
    `${stepKey}:delay`,
    8_000,
    130_000,
  );
  const nextSurface = websiteSurfaceForPage(session.currentPage);
  const delayMs =
    websiteState === undefined || nextSurface === undefined
      ? baseDelayMs
      : baseDelayMs +
        Math.round(
          measuredWebsiteLoadTimeMs(
            websiteState,
            session.device,
            nextSurface,
            randomness.uniform(`${stepKey}:next-page-load`),
          ) * 0.65,
        );

  return {
    observableEvents: events,
    nextPage: session.currentPage,
    delayMs,
    checkoutReady,
  };
}
