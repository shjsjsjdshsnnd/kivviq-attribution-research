import { z } from "zod";
import {
  canonicalActionSchema,
  actionSpaceCanonicalActionSchema,
  type ActionSpaceCanonicalAction,
} from "../canonical_action/schema.js";
import { canonicalizeForSerialization } from "../action_ontology/semantics.js";
import { validateTimingDependencyGraph } from "../action_timing/validation.js";
import type { TimingDependency } from "../action_timing/types.js";
import {
  actionOutcomePlanSchema,
  type ActionOutcomePlan,
} from "../action_outcomes/schema.js";
const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/);
// An explicit union keeps each dependency's fields closed and typed.
const temporalDependency = z
  .object({
    kind: z.enum([
      "START_AFTER",
      "EFFECTIVE_AFTER",
      "COMPLETE_AFTER",
      "END_WITH",
    ]),
    componentId: ref,
    dependsOn: ref,
  })
  .strict();
export const compoundDependencySchema = z.union([
  temporalDependency,
  z
    .object({
      kind: z.literal("REQUIRES"),
      componentId: ref,
      dependsOn: ref,
      requiredState: z.enum(["COMPLETED", "RESOLVED"]),
    })
    .strict(),
]);
export const compoundConstraintSchema = z.union([
  z
    .object({
      constraintId: ref,
      kind: z.literal("BUDGET_NEUTRAL"),
      componentIds: z.array(ref).min(2),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
  z
    .object({
      constraintId: ref,
      kind: z.literal("TOTAL_COST_LIMIT"),
      componentIds: z.array(ref).min(1),
      currency: z.string().regex(/^[A-Z]{3}$/),
      maximumAmountMinor: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      constraintId: ref,
      kind: z.literal("EVIDENCE_REQUIRED"),
      componentIds: z.array(ref).min(1),
      evidenceRef: ref,
    })
    .strict(),
]);
const definition = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("compound_action"),
    compoundActionId: z.string().regex(/^compound_[A-Za-z0-9_.:-]+$/),
    components: z
      .array(
        z
          .object({
            componentId: ref,
            role: ref,
            action: canonicalActionSchema,
          })
          .strict(),
      )
      .min(2),
    ordering: z.enum(["UNORDERED", "ORDERED"]),
    concurrency: z.enum([
      "START_TOGETHER",
      "EFFECTIVE_TOGETHER",
      "INDEPENDENT_TIMING",
    ]),
    dependencies: z.array(compoundDependencySchema),
    atomicity: z.enum(["ALL_OR_NOTHING", "BEST_EFFORT", "DEPENDENCY_GATED"]),
    failurePolicy: z.enum([
      "STOP_REMAINING",
      "CONTINUE_INDEPENDENT",
      "REQUEST_ROLLBACK",
    ]),
    rollbackPolicy: z.enum([
      "ROLLBACK_ALL_REVERSIBLE_COMPONENTS",
      "ROLLBACK_COMPLETED_COMPONENTS",
      "ROLLBACK_DEPENDENT_COMPONENTS",
      "NO_AUTOMATIC_ROLLBACK",
    ]),
    constraints: z.array(compoundConstraintSchema),
    populationRelationships: z.array(
      z
        .object({
          kind: z.enum(["SAME", "DIFFERENT"]),
          componentIds: z.tuple([ref, ref]),
        })
        .strict(),
    ),
    measurementHorizon: z
      .object({
        amount: z.number().positive(),
        unit: z.enum(["HOUR", "DAY", "WEEK", "MONTH"]),
      })
      .strict(),
    outcomePlan: actionOutcomePlanSchema.optional(),
    provenance: z.array(ref).min(1),
  })
  .strict();
export type CompoundAction = z.infer<typeof definition>;
/** Dependency graph includes canonical timing references and implicit ORDERED edges. */
export function compoundDependencyGraph(action: CompoundAction) {
  return action.components.map((component, index) => ({
    actionId: component.action.actionId,
    timing: component.action.timing,
    dependencies: [
      ...component.action.timing.dependencies,
      ...embeddedActionReferences(component.action.timing).map((actionId) => ({
        kind: "START_AFTER" as const,
        actionId,
      })),
      ...action.dependencies
        .filter((d) => d.componentId === component.componentId)
        .map(
          (d) =>
            ({
              kind: d.kind === "REQUIRES" ? "START_AFTER" : d.kind,
              actionId:
                action.components.find((c) => c.componentId === d.dependsOn)
                  ?.action.actionId ?? d.dependsOn,
            }) as TimingDependency,
        ),
      ...(action.ordering === "ORDERED" && index > 0
        ? [
            {
              kind: "START_AFTER" as const,
              actionId: action.components[index - 1]!.action.actionId,
            },
          ]
        : []),
    ],
  }));
}
export const compoundActionSchema = definition.superRefine((action, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = new Set(action.components.map((c) => c.componentId));
  if (
    ids.size !== action.components.length ||
    new Set(action.components.map((c) => c.action.actionId)).size !==
      action.components.length
  )
    issue("Component and Action identities must be unique");
  for (const d of action.dependencies) {
    if (!ids.has(d.componentId) || !ids.has(d.dependsOn))
      issue("Unknown dependency component");
    if (
      d.kind === "REQUIRES" &&
      d.requiredState === "RESOLVED" &&
      action.components.find((c) => c.componentId === d.dependsOn)?.action.what
        .actionType !== "investigation.inspect"
    )
      issue("RESOLVED requires an investigation component");
  }
  for (const c of action.constraints) {
    if (
      c.componentIds.some((id) => !ids.has(id)) ||
      new Set(c.componentIds).size !== c.componentIds.length
    )
      issue("Invalid constraint component references");
  }
  if (
    new Set(action.constraints.map((c) => c.constraintId)).size !==
    action.constraints.length
  )
    issue("Constraint identities must be unique");
  for (const relationship of action.populationRelationships) {
    const [a, b] = relationship.componentIds.map((id) =>
      action.components.find((c) => c.componentId === id),
    );
    if (!a?.action.population || !b?.action.population) {
      issue(
        "Population relationships require explicit canonical population references",
      );
      continue;
    }
    const equal =
      JSON.stringify(canonicalizeForSerialization(a.action.population)) ===
      JSON.stringify(canonicalizeForSerialization(b.action.population));
    if (equal !== (relationship.kind === "SAME"))
      issue("Population relationship contradicts full canonical references");
  }
  const graph = validateTimingDependencyGraph(compoundDependencyGraph(action));
  if (!graph.ok) for (const i of graph.issues) issue(i.code + ": " + i.message);
});
export type MeasurableCompoundAction = CompoundAction & {
  outcomePlan: ActionOutcomePlan;
};
export const measurableCompoundActionSchema = compoundActionSchema.superRefine(
  (action, context) => {
    if (action.outcomePlan === undefined)
      context.addIssue({
        code: "custom",
        path: ["outcomePlan"],
        message:
          "Step 23+ Compound Actions require an explicit measurable outcome plan",
      });
    action.components.forEach((component, index) => {
      if (component.action.outcomePlan === undefined)
        context.addIssue({
          code: "custom",
          path: ["components", index, "action", "outcomePlan"],
          message:
            "Every component Action in a Step 23+ Compound Action requires its own measurable outcome plan",
        });
    });
  },
) as unknown as z.ZodType<MeasurableCompoundAction>;

export type ActionSpaceCompoundAction = MeasurableCompoundAction & {
  components: Array<
    CompoundAction["components"][number] & {
      action: ActionSpaceCanonicalAction;
    }
  >;
};
export const actionSpaceCompoundActionSchema =
  measurableCompoundActionSchema.superRefine((action, context) => {
    action.components.forEach((component, index) => {
      const parsed = actionSpaceCanonicalActionSchema.safeParse(component.action);
      if (!parsed.success)
        parsed.error.issues.forEach((issue) =>
          context.addIssue({
            code: "custom",
            path: ["components", index, "action", ...issue.path],
            message: issue.message,
          }),
        );
    });
  }) as unknown as z.ZodType<ActionSpaceCompoundAction>;

export function assertCompoundAction(value: unknown): CompoundAction {
  return compoundActionSchema.parse(value);
}
export function assertMeasurableCompoundAction(
  value: unknown,
): MeasurableCompoundAction {
  return measurableCompoundActionSchema.parse(value);
}
export function assertActionSpaceCompoundAction(
  value: unknown,
): ActionSpaceCompoundAction {
  return actionSpaceCompoundActionSchema.parse(value);
}
export function serializeCompoundAction(value: CompoundAction): string {
  return JSON.stringify(
    canonicalizeForSerialization(compoundActionSchema.parse(value)),
  );
}
export function deserializeCompoundAction(value: string): CompoundAction {
  return compoundActionSchema.parse(JSON.parse(value));
}
/** Intent identity includes every component identity; runtime evidence is excluded. */
export function fingerprintCompoundAction(value: CompoundAction): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of serializeCompoundAction(value))
    hash =
      ((hash ^ BigInt(character.codePointAt(0)!)) * 0x100000001b3n) &
      0xffffffffffffffffn;
  return "fnv1a64:" + hash.toString(16).padStart(16, "0");
}

function embeddedActionReferences(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "actionId" && typeof entry === "string"
      ? [entry]
      : embeddedActionReferences(entry),
  );
}
