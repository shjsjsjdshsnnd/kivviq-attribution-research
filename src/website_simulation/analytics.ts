import type {
  WebsiteAnalytics,
  WebsiteDevice,
  WebsiteObservableEvent,
  WebsiteSurface,
} from "./types.js";

const rate = (numerator: number, denominator: number): number =>
  denominator <= 0 ? 0 : numerator / denominator;

export function summarizeWebsiteAnalytics(
  events: readonly WebsiteObservableEvent[],
): WebsiteAnalytics {
  const sessions = new Set<string>();
  const progressedSessions = new Set<string>();
  const collectionSessions = new Set<string>();
  const searchSessions = new Set<string>();
  const searchToPdpSessions = new Set<string>();
  const zeroResultSearchSessions = new Set<string>();
  const pdpSessions = new Set<string>();
  const cartSessions = new Set<string>();
  const checkoutSessions = new Set<string>();
  const purchaseSessions = new Set<string>();
  const deviceSessions: Record<WebsiteDevice, Set<string>> = {
    mobile: new Set(),
    desktop: new Set(),
    tablet: new Set(),
  };
  const devicePurchases: Record<WebsiteDevice, Set<string>> = {
    mobile: new Set(),
    desktop: new Set(),
    tablet: new Set(),
  };
  const sessionDevice = new Map<string, WebsiteDevice>();
  const loadTotals = new Map<
    WebsiteSurface,
    { total: number; count: number }
  >();

  let pdpViews = 0;
  let addToCart = 0;
  let couponAttempts = 0;
  let couponFailures = 0;
  let paymentErrors = 0;

  for (const event of events) {
    const sessionId = event.sessionId;
    if (sessionId !== undefined) {
      sessions.add(sessionId);
      if (event.device !== undefined) {
        sessionDevice.set(sessionId, event.device);
        deviceSessions[event.device].add(sessionId);
      }
    }

    if (
      event.surface !== undefined &&
      event.pageLoadTimeMs !== undefined &&
      Number.isFinite(event.pageLoadTimeMs)
    ) {
      const current = loadTotals.get(event.surface) ?? {
        total: 0,
        count: 0,
      };
      current.total += event.pageLoadTimeMs;
      current.count += 1;
      loadTotals.set(event.surface, current);
    }

    if (sessionId === undefined) continue;

    if (
      event.eventType === "collection_view" ||
      event.eventType === "search_performed" ||
      event.eventType === "site_search" ||
      event.eventType === "product_view" ||
      event.eventType === "add_to_cart" ||
      event.eventType === "cart_viewed" ||
      event.eventType === "checkout_start" ||
      event.eventType === "purchase" ||
      event.eventType === "purchase_completed"
    ) {
      progressedSessions.add(sessionId);
    }

    if (event.eventType === "collection_view") {
      collectionSessions.add(sessionId);
    }
    if (
      event.eventType === "site_search" ||
      event.eventType === "search_performed" ||
      event.eventType === "search_results_viewed"
    ) {
      searchSessions.add(sessionId);
      if (event.searchZeroResults === true) {
        zeroResultSearchSessions.add(sessionId);
      }
    }
    if (event.eventType === "product_view") {
      pdpViews += 1;
      pdpSessions.add(sessionId);
      if (searchSessions.has(sessionId)) {
        searchToPdpSessions.add(sessionId);
      }
    }
    if (event.eventType === "add_to_cart") {
      addToCart += 1;
    }
    if (event.eventType === "cart_viewed") {
      cartSessions.add(sessionId);
    }
    if (event.eventType === "checkout_start") {
      checkoutSessions.add(sessionId);
    }
    if (
      event.eventType === "purchase" ||
      event.eventType === "purchase_completed"
    ) {
      purchaseSessions.add(sessionId);
      const device = sessionDevice.get(sessionId);
      if (device !== undefined) {
        devicePurchases[device].add(sessionId);
      }
    }
    if (
      event.eventType === "coupon_applied" ||
      event.eventType === "coupon_failed"
    ) {
      couponAttempts += 1;
      if (event.eventType === "coupon_failed") {
        couponFailures += 1;
      }
    }
    if (event.eventType === "payment_failed") {
      paymentErrors += 1;
    }
  }

  const collectionToPdp = [...collectionSessions].filter(
    (sessionId) => pdpSessions.has(sessionId),
  ).length;
  const searchExits = [...searchSessions].filter(
    (sessionId) => !searchToPdpSessions.has(sessionId),
  ).length;

  const averagePageLoadMs: Partial<Record<WebsiteSurface, number>> = {};
  for (const [surface, values] of loadTotals) {
    averagePageLoadMs[surface] =
      values.count <= 0 ? 0 : values.total / values.count;
  }

  return {
    sessions: sessions.size,
    bounceRate: rate(
      [...sessions].filter(
        (sessionId) => !progressedSessions.has(sessionId),
      ).length,
      sessions.size,
    ),
    collectionToPdpRate: rate(
      collectionToPdp,
      collectionSessions.size,
    ),
    searchUsageRate: rate(searchSessions.size, sessions.size),
    searchExitRate: rate(searchExits, searchSessions.size),
    zeroResultSearchRate: rate(
      zeroResultSearchSessions.size,
      searchSessions.size,
    ),
    pdpViews,
    addToCartRate: rate(addToCart, pdpViews),
    cartToCheckoutRate: rate(
      checkoutSessions.size,
      cartSessions.size,
    ),
    checkoutToPurchaseRate: rate(
      [...checkoutSessions].filter(
        (sessionId) => purchaseSessions.has(sessionId),
      ).length,
      checkoutSessions.size,
    ),
    conversionRate: rate(purchaseSessions.size, sessions.size),
    deviceConversion: {
      mobile: rate(
        devicePurchases.mobile.size,
        deviceSessions.mobile.size,
      ),
      desktop: rate(
        devicePurchases.desktop.size,
        deviceSessions.desktop.size,
      ),
      tablet: rate(
        devicePurchases.tablet.size,
        deviceSessions.tablet.size,
      ),
    },
    averagePageLoadMs,
    couponAttempts,
    couponFailures,
    couponFailureRate: rate(couponFailures, couponAttempts),
    paymentErrors,
  };
}
