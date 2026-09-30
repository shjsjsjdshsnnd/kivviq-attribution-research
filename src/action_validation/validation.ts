import {
  measurableCanonicalActionSchema,
  type MeasurableCanonicalAction,
} from "../canonical_action/schema.js";
import {
  fingerprintCanonicalAction,
} from "../canonical_action/serialization.js";
import {
  measurableCompoundActionSchema,
  fingerprintCompoundAction,
  type MeasurableCompoundAction,
} from "../compound_action/schema.js";
import {
  assessPortfolioCompatibility,
  type PortfolioCompatibilityAssessment,
  type PortfolioCompatibilityContext,
} from "../action_conflicts/assessment.js";
import type { CanonicalEntityReference } from "../action_dependencies/schema.js";

export const ACTION_SPACE_VALIDATION_VERSION = "1.0.0" as const;

export type ValidatedActionSpaceDecision =
  | { kind: "ACTION"; action: MeasurableCanonicalAction }
  | { kind: "COMPOUND"; action: MeasurableCompoundAction };

export interface ActionSpaceValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type ActionSpaceValidationResult =
  | {
      readonly ok: true;
      readonly version: typeof ACTION_SPACE_VALIDATION_VERSION;
      readonly decision: ValidatedActionSpaceDecision;
    }
  | {
      readonly ok: false;
      readonly version: typeof ACTION_SPACE_VALIDATION_VERSION;
      readonly issues: readonly ActionSpaceValidationIssue[];
    };

export type ActionSpacePortfolioValidationResult =
  | {
      readonly ok: true;
      readonly version: typeof ACTION_SPACE_VALIDATION_VERSION;
      readonly decisions: readonly ValidatedActionSpaceDecision[];
      readonly references: readonly CanonicalEntityReference[];
      readonly compatibility?: PortfolioCompatibilityAssessment;
    }
  | {
      readonly ok: false;
      readonly version: typeof ACTION_SPACE_VALIDATION_VERSION;
      readonly issues: readonly ActionSpaceValidationIssue[];
      readonly compatibility?: PortfolioCompatibilityAssessment;
    };

const forbiddenKnowledgeKeys = new Set([
  "groundtruth",
  "groundtruthmanifest",
  "oraclestate",
  "oracleanswer",
  "latentstate",
  "futurestate",
  "futuredemand",
  "futureconversion",
  "futureconversions",
  "futureorders",
  "futurecustomers",
  "counterfactualrevenue",
  "counterfactualprofit",
  "counterfactualoutcome",
  "trueincrementalroas",
  "trueincrementalprofit",
  "actualbestaction",
  "optimalaction",
  "optimalvalue",
  "decisionregret",
  "recommendationscore",
  "confidencescore",
  "predictedbestaction",
  "predictedoutcome",
  "expectedprofit",
  "expectedrevenue",
  "expectedroas",
  "expectedlift",
]);

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function hiddenKnowledgeIssue(
  value: unknown,
  path: readonly (string | number)[] = [],
  ancestors = new WeakSet<object>(),
  state = { nodes: 0 },
): ActionSpaceValidationIssue | undefined {
  if (value === null || typeof value !== "object") return undefined;
  state.nodes += 1;
  if (state.nodes > 20_000)
    return {
      code: "INPUT_TOO_COMPLEX",
      path: path.join("."),
      message: "Action Space input exceeds the validation complexity limit",
    };
  if (ancestors.has(value))
    return {
      code: "CYCLIC_INPUT",
      path: path.join("."),
      message: "Cyclic Action Space inputs are forbidden",
    };
  ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [index, entry] as const)
    : Object.entries(value);
  for (const [key, nested] of entries) {
    if (
      typeof key === "string" &&
      forbiddenKnowledgeKeys.has(normalizeKey(key))
    ) {
      ancestors.delete(value);
      return {
        code: "HIDDEN_GOD_MODE_INFORMATION",
        path: [...path, key].join("."),
        message:
          "Action definitions and portfolios cannot contain hidden truth, future state, counterfactual answers, optimizer answers, or predictions",
      };
    }
    const issue = hiddenKnowledgeIssue(
      nested,
      [...path, key],
      ancestors,
      state,
    );
    if (issue) {
      ancestors.delete(value);
      return issue;
    }
  }
  ancestors.delete(value);
  return undefined;
}

function zodIssues(error: {
  issues: readonly {
    path: readonly (string | number)[];
    message: string;
    code: string;
  }[];
}): ActionSpaceValidationIssue[] {
  return error.issues.map((issue) => ({
    code: "INVALID_ACTION_SPACE_DECISION:" + issue.code,
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validateActionSpaceDecision(
  input: unknown,
): ActionSpaceValidationResult {
  const hidden = hiddenKnowledgeIssue(input);
  if (hidden)
    return {
      ok: false,
      version: ACTION_SPACE_VALIDATION_VERSION,
      issues: [hidden],
    };

  const compound = measurableCompoundActionSchema.safeParse(input);
  if (compound.success)
    return {
      ok: true,
      version: ACTION_SPACE_VALIDATION_VERSION,
      decision: { kind: "COMPOUND", action: compound.data },
    };

  const atomic = measurableCanonicalActionSchema.safeParse(input);
  if (atomic.success)
    return {
      ok: true,
      version: ACTION_SPACE_VALIDATION_VERSION,
      decision: { kind: "ACTION", action: atomic.data },
    };

  const looksCompound =
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>)["kind"] === "compound_action";

  return {
    ok: false,
    version: ACTION_SPACE_VALIDATION_VERSION,
    issues: zodIssues(looksCompound ? compound.error : atomic.error),
  };
}

function referenceFor(
  decision: ValidatedActionSpaceDecision,
): CanonicalEntityReference {
  return decision.kind === "ACTION"
    ? {
        entityKind: "ACTION",
        actionId: decision.action.actionId,
        actionFingerprint: fingerprintCanonicalAction(decision.action),
      }
    : {
        entityKind: "COMPOUND",
        compoundActionId: decision.action.compoundActionId,
        compoundFingerprint: fingerprintCompoundAction(decision.action),
      };
}

function decisionKey(decision: ValidatedActionSpaceDecision): string {
  return decision.kind === "ACTION"
    ? "ACTION:" + decision.action.actionId
    : "COMPOUND:" + decision.action.compoundActionId;
}

export function validateActionSpacePortfolio(
  input: readonly unknown[],
  compatibilityContext?: PortfolioCompatibilityContext,
): ActionSpacePortfolioValidationResult {
  if (!Array.isArray(input) || input.length === 0)
    return {
      ok: false,
      version: ACTION_SPACE_VALIDATION_VERSION,
      issues: [
        {
          code: "EMPTY_PORTFOLIO",
          path: "",
          message: "An Action portfolio must contain at least one decision",
        },
      ],
    };

  const decisions: ValidatedActionSpaceDecision[] = [];
  const issues: ActionSpaceValidationIssue[] = [];
  input.forEach((candidate, index) => {
    const result = validateActionSpaceDecision(candidate);
    if (result.ok) decisions.push(result.decision);
    else
      issues.push(
        ...result.issues.map((issue) => ({
          ...issue,
          path: issue.path
            ? `${index}.${issue.path}`
            : String(index),
        })),
      );
  });
  if (issues.length > 0)
    return {
      ok: false,
      version: ACTION_SPACE_VALIDATION_VERSION,
      issues,
    };

  const seen = new Set<string>();
  decisions.forEach((decision, index) => {
    const key = decisionKey(decision);
    if (seen.has(key))
      issues.push({
        code: "DUPLICATE_PORTFOLIO_DECISION",
        path: String(index),
        message: "A portfolio cannot contain the same Action identity twice",
      });
    seen.add(key);
  });
  if (issues.length > 0)
    return {
      ok: false,
      version: ACTION_SPACE_VALIDATION_VERSION,
      issues,
    };

  const references = decisions.map(referenceFor);
  if (compatibilityContext === undefined)
    return {
      ok: true,
      version: ACTION_SPACE_VALIDATION_VERSION,
      decisions,
      references,
    };

  const compatibility = assessPortfolioCompatibility(
    references,
    compatibilityContext,
  );
  if (
    compatibility.validity !== "VALID" ||
    compatibility.status !== "COMPATIBLE"
  )
    return {
      ok: false,
      version: ACTION_SPACE_VALIDATION_VERSION,
      issues: [
        {
          code:
            compatibility.status === "CONFLICTING"
              ? "PORTFOLIO_CONFLICT"
              : "PORTFOLIO_COMPATIBILITY_UNRESOLVED",
          path: "",
          message:
            compatibility.reasonCodes.join(", ") ||
            "Action portfolio compatibility is not established",
        },
      ],
      compatibility,
    };

  return {
    ok: true,
    version: ACTION_SPACE_VALIDATION_VERSION,
    decisions,
    references,
    compatibility,
  };
}
