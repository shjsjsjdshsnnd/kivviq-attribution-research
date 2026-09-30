import { z } from "zod";

/** This module is Operator-safe: it cannot import simulator or evaluator code. */
export const observedSourceSchema = z.enum([
  "meta", "google_search", "google_shopping", "pinterest", "email", "sms",
  "affiliate", "organic_search", "direct", "referral", "unknown",
]);
export type ObservedSource = z.infer<typeof observedSourceSchema>;
export const observationTimeSchema = z.string().datetime({ offset: true });
export const observationMoneySchema = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const id = z.string().min(1).max(256);
export const observedEventSchema = z.object({
  eventId: id,
  deliveryId: id,
  origin: z.enum(["browser", "server", "platform"]),
  eventType: z.enum([
    "impression", "email_open", "sms_open", "search", "visit", "session_start",
    "landing_page_view", "page_performance", "collection_view", "site_search",
    "search_zero_result", "search_reformulation", "product_view", "cart_view",
    "add_to_cart", "remove_from_cart", "checkout_start", "checkout_stage",
    "coupon_search", "coupon_attempt", "coupon_invalid", "coupon_error",
    "shipping_cost_reveal", "payment_failure", "address_validation_failure",
    "checkout_abandon", "purchase", "session_end",
  ]),
  occurredAt: observationTimeSchema,
  receivedAt: observationTimeSchema,
  visitorId: id.optional(),
  sessionId: id.optional(),
  customerId: id.optional(),
  source: observedSourceSchema,
  device: z.enum(["mobile", "desktop", "tablet"]).optional(),
  productId: id.optional(),
  orderId: id.optional(),
  amountMinor: observationMoneySchema.optional(),
  utmSource: id.optional(),
  utmMedium: id.optional(),
  clickId: id.optional(),
}).strict();
export type CorruptedEvent = z.infer<typeof observedEventSchema>;
export const observedOrderSchema = z.object({
  orderId: id,
  occurredAt: observationTimeSchema,
  receivedAt: observationTimeSchema,
  netSalesMinor: observationMoneySchema,
  customerId: id.optional(),
}).strict();
export const observedPlatformReportSchema = z.object({
  platform: z.enum(["meta", "google"]),
  periodStart: observationTimeSchema,
  periodEnd: observationTimeSchema,
  availableAt: observationTimeSchema,
  spendMinor: observationMoneySchema,
  attributedOrders: z.number().int().nonnegative(),
  attributedRevenueMinor: observationMoneySchema,
}).strict();
export const operatorObservationSchema = z.object({
  schemaVersion: z.literal("corrupted-observation/1.0.0"),
  asOf: observationTimeSchema,
  events: z.array(observedEventSchema),
  orders: z.array(observedOrderSchema),
  platformReports: z.array(observedPlatformReportSchema),
}).strict();
export type CorruptedObservation = z.infer<typeof operatorObservationSchema>;

/** Reject extra keys at every depth, including oracle/truth disguised as metadata. */
export function parseOperatorObservation(value: unknown): CorruptedObservation {
  const parsed = operatorObservationSchema.parse(value);
  const cutoff = Date.parse(parsed.asOf);
  const receipts = new Set<string>();
  for (const event of parsed.events) {
    if (Date.parse(event.occurredAt) > Date.parse(event.receivedAt) ||
        Date.parse(event.receivedAt) > cutoff) {
      throw new RangeError("observation violates event/arrival/as-of chronology");
    }
    if (receipts.has(event.deliveryId)) throw new RangeError("duplicate delivery receipt ID");
    receipts.add(event.deliveryId);
  }
  const orders = new Set<string>();
  for (const order of parsed.orders) {
    if (orders.has(order.orderId)) throw new RangeError("duplicate commerce order ID");
    orders.add(order.orderId);
    if (Date.parse(order.occurredAt) > Date.parse(order.receivedAt) ||
        Date.parse(order.receivedAt) > cutoff) throw new RangeError("invalid order chronology");
  }
  for (const report of parsed.platformReports) {
    if (Date.parse(report.periodStart) > Date.parse(report.periodEnd) ||
        Date.parse(report.periodEnd) > Date.parse(report.availableAt) ||
        Date.parse(report.availableAt) > cutoff) throw new RangeError("invalid report chronology");
  }
  return parsed;
}
