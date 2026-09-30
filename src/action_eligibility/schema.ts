import { z } from "zod";

const refSchema = z.string().min(1);
const utcZSchema = z.string().datetime().regex(/Z$/);

export const eligibilityCheckSchema = z
  .object({
    kind: z.enum(["PRECONDITION", "HARD_CONSTRAINT", "DOMAIN_RULE"]),
    checkId: refSchema,
    status: z.enum(["SATISFIED", "VIOLATED", "UNKNOWN"]),
    reasonCodes: z.array(refSchema).min(1).superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          context.addIssue({ code: "custom", path: [index], message: "Duplicate reason code" });
        seen.add(value);
      });
    }),
    evidenceRefs: z.array(refSchema).superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          context.addIssue({ code: "custom", path: [index], message: "Duplicate evidence reference" });
        seen.add(value);
      });
    }),
    missingInformation: z.array(refSchema).superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value))
          context.addIssue({ code: "custom", path: [index], message: "Duplicate missing-information entry" });
        seen.add(value);
      });
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const failClosedMissing = value.status === "VIOLATED" && value.reasonCodes.includes("MISSING_INFORMATION_FAIL_CLOSED");
    if (value.status === "UNKNOWN") {
      if (value.missingInformation.length === 0)
        context.addIssue({ code: "custom", path: ["missingInformation"], message: "UNKNOWN checks require missing information" });
      return;
    }
    if (!failClosedMissing && value.evidenceRefs.length === 0)
      context.addIssue({ code: "custom", path: ["evidenceRefs"], message: `${value.status} checks require evidence` });
    if (!failClosedMissing && value.missingInformation.length !== 0)
      context.addIssue({ code: "custom", path: ["missingInformation"], message: `${value.status} checks cannot retain missing information` });
  });

export const actionEligibilitySchema = z
  .object({
    actionId: refSchema,
    actionFingerprint: refSchema,
    evaluatedAt: utcZSchema,
    evaluationBoundary: z.enum(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"]),
    status: z.enum(["ELIGIBLE", "INELIGIBLE", "UNKNOWN"]),
    checks: z.array(eligibilityCheckSchema),
    assessmentFingerprint: z.string().regex(/^fnv1a64:[a-f0-9]{16}$/),
  })
  .strict();

export const eligibilityFailureSchema = z
  .object({
    code: z.enum(["INVALID_ACTION", "UNSUPPORTED_ACTION_FAMILY", "INVALID_CONTEXT", "INVALID_NATIVE_CONSTRAINTS"]),
    messages: z.array(z.string()),
  })
  .strict();

export type EligibilityCheck = z.infer<typeof eligibilityCheckSchema>;
export type ActionEligibility = z.infer<typeof actionEligibilitySchema>;
export type EligibilityFailure = z.infer<typeof eligibilityFailureSchema>;
