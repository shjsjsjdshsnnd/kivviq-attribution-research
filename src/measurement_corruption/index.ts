import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  observedEventSchema, observedSourceSchema, observationTimeSchema,
  observationMoneySchema, parseOperatorObservation,
  type CorruptedEvent, type CorruptedObservation, type ObservedSource,
} from "../observation/corrupted-world.js";

export const MEASUREMENT_VERSION = "measurement-corruption/1.0.0" as const;
const identifier = z.string().min(1).max(256);
const probability = z.number().finite().min(0).max(1);
const millis = z.number().int().nonnegative().max(366 * 86400000);
export const corruptionConfigSchema = z.object({
  version: z.literal(MEASUREMENT_VERSION),
  seed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  identitySalt: z.string().min(16).max(256),
  missingUtmRate: probability.default(0),
  cookieLossRate: probability.default(0),
  consentExclusionRate: probability.default(0),
  duplicateEventRate: probability.default(0),
  blockedPixelRate: probability.default(0),
  crossDeviceIdentityRate: probability.default(0),
  delayedEventRate: probability.default(0),
  maxEventDelayMs: millis.default(86400000),
  metaOverAttributionRate: probability.default(0),
  googleOverAttributionRate: probability.default(0),
  directFallbackRate: probability.default(0),
  unknownTrafficRate: probability.default(0),
  incompleteCustomerIdentityRate: probability.default(0),
  incorrectChannelRate: probability.default(0),
  serverOrderLossRate: probability.default(0),
  platformReportingDelayMs: millis.default(0),
  attributionLookbackMs: millis.default(30 * 86400000),
  /** Explicitly model a server conversion feed; never infer it from a blocked pixel. */
  serverToPlatformPurchases: z.boolean().default(false),
}).strict();
export type CorruptionConfig = z.infer<typeof corruptionConfigSchema>;
export type CorruptionConfigInput = z.input<typeof corruptionConfigSchema>;

/** Perfect observable facts, NOT latent intent/effect sizes or a SimulationResult. */
export const perfectEventSchema = observedEventSchema.pick({
  eventId: true, origin: true, eventType: true, occurredAt: true,
  device: true, productId: true, orderId: true, amountMinor: true,
  utmSource: true, utmMedium: true, clickId: true,
}).extend({
  subjectId: identifier,
  subjectCreatedAt: observationTimeSchema,
  sessionId: identifier.optional(),
  knownCustomerId: identifier.optional(),
  source: observedSourceSchema,
  referrerSource: observedSourceSchema.optional(),
  directNavigation: z.boolean().default(false),
}).strict();
export type PerfectEvent = z.infer<typeof perfectEventSchema>;
export const perfectWorldSchema = z.object({
  schemaVersion: z.literal("perfect-observation/1.0.0"),
  periodStart: observationTimeSchema,
  periodEnd: observationTimeSchema,
  events: z.array(perfectEventSchema),
  spend: z.array(z.object({
    id: identifier, platform: z.enum(["meta", "google"]),
    occurredAt: observationTimeSchema, amountMinor: observationMoneySchema,
  }).strict()),
}).strict();
export type PerfectObservableWorld = z.infer<typeof perfectWorldSchema>;
export interface CorruptionAuditRow {
  readonly eventId: string;
  readonly subjectId: string;
  readonly reasons: readonly string[];
  readonly deliveryIds: readonly string[];
  readonly receivedAt?: string;
  readonly observedVisitorId?: string;
}
export interface MeasurementResult {
  readonly observation: CorruptedObservation;
  /** Entire audit/config/crosswalk is evaluator-only. */
  readonly audit: {
    readonly version: typeof MEASUREMENT_VERSION;
    readonly config: CorruptionConfig;
    readonly asOf: string;
    readonly rows: readonly CorruptionAuditRow[];
  };
}

function stamp(value: string): number {
  observationTimeSchema.parse(value);
  return Date.parse(value);
}
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function platform(source: ObservedSource): "meta" | "google" | undefined {
  if (source === "meta") return "meta";
  if (source === "google_search" || source === "google_shopping") return "google";
  return undefined;
}
function safeSum(values: readonly number[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum)) throw new RangeError("measurement money exceeds safe integer range");
  return sum;
}

export function validatePerfectWorld(value: unknown): PerfectObservableWorld {
  const world = perfectWorldSchema.parse(value);
  const start = stamp(world.periodStart), end = stamp(world.periodEnd);
  if (end <= start) throw new RangeError("perfect observation period must increase");
  const ids = new Set<string>(), spendIds = new Set<string>();
  const serverOrders = new Map<string, string>();
  for (const event of world.events) {
    const time = stamp(event.occurredAt);
    if (time < start || time >= end || time < stamp(event.subjectCreatedAt)) {
      throw new RangeError("event precedes subject creation or falls outside perfect period");
    }
    if (ids.has(event.eventId)) throw new RangeError("perfect event IDs must be unique");
    ids.add(event.eventId);
    if (event.origin === "server" && event.eventType === "purchase") {
      if (event.orderId === undefined || event.amountMinor === undefined) {
        throw new RangeError("server purchase requires order ID and net merchandise sales");
      }
      const identity = JSON.stringify([event.subjectId, event.occurredAt, event.amountMinor]);
      const previous = serverOrders.get(event.orderId);
      if (previous !== undefined && previous !== identity) throw new RangeError("conflicting server order facts");
      serverOrders.set(event.orderId, identity);
    }
  }
  for (const fact of world.spend) {
    if (spendIds.has(fact.id)) throw new RangeError("duplicate spend fact");
    spendIds.add(fact.id);
    if (stamp(fact.occurredAt) < start || stamp(fact.occurredAt) >= end) throw new RangeError("spend outside period");
  }
  return world;
}

/** Pure measurement channel. It never reads or changes a latent simulator state. */
export function measurePerfectWorld(
  input: unknown,
  configInput: CorruptionConfigInput,
  asOf: string,
): MeasurementResult {
  const world = validatePerfectWorld(input);
  const config = corruptionConfigSchema.parse(configInput);
  const cutoff = stamp(asOf);
  if (cutoff < stamp(world.periodStart) || cutoff > stamp(world.periodEnd)) throw new RangeError("as-of outside perfect period");
  const key = `${config.identitySalt}|${config.seed}|${MEASUREMENT_VERSION}`;
  const digest = (namespace: string, value: string): string =>
    createHmac("sha256", key).update(JSON.stringify([namespace, value])).digest("hex");
  const opaque = (namespace: string, value: string): string => digest(namespace, value).slice(0, 32);
  const draw = (namespace: string, value: string): number =>
    parseInt(digest(namespace, value).slice(0, 13), 16) / 4503599627370496;
  const hit = (namespace: string, value: string, rate: number): boolean => draw(namespace, value) < rate;
  const eligible = world.events.filter(e => stamp(e.occurredAt) <= cutoff).sort((a, b) =>
    stamp(a.occurredAt) - stamp(b.occurredAt) || compareText(a.eventId, b.eventId));
  const events: CorruptedEvent[] = [];
  const audit: CorruptionAuditRow[] = [];
  const nativeReceipts: { raw: PerfectEvent; observed: CorruptedEvent }[] = [];
  const visitorForSession = new Map<string, string>();
  const currentCookie = new Map<string, string>();

  for (const raw of eligible) {
    const reasons: string[] = [];
    const consent = hit("consent", raw.subjectId, config.consentExclusionRate);
    const blocked = raw.origin === "browser" && hit("pixel", raw.sessionId ?? raw.eventId, config.blockedPixelRate);
    const serverLost = raw.origin === "server" && hit("server-loss", raw.orderId ?? raw.eventId, config.serverOrderLossRate);
    if (raw.origin === "browser" && consent) reasons.push("consent_excluded");
    if (blocked) reasons.push("blocked_pixel");
    if (serverLost) reasons.push("server_source_loss");
    if ((raw.origin === "browser" && consent) || blocked || serverLost) {
      audit.push({ eventId: raw.eventId, subjectId: raw.subjectId, reasons, deliveryIds: [] });
      continue;
    }
    let visitorId: string | undefined;
    let sessionId: string | undefined;
    if (raw.origin === "browser") {
      const split = hit("cross-device", raw.subjectId, config.crossDeviceIdentityRate);
      const scope = JSON.stringify([raw.subjectId, split ? raw.device ?? "unknown-device" : "all-devices"]);
      const sessionKey = JSON.stringify([scope, raw.sessionId ?? raw.eventId]);
      let cookie = visitorForSession.get(sessionKey);
      if (cookie === undefined) {
        cookie = currentCookie.get(scope) ?? scope;
        if (hit("cookie-loss", sessionKey, config.cookieLossRate)) {
          cookie = sessionKey;
        }
        currentCookie.set(scope, cookie);
        visitorForSession.set(sessionKey, cookie);
      }
      visitorId = opaque("visitor", cookie);
      sessionId = opaque("session", sessionKey);
      if (split) reasons.push("cross_device_fragmentation");
      if (cookie !== scope) reasons.push("cookie_fragmentation");
    }
    let customerId: string | undefined;
    if (raw.knownCustomerId !== undefined) {
      if (hit("customer-identity", raw.subjectId, config.incompleteCustomerIdentityRate)) {
        reasons.push("incomplete_customer_identity");
      } else customerId = opaque("known-customer", raw.knownCustomerId);
    }
    const missingUtm = raw.origin === "browser" && hit("utm", raw.sessionId ?? raw.eventId, config.missingUtmRate);
    const utmSource = missingUtm ? undefined : raw.utmSource;
    const utmMedium = missingUtm ? undefined : raw.utmMedium;
    if (missingUtm && (raw.utmSource !== undefined || raw.utmMedium !== undefined)) reasons.push("missing_utms");
    let source: ObservedSource;
    if (raw.origin === "server") source = "unknown";
    else if (raw.origin === "platform" || raw.clickId !== undefined) source = raw.source;
    else if (utmSource !== undefined && observedSourceSchema.safeParse(utmSource).success) source = observedSourceSchema.parse(utmSource);
    else if (raw.referrerSource !== undefined) source = raw.referrerSource;
    else if (raw.directNavigation) source = "direct";
    else {
      source = hit("direct-fallback", raw.sessionId ?? raw.eventId, config.directFallbackRate) ? "direct" : "unknown";
      reasons.push(source === "direct" ? "direct_fallback" : "unknown_source");
    }
    if (raw.origin !== "server" && hit("classification", raw.eventId, config.incorrectChannelRate)) {
      const alternatives = observedSourceSchema.options.filter(candidate => candidate !== source);
      source = alternatives[Math.floor(draw("classification-choice", raw.eventId) * alternatives.length)]!;
      reasons.push("incorrect_channel_classification");
    }
    if (raw.origin !== "server" && hit("unknown", raw.eventId, config.unknownTrafficRate)) {
      source = "unknown";
      reasons.push("unknown_traffic");
    }
    const delay = hit("delay", raw.eventId, config.delayedEventRate)
      ? 1 + Math.floor(draw("delay-length", raw.eventId) * Math.max(1, config.maxEventDelayMs)) : 0;
    const delayMs = config.maxEventDelayMs === 0 ? 0 : delay;
    const receiveMs = stamp(raw.occurredAt) + delayMs;
    if (delayMs > 0) reasons.push("delayed_arrival");
    const receivedAt = new Date(receiveMs).toISOString();
    const duplicates = raw.origin !== "server" && hit("duplicate", raw.eventId, config.duplicateEventRate);
    if (duplicates) reasons.push("duplicate_delivery");
    const deliveryIds: string[] = [];
    for (let copy = 0; copy < (duplicates ? 2 : 1); copy += 1) {
      // Both deliveries share a semantic event ID, but have independent opaque receipt IDs.
      const deliveryId = opaque("receipt", JSON.stringify([raw.eventId, copy]));
      if (receiveMs + copy > cutoff) continue;
      const observed = observedEventSchema.parse({
        eventId: opaque("event", raw.eventId), deliveryId,
        origin: raw.origin, eventType: raw.eventType, occurredAt: raw.occurredAt,
        receivedAt: new Date(receiveMs + copy).toISOString(), source,
        ...(visitorId === undefined ? {} : { visitorId }),
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(customerId === undefined ? {} : { customerId }),
        ...(raw.device === undefined ? {} : { device: raw.device }),
        ...(raw.productId === undefined ? {} : { productId: raw.productId }),
        ...(raw.orderId === undefined ? {} : { orderId: opaque("order", raw.orderId) }),
        ...(raw.amountMinor === undefined ? {} : { amountMinor: raw.amountMinor }),
        ...(utmSource === undefined ? {} : { utmSource }),
        ...(utmMedium === undefined ? {} : { utmMedium }),
        ...(raw.clickId === undefined ? {} : { clickId: opaque("click", raw.clickId) }),
      });
      events.push(observed);
      deliveryIds.push(deliveryId);
      if (copy === 0) nativeReceipts.push({ raw, observed });
    }
    audit.push({ eventId: raw.eventId, subjectId: raw.subjectId, reasons, deliveryIds,
      receivedAt, ...(visitorId === undefined ? {} : { observedVisitorId: visitorId }) });
  }
  events.sort((a, b) => stamp(a.receivedAt) - stamp(b.receivedAt) || compareText(a.deliveryId, b.deliveryId));
  const orderById = new Map<string, CorruptedObservation["orders"][number]>();
  for (const event of events) {
    if (event.origin !== "server" || event.eventType !== "purchase" || event.orderId === undefined || event.amountMinor === undefined) continue;
    if (!orderById.has(event.orderId)) orderById.set(event.orderId, {
      orderId: event.orderId, occurredAt: event.occurredAt, receivedAt: event.receivedAt,
      netSalesMinor: event.amountMinor,
      ...(event.customerId === undefined ? {} : { customerId: event.customerId }),
    });
  }
  const reports: CorruptedObservation["platformReports"] = [];
  const reportEnd = cutoff - config.platformReportingDelayMs;
  if (reportEnd >= stamp(world.periodStart)) {
    const visibleToPlatforms = nativeReceipts.filter(e => stamp(e.observed.receivedAt) <= reportEnd);
    const orders = new Map<string, PerfectEvent>();
    for (const { raw } of visibleToPlatforms) {
      const nativeConversion = raw.origin === "browser" || (raw.origin === "server" && config.serverToPlatformPurchases);
      if (nativeConversion && raw.eventType === "purchase" && raw.orderId !== undefined && raw.amountMinor !== undefined) orders.set(raw.orderId, raw);
    }
    for (const name of ["meta", "google"] as const) {
      let count = 0;
      const claimedRevenue: number[] = [];
      for (const [orderId, order] of orders) {
        const purchaseMs = stamp(order.occurredAt);
        const touches = visibleToPlatforms.filter(({ raw }) => raw.subjectId === order.subjectId &&
          raw.origin !== "server" && raw.eventType !== "purchase" && raw.eventType !== "session_end" &&
          stamp(raw.occurredAt) <= purchaseMs && stamp(raw.occurredAt) >= purchaseMs - config.attributionLookbackMs);
        const ownTouches = touches.filter(e => platform(e.raw.source) === name);
        if (ownTouches.length === 0) continue;
        const last = touches[touches.length - 1];
        const lastTouchClaim = last !== undefined && platform(last.raw.source) === name;
        const extraClaim = hit(`over-attribution:${name}`, orderId,
          name === "meta" ? config.metaOverAttributionRate : config.googleOverAttributionRate);
        if (lastTouchClaim || extraClaim) { count += 1; claimedRevenue.push(order.amountMinor!); }
      }
      reports.push({ platform: name, periodStart: world.periodStart,
        periodEnd: new Date(reportEnd).toISOString(), availableAt: asOf,
        spendMinor: safeSum(world.spend.filter(f => f.platform === name && stamp(f.occurredAt) <= reportEnd).map(f => f.amountMinor)),
        attributedOrders: count, attributedRevenueMinor: safeSum(claimedRevenue) });
    }
  }
  const observation = parseOperatorObservation({ schemaVersion: "corrupted-observation/1.0.0",
    asOf, events, orders: [...orderById.values()].sort((a, b) => compareText(a.orderId, b.orderId)), platformReports: reports });
  return { observation, audit: { version: MEASUREMENT_VERSION, config, asOf, rows: audit } };
}
