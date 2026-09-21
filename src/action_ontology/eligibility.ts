import type {
  Action,
  ActionTarget,
  ConstraintExpression,
  EligibilityInformationRequirement,
  EligibilityResult,
  ScalarValue,
} from "./types.js";

export type EligibilityObservation<T> =
  | { readonly status: "known"; readonly value: T; readonly evidenceRef?: string }
  | { readonly status: "unknown"; readonly reason: string };

export interface ActionEligibilityBusinessState {
  /**
   * This view is intentionally abstract. The ontology does not own or build a
   * Business State engine.
   */
  readonly readProperty: (
    propertyId: string,
  ) => EligibilityObservation<ScalarValue>;
  readonly entityExists: (
    target: ActionTarget,
  ) => EligibilityObservation<boolean>;
  readonly capabilityAvailable: (
    capabilityId: string,
  ) => EligibilityObservation<boolean>;
  readonly evidenceAvailable: (
    evidenceRef: string,
    maximumAgeSeconds?: number,
  ) => EligibilityObservation<boolean>;
}

export interface ActionEligibilityEvaluator {
  readonly isEligible: (
    action: Action,
    businessState: ActionEligibilityBusinessState,
  ) => EligibilityResult;
}

function expressionRequirement(
  expression: ConstraintExpression,
  prefix: string,
  index: number,
): EligibilityInformationRequirement {
  switch (expression.kind) {
    case "property_comparison":
      return {
        requirementId: prefix + ":" + index,
        kind: "business_property",
        reference: expression.propertyId,
      };
    case "entity_exists":
      return {
        requirementId: prefix + ":" + index,
        kind: "entity_presence",
        reference: JSON.stringify(expression.target),
      };
    case "capability_available":
      return {
        requirementId: prefix + ":" + index,
        kind: "capability",
        reference: expression.capabilityId,
      };
    case "evidence_available":
      return {
        requirementId: prefix + ":" + index,
        kind: "evidence",
        reference: expression.evidenceRef,
      };
  }
}

/**
 * Static declaration of the information an eventual eligibility evaluator
 * needs. This does not decide eligibility and does not depend on a Business
 * State implementation.
 */
export function eligibilityInformationRequirements(
  action: Action,
): readonly EligibilityInformationRequirement[] {
  const requirements: EligibilityInformationRequirement[] = [];

  action.preconditions.forEach((precondition, index) => {
    requirements.push(
      expressionRequirement(precondition.expression, "precondition", index),
    );
  });

  action.constraints
    .filter((constraint) => constraint.constraintClass === "hard")
    .forEach((constraint, index) => {
      requirements.push(
        expressionRequirement(constraint.expression, "hard_constraint", index),
      );
    });

  const deduped = new Map<string, EligibilityInformationRequirement>();
  for (const requirement of requirements) {
    const key = requirement.kind + ":" + requirement.reference;
    if (!deduped.has(key)) deduped.set(key, requirement);
  }

  return [...deduped.values()];
}
