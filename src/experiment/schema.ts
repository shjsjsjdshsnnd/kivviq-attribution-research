import { z } from "zod";

const stableRef = z.string().regex(/^[A-Za-z][A-Za-z0-9._:-]{1,159}$/);
const armId = z.string().regex(/^arm_[A-Za-z0-9._:-]+$/);
const actionId = z.string().regex(/^action_[A-Za-z0-9._:-]+$/);
const fingerprint = z.string().regex(/^fnv1a64:[a-f0-9]{16}$/);
const utcTimestamp = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "Timestamp must be UTC and end in Z");

const actionArmSchema = z
  .object({
    entityKind: z.literal("ACTION").optional(),
    armId,
    role: z.enum(["CONTROL", "TREATMENT"]),
    actionId,
    actionFingerprint: fingerprint,
    allocationBasisPoints: z.number().int().positive().max(10_000),
  })
  .strict();

const compoundArmSchema = z
  .object({
    entityKind: z.literal("COMPOUND"),
    armId,
    role: z.enum(["CONTROL", "TREATMENT"]),
    compoundActionId: z.string().regex(/^compound_[A-Za-z0-9._:-]+$/),
    actionFingerprint: fingerprint,
    allocationBasisPoints: z.number().int().positive().max(10_000),
  })
  .strict();

export const experimentArmSchema = z.union([
  actionArmSchema,
  compoundArmSchema,
]);

export const experimentRandomizationUnitSchema = z.union([
  z.enum(["CUSTOMER", "SESSION", "ORDER"]),
  z
    .object({
      kind: z.literal("CUSTOM"),
      registryRef: stableRef,
      code: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/),
    })
    .strict(),
]);

const fixedStoppingSchema = z
  .object({
    kind: z.literal("FIXED"),
    sampleTarget: z.number().int().positive().safe().optional(),
    timingHorizon: z.literal("ENVELOPE_TIMING").optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.sampleTarget !== undefined || value.timingHorizon !== undefined,
    "Fixed stopping requires a sample target or the envelope timing horizon",
  );

export const experimentWhatSchema = z
  .object({
    actionType: z.literal("experiment.run"),
    hypothesisRef: stableRef,
    primaryMetricRef: stableRef,
    guardrailMetricRefs: z.array(stableRef).optional(),
    randomizationUnit: experimentRandomizationUnitSchema,
    assignmentBoundary: z
      .object({ kind: z.literal("USE_ENVELOPE_POPULATION_BINDING") })
      .strict(),
    arms: z.array(experimentArmSchema).min(2),
    stopping: fixedStoppingSchema,
    measurementWindow: z
      .object({ start: utcTimestamp, end: utcTimestamp })
      .strict()
      .refine(
        (value) => Date.parse(value.start) < Date.parse(value.end),
        "Measurement window start must precede end",
      ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.arms.filter((arm) => arm.role === "CONTROL").length !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "An experiment requires exactly one control arm",
      });
    if (!value.arms.some((arm) => arm.role === "TREATMENT"))
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "An experiment requires at least one treatment arm",
      });
    if (
      value.arms.reduce((sum, arm) => sum + arm.allocationBasisPoints, 0) !==
      10_000
    )
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "Arm allocations must total 10000 basis points",
      });
    if (new Set(value.arms.map((arm) => arm.armId)).size !== value.arms.length)
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "Arm IDs must be unique",
      });
    const actionIdentities = value.arms.map(
      (arm) => `${arm.entityKind === "COMPOUND" ? arm.compoundActionId : arm.actionId}\u0000${arm.actionFingerprint}`,
    );
    if (new Set(actionIdentities).size !== actionIdentities.length)
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "Referenced action identity and fingerprint pairs must be unique",
      });
    if (
      new Set(value.arms.map((arm) =>
        arm.entityKind === "COMPOUND" ? arm.compoundActionId : arm.actionId,
      )).size !== value.arms.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "Each canonical action ID may appear in only one arm",
      });
    if (
      new Set(value.arms.map((arm) => arm.actionFingerprint)).size !==
      value.arms.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["arms"],
        message: "Experiment arms must reference distinct action semantics",
      });
    if (
      value.guardrailMetricRefs &&
      new Set(value.guardrailMetricRefs).size !== value.guardrailMetricRefs.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["guardrailMetricRefs"],
        message: "Guardrail metric references must be unique",
      });
    if (value.guardrailMetricRefs?.includes(value.primaryMetricRef))
      ctx.addIssue({
        code: "custom",
        path: ["guardrailMetricRefs"],
        message: "The primary metric cannot also be a guardrail metric",
      });
  });

export type ExperimentArm = z.infer<typeof experimentArmSchema>;
export type ExperimentWhat = z.infer<typeof experimentWhatSchema>;
