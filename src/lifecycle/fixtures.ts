import { currencyCode, utcTimestamp } from "../core/units.js";
import { doNothingAction } from "../action_ontology/fixtures.js";
import { actionId, actionType } from "../action_ontology/identity.js";
import type {
  Action,
  ActionParameters,
  LifecycleAudienceDefinition,
  LifecycleChannel,
  LifecycleChannelEligibility,
  LifecycleFlowDefinition,
  LifecycleFrequencyPolicy,
  LifecyclePolicyRollbackValue,
  LifecyclePurpose,
  LifecycleRollbackContract,
  LifecycleSequenceStep,
} from "../action_ontology/types.js";
import { assertValidAction } from "../action_ontology/validation.js";
import type { LifecyclePolicySnapshot } from "./types.js";

const CAD = currencyCode("CAD");
const DECISION = utcTimestamp("2026-09-22T13:00:00Z");
const FRIDAY_10_MONTREAL = utcTimestamp("2026-09-25T14:00:00Z");
const FOUR_WEEKS = 28 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;
const THIRTY_DAYS = 30 * DAY;

const EMAIL: LifecycleChannel = { kind: "EMAIL" };
const SMS: LifecycleChannel = { kind: "SMS" };

const requiredChannelEligibility: LifecycleChannelEligibility = {
  requireConsent: true,
  requireValidDestination: true,
  requireNotChannelSuppressed: true,
};

const allEligible: LifecycleAudienceDefinition = {
  include: [{ kind: "ALL_ELIGIBLE_CONTACTS" }],
  suppress: [],
  suppressionPrecedence: "SUPPRESS_OVERRIDES_INCLUDE",
};

function segmentAudience(
  segmentId: string,
  evaluateAt: "DECISION_TIME" | "SEND_TIME" | "TRIGGER_TIME",
  bindingRef?: string,
): LifecycleAudienceDefinition {
  return {
    include: [
      {
        kind: "CUSTOMER_SEGMENT",
        segmentId,
        membership: {
          evaluateAt,
          ...(bindingRef ? { bindingRef } : {}),
        },
      },
    ],
    suppress: [],
    suppressionPrecedence: "SUPPRESS_OVERRIDES_INCLUDE",
  };
}

function lifecycleMeasurement(
  purpose: LifecyclePurpose,
): Action["measurement"] {
  const isRetention =
    purpose.kind === "WINBACK" ||
    purpose.kind === "RETENTION" ||
    purpose.kind === "REPLENISHMENT";
  return {
    earliestMeaningfulEvaluationSeconds: DAY,
    primaryEvaluationSeconds: 14 * DAY,
    longTermFollowUpSeconds: 30 * DAY,
    outcomes: [
      {
        family: isRetention ? "repeat_customers" : "engagement",
        metricId: isRetention
          ? "repeat_purchase_rate"
          : "lifecycle_click_rate",
        role: "primary",
      },
      {
        family: "messaging_delivery",
        metricId: "lifecycle_delivery_rate",
        role: "guardrail",
      },
      {
        family: "subscription_status",
        metricId: "lifecycle_opt_out_rate",
        role: "guardrail",
      },
    ],
  };
}

function lifecycleAction(input: {
  actionIdValue: string;
  actionTypeValue:
    | "lifecycle.send"
    | "lifecycle.start_flow"
    | "lifecycle.stop_flow"
    | "lifecycle.modify_flow"
    | "lifecycle.adjust_frequency"
    | "lifecycle.target_segment"
    | "lifecycle.rollback_policy";
  target: Action["target"];
  description: string;
  parameters: ActionParameters;
  purpose?: LifecyclePurpose;
  timing?: Action["timing"];
  duration?: Action["duration"];
  termination?: Action["termination"];
  lifecycleRollback?: LifecycleRollbackContract;
  reversalOfActionId?: Action["reversalOfActionId"];
}): Action {
  const timing =
    input.timing ??
    ({
      decisionTime: DECISION,
      requestedStart: { kind: "known", at: DECISION },
      effectiveStart: { kind: "known", at: DECISION },
      implementationDelaySeconds: { kind: "known", seconds: 0 },
    } as const);
  const duration =
    input.duration ??
    (input.actionTypeValue === "lifecycle.send" ||
    input.actionTypeValue === "lifecycle.stop_flow" ||
    input.actionTypeValue === "lifecycle.modify_flow" ||
    input.actionTypeValue === "lifecycle.rollback_policy"
      ? ({ kind: "instantaneous" } as const)
      : ({ kind: "persistent" } as const));
  const termination =
    input.termination ??
    (duration.kind === "temporary"
      ? ({
          kind: "fixed_duration",
          durationSeconds: duration.durationSeconds,
        } as const)
      : duration.kind === "instantaneous"
        ? ({
            kind: "fixed_end",
            at:
              timing.effectiveStart.kind === "known"
                ? timing.effectiveStart.at
                : DECISION,
          } as const)
        : ({ kind: "persistent" } as const));

  const purpose =
    input.purpose ??
    (input.parameters.kind === "lifecycle_send"
      ? input.parameters.purpose
      : input.parameters.kind === "lifecycle_flow_start"
        ? input.parameters.definition.purpose
        : ({ kind: "GENERAL_CAMPAIGN" } as const));

  const sendIrreversible = input.actionTypeValue === "lifecycle.send";

  return assertValidAction({
    ...doNothingAction,
    actionId: actionId(input.actionIdValue),
    actionType: actionType(input.actionTypeValue),
    actionCategory: "lifecycle",
    schemaVersion: "1.8.0",
    description: input.description,
    target: input.target,
    parameters: input.parameters,
    timing,
    duration,
    termination,
    reversibility: sendIrreversible
      ? {
          classification: "effectively_irreversible",
          reversal: {
            kind: "none",
            reason: "A communication already sent cannot be unsent.",
          },
        }
      : {
          classification: "immediately_reversible",
          reversal: {
            kind: "restore_previous_value",
            target: input.target,
            parameterKind: input.parameters.kind,
          },
          minimumDelaySeconds: 0,
          ...(input.lifecycleRollback
            ? { lifecycleRollback: input.lifecycleRollback }
            : {}),
        },
    measurement: lifecycleMeasurement(purpose),
    intent: {
      statement:
        "Represent a structured lifecycle marketing decision without message creative, prediction or provider execution.",
    },
    ...(input.reversalOfActionId
      ? { reversalOfActionId: input.reversalOfActionId }
      : {}),
  });
}

function sendParameters(input: {
  channel: LifecycleChannel;
  purpose: LifecyclePurpose;
  audience: LifecycleAudienceDefinition;
  timing: Extract<
    ActionParameters,
    { kind: "lifecycle_send" }
  >["timing"];
  contactPolicyRefs?: readonly string[];
  coordinatedActionIds?: readonly ReturnType<typeof actionId>[];
}): Extract<ActionParameters, { kind: "lifecycle_send" }> {
  return {
    kind: "lifecycle_send",
    channel: input.channel,
    purpose: input.purpose,
    audience: input.audience,
    timing: input.timing,
    eligibility: requiredChannelEligibility,
    contactPolicyRefs: input.contactPolicyRefs ?? [],
    ...(input.coordinatedActionIds
      ? { coordinatedActionIds: input.coordinatedActionIds }
      : {}),
  };
}

function emailStep(
  stepId: string,
  position: number,
  delaySeconds: number,
): LifecycleSequenceStep {
  return {
    stepId,
    position,
    channel: EMAIL,
    delaySeconds,
    eligibility: requiredChannelEligibility,
    suppress: [],
    continuation: { kind: "CONTINUE_IF_NO_PURCHASE" },
    exitConditions: [{ kind: "PURCHASE_OCCURRED" }],
  };
}

function smsStep(
  stepId: string,
  position: number,
  delaySeconds: number,
): LifecycleSequenceStep {
  return {
    stepId,
    position,
    channel: SMS,
    delaySeconds,
    eligibility: requiredChannelEligibility,
    suppress: [],
    continuation: { kind: "CONTINUE_IF_NO_PURCHASE" },
    exitConditions: [{ kind: "PURCHASE_OCCURRED" }],
  };
}

function flowDefinition(input: {
  flowId: string;
  purpose: LifecyclePurpose;
  audience?: LifecycleAudienceDefinition;
  trigger: LifecycleFlowDefinition["trigger"];
  sequence: readonly LifecycleSequenceStep[];
  contactPolicyRefs?: readonly string[];
  conflictResolution?: LifecycleFlowDefinition["conflictResolution"];
}): LifecycleFlowDefinition {
  return {
    flowId: input.flowId,
    purpose: input.purpose,
    audience: input.audience ?? allEligible,
    trigger: input.trigger,
    sequence: input.sequence,
    exitConditions: [{ kind: "PURCHASE_OCCURRED" }],
    contactPolicyRefs: input.contactPolicyRefs ?? [],
    conflictResolution:
      input.conflictResolution ?? {
        kind: "SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS",
      },
  };
}

const emailCapPolicyId = "lifecyclepolicy_email_cap_7d";
const crossChannelPolicyId = "lifecyclepolicy_cross_channel_24h";
const emailCadencePolicyId = "lifecyclepolicy_email_campaign_cadence";
const smsCadencePolicyId = "lifecyclepolicy_sms_campaign_cadence";

export const sendEmailSegmentAFriday10 = lifecycleAction({
  actionIdValue: "action_lifecycle_send_email_segment_a_friday_10",
  actionTypeValue: "lifecycle.send",
  target: {
    kind: "lifecycle_program",
    programId: "lifecycleprogram_campaign_email",
  },
  description: "Send an email to Segment A Friday at 10:00 America/Toronto.",
  purpose: { kind: "GENERAL_CAMPAIGN" },
  parameters: sendParameters({
    channel: EMAIL,
    purpose: { kind: "GENERAL_CAMPAIGN" },
    audience: segmentAudience("segment:A", "SEND_TIME"),
    timing: {
      kind: "ABSOLUTE_TIME",
      at: FRIDAY_10_MONTREAL,
      timezone: "America/Toronto",
    },
    contactPolicyRefs: [emailCapPolicyId],
  }),
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: FRIDAY_10_MONTREAL },
    effectiveStart: { kind: "known", at: FRIDAY_10_MONTREAL },
    implementationDelaySeconds: { kind: "known", seconds: 0 },
  },
});

export const sendSmsSegmentB = lifecycleAction({
  actionIdValue: "action_lifecycle_send_sms_segment_b",
  actionTypeValue: "lifecycle.send",
  target: {
    kind: "lifecycle_program",
    programId: "lifecycleprogram_campaign_sms",
  },
  description: "Send an SMS to Segment B.",
  parameters: sendParameters({
    channel: SMS,
    purpose: { kind: "GENERAL_CAMPAIGN" },
    audience: segmentAudience("segment:B", "SEND_TIME"),
    timing: {
      kind: "ABSOLUTE_TIME",
      at: DECISION,
      timezone: "America/Toronto",
    },
    contactPolicyRefs: [crossChannelPolicyId],
  }),
});

export const sendVipSegmentASuppressRecentPurchasers = lifecycleAction({
  actionIdValue: "action_lifecycle_send_vip_a_suppress_recent_buyers",
  actionTypeValue: "lifecycle.send",
  target: {
    kind: "lifecycle_program",
    programId: "lifecycleprogram_vip_campaign",
  },
  description:
    "Send email to VIP Segment A while suppressing customers who purchased in the last seven days.",
  parameters: sendParameters({
    channel: EMAIL,
    purpose: { kind: "RETENTION" },
    audience: {
      ...segmentAudience("vip:A", "SEND_TIME"),
      suppress: [{ kind: "RECENT_PURCHASE_WITHIN", days: 7 }],
    },
    timing: {
      kind: "ABSOLUTE_TIME",
      at: FRIDAY_10_MONTREAL,
      timezone: "America/Toronto",
    },
    contactPolicyRefs: [emailCapPolicyId],
  }),
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: FRIDAY_10_MONTREAL },
    effectiveStart: { kind: "known", at: FRIDAY_10_MONTREAL },
    implementationDelaySeconds: { kind: "known", seconds: 0 },
  },
});

export const smsSendRequiresConsent = lifecycleAction({
  actionIdValue: "action_lifecycle_sms_requires_consent",
  actionTypeValue: "lifecycle.send",
  target: {
    kind: "lifecycle_program",
    programId: "lifecycleprogram_sms_consent_test",
  },
  description:
    "Send SMS to Segment B only when canonical SMS consent and destination evidence are available.",
  parameters: sendParameters({
    channel: SMS,
    purpose: { kind: "GENERAL_CAMPAIGN" },
    audience: segmentAudience("segment:B", "SEND_TIME"),
    timing: {
      kind: "ABSOLUTE_TIME",
      at: DECISION,
      timezone: "America/Toronto",
    },
  }),
});

export const winback90DayEmailFlow = lifecycleAction({
  actionIdValue: "action_lifecycle_start_winback_90_email",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_winback_90_email",
  },
  description: "Start a 90-day winback email flow.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_winback_90_email",
      purpose: { kind: "WINBACK" },
      trigger: {
        kind: "METRIC_THRESHOLD",
        metric: "DAYS_SINCE_LAST_PURCHASE",
        operator: "GTE",
        value: 90,
      },
      sequence: [emailStep("winback-email-1", 1, 0)],
      contactPolicyRefs: [emailCapPolicyId],
    }),
  },
});

export const multiStepWinbackEmailSmsFlow = lifecycleAction({
  actionIdValue: "action_lifecycle_start_winback_email_sms",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_winback_email_sms",
  },
  description: "Start a multi-step winback flow using email and SMS.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_winback_email_sms",
      purpose: { kind: "WINBACK" },
      trigger: {
        kind: "METRIC_THRESHOLD",
        metric: "DAYS_SINCE_LAST_PURCHASE",
        operator: "GTE",
        value: 90,
      },
      sequence: [
        emailStep("winback-step-1", 1, 0),
        emailStep("winback-step-2", 2, 7 * DAY),
        smsStep("winback-step-3", 3, 14 * DAY),
      ],
      contactPolicyRefs: [emailCapPolicyId, crossChannelPolicyId],
    }),
  },
});

export const postPurchaseCareAfterFulfillment = lifecycleAction({
  actionIdValue: "action_lifecycle_post_purchase_care_2d_fulfillment",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_post_purchase_care",
  },
  description: "Start post-purchase care email two days after fulfillment.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_post_purchase_care",
      purpose: { kind: "POST_PURCHASE" },
      trigger: { kind: "EVENT", event: { kind: "ORDER_FULFILLED" } },
      sequence: [emailStep("care-email-1", 1, 2 * DAY)],
    }),
  },
});

export const reviewRequestAfterDelivery = lifecycleAction({
  actionIdValue: "action_lifecycle_review_request_14d_delivery",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_review_request",
  },
  description: "Start review-request email fourteen days after delivery.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_review_request",
      purpose: { kind: "POST_PURCHASE" },
      trigger: { kind: "EVENT", event: { kind: "ORDER_DELIVERED" } },
      sequence: [emailStep("review-email-1", 1, 14 * DAY)],
    }),
  },
});

export const replenishmentProductA60Days = lifecycleAction({
  actionIdValue: "action_lifecycle_replenishment_product_a_60d",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_replenishment_product_a",
  },
  description:
    "Start replenishment reminder sixty days after Product A purchase.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_replenishment_product_a",
      purpose: { kind: "REPLENISHMENT" },
      trigger: {
        kind: "EVENT",
        event: { kind: "PRODUCT_PURCHASED", productId: "product:A" },
      },
      sequence: [emailStep("replenishment-email-1", 1, 60 * DAY)],
    }),
  },
});

export const retentionOneTimeBuyers = lifecycleAction({
  actionIdValue: "action_lifecycle_retention_one_time_buyers",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_retention_one_time_buyers",
  },
  description: "Start a retention sequence for one-time buyers.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_retention_one_time_buyers",
      purpose: { kind: "RETENTION" },
      audience: {
        include: [{ kind: "PURCHASE_COUNT_EQUALS", count: 1 }],
        suppress: [],
        suppressionPrecedence: "SUPPRESS_OVERRIDES_INCLUDE",
      },
      trigger: { kind: "AUDIENCE_ENTRY" },
      sequence: [emailStep("retention-email-1", 1, 30 * DAY)],
    }),
  },
});

export const targetProgramVipSegment = lifecycleAction({
  actionIdValue: "action_lifecycle_target_program_vip",
  actionTypeValue: "lifecycle.target_segment",
  target: {
    kind: "lifecycle_program",
    programId: "lifecycleprogram_retention",
  },
  description: "Target the retention lifecycle program to canonical VIP Segment A.",
  parameters: {
    kind: "lifecycle_targeting",
    audience: segmentAudience(
      "vip:A",
      "DECISION_TIME",
      "lifecycle-membership:vip-a:decision",
    ),
  },
});

const cadence2PerWeek: LifecycleFrequencyPolicy = {
  kind: "PLANNED_CADENCE",
  channel: EMAIL,
  purpose: { kind: "GENERAL_CAMPAIGN" },
  operation: {
    kind: "SET",
    value: { count: 2, windowSeconds: WEEK },
  },
};
const cadence3PerWeek: LifecycleFrequencyPolicy = {
  kind: "PLANNED_CADENCE",
  channel: EMAIL,
  purpose: { kind: "GENERAL_CAMPAIGN" },
  operation: {
    kind: "SET",
    value: { count: 3, windowSeconds: WEEK },
  },
};

export const increaseEmailFrequency2To3PerWeek = lifecycleAction({
  actionIdValue: "action_lifecycle_email_frequency_2_to_3_week",
  actionTypeValue: "lifecycle.adjust_frequency",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: emailCadencePolicyId,
  },
  description: "Increase email campaign frequency from two to three sends per week.",
  parameters: {
    kind: "frequency_adjustment",
    policy: {
      kind: "PLANNED_CADENCE",
      channel: EMAIL,
      purpose: { kind: "GENERAL_CAMPAIGN" },
      operation: {
        kind: "DELTA",
        direction: "increase",
        amount: { count: 1, windowSeconds: WEEK },
        reference: {
          kind: "explicit_baseline",
          value: { count: 2, windowSeconds: WEEK },
        },
      },
    },
  },
});

export const setEmailFrequency3PerWeek = lifecycleAction({
  actionIdValue: "action_lifecycle_email_frequency_set_3_week",
  actionTypeValue: "lifecycle.adjust_frequency",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: "lifecyclepolicy_email_set_3_week",
  },
  description: "Set email campaign frequency to three sends per week.",
  parameters: {
    kind: "frequency_adjustment",
    policy: cadence3PerWeek,
  },
});

export const maxMarketingEmail3Per7Days = lifecycleAction({
  actionIdValue: "action_lifecycle_email_cap_3_7d",
  actionTypeValue: "lifecycle.adjust_frequency",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: emailCapPolicyId,
  },
  description: "Set maximum marketing email contact cap to three per seven days.",
  parameters: {
    kind: "frequency_adjustment",
    policy: {
      kind: "CONTACT_CAP",
      channels: [EMAIL],
      maximumContacts: 3,
      windowSeconds: WEEK,
    },
  },
});

export const reduceSmsFrequency4To2Per30Days = lifecycleAction({
  actionIdValue: "action_lifecycle_sms_frequency_4_to_2_30d",
  actionTypeValue: "lifecycle.adjust_frequency",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: smsCadencePolicyId,
  },
  description: "Reduce SMS cadence from four messages per thirty days to two.",
  parameters: {
    kind: "frequency_adjustment",
    policy: {
      kind: "PLANNED_CADENCE",
      channel: SMS,
      operation: {
        kind: "DELTA",
        direction: "decrease",
        amount: { count: 2, windowSeconds: THIRTY_DAYS },
        reference: {
          kind: "explicit_baseline",
          value: { count: 4, windowSeconds: THIRTY_DAYS },
        },
      },
    },
  },
});

export const minimum24HoursEmailSms = lifecycleAction({
  actionIdValue: "action_lifecycle_cross_channel_min_24h",
  actionTypeValue: "lifecycle.adjust_frequency",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: crossChannelPolicyId,
  },
  description: "Require at least twenty-four hours between email and SMS promotional contacts.",
  parameters: {
    kind: "frequency_adjustment",
    policy: {
      kind: "MINIMUM_INTERVAL",
      channels: [EMAIL, SMS],
      minimumIntervalSeconds: DAY,
    },
  },
});

const temporaryCadenceActionId = actionId(
  "action_lifecycle_email_frequency_temp_4w",
);

export const temporaryEmailFrequencyIncrease4Weeks = lifecycleAction({
  actionIdValue: temporaryCadenceActionId,
  actionTypeValue: "lifecycle.adjust_frequency",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: emailCadencePolicyId,
  },
  description:
    "Temporarily increase email campaign cadence from two to three sends per week for four weeks.",
  parameters: {
    kind: "frequency_adjustment",
    policy: {
      kind: "PLANNED_CADENCE",
      channel: EMAIL,
      purpose: { kind: "GENERAL_CAMPAIGN" },
      operation: {
        kind: "DELTA",
        direction: "increase",
        amount: { count: 1, windowSeconds: WEEK },
        reference: {
          kind: "explicit_baseline",
          value: { count: 2, windowSeconds: WEEK },
        },
      },
    },
  },
  duration: { kind: "temporary", durationSeconds: FOUR_WEEKS },
  lifecycleRollback: {
    available: true,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      preActionValue: {
        kind: "explicit_policy",
        value: { kind: "FREQUENCY_POLICY", policy: cadence2PerWeek },
      },
    },
    trigger: { kind: "ON_TERMINATION" },
    delaySeconds: 0,
    cost: {
      kind: "known",
      value: { kind: "money", amountMinor: 0, currency: CAD },
      sourceRef: "lifecycle:rollback:no-direct-cost",
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporaryCadenceActionId,
      expectedValue: {
        kind: "FREQUENCY_POLICY",
        policy: cadence3PerWeek,
      },
    },
  },
});

export const rollbackTemporaryEmailFrequency = lifecycleAction({
  actionIdValue: "action_lifecycle_rollback_email_frequency_temp",
  actionTypeValue: "lifecycle.rollback_policy",
  target: {
    kind: "lifecycle_contact_policy",
    contactPolicyId: emailCadencePolicyId,
  },
  description:
    "Rollback temporary email cadence only if the temporary Action still owns the current policy state.",
  parameters: {
    kind: "lifecycle_policy_rollback",
    originalActionId: temporaryCadenceActionId,
    strategy: {
      kind: "RESTORE_PRE_ACTION_VALUE",
      preActionValue: {
        kind: "explicit_policy",
        value: { kind: "FREQUENCY_POLICY", policy: cadence2PerWeek },
      },
    },
    conflictGuard: {
      kind: "REQUIRE_CURRENT_MATCHES_ACTION_OUTPUT",
      sourceActionId: temporaryCadenceActionId,
      expectedValue: {
        kind: "FREQUENCY_POLICY",
        policy: cadence3PerWeek,
      },
    },
  },
  reversalOfActionId: temporaryCadenceActionId,
});

export const stopWinbackFlow = lifecycleAction({
  actionIdValue: "action_lifecycle_stop_winback_90",
  actionTypeValue: "lifecycle.stop_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_winback_90_email",
  },
  description: "Stop the existing 90-day winback flow.",
  parameters: {
    kind: "lifecycle_flow_stop",
    targetFlowId: "lifecycleflow_winback_90_email",
    stopSemantics: "PREVENT_FUTURE_TRIGGERED_COMMUNICATIONS",
  },
});

export const modifyWinbackTrigger90To75 = lifecycleAction({
  actionIdValue: "action_lifecycle_modify_winback_trigger_75",
  actionTypeValue: "lifecycle.modify_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_winback_90_email",
  },
  description: "Change winback trigger from 90 days to 75 days since last purchase.",
  parameters: {
    kind: "lifecycle_flow_modify",
    targetFlowId: "lifecycleflow_winback_90_email",
    modifications: [
      {
        kind: "SET_TRIGGER",
        trigger: {
          kind: "METRIC_THRESHOLD",
          metric: "DAYS_SINCE_LAST_PURCHASE",
          operator: "GTE",
          value: 75,
        },
      },
    ],
  },
});

export const modifyWinbackStep2Delay7To5 = lifecycleAction({
  actionIdValue: "action_lifecycle_modify_winback_step2_delay_5d",
  actionTypeValue: "lifecycle.modify_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_winback_email_sms",
  },
  description: "Change Step 2 delay in the existing winback flow from seven days to five days.",
  parameters: {
    kind: "lifecycle_flow_modify",
    targetFlowId: "lifecycleflow_winback_email_sms",
    modifications: [
      {
        kind: "SET_STEP_DELAY",
        stepId: "winback-step-2",
        delaySeconds: 5 * DAY,
      },
    ],
  },
});

export const addSmsStepToExistingWinback = lifecycleAction({
  actionIdValue: "action_lifecycle_modify_winback_add_sms",
  actionTypeValue: "lifecycle.modify_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_winback_email_only_existing",
  },
  description: "Add SMS as the third step of an existing winback flow.",
  parameters: {
    kind: "lifecycle_flow_modify",
    targetFlowId: "lifecycleflow_winback_email_only_existing",
    modifications: [
      {
        kind: "ADD_STEP",
        step: smsStep("winback-added-sms", 3, 14 * DAY),
      },
    ],
  },
});

export const retentionDay90CompetingFlow = lifecycleAction({
  actionIdValue: "action_lifecycle_start_retention_day90_competing",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_retention_day90_competing",
  },
  description: "Start a retention email flow that competes for the Day-90 contact slot.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_retention_day90_competing",
      purpose: { kind: "RETENTION" },
      trigger: {
        kind: "METRIC_THRESHOLD",
        metric: "DAYS_SINCE_LAST_PURCHASE",
        operator: "GTE",
        value: 90,
      },
      sequence: [emailStep("retention-day90-email", 1, 0)],
      contactPolicyRefs: [emailCapPolicyId],
      conflictResolution: {
        kind: "SUPPRESS_WHEN_CONTACT_POLICY_BLOCKS",
      },
    }),
  },
});

export const winbackEmailCoordinatedWithPromotion = lifecycleAction({
  actionIdValue: "action_lifecycle_winback_email_with_promo_coordination",
  actionTypeValue: "lifecycle.send",
  target: {
    kind: "lifecycle_program",
    programId: "lifecycleprogram_winback_campaign",
  },
  description:
    "Send a winback email coordinated with a separate canonical promotion Action.",
  purpose: { kind: "WINBACK" },
  parameters: sendParameters({
    channel: EMAIL,
    purpose: { kind: "WINBACK" },
    audience: segmentAudience("segment:winback", "SEND_TIME"),
    timing: {
      kind: "ABSOLUTE_TIME",
      at: FRIDAY_10_MONTREAL,
      timezone: "America/Toronto",
    },
    coordinatedActionIds: [actionId("action_promo_winback_15")],
  }),
  timing: {
    decisionTime: DECISION,
    requestedStart: { kind: "known", at: FRIDAY_10_MONTREAL },
    effectiveStart: { kind: "known", at: FRIDAY_10_MONTREAL },
    implementationDelaySeconds: { kind: "known", seconds: 0 },
  },
});

export const postPurchaseEmailCoordinatedWithCrossSell = lifecycleAction({
  actionIdValue: "action_lifecycle_post_purchase_with_cross_sell_coordination",
  actionTypeValue: "lifecycle.start_flow",
  target: {
    kind: "lifecycle_flow",
    flowId: "lifecycleflow_post_purchase_cross_sell",
  },
  description:
    "Start post-purchase messaging coordinated with a separate merchandising cross-sell Action.",
  parameters: {
    kind: "lifecycle_flow_start",
    definition: flowDefinition({
      flowId: "lifecycleflow_post_purchase_cross_sell",
      purpose: { kind: "POST_PURCHASE" },
      trigger: { kind: "EVENT", event: { kind: "ORDER_PLACED" } },
      sequence: [emailStep("post-purchase-cross-sell-email", 1, 7 * DAY)],
    }),
    coordinatedActionIds: [
      actionId("action_merch_cross_sell_sofa_a_cushion_b"),
    ],
  },
});

export const lifecyclePolicySnapshots: readonly LifecyclePolicySnapshot[] = [
  {
    baselineId: "lifecycle-policy:email-cadence:pre-temp",
    value: { kind: "FREQUENCY_POLICY", policy: cadence2PerWeek },
    sourceRef: "lifecycle-policy-snapshot:email-cadence",
  },
];

export const temporaryEmailCadenceExpectedValue:
  LifecyclePolicyRollbackValue = {
    kind: "FREQUENCY_POLICY",
    policy: cadence3PerWeek,
  };

export const temporaryEmailCadencePreviousValue:
  LifecyclePolicyRollbackValue = {
    kind: "FREQUENCY_POLICY",
    policy: cadence2PerWeek,
  };
