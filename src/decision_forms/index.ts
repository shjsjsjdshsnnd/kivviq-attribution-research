import { z } from "zod";
import type { TimingDuration } from "../action_timing/types.js";
export const decisionIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const id = decisionIdSchema;
const family = z.enum([
  "PAID_MEDIA",
  "PRICING",
  "PROMOTION",
  "SHIPPING",
  "MERCHANDISING",
  "INVENTORY",
  "CRO",
  "LIFECYCLE",
]);
export const decisionScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("GLOBAL") }).strict(),
  z.object({ kind: z.literal("FAMILY"), family }).strict(),
  ...(["CHANNEL", "CAMPAIGN", "PRODUCT", "SKU"] as const).map((kind) =>
    z
      .object({ kind: z.literal(kind), ref: id, family: family.optional() })
      .strict(),
  ),
  z
    .object({ kind: z.literal("POPULATION"), family: family.optional() })
    .strict(),
]);
const anchor = z.enum(["DECISION_TIME", "REQUESTED_START", "EFFECTIVE_START"]);
/** Finite subset of the shared TimingDuration contract; an investigation must end. */
export const investigationDurationSchema = z.union([
  z
    .object({
      kind: z.literal("ELAPSED"),
      amount: z.number().positive().finite(),
      unit: z.enum(["SECOND", "MINUTE", "HOUR"]),
      anchor,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CALENDAR"),
      amount: z.number().int().positive(),
      unit: z.enum(["DAY", "WEEK", "MONTH"]),
      anchor,
    })
    .strict(),
]) satisfies z.ZodType<TimingDuration>;
export const observationWindowSchema = z
  .object({ start: z.string().datetime(), end: z.string().datetime() })
  .strict()
  .refine(
    (v) => Date.parse(v.start) < Date.parse(v.end),
    "Observation window must increase",
  );
export const evidenceReferenceSchema = z
  .object({ kind: z.enum(["METRIC", "FACT"]), ref: id })
  .strict();
export const investigationCategorySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.enum([
        "TRACKING_AUDIT",
        "DATA_QUALITY_CHECK",
        "MISSING_DATA_REQUEST",
        "ANOMALY_DIAGNOSIS",
        "METRIC_RECONCILIATION",
        "BUSINESS_PROCESS_CHECK",
        "MEASUREMENT_VALIDATION",
      ]),
    })
    .strict(),
  z.object({ kind: z.literal("CUSTOM"), registryRef: id, code: id }).strict(),
]);
const cost = z.discriminatedUnion("state", [
  z.object({ state: z.literal("UNKNOWN") }).strict(),
  z
    .object({
      state: z.literal("KNOWN"),
      amountMinor: z.number().int().nonnegative().safe(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
]);
export const noOpWhatSchema = z
  .object({
    actionType: z.literal("no_op.do_nothing"),
    scope: decisionScopeSchema,
  })
  .strict();
export const waitObserveWhatSchema = z
  .object({
    actionType: z.literal("no_op.wait_observe"),
    scope: decisionScopeSchema,
    reassessment: z
      .object({
        kind: z.literal("AFTER_OBSERVATION"),
        duration: investigationDurationSchema,
      })
      .strict(),
  })
  .strict();
const investigationObjectSchema = z
  .object({
    actionType: z.literal("investigation.inspect"),
    category: investigationCategorySchema,
    targets: z
      .array(
        z
          .object({
            kind: z.enum([
              "DATA_SOURCE",
              "METRIC",
              "CHANNEL",
              "CAMPAIGN",
              "PRODUCT",
              "SKU",
              "FUNNEL_STAGE",
              "TRACKING_IMPLEMENTATION",
              "CUSTOMER_JOURNEY",
              "INVENTORY_FACT",
              "ECONOMIC_INPUT",
              "ANOMALOUS_EVENT",
              "POPULATION",
            ]),
            ref: id,
          })
          .strict(),
      )
      .min(1),
    requiredEvidence: z
      .array(
        z
          .object({
            evidenceId: id,
            reference: evidenceReferenceSchema,
            targetRef: id,
          })
          .strict(),
      )
      .min(1),
    successCriteria: z
      .array(
        z
          .object({
            kind: z.literal("EVIDENCE_COVERAGE"),
            evidenceIds: z.array(id).min(1),
            minimumCoverage: z.number().positive().max(1),
          })
          .strict(),
      )
      .min(1),
    observationWindow: observationWindowSchema,
    observedAnomaly: z
      .object({
        metricRef: id,
        targetRef: id,
        observationWindow: observationWindowSchema,
        comparison: z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("WINDOW"),
              window: observationWindowSchema,
            })
            .strict(),
          z.object({ kind: z.literal("BASELINE"), ref: id }).strict(),
        ]),
        direction: z.enum(["INCREASE", "DECREASE", "DISCREPANCY", "UNKNOWN"]),
      })
      .strict()
      .optional(),
    tracking: z
      .object({
        sourceRef: id,
        eventRef: id,
        suspectedIssueClass: z.enum([
          "DUPLICATION",
          "MISSING_EVENTS",
          "ATTRIBUTION_MAPPING",
          "INCONSISTENCY",
          "UNKNOWN",
        ]),
      })
      .strict()
      .optional(),
    expectedDuration: investigationDurationSchema,
    maximumInvestigationHorizon: investigationDurationSchema,
    costs: z
      .object({ analyst: cost, engineering: cost, externalService: cost })
      .strict(),
    requiredResources: z.array(
      z
        .object({
          kind: z.enum([
            "ANALYST_TIME",
            "ENGINEERING_TIME",
            "OPERATIONAL_CAPACITY",
            "API_CALLS",
            "MERCHANT_EFFORT",
          ]),
          quantity: z.number().positive().finite(),
          unit: z.enum(["HOUR", "CALL", "UNIT"]),
        })
        .strict(),
    ),
  })
  .strict();
function checkInvestigation(
  v: z.infer<typeof investigationObjectSchema>,
  ctx: z.RefinementCtx,
) {
  const evidence = new Set(v.requiredEvidence.map((e) => e.evidenceId));
  const targets = new Set(v.targets.map((t) => t.ref));
  if (
    v.targets.some(
      (t) => t.kind === "POPULATION" && t.ref !== "envelope-population",
    )
  )
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Population targets must reference the envelope-population marker",
    });
  const issue = (message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (
    evidence.size !== v.requiredEvidence.length ||
    targets.size !== v.targets.length
  )
    issue("Duplicate evidence or target identity");
  if (v.requiredEvidence.some((e) => !targets.has(e.targetRef)))
    issue("Evidence references unknown target");
  if (
    v.successCriteria.some(
      (c) =>
        new Set(c.evidenceIds).size !== c.evidenceIds.length ||
        c.evidenceIds.some((e) => !evidence.has(e)),
    )
  )
    issue("Success criteria reference unknown or duplicate evidence");
  if (v.observedAnomaly && !targets.has(v.observedAnomaly.targetRef))
    issue("Anomaly references unknown target");
  if (v.category.kind === "ANOMALY_DIAGNOSIS" && !v.observedAnomaly)
    issue("Anomaly diagnosis requires observed anomaly");
  if (
    ["TRACKING_AUDIT", "MEASUREMENT_VALIDATION"].includes(v.category.kind) &&
    !v.tracking
  )
    issue(
      "Tracking investigation requires source, event and suspected issue class",
    );
  const a = v.expectedDuration,
    b = v.maximumInvestigationHorizon;
  if (a.kind === b.kind && a.unit === b.unit && a.amount > b.amount)
    issue("Expected duration exceeds maximum horizon");
  if (a.kind === "ELAPSED" && b.kind === "ELAPSED") {
    const seconds = { SECOND: 1, MINUTE: 60, HOUR: 3600 };
    if (a.amount * seconds[a.unit] > b.amount * seconds[b.unit])
      issue("Expected duration exceeds maximum horizon");
  }
}
export const investigationWhatSchema =
  investigationObjectSchema.superRefine(checkInvestigation);
export const decisionWhatSchema = z
  .discriminatedUnion("actionType", [
    noOpWhatSchema,
    waitObserveWhatSchema,
    investigationObjectSchema,
  ])
  .superRefine((v, c) => {
    if (v.actionType === "investigation.inspect") checkInvestigation(v, c);
  });
export type DecisionWhat = z.infer<typeof decisionWhatSchema>;
export type InvestigationWhat = z.infer<typeof investigationWhatSchema>;
