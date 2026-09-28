import { describe, expect, it } from "vitest";
import { parseOperatorObservation } from "../../src/observation/corrupted-world.js";
import { MEASUREMENT_VERSION, corruptionConfigSchema, measurePerfectWorld, validatePerfectWorld,
  type CorruptionConfigInput, type PerfectObservableWorld, type PerfectEvent } from "../../src/measurement_corruption/index.js";

const start = "2026-01-01T00:00:00.000Z";
const end = "2026-01-10T00:00:00.000Z";
const at = (day: number, minute = 0) => new Date(Date.parse(start) + (day - 1) * 86400000 + minute * 60000).toISOString();
const config: CorruptionConfigInput = { version: MEASUREMENT_VERSION, seed: 88213, identitySalt: "synthetic-observation-salt-2026" };
function event(id: string, minute: number, patch: Partial<PerfectEvent> = {}): PerfectEvent {
  return { eventId: id, origin: "browser", eventType: "visit", occurredAt: at(1, minute),
    subjectId: "hidden-subject-982", subjectCreatedAt: start, sessionId: "hidden-session-a",
    knownCustomerId: "customer-account-982", source: "meta", device: "mobile",
    utmSource: "meta", utmMedium: "paid", directNavigation: false, ...patch };
}
export function fixture(): PerfectObservableWorld {
  return { schemaVersion: "perfect-observation/1.0.0", periodStart: start, periodEnd: end,
    spend: [ { id: "meta-spend-1", platform: "meta", occurredAt: at(1), amountMinor: 10000 },
      { id: "google-spend-1", platform: "google", occurredAt: at(1), amountMinor: 10000 } ],
    events: [
      event("meta-native", 1, { origin: "platform", eventType: "impression" }),
      event("meta-browser", 2),
      event("google-native", 3, { origin: "platform", eventType: "search", source: "google_search", utmSource: "google_search" }),
      event("google-browser", 4, { source: "google_search", utmSource: "google_search", eventType: "checkout_start" }),
      event("browser-purchase", 5, { eventType: "purchase", source: "google_search", utmSource: "google_search", orderId: "hidden-order-1", amountMinor: 42000 }),
      event("server-purchase", 5, { origin: "server", eventType: "purchase", source: "google_search", orderId: "hidden-order-1", amountMinor: 42000 }),
      event("repeat-mobile", 0, { occurredAt: at(2), sessionId: "hidden-session-b" }),
      event("repeat-desktop", 0, { occurredAt: at(3), sessionId: "hidden-session-c", device: "desktop" }),
      event("nonbuyer", 7, { subjectId: "hidden-subject-nonbuyer", sessionId: "nonbuyer-session", source: "organic_search", utmSource: "organic_search" }),
    ],
  };
}
const run = (patch: Partial<CorruptionConfigInput> = {}, asOf = end) => measurePerfectWorld(fixture(), { ...config, ...patch }, asOf);
const browser = (r: ReturnType<typeof run>) => r.observation.events.filter(e => e.origin === "browser");

describe("measurement corruption — one-way truth boundary", () => {
  it("zero corruption retains observations, nonbuyers and one separate server order", () => {
    const r = run();
    expect(r.observation.events).toHaveLength(9);
    expect(r.observation.orders).toHaveLength(1);
    expect(r.observation.orders[0]?.netSalesMinor).toBe(42000);
    expect(browser(r).some(e => e.occurredAt === at(1, 7))).toBe(true);
    expect(r.observation.platformReports.find(r => r.platform === "google")?.attributedRevenueMinor).toBe(42000);
    expect(r.observation.platformReports.find(r => r.platform === "meta")?.attributedRevenueMinor).toBe(0);
  });
  it("never leaks raw customer, session, event or order identities", () => {
    const wire = JSON.stringify(run().observation);
    for (const hidden of ["hidden-subject", "hidden-session", "hidden-order", "server-purchase", "customer-account", "identitySalt", "seed", "audit", "groundTruth", "latent", "causalGraph"]) {
      expect(wire).not.toContain(hidden);
    }
  });
  it("rejects latent extras instead of silently forwarding them", () => {
    const perfect = fixture();
    expect(() => validatePerfectWorld({ ...perfect, godMode: { intent: 0.82 } })).toThrow();
    expect(() => validatePerfectWorld({ ...perfect, events: [{ ...perfect.events[0], latentIntent: 0.82 }] })).toThrow();
    const safe = run().observation;
    expect(() => parseOperatorObservation({ ...safe, oracle: { best: "google" } })).toThrow();
    expect(() => parseOperatorObservation({ ...safe, events: [{ ...safe.events[0], metadata: { seed: 1 } }] })).toThrow();
    expect(() => parseOperatorObservation({ ...safe, platformReports: [{ ...safe.platformReports[0], trueRevenue: 999 }] })).toThrow();
  });
  it("does not mutate perfect facts, config or an earlier returned snapshot", () => {
    const perfect = fixture(), original = JSON.stringify(perfect), originalConfig = JSON.stringify(config);
    const first = measurePerfectWorld(perfect, config, at(2));
    const saved = JSON.stringify(first);
    measurePerfectWorld(perfect, { ...config, duplicateEventRate: 1 }, end);
    expect(JSON.stringify(perfect)).toBe(original);
    expect(JSON.stringify(config)).toBe(originalConfig);
    expect(JSON.stringify(first)).toBe(saved);
  });
});

describe("corruption mechanisms", () => {
  it("missing UTMs yield unknown, not the hidden true source", () => {
    const events = browser(run({ missingUtmRate: 1 }));
    expect(events.every(e => e.utmSource === undefined && e.utmMedium === undefined)).toBe(true);
    expect(events.every(e => e.source === "unknown")).toBe(true);
  });
  it("preserves independent click-ID evidence after UTM loss", () => {
    const world = fixture();
    const row = { ...world.events[1]!, clickId: "actual-observable-click-id" };
    const r = measurePerfectWorld({ ...world, events: [row] }, { ...config, missingUtmRate: 1 }, end);
    expect(r.observation.events[0]?.source).toBe("meta");
    expect(r.observation.events[0]?.clickId).not.toBe(row.clickId);
  });
  it("distinguishes direct fallback from unknown and genuine direct navigation", () => {
    expect(browser(run({ missingUtmRate: 1, directFallbackRate: 1 })).every(e => e.source === "direct")).toBe(true);
    const direct = event("direct", 1, { source: "direct", directNavigation: true });
    delete (direct as { utmSource?: string }).utmSource;
    delete (direct as { utmMedium?: string }).utmMedium;
    const world = { ...fixture(), events: [direct] };
    expect(measurePerfectWorld(world, config, end).observation.events[0]?.source).toBe("direct");
  });
  it("cookie loss fragments successive sessions without fragmenting within a session", () => {
    const rows = browser(run({ cookieLossRate: 1, incompleteCustomerIdentityRate: 1 }));
    const early = rows.filter(e => e.occurredAt < at(2) && e.occurredAt !== at(1, 7));
    expect(new Set(early.map(e => e.visitorId)).size).toBe(1);
    const later = rows.find(e => e.occurredAt === at(2));
    expect(later?.visitorId).not.toBe(early[0]?.visitorId);
    expect(rows.every(e => e.customerId === undefined)).toBe(true);
  });
  it("cross-device identity is split while same-device repeat visits remain linked", () => {
    const rows = browser(run({ crossDeviceIdentityRate: 1 }));
    const first = rows.find(e => e.occurredAt === at(1, 2));
    expect(rows.find(e => e.occurredAt === at(2))?.visitorId).toBe(first?.visitorId);
    expect(rows.find(e => e.occurredAt === at(3))?.visitorId).not.toBe(first?.visitorId);
  });
  it.each(["consentExclusionRate", "blockedPixelRate"] as const)("%s does not erase server accounting", field => {
    const r = run({ [field]: 1 });
    expect(browser(r)).toHaveLength(0);
    expect(r.observation.orders).toHaveLength(1);
    expect(r.observation.orders[0]?.netSalesMinor).toBe(42000);
    expect(r.observation.platformReports.every(r => r.attributedOrders === 0)).toBe(true);
  });
  it("a separately configured server conversion feed can survive blocked browser pixels", () => {
    const r = run({ blockedPixelRate: 1, serverToPlatformPurchases: true, metaOverAttributionRate: 1, googleOverAttributionRate: 1 });
    expect(r.observation.platformReports.map(r => r.attributedOrders)).toEqual([1, 1]);
    expect(r.observation.orders).toHaveLength(1);
  });
  it("models server-source loss separately from pixels", () => {
    const r = run({ serverOrderLossRate: 1 });
    expect(r.observation.orders).toHaveLength(0);
    expect(browser(r).some(e => e.eventType === "purchase")).toBe(true);
  });
  it("duplicates receipts without fabricating a second commerce order or double claiming", () => {
    const r = run({ duplicateEventRate: 1 });
    expect(r.observation.events).toHaveLength(17);
    expect(new Set(r.observation.events.map(e => e.deliveryId)).size).toBe(17);
    expect(new Set(r.observation.events.map(e => e.eventId)).size).toBe(9);
    expect(r.observation.orders).toHaveLength(1);
    expect(r.observation.platformReports.find(r => r.platform === "google")?.attributedOrders).toBe(1);
  });
  it("independent Meta and Google claims overlap without creating store revenue", () => {
    const r = run({ metaOverAttributionRate: 1, googleOverAttributionRate: 1 });
    expect(r.observation.platformReports.map(r => r.attributedRevenueMinor)).toEqual([42000, 42000]);
    expect(r.observation.orders.reduce((n, o) => n + o.netSalesMinor, 0)).toBe(42000);
  });
  it("over-attribution never uses a future touch or a channel with no eligible touch", () => {
    const world = fixture();
    const onlyGoogle = { ...world, events: world.events.filter(e => e.source !== "meta") };
    expect(measurePerfectWorld(onlyGoogle, { ...config, metaOverAttributionRate: 1 }, end).observation.platformReports[0]?.attributedOrders).toBe(0);
  });
  it("can force unknown or deliberately wrong channel classification", () => {
    expect(browser(run({ unknownTrafficRate: 1 })).every(e => e.source === "unknown")).toBe(true);
    const original = run().observation.events;
    const wrong = run({ incorrectChannelRate: 1 }).observation.events;
    for (const row of wrong.filter(e => e.origin !== "server")) {
      expect(row.source).not.toBe(original.find(e => e.eventId === row.eventId)?.source);
    }
  });
  it("missing customer identity cannot be recovered through order/event ID prefixes", () => {
    const r = run({ incompleteCustomerIdentityRate: 1 });
    expect(r.observation.events.every(e => e.customerId === undefined)).toBe(true);
    expect(r.observation.orders.every(e => e.customerId === undefined)).toBe(true);
  });
});

describe("causal-time and reproducibility invariants", () => {
  it("identical inputs are byte-identical even after another run", () => {
    const a = run({ missingUtmRate: 0.5, delayedEventRate: 0.5, duplicateEventRate: 0.5 });
    run({ seed: 992 });
    expect(run({ missingUtmRate: 0.5, delayedEventRate: 0.5, duplicateEventRate: 0.5 })).toEqual(a);
  });
  it("independent corruption streams do not perturb unrelated event identities", () => {
    const a = browser(run()), b = browser(run({ missingUtmRate: 1 }));
    expect(a.map(e => e.visitorId)).toEqual(b.map(e => e.visitorId));
    expect(a.map(e => e.deliveryId)).toEqual(b.map(e => e.deliveryId));
  });
  it("arrival cutoffs exclude delayed data; the same receipt arrives unchanged later", () => {
    const patch = { delayedEventRate: 1, maxEventDelayMs: 1000, duplicateEventRate: 1 };
    const early = run(patch, at(1, 5)), later = run(patch);
    expect(early.observation.orders).toHaveLength(0);
    expect(later.observation.orders).toHaveLength(1);
    expect(early.observation.events).toEqual(later.observation.events.filter(e => Date.parse(e.receivedAt) <= Date.parse(at(1, 5))));
  });
  it("future facts cannot change an earlier observation", () => {
    const full = fixture(), cutoff = at(1, 6);
    const prefix = { ...full, events: full.events.filter(e => Date.parse(e.occurredAt) <= Date.parse(cutoff)) };
    const patch = { ...config, cookieLossRate: 0.5, delayedEventRate: 0.5, duplicateEventRate: 1 };
    expect(measurePerfectWorld(full, patch, cutoff).observation).toEqual(measurePerfectWorld(prefix, patch, cutoff).observation);
  });
  it("report lag excludes conversions not yet reportable", () => {
    const r = run({ platformReportingDelayMs: 60000 }, at(1, 5));
    expect(r.observation.orders).toHaveLength(1);
    expect(r.observation.platformReports.every(r => r.attributedOrders === 0)).toBe(true);
  });
  it("rejects invalid rates, timestamps, duplicate facts and impossible chronology", () => {
    expect(() => corruptionConfigSchema.parse({ ...config, blockedPixelRate: -0.1 })).toThrow();
    expect(() => corruptionConfigSchema.parse({ ...config, missingUtmRate: 1.01 })).toThrow();
    expect(() => corruptionConfigSchema.parse({ ...config, seed: NaN })).toThrow();
    expect(() => run({}, "not-a-time")).toThrow();
    const world = fixture();
    expect(() => validatePerfectWorld({ ...world, events: [world.events[0], world.events[0]] })).toThrow();
    expect(() => validatePerfectWorld({ ...world, events: [{ ...world.events[0], subjectCreatedAt: at(9) }] })).toThrow();
    expect(() => validatePerfectWorld({ ...world, spend: [world.spend[0], world.spend[0]] })).toThrow();
  });
  it("rate changes preserve plausible Bernoulli frequencies over distinct subjects", () => {
    const many = Array.from({ length: 3000 }, (_, i) => event(`sample-${i}`, 1, { subjectId: `subject-${i}`, sessionId: `session-${i}` }));
    const r = measurePerfectWorld({ ...fixture(), events: many }, { ...config, consentExclusionRate: 0.3 }, end);
    const retained = r.observation.events.length / many.length;
    expect(retained).toBeGreaterThan(0.66);
    expect(retained).toBeLessThan(0.74);
  });
});
