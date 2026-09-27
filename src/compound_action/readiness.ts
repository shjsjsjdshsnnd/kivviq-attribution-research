import { z } from "zod";
import { actionEligibilitySchema, type ActionEligibility } from "../action_eligibility/schema.js";
import {
  checkInvestigationDependency,
  type InvestigationResult,
} from "../investigation/index.js";
import { fingerprintCanonicalAction } from "../canonical_action/serialization.js";
import { resolveActionTiming } from "../action_timing/resolution.js";
import type {
  ActionTimingResolutionContext,
  TimingResolution,
} from "../action_timing/types.js";
import {
  compoundActionSchema,
  compoundDependencyGraph,
  type CompoundAction,
  fingerprintCompoundAction,
} from "./schema.js";
export interface CompoundTimingIssue {
  componentId: string;
  code: string;
}
export interface CompoundTimingResolution {
  components: Record<string, TimingResolution>;
  issues: CompoundTimingIssue[];
}
export function resolveCompoundTiming(
  input: CompoundAction,
  context: ActionTimingResolutionContext,
): CompoundTimingResolution {
  const action = compoundActionSchema.parse(input),
    graph = compoundDependencyGraph(action),
    results: Record<string, TimingResolution> = {},
    issues: CompoundTimingIssue[] = [];
  // Planned starts/ends can resolve temporal relationships, but never prove execution completion.
  const times = { ...context.actionTimes };
  for (let pass = 0; pass < action.components.length; pass++)
    for (const component of action.components) {
      const result = resolveActionTiming(component.action.timing, {
        ...context,
        actionId: component.action.actionId,
        dependencyGraph: graph,
        actionTimes: times,
      });
      results[component.componentId] = result;
      if (result.status === "VALID")
        times[component.action.actionId] = {
          ...times[component.action.actionId],
          ...(result.resolvedRequestedStart
            ? { requestedStart: result.resolvedRequestedStart }
            : {}),
          ...(result.resolvedEffectiveStart
            ? { effectiveStart: result.resolvedEffectiveStart }
            : {}),
          ...(result.resolvedEnd ? { end: result.resolvedEnd } : {}),
        };
    }
  const compare = (
    componentId: string,
    left: string | undefined,
    right: string | undefined,
    equal = false,
  ) => {
    if (!left || !right)
      issues.push({ componentId, code: "MISSING_COORDINATION_TIME" });
    else if (
      equal
        ? Date.parse(left) !== Date.parse(right)
        : Date.parse(left) < Date.parse(right)
    )
      issues.push({
        componentId,
        code: equal ? "CONCURRENCY_CONFLICT" : "DEPENDENCY_TIME_CONFLICT",
      });
  };
  for (const component of action.components) {
    const r = results[component.componentId]!;
    if (r.status !== "VALID")
      issues.push({
        componentId: component.componentId,
        code:
          r.status === "INVALID" ? "INVALID_TIMING" : "MISSING_TIMING_CONTEXT",
      });
  }
  for (const d of action.dependencies) {
    if (d.kind === "REQUIRES") continue;
    const a = results[d.componentId]!,
      b = results[d.dependsOn]!;
    switch (d.kind) {
      case "START_AFTER":
        compare(
          d.componentId,
          a.resolvedRequestedStart,
          b.resolvedRequestedStart ?? b.resolvedEffectiveStart,
        );
        break;
      case "EFFECTIVE_AFTER":
        compare(
          d.componentId,
          a.resolvedEffectiveStart,
          b.resolvedEffectiveStart,
        );
        break;
      case "COMPLETE_AFTER":
        compare(
          d.componentId,
          a.resolvedEnd,
          context.actionTimes?.[
            action.components.find((c) => c.componentId === d.dependsOn)!.action
              .actionId
          ]?.completedAt,
        );
        break;
      case "END_WITH":
        compare(d.componentId, a.resolvedEnd, b.resolvedEnd, true);
    }
  }
  if (action.ordering === "ORDERED")
    for (let i = 1; i < action.components.length; i++)
      compare(
        action.components[i]!.componentId,
        results[action.components[i]!.componentId]?.resolvedRequestedStart,
        results[action.components[i - 1]!.componentId]?.resolvedRequestedStart,
      );
  if (action.concurrency !== "INDEPENDENT_TIMING") {
    const field =
      action.concurrency === "START_TOGETHER"
        ? "resolvedRequestedStart"
        : "resolvedEffectiveStart";
    const first = results[action.components[0]!.componentId]?.[field];
    for (const c of action.components.slice(1))
      compare(c.componentId, results[c.componentId]?.[field], first, true);
  }
  return { components: results, issues };
}
export type ComponentReadinessStatus =
  | "READY"
  | "INELIGIBLE"
  | "UNKNOWN"
  | "MISSING_CONTEXT"
  | "UNSUPPORTED_SIMULATOR_CAPABILITY";
export interface ComponentReadinessEvidence {
  status: ComponentReadinessStatus;
  evidenceRefs: readonly string[];
  executionState?: "NOT_STARTED" | "STARTED" | "COMPLETED";
  investigationState?:
    "RESOLVED" | "PARTIALLY_RESOLVED" | "UNRESOLVED" | "FAILED";
  investigationResult?: InvestigationResult;
}
export interface CompoundReadinessContext {
  timing: ActionTimingResolutionContext;
  components: Readonly<Record<string, ComponentReadinessEvidence>>;
  eligibilityResults?: Readonly<Record<string, unknown>>;
  eligibilityBoundary?: "DECISION_TIME" | "TRANSLATION_TIME" | "EFFECTIVE_TIME";
  constraintEvidence?: Readonly<
    Record<
      string,
      {
        status: "SATISFIED" | "VIOLATED" | "UNKNOWN";
        evidenceRefs: readonly string[];
        compoundFingerprint?: string;
      }
    >
  >;
}
export interface CompoundActionReadiness {
  compoundActionId: string;
  status: "READY" | "PARTIALLY_READY" | "BLOCKED" | "UNKNOWN";
  components: {
    componentId: string;
    actionId: string;
    status: ComponentReadinessStatus;
    codes: string[];
    eligibility?: ActionEligibility;
  }[];
  constraintResults: {
    constraintId: string;
    status: "SATISFIED" | "VIOLATED" | "UNKNOWN";
  }[];
  timing: CompoundTimingResolution;
}
export function assessCompoundActionReadiness(
  input: CompoundAction,
  context: CompoundReadinessContext,
): CompoundActionReadiness {
  const action = compoundActionSchema.parse(input);
  const parsedContext = compoundReadinessContextSchema.safeParse(context);
  if (!parsedContext.success)
    return {
      compoundActionId: action.compoundActionId,
      status: "UNKNOWN",
      components: action.components.map((c) => ({
        componentId: c.componentId,
        actionId: c.action.actionId,
        status: "MISSING_CONTEXT",
        codes: ["INVALID_READINESS_CONTEXT"],
      })),
      constraintResults: action.constraints.map((c) => ({
        constraintId: c.constraintId,
        status: "UNKNOWN",
      })),
      timing: { components: {}, issues: [] },
    };
  const timing = resolveCompoundTiming(action, context.timing);
  const components = action.components.map((c) => {
    const evidence = context.components[c.componentId];
    const codes: string[] = [];
    let status: ComponentReadinessStatus =
      evidence?.status ?? "MISSING_CONTEXT";
    let eligibility: ActionEligibility | undefined;
    if (!evidence?.evidenceRefs.length) {
      status = "MISSING_CONTEXT";
      codes.push("MISSING_READINESS_EVIDENCE");
    }
    if (context.eligibilityResults === undefined) {
      codes.push("COMPONENT_ELIGIBILITY_REQUIRED");
      if (status === "READY") status = "MISSING_CONTEXT";
    } else {
      const parsedEligibility = actionEligibilitySchema.safeParse(
        context.eligibilityResults[c.componentId],
      );
      if (!parsedEligibility.success) {
        codes.push("COMPONENT_ELIGIBILITY_REQUIRED");
        if (status === "READY") status = "MISSING_CONTEXT";
      } else {
        eligibility = parsedEligibility.data;
        const derived = eligibility.checks.some((check) => check.status === "VIOLATED")
          ? "INELIGIBLE"
          : eligibility.checks.some((check) => check.status === "UNKNOWN")
            ? "UNKNOWN"
            : "ELIGIBLE";
        const evaluationBoundary = eligibility.evaluationBoundary;
        const applicableConstraintIds = c.action.constraints
          .filter((constraint) => constraint.evaluationBoundary === evaluationBoundary)
          .map((constraint) => constraint.constraintId);
        const hardConstraintCheckIds = eligibility.checks
          .filter((check) => check.kind === "HARD_CONSTRAINT")
          .map((check) => check.checkId);
        const expectedConstraintIds = new Set(applicableConstraintIds);
        const constraintsComplete =
          expectedConstraintIds.size === applicableConstraintIds.length &&
          hardConstraintCheckIds.length === applicableConstraintIds.length &&
          hardConstraintCheckIds.every((id) => expectedConstraintIds.has(id)) &&
          new Set(hardConstraintCheckIds).size === hardConstraintCheckIds.length;
        if (
          eligibility.actionId !== c.action.actionId ||
          eligibility.actionFingerprint !== fingerprintCanonicalAction(c.action) ||
          (context.eligibilityBoundary !== undefined &&
            eligibility.evaluationBoundary !== context.eligibilityBoundary) ||
          eligibility.status !== derived ||
          (eligibility.status === "ELIGIBLE" && !constraintsComplete)
        ) {
          codes.push("COMPONENT_ELIGIBILITY_MISMATCH");
          if (status === "READY") status = "MISSING_CONTEXT";
        } else if (eligibility.status === "INELIGIBLE") {
          codes.push("COMPONENT_INELIGIBLE");
          if (status !== "UNSUPPORTED_SIMULATOR_CAPABILITY") status = "INELIGIBLE";
        } else if (eligibility.status === "UNKNOWN") {
          codes.push("COMPONENT_ELIGIBILITY_UNKNOWN");
          if (status === "READY") status = "UNKNOWN";
        }
      }
    }
    for (const issue of timing.issues.filter(
      (i) => i.componentId === c.componentId,
    )) {
      codes.push(issue.code);
      if (status === "READY")
        status = issue.code.startsWith("MISSING")
          ? "MISSING_CONTEXT"
          : "INELIGIBLE";
    }
    for (const d of action.dependencies.filter(
      (d) => d.componentId === c.componentId && d.kind === "REQUIRES",
    )) {
      if (d.kind !== "REQUIRES") continue;
      const source = context.components[d.dependsOn];
      const prerequisite = action.components.find(
        (c) => c.componentId === d.dependsOn,
      )!.action;
      const investigation =
        prerequisite.what.actionType === "investigation.inspect";
      const fingerprint = fingerprintCanonicalAction(prerequisite);
      const satisfied = investigation
        ? checkInvestigationDependency(
            {
              relation: "REQUIRES",
              actionId: prerequisite.actionId,
              actionFingerprint: fingerprint,
              requiredStatus: d.requiredState,
            },
            {
              actionId: prerequisite.actionId,
              actionFingerprint: fingerprint,
              what: prerequisite.what,
            },
            source?.investigationResult,
          ).satisfied
        : source?.executionState === "COMPLETED";
      if (!source?.evidenceRefs.length || !satisfied) {
        codes.push("DEPENDENCY_REQUIREMENT_NOT_MET");
        if (status === "READY") status = "MISSING_CONTEXT";
      }
    }
    return {
      componentId: c.componentId,
      actionId: c.action.actionId,
      status,
      codes,
      ...(eligibility ? { eligibility } : {}),
    };
  });
  const constraintResults = action.constraints.map((c) => {
    const literal =
      literalBudgetConstraint(action, c) ?? literalCostConstraint(action, c);
    if (literal) return { constraintId: c.constraintId, status: literal };
    const evidence = context.constraintEvidence?.[c.constraintId];
    return {
      constraintId: c.constraintId,
      status:
        evidence?.evidenceRefs.length &&
        evidence.compoundFingerprint === fingerprintCompoundAction(action)
          ? evidence.status
          : ("UNKNOWN" as const),
    };
  });
  for (const constraint of constraintResults.filter(
    (c) => c.status !== "SATISFIED",
  )) {
    const ids = action.constraints.find(
      (c) => c.constraintId === constraint.constraintId,
    )!.componentIds;
    for (const c of components.filter((c) => ids.includes(c.componentId))) {
      c.codes.push("COMPOUND_CONSTRAINT_" + constraint.status);
      if (c.status === "READY")
        c.status =
          constraint.status === "VIOLATED" ? "INELIGIBLE" : "MISSING_CONTEXT";
    }
  }
  // Coordination groups and graph prerequisites gate each other to a fixed point.
  const graph = compoundDependencyGraph(action);
  for (let pass = 0; pass < components.length; pass++) {
    for (const constraint of action.constraints.filter(
      (c) => c.kind === "BUDGET_NEUTRAL",
    )) {
      const group = components.filter((c) =>
        constraint.componentIds.includes(c.componentId),
      );
      const blocked = group.find((c) => c.status !== "READY");
      if (blocked)
        for (const member of group.filter((c) => c.status === "READY")) {
          member.status =
            blocked.status === "INELIGIBLE" ||
            blocked.status === "UNSUPPORTED_SIMULATOR_CAPABILITY"
              ? "INELIGIBLE"
              : "MISSING_CONTEXT";
          member.codes.push("BUDGET_NEUTRAL_GROUP_NOT_READY");
        }
    }
    for (const node of graph)
      for (const dependency of node.dependencies) {
        const source = components.find(
            (c) => c.actionId === dependency.actionId,
          ),
          destination = components.find((c) => c.actionId === node.actionId)!;
        if (
          source &&
          source.status !== "READY" &&
          destination.status === "READY"
        ) {
          destination.status =
            source.status === "INELIGIBLE" ||
            source.status === "UNSUPPORTED_SIMULATOR_CAPABILITY"
              ? "INELIGIBLE"
              : "MISSING_CONTEXT";
          destination.codes.push("DEPENDENCY_NOT_READY");
        }
      }
  }
  const ready = components.filter((c) => c.status === "READY").length,
    blocked = components.some(
      (c) =>
        c.status === "INELIGIBLE" ||
        c.status === "UNSUPPORTED_SIMULATOR_CAPABILITY",
    );
  const status: CompoundActionReadiness["status"] =
    ready === components.length
      ? "READY"
      : action.atomicity === "ALL_OR_NOTHING"
        ? blocked
          ? "BLOCKED"
          : "UNKNOWN"
        : ready > 0
          ? "PARTIALLY_READY"
          : blocked
            ? "BLOCKED"
            : "UNKNOWN";
  return {
    compoundActionId: action.compoundActionId,
    status,
    components,
    constraintResults,
    timing,
  };
}

const evidenceRefs = z.array(z.string().min(1));
export const compoundReadinessContextSchema = z
  .object({
    timing: z.object({ approvedClock: z.string().datetime() }).passthrough(),
    components: z.record(
      z
        .object({
          status: z.enum([
            "READY",
            "INELIGIBLE",
            "UNKNOWN",
            "MISSING_CONTEXT",
            "UNSUPPORTED_SIMULATOR_CAPABILITY",
          ]),
          evidenceRefs,
          executionState: z
            .enum(["NOT_STARTED", "STARTED", "COMPLETED"])
            .optional(),
          investigationState: z
            .enum(["RESOLVED", "PARTIALLY_RESOLVED", "UNRESOLVED", "FAILED"])
            .optional(),
          investigationResult: z.unknown().optional(),
        })
        .strict(),
    ),
    eligibilityResults: z.record(z.unknown()).optional(),
    eligibilityBoundary: z.enum(["DECISION_TIME", "TRANSLATION_TIME", "EFFECTIVE_TIME"]).optional(),
    constraintEvidence: z
      .record(
        z
          .object({
            status: z.enum(["SATISFIED", "VIOLATED", "UNKNOWN"]),
            evidenceRefs,
            compoundFingerprint: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
function literalBudgetConstraint(
  action: CompoundAction,
  constraint: CompoundAction["constraints"][number],
): "SATISFIED" | "VIOLATED" | undefined {
  if (constraint.kind !== "BUDGET_NEUTRAL") return undefined;
  let total = 0,
    period: string | undefined;
  for (const id of constraint.componentIds) {
    const what = action.components.find((c) => c.componentId === id)!.action
      .what;
    if (
      !("kind" in what) ||
      what.kind !== "legacy_business" ||
      what.parameters.kind !== "budget_adjustment"
    )
      return undefined;
    const operation = what.parameters.operation;
    if (operation.kind !== "DELTA") return undefined;
    const amount = operation.amount;
    if (amount.currency !== constraint.currency) return "VIOLATED";
    if (period !== undefined && period !== amount.per) return undefined;
    period = amount.per;
    total += amount.amountMinor * (operation.direction === "increase" ? 1 : -1);
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total === 0 ? "SATISFIED" : "VIOLATED";
}

/** Known accounting costs are lower bounds even when other cost fields are unknown. */
function literalCostConstraint(
  action: CompoundAction,
  constraint: CompoundAction["constraints"][number],
): "SATISFIED" | "VIOLATED" | undefined {
  if (constraint.kind !== "TOTAL_COST_LIMIT") return undefined;
  let total = 0,
    complete = true;
  for (const id of constraint.componentIds) {
    const what = action.components.find((c) => c.componentId === id)!.action
      .what;
    if (
      what.actionType === "no_op.do_nothing" ||
      what.actionType === "no_op.wait_observe"
    )
      continue;
    if (what.actionType === "investigation.inspect" && "costs" in what) {
      for (const cost of Object.values(what.costs)) {
        if (cost.state !== "KNOWN") {
          complete = false;
          continue;
        }
        if (cost.currency !== constraint.currency) return "VIOLATED";
        total += cost.amountMinor;
        if (!Number.isSafeInteger(total)) return undefined;
        if (total > constraint.maximumAmountMinor) return "VIOLATED";
      }
      continue;
    }
    if (!("kind" in what) || what.kind !== "legacy_business") {
      complete = false;
      continue;
    }
    for (const key of [
      "directFinancialCost",
      "mediaSpend",
      "implementationCost",
      "engineeringCost",
      "operationalCost",
      "promotionalCost",
      "inventoryCommitment",
    ] as const) {
      const cost = what.cost[key];
      if (cost.kind !== "known") {
        complete = false;
        continue;
      }
      if (cost.value.currency !== constraint.currency) return "VIOLATED";
      total += cost.value.amountMinor;
      if (!Number.isSafeInteger(total)) return undefined;
      if (total > constraint.maximumAmountMinor) return "VIOLATED";
    }
  }
  return complete ? "SATISFIED" : undefined;
}
