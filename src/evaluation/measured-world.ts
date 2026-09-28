import { createHash } from "node:crypto";
import { simulateWorld } from "../simulation/simulator.js";
import type { SimulateWorldRequest, SimulationResult } from "../simulation/types.js";
import { measurePerfectWorld, validatePerfectWorld,
  type CorruptionConfigInput, type MeasurementResult, type PerfectEvent,
  type PerfectObservableWorld } from "../measurement_corruption/index.js";
import { parseOperatorObservation, type CorruptedObservation,
  type ObservedSource } from "../observation/corrupted-world.js";

export interface MeasurementRunOptions {
  readonly corruption: CorruptionConfigInput;
  readonly asOf: string;
  /** Required explicit ledger. Never infer spend from attributed revenue or order count. */
  readonly platformSpend: PerfectObservableWorld["spend"];
  readonly scope: "explicit_simulated_agents";
}

/** This entire object belongs to the evaluator, never to an Operator process. */
export interface EvaluatorWorldBundle {
  readonly access: "evaluator_only";
  readonly currency: string;
  readonly measurementScope: "explicit_simulated_agents";
  readonly latentTruth: {
    readonly request: SimulateWorldRequest;
    readonly simulation: SimulationResult;
  };
  readonly perfectObservableTruth: PerfectObservableWorld;
  readonly corruptedObservation: CorruptedObservation;
  readonly measurementDiagnostics: MeasurementResult["audit"];
}

/**
 * Synthetic ideal sensor adapter, not a causal attribution calculation.
 * The source attached to a simulated event represents observable routing evidence.
 * Ideal tagged traffic receives UTMs; click IDs are NOT invented as fallback
 * when those UTMs are subsequently lost. Native impressions are a separate feed.
 *
 * The current simulator creates its entire explicit population at startTime.
 * Weighted-population totals and latent traits are deliberately not projected.
 */
export function perfectFactsFromSimulation(
  request: SimulateWorldRequest,
  result: SimulationResult,
  platformSpend: PerfectObservableWorld["spend"],
): PerfectObservableWorld {
  if (result.provenance.merchantWorldId !== request.merchantWorld.manifest.worldId ||
      result.provenance.simulationSeed !== request.simulationSeed ||
      result.provenance.startTime !== request.startTime ||
      result.provenance.endTime !== request.endTime) {
    throw new RangeError("simulation result and measurement request do not match");
  }
  const start = Date.parse(request.startTime), end = Date.parse(request.endTime);
  const knownSubjects = new Set(request.latentPopulation.customers.map(c => c.customerId));
  const tagged = new Set<ObservedSource>(["meta", "google_search", "google_shopping", "pinterest", "email", "sms", "affiliate"]);
  const nativeKinds = new Set(["impression", "email_open", "sms_open"]);
  const events: PerfectEvent[] = [];
  for (const event of result.observableEvents) {
    const time = Date.parse(event.occurredAt);
    // The existing kernel includes its end instant; the measurement feed is [start,end).
    if (time === end) continue;
    if (time < start || time > end || !knownSubjects.has(event.anonymousSubjectId)) {
      throw new RangeError("observable event lies outside this explicit population/window");
    }
    const source: ObservedSource = event.source ?? event.channel ?? "unknown";
    const origin = nativeKinds.has(event.eventType) ? "platform" as const : "browser" as const;
    // Legacy repeat-purchase cycles reuse some IDs on different dates. Preserve
    // every occurrence with a prefix-stable compound identity; do not deduplicate
    // by legacy ID or use a whole-run array index that could shift on replay.
    // An exact repeated (ID,time,type,subject) is still rejected by validation.
    const occurrenceId = createHash("sha256").update(JSON.stringify([
      event.eventId, event.occurredAt, event.eventType, event.anonymousSubjectId,
    ])).digest("hex");
    events.push({
      eventId: `journey:${occurrenceId}`, origin, eventType: event.eventType,
      occurredAt: event.occurredAt, subjectCreatedAt: request.startTime,
      subjectId: event.anonymousSubjectId, source,
      directNavigation: source === "direct",
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      ...(event.device === undefined ? {} : { device: event.device }),
      ...(event.productId === undefined ? {} : { productId: event.productId }),
      ...(event.orderId === undefined ? {} : { orderId: event.orderId }),
      ...(event.amountMinor === undefined ? {} : { amountMinor: event.amountMinor }),
      ...(tagged.has(source) ? { utmSource: source, utmMedium: source === "email" || source === "sms" ? source : "paid" } : {}),
      ...(source === "organic_search" || source === "referral" ? { referrerSource: source } : {}),
    });
  }
  for (const order of result.purchases) {
    const time = Date.parse(order.occurredAt);
    if (time === end) continue;
    if (time < start || time > end || !knownSubjects.has(order.customerId)) {
      throw new RangeError("order lies outside this explicit population/window");
    }
    events.push({
      eventId: `server-order:${order.orderId}`, origin: "server", eventType: "purchase",
      occurredAt: order.occurredAt, subjectCreatedAt: request.startTime,
      subjectId: order.customerId, knownCustomerId: order.customerId,
      orderId: order.orderId, amountMinor: order.netRevenueMinor,
      source: "unknown", directNavigation: false,
    });
  }
  return validatePerfectWorld({
    schemaVersion: "perfect-observation/1.0.0", periodStart: request.startTime,
    periodEnd: request.endTime, events, spend: platformSpend,
  });
}

export function runMeasuredWorld(
  requestInput: SimulateWorldRequest,
  options: MeasurementRunOptions,
): EvaluatorWorldBundle {
  if (options.scope !== "explicit_simulated_agents") throw new RangeError("unsupported measurement accounting scope");
  const request = structuredClone(requestInput);
  const simulation = simulateWorld(request);
  const perfect = perfectFactsFromSimulation(request, simulation, options.platformSpend);
  const measured = measurePerfectWorld(perfect, options.corruption, options.asOf);
  return {
    access: "evaluator_only", currency: request.merchantWorld.manifest.merchant.currency,
    measurementScope: options.scope,
    latentTruth: { request, simulation }, perfectObservableTruth: perfect,
    corruptedObservation: measured.observation, measurementDiagnostics: measured.audit,
  };
}

/** Only this allowlisted JSON payload crosses into the Operator's isolated process. */
export function operatorPayload(bundle: EvaluatorWorldBundle): string {
  return JSON.stringify(parseOperatorObservation(bundle.corruptedObservation));
}
