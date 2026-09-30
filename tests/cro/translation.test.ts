import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type TranslationContext,
} from "../../src/action_translation/types.js";
import {
  resolveCroStructureSnapshot,
  validateTranslationContext,
} from "../../src/action_translation/context.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  addSiteSearchAutocomplete,
  croExperienceStates,
  croStructureSnapshots,
  improveMobilePdpLoadingPerformance,
  modifyCheckoutFormStructure,
  modifyPdpDeliveryPresentation,
  movePdpDeliveryAboveDescription,
  rollbackTemporaryPdpDeliveryReorder,
} from "../../src/cro/fixtures.js";

const context:TranslationContext={
  schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock:utcTimestamp("2026-09-22T13:00:00Z"),
  capabilities:[],
  entityMappings:[],
  referenceBindings:[],
  croStructureSnapshots,
  croExperienceBindings:croExperienceStates,
};

describe("Step 9 CRO translation boundary",()=>{
  it("validates TranslationContext 1.5 current page structure and capability context",()=>{
    expect(validateTranslationContext(context).ok).toBe(true);
    expect(resolveCroStructureSnapshot(
      context,
      "cro-structure:pdp-default",
    )).toMatchObject({status:"resolved"});
  });

  it("gates CRO context to TranslationContext 1.5",()=>{
    const legacy={...context,schemaVersion:"1.4.0" as const};
    const result=validateTranslationContext(legacy);
    expect(result.ok).toBe(false);
    if(!result.ok){
      expect(result.failure.code).toBe(
        "TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_5",
      );
    }
  });

  it("rejects future/outcome/experiment information from CRO translation context",()=>{
    for(const [key,value] of [
      ["futureConversion",0.4],
      ["futureSessions",1000],
      ["futureOrders",50],
      ["predictedRevenue",100000],
      ["counterfactualConversion",0.1],
      ["evaluatorResult","pass"],
      ["oracleState","hidden"],
      ["groundTruth","hidden"],
      ["trafficAllocation",0.5],
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

  it("returns explicit unsupported simulator capability across CRO intervention families",()=>{
    for(const action of [
      modifyPdpDeliveryPresentation,
      addSiteSearchAutocomplete,
      movePdpDeliveryAboveDescription,
      modifyCheckoutFormStructure,
      improveMobilePdpLoadingPerformance,
      rollbackTemporaryPdpDeliveryReorder,
    ]){
      expect(translateBusinessAction(action,context)).toMatchObject({
        status:"UNSUPPORTED_SIMULATOR_CAPABILITY",
        code:"CRO_CAPABILITY_UNSUPPORTED_BY_SIMULATOR",
      });
    }
  });

  it("never fakes CRO effects through conversion, purchase probability, revenue or demand",()=>{
    const result=translateBusinessAction(
      improveMobilePdpLoadingPerformance,
      context,
    );
    expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  });
});
