import { z } from "zod";
import { validateAction } from "../action_ontology/validation.js";
import type { Action } from "../action_ontology/types.js";
import { canonicalizeForSerialization } from "../action_ontology/semantics.js";
import { evaluatePricingRollbackReadiness } from "../pricing/rollback.js";
import type { PricingRollbackStateContext } from "../pricing/types.js";
import { evaluateMerchandisingRollbackReadiness } from "../merchandising/rollback.js";
import type { MerchandisingRollbackStateContext } from "../merchandising/types.js";
import { evaluateShippingRollbackReadiness } from "../shipping/rollback.js";
import type { ShippingRollbackStateContext } from "../shipping/types.js";
import {
  guardLifecycleRollback,
  lifecycleWhatSchema,
  reduceLifecycleFlow,
  type LifecycleWhat,
} from "../lifecycle/canonical.js";
import {
  compoundActionSchema,
  compoundDependencyGraph,
  type CompoundAction,
} from "./schema.js";
export type DomainRollbackEvidence =
  | {
      kind: "PRICING";
      rollbackAction: Action;
      context: PricingRollbackStateContext;
    }
  | {
      kind: "MERCHANDISING";
      rollbackAction: Action;
      context: MerchandisingRollbackStateContext;
    }
  | {
      kind: "SHIPPING";
      rollbackAction: Action;
      context: ShippingRollbackStateContext;
    }
  | {
      kind: "LIFECYCLE";
      rollbackWhat: LifecycleWhat;
      current: unknown;
      currentOwnerActionId: string;
    }
  | {
      kind: "DEACTIVATE_PROMOTION";
      promotionId: string;
      currentActive: boolean;
      currentOwnerActionId: string;
      evidenceRef: string;
    };
export interface ComponentRollbackEvidence {
  actionId: string;
  executionState: "NOT_STARTED" | "STARTED" | "COMPLETED";
  delivery?: "UNSENT" | "SENT";
  domain?: DomainRollbackEvidence;
}
export interface CompoundRollbackContext {
  components: Readonly<Record<string, ComponentRollbackEvidence>>;
  failedComponentId?: string;
}
export type CompoundComponentRollbackStatus =
  | "READY"
  | "IRREVERSIBLE"
  | "CONFLICT"
  | "MISSING_CONTEXT"
  | "UNSUPPORTED"
  | "NOT_SELECTED";
export interface CompoundRollbackAssessment {
  compoundActionId: string;
  status:
    "READY" | "PARTIALLY_REVERSIBLE" | "BLOCKED" | "NO_AUTOMATIC_ROLLBACK";
  canRestoreCompleteState: boolean;
  rollbackOrder: string[];
  components: {
    componentId: string;
    actionId: string;
    status: CompoundComponentRollbackStatus;
    domainResult?: unknown;
  }[];
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonicalizeForSerialization(a)) ===
  JSON.stringify(canonicalizeForSerialization(b));
/** Pure assessment: invokes authoritative domain guards; never executes restoration. */
function assessCompoundRollbackValidated(
  input: CompoundAction,
  context: CompoundRollbackContext,
): CompoundRollbackAssessment {
  const action = compoundActionSchema.parse(input),
    graph = compoundDependencyGraph(action),
    byAction = new Map(
      action.components.map((c) => [c.action.actionId, c.componentId]),
    );
  const dependencyIds = (id: string) => {
    const node = graph.find((n) => n.actionId === id);
    const refs: string[] = [];
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value)) {
        if (key === "actionId" && typeof v === "string") refs.push(v);
        else walk(v);
      }
    };
    walk(node?.timing);
    return [...(node?.dependencies.map((d) => d.actionId) ?? []), ...refs];
  };
  const ordered: string[] = [],
    seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of dependencyIds(id)) if (byAction.has(dep)) visit(dep);
    ordered.push(byAction.get(id)!);
  };
  for (const c of action.components) visit(c.action.actionId);
  ordered.reverse();
  const selected = new Set<string>();
  if (
    action.rollbackPolicy === "ROLLBACK_DEPENDENT_COMPONENTS" &&
    context.failedComponentId
  ) {
    selected.add(context.failedComponentId);
    for (let pass = 0; pass < action.components.length; pass++)
      for (const c of action.components)
        if (
          dependencyIds(c.action.actionId).some((id) =>
            selected.has(byAction.get(id) ?? ""),
          )
        )
          selected.add(c.componentId);
  }
  const components = action.components.map((c) => {
    const evidence = context.components[c.componentId];
    let status: CompoundComponentRollbackStatus = "MISSING_CONTEXT",
      domainResult: unknown;
    const requested =
      action.rollbackPolicy !== "NO_AUTOMATIC_ROLLBACK" &&
      (action.rollbackPolicy !== "ROLLBACK_COMPLETED_COMPONENTS" ||
        evidence?.executionState === "COMPLETED") &&
      (action.rollbackPolicy !== "ROLLBACK_DEPENDENT_COMPONENTS" ||
        selected.has(c.componentId));
    if (!requested) status = "NOT_SELECTED";
    else if (!evidence || evidence.actionId !== c.action.actionId)
      status = "MISSING_CONTEXT";
    else if (c.action.what.actionType === "lifecycle.send")
      status =
        evidence.delivery === "SENT" || evidence.executionState === "COMPLETED"
          ? "IRREVERSIBLE"
          : evidence.delivery === "UNSENT"
            ? "READY"
            : "MISSING_CONTEXT";
    else if (evidence.executionState === "NOT_STARTED") status = "READY";
    else if (evidence.domain) {
      const domain = evidence.domain,
        what = c.action.what;
      if (domain.kind === "LIFECYCLE") {
        const rollback = domain.rollbackWhat;
        const target =
          "flowId" in what
            ? what.flowId
            : "flow" in what
              ? what.flow.flowId
              : "policyId" in what
                ? what.policyId
                : "channel" in what
                  ? what.channel
                  : undefined;
        if (
          rollback.actionType !== "lifecycle.rollback_policy" ||
          !target ||
          rollback.targetId !== target
        )
          status = "CONFLICT";
        else if (domain.currentOwnerActionId !== c.action.actionId)
          status = "CONFLICT";
        else if (!lifecycleRestoreMatches(what, rollback.restore))
          status = "MISSING_CONTEXT";
        else if (!lifecycleOutputMatches(what, rollback.expectedCurrent))
          status = "MISSING_CONTEXT";
        else {
          const result = guardLifecycleRollback(rollback, domain.current);
          domainResult = result;
          status = result.ok
            ? "READY"
            : result.reason === "CONFLICT"
              ? "CONFLICT"
              : "UNSUPPORTED";
        }
      } else if (domain.kind === "DEACTIVATE_PROMOTION") {
        if (
          "kind" in what &&
          what.kind === "legacy_business" &&
          what.parameters.kind === "promotion_start" &&
          what.parameters.promotionId === domain.promotionId &&
          domain.evidenceRef
        ) {
          status =
            domain.currentOwnerActionId === c.action.actionId
              ? "READY"
              : "CONFLICT";
          domainResult = {
            operation: "DEACTIVATE",
            promotionId: domain.promotionId,
            currentActive: domain.currentActive,
          };
        } else status = "CONFLICT";
      } else {
        const rollback = domain.rollbackAction,
          p = rollback.parameters;
        if (
          !("kind" in what) ||
          what.kind !== "legacy_business" ||
          !same(rollback.target, what.target) ||
          !("originalActionId" in p) ||
          p.originalActionId !== c.action.actionId ||
          !("conflictGuard" in p) ||
          !("sourceActionId" in p.conflictGuard) ||
          p.conflictGuard.sourceActionId !== c.action.actionId
        )
          status = "CONFLICT";
        else {
          const contract =
            domain.kind === "PRICING"
              ? what.reversibility.pricingRollback
              : domain.kind === "MERCHANDISING"
                ? what.reversibility.merchandisingRollback
                : what.reversibility.shippingRollback;
          if (
            !contract?.available ||
            !same(contract.conflictGuard, p.conflictGuard) ||
            !("strategy" in p) ||
            !same(contract.strategy, p.strategy)
          ) {
            status = "CONFLICT";
          } else {
            const result =
              domain.kind === "PRICING"
                ? evaluatePricingRollbackReadiness(rollback, domain.context)
                : domain.kind === "MERCHANDISING"
                  ? evaluateMerchandisingRollbackReadiness(
                      rollback,
                      domain.context,
                    )
                  : evaluateShippingRollbackReadiness(rollback, domain.context);
            domainResult = result;
            status =
              result.status === "INVALID_ACTION"
                ? "UNSUPPORTED"
                : result.status;
          }
        }
      }
    }
    return {
      componentId: c.componentId,
      actionId: c.action.actionId,
      status,
      ...(domainResult !== undefined ? { domainResult } : {}),
    };
  });
  const ready = components.filter((c) => c.status === "READY").length;
  const canRestoreCompleteState = components.every(
    (c) =>
      c.status === "READY" ||
      (c.status === "NOT_SELECTED" &&
        context.components[c.componentId]?.executionState === "NOT_STARTED"),
  );
  return {
    compoundActionId: action.compoundActionId,
    status:
      action.rollbackPolicy === "NO_AUTOMATIC_ROLLBACK"
        ? "NO_AUTOMATIC_ROLLBACK"
        : canRestoreCompleteState
          ? "READY"
          : ready
            ? "PARTIALLY_REVERSIBLE"
            : "BLOCKED",
    canRestoreCompleteState,
    rollbackOrder: ordered.filter(
      (id) => components.find((c) => c.componentId === id)?.status === "READY",
    ),
    components,
  };
}

function lifecycleOutputMatches(
  input: CompoundAction["components"][number]["action"]["what"],
  expected: unknown,
): boolean {
  const parsed = lifecycleWhatSchema.safeParse(input);
  if (!parsed.success) return false;
  const what = parsed.data;
  if (what.actionType === "lifecycle.start_flow")
    return same(expected, { kind: "FLOW_CONFIGURATION", flow: what.flow });
  if (what.actionType === "lifecycle.modify_flow") {
    try {
      const output = reduceLifecycleFlow(
        {
          status: "ACTIVE",
          configuration: what.expectedCurrent,
          sentStepIds: [],
        },
        what,
      );
      return same(expected, {
        kind: "FLOW_CONFIGURATION",
        flow: output.configuration,
      });
    } catch {
      return false;
    }
  }
  if (what.actionType === "lifecycle.adjust_contact_policy")
    return same(expected, {
      kind: "CONTACT_POLICY",
      targetId: what.policyId,
      policy: what.policy,
    });
  if (
    what.actionType === "lifecycle.adjust_frequency" &&
    what.operation.kind === "SET"
  )
    return same(expected, {
      kind: "CADENCE",
      targetId: what.channel,
      channel: what.channel,
      cadence: { count: what.operation.count, period: what.operation.period },
    });
  return false;
}

const rollbackActionSchema = z.custom<Action>(
  (value) => validateAction(value).ok,
);
const domainEvidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("PRICING"),
      rollbackAction: rollbackActionSchema,
      context: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("MERCHANDISING"),
      rollbackAction: rollbackActionSchema,
      context: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SHIPPING"),
      rollbackAction: rollbackActionSchema,
      context: z.record(z.unknown()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("LIFECYCLE"),
      rollbackWhat: lifecycleWhatSchema,
      current: z.unknown(),
      currentOwnerActionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("DEACTIVATE_PROMOTION"),
      promotionId: z.string().min(1),
      currentActive: z.boolean(),
      currentOwnerActionId: z.string().min(1),
      evidenceRef: z.string().min(1),
    })
    .strict(),
]);
export const compoundRollbackContextSchema = z
  .object({
    components: z.record(
      z
        .object({
          actionId: z.string().min(1),
          executionState: z.enum(["NOT_STARTED", "STARTED", "COMPLETED"]),
          delivery: z.enum(["SENT", "UNSENT"]).optional(),
          domain: domainEvidenceSchema.optional(),
        })
        .strict(),
    ),
    failedComponentId: z.string().min(1).optional(),
  })
  .strict();
export function assessCompoundRollback(
  input: CompoundAction,
  context: CompoundRollbackContext,
): CompoundRollbackAssessment {
  const action = compoundActionSchema.parse(input);
  try {
    if (compoundRollbackContextSchema.safeParse(context).success)
      return assessCompoundRollbackValidated(action, context);
  } catch {
    /* Malformed external domain state cannot establish a safe rollback. */
  }
  return {
    compoundActionId: action.compoundActionId,
    status: "BLOCKED",
    canRestoreCompleteState: false,
    rollbackOrder: [],
    components: action.components.map((c) => ({
      componentId: c.componentId,
      actionId: c.action.actionId,
      status: "MISSING_CONTEXT",
    })),
  };
}
/** Only modify_flow currently embeds an immutable pre-action lifecycle snapshot. */
function lifecycleRestoreMatches(
  input: CompoundAction["components"][number]["action"]["what"],
  restore: unknown,
): boolean {
  const parsed = lifecycleWhatSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.actionType === "lifecycle.modify_flow" &&
    same(restore, {
      kind: "FLOW_CONFIGURATION",
      flow: parsed.data.expectedCurrent,
    })
  );
}
