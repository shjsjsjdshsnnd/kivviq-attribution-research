import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import { evaluateLifecycleEligibility } from "../../src/lifecycle/eligibility.js";
import {
  postPurchaseCareAfterFulfillment,
  retentionOneTimeBuyers,
  reviewRequestAfterDelivery,
  sendEmailSegmentAFriday10,
  sendVipSegmentASuppressRecentPurchasers,
  smsSendRequiresConsent,
  winback90DayEmailFlow,
} from "../../src/lifecycle/fixtures.js";

const emailEvidence={
  channel:{kind:"EMAIL" as const},
  consentEligible:true,
  validDestination:true,
  channelSuppressed:false,
};
const smsEvidence={
  channel:{kind:"SMS" as const},
  consentEligible:true,
  validDestination:true,
  channelSuppressed:false,
};

describe("Step 10 deterministic lifecycle eligibility",()=>{
  it("evaluates send-time segment membership only at the declared boundary",()=>{
    expect(evaluateLifecycleEligibility(sendEmailSegmentAFriday10,{
      evaluationBoundary:"DECISION_TIME",
      segmentIds:["segment:A"],
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    })).toMatchObject({
      status:"unknown",
      reasonCodes:["LIFECYCLE_MEMBERSHIP_BOUNDARY_NOT_REACHED"],
    });

    expect(evaluateLifecycleEligibility(sendEmailSegmentAFriday10,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["segment:A"],
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    }).status).toBe("eligible");
  });

  it("applies suppression separately from inclusion",()=>{
    expect(evaluateLifecycleEligibility(sendVipSegmentASuppressRecentPurchasers,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["vip:A"],
      daysSinceLastPurchase:3,
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["LIFECYCLE_RECENT_PURCHASE_SUPPRESSED"],
    });

    expect(evaluateLifecycleEligibility(sendVipSegmentASuppressRecentPurchasers,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["vip:A"],
      daysSinceLastPurchase:14,
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    }).status).toBe("eligible");
  });

  it("preserves missing SMS consent as unknown",()=>{
    expect(evaluateLifecycleEligibility(smsSendRequiresConsent,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["segment:B"],
      channelEvidence:[{
        channel:{kind:"SMS"},
        validDestination:true,
        channelSuppressed:false,
      }],
    })).toMatchObject({
      status:"unknown",
      reasonCodes:["LIFECYCLE_CONSENT_UNKNOWN"],
    });
  });

  it("distinguishes ineligible consent from eligible consent",()=>{
    expect(evaluateLifecycleEligibility(smsSendRequiresConsent,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["segment:B"],
      channelEvidence:[{...smsEvidence,consentEligible:false}],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["LIFECYCLE_CONSENT_INELIGIBLE"],
    });

    expect(evaluateLifecycleEligibility(smsSendRequiresConsent,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["segment:B"],
      channelEvidence:[smsEvidence],
    }).status).toBe("eligible");
  });

  it("applies contact-policy blocks without changing planned campaign cadence",()=>{
    expect(evaluateLifecycleEligibility(sendEmailSegmentAFriday10,{
      evaluationBoundary:"SEND_TIME",
      segmentIds:["segment:A"],
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"BLOCK",
      }],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["LIFECYCLE_CONTACT_POLICY_BLOCKED"],
    });
  });

  it("evaluates explicit 90-day winback trigger without churn prediction",()=>{
    expect(evaluateLifecycleEligibility(winback90DayEmailFlow,{
      evaluationBoundary:"TRIGGER_TIME",
      daysSinceLastPurchase:95,
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    }).status).toBe("eligible");

    expect(evaluateLifecycleEligibility(winback90DayEmailFlow,{
      evaluationBoundary:"TRIGGER_TIME",
      daysSinceLastPurchase:60,
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["LIFECYCLE_TRIGGER_NOT_MET"],
    });

    expect(evaluateLifecycleEligibility(winback90DayEmailFlow,{
      evaluationBoundary:"TRIGGER_TIME",
      channelEvidence:[emailEvidence],
      contactPolicies:[{
        contactPolicyId:"lifecyclepolicy_email_cap_7d",
        decision:"ALLOW",
      }],
    })).toMatchObject({
      status:"unknown",
      reasonCodes:["LIFECYCLE_TRIGGER_METRIC_UNKNOWN"],
    });
  });

  it("keeps fulfillment and delivery triggers distinct",()=>{
    expect(evaluateLifecycleEligibility(postPurchaseCareAfterFulfillment,{
      evaluationBoundary:"TRIGGER_TIME",
      channelEvidence:[emailEvidence],
      knownEvents:[{
        event:{kind:"ORDER_FULFILLED"},
        occurredAt:utcTimestamp("2026-09-20T13:00:00Z"),
      }],
    }).status).toBe("eligible");

    expect(evaluateLifecycleEligibility(reviewRequestAfterDelivery,{
      evaluationBoundary:"TRIGGER_TIME",
      channelEvidence:[emailEvidence],
      knownEvents:[{
        event:{kind:"ORDER_FULFILLED"},
        occurredAt:utcTimestamp("2026-09-20T13:00:00Z"),
      }],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["LIFECYCLE_TRIGGER_EVENT_NOT_FOUND"],
    });
  });

  it("evaluates one-time-buyer retention audience structurally",()=>{
    expect(evaluateLifecycleEligibility(retentionOneTimeBuyers,{
      evaluationBoundary:"TRIGGER_TIME",
      purchaseCount:1,
      channelEvidence:[emailEvidence],
    }).status).toBe("eligible");

    expect(evaluateLifecycleEligibility(retentionOneTimeBuyers,{
      evaluationBoundary:"TRIGGER_TIME",
      purchaseCount:2,
      channelEvidence:[emailEvidence],
    })).toMatchObject({
      status:"ineligible",
      reasonCodes:["LIFECYCLE_AUDIENCE_NOT_INCLUDED"],
    });
  });
});
