import { z } from "zod";

const referenceSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
export const canonicalActionIdSchema = z
  .string()
  .regex(/^action_[A-Za-z0-9._:-]+$/);
export const compoundActionIdSchema = z
  .string()
  .regex(/^compound_[A-Za-z0-9_.:-]+$/);
const fingerprintSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
const evaluationBoundarySchema = z.enum([
  "DECISION_TIME",
  "TRANSLATION_TIME",
  "EFFECTIVE_TIME",
]);
const whenUnknownSchema = z.enum(["UNKNOWN", "BLOCKED"]);
const utcZSchema = z.string().datetime().regex(/Z$/);

function uniqueReferences(
  values: readonly string[],
  context: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `Duplicate ${label}`,
      });
    }
    seen.add(value);
  });
}

export const canonicalEntityReferenceSchema = z.discriminatedUnion(
  "entityKind",
  [
    z
      .object({
        entityKind: z.literal("ACTION"),
        actionId: canonicalActionIdSchema,
        actionFingerprint: fingerprintSchema,
      })
      .strict(),
    z
      .object({
        entityKind: z.literal("COMPOUND"),
        compoundActionId: compoundActionIdSchema,
        compoundFingerprint: fingerprintSchema,
      })
      .strict(),
  ],
);

const dependencyCommon = {
  dependencyId: referenceSchema,
  evaluationBoundary: evaluationBoundarySchema,
  whenUnknown: whenUnknownSchema,
};

export const actionDependencySchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...dependencyCommon,
      kind: z.literal("ENTITY_LIFECYCLE"),
      prerequisite: canonicalEntityReferenceSchema,
      requiredState: z.enum(["STARTED", "EFFECTIVE", "COMPLETED", "RESOLVED"]),
    })
    .strict(),
  z
    .object({
      ...dependencyCommon,
      kind: z.literal("HARD_CONSTRAINT_GATE"),
      constraintId: referenceSchema,
      requiredStatus: z.literal("SATISFIED"),
    })
    .strict(),
  z
    .object({
      ...dependencyCommon,
      kind: z.literal("ELIGIBILITY_CHECK_GATE"),
      checkId: referenceSchema,
      requiredStatus: z.literal("SATISFIED"),
    })
    .strict(),
  z
    .object({
      ...dependencyCommon,
      kind: z.literal("EXPERIMENT_READINESS_GATE"),
      requirement: z.enum(["READY", "SUFFICIENT_ELIGIBLE_TRAFFIC"]),
    })
    .strict(),
]);

export const actionDependenciesSchema = z
  .array(actionDependencySchema)
  .superRefine((dependencies, context) => {
    uniqueReferences(
      dependencies.map(({ dependencyId }) => dependencyId),
      context,
      "dependency ID",
    );
  });

const actionEventSubjectSchema = z
  .object({
    kind: z.literal("ACTION"),
    actionId: canonicalActionIdSchema,
    actionFingerprint: fingerprintSchema,
  })
  .strict();

export const actionLifecycleEventSchema = z
  .object({
    eventId: referenceSchema,
    subject: actionEventSubjectSchema,
    eventKind: z.enum(["STARTED", "EFFECTIVE", "COMPLETED"]),
    occurredAt: utcZSchema,
    sourceRef: referenceSchema,
    provenance: z
      .array(referenceSchema)
      .min(1)
      .superRefine((values, context) =>
        uniqueReferences(values, context, "provenance reference"),
      ),
  })
  .strict();

const dependencyEvidenceFactSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("ENTITY_LIFECYCLE"),
      prerequisite: canonicalEntityReferenceSchema,
      events: z.array(actionLifecycleEventSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ELIGIBILITY_INPUT"),
      checkId: referenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CONSTRAINT_INPUT"),
      constraintId: referenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("EXPERIMENT_READINESS_INPUT"),
      requirement: z.enum(["READY", "SUFFICIENT_ELIGIBLE_TRAFFIC"]),
    })
    .strict(),
]);

export const dependencyEvidenceReceiptSchema = z
  .object({
    receiptId: referenceSchema,
    dependentActionId: canonicalActionIdSchema,
    dependentActionFingerprint: fingerprintSchema,
    dependencyId: referenceSchema,
    evaluationBoundary: evaluationBoundarySchema,
    observedAt: utcZSchema,
    evidenceRefs: z
      .array(referenceSchema)
      .superRefine((values, context) =>
        uniqueReferences(values, context, "evidence reference"),
      ),
    provenance: z
      .array(referenceSchema)
      .min(1)
      .superRefine((values, context) =>
        uniqueReferences(values, context, "provenance reference"),
      ),
    fact: dependencyEvidenceFactSchema,
  })
  .strict();

export type CanonicalEntityReference = z.infer<
  typeof canonicalEntityReferenceSchema
>;
export type ActionDependency = z.infer<typeof actionDependencySchema>;
export type ActionLifecycleEvent = z.infer<typeof actionLifecycleEventSchema>;
export type DependencyEvidenceReceipt = z.infer<
  typeof dependencyEvidenceReceiptSchema
>;
