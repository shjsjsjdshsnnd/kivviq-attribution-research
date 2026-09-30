import { describe, expect, it } from "vitest";
import { actionFingerprint } from "../../src/action_ontology/semantics.js";
import { serializeAction } from "../../src/action_ontology/serialization.js";
import { assertValidAction, validateAction } from "../../src/action_ontology/validation.js";
import type { LifecycleMessageSpecificationBoundary } from "../../src/lifecycle/types.js";
import { reorderSkuA100 } from "../../src/inventory/fixtures.js";
import { startProductA100CadOff } from "../../src/promotion/fixtures.js";
import { crossSellCushionBForSofaA } from "../../src/merchandising/fixtures.js";
import {
  addSmsStepToExistingWinback,
  increaseEmailFrequency2To3PerWeek,
  maxMarketingEmail3Per7Days,
  modifyWinbackStep2Delay7To5,
  modifyWinbackTrigger90To75,
  multiStepWinbackEmailSmsFlow,
  postPurchaseCareAfterFulfillment,
  postPurchaseEmailCoordinatedWithCrossSell,
  replenishmentProductA60Days,
  reviewRequestAfterDelivery,
  sendEmailSegmentAFriday10,
  sendSmsSegmentB,
  setEmailFrequency3PerWeek,
  stopWinbackFlow,
  targetProgramVipSegment,
  winback90DayEmailFlow,
  winbackEmailCoordinatedWithPromotion,
} from "../../src/lifecycle/fixtures.js";

const clone=<T>(value:T):any=>JSON.parse(JSON.stringify(value));

describe("Step 10 canonical lifecycle Actions",()=>{
  it("distinguishes EMAIL and SMS sends to lifecycle audiences",()=>{
    expect(actionFingerprint(sendEmailSegmentAFriday10)).not.toBe(
      actionFingerprint(sendSmsSegmentB),
    );
    if(sendEmailSegmentAFriday10.parameters.kind==="lifecycle_send"){
      expect(sendEmailSegmentAFriday10.parameters.channel).toEqual({kind:"EMAIL"});
    }
    if(sendSmsSegmentB.parameters.kind==="lifecycle_send"){
      expect(sendSmsSegmentB.parameters.channel).toEqual({kind:"SMS"});
    }
  });

  it("distinguishes a one-time send from an automated flow",()=>{
    expect(sendEmailSegmentAFriday10.actionType).toBe("lifecycle.send");
    expect(winback90DayEmailFlow.actionType).toBe("lifecycle.start_flow");
    expect(actionFingerprint(sendEmailSegmentAFriday10)).not.toBe(
      actionFingerprint(winback90DayEmailFlow),
    );
  });

  it("preserves absolute send time and explicit timezone",()=>{
    if(sendEmailSegmentAFriday10.parameters.kind!=="lifecycle_send") return;
    expect(sendEmailSegmentAFriday10.parameters.timing).toEqual({
      kind:"ABSOLUTE_TIME",
      at:"2026-09-25T14:00:00Z",
      timezone:"America/Toronto",
    });
    expect(sendEmailSegmentAFriday10.timing.effectiveStart).toEqual({
      kind:"known",
      at:"2026-09-25T14:00:00Z",
    });
  });

  it("keeps SET frequency distinct from DELTA +1/week",()=>{
    expect(actionFingerprint(setEmailFrequency3PerWeek)).not.toBe(
      actionFingerprint(increaseEmailFrequency2To3PerWeek),
    );
    if(increaseEmailFrequency2To3PerWeek.parameters.kind==="frequency_adjustment"){
      expect(increaseEmailFrequency2To3PerWeek.parameters.policy).toMatchObject({
        kind:"PLANNED_CADENCE",
        operation:{
          kind:"DELTA",
          direction:"increase",
          amount:{count:1,windowSeconds:7*24*60*60},
          reference:{
            kind:"explicit_baseline",
            value:{count:2,windowSeconds:7*24*60*60},
          },
        },
      });
    }
  });

  it("keeps desired cadence distinct from customer-level contact cap",()=>{
    expect(actionFingerprint(setEmailFrequency3PerWeek)).not.toBe(
      actionFingerprint(maxMarketingEmail3Per7Days),
    );
    if(maxMarketingEmail3Per7Days.parameters.kind==="frequency_adjustment"){
      expect(maxMarketingEmail3Per7Days.parameters.policy).toMatchObject({
        kind:"CONTACT_CAP",
        maximumContacts:3,
        windowSeconds:7*24*60*60,
      });
    }
  });

  it("keeps planned cadence separate from guaranteed realized sends",()=>{
    expect(JSON.stringify(increaseEmailFrequency2To3PerWeek.parameters)).not.toMatch(
      /realizedSends|guaranteedMessages|futureMessageCount/i,
    );
  });

  it("keeps purchase, fulfillment and delivery event semantics distinct",()=>{
    if(postPurchaseCareAfterFulfillment.parameters.kind!=="lifecycle_flow_start"||
       reviewRequestAfterDelivery.parameters.kind!=="lifecycle_flow_start"||
       replenishmentProductA60Days.parameters.kind!=="lifecycle_flow_start") return;
    expect(postPurchaseCareAfterFulfillment.parameters.definition.trigger).toEqual({
      kind:"EVENT",event:{kind:"ORDER_FULFILLED"},
    });
    expect(reviewRequestAfterDelivery.parameters.definition.trigger).toEqual({
      kind:"EVENT",event:{kind:"ORDER_DELIVERED"},
    });
    expect(replenishmentProductA60Days.parameters.definition.trigger).toEqual({
      kind:"EVENT",event:{kind:"PRODUCT_PURCHASED",productId:"product:A"},
    });
  });

  it("preserves ordered multi-channel sequence without message creative",()=>{
    if(multiStepWinbackEmailSmsFlow.parameters.kind!=="lifecycle_flow_start") return;
    const sequence=multiStepWinbackEmailSmsFlow.parameters.definition.sequence;
    expect(sequence.map((step)=>step.position)).toEqual([1,2,3]);
    expect(sequence.map((step)=>step.channel.kind)).toEqual(["EMAIL","EMAIL","SMS"]);
    expect(sequence.map((step)=>step.delaySeconds)).toEqual([
      0,7*24*60*60,14*24*60*60,
    ]);
    expect(JSON.stringify(sequence)).not.toMatch(/subject|body|creative|cta|smsCopy/i);
  });

  it("uses stable flow identity for modify and stop Actions",()=>{
    if(stopWinbackFlow.parameters.kind==="lifecycle_flow_stop"){
      expect(stopWinbackFlow.target).toEqual({
        kind:"lifecycle_flow",
        flowId:"lifecycleflow_winback_90_email",
      });
      expect(stopWinbackFlow.parameters).toMatchObject({
        targetFlowId:"lifecycleflow_winback_90_email",
        stopSemantics:"PREVENT_FUTURE_TRIGGERED_COMMUNICATIONS",
      });
    }
    expect(modifyWinbackTrigger90To75.target.kind).toBe("lifecycle_flow");
    expect(modifyWinbackStep2Delay7To5.target.kind).toBe("lifecycle_flow");
    expect(addSmsStepToExistingWinback.target.kind).toBe("lifecycle_flow");
  });

  it("keeps lifecycle replenishment messaging distinct from merchant inventory reorder",()=>{
    expect(replenishmentProductA60Days.actionCategory).toBe("lifecycle");
    expect(reorderSkuA100.actionCategory).toBe("inventory");
    expect(actionFingerprint(replenishmentProductA60Days)).not.toBe(
      actionFingerprint(reorderSkuA100),
    );
  });

  it("keeps winback communication distinct from promotional incentive",()=>{
    expect(winbackEmailCoordinatedWithPromotion.actionCategory).toBe("lifecycle");
    expect(startProductA100CadOff.actionCategory).toBe("promotion");
    expect(actionFingerprint(winbackEmailCoordinatedWithPromotion)).not.toBe(
      actionFingerprint(startProductA100CadOff),
    );
    if(winbackEmailCoordinatedWithPromotion.parameters.kind==="lifecycle_send"){
      expect(winbackEmailCoordinatedWithPromotion.parameters.coordinatedActionIds).toEqual([
        "action_promo_winback_15",
      ]);
      expect(JSON.stringify(winbackEmailCoordinatedWithPromotion.parameters)).not.toMatch(
        /discount|basisPoints|couponCode/i,
      );
    }
  });

  it("keeps lifecycle message coordination distinct from merchandising relationship",()=>{
    expect(postPurchaseEmailCoordinatedWithCrossSell.actionCategory).toBe("lifecycle");
    expect(crossSellCushionBForSofaA.actionCategory).toBe("merchandising");
    expect(actionFingerprint(postPurchaseEmailCoordinatedWithCrossSell)).not.toBe(
      actionFingerprint(crossSellCushionBForSofaA),
    );
  });

  it("keeps segment definition and decision-time membership binding explicit",()=>{
    if(targetProgramVipSegment.parameters.kind!=="lifecycle_targeting") return;
    expect(targetProgramVipSegment.parameters.audience.include[0]).toMatchObject({
      kind:"CUSTOMER_SEGMENT",
      segmentId:"vip:A",
      membership:{
        evaluateAt:"DECISION_TIME",
        bindingRef:"lifecycle-membership:vip-a:decision",
      },
    });
  });

  it("supports future message specifications without changing Action identity",()=>{
    const specs:readonly LifecycleMessageSpecificationBoundary[]=[
      {
        messageSpecId:"messagespec:winback-a",
        actionId:winbackEmailCoordinatedWithPromotion.actionId,
        creativeRef:"creative:subject-a",
      },
      {
        messageSpecId:"messagespec:winback-b",
        actionId:winbackEmailCoordinatedWithPromotion.actionId,
        creativeRef:"creative:subject-b",
      },
    ];
    const fingerprint=actionFingerprint(winbackEmailCoordinatedWithPromotion);
    expect(specs.every((spec)=>spec.actionId===winbackEmailCoordinatedWithPromotion.actionId)).toBe(true);
    expect(actionFingerprint(winbackEmailCoordinatedWithPromotion)).toBe(fingerprint);
  });

  it("rejects provider-specific, creative and experiment fields",()=>{
    for(const key of [
      "subjectLine","messageBody","messageCreative","smsCopy",
      "omnisendWorkflowId","klaviyoFlowId","mailchimpCampaignId",
      "trafficAllocation","controlGroup","randomizationUnit",
      "statisticalPower","significanceThreshold","experimentResult",
    ]){
      const invalid=clone(sendEmailSegmentAFriday10);
      invalid[key]="forbidden";
      const result=validateAction(invalid);
      expect(result.ok).toBe(false);
      if(!result.ok){
        expect(result.errors.some(
          (issue)=>issue.code==="FORBIDDEN_ACTION_INFORMATION",
        )).toBe(true);
      }
    }
  });

  it("rejects lifecycle outcome/prediction leakage",()=>{
    for(const key of [
      "expectedOpenRate","expectedClickRate","expectedConversionRate",
      "expectedRevenue","expectedProfit","expectedRepeatPurchase",
      "expectedRetentionLift","expectedLTV","predictedChurnReduction",
      "predictedOptimalSendTime","predictedPurchaseProbability",
      "futurePurchase","counterfactualRevenue","recommendationScore",
      "confidenceScore",
    ]){
      const invalid=clone(winback90DayEmailFlow);
      invalid[key]=1;
      const result=validateAction(invalid);
      expect(result.ok).toBe(false);
      if(!result.ok){
        expect(result.errors.some(
          (issue)=>issue.code==="FORBIDDEN_ACTION_INFORMATION",
        )).toBe(true);
      }
    }
  });

  it("rejects 1.8 lifecycle semantics mislabeled as 1.7",()=>{
    const invalid=clone(winback90DayEmailFlow);
    invalid.schemaVersion="1.7.0";
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok){
      expect(result.errors.some(
        (issue)=>issue.code==="SCHEMA_FEATURE_REQUIRES_1_8",
      )).toBe(true);
    }
  });

  it("preserves deterministic canonical serialization",()=>{
    expect(serializeAction(sendEmailSegmentAFriday10)).toBe(
      serializeAction(sendEmailSegmentAFriday10),
    );
    expect(serializeAction(sendEmailSegmentAFriday10)).not.toBe(
      serializeAction(sendSmsSegmentB),
    );
  });

  it("rejects a flow target/definition identity mismatch",()=>{
    const invalid=clone(winback90DayEmailFlow);
    invalid.actionId="action_lifecycle_bad_flow_identity";
    invalid.parameters.definition.flowId="lifecycleflow_other";
    const result=validateAction(invalid);
    expect(result.ok).toBe(false);
    if(!result.ok){
      expect(result.errors.some(
        (issue)=>issue.code==="LIFECYCLE_FLOW_ID_MISMATCH",
      )).toBe(true);
    }
  });
});
