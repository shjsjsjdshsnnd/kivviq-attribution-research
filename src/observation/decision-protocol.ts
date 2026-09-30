import { z } from "zod";
import { operatorObservationSchema, parseOperatorObservation, observationTimeSchema } from "./corrupted-world.js";

export const DECISION_PROTOCOL_VERSION = "blind-decision/1.0.0" as const;
export const decisionOfferSchema = z.object({
  version: z.literal(DECISION_PROTOCOL_VERSION), decisionId: z.string().min(1).max(128),
  currency: z.string().regex(/^[A-Z]{3}$/), decisionAt: observationTimeSchema, evaluationEnd: observationTimeSchema,
  objective: z.literal("future_booked_contribution"),
  observation: operatorObservationSchema,
  /** Merchant-facing descriptions, never scenario labels, inferred values or oracle ranks. */
  actions: z.array(z.object({ actionId: z.string().min(1).max(128), description: z.string().min(1).max(512) }).strict()).min(1),
}).strict();
export const decisionChoiceSchema = z.object({
  version: z.literal(DECISION_PROTOCOL_VERSION), decisionId: z.string().min(1).max(128), actionId: z.string().min(1).max(128),
}).strict();
export type DecisionOffer = z.infer<typeof decisionOfferSchema>;
export function parseDecisionOffer(value: unknown): DecisionOffer {
  const offer = decisionOfferSchema.parse(value);
  parseOperatorObservation(offer.observation);
  if (offer.observation.asOf !== offer.decisionAt || Date.parse(offer.evaluationEnd) <= Date.parse(offer.decisionAt) ||
      new Set(offer.actions.map(a => a.actionId)).size !== offer.actions.length) throw new RangeError("invalid decision window or action menu");
  return offer;
}
