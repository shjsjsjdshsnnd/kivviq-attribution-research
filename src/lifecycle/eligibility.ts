import type {
  Action,
  LifecycleAudienceDefinition,
  LifecycleAudienceSelector,
  LifecycleChannel,
  LifecycleChannelEligibility,
  LifecycleFlowTrigger,
  LifecycleSuppressionRule,
} from "../action_ontology/types.js";
import type {
  LifecycleChannelEvidence,
  LifecycleEligibilityContext,
  LifecycleEligibilityDecision,
} from "./types.js";

function channelKey(channel: LifecycleChannel): string {
  return channel.kind === "CUSTOM"
    ? "CUSTOM:" + channel.channelId
    : channel.kind;
}

function channelEvidence(
  channel: LifecycleChannel,
  context: LifecycleEligibilityContext,
): LifecycleChannelEvidence | undefined {
  const key = channelKey(channel);
  return context.channelEvidence?.find(
    (evidence) => channelKey(evidence.channel) === key,
  );
}

function boundaryReady(
  evaluateAt: "DECISION_TIME" | "SEND_TIME" | "TRIGGER_TIME",
  bindingRef: string | undefined,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  if (context.evaluationBoundary !== evaluateAt) {
    return {
      status: "unknown",
      reasonCodes: ["LIFECYCLE_MEMBERSHIP_BOUNDARY_NOT_REACHED"],
      missingInformation: [evaluateAt],
    };
  }
  if (
    bindingRef &&
    !context.membershipBindingRefs?.includes(bindingRef)
  ) {
    return {
      status: "unknown",
      reasonCodes: ["LIFECYCLE_MEMBERSHIP_SNAPSHOT_UNAVAILABLE"],
      missingInformation: [bindingRef],
    };
  }
}

function evaluateSelector(
  selector: LifecycleAudienceSelector,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  if (selector.kind === "ALL_ELIGIBLE_CONTACTS") return undefined;
  if (selector.kind === "CUSTOMER_SEGMENT") {
    const boundary = boundaryReady(
      selector.membership.evaluateAt,
      selector.membership.bindingRef,
      context,
    );
    if (boundary) return boundary;
    if (!context.segmentIds) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_SEGMENT_MEMBERSHIP_UNKNOWN"],
        missingInformation: [selector.segmentId],
      };
    }
    if (!context.segmentIds.includes(selector.segmentId)) {
      return {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_SEGMENT_NOT_INCLUDED"],
        missingInformation: [],
      };
    }
    return undefined;
  }
  if (context.purchaseCount === undefined) {
    return {
      status: "unknown",
      reasonCodes: ["LIFECYCLE_PURCHASE_COUNT_UNKNOWN"],
      missingInformation: ["purchase count"],
    };
  }
  const passes =
    selector.kind === "PURCHASE_COUNT_EQUALS"
      ? context.purchaseCount === selector.count
      : context.purchaseCount >= selector.count;
  return passes
    ? undefined
    : {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_PURCHASE_COUNT_NOT_ELIGIBLE"],
        missingInformation: [],
      };
}

function evaluateAudience(
  audience: LifecycleAudienceDefinition,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  let unknown: LifecycleEligibilityDecision | undefined;
  let included = false;
  for (const selector of audience.include) {
    const result = evaluateSelector(selector, context);
    if (!result) {
      included = true;
      break;
    }
    if (result.status === "unknown") unknown ??= result;
  }
  if (!included) {
    return (
      unknown ?? {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_AUDIENCE_NOT_INCLUDED"],
        missingInformation: [],
      }
    );
  }

  for (const suppression of audience.suppress) {
    const result = evaluateSuppression(suppression, context);
    if (result) return result;
  }
}

function evaluateSuppression(
  suppression: LifecycleSuppressionRule,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  if (suppression.kind === "RECENT_PURCHASE_WITHIN") {
    if (context.daysSinceLastPurchase === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_RECENT_PURCHASE_UNKNOWN"],
        missingInformation: ["days since last purchase"],
      };
    }
    return context.daysSinceLastPurchase < suppression.days
      ? {
          status: "ineligible",
          reasonCodes: ["LIFECYCLE_RECENT_PURCHASE_SUPPRESSED"],
          missingInformation: [],
        }
      : undefined;
  }
  if (suppression.kind === "CURRENT_FLOW_MEMBERSHIP") {
    if (!context.currentFlowIds) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_FLOW_MEMBERSHIP_UNKNOWN"],
        missingInformation: [suppression.flowId],
      };
    }
    return context.currentFlowIds.includes(suppression.flowId)
      ? {
          status: "ineligible",
          reasonCodes: ["LIFECYCLE_CURRENT_FLOW_SUPPRESSED"],
          missingInformation: [],
        }
      : undefined;
  }
  if (suppression.kind === "CUSTOMER_SEGMENT") {
    const boundary = boundaryReady(
      suppression.membership.evaluateAt,
      suppression.membership.bindingRef,
      context,
    );
    if (boundary) return boundary;
    if (!context.segmentIds) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_SUPPRESSION_SEGMENT_UNKNOWN"],
        missingInformation: [suppression.segmentId],
      };
    }
    return context.segmentIds.includes(suppression.segmentId)
      ? {
          status: "ineligible",
          reasonCodes: ["LIFECYCLE_SEGMENT_SUPPRESSED"],
          missingInformation: [],
        }
      : undefined;
  }
  if (suppression.kind === "CHANNEL_SUPPRESSED") {
    const evidence = channelEvidence(suppression.channel, context);
    if (!evidence || evidence.channelSuppressed === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_CHANNEL_SUPPRESSION_UNKNOWN"],
        missingInformation: [channelKey(suppression.channel)],
      };
    }
    return evidence.channelSuppressed
      ? {
          status: "ineligible",
          reasonCodes: ["LIFECYCLE_CHANNEL_SUPPRESSED"],
          missingInformation: [],
        }
      : undefined;
  }
  const policy = context.contactPolicies?.find(
    (candidate) =>
      candidate.contactPolicyId === suppression.contactPolicyId,
  );
  if (!policy || policy.decision === "UNKNOWN") {
    return {
      status: "unknown",
      reasonCodes: ["LIFECYCLE_CONTACT_POLICY_UNKNOWN"],
      missingInformation: [suppression.contactPolicyId],
    };
  }
  return policy.decision === "BLOCK"
    ? {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_CONTACT_POLICY_BLOCKED"],
        missingInformation: [],
      }
    : undefined;
}

function evaluateChannelEligibility(
  channel: LifecycleChannel,
  requirements: LifecycleChannelEligibility,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  const evidence = channelEvidence(channel, context);
  if (!evidence) {
    return {
      status: "unknown",
      reasonCodes: ["LIFECYCLE_CHANNEL_ELIGIBILITY_UNKNOWN"],
      missingInformation: [channelKey(channel)],
    };
  }
  if (requirements.requireConsent) {
    if (evidence.consentEligible === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_CONSENT_UNKNOWN"],
        missingInformation: [channelKey(channel)],
      };
    }
    if (!evidence.consentEligible) {
      return {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_CONSENT_INELIGIBLE"],
        missingInformation: [],
      };
    }
  }
  if (requirements.requireValidDestination) {
    if (evidence.validDestination === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_CONTACT_DESTINATION_UNKNOWN"],
        missingInformation: [channelKey(channel)],
      };
    }
    if (!evidence.validDestination) {
      return {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_CONTACT_DESTINATION_INVALID"],
        missingInformation: [],
      };
    }
  }
  if (requirements.requireNotChannelSuppressed) {
    if (evidence.channelSuppressed === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_CHANNEL_SUPPRESSION_UNKNOWN"],
        missingInformation: [channelKey(channel)],
      };
    }
    if (evidence.channelSuppressed) {
      return {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_CHANNEL_SUPPRESSED"],
        missingInformation: [],
      };
    }
  }
}

function evaluateContactPolicies(
  refs: readonly string[],
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  for (const ref of refs) {
    const policy = context.contactPolicies?.find(
      (candidate) => candidate.contactPolicyId === ref,
    );
    if (!policy || policy.decision === "UNKNOWN") {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_CONTACT_POLICY_UNKNOWN"],
        missingInformation: [ref],
      };
    }
    if (policy.decision === "BLOCK") {
      return {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_CONTACT_POLICY_BLOCKED"],
        missingInformation: [],
      };
    }
  }
}

function evaluateTrigger(
  trigger: LifecycleFlowTrigger,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
  if (trigger.kind === "AUDIENCE_ENTRY") return undefined;
  if (trigger.kind === "METRIC_THRESHOLD") {
    const value =
      trigger.metric === "DAYS_SINCE_LAST_PURCHASE"
        ? context.daysSinceLastPurchase
        : context.daysSinceLastEngagement;
    if (value === undefined) {
      return {
        status: "unknown",
        reasonCodes: ["LIFECYCLE_TRIGGER_METRIC_UNKNOWN"],
        missingInformation: [trigger.metric],
      };
    }
    const passes =
      trigger.operator === "GTE"
        ? value >= trigger.value
        : trigger.operator === "GT"
          ? value > trigger.value
          : value === trigger.value;
    return passes
      ? undefined
      : {
          status: "ineligible",
          reasonCodes: ["LIFECYCLE_TRIGGER_NOT_MET"],
          missingInformation: [],
        };
  }

  if (!context.knownEvents) {
    return {
      status: "unknown",
      reasonCodes: ["LIFECYCLE_EVENT_HISTORY_UNKNOWN"],
      missingInformation: [trigger.event.kind],
    };
  }
  const expected = JSON.stringify(trigger.event);
  return context.knownEvents.some(
    (event) => JSON.stringify(event.event) === expected,
  )
    ? undefined
    : {
        status: "ineligible",
        reasonCodes: ["LIFECYCLE_TRIGGER_EVENT_NOT_FOUND"],
        missingInformation: [],
      };
}

function hardConstraints(
  action: Action,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision | undefined {
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
}

export function evaluateLifecycleEligibility(
  action: Action,
  context: LifecycleEligibilityContext,
): LifecycleEligibilityDecision {
  if (action.parameters.kind === "lifecycle_send") {
    const audience = evaluateAudience(action.parameters.audience, context);
    if (audience) return audience;
    const eligibility = evaluateChannelEligibility(
      action.parameters.channel,
      action.parameters.eligibility,
      context,
    );
    if (eligibility) return eligibility;
    const contactPolicy = evaluateContactPolicies(
      action.parameters.contactPolicyRefs,
      context,
    );
    if (contactPolicy) return contactPolicy;
  } else if (action.parameters.kind === "lifecycle_flow_start") {
    const definition = action.parameters.definition;
    const audience = evaluateAudience(definition.audience, context);
    if (audience) return audience;
    const trigger = evaluateTrigger(definition.trigger, context);
    if (trigger) return trigger;
    const firstStep = definition.sequence[0];
    if (firstStep) {
      const eligibility = evaluateChannelEligibility(
        firstStep.channel,
        firstStep.eligibility,
        context,
      );
      if (eligibility) return eligibility;
      for (const suppression of firstStep.suppress) {
        const result = evaluateSuppression(suppression, context);
        if (result) return result;
      }
    }
    const contactPolicy = evaluateContactPolicies(
      definition.contactPolicyRefs,
      context,
    );
    if (contactPolicy) return contactPolicy;
  } else {
    return {
      status: "ineligible",
      reasonCodes: ["NOT_LIFECYCLE_CONTACT_ELIGIBILITY_ACTION"],
      missingInformation: [],
    };
  }

  const constraints = hardConstraints(action, context);
  if (constraints) return constraints;
  return { status: "eligible", reasonCodes: [], missingInformation: [] };
}
