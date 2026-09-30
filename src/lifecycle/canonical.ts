import { z } from "zod";
import { validateActionTiming } from "../action_timing/validation.js";
import type { ActionTiming } from "../action_timing/types.js";
import { populationReferenceSchema } from "../population/index.js";

const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
export const lifecycleCanonicalChannelSchema = z.enum(["EMAIL", "SMS"]);
export const lifecyclePurposeSchema = z.enum([
  "GENERAL_CAMPAIGN",
  "WELCOME",
  "WINBACK",
  "POST_PURCHASE",
  "REPLENISHMENT",
  "RETENTION",
]);
const timingSchema = z.custom<ActionTiming>(
  (value) => validateActionTiming(value).ok,
  "Invalid universal ActionTiming",
);
export const lifecyclePeriodSchema = z
  .object({
    amount: z.number().int().positive(),
    unit: z.enum(["DAY", "WEEK", "MONTH"]),
  })
  .strict();
export const lifecycleCadenceSchema = z
  .object({
    count: z.number().int().nonnegative(),
    period: lifecyclePeriodSchema,
  })
  .strict();
const channels = z
  .array(lifecycleCanonicalChannelSchema)
  .min(1)
  .max(2)
  .refine((v) => new Set(v).size === v.length, "Duplicate channels");
export const lifecycleCanonicalContactPolicySchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("CONTACT_CAP"),
        channels,
        purpose: z.enum(["MARKETING", "PROMOTIONAL"]),
        maximum: z.number().int().nonnegative(),
        period: lifecyclePeriodSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("MINIMUM_SPACING"),
        channels,
        purpose: z.enum(["MARKETING", "PROMOTIONAL"]),
        hours: z.number().positive().finite(),
      })
      .strict(),
  ],
);
export const lifecycleFlowStepSchema = z
  .object({
    stepId: id,
    order: z.number().int().positive(),
    channel: lifecycleCanonicalChannelSchema,
    timing: timingSchema,
    population: populationReferenceSchema,
    eligibility: z.array(id),
    suppression: z.array(id),
    exitConditions: z.array(z.literal("COMPLETED_PURCHASE")).min(1).max(1),
    contentRef: id.optional(),
  })
  .strict();
export const lifecycleFlowConfigurationSchema = z
  .object({
    flowId: id,
    purpose: lifecyclePurposeSchema,
    trigger: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("DAYS_SINCE_LAST_COMPLETED_PURCHASE"),
          days: z.number().int().nonnegative(),
        })
        .strict(),
      z.object({ kind: z.literal("EVENT"), eventId: id }).strict(),
      z.object({ kind: z.literal("POPULATION_ENTRY") }).strict(),
    ]),
    steps: z.array(lifecycleFlowStepSchema).min(1),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.steps.map((s) => s.stepId)).size !== v.steps.length)
      ctx.addIssue({ code: "custom", message: "Duplicate step identity" });
    if (v.steps.some((s, i) => i > 0 && s.order <= v.steps[i - 1]!.order))
      ctx.addIssue({
        code: "custom",
        message: "Steps must have strictly increasing order",
      });
  });
const changeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SET_THRESHOLD"),
      days: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SET_STEP_TIMING"),
      stepId: id,
      timing: timingSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("ADD_STEP"), step: lifecycleFlowStepSchema })
    .strict(),
  z.object({ kind: z.literal("REMOVE_STEP"), stepId: id }).strict(),
]);
export const lifecycleRollbackValueSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("FLOW_CONFIGURATION"),
      flow: lifecycleFlowConfigurationSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CADENCE"),
      targetId: id,
      channel: lifecycleCanonicalChannelSchema,
      cadence: lifecycleCadenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("CONTACT_POLICY"),
      targetId: id,
      policy: lifecycleCanonicalContactPolicySchema,
    })
    .strict(),
]);
export const lifecycleWhatSchema = z
  .discriminatedUnion("actionType", [
    z
      .object({
        actionType: z.literal("lifecycle.send"),
        channel: lifecycleCanonicalChannelSchema,
        purpose: lifecyclePurposeSchema,
        contentRef: id.optional(),
      })
      .strict(),
    z
      .object({
        actionType: z.literal("lifecycle.start_flow"),
        flow: lifecycleFlowConfigurationSchema,
      })
      .strict(),
    z
      .object({ actionType: z.literal("lifecycle.stop_flow"), flowId: id })
      .strict(),
    z
      .object({
        actionType: z.literal("lifecycle.modify_flow"),
        flowId: id,
        expectedCurrent: lifecycleFlowConfigurationSchema,
        changes: z.array(changeSchema).min(1),
      })
      .strict(),
    z
      .object({
        actionType: z.literal("lifecycle.adjust_frequency"),
        channel: lifecycleCanonicalChannelSchema,
        operation: z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("SET"),
              count: z.number().int().nonnegative(),
              period: lifecyclePeriodSchema,
            })
            .strict(),
          z
            .object({
              kind: z.literal("DELTA"),
              count: z.number().int(),
              period: lifecyclePeriodSchema,
            })
            .strict(),
        ]),
      })
      .strict(),
    z
      .object({
        actionType: z.literal("lifecycle.adjust_contact_policy"),
        policyId: id,
        policy: lifecycleCanonicalContactPolicySchema,
      })
      .strict(),
    z
      .object({
        actionType: z.literal("lifecycle.rollback_policy"),
        targetId: id,
        expectedCurrent: lifecycleRollbackValueSchema,
        restore: lifecycleRollbackValueSchema,
      })
      .strict(),
  ])
  .superRefine((action, ctx) => {
    const issue = () =>
      ctx.addIssue({
        code: "custom",
        message:
          "Policy guard and restore must identify the same target and policy kind",
      });
    if (
      action.actionType === "lifecycle.modify_flow" &&
      action.flowId !== action.expectedCurrent.flowId
    )
      issue();
    if (action.actionType === "lifecycle.rollback_policy") {
      if (action.expectedCurrent.kind !== action.restore.kind) issue();
      if (
        action.expectedCurrent.kind !== "FLOW_CONFIGURATION" &&
        action.expectedCurrent.targetId !== action.targetId
      )
        issue();
      if (
        action.restore.kind !== "FLOW_CONFIGURATION" &&
        action.restore.targetId !== action.targetId
      )
        issue();
      if (
        action.expectedCurrent.kind === "FLOW_CONFIGURATION" &&
        (action.expectedCurrent.flow.flowId !== action.targetId ||
          action.restore.kind !== "FLOW_CONFIGURATION" ||
          action.restore.flow.flowId !== action.targetId)
      )
        issue();
      if (
        action.expectedCurrent.kind === "CADENCE" &&
        action.restore.kind === "CADENCE" &&
        action.expectedCurrent.channel !== action.restore.channel
      )
        issue();
    }
  });
export type LifecycleWhat = z.infer<typeof lifecycleWhatSchema>;
export type LifecycleFlowConfiguration = z.infer<
  typeof lifecycleFlowConfigurationSchema
>;
export type LifecycleFlowStep = z.infer<typeof lifecycleFlowStepSchema>;
export interface CanonicalLifecycleFlowState {
  readonly configuration: LifecycleFlowConfiguration;
  readonly status: "ACTIVE" | "STOPPED";
  readonly sentStepIds: readonly string[];
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "undefined";
}
export function guardLifecycleRollback(
  input: unknown,
  current: unknown,
):
  | { ok: true; restore: z.infer<typeof lifecycleRollbackValueSchema> }
  | { ok: false; reason: "CONFLICT" | "INVALID_ROLLBACK" } {
  const parsed = lifecycleWhatSchema.safeParse(input);
  if (!parsed.success || parsed.data.actionType !== "lifecycle.rollback_policy")
    return { ok: false, reason: "INVALID_ROLLBACK" };
  const action = parsed.data;
  if (action.expectedCurrent.kind !== action.restore.kind)
    return { ok: false, reason: "INVALID_ROLLBACK" };
  if (
    action.expectedCurrent.kind === "FLOW_CONFIGURATION" &&
    (action.expectedCurrent.flow.flowId !== action.targetId ||
      action.restore.kind !== "FLOW_CONFIGURATION" ||
      action.restore.flow.flowId !== action.targetId)
  )
    return { ok: false, reason: "INVALID_ROLLBACK" };
  if (
    action.expectedCurrent.kind === "CADENCE" &&
    action.restore.kind === "CADENCE" &&
    action.expectedCurrent.channel !== action.restore.channel
  )
    return { ok: false, reason: "INVALID_ROLLBACK" };
  if (stable(action.expectedCurrent) !== stable(current))
    return { ok: false, reason: "CONFLICT" };
  return { ok: true, restore: action.restore };
}
export function lifecycleReversibility(
  input: unknown,
  delivery: "UNSENT" | "SENT" = "UNSENT",
): "IRREVERSIBLE" | "CANCELLABLE" | "GUARDED_ROLLBACK" {
  const action = lifecycleWhatSchema.parse(input);
  return action.actionType === "lifecycle.send"
    ? delivery === "SENT"
      ? "IRREVERSIBLE"
      : "CANCELLABLE"
    : "GUARDED_ROLLBACK";
}
export function reduceLifecycleFlow(
  state: CanonicalLifecycleFlowState | undefined,
  input: unknown,
): CanonicalLifecycleFlowState {
  const action = lifecycleWhatSchema.parse(input);
  if (action.actionType === "lifecycle.start_flow") {
    if (state && state.configuration.flowId !== action.flow.flowId)
      throw new Error("FLOW_ID_MISMATCH");
    if (state?.status === "ACTIVE") throw new Error("FLOW_ALREADY_ACTIVE");
    return {
      configuration: action.flow,
      status: "ACTIVE",
      sentStepIds: state?.sentStepIds ?? [],
    };
  }
  if (!state) throw new Error("MISSING_FLOW");
  if (action.actionType === "lifecycle.stop_flow") {
    if (action.flowId !== state.configuration.flowId)
      throw new Error("FLOW_ID_MISMATCH");
    return { ...state, status: "STOPPED" };
  }
  if (action.actionType === "lifecycle.modify_flow") {
    if (
      action.flowId !== state.configuration.flowId ||
      stable(action.expectedCurrent) !== stable(state.configuration)
    )
      throw new Error("CONFLICT");
    let configuration = structuredClone(state.configuration);
    for (const change of action.changes) {
      if (change.kind === "SET_THRESHOLD") {
        if (configuration.trigger.kind !== "DAYS_SINCE_LAST_COMPLETED_PURCHASE")
          throw new Error("INVALID_THRESHOLD_TRIGGER");
        configuration.trigger.days = change.days;
      } else if (change.kind === "ADD_STEP")
        configuration.steps.push(change.step);
      else {
        const index = configuration.steps.findIndex(
          (s) => s.stepId === change.stepId,
        );
        if (index < 0) throw new Error("MISSING_STEP");
        if (change.kind === "REMOVE_STEP") configuration.steps.splice(index, 1);
        else configuration.steps[index]!.timing = change.timing;
      }
    }
    configuration.steps.sort((a, b) => a.order - b.order);
    configuration = lifecycleFlowConfigurationSchema.parse(configuration);
    return { ...state, configuration };
  }
  if (action.actionType === "lifecycle.rollback_policy") {
    const result = guardLifecycleRollback(action, {
      kind: "FLOW_CONFIGURATION",
      flow: state.configuration,
    });
    if (!result.ok) throw new Error(result.reason);
    if (result.restore.kind !== "FLOW_CONFIGURATION")
      throw new Error("INVALID_ROLLBACK");
    return { ...state, configuration: result.restore.flow };
  }
  throw new Error("NOT_A_FLOW_ACTION");
}
export interface LifecycleStepEvidence {
  readonly eligibility: "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
  readonly suppression: "TRUE" | "FALSE" | "UNKNOWN";
  readonly timing: "READY" | "NOT_READY" | "UNKNOWN";
}
export interface LifecycleFlowEvidence {
  readonly completedPurchase: "TRUE" | "FALSE" | "UNKNOWN";
  readonly steps: Readonly<Record<string, LifecycleStepEvidence>>;
}
export type LifecycleFlowDecision =
  | { kind: "STOPPED" | "EXIT" | "UNKNOWN" | "WAIT" | "COMPLETE" }
  | { kind: "NEXT_STEP"; stepId: string };
/**
 * Pure gating of caller-supplied membership, suppression, and timing evidence.
 * This does not resolve timing or verify membership itself. A NEXT_STEP result
 * does not execute or mark a communication sent; execution belongs downstream.
 */
export function evaluateLifecycleFlow(
  state: CanonicalLifecycleFlowState,
  evidence: LifecycleFlowEvidence,
): LifecycleFlowDecision {
  if (state.status === "STOPPED") return { kind: "STOPPED" };
  if (evidence.completedPurchase === "TRUE") return { kind: "EXIT" };
  if (evidence.completedPurchase !== "FALSE") return { kind: "UNKNOWN" };
  for (const step of state.configuration.steps) {
    if (state.sentStepIds.includes(step.stepId)) continue;
    const value = evidence.steps[step.stepId];
    if (!value) return { kind: "UNKNOWN" };
    if (value.eligibility === "INELIGIBLE" || value.suppression === "TRUE")
      continue;
    if (
      value.eligibility !== "ELIGIBLE" ||
      value.suppression !== "FALSE" ||
      (value.timing !== "READY" && value.timing !== "NOT_READY")
    )
      return { kind: "UNKNOWN" };
    if (value.timing === "NOT_READY") return { kind: "WAIT" };
    return { kind: "NEXT_STEP", stepId: step.stepId };
  }
  return { kind: "COMPLETE" };
}
