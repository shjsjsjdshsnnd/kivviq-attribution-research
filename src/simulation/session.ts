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
  pageCausalEvents,
  resolveWebsiteState,
  websiteCustomerContext,
  websitePageExperience,
  zeroResultSearchProbability,
} from "../website_cro/runtime.js";
import type {
  WebsiteCausalEvent,
  WebsiteComponentName,
  WebsiteFunnelTransition,
} from "../website_cro/types.js";

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
  readonly websiteCausalEvents?: readonly WebsiteCausalEvent[];
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

export function startSession(
  customer: RuntimeCustomerState,
  source: ObservableSource,
  timestampMs: number,
  sessionId: string,
  randomness: SharedRandomness,
  commercePolicy?: SimulationCommercePolicy,
): SessionStartResult {
  const device = chooseDevice(
    customer,
    randomness,
    `${sessionId}:device`,
  );
  const structuralLandingType = chooseLandingType(
    source,
    customer,
    randomness,
    `${sessionId}:landing`,
  );
  let landingType = structuralLandingType;
  if (
    structuralLandingType === "search_results" &&
    commercePolicy?.websiteScenario !== undefined
  ) {
    const state = resolveWebsiteState(
      commercePolicy.websiteScenario,
      timestampMs,
      device,
    );
    const latentSearchUse =
      customer.source.naturalSelection
        .searchUseProbability;
    const searchEntryProbability = clamp(
      state.search.entryPropensity *
        (0.35 + latentSearchUse * 1.3),
      0.002,
      0.98,
    );
    if (
      !randomness.bool(
        `${sessionId}:site-search-entry`,
        searchEntryProbability,
      )
    ) {
      landingType = randomness.bool(
        `${sessionId}:search-bypass-collection`,
        0.58,
      )
        ? "collection"
        : "pdp";
    }
  }

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

  if (
    landingType === "search_results" &&
    commercePolicy?.websiteScenario !== undefined
  ) {
    events.push({
      eventId: eventId(sessionId, "initial_search"),
      eventType: "site_search",
      occurredAt: new Date(timestampMs + 300).toISOString(),
      anonymousSubjectId: customer.customerId,
      sessionId,
      source,
      device,
    });
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

function websiteComponentForPage(
  page: SessionPage,
): WebsiteComponentName | undefined {
  if (page === "landing") return "homepage";
  if (page === "collection") return "collection";
  if (page === "search_results") return "search";
  if (page === "pdp") return "pdp";
  if (page === "cart") return "cart";
  if (page === "checkout") return "checkout";
  return undefined;
}

function websiteTransitionForPage(
  page: SessionPage,
): WebsiteFunnelTransition | undefined {
  if (page === "landing") return "landing_to_browse";
  if (page === "collection" || page === "search_results") {
    return "browse_to_pdp";
  }
  if (page === "pdp") return "pdp_to_atc";
  if (page === "cart") return "atc_to_checkout";
  if (page === "checkout") return "checkout_to_purchase";
  return undefined;
}

function productCategory(
  runtime: RuntimeWorldState,
  productId: string | undefined,
): string | undefined {
  if (productId === undefined) return undefined;
  return runtime.merchantWorld.manifest.productDemandMechanisms.find(
    (candidate) => candidate.productId === productId,
  )?.categoryId;
}

function productViewEvent(
  runtime: RuntimeWorldState,
  session: RuntimeSession,
  customer: RuntimeCustomerState,
  timestampMs: number,
  offer: ProductOffer,
  suffix: string,
  commercePolicy?: SimulationCommercePolicy,
): PerfectObservableJourneyEvent {
  const inventoryMechanism =
    runtime.merchantWorld.manifest.inventoryMechanisms.find(
      (candidate) =>
        candidate.productId === offer.productId,
    );
  const canBackorder =
    commercePolicy?.executeInventoryLifecycle === true &&
    inventoryMechanism?.allowBackorders === true &&
    inventoryMechanism.stockoutBehavior === "backorder";
  const availability:
    | "in_stock"
    | "low_stock"
    | "backorder"
    | "out_of_stock" =
    offer.availableUnits > 3
      ? "in_stock"
      : offer.availableUnits > 0
        ? "low_stock"
        : canBackorder
          ? "backorder"
          : "out_of_stock";
  const expectedArrival =
    commercePolicy?.enableInventoryDynamics === true
      ? runtime.inventoryEconomy.positions.get(
          offer.productId,
        )?.expectedArrivalAt
      : undefined;
  const deliveryEstimateDays =
    expectedArrival === undefined
      ? undefined
      : Math.max(
          0,
          Math.ceil(
            (Date.parse(expectedArrival) - timestampMs) /
              86_400_000,
          ),
        );

  return {
    eventId: eventId(session.sessionId, suffix),
    eventType: "product_view",
    occurredAt: new Date(timestampMs).toISOString(),
    anonymousSubjectId: customer.customerId,
    sessionId: session.sessionId,
    source: session.source,
    device: session.device,
    productId: offer.productId,
    ...(commercePolicy?.websiteScenario === undefined
      ? {}
      : {
          availability,
          ...(deliveryEstimateDays === undefined
            ? {}
            : { deliveryEstimateDays }),
        }),
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
  const websiteEvents: WebsiteCausalEvent[] = [];
  const intent = clamp(customer.intent, 0, 1);
  const need = clamp(customer.need, 0, 1);
  const websiteCustomer = websiteCustomerContext({
    customerId: customer.customerId,
    intent,
    need,
    brandAffinity: customer.brandAffinity,
    priceSensitivityMultiplier:
      customer.source.priceSensitivityMultiplier,
    promotionSensitivityMultiplier:
      customer.source.promotionSensitivityMultiplier,
    purchaseCount: customer.purchaseCount,
  });
  const experienceFor = (
    component: WebsiteComponentName,
    productId?: string,
    productPriceMinor?: number,
  ) =>
    websitePageExperience({
      scenario: commercePolicy?.websiteScenario,
      timestampMs,
      component,
      device: session.device,
      customer: websiteCustomer,
      ...(productId === undefined ? {} : { productId }),
      ...(productPriceMinor === undefined
        ? {}
        : {
            productPriceMinor,
            expectedAovMinor:
              runtime.merchantWorld.summary.expectedAovMinor,
          }),
      ...(productId === undefined
        ? {}
        : {
            categoryId: productCategory(
              runtime,
              productId,
            ),
          }),
    });
  const startingPage = session.currentPage;
  const startingComponent =
    websiteComponentForPage(startingPage);
  const startingTransition =
    websiteTransitionForPage(startingPage);
  const startingExperience =
    startingComponent === undefined
      ? undefined
      : experienceFor(
          startingComponent,
          session.currentProductId,
        );

  if (
    startingExperience !== undefined &&
    startingTransition !== undefined
  ) {
    events.push({
      eventId: eventId(
        session.sessionId,
        `page_performance_${session.step}_${startingExperience.component}`,
      ),
      eventType: "page_performance",
      occurredAt: new Date(timestampMs).toISOString(),
      anonymousSubjectId: customer.customerId,
      sessionId: session.sessionId,
      source: session.source,
      device: session.device,
      websiteComponent: startingExperience.component,
      measuredPageLoadMs: Math.max(
        1,
        Math.round(
          startingExperience.latencyMs *
            (0.92 +
              randomness.uniform(
                `${stepKey}:measured-page-load:${startingExperience.component}`,
              ) *
                0.16),
        ),
      ),
    });
    websiteEvents.push(
      ...pageCausalEvents({
        experience: startingExperience,
        scenario: commercePolicy?.websiteScenario,
        customerId: customer.customerId,
        sessionId: session.sessionId,
        timestampMs,
        device: session.device,
        transition: startingTransition as Exclude<
          WebsiteFunnelTransition,
          "checkout_to_purchase"
        >,
        source: session.source,
        ...(session.currentProductId === undefined
          ? {}
          : { productId: session.currentProductId }),
      }),
    );
  }

  if (
    startingExperience !== undefined &&
    randomness.bool(
      `${stepKey}:page-load-failure:${startingComponent ?? "none"}`,
      startingExperience.loadFailureProbability,
    )
  ) {
    session.ended = true;
    session.currentPage = "ended";
    events.push({
      eventId: eventId(
        session.sessionId,
        `load_failure_${session.step}`,
      ),
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
      delayMs: startingExperience.latencyMs,
      checkoutReady: false,
      websiteCausalEvents: websiteEvents,
    };
  }

  const structuralStayProbability =
    0.25 +
    0.36 * intent +
    0.24 * need +
    0.08 * customer.brandAffinity;
  const stayProbability =
    startingExperience === undefined
      ? clamp(structuralStayProbability, 0.12, 0.92)
      : clamp(
          structuralStayProbability *
            startingExperience.continuationMultiplier,
          0.04,
          0.94,
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
      ...(websiteEvents.length === 0
        ? {}
        : { websiteCausalEvents: websiteEvents }),
    };
  }

  if (session.currentPage === "landing") {
    const homepageExperience = experienceFor("homepage");
    const navigationExperience = experienceFor("navigation");
    websiteEvents.push(
      ...pageCausalEvents({
        experience: navigationExperience,
        scenario: commercePolicy?.websiteScenario,
        customerId: customer.customerId,
        sessionId: session.sessionId,
        timestampMs,
        device: session.device,
        transition: "landing_to_browse",
        source: session.source,
      }),
    );
    const landingProgress =
      homepageExperience?.transitionMultiplier ?? 1;
    const navigationProgress =
      navigationExperience?.transitionMultiplier ?? 1;
    const searchFallback =
      1 + Math.max(0, 1 - navigationProgress) * 0.9;
    const searchEntryFactor =
      commercePolicy?.websiteScenario === undefined
        ? 1
        : clamp(
            resolveWebsiteState(
              commercePolicy.websiteScenario,
              timestampMs,
              session.device,
            ).search.entryPropensity *
              (0.35 +
                customer.source.naturalSelection
                  .searchUseProbability *
                  1.3),
            0.002,
            1.25,
          );
    const next = randomness.weightedPick(`${stepKey}:landing-next`, [
      {
        value: "collection" as const,
        weight:
          0.38 * landingProgress * navigationProgress,
      },
      {
        value: "search_results" as const,
        weight:
          0.22 *
          landingProgress *
          searchFallback *
          searchEntryFactor,
      },
      {
        value: "pdp" as const,
        weight:
          (0.31 + intent * 0.25) *
          landingProgress *
          (0.72 + navigationProgress * 0.28),
      },
      {
        value: "ended" as const,
        weight:
          0.14 +
          Math.max(
            0,
            1 -
              landingProgress *
                navigationProgress,
          ) *
            0.35,
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

  if (session.currentPage === "search_results") {
    const searchExperience = experienceFor("search");
    const zeroResultProbability =
      zeroResultSearchProbability({
        scenario: commercePolicy?.websiteScenario,
        timestampMs,
        device: session.device,
        intent,
      });
    if (
      randomness.bool(
        `${stepKey}:zero-result-search`,
        zeroResultProbability,
      )
    ) {
      events.push({
        eventId: eventId(
          session.sessionId,
          `search_zero_${session.step}`,
        ),
        eventType: "search_zero_result",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
      });
      if (
        searchExperience !== undefined &&
        commercePolicy?.websiteScenario !== undefined
      ) {
        websiteEvents.push({
          eventId:
            `website:${session.sessionId}:zero-result:${timestampMs}`,
          customerId: customer.customerId,
          sessionId: session.sessionId,
          occurredAt: new Date(timestampMs).toISOString(),
          scenarioId: commercePolicy.websiteScenario.scenarioId,
          websiteVersionId: searchExperience.websiteVersionId,
          component: "search",
          componentVersion: searchExperience.componentVersion,
          device: session.device,
          transition: "browse_to_pdp",
          friction: "zero_result_search",
          probabilityMultiplier:
            searchExperience.transitionMultiplier,
          source: session.source,
        });
      }

      const reformulateProbability = clamp(
        0.18 +
          intent * 0.36 +
          (searchExperience?.transitionMultiplier ?? 1) * 0.16,
        0.12,
        0.78,
      );
      if (
        randomness.bool(
          `${stepKey}:reformulate`,
          reformulateProbability,
        )
      ) {
        events.push({
          eventId: eventId(
            session.sessionId,
            `search_reformulate_${session.step}`,
          ),
          eventType: "search_reformulation",
          occurredAt: new Date(timestampMs).toISOString(),
          anonymousSubjectId: customer.customerId,
          sessionId: session.sessionId,
          source: session.source,
          device: session.device,
        });
      } else if (
        randomness.bool(
          `${stepKey}:zero-result-browse-category`,
          0.34 + need * 0.2,
        )
      ) {
        session.currentPage = "collection";
      } else {
        session.currentPage = "ended";
        session.ended = true;
      }
    }
  }

  if (
    session.currentPage === "collection" ||
    session.currentPage === "search_results"
  ) {
    const listSurface = session.currentPage;
    const listExperience = experienceFor(
      listSurface === "collection" ? "collection" : "search",
    );
    const toPdp =
      funnelProbability(
        runtime,
        "collection",
        "pdp",
        0.48,
      ) *
      (0.68 + intent * 0.5) *
      (listExperience?.transitionMultiplier ?? 1);

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
        {
          surface: listSurface,
          device: session.device,
        },
      );
      if (offer) {
        session.currentProductId = offer.productId;
        session.currentPage = "pdp";
        events.push(
          productViewEvent(
            runtime,
            session,
            customer,
            timestampMs,
            offer,
            `pdp_${session.step}`,
            commercePolicy,
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
        commercePolicy,
        {
          surface: "pdp",
          device: session.device,
        },
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
        {
          surface: "pdp",
          device: session.device,
        },
      );
      if (offer) session.currentProductId = offer.productId;
    }

    if (offer) {
      const pdpExperience = experienceFor(
        "pdp",
        offer.productId,
        offer.finalPriceMinor,
      );
      websiteEvents.push(
        ...pageCausalEvents({
          experience: pdpExperience,
          scenario: commercePolicy?.websiteScenario,
          customerId: customer.customerId,
          sessionId: session.sessionId,
          timestampMs,
          device: session.device,
          transition: "pdp_to_atc",
          source: session.source,
          productId: offer.productId,
        }),
      );
      const atcProbability =
        funnelProbability(runtime, "pdp", "add_to_cart", 0.1) *
        (0.45 + intent * 0.85) *
        (0.55 + need * 0.65) *
        offer.priceUtilityMultiplier *
        offer.promotionUtilityMultiplier *
        (pdpExperience?.transitionMultiplier ?? 1);

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
        if (
          customer.cart !== undefined &&
          commercePolicy?.websiteScenario !== undefined
        ) {
          const websiteState = resolveWebsiteState(
            commercePolicy.websiteScenario,
            timestampMs,
            session.device,
            offer.productId,
            productCategory(runtime, offer.productId),
          );
          const persistenceDays =
            1 +
            29 *
              websiteState.cart
                .persistenceProbability;
          customer.cart.expiresAtMs =
            timestampMs +
            persistenceDays * 86_400_000;
        }
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
        if (commercePolicy?.websiteScenario !== undefined) {
          events.push({
            eventId: eventId(session.sessionId, `cart_${session.step}`),
            eventType: "cart_view",
            occurredAt: new Date(timestampMs).toISOString(),
            anonymousSubjectId: customer.customerId,
            sessionId: session.sessionId,
            source: session.source,
            device: session.device,
          });
        }
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

    const cartExperience = experienceFor("cart");
    websiteEvents.push(
      ...pageCausalEvents({
        experience: cartExperience,
        scenario: commercePolicy?.websiteScenario,
        customerId: customer.customerId,
        sessionId: session.sessionId,
        timestampMs,
        device: session.device,
        transition: "atc_to_checkout",
        source: session.source,
      }),
    );

    let crossSellCheckoutMultiplier = 1;
    let crossSellExplore = false;
    if (
      commercePolicy?.websiteScenario !== undefined &&
      customer.cart !== undefined
    ) {
      const websiteState = resolveWebsiteState(
        commercePolicy.websiteScenario,
        timestampMs,
        session.device,
      );
      const relatedProducts = new Set<string>();
      for (const line of customer.cart.lines) {
        const demand =
          runtime.merchantWorld.manifest.productDemandMechanisms.find(
            (candidate) =>
              candidate.productId === line.productId,
          );
        for (const productId of [
          ...(demand?.complementaryProductIds ?? []),
          ...(demand?.substitutionProductIds ?? []),
        ]) {
          if (
            !customer.cart.lines.some(
              (candidate) =>
                candidate.productId === productId,
            )
          ) {
            relatedProducts.add(productId);
          }
        }
      }

      if (
        relatedProducts.size > 0 &&
        randomness.bool(
          `${stepKey}:cross-sell-shown`,
          clamp(
            0.14 +
              websiteState.cart.crossSellRelevance *
                0.42,
            0,
            0.65,
          ),
        )
      ) {
        crossSellExplore = randomness.bool(
          `${stepKey}:cross-sell-explore`,
          clamp(
            websiteState.cart.crossSellRelevance *
              (0.18 + need * 0.18),
            0.02,
            0.42,
          ),
        );
        if (
          !crossSellExplore &&
          randomness.bool(
            `${stepKey}:cross-sell-distract`,
            clamp(
              (1 -
                websiteState.cart
                  .crossSellRelevance) *
                0.3,
              0,
              0.3,
            ),
          )
        ) {
          crossSellCheckoutMultiplier = 0.72;
        }
      }
    }

    const checkoutProbability =
      funnelProbability(
        runtime,
        "add_to_cart",
        "checkout",
        0.52,
      ) *
      (0.55 + intent * 0.55) *
      fillBasketMultiplier *
      crossSellCheckoutMultiplier *
      (cartExperience?.transitionMultiplier ?? 1);

    if (crossSellExplore) {
      session.currentPage = "collection";
      events.push({
        eventId: eventId(
          session.sessionId,
          `cross_sell_collection_${session.step}`,
        ),
        eventType: "collection_view",
        occurredAt: new Date(timestampMs).toISOString(),
        anonymousSubjectId: customer.customerId,
        sessionId: session.sessionId,
        source: session.source,
        device: session.device,
      });
    } else if (
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
  const delayMs =
    randomness.integer(
      `${stepKey}:delay`,
      8_000,
      130_000,
    ) +
    (startingExperience?.interactionDelayMs ?? 0);

  return {
    observableEvents: events,
    nextPage: session.currentPage,
    delayMs,
    checkoutReady,
    ...(websiteEvents.length === 0
      ? {}
      : { websiteCausalEvents: websiteEvents }),
  };
}
