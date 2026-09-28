import { z } from "zod";
import { constraintTargetSchema } from "../action_constraints/schema.js";
import {
  canonicalEntityReferenceSchema,
  type CanonicalEntityReference,
} from "../action_dependencies/schema.js";
import {
  membershipBindingSchema,
  membershipModeSchema,
} from "../population/schema.js";

const stableReferenceSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
const versionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const fingerprintSchema = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
const entityKeySchema = z.string().regex(
  /^(?:ACTION:action_[A-Za-z0-9._:-]+|COMPOUND:compound_[A-Za-z0-9_.:-]+):fnv1a64:[a-f0-9]{16}$/,
);
const pairKeySchema = z.string().regex(
  /^(?:ACTION:action_[A-Za-z0-9._:-]+|COMPOUND:compound_[A-Za-z0-9_.:-]+):fnv1a64:[a-f0-9]{16}\|(?:ACTION:action_[A-Za-z0-9._:-]+|COMPOUND:compound_[A-Za-z0-9_.:-]+):fnv1a64:[a-f0-9]{16}$/,
);
const evaluationBoundarySchema = z.enum([
  "DECISION_TIME",
  "TRANSLATION_TIME",
  "EFFECTIVE_TIME",
]);
const utcZSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "Timestamp must be UTC and end in Z");

export const conflictKindSchema = z.enum([
  "MUTUALLY_EXCLUSIVE_INTENT",
  "CONTRADICTORY_VALUE_CHANGE",
  "EXCLUSIVE_RESOURCE",
  "POLICY_PROHIBITION",
  "CUSTOM",
]);

export const conflictTemporalModeSchema = z.enum([
  "ANY_OVERLAP",
  "EFFECTIVE_OVERLAP",
]);

const globalCoordinateSchema = z.object({ kind: z.literal("GLOBAL") }).strict();
const productCoordinateSchema = z
  .object({ kind: z.literal("PRODUCT"), productRef: stableReferenceSchema })
  .strict();
const variantCoordinateSchema = z
  .object({
    kind: z.literal("VARIANT"),
    productRef: stableReferenceSchema,
    variantRef: stableReferenceSchema,
  })
  .strict();
const channelCoordinateSchema = z
  .object({ kind: z.literal("CHANNEL"), channelRef: stableReferenceSchema })
  .strict();
const placementCoordinateSchema = z
  .object({
    kind: z.literal("PLACEMENT"),
    channelRef: stableReferenceSchema,
    placementRef: stableReferenceSchema,
  })
  .strict();
const populationCoordinateSchema = z
  .object({
    kind: z.literal("POPULATION"),
    populationId: z.string().regex(/^population_[A-Za-z0-9_-]{1,80}$/),
    version: z.number().int().positive().safe(),
    definitionFingerprint: fingerprintSchema,
    binding: membershipBindingSchema,
    membershipMode: membershipModeSchema,
    snapshotRef: z.string().regex(/^snapshot_[A-Za-z0-9_-]{1,80}$/).optional(),
  })
  .strict();
const resourceCoordinateSchema = z
  .object({
    kind: z.literal("RESOURCE"),
    resourceRef: stableReferenceSchema,
    unit: stableReferenceSchema,
  })
  .strict();
const customCoordinateSchema = z
  .object({
    kind: z.literal("CUSTOM"),
    registryRef: stableReferenceSchema,
    code: stableReferenceSchema,
    version: versionSchema,
  })
  .strict();

export const conflictCoordinateSchema = z.discriminatedUnion("kind", [
  globalCoordinateSchema,
  productCoordinateSchema,
  variantCoordinateSchema,
  channelCoordinateSchema,
  placementCoordinateSchema,
  populationCoordinateSchema,
  resourceCoordinateSchema,
  customCoordinateSchema,
]);

function coordinateDimension(
  coordinate: z.infer<typeof conflictCoordinateSchema>,
): string {
  switch (coordinate.kind) {
    case "PRODUCT":
    case "VARIANT":
      return "PRODUCT";
    case "CHANNEL":
    case "PLACEMENT":
      return "CHANNEL";
    case "CUSTOM":
      return `CUSTOM:${coordinate.registryRef}`;
    default:
      return coordinate.kind;
  }
}

export const conflictScopeSchema = z
  .object({ coordinates: z.array(conflictCoordinateSchema).min(1) })
  .strict()
  .superRefine(({ coordinates }, context) => {
    if (coordinates.some(({ kind }) => kind === "GLOBAL") && coordinates.length > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coordinates"],
        message: "GLOBAL must be the only coordinate in a scope",
      });
    }
    const seen = new Set<string>();
    coordinates.forEach((coordinate, index) => {
      const dimension = coordinateDimension(coordinate);
      if (seen.has(dimension)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coordinates", index],
          message: `Repeated conflict scope dimension: ${dimension}`,
        });
      }
      seen.add(dimension);
    });
  });

export const registeredConflictCounterpartySchema = z
  .object({
    registryRef: stableReferenceSchema,
    code: stableReferenceSchema,
    version: versionSchema,
  })
  .strict();

export const conflictCounterpartySchema = z.union([
  canonicalEntityReferenceSchema,
  registeredConflictCounterpartySchema,
]);

export const actionConflictDefinitionSchema = z
  .object({
    conflictId: stableReferenceSchema,
    kind: conflictKindSchema,
    target: constraintTargetSchema,
    scope: conflictScopeSchema,
    overlapRule: conflictTemporalModeSchema,
    counterparty: conflictCounterpartySchema,
  })
  .strict();

export const actionConflictsSchema = z
  .array(actionConflictDefinitionSchema)
  .superRefine((conflicts, context) => {
    const seen = new Set<string>();
    conflicts.forEach(({ conflictId }, index) => {
      if (seen.has(conflictId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "conflictId"],
          message: "Duplicate conflict ID",
        });
      }
      seen.add(conflictId);
    });
  });

export const conflictRegistryIdentitySchema = z
  .object({
    registryRef: stableReferenceSchema,
    code: stableReferenceSchema,
    version: versionSchema,
  })
  .strict();

export const normalizedConflictRelationIdentitySchema = z
  .object({
    leftEntityKey: entityKeySchema,
    rightEntityKey: entityKeySchema,
    kind: conflictKindSchema,
    targetFingerprint: fingerprintSchema,
    leftScopeFingerprint: fingerprintSchema,
    rightScopeFingerprint: fingerprintSchema,
    temporalMode: conflictTemporalModeSchema,
    registryIdentity: conflictRegistryIdentitySchema.optional(),
  })
  .strict()
  .refine(
    ({ leftEntityKey, rightEntityKey }) =>
      leftEntityKey.localeCompare(rightEntityKey) <= 0,
    "Normalized relation endpoints must be lexicographically ordered",
  );

export type NormalizedConflictRelationIdentity = z.infer<
  typeof normalizedConflictRelationIdentitySchema
>;

export const conflictRelationIdentityInputSchema = z
  .object({
    left: canonicalEntityReferenceSchema,
    right: canonicalEntityReferenceSchema,
    kind: conflictKindSchema,
    targetFingerprint: fingerprintSchema,
    leftScopeFingerprint: fingerprintSchema,
    rightScopeFingerprint: fingerprintSchema,
    temporalMode: conflictTemporalModeSchema,
    registryIdentity: conflictRegistryIdentitySchema.optional(),
  })
  .strict();

export type ConflictRelationIdentityInput = z.infer<
  typeof conflictRelationIdentityInputSchema
>;

export function canonicalConflictEntityKey(
  reference: CanonicalEntityReference,
): string {
  return reference.entityKind === "ACTION"
    ? `ACTION:${reference.actionId}:${reference.actionFingerprint}`
    : `COMPOUND:${reference.compoundActionId}:${reference.compoundFingerprint}`;
}

export function normalizeConflictRelationIdentity(
  input: ConflictRelationIdentityInput,
): NormalizedConflictRelationIdentity {
  const parsed = conflictRelationIdentityInputSchema.parse(input);
  const leftEntityKey = canonicalConflictEntityKey(parsed.left);
  const rightEntityKey = canonicalConflictEntityKey(parsed.right);
  const endpointOrder = leftEntityKey.localeCompare(rightEntityKey);
  const reverse =
    endpointOrder > 0 ||
    (endpointOrder === 0 &&
      parsed.leftScopeFingerprint.localeCompare(parsed.rightScopeFingerprint) > 0);
  return normalizedConflictRelationIdentitySchema.parse({
    leftEntityKey: reverse ? rightEntityKey : leftEntityKey,
    rightEntityKey: reverse ? leftEntityKey : rightEntityKey,
    kind: parsed.kind,
    targetFingerprint: parsed.targetFingerprint,
    leftScopeFingerprint: reverse
      ? parsed.rightScopeFingerprint
      : parsed.leftScopeFingerprint,
    rightScopeFingerprint: reverse
      ? parsed.leftScopeFingerprint
      : parsed.rightScopeFingerprint,
    temporalMode: parsed.temporalMode,
    ...(parsed.registryIdentity === undefined
      ? {}
      : { registryIdentity: parsed.registryIdentity }),
  });
}

export const scopeIntersectionEvidenceSchema = z
  .object({
    receiptId: stableReferenceSchema,
    pairKey: pairKeySchema,
    leftScopeFingerprint: fingerprintSchema,
    rightScopeFingerprint: fingerprintSchema,
    evaluationBoundary: evaluationBoundarySchema,
    observedAt: utcZSchema,
    sourceRef: stableReferenceSchema,
    provenance: z.array(stableReferenceSchema).min(1),
    intersection: z.enum(["INTERSECTS", "DISJOINT", "UNKNOWN"]),
  })
  .strict()
  .superRefine(({ provenance }, context) => {
    const seen = new Set<string>();
    provenance.forEach((reference, index) => {
      if (seen.has(reference)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provenance", index],
          message: "Duplicate provenance reference",
        });
      }
      seen.add(reference);
    });
  });

export const scopeIntersectionEvidenceReceiptsSchema = z
  .array(scopeIntersectionEvidenceSchema)
  .superRefine((receipts, context) => {
    const seen = new Set<string>();
    receipts.forEach(({ receiptId }, index) => {
      if (seen.has(receiptId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "receiptId"],
          message: "Duplicate scope intersection evidence receipt ID",
        });
      }
      seen.add(receiptId);
    });
  });

export type ConflictCoordinate = z.infer<typeof conflictCoordinateSchema>;
export type ConflictScope = z.infer<typeof conflictScopeSchema>;
export type ActionConflictDefinition = z.infer<
  typeof actionConflictDefinitionSchema
>;
export type ConflictCounterparty = z.infer<typeof conflictCounterpartySchema>;
export type ScopeIntersectionEvidence = z.infer<
  typeof scopeIntersectionEvidenceSchema
>;
