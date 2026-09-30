import { describe, expect, it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import {
  TRANSLATION_CONTEXT_SCHEMA_VERSION,
  type TranslationContext,
} from "../../src/action_translation/types.js";
import {
  resolveMerchandisingRankingSnapshot,
  validateTranslationContext,
} from "../../src/action_translation/context.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
  crossSellCushionBForSofaA,
  featureProductAHomepage,
  merchandisingRankingSnapshots,
  merchandisingSurfaceDefinitions,
  moveProductEUpFive,
  removeProductAHomepagePlacement,
  rollbackTemporaryProductARank,
  setProductCPosition1CollectionX,
} from "../../src/merchandising/fixtures.js";

const context:TranslationContext={
  schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
  simulatorClock:utcTimestamp("2026-09-22T13:00:00Z"),
  capabilities:["merchandising_position"],
  entityMappings:[],
  referenceBindings:[],
  merchandisingRankingSnapshots,
  merchandisingSurfaceDefinitions,
};

describe("Step 7 conservative merchandising translation",()=>{
  it("validates 1.3 mechanical ranking/surface context",()=>{
    expect(validateTranslationContext(context).ok).toBe(true);
    expect(resolveMerchandisingRankingSnapshot(
      context,
      "ranking:collection-x:e-relative",
    ).status).toBe("resolved");
  });

  it("gates merchandising context to TranslationContext 1.3",()=>{
    const legacy={...context,schemaVersion:"1.2.0" as const};
    const result=validateTranslationContext(legacy);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.failure.code).toBe("TRANSLATION_CONTEXT_FEATURE_REQUIRES_1_3");
  });

  it("rejects future/predictive merchandising information in translation context",()=>{
    const unsafe={...context,futureInventory:{productA:0}};
    const result=validateTranslationContext(unsafe);
    expect(result.ok).toBe(false);
    if(!result.ok) expect(result.failure.code).toBe("FORBIDDEN_TRANSLATION_CONTEXT_INFORMATION");
  });

  it("returns explicit unsupported capability for feature/rank/relationship/removal/rollback",()=>{
    for(const action of [
      featureProductAHomepage,
      setProductCPosition1CollectionX,
      moveProductEUpFive,
      crossSellCushionBForSofaA,
      removeProductAHomepagePlacement,
      rollbackTemporaryProductARank,
    ]){
      expect(translateBusinessAction(action,context)).toMatchObject({
        status:"UNSUPPORTED_SIMULATOR_CAPABILITY",
        code:"MERCHANDISING_CAPABILITY_UNSUPPORTED_BY_SIMULATOR"
      });
    }
  });

  it("does not fake merchandising through demand, conversion, advertising, availability or price mutations",()=>{
    const result=translateBusinessAction(featureProductAHomepage,context);
    expect(result.status).toBe("UNSUPPORTED_SIMULATOR_CAPABILITY");
  });
});
