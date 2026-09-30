import { describe,expect,it } from "vitest";
import { utcTimestamp } from "../../src/core/units.js";
import { TRANSLATION_CONTEXT_SCHEMA_VERSION,type TranslationContext } from "../../src/action_translation/types.js";
import { translateBusinessAction } from "../../src/action_translation/translate.js";
import {
 freeStandardShippingAllOrders,temporaryThreshold150To75,rollbackTemporaryThreshold,
 modifyFreeStandardThresholdOffer,stopFreeStandardThresholdOffer
} from "../../src/shipping/fixtures.js";

const context:TranslationContext={
 schemaVersion:TRANSLATION_CONTEXT_SCHEMA_VERSION,
 simulatorClock:utcTimestamp("2026-09-22T13:00:00Z"),
 capabilities:["promotion_discount"],
 entityMappings:[],
 referenceBindings:[],
};

describe("Step 6 conservative shipping translation",()=>{
 it("returns explicit unsupported simulator capability for shipping offer",()=>{
  expect(translateBusinessAction(freeStandardShippingAllOrders,context)).toMatchObject({
   status:"UNSUPPORTED_SIMULATOR_CAPABILITY",code:"SHIPPING_CAPABILITY_UNSUPPORTED_BY_SIMULATOR"
  });
 });

 it("does not fake threshold policy through price or promotion interventions",()=>{
  expect(translateBusinessAction(temporaryThreshold150To75,context)).toMatchObject({status:"UNSUPPORTED_SIMULATOR_CAPABILITY"});
 });

 it("keeps stop/modify/rollback valid but unsupported until native shipping lifecycle exists",()=>{
  for(const action of [modifyFreeStandardThresholdOffer,stopFreeStandardThresholdOffer,rollbackTemporaryThreshold]){
   expect(translateBusinessAction(action,context)).toMatchObject({status:"UNSUPPORTED_SIMULATOR_CAPABILITY"});
  }
 });
});
