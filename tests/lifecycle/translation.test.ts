import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type TranslationContext,
} from "../../src/action_translation/types.js";
import {
  resolveLifecyclePolicy,
  validateTranslationContext,
} from "../../src/action_translation/context.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  increaseEmailFrequency2To3PerWeek,
  modifyWinbackTrigger90To75,
  rollbackTemporaryEmailFrequency,
  sendEmailSegmentAFriday10,
  stopWinbackFlow,
  targetProgramVipSegment,
  temporaryEmailCadenceExpectedValue,
  winback90DayEmailFlow,
} from "../../src/lifecycle/fixtures.js";

const context:TranslationContext={
  schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock:utcTimestamp("2026-09-22T13:00:00Z"),
  capabilities:[],
  entityMappings:[],
  referenceBindings:[],
  lifecycleFlowBindings:[{
    flowId:"lifecycleflow_winback_90_email",
    active:true,
    purpose:{kind:"WINBACK"},
    configurationRef:"lifecycle-config:winback-90",
    sourceRef:"lifecycle-state:winback-90:decision",
  }],
  lifecyclePolicyBindings:[{
    contactPolicyId:"lifecyclepolicy_email_campaign_cadence",
    value:temporaryEmailCadenceExpectedValue,
    sourceRef:"lifecycle-policy:email-cadence:decision",
  }],
  lifecycleSegmentDefinitions:[{
    segmentId:"segment:A",
    sourceRef:"segment-definition:A",
  },{
    segmentId:"vip:A",
    sourceRef:"segment-definition:vip-a",
  }],
  lifecycleMembershipSnapshots:[{
    segmentId:"vip:A",
    evaluateAt:"DECISION_TIME",
    bindingRef:"lifecycle-membership:vip-a:decision",
    snapshotTime:utcTimestamp("2026-09-22T13:00:00Z"),
    sourceRef:"segment-membership:vip-a:decision",
    customerIds:["customer:synthetic-1"],
  }],
  lifecycleChannelCapabilities:[{
    channel:{kind:"EMAIL"},
    sendSupported:true,
    sourceRef:"owned-channel:email",
  },{
    channel:{kind:"SMS"},
    sendSupported:true,
    sourceRef:"owned-channel:sms",
  }],
  lifecycleCustomerBindings:[{
    customerId:"customer:synthetic-1",
    segmentIds:["segment:A","vip:A"],
    channelStates:[{
      channel:{kind:"EMAIL"},
      consentEligible:true,
      validDestination:true,
      channelSuppressed:false,
    }],
    currentFlowIds:["lifecycleflow_winback_90_email"],
    knownEvents:[{
      event:{kind:"ORDER_PLACED"},
      occurredAt:utcTimestamp("2026-09-20T13:00:00Z"),
    }],
    sourceRef:"customer-state:synthetic-1",
  }],
};

describe("Step 10 lifecycle translation boundary",()=>{
  it("validates TranslationContext 1.6 current lifecycle state",()=>{
    expect(validateTranslationContext(context).ok).toBe(true);
    expect(resolveLifecyclePolicy(
      context,
      "lifecyclepolicy_email_campaign_cadence",
    )).toMatchObject({status:"resolved"});
  });

  it("gates lifecycle context to TranslationContext 1.6",()=>{
    const legacy={...context,schemaVersion:"1.5.0" as const};
    const result=validateTranslationContext(legacy);
    expect(result.ok).toBe(false);
    if(!result.ok){
      expect(result.failure.code).toBe(
        "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_6",
      );
    }
  });

  it("rejects future/predictive/provider/experiment lifecycle context",()=>{
    for(const [key,value] of [
      ["futurePurchase","yes"],
      ["futureEngagement","yes"],
      ["futureChurn",true],
      ["futureSegmentMembership",["vip:A"]],
      ["predictedOptimalSendTime","2026-09-25T14:00:00Z"],
      ["expectedOpenRate",0.5],
      ["counterfactualRevenue",1000],
      ["evaluatorResult","pass"],
      ["oracleState","hidden"],
      ["groundTruth","hidden"],
      ["omnisendWorkflowId","workflow:123"],
      ["experimentResult","winner"],
    ] as const){
      const unsafe={...context,[key]:value};
      const result=validateTranslationContext(unsafe);
      expect(result.ok).toBe(false);
      if(!result.ok){
        expect(result.failure.code).toBe(
          "FORBIDDEN_TRANSLATION_CONTEXT_INFORMATION",
        );
      }
    }
  });

  it("returns explicit unsupported simulator capability across lifecycle families",()=>{
    for(const action of [
      sendEmailSegmentAFriday10,
      winback90DayEmailFlow,
      stopWinbackFlow,
      modifyWinbackTrigger90To75,
      increaseEmailFrequency2To3PerWeek,
      targetProgramVipSegment,
      rollbackTemporaryEmailFrequency,
    ]){
      expect(translateBusinessAction(action,context)).toMatchObject({
        status:"UNSUPPORTED_SIMULATOR_CAPABILITY",
        code:"LIFECYCLE_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
      });
    }
  });

  it("never fakes lifecycle effects through repeat purchase, retention, LTV or revenue",()=>{
    expect(translateBusinessAction(
      winback90DayEmailFlow,
      context,
    ).status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  });
});
