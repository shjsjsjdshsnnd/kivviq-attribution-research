import type {
  Action,
  CroComponentTarget,
} from "../action_ontology/types.js";
import { croStableKey, resolveCroOrdering } from "./ordering.js";
import type {
  CroEligibilityContext,
  CroEligibilityDecision,
  CroExperienceState,
} from "./types.js";

function componentPresent(
  components: readonly CroComponentTarget[],
  target: CroComponentTarget,
): boolean {
  return components.some((candidate) => {
    if (candidate.component !== target.component) return false;
    if (target.instanceId === undefined) return true;
    return candidate.instanceId === target.instanceId;
  });
}

function experienceFor(
  action: Action,
  context: CroEligibilityContext,
): CroExperienceState | undefined {
  if (action.parameters.kind !== "cro_intervention") return undefined;
  const parameters = action.parameters;
  return context.experiences?.find(
    (experience) =>
      experience.surface === parameters.surface &&
      croStableKey(experience.pageScope) ===
        croStableKey(parameters.pageScope) &&
      experience.device === parameters.device,
  );
}

export function evaluateCroEligibility(
  action: Action,
  context: CroEligibilityContext,
): CroEligibilityDecision {
  if (action.parameters.kind !== "cro_intervention") {
    return {
      status: "ineligible",
      reasonCodes: ["NOT_CRO_INTERVENTION"],
      missingInformation: [],
    };
  }

  const parameters = action.parameters;
  const experience = experienceFor(action, context);
  if (!experience) {
    return {
      status: "unknown",
      reasonCodes: ["CRO_EXPERIENCE_CONTEXT_UNKNOWN"],
      missingInformation: [
        croStableKey({
          surface: parameters.surface,
          pageScope: parameters.pageScope,
          device: parameters.device,
        }),
      ],
    };
  }

  const present = componentPresent(
    experience.presentComponents,
    parameters.component,
  );

  if (parameters.intervention === "ADD") {
    if (parameters.addSemantics?.kind === "REQUIRE_ABSENT" && present) {
      return {
        status: "ineligible",
        reasonCodes: ["CRO_COMPONENT_ALREADY_EXISTS"],
        missingInformation: [],
      };
    }
    if (
      parameters.addSemantics?.kind === "ALLOW_ADDITIONAL_INSTANCE" &&
      parameters.addSemantics.instanceId &&
      experience.presentComponents.some(
        (component) =>
          component.component === parameters.component.component &&
          component.instanceId === parameters.addSemantics?.instanceId,
      )
    ) {
      return {
        status: "ineligible",
        reasonCodes: ["CRO_COMPONENT_INSTANCE_ALREADY_EXISTS"],
        missingInformation: [],
      };
    }
  } else if (!present) {
    return {
      status: "ineligible",
      reasonCodes: ["CRO_COMPONENT_NOT_PRESENT"],
      missingInformation: [],
    };
  }

  if (
    parameters.intervention === "MODIFY_PERFORMANCE" &&
    !experience.performanceConfigurationRef
  ) {
    return {
      status: "unknown",
      reasonCodes: ["CRO_PERFORMANCE_CONFIGURATION_UNKNOWN"],
      missingInformation: ["current performance configuration"],
    };
  }

  const missingCapabilities = parameters.requiredCapabilities.filter(
    (capability) => !experience.capabilities.includes(capability),
  );
  if (missingCapabilities.length > 0) {
    return {
      status: "ineligible",
      reasonCodes: ["CRO_SURFACE_CAPABILITY_UNAVAILABLE"],
      missingInformation: missingCapabilities,
    };
  }

  if (parameters.intervention === "REORDER") {
    const resolution = resolveCroOrdering(action, context.structures ?? []);
    if (resolution.status === "MISSING_CONTEXT") {
      return {
        status: "unknown",
        reasonCodes: [resolution.code],
        missingInformation: [resolution.missingRef],
      };
    }
    if (resolution.status === "INVALID") {
      return {
        status: "ineligible",
        reasonCodes: [resolution.code],
        missingInformation: [],
      };
    }
  }

  if (
    parameters.audience.kind === "CUSTOMER_SEGMENT" &&
    parameters.audience.membership.bindingRef &&
    !context.audienceMembershipBindingRefs?.includes(
      parameters.audience.membership.bindingRef,
    )
  ) {
    return {
      status: "unknown",
      reasonCodes: ["CRO_AUDIENCE_MEMBERSHIP_UNKNOWN"],
      missingInformation: [
        parameters.audience.membership.bindingRef,
      ],
    };
  }

  for (const constraint of action.constraints) {
    if (constraint.constraintClass !== "hard") continue;
    const state = context.hardConstraintResults?.[constraint.constraintId];
    if (state === "violated") {
      return {
        status: "ineligible",
        reasonCodes: ["HARD_CONSTRAINT_VIOLATED:" + constraint.constraintId],
        missingInformation: [],
      };
    }
    if (state === undefined || state === "unknown") {
      return {
        status: "unknown",
        reasonCodes: ["HARD_CONSTRAINT_UNKNOWN:" + constraint.constraintId],
        missingInformation: [constraint.constraintId],
      };
    }
  }

  return { status: "eligible", reasonCodes: [], missingInformation: [] };
}
